"""
Circuits Runner - Background periodic agent execution.
The circuits system runs the agent periodically to:
- Process queued system events
- Check for scheduled tasks
- Perform autonomous background work

Features:
- Configurable interval
- Active hours support
- Wake-on-demand
- Integration with system events and cron
"""

import re
import time
import logging
import threading
from typing import Dict, Any, Optional, Callable, List
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# Defaults
DEFAULT_CIRCUITS_INTERVAL = 30 * 60  # 30 minutes
DEFAULT_ACK_MAX_CHARS = 300
DEFAULT_CIRCUITS_PROMPT = (
    "Read CIRCUITS.md if it exists (workspace context). Follow it strictly. "
    "Do not infer or repeat old tasks from prior chats. "
    "If nothing needs attention, respond with exactly [SILENT]."
)
DUPLICATE_SUPPRESS_WINDOW_S = 24 * 60 * 60  # 24 hours


@dataclass
class CircuitsConfig:
    """Configuration for circuits runner."""
    enabled: bool = True
    interval_seconds: int = DEFAULT_CIRCUITS_INTERVAL
    prompt: str = DEFAULT_CIRCUITS_PROMPT
    ack_max_chars: int = DEFAULT_ACK_MAX_CHARS
    active_hours_start: Optional[str] = None  # "09:00"
    active_hours_end: Optional[str] = None    # "22:00"
    active_hours_timezone: Optional[str] = None
    model_override: Optional[str] = None
    skip_if_empty: bool = True  # Skip circuits if CIRCUITS.md has no actionable content
    suppress_duplicates: bool = True  # Suppress identical output within 24h window
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "intervalSeconds": self.interval_seconds,
            "prompt": self.prompt,
            "ackMaxChars": self.ack_max_chars,
            "activeHoursStart": self.active_hours_start,
            "activeHoursEnd": self.active_hours_end,
            "activeHoursTimezone": self.active_hours_timezone,
            "modelOverride": self.model_override,
            "skipIfEmpty": self.skip_if_empty,
            "suppressDuplicates": self.suppress_duplicates,
        }


@dataclass
class CircuitsResult:
    """Result of a circuits run."""
    success: bool
    response: Optional[str] = None
    events_processed: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
    skipped_reason: Optional[str] = None
    silent: bool = False  # True if agent responded with [SILENT]


