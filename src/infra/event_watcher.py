"""
Event Watcher - File-based self-scheduling event system.

Monitors data/events/ directory for JSON event files.
The agent (or any external process) can drop JSON files here to schedule work.

Event types:
- immediate: Fires as soon as the watcher sees the file. Auto-deletes after firing.
- one-shot: Fires once at a specific time. Auto-deletes after firing.
- periodic: Fires on a cron schedule. Persists until manually deleted.

Event JSON format:
{
    "type": "immediate" | "one-shot" | "periodic",
    "text": "What to tell the agent",
    "at": "2026-02-10T09:00:00-08:00",       // one-shot only (ISO timestamp with offset)
    "schedule": "0 9 * * 1-5",                // periodic only (cron expression)
    "timezone": "America/Los_Angeles",         // periodic only (IANA timezone)
    "channelId": "main",                       // optional session key, default "main"
    "wake": "now" | "next-circuits"           // optional, default "now" for immediate, "next-circuits" for others
}

The agent can create events by writing JSON files to data/events/.
The agent can cancel events by deleting files from data/events/.
The agent can list events by reading the directory.
"""

import os
import json
import time
import logging
import threading
from typing import Dict, Any, Optional, List, Callable
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

# Try to import watchdog for real-time fs watching
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileModifiedEvent
    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False
    # Stub so _EventFileHandler class definition doesn't crash
    class FileSystemEventHandler:
        pass

# Try to import croniter for periodic events
try:
    from croniter import croniter
    HAS_CRONITER = True
except ImportError:
    HAS_CRONITER = False

# Try to import pytz for timezone support
try:
    import pytz
    HAS_PYTZ = True
except ImportError:
    HAS_PYTZ = False

# Constants
MAX_QUEUED_EVENTS = 5
CRON_POLL_INTERVAL_SECONDS = 30  # Only used for periodic cron checks (not for immediate/one-shot)
DEBOUNCE_MS = 200  # Debounce filesystem events
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
EVENTS_DIR = DATA_DIR / "events"


class _EventFileHandler(FileSystemEventHandler):
    """Watchdog handler that debounces file events and forwards to EventWatcher."""
    
    def __init__(self, watcher: 'EventWatcher'):
        super().__init__()
        self._watcher = watcher
        self._debounce_timers: Dict[str, threading.Timer] = {}
        self._lock = threading.Lock()
    
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.json'):
            self._debounce(event.src_path)
    
    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith('.json'):
            self._debounce(event.src_path)
    
    def _debounce(self, path: str):
        """Debounce rapid file events (e.g. create + modify from a single write)."""
        filename = Path(path).name
        with self._lock:
            existing = self._debounce_timers.get(filename)
            if existing:
                existing.cancel()
            timer = threading.Timer(DEBOUNCE_MS / 1000.0, self._fire, args=[path])
            timer.daemon = True
            self._debounce_timers[filename] = timer
            timer.start()
    
    def _fire(self, path: str):
        """Process a single file after debounce."""
        filename = Path(path).name
        with self._lock:
            self._debounce_timers.pop(filename, None)
        try:
            self._watcher._handle_file(Path(path))
        except Exception as e:
            logger.error(f"Error handling event file {filename}: {e}")


