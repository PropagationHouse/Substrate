"""
Skill Watcher — Hot-reload watcher for the skills/ directory.

Monitors the skills directory for .md file changes (create, modify, delete)
and invalidates the skills cache so the agent always uses the latest versions.
Emits event bus notifications for skill_loaded/skill_reloaded events.

Uses watchdog for real-time filesystem monitoring with a polling fallback.

Usage:
    from src.infra.skill_watcher import start_skill_watcher

    start_skill_watcher()  # Call once at startup
"""

import time
import logging
import threading
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

SOMA = Path(__file__).parent.parent.parent
SKILLS_DIR = SOMA / "skills"

# Try to import watchdog for real-time fs watching
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False
    class FileSystemEventHandler:
        pass

DEBOUNCE_MS = 300  # Debounce rapid file events


class _SkillFileHandler(FileSystemEventHandler):
    """Watchdog handler for skill file changes."""

    def __init__(self, watcher: 'SkillWatcher'):
        super().__init__()
        self._watcher = watcher
        self._debounce_timers: Dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            self._debounce(event.src_path, 'created')

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            self._debounce(event.src_path, 'modified')

    def on_deleted(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            self._debounce(event.src_path, 'deleted')

    def _debounce(self, path: str, change_type: str):
        """Debounce rapid file events."""
        filename = Path(path).name
        with self._lock:
            existing = self._debounce_timers.get(filename)
            if existing:
                existing.cancel()
            timer = threading.Timer(
                DEBOUNCE_MS / 1000.0,
                self._fire,
                args=[path, change_type],
            )
            timer.daemon = True
            self._debounce_timers[filename] = timer
            timer.start()

    def _fire(self, path: str, change_type: str):
        """Process a file change after debounce."""
        filename = Path(path).name
        with self._lock:
            self._debounce_timers.pop(filename, None)
        try:
            self._watcher._handle_change(Path(path), change_type)
        except Exception as e:
            logger.error(f"[SKILL_WATCHER] Error handling {filename}: {e}")


class SkillWatcher:
    """
    Watches skills/ directory for .md file changes.

    On change:
    1. Invalidates the skills_tool cache
    2. Emits skill_loaded/skill_reloaded events on the event bus
    3. Logs the change
    """

    def __init__(self, skills_dir: Optional[Path] = None):
        self._skills_dir = skills_dir or SKILLS_DIR
        self._observer = None
        self._poll_timer: Optional[threading.Timer] = None
        self._running = False
        self._lock = threading.Lock()
        self._known_files: Dict[str, float] = {}  # filename -> mtime
        self._change_count = 0
        self._start_time = 0.0

    def start(self):
        """Start watching the skills directory."""
        with self._lock:
            if self._running:
                return
            self._running = True
            self._start_time = time.time()

        self._skills_dir.mkdir(parents=True, exist_ok=True)

        # Snapshot current files
        self._snapshot_files()

        if HAS_WATCHDOG:
            handler = _SkillFileHandler(self)
            self._observer = Observer()
            self._observer.schedule(handler, str(self._skills_dir), recursive=False)
            self._observer.daemon = True
            self._observer.start()
            logger.info(f"[SKILL_WATCHER] Started (watchdog, dir: {self._skills_dir})")
        else:
            # Polling fallback every 5 seconds
            logger.info(f"[SKILL_WATCHER] Started (polling, dir: {self._skills_dir})")
            self._schedule_poll()

    def stop(self):
        """Stop watching."""
        with self._lock:
            self._running = False

        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

        if self._poll_timer:
            self._poll_timer.cancel()
            self._poll_timer = None

        logger.info("[SKILL_WATCHER] Stopped")

    def get_status(self) -> Dict[str, Any]:
        """Get watcher status."""
        with self._lock:
            return {
                'running': self._running,
                'mode': 'watchdog' if HAS_WATCHDOG else 'polling',
                'skillsDir': str(self._skills_dir),
                'trackedFiles': len(self._known_files),
                'changeCount': self._change_count,
                'files': list(self._known_files.keys()),
            }

    def _snapshot_files(self):
        """Take a snapshot of current skill files."""
        self._known_files = {}
        if self._skills_dir.exists():
            for f in self._skills_dir.glob('*.md'):
                try:
                    self._known_files[f.name] = f.stat().st_mtime
                except Exception:
                    pass

    def _schedule_poll(self):
        """Schedule next poll (fallback when watchdog unavailable)."""
        if self._poll_timer:
            self._poll_timer.cancel()
        with self._lock:
            if not self._running:
                return
        self._poll_timer = threading.Timer(5.0, self._poll)
        self._poll_timer.daemon = True
        self._poll_timer.start()

    def _poll(self):
        """Poll for changes (fallback)."""
        with self._lock:
            if not self._running:
                return
        try:
            if not self._skills_dir.exists():
                self._schedule_poll()
                return

            current = {}
            for f in self._skills_dir.glob('*.md'):
                try:
                    current[f.name] = f.stat().st_mtime
                except Exception:
                    pass

            # Detect new/modified files
            for name, mtime in current.items():
                if name not in self._known_files:
                    self._handle_change(self._skills_dir / name, 'created')
                elif mtime > self._known_files[name]:
                    self._handle_change(self._skills_dir / name, 'modified')

            # Detect deleted files
            for name in set(self._known_files) - set(current):
                self._handle_change(self._skills_dir / name, 'deleted')

            self._known_files = current
        except Exception as e:
            logger.error(f"[SKILL_WATCHER] Poll error: {e}")

        self._schedule_poll()

    def _handle_change(self, path: Path, change_type: str):
        """Handle a skill file change."""
        filename = path.name
        skill_name = path.stem
        self._change_count += 1

        logger.info(f"[SKILL_WATCHER] Skill {change_type}: {filename}")

        # Invalidate skills cache
        try:
            from src.tools.skills_tool import _skills_cache
            import src.tools.skills_tool as _st
            _st._skills_cache = {}
            _st._cache_time = 0
        except Exception:
            pass

        # Update known files snapshot
        if change_type == 'deleted':
            self._known_files.pop(filename, None)
        else:
            try:
                self._known_files[filename] = path.stat().st_mtime
            except Exception:
                pass

        # Emit event bus notification
        try:
            from src.infra.event_bus import bus
            if change_type == 'created':
                bus.emit('skill_loaded', {
                    'skill_name': skill_name,
                    'path': str(path),
                })
            elif change_type == 'modified':
                bus.emit('skill_reloaded', {
                    'skill_name': skill_name,
                    'path': str(path),
                })
            elif change_type == 'deleted':
                bus.emit('skill_unloaded', {
                    'skill_name': skill_name,
                    'path': str(path),
                })
        except Exception:
            pass


# ── Global instance ──────────────────────────────────────────────────

_watcher: Optional[SkillWatcher] = None
_watcher_lock = threading.Lock()


def start_skill_watcher(skills_dir: Optional[Path] = None) -> SkillWatcher:
    """Start the global skill watcher."""
    global _watcher
    with _watcher_lock:
        if _watcher:
            _watcher.stop()
        _watcher = SkillWatcher(skills_dir=skills_dir)
        _watcher.start()
        return _watcher


def stop_skill_watcher():
    """Stop the global skill watcher."""
    global _watcher
    with _watcher_lock:
        if _watcher:
            _watcher.stop()
            _watcher = None


def get_skill_watcher() -> Optional[SkillWatcher]:
    """Get the global skill watcher."""
    return _watcher


def get_skill_watcher_status() -> Dict[str, Any]:
    """Get skill watcher status."""
    if _watcher:
        return _watcher.get_status()
    return {'running': False, 'message': 'Skill watcher not initialized'}