class CircuitsRunner:
    """
    Background runner that periodically triggers agent execution.
    
    The circuits runner:
    1. Checks for pending system events
    2. Runs the agent with circuits prompt + events
    3. Processes any agent actions
    4. Schedules next circuits run
    """
    
    def __init__(
        self,
        config: Optional[CircuitsConfig] = None,
        on_run: Optional[Callable[[str, List[str]], CircuitsResult]] = None,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
        is_busy: Optional[Callable[[], bool]] = None,
    ):
        self.config = config or CircuitsConfig()
        self._on_run = on_run  # Callback to actually run the agent
        self._on_event = on_event  # Callback for circuits events
        self._is_busy = is_busy  # Callback: True if user request in-flight
        
        self._running = False
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()
        self._wake_event = threading.Event()
        self._last_run_ms: Optional[int] = None
        self._next_due_ms: Optional[int] = None
        self._run_count = 0
        self._session_key = "main"
        
        # Duplicate suppression state
        self._last_circuits_text: Optional[str] = None
        self._last_circuits_sent_at: Optional[float] = None
    
    def start(self, session_key: str = "main"):
        """Start the circuits runner."""
        with self._lock:
            if self._running:
                return
            
            self._session_key = session_key
            self._running = True
            self._schedule_next()
            
            logger.info(f"Circuits started (interval: {self.config.interval_seconds}s)")
            self._emit_event("started", {
                "intervalSeconds": self.config.interval_seconds,
            })
    
    def stop(self):
        """Stop the circuits runner."""
        with self._lock:
            self._running = False
            if self._timer:
                self._timer.cancel()
                self._timer = None
            self._wake_event.set()  # Unblock any waiting
            
            logger.info("Circuits stopped")
            self._emit_event("stopped", {})
    
    def wake_now(self, reason: Optional[str] = None):
        """Trigger immediate circuits run."""
        logger.info(f"Circuits wake requested: {reason or 'manual'}")
        self._wake_event.set()
        
        # Also reschedule timer to run now
        with self._lock:
            if self._timer:
                self._timer.cancel()
            if self._running:
                self._timer = threading.Timer(0.1, self._on_timer)
                self._timer.daemon = True
                self._timer.start()
    
    def update_config(self, config: CircuitsConfig):
        """Update configuration."""
        with self._lock:
            self.config = config
            if self._running:
                self._schedule_next()
    
    def get_status(self) -> Dict[str, Any]:
        """Get circuits status."""
        with self._lock:
            now_ms = int(time.time() * 1000)
            return {
                "enabled": self.config.enabled,
                "running": self._running,
                "intervalSeconds": self.config.interval_seconds,
                "lastRunMs": self._last_run_ms,
                "nextDueMs": self._next_due_ms,
                "nextDueIn": f"{(self._next_due_ms - now_ms) // 1000}s" if self._next_due_ms else None,
                "runCount": self._run_count,
                "sessionKey": self._session_key,
            }
    
    def _schedule_next(self):
        """Schedule next circuits run."""
        if self._timer:
            self._timer.cancel()
        
        if not self._running or not self.config.enabled:
            return
        
        now_ms = int(time.time() * 1000)
        interval_ms = self.config.interval_seconds * 1000
        self._next_due_ms = now_ms + interval_ms
        
        self._timer = threading.Timer(self.config.interval_seconds, self._on_timer)
        self._timer.daemon = True
        self._timer.start()
        
        logger.debug(f"Next circuits run in {self.config.interval_seconds}s")
    
    def _on_timer(self):
        """Timer callback - run circuits."""
        self._wake_event.clear()
        
        with self._lock:
            if not self._running:
                return
        
        # Check active hours
        if not self._is_within_active_hours():
            logger.debug("Outside active hours, skipping circuits")
            self._emit_event("skipped", {"reason": "outside_active_hours"})
            self._schedule_next()
            return
        
        # Check requests-in-flight
        if self._is_busy and self._is_busy():
            logger.debug("Requests in-flight, skipping circuits")
            self._emit_event("skipped", {"reason": "requests_in_flight"})
            self._schedule_next()
            return
        
        # Run circuits
        result = self._run_circuits()
        
        # Schedule next
        with self._lock:
            if self._running:
                self._schedule_next()
    
    def _run_circuits(self) -> CircuitsResult:
        """Execute a circuits run."""
        from .system_events import drain_system_events, has_system_events
        
        start_ms = int(time.time() * 1000)
        self._last_run_ms = start_ms
        self._run_count += 1
        
        logger.info(f"Running circuits #{self._run_count}")
        self._emit_event("running", {"runCount": self._run_count})
        
        try:
            # Get pending events
            events = drain_system_events(self._session_key)
            
            # Read CIRCUITS.md for dynamic tasks
            circuits_tasks = self._read_circuits_file()
            circuits_content = self._read_circuits_file_raw()
            
            # Empty-file skip: if CIRCUITS.md has no actionable
            # content AND there are no system events, skip entirely to save API calls.
            if self.config.skip_if_empty and not events:
                if self._is_circuits_content_empty(circuits_content):
                    logger.info(f"Circuits #{self._run_count} skipped: empty CIRCUITS.md, no events")
                    self._emit_event("skipped", {
                        "reason": "empty_circuits_file",
                        "durationMs": int(time.time() * 1000) - start_ms,
                    })
                    return CircuitsResult(
                        success=True,
                        skipped_reason="empty_circuits_file",
                        silent=True,
                        duration_ms=int(time.time() * 1000) - start_ms,
                    )
            
            # Build prompt with current time for temporal awareness
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S %Z").strip()
            prompt = f"CURRENT TIME: {now_str}\n\n{self.config.prompt}"
            
            # Prepend CIRCUITS.md tasks if any
            if circuits_tasks:
                tasks_text = "\n".join(f"- {t}" for t in circuits_tasks)
                prompt = f"""CIRCUITS TASKS (from CIRCUITS.md):
{tasks_text}

{prompt}"""
            
            if events:
                events_text = "\n".join(f"- {e}" for e in events)
                prompt = f"""SYSTEM EVENTS TO PROCESS:
{events_text}

{prompt}"""
            
            # Run agent
            if self._on_run:
                result = self._on_run(prompt, events)
            else:
                # No callback, just acknowledge
                result = CircuitsResult(
                    success=True,
                    response="CIRCUITS_OK (no agent callback)",
                    events_processed=len(events),
                )
            
            end_ms = int(time.time() * 1000)
            result.duration_ms = end_ms - start_ms
            result.events_processed = len(events)
            
            # Detect [SILENT] response — suppress frontend output
            response_text = (result.response or "").strip()
            if response_text.startswith("[SILENT]") or response_text == "CIRCUITS_OK":
                result.silent = True
                logger.info(f"Circuits #{self._run_count} silent ({result.duration_ms}ms)")
            else:
                # Duplicate suppression: if the agent produces
                # the same output as last circuits run within 24h, suppress it.
                if self.config.suppress_duplicates and self._is_duplicate_output(response_text):
                    result.silent = True
                    logger.info(f"Circuits #{self._run_count} suppressed: duplicate output ({result.duration_ms}ms)")
                    self._emit_event("skipped", {
                        "reason": "duplicate",
                        "preview": response_text[:200],
                        "durationMs": result.duration_ms,
                    })
                else:
                    # Record this output for future dedup
                    self._last_circuits_text = response_text
                    self._last_circuits_sent_at = time.time()
                    logger.info(f"Circuits completed in {result.duration_ms}ms, processed {len(events)} events")
            
            self._emit_event("completed", {
                "durationMs": result.duration_ms,
                "eventsProcessed": len(events),
                "silent": result.silent,
                "response": (result.response or "")[:self.config.ack_max_chars] if not result.silent else "[SILENT]",
            })
            
            return result
            
        except Exception as e:
            logger.error(f"Circuits error: {e}")
            self._emit_event("error", {"error": str(e)})
            return CircuitsResult(
                success=False,
                error=str(e),
                duration_ms=int(time.time() * 1000) - start_ms,
            )
    
    def _is_within_active_hours(self) -> bool:
        """Check if current time is within active hours."""
        if not self.config.active_hours_start or not self.config.active_hours_end:
            return True
        
        try:
            import pytz
            
            # Get timezone
            tz = None
            if self.config.active_hours_timezone:
                try:
                    tz = pytz.timezone(self.config.active_hours_timezone)
                except:
                    pass
            
            # Get current time
            now = datetime.now(tz) if tz else datetime.now()
            current_minutes = now.hour * 60 + now.minute
            
            # Parse start/end
            start_parts = self.config.active_hours_start.split(":")
            end_parts = self.config.active_hours_end.split(":")
            
            start_minutes = int(start_parts[0]) * 60 + int(start_parts[1])
            end_minutes = int(end_parts[0]) * 60 + int(end_parts[1])
            
            # Check if within range
            if end_minutes > start_minutes:
                return start_minutes <= current_minutes < end_minutes
            else:
                # Wraps around midnight
                return current_minutes >= start_minutes or current_minutes < end_minutes
                
        except Exception as e:
            logger.warning(f"Error checking active hours: {e}")
            return True
    
    def _get_circuits_path(self) -> Path:
        """Resolve CIRCUITS.md path (in soma / project root)."""
        soma = Path(__file__).parent.parent.parent
        return soma / "CIRCUITS.md"
    
    def _read_circuits_file_raw(self) -> Optional[str]:
        """Read raw CIRCUITS.md content. Returns None if file doesn't exist."""
        try:
            p = self._get_circuits_path()
            if not p.exists():
                return None
            return p.read_text(encoding='utf-8')
        except Exception as e:
            logger.warning(f"Error reading CIRCUITS.md: {e}")
            return None
    
    @staticmethod
    def _is_circuits_content_empty(content: Optional[str]) -> bool:
        """Check if CIRCUITS.md has no actionable content.
        
        A file is effectively empty if it contains only:
        - Whitespace
        - Markdown header lines (# ...)
        - Empty list items (- [ ])
        
        A missing file returns False so the LLM can still decide what to do.
        """
        if content is None:
            return False
        for line in content.split('\n'):
            trimmed = line.strip()
            if not trimmed:
                continue
            # Skip markdown headers (ATX: # followed by space or EOL)
            if re.match(r'^#+(?:\s|$)', trimmed):
                continue
            # Skip empty list items like "- [ ]" or "* [ ]" or just "- "
            if re.match(r'^[-*+]\s*(?:\[[\sXx]?\]\s*)?$', trimmed):
                continue
            # Found actionable content
            return False
        return True
    
    def _read_circuits_file(self) -> List[str]:
        """Read CIRCUITS.md for dynamic tasks.
        
        Parses uncommented task lines under '## Active Tasks'.
        Returns list of task strings.
        """
        try:
            content = self._read_circuits_file_raw()
            if content is None:
                return []
            
            # Remove HTML comments
            clean = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
            
            tasks = []
            in_active = False
            for line in clean.split('\n'):
                stripped = line.strip()
                if stripped.startswith('## Active Tasks'):
                    in_active = True
                    continue
                elif stripped.startswith('## '):
                    in_active = False
                    continue
                if in_active and stripped.startswith('- '):
                    task_text = stripped[2:].strip()
                    if task_text:
                        tasks.append(task_text)
            
            if tasks:
                logger.info(f"CIRCUITS.md: Found {len(tasks)} active tasks")
            return tasks
            
        except Exception as e:
            logger.warning(f"Error reading CIRCUITS.md: {e}")
            return []
    
    def _is_duplicate_output(self, text: str) -> bool:
        """Check if output matches last circuits run within suppression window."""
        if not self._last_circuits_text or not self._last_circuits_sent_at:
            return False
        if text.strip() != self._last_circuits_text.strip():
            return False
        elapsed = time.time() - self._last_circuits_sent_at
        return elapsed < DUPLICATE_SUPPRESS_WINDOW_S
    
    def _emit_event(self, action: str, data: Dict[str, Any]):
        """Emit a circuits event."""
        if self._on_event:
            try:
                self._on_event({
                    "action": action,
                    "ts": int(time.time() * 1000),
                    **data,
                })
            except Exception as e:
                logger.error(f"Error emitting circuits event: {e}")