class EventWatcher:
    """
    Watches data/events/ for JSON event files and fires them.
    Uses watchdog for real-time filesystem monitoring (instant event firing).
    Falls back to polling if watchdog is unavailable.
    
    - Immediate events fire instantly when the file appears. Auto-deletes.
    - One-shot events fire at their scheduled time. Auto-deletes.
    - Periodic events fire on cron schedule. Persists until manually deleted.
    """
    
    def __init__(
        self,
        on_system_event: Optional[Callable[[str, str], None]] = None,
        on_heartbeat_now: Optional[Callable[[], None]] = None,
    ):
        """
        Args:
            on_system_event: Callback(text, session_key) to enqueue a system event.
            on_heartbeat_now: Callback() to trigger immediate heartbeat.
        """
        self._on_system_event = on_system_event
        self._on_heartbeat_now = on_heartbeat_now
        
        self._running = False
        self._observer = None  # watchdog Observer
        self._cron_timer: Optional[threading.Timer] = None  # periodic cron check timer
        self._oneshot_timers: Dict[str, threading.Timer] = {}  # filename -> scheduled timer
        self._lock = threading.Lock()
        self._start_time = time.time()
        self._periodic_last_fired: Dict[str, float] = {}  # filename -> last fire timestamp
        self._fired_count = 0
        self._mode = "watchdog" if HAS_WATCHDOG else "polling"
    
    def start(self):
        """Start watching the events directory."""
        with self._lock:
            if self._running:
                return
            
            EVENTS_DIR.mkdir(parents=True, exist_ok=True)
            self._running = True
            self._start_time = time.time()
        
        # Scan existing files first
        self._scan_existing()
        
        if HAS_WATCHDOG:
            # Real-time filesystem watching
            handler = _EventFileHandler(self)
            self._observer = Observer()
            self._observer.schedule(handler, str(EVENTS_DIR), recursive=False)
            self._observer.daemon = True
            self._observer.start()
            logger.info(f"Event watcher started (watchdog real-time, dir: {EVENTS_DIR})")
        else:
            logger.warning("watchdog not installed, falling back to polling")
            logger.info(f"Event watcher started (polling every {CRON_POLL_INTERVAL_SECONDS}s, dir: {EVENTS_DIR})")
        
        # Start cron poll timer for periodic events (watchdog can't detect time passing)
        self._schedule_cron_poll()
    
    def stop(self):
        """Stop watching."""
        with self._lock:
            self._running = False
        
        # Stop watchdog observer
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None
        
        # Cancel cron timer
        if self._cron_timer:
            self._cron_timer.cancel()
            self._cron_timer = None
        
        # Cancel all one-shot timers
        for timer in self._oneshot_timers.values():
            timer.cancel()
        self._oneshot_timers.clear()
        
        logger.info("Event watcher stopped")
    
    def get_status(self) -> Dict[str, Any]:
        """Get watcher status."""
        with self._lock:
            events = self._list_events_internal()
            return {
                "running": self._running,
                "mode": self._mode,
                "eventsDir": str(EVENTS_DIR),
                "eventCount": len(events),
                "firedCount": self._fired_count,
                "scheduledTimers": len(self._oneshot_timers),
                "events": events,
            }
    
    def _schedule_cron_poll(self):
        """Schedule next cron poll (for periodic events and one-shot time checks)."""
        if self._cron_timer:
            self._cron_timer.cancel()
        
        with self._lock:
            if not self._running:
                return
        
        self._cron_timer = threading.Timer(CRON_POLL_INTERVAL_SECONDS, self._cron_poll)
        self._cron_timer.daemon = True
        self._cron_timer.start()
    
    def _cron_poll(self):
        """Check periodic events and overdue one-shots."""
        with self._lock:
            if not self._running:
                return
        
        try:
            self._scan_periodic_and_overdue()
        except Exception as e:
            logger.error(f"Event watcher cron poll error: {e}")
        
        self._schedule_cron_poll()
    
    def _scan_existing(self):
        """Scan existing files on startup."""
        if not EVENTS_DIR.exists():
            return
        
        for event_file in sorted(EVENTS_DIR.glob("*.json")):
            try:
                self._handle_file(event_file)
            except Exception as e:
                logger.error(f"Error scanning existing event {event_file.name}: {e}")
    
    def _handle_file(self, event_file: Path):
        """Process a single event file (called by watchdog or scan)."""
        if not event_file.exists() or not event_file.name.endswith('.json'):
            return
        
        try:
            content = event_file.read_text(encoding='utf-8')
            event = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in {event_file.name}: {e}")
            return
        except Exception as e:
            logger.error(f"Error reading {event_file.name}: {e}")
            return
        
        event_type = event.get("type", "immediate")
        text = event.get("text", "")
        session_key = event.get("channelId", "main")
        wake_mode = event.get("wake")
        
        if not text:
            logger.warning(f"Event file {event_file.name} has no text, skipping")
            return
        
        if event_type == "immediate":
            # Check if stale (created before watcher started)
            try:
                if event_file.stat().st_mtime < self._start_time:
                    logger.info(f"Stale immediate event, deleting: {event_file.name}")
                    self._safe_delete(event_file)
                    return
            except Exception:
                return
            
            self._fire_event(event_file.name, event_type, text, session_key, wake_mode or "now")
            self._safe_delete(event_file)
        
        elif event_type == "one-shot":
            at_str = event.get("at", "")
            fire_at = self._parse_iso_timestamp(at_str)
            
            if fire_at is None:
                logger.warning(f"Event file {event_file.name} has invalid 'at' timestamp: {at_str}")
                return
            
            now = time.time()
            if now >= fire_at:
                # Already due — fire and delete
                self._fire_event(event_file.name, event_type, text, session_key, wake_mode or "now")
                self._safe_delete(event_file)
            else:
                # Schedule a timer for the exact fire time
                delay = fire_at - now
                self._schedule_oneshot_timer(event_file.name, event_type, text, session_key, wake_mode or "now", delay)
        
        elif event_type == "periodic":
            # Periodic events are handled by cron poll, not by file events
            # Just log that we noticed it
            schedule = event.get("schedule", "")
            logger.debug(f"Periodic event registered: {event_file.name} ({schedule})")
        
        else:
            logger.warning(f"Unknown event type '{event_type}' in {event_file.name}")
    
    def _schedule_oneshot_timer(self, filename: str, event_type: str, text: str, session_key: str, wake_mode: str, delay: float):
        """Schedule a precise timer for a one-shot event."""
        # Cancel existing timer for this file if any
        existing = self._oneshot_timers.pop(filename, None)
        if existing:
            existing.cancel()
        
        logger.info(f"Scheduling one-shot event: {filename} in {int(delay)}s")
        
        def _fire_and_delete():
            self._oneshot_timers.pop(filename, None)
            event_file = EVENTS_DIR / filename
            self._fire_event(filename, event_type, text, session_key, wake_mode)
            self._safe_delete(event_file)
        
        timer = threading.Timer(delay, _fire_and_delete)
        timer.daemon = True
        self._oneshot_timers[filename] = timer
        timer.start()
    
    def _scan_periodic_and_overdue(self):
        """Scan for periodic events that are due (cron check) and overdue one-shots."""
        if not EVENTS_DIR.exists():
            return
        
        now = time.time()
        fired_this_scan = 0
        
        for event_file in sorted(EVENTS_DIR.glob("*.json")):
            if fired_this_scan >= MAX_QUEUED_EVENTS:
                break
            
            try:
                content = event_file.read_text(encoding='utf-8')
                event = json.loads(content)
                event_type = event.get("type", "immediate")
                text = event.get("text", "")
                session_key = event.get("channelId", "main")
                wake_mode = event.get("wake")
                
                if not text:
                    continue
                
                if event_type == "periodic":
                    schedule = event.get("schedule", "")
                    timezone = event.get("timezone")
                    
                    if not schedule or not HAS_CRONITER:
                        continue
                    
                    if self._is_periodic_due(event_file.name, schedule, timezone, now):
                        self._fire_event(event_file.name, event_type, text, session_key, wake_mode or "next-circuits")
                        self._periodic_last_fired[event_file.name] = now
                        fired_this_scan += 1
                
                elif event_type == "one-shot":
                    # Safety net: catch overdue one-shots that watchdog might have missed
                    at_str = event.get("at", "")
                    fire_at = self._parse_iso_timestamp(at_str)
                    if fire_at and now >= fire_at and event_file.name not in self._oneshot_timers:
                        self._fire_event(event_file.name, event_type, text, session_key, wake_mode or "now")
                        self._safe_delete(event_file)
                        fired_this_scan += 1
                
                elif event_type == "immediate" and not HAS_WATCHDOG:
                    # Polling fallback: process immediate events
                    if event_file.stat().st_mtime >= self._start_time:
                        self._fire_event(event_file.name, event_type, text, session_key, wake_mode or "now")
                        self._safe_delete(event_file)
                        fired_this_scan += 1
            
            except Exception as e:
                logger.error(f"Error in cron poll for {event_file.name}: {e}")
    
    def _fire_event(self, filename: str, event_type: str, text: str, session_key: str, wake_mode: str):
        """Fire an event by enqueuing it as a system event."""
        # Format the event text with metadata prefix
        formatted = f"[EVENT:{filename}:{event_type}] {text}"
        
        logger.info(f"Firing event: {formatted[:80]}...")
        self._fired_count += 1
        
        if self._on_system_event:
            self._on_system_event(formatted, session_key)
        
        if wake_mode == "now" and self._on_heartbeat_now:
            self._on_heartbeat_now()
    
    def _is_periodic_due(self, filename: str, schedule: str, timezone: Optional[str], now: float) -> bool:
        """Check if a periodic event is due based on its cron schedule."""
        try:
            tz = None
            if HAS_PYTZ and timezone:
                try:
                    tz = pytz.timezone(timezone)
                except Exception:
                    pass
            
            base_time = datetime.fromtimestamp(now)
            if tz:
                base_time = base_time.astimezone(tz)
            
            cron = croniter(schedule, base_time)
            prev_fire = cron.get_prev(datetime)
            prev_fire_ts = prev_fire.timestamp()
            
            # Check if we already fired for this cron window
            last_fired = self._periodic_last_fired.get(filename, 0)
            
            # Due if the previous cron time is after our last fire
            return prev_fire_ts > last_fired
        
        except Exception as e:
            logger.error(f"Error checking periodic schedule for {filename}: {e}")
            return False
    
    def _parse_iso_timestamp(self, s: str) -> Optional[float]:
        """Parse ISO timestamp string to unix timestamp."""
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.timestamp()
        except Exception:
            return None
    
    def _safe_delete(self, path: Path):
        """Safely delete an event file."""
        try:
            path.unlink()
            logger.info(f"Deleted event file: {path.name}")
        except Exception as e:
            logger.error(f"Failed to delete event file {path.name}: {e}")
    
    def _list_events_internal(self) -> List[Dict[str, Any]]:
        """List all event files with their contents."""
        events = []
        if not EVENTS_DIR.exists():
            return events
        
        for event_file in sorted(EVENTS_DIR.glob("*.json")):
            try:
                content = json.loads(event_file.read_text(encoding='utf-8'))
                events.append({
                    "filename": event_file.name,
                    "type": content.get("type", "immediate"),
                    "text": content.get("text", "")[:100],
                    "at": content.get("at"),
                    "schedule": content.get("schedule"),
                    "lastFired": self._periodic_last_fired.get(event_file.name),
                })
            except Exception:
                events.append({
                    "filename": event_file.name,
                    "error": "invalid JSON",
                })
        
        return events


