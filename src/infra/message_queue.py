"""
Message Queue — Queue consecutive user messages while the agent is busy.

When the agent is processing a request and the user sends another message,
it gets queued instead of dropped or causing a race condition. The queue
drains automatically: after the current request completes, the next queued
message is dispatched.

Usage:
    from src.infra.message_queue import get_message_queue

    mq = get_message_queue()
    mq.enqueue("do something", run_id="abc123", client=client)
    # If agent is idle, processes immediately.
    # If agent is busy, queues and processes when current finishes.
"""

import time
import logging
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class QueuedMessage:
    """A message waiting to be processed."""
    id: str
    text: str
    run_id: str
    enqueued_at: float = field(default_factory=time.time)
    session_key: str = "main"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'text': self.text[:200] + ('...' if len(self.text) > 200 else ''),
            'runId': self.run_id,
            'enqueuedAt': self.enqueued_at,
            'sessionKey': self.session_key,
            'waitingSeconds': round(time.time() - self.enqueued_at, 1),
        }


class MessageQueue:
    """
    Thread-safe message queue with automatic drain.
    
    - Only one message processes at a time
    - Additional messages are queued in FIFO order
    - After current processing completes, next message auto-dispatches
    - Dashboard can see queue state via get_status()
    """

    def __init__(self, max_queue_size: int = 20):
        self._queue: deque[QueuedMessage] = deque()
        self._lock = threading.Lock()
        self._processing = False
        self._current: Optional[QueuedMessage] = None
        self._executor: Optional[Callable] = None
        self._max_queue_size = max_queue_size
        self._total_processed = 0
        self._total_queued = 0

    def set_executor(self, executor: Callable[[QueuedMessage], None]):
        """Set the function that processes messages.
        
        The executor receives a QueuedMessage and should:
        1. Send thinking/streaming/done events via send_message_to_frontend
        2. Call message_queue.on_complete() when done
        """
        self._executor = executor

    def enqueue(
        self,
        text: str,
        run_id: Optional[str] = None,
        session_key: str = "main",
        metadata: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Enqueue a message. If agent is idle, processes immediately.
        
        Returns: {'status': 'processing'|'queued', 'runId': str, 'position': int}
        """
        if not run_id:
            run_id = str(uuid.uuid4())[:8]

        msg = QueuedMessage(
            id=str(uuid.uuid4())[:8],
            text=text,
            run_id=run_id,
            session_key=session_key,
            metadata=metadata or {},
        )

        with self._lock:
            if self._processing:
                # Agent is busy — queue the message
                if len(self._queue) >= self._max_queue_size:
                    logger.warning(f"[MQ] Queue full ({self._max_queue_size}), dropping message")
                    return {'status': 'dropped', 'runId': run_id, 'reason': 'queue_full'}

                self._queue.append(msg)
                self._total_queued += 1
                position = len(self._queue)
                logger.info(f"[MQ] Queued message (position={position}): {text[:60]}...")

                # Emit bus event
                try:
                    from src.infra.event_bus import bus
                    bus.emit('message_queued', {
                        'run_id': run_id,
                        'position': position,
                        'text_preview': text[:100],
                    })
                except Exception:
                    pass

                # Notify dashboard about queue state
                self._broadcast_queue_state()

                return {'status': 'queued', 'runId': run_id, 'position': position}
            else:
                # Agent is idle — process immediately
                self._processing = True
                self._current = msg

        # Process outside lock
        self._dispatch(msg)
        return {'status': 'processing', 'runId': run_id, 'position': 0}

    def on_complete(self):
        """Called when the current message finishes processing.
        
        Automatically dispatches the next queued message if any.
        """
        with self._lock:
            self._total_processed += 1
            self._current = None

            if self._queue:
                # Drain next message
                next_msg = self._queue.popleft()
                self._current = next_msg
                logger.info(f"[MQ] Draining next message from queue ({len(self._queue)} remaining): {next_msg.text[:60]}...")

                # Emit bus event
                try:
                    from src.infra.event_bus import bus
                    bus.emit('message_dequeued', {
                        'run_id': next_msg.run_id,
                        'remaining': len(self._queue),
                        'waited_seconds': round(time.time() - next_msg.enqueued_at, 1),
                    })
                except Exception:
                    pass
            else:
                self._processing = False
                self._broadcast_queue_state()
                return

        # Process outside lock
        self._dispatch(next_msg)
        self._broadcast_queue_state()

    def _dispatch(self, msg: QueuedMessage):
        """Dispatch a message to the executor in a new thread."""
        if not self._executor:
            logger.error("[MQ] No executor set — message dropped")
            self.on_complete()
            return

        def _run():
            try:
                self._executor(msg)
            except Exception as e:
                logger.error(f"[MQ] Executor error: {e}")
            finally:
                self.on_complete()

        thread = threading.Thread(
            target=_run,
            daemon=True,
            name=f"mq-exec-{msg.run_id}",
        )
        thread.start()

    def _broadcast_queue_state(self):
        """Broadcast queue state to connected dashboard clients."""
        try:
            from src.infra.gateway_ws import broadcast_event
            broadcast_event('queue', {
                'processing': self._processing,
                'queueLength': len(self._queue),
                'currentRunId': self._current.run_id if self._current else None,
                'queued': [m.to_dict() for m in self._queue],
            })
        except Exception:
            pass

    def get_status(self) -> Dict[str, Any]:
        """Get queue status for API/dashboard."""
        with self._lock:
            return {
                'processing': self._processing,
                'queueLength': len(self._queue),
                'current': self._current.to_dict() if self._current else None,
                'queued': [m.to_dict() for m in self._queue],
                'totalProcessed': self._total_processed,
                'totalQueued': self._total_queued,
            }

    def cancel_queued(self, run_id: str) -> bool:
        """Cancel a queued (not yet processing) message."""
        with self._lock:
            for i, msg in enumerate(self._queue):
                if msg.run_id == run_id:
                    del self._queue[i]  # deque supports del by index via list conversion
                    logger.info(f"[MQ] Cancelled queued message: {run_id}")
                    self._broadcast_queue_state()
                    return True
        return False

    def clear_queue(self) -> int:
        """Clear all queued messages. Returns count cleared."""
        with self._lock:
            count = len(self._queue)
            self._queue.clear()
        if count:
            self._broadcast_queue_state()
        return count


# Global singleton
_instance: Optional[MessageQueue] = None
_instance_lock = threading.Lock()


def get_message_queue() -> MessageQueue:
    """Get the global message queue."""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = MessageQueue()
        return _instance
