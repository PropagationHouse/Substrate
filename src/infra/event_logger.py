"""
Event Logger — Append-only JSONL event logging to data/events/.

Subscribes to the event bus and persists all events as structured JSONL files,
one file per day. Enables usage analytics, debugging, and dashboard insights.

Files: data/events/YYYY-MM-DD.jsonl
Format: {"ts": 1234567890.123, "event": "tool_invoked", "data": {...}}

Usage:
    from src.infra.event_logger import init_event_logger

    init_event_logger()  # Call once at startup — auto-subscribes to bus
"""

import json
import time
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SOMA = Path(__file__).parent.parent.parent
EVENTS_DIR = SOMA / "data" / "events"

# Events worth persisting (skip noisy internal events)
LOGGED_EVENTS = {
    'tool_invoked', 'tool_completed', 'tool_failed',
    'chat_started', 'chat_completed',
    'state_changed',
    'subagent_spawned', 'subagent_completed',
    'cost_updated',
    'circuits_run',
    'skill_loaded', 'skill_reloaded',
    'error',
    'message_queued', 'message_dequeued',
}

_write_lock = threading.Lock()
_initialized = False


def _get_log_path() -> Path:
    """Get today's JSONL log file path."""
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    return EVENTS_DIR / f"{datetime.now().strftime('%Y-%m-%d')}.jsonl"


def _write_event(event: str, data: Dict[str, Any]):
    """Append a single event to today's log file."""
    record = {
        'ts': data.get('_ts', time.time()),
        'event': event,
        'data': {k: v for k, v in data.items() if not k.startswith('_')},
    }

    try:
        line = json.dumps(record, default=str, ensure_ascii=False) + '\n'
        with _write_lock:
            with open(_get_log_path(), 'a', encoding='utf-8') as f:
                f.write(line)
    except Exception as e:
        logger.debug(f"[EVENT_LOG] Write error: {e}")


def _bus_handler(data: Dict[str, Any]):
    """Event bus subscriber — logs matching events."""
    event = data.get('_event', '')
    if event in LOGGED_EVENTS:
        _write_event(event, data)


def init_event_logger():
    """Initialize the event logger — subscribe to the event bus."""
    global _initialized
    if _initialized:
        return

    try:
        from src.infra.event_bus import bus
        # Subscribe to all events via wildcard
        bus.on('*', _bus_handler, async_handler=True, source='event_logger')
        _initialized = True
        logger.info("[EVENT_LOG] Event logger initialized, writing to data/events/")
    except Exception as e:
        logger.warning(f"[EVENT_LOG] Failed to initialize: {e}")


def read_events(
    date: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Read events from log files.
    
    Args:
        date: Date string 'YYYY-MM-DD' (default: today)
        event_type: Filter by event type
        limit: Max events to return
        offset: Skip first N matching events
    """
    if date is None:
        date = datetime.now().strftime('%Y-%m-%d')

    log_path = EVENTS_DIR / f"{date}.jsonl"
    if not log_path.exists():
        return []

    events = []
    skipped = 0
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if event_type and record.get('event') != event_type:
                        continue
                    if skipped < offset:
                        skipped += 1
                        continue
                    events.append(record)
                    if len(events) >= limit:
                        break
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.warning(f"[EVENT_LOG] Read error for {date}: {e}")

    return events


def get_event_summary(date: Optional[str] = None) -> Dict[str, Any]:
    """Get a summary of events for a given date."""
    if date is None:
        date = datetime.now().strftime('%Y-%m-%d')

    log_path = EVENTS_DIR / f"{date}.jsonl"
    if not log_path.exists():
        return {'date': date, 'totalEvents': 0, 'byType': {}}

    by_type: Dict[str, int] = {}
    total = 0

    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    event = record.get('event', 'unknown')
                    by_type[event] = by_type.get(event, 0) + 1
                    total += 1
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    return {
        'date': date,
        'totalEvents': total,
        'byType': by_type,
    }


def list_event_dates() -> List[str]:
    """List all dates that have event logs."""
    if not EVENTS_DIR.exists():
        return []
    dates = []
    for f in sorted(EVENTS_DIR.glob('*.jsonl')):
        dates.append(f.stem)  # 'YYYY-MM-DD'
    return dates