# ============================================================================
# Global instance
# ============================================================================

_watcher: Optional[EventWatcher] = None
_watcher_lock = threading.Lock()


def get_event_watcher() -> Optional[EventWatcher]:
    """Get the global event watcher."""
    return _watcher


def start_event_watcher(
    on_system_event: Optional[Callable[[str, str], None]] = None,
    on_heartbeat_now: Optional[Callable[[], None]] = None,
) -> EventWatcher:
    """Start the global event watcher."""
    global _watcher
    
    with _watcher_lock:
        if _watcher:
            _watcher.stop()
        
        _watcher = EventWatcher(
            on_system_event=on_system_event,
            on_heartbeat_now=on_heartbeat_now,
        )
        _watcher.start()
        return _watcher


def stop_event_watcher():
    """Stop the global event watcher."""
    global _watcher
    
    with _watcher_lock:
        if _watcher:
            _watcher.stop()
            _watcher = None


def get_event_watcher_status() -> Dict[str, Any]:
    """Get event watcher status."""
    if _watcher:
        return _watcher.get_status()
    return {
        "running": False,
        "message": "Event watcher not initialized",
    }


# ============================================================================
# Convenience: create event files programmatically
# ============================================================================

def create_event_file(
    text: str,
    event_type: str = "immediate",
    at: Optional[str] = None,
    schedule: Optional[str] = None,
    timezone: Optional[str] = None,
    session_key: str = "main",
    wake: Optional[str] = None,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create an event JSON file in data/events/.
    
    Args:
        text: Event text/message for the agent
        event_type: "immediate", "one-shot", or "periodic"
        at: ISO timestamp for one-shot events
        schedule: Cron expression for periodic events
        timezone: IANA timezone for periodic events
        session_key: Session to target (default "main")
        wake: "now" or "next-circuits"
        filename: Optional custom filename (auto-generated if not provided)
    
    Returns:
        Dict with status and filename
    """
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    
    event = {
        "type": event_type,
        "text": text,
        "channelId": session_key,
    }
    
    if wake:
        event["wake"] = wake
    
    if event_type == "one-shot":
        if not at:
            return {"status": "error", "error": "one-shot events require 'at' timestamp"}
        event["at"] = at
    
    elif event_type == "periodic":
        if not schedule:
            return {"status": "error", "error": "periodic events require 'schedule' (cron expression)"}
        event["schedule"] = schedule
        if timezone:
            event["timezone"] = timezone
    
    # Generate filename
    if not filename:
        ts = int(time.time())
        safe_text = "".join(c if c.isalnum() or c in "-_" else "-" for c in text[:30]).strip("-")
        filename = f"{safe_text}-{ts}.json"
    
    if not filename.endswith(".json"):
        filename += ".json"
    
    filepath = EVENTS_DIR / filename
    
    # Don't overwrite existing
    if filepath.exists():
        filename = f"{filepath.stem}-{int(time.time() * 1000) % 10000}{filepath.suffix}"
        filepath = EVENTS_DIR / filename
    
    try:
        filepath.write_text(json.dumps(event, indent=2), encoding='utf-8')
        return {
            "status": "success",
            "filename": filename,
            "path": str(filepath),
            "event": event,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def delete_event_file(filename: str) -> Dict[str, Any]:
    """Delete an event file."""
    filepath = EVENTS_DIR / filename
    if not filepath.exists():
        return {"status": "error", "error": f"Event file not found: {filename}"}
    
    try:
        filepath.unlink()
        return {"status": "success", "message": f"Deleted event: {filename}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def list_event_files() -> Dict[str, Any]:
    """List all event files."""
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    
    events = []
    for event_file in sorted(EVENTS_DIR.glob("*.json")):
        try:
            content = json.loads(event_file.read_text(encoding='utf-8'))
            events.append({
                "filename": event_file.name,
                **content,
            })
        except Exception as e:
            events.append({
                "filename": event_file.name,
                "error": str(e),
            })
    
    return {
        "status": "success",
        "events": events,
        "total": len(events),
        "eventsDir": str(EVENTS_DIR),
    }