# Global instance
_circuits: Optional[CircuitsRunner] = None
_circuits_lock = threading.Lock()


def get_circuits() -> Optional[CircuitsRunner]:
    """Get the global circuits runner."""
    return _circuits


def start_circuits(
    config: Optional[CircuitsConfig] = None,
    on_run: Optional[Callable[[str, List[str]], CircuitsResult]] = None,
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
    is_busy: Optional[Callable[[], bool]] = None,
    session_key: str = "main",
) -> CircuitsRunner:
    """Start the global circuits runner."""
    global _circuits
    
    with _circuits_lock:
        if _circuits:
            _circuits.stop()
        
        _circuits = CircuitsRunner(
            config=config,
            on_run=on_run,
            on_event=on_event,
            is_busy=is_busy,
        )
        _circuits.start(session_key)
        
        return _circuits


def stop_circuits():
    """Stop the global circuits runner."""
    global _circuits
    
    with _circuits_lock:
        if _circuits:
            _circuits.stop()
            _circuits = None


def request_circuits_now(reason: Optional[str] = None):
    """Request immediate circuits execution."""
    if _circuits:
        _circuits.wake_now(reason)


def get_circuits_status() -> Dict[str, Any]:
    """Get circuits status."""
    if _circuits:
        return _circuits.get_status()
    return {
        "enabled": False,
        "running": False,
        "message": "Circuits not initialized",
    }


# Backward compatibility aliases
DEFAULT_HEARTBEAT_INTERVAL = DEFAULT_CIRCUITS_INTERVAL
DEFAULT_HEARTBEAT_PROMPT = DEFAULT_CIRCUITS_PROMPT
HeartbeatConfig = CircuitsConfig
HeartbeatResult = CircuitsResult
HeartbeatRunner = CircuitsRunner
get_heartbeat = get_circuits
start_heartbeat = start_circuits
stop_heartbeat = stop_circuits
request_heartbeat_now = request_circuits_now
get_heartbeat_status = get_circuits_status
