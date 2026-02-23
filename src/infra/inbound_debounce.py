"""
Inbound Message Debouncing - Batch rapid-fire user messages.
When a user sends multiple messages in quick succession (e.g., typing across
multiple sends), this module batches them into a single combined message
before processing. This prevents:
- Wasted LLM calls on partial messages
- Race conditions from concurrent process_message calls
- Duplicate tool executions

Usage:
    debouncer = InboundDebouncer(delay_ms=1500)
    
    # Called for each incoming message
    combined = debouncer.submit(text)
    if combined is None:
        return  # Still collecting, don't process yet
    # combined contains all batched messages joined together
"""

import threading
import time
import logging
from typing import Optional, Callable, List

logger = logging.getLogger(__name__)

DEFAULT_DEBOUNCE_MS = 1200  # 1.2 seconds


class InboundDebouncer:
    """
    Debounces rapid-fire inbound messages into a single combined message.
    
    When submit() is called:
    - If no pending batch: starts a new batch with a timer
    - If batch is pending: appends to batch and resets timer
    - When timer fires: calls the callback with the combined message
    """
    
    def __init__(
        self,
        delay_ms: int = DEFAULT_DEBOUNCE_MS,
        on_ready: Optional[Callable[[str], None]] = None,
    ):
        self._delay_s = delay_ms / 1000.0
        self._on_ready = on_ready
        self._lock = threading.Lock()
        self._pending: List[str] = []
        self._timer: Optional[threading.Timer] = None
        self._result: Optional[str] = None
        self._ready_event = threading.Event()
    
    def submit(self, text: str) -> Optional[str]:
        """
        Submit a message for debouncing.
        
        In synchronous mode (no on_ready callback):
        - First call starts the batch and blocks until timer fires
        - Subsequent calls within the window append and return None immediately
        - The first caller gets the combined result when the timer fires
        
        In async mode (with on_ready callback):
        - Always returns None
        - Callback is called with combined message when timer fires
        """
        if not text or not text.strip():
            return None
        
        with self._lock:
            is_first = len(self._pending) == 0
            self._pending.append(text.strip())
            
            # Reset timer
            if self._timer:
                self._timer.cancel()
            
            self._timer = threading.Timer(self._delay_s, self._flush)
            self._timer.daemon = True
            self._timer.start()
            
            if len(self._pending) > 1:
                logger.info(f"[DEBOUNCE] Batched message #{len(self._pending)}: {text[:50]}...")
        
        # If using callback mode, always return None
        if self._on_ready:
            return None
        
        # Synchronous mode: first caller blocks, others return None
        if is_first:
            self._ready_event.clear()
            self._ready_event.wait(timeout=self._delay_s + 2.0)
            
            with self._lock:
                result = self._result
                self._result = None
                return result
        else:
            # Not the first caller — the first caller will get the combined result
            return None
    
    def _flush(self):
        """Timer fired — combine and deliver."""
        with self._lock:
            if not self._pending:
                return
            
            combined = "\n".join(self._pending)
            count = len(self._pending)
            self._pending.clear()
            self._timer = None
        
        if count > 1:
            logger.info(f"[DEBOUNCE] Flushed {count} messages into one ({len(combined)} chars)")
        
        if self._on_ready:
            try:
                self._on_ready(combined)
            except Exception as e:
                logger.error(f"[DEBOUNCE] Callback error: {e}")
        else:
            # Synchronous mode: store result and signal
            with self._lock:
                self._result = combined
            self._ready_event.set()
    
    def flush_now(self) -> Optional[str]:
        """Force-flush any pending messages immediately."""
        with self._lock:
            if self._timer:
                self._timer.cancel()
                self._timer = None
            
            if not self._pending:
                return None
            
            combined = "\n".join(self._pending)
            count = len(self._pending)
            self._pending.clear()
        
        if count > 1:
            logger.info(f"[DEBOUNCE] Force-flushed {count} messages")
        
        return combined
    
    @property
    def has_pending(self) -> bool:
        """Check if there are pending messages."""
        with self._lock:
            return len(self._pending) > 0
    
    @property
    def pending_count(self) -> int:
        """Number of pending messages."""
        with self._lock:
            return len(self._pending)
