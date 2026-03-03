"""
System Events - Lightweight in-memory queue for agent processing.
Events are session-scoped and ephemeral (not persisted).
Used by cron jobs, external triggers, and other sources to queue
messages for the agent to process on next circuits run.
"""

import time
import logging
from typing import Dict, List, Optional, NamedTuple
from dataclasses import dataclass, field
from threading import Lock

logger = logging.getLogger(__name__)

MAX_EVENTS = 20


@dataclass
class SystemEvent:
    """A system event to be processed by the agent."""
    text: str
    ts: float  # timestamp in seconds
    source: Optional[str] = None  # e.g., "cron", "external", "user"
    
    def to_dict(self) -> Dict:
        return {
            "text": self.text,
            "ts": self.ts,
            "source": self.source,
        }


@dataclass
class SessionQueue:
    """Queue of events for a specific session."""
    queue: List[SystemEvent] = field(default_factory=list)
    last_text: Optional[str] = None  # For deduplication
    last_context_key: Optional[str] = None


class SystemEventManager:
    """Manages system event queues across sessions."""
    
    def __init__(self):
        self._queues: Dict[str, SessionQueue] = {}
        self._lock = Lock()
    
    def _require_session_key(self, key: Optional[str]) -> str:
        """Validate and normalize session key."""
        if not key or not isinstance(key, str):
            raise ValueError("System events require a sessionKey")
        trimmed = key.strip()
        if not trimmed:
            raise ValueError("System events require a non-empty sessionKey")
        return trimmed
    
    def _normalize_context_key(self, key: Optional[str]) -> Optional[str]:
        """Normalize context key for comparison."""
        if not key:
            return None
        trimmed = key.strip()
        return trimmed.lower() if trimmed else None
    
    def enqueue(
        self,
        text: str,
        session_key: str,
        source: Optional[str] = None,
        context_key: Optional[str] = None,
    ) -> bool:
        """
        Enqueue a system event for processing.
        
        Args:
            text: Event text/message
            session_key: Session to queue event for
            source: Optional source identifier
            context_key: Optional context key for deduplication
            
        Returns:
            True if event was queued, False if skipped (duplicate)
        """
        with self._lock:
            key = self._require_session_key(session_key)
            
            # Get or create queue
            if key not in self._queues:
                self._queues[key] = SessionQueue()
            entry = self._queues[key]
            
            # Clean text
            cleaned = text.strip() if text else ""
            if not cleaned:
                return False
            
            # Update context key
            entry.last_context_key = self._normalize_context_key(context_key)
            
            # Skip consecutive duplicates
            if entry.last_text == cleaned:
                return False
            
            entry.last_text = cleaned
            
            # Add event
            event = SystemEvent(
                text=cleaned,
                ts=time.time(),
                source=source,
            )
            entry.queue.append(event)
            
            # Trim if over limit
            if len(entry.queue) > MAX_EVENTS:
                entry.queue.pop(0)
            
            logger.debug(f"Enqueued system event for session '{key}': {cleaned[:50]}...")
            return True
    
    def drain(self, session_key: str) -> List[SystemEvent]:
        """
        Drain all events from a session queue.
        
        Returns events and clears the queue.
        """
        with self._lock:
            key = self._require_session_key(session_key)
            entry = self._queues.get(key)
            
            if not entry or not entry.queue:
                return []
            
            events = entry.queue.copy()
            entry.queue.clear()
            entry.last_text = None
            entry.last_context_key = None
            
            # Remove empty queue
            del self._queues[key]
            
            logger.debug(f"Drained {len(events)} events from session '{key}'")
            return events
    
    def drain_texts(self, session_key: str) -> List[str]:
        """Drain events and return just the text strings."""
        return [e.text for e in self.drain(session_key)]
    
    def peek(self, session_key: str) -> List[str]:
        """Peek at events without draining."""
        with self._lock:
            key = self._require_session_key(session_key)
            entry = self._queues.get(key)
            if not entry:
                return []
            return [e.text for e in entry.queue]
    
    def has_events(self, session_key: str) -> bool:
        """Check if session has pending events."""
        with self._lock:
            key = self._require_session_key(session_key)
            entry = self._queues.get(key)
            return bool(entry and entry.queue)
    
    def is_context_changed(self, session_key: str, context_key: Optional[str]) -> bool:
        """Check if context has changed since last event."""
        with self._lock:
            key = self._require_session_key(session_key)
            entry = self._queues.get(key)
            normalized = self._normalize_context_key(context_key)
            return normalized != (entry.last_context_key if entry else None)
    
    def clear_session(self, session_key: str):
        """Clear all events for a session."""
        with self._lock:
            key = self._require_session_key(session_key)
            if key in self._queues:
                del self._queues[key]
    
    def clear_all(self):
        """Clear all events (for testing)."""
        with self._lock:
            self._queues.clear()
    
    def get_stats(self) -> Dict:
        """Get queue statistics."""
        with self._lock:
            return {
                "sessions": len(self._queues),
                "total_events": sum(len(q.queue) for q in self._queues.values()),
                "session_counts": {k: len(v.queue) for k, v in self._queues.items()},
            }


# Global instance
_manager = SystemEventManager()


# Convenience functions
def enqueue_system_event(
    text: str,
    session_key: str = "main",
    source: Optional[str] = None,
    context_key: Optional[str] = None,
) -> bool:
    """Enqueue a system event for the agent to process."""
    return _manager.enqueue(text, session_key, source, context_key)


def drain_system_events(session_key: str = "main") -> List[str]:
    """Drain all events from a session and return texts."""
    return _manager.drain_texts(session_key)


def peek_system_events(session_key: str = "main") -> List[str]:
    """Peek at pending events without draining."""
    return _manager.peek(session_key)


def has_system_events(session_key: str = "main") -> bool:
    """Check if session has pending events."""
    return _manager.has_events(session_key)


def clear_system_events(session_key: str = "main"):
    """Clear all events for a session."""
    _manager.clear_session(session_key)


def get_event_stats() -> Dict:
    """Get system event statistics."""
    return _manager.get_stats()
