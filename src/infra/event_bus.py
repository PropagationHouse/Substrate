"""
Event Bus — Lightweight publish/subscribe for Substrate internals.

Allows modules to react to agent lifecycle events without tight coupling.
Events are fire-and-forget; handlers run synchronously in the caller's thread
unless async=True is specified (then they run in a daemon thread).

Usage:
    from src.infra.event_bus import bus

    # Subscribe
    bus.on('tool_invoked', lambda data: print(f"Tool: {data['name']}"))

    # Publish
    bus.emit('tool_invoked', {'name': 'web_search', 'args': {...}})

Built-in events:
    tool_invoked       {name, args, session_key}
    tool_completed     {name, result_preview, duration_ms, session_key}
    tool_failed        {name, error, session_key}
    chat_started       {user_message, session_key, run_id}
    chat_completed     {user_message, response_preview, duration_ms, session_key, run_id}
    state_changed      {old_state, new_state, timestamp}
    subagent_spawned   {task_id, name, parent_session}
    subagent_completed {task_id, name, success, duration_ms}
    cost_updated       {input_tokens, output_tokens, cost_usd, session_key}
    circuits_run       {task_count, duration_ms}
    skill_loaded       {skill_name, path}
    skill_reloaded     {skill_name, path}
    error              {source, message, traceback}
"""

import time
import logging
import threading
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class _Subscription:
    event: str
    handler: Callable[[Dict[str, Any]], None]
    async_handler: bool = False
    once: bool = False
    source: str = ""  # Who registered this handler (for debugging)


class EventBus:
    """Thread-safe publish/subscribe event bus."""

    def __init__(self):
        self._subs: Dict[str, List[_Subscription]] = {}
        self._lock = threading.Lock()
        self._history: List[Dict[str, Any]] = []  # Last N events for debugging
        self._history_max = 200
        self._emit_count = 0

    def on(
        self,
        event: str,
        handler: Callable[[Dict[str, Any]], None],
        async_handler: bool = False,
        source: str = "",
    ) -> Callable:
        """Subscribe to an event. Returns the handler for later removal."""
        sub = _Subscription(
            event=event,
            handler=handler,
            async_handler=async_handler,
            source=source,
        )
        with self._lock:
            if event not in self._subs:
                self._subs[event] = []
            self._subs[event].append(sub)
        return handler

    def once(
        self,
        event: str,
        handler: Callable[[Dict[str, Any]], None],
        async_handler: bool = False,
    ) -> Callable:
        """Subscribe to an event, but only fire once."""
        sub = _Subscription(
            event=event,
            handler=handler,
            async_handler=async_handler,
            once=True,
        )
        with self._lock:
            if event not in self._subs:
                self._subs[event] = []
            self._subs[event].append(sub)
        return handler

    def off(self, event: str, handler: Callable) -> bool:
        """Unsubscribe a handler. Returns True if found."""
        with self._lock:
            subs = self._subs.get(event, [])
            for i, sub in enumerate(subs):
                if sub.handler is handler:
                    subs.pop(i)
                    return True
        return False

    def emit(self, event: str, data: Optional[Dict[str, Any]] = None):
        """
        Publish an event to all subscribers.
        
        Sync handlers run in the caller's thread.
        Async handlers run in daemon threads.
        Exceptions in handlers are caught and logged.
        """
        data = data or {}
        data.setdefault('_event', event)
        data.setdefault('_ts', time.time())

        self._emit_count += 1

        # Record in history
        with self._lock:
            self._history.append({
                'event': event,
                'ts': data['_ts'],
                'keys': list(k for k in data.keys() if not k.startswith('_')),
            })
            if len(self._history) > self._history_max:
                self._history = self._history[-self._history_max:]

        # Snapshot subscribers (avoid holding lock during execution)
        with self._lock:
            subs = list(self._subs.get(event, []))
            # Also notify wildcard subscribers
            subs.extend(self._subs.get('*', []))

        to_remove = []
        for sub in subs:
            try:
                if sub.async_handler:
                    t = threading.Thread(
                        target=self._safe_call,
                        args=(sub.handler, data, event),
                        daemon=True,
                    )
                    t.start()
                else:
                    self._safe_call(sub.handler, data, event)
            except Exception:
                pass  # _safe_call handles logging

            if sub.once:
                to_remove.append(sub)

        # Remove once-handlers
        if to_remove:
            with self._lock:
                for sub in to_remove:
                    subs_list = self._subs.get(sub.event, [])
                    if sub in subs_list:
                        subs_list.remove(sub)

    @staticmethod
    def _safe_call(handler, data, event):
        try:
            handler(data)
        except Exception as e:
            logger.error(f"[EVENT_BUS] Handler error for '{event}': {e}")

    def get_stats(self) -> Dict[str, Any]:
        """Return bus statistics."""
        with self._lock:
            return {
                'totalSubscriptions': sum(len(v) for v in self._subs.values()),
                'eventTypes': list(self._subs.keys()),
                'totalEmits': self._emit_count,
                'recentEvents': self._history[-20:],
            }

    def get_recent_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Return recent event history."""
        with self._lock:
            return list(self._history[-limit:])


# Global singleton
bus = EventBus()
