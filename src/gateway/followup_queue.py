"""
Followup Queue - Queue-based auto-continue
============================================

Sophisticated followup queue system:
- Deduplication by message-id or prompt
- Batching/collecting multiple messages
- Debounce to let queue settle
- Drop policies when queue is full
- Cross-channel routing support
- Async drain with scheduling

This replaces the simple priority queue in autonomous_runner.py
with a full queue-based implementation.
"""

import time
import logging
import threading
import hashlib
from typing import Dict, Any, Optional, List, Callable, Literal
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger("gateway.followup_queue")


# ============================================================================
# Types
# ============================================================================

class QueueMode(str, Enum):
    """How to process queued items."""
    FIFO = "fifo"           # Process one at a time, first-in-first-out
    COLLECT = "collect"     # Batch multiple messages into one prompt
    LATEST = "latest"       # Only process the most recent


class QueueDropPolicy(str, Enum):
    """What to do when queue is full."""
    DROP_OLDEST = "drop-oldest"   # Remove oldest items
    DROP_NEWEST = "drop-newest"   # Reject new items
    SUMMARIZE = "summarize"       # Summarize dropped items


class QueueDedupeMode(str, Enum):
    """How to deduplicate queue items."""
    NONE = "none"           # No deduplication
    MESSAGE_ID = "message-id"  # Dedupe by message ID
    PROMPT = "prompt"       # Dedupe by prompt content


@dataclass
class FollowupRun:
    """A queued followup agent turn."""
    prompt: str
    enqueued_at: float = field(default_factory=time.time)
    message_id: Optional[str] = None
    summary_line: Optional[str] = None
    
    # Session/run context
    session_key: str = "main"
    model_override: Optional[str] = None
    
    # Cross-channel routing (for multi-platform support)
    originating_channel: Optional[str] = None  # e.g., "telegram", "discord", "slack"
    originating_to: Optional[str] = None       # Target address/chat ID
    originating_account_id: Optional[str] = None
    originating_thread_id: Optional[int] = None
    
    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "prompt": self.prompt,
            "enqueuedAt": self.enqueued_at,
            "messageId": self.message_id,
            "summaryLine": self.summary_line,
            "sessionKey": self.session_key,
            "modelOverride": self.model_override,
            "originatingChannel": self.originating_channel,
            "originatingTo": self.originating_to,
            "originatingAccountId": self.originating_account_id,
            "originatingThreadId": self.originating_thread_id,
            "metadata": self.metadata,
        }


@dataclass
class QueueSettings:
    """Settings for a followup queue."""
    mode: QueueMode = QueueMode.FIFO
    drop_policy: QueueDropPolicy = QueueDropPolicy.DROP_OLDEST
    dedupe_mode: QueueDedupeMode = QueueDedupeMode.MESSAGE_ID
    max_items: int = 50
    debounce_ms: int = 500  # Wait this long for queue to settle
    collect_max_items: int = 10  # Max items to collect into one prompt
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "mode": self.mode.value,
            "dropPolicy": self.drop_policy.value,
            "dedupeMode": self.dedupe_mode.value,
            "maxItems": self.max_items,
            "debounceMs": self.debounce_ms,
            "collectMaxItems": self.collect_max_items,
        }


@dataclass
class QueueState:
    """State of a followup queue."""
    items: List[FollowupRun] = field(default_factory=list)
    settings: QueueSettings = field(default_factory=QueueSettings)
    draining: bool = False
    last_enqueued_at: Optional[float] = None
    dropped_count: int = 0
    dropped_summaries: List[str] = field(default_factory=list)


# ============================================================================
# Queue Registry
# ============================================================================

_queues: Dict[str, QueueState] = {}
_queues_lock = threading.Lock()


def get_queue(key: str, settings: Optional[QueueSettings] = None) -> QueueState:
    """Get or create a queue by key."""
    with _queues_lock:
        if key not in _queues:
            _queues[key] = QueueState(settings=settings or QueueSettings())
        elif settings:
            _queues[key].settings = settings
        return _queues[key]


def clear_queue(key: str) -> int:
    """Clear a queue and return number of items cleared."""
    with _queues_lock:
        if key in _queues:
            count = len(_queues[key].items)
            _queues[key].items.clear()
            _queues[key].dropped_count = 0
            _queues[key].dropped_summaries.clear()
            return count
        return 0


def list_queues() -> Dict[str, Dict[str, Any]]:
    """List all queues and their status."""
    with _queues_lock:
        return {
            key: {
                "items": len(q.items),
                "draining": q.draining,
                "droppedCount": q.dropped_count,
                "settings": q.settings.to_dict(),
            }
            for key, q in _queues.items()
        }


# ============================================================================
# Deduplication
# ============================================================================

def _has_same_routing(a: FollowupRun, b: FollowupRun) -> bool:
    """Check if two runs have the same routing (channel/target)."""
    return (
        a.originating_channel == b.originating_channel and
        a.originating_to == b.originating_to and
        a.originating_account_id == b.originating_account_id and
        a.originating_thread_id == b.originating_thread_id
    )


def _is_run_already_queued(
    run: FollowupRun,
    items: List[FollowupRun],
    dedupe_mode: QueueDedupeMode,
) -> bool:
    """Check if a run is already in the queue."""
    if dedupe_mode == QueueDedupeMode.NONE:
        return False
    
    if dedupe_mode == QueueDedupeMode.MESSAGE_ID:
        if run.message_id:
            message_id = run.message_id.strip()
            return any(
                item.message_id and item.message_id.strip() == message_id
                and _has_same_routing(item, run)
                for item in items
            )
        return False
    
    if dedupe_mode == QueueDedupeMode.PROMPT:
        return any(
            item.prompt == run.prompt and _has_same_routing(item, run)
            for item in items
        )
    
    return False


def _generate_message_id(prompt: str) -> str:
    """Generate a message ID from prompt content."""
    return hashlib.md5(prompt.encode()).hexdigest()[:12]


# ============================================================================
# Drop Policy
# ============================================================================

def _apply_drop_policy(queue: QueueState, new_item: FollowupRun) -> bool:
    """
    Apply drop policy when queue is full.
    Returns True if item should be enqueued, False if rejected.
    """
    settings = queue.settings
    
    if len(queue.items) < settings.max_items:
        return True
    
    if settings.drop_policy == QueueDropPolicy.DROP_NEWEST:
        # Reject the new item
        summary = new_item.summary_line or new_item.prompt[:100]
        queue.dropped_count += 1
        queue.dropped_summaries.append(summary)
        logger.debug(f"Queue full, dropping newest: {summary[:50]}...")
        return False
    
    if settings.drop_policy == QueueDropPolicy.DROP_OLDEST:
        # Remove oldest item
        if queue.items:
            dropped = queue.items.pop(0)
            summary = dropped.summary_line or dropped.prompt[:100]
            queue.dropped_count += 1
            queue.dropped_summaries.append(summary)
            logger.debug(f"Queue full, dropping oldest: {summary[:50]}...")
        return True
    
    if settings.drop_policy == QueueDropPolicy.SUMMARIZE:
        # Remove oldest but keep summary for context
        if queue.items:
            dropped = queue.items.pop(0)
            summary = dropped.summary_line or dropped.prompt[:100]
            queue.dropped_count += 1
            queue.dropped_summaries.append(summary)
        return True
    
    return True


# ============================================================================
# Enqueue
# ============================================================================

def enqueue_followup(
    key: str,
    run: FollowupRun,
    settings: Optional[QueueSettings] = None,
) -> bool:
    """
    Enqueue a followup run.
    
    Returns True if enqueued, False if deduplicated or dropped.
    """
    queue = get_queue(key, settings)
    
    # Generate message ID if not provided
    if not run.message_id:
        run.message_id = _generate_message_id(run.prompt)
    
    # Check deduplication
    if _is_run_already_queued(run, queue.items, queue.settings.dedupe_mode):
        logger.debug(f"Skipping duplicate: {run.message_id}")
        return False
    
    # Apply drop policy
    if not _apply_drop_policy(queue, run):
        return False
    
    # Enqueue
    queue.items.append(run)
    queue.last_enqueued_at = time.time()
    
    logger.debug(f"Enqueued followup: {run.message_id} (queue depth: {len(queue.items)})")
    return True


def get_queue_depth(key: str) -> int:
    """Get the number of items in a queue."""
    with _queues_lock:
        if key in _queues:
            return len(_queues[key].items)
        return 0


# ============================================================================
# Cross-Channel Detection
# ============================================================================

def _has_cross_channel_items(items: List[FollowupRun]) -> bool:
    """Check if items span multiple channels/targets."""
    if len(items) <= 1:
        return False
    
    first = items[0]
    first_key = (
        first.originating_channel,
        first.originating_to,
        first.originating_account_id,
        first.originating_thread_id,
    )
    
    for item in items[1:]:
        item_key = (
            item.originating_channel,
            item.originating_to,
            item.originating_account_id,
            item.originating_thread_id,
        )
        if item_key != first_key:
            return True
    
    return False


# ============================================================================
# Collect/Batch
# ============================================================================

def _build_collected_prompt(
    items: List[FollowupRun],
    dropped_count: int,
    dropped_summaries: List[str],
) -> str:
    """Build a collected prompt from multiple queued items."""
    parts = ["[Queued messages while agent was busy]", ""]
    
    for idx, item in enumerate(items):
        parts.append(f"---")
        parts.append(f"Queued #{idx + 1}")
        parts.append(item.prompt.strip())
        parts.append("")
    
    if dropped_count > 0:
        parts.append(f"---")
        parts.append(f"[{dropped_count} earlier message(s) were dropped due to queue limits]")
        if dropped_summaries:
            parts.append("Summaries of dropped messages:")
            for summary in dropped_summaries[-5:]:  # Show last 5
                parts.append(f"  - {summary[:100]}")
    
    return "\n".join(parts)


# ============================================================================
# Drain
# ============================================================================

def _wait_for_debounce(queue: QueueState) -> None:
    """Wait for queue to settle (debounce)."""
    debounce_sec = queue.settings.debounce_ms / 1000.0
    
    while True:
        if queue.last_enqueued_at is None:
            break
        
        elapsed = time.time() - queue.last_enqueued_at
        remaining = debounce_sec - elapsed
        
        if remaining <= 0:
            break
        
        time.sleep(min(remaining, 0.1))


def drain_queue(
    key: str,
    run_followup: Callable[[FollowupRun], None],
    async_mode: bool = True,
) -> int:
    """
    Drain a queue, running each followup.
    
    Args:
        key: Queue key
        run_followup: Callback to run each followup
        async_mode: If True, run in background thread
        
    Returns:
        Number of items processed (0 if async)
    """
    queue = get_queue(key)
    
    if queue.draining:
        logger.debug(f"Queue {key} already draining")
        return 0
    
    if not queue.items and queue.dropped_count == 0:
        return 0
    
    def _drain():
        queue.draining = True
        processed = 0
        force_individual = False
        
        try:
            while queue.items or queue.dropped_count > 0:
                _wait_for_debounce(queue)
                
                if not queue.items:
                    # Only dropped items remain, clear them
                    queue.dropped_count = 0
                    queue.dropped_summaries.clear()
                    break
                
                mode = queue.settings.mode
                
                # FIFO mode: process one at a time
                if mode == QueueMode.FIFO:
                    item = queue.items.pop(0)
                    try:
                        run_followup(item)
                        processed += 1
                    except Exception as e:
                        logger.error(f"Followup error: {e}")
                    continue
                
                # LATEST mode: only process most recent
                if mode == QueueMode.LATEST:
                    item = queue.items[-1]
                    queue.items.clear()
                    try:
                        run_followup(item)
                        processed += 1
                    except Exception as e:
                        logger.error(f"Followup error: {e}")
                    continue
                
                # COLLECT mode: batch multiple messages
                if mode == QueueMode.COLLECT:
                    # If cross-channel, process individually
                    if force_individual or _has_cross_channel_items(queue.items):
                        force_individual = True
                        item = queue.items.pop(0)
                        try:
                            run_followup(item)
                            processed += 1
                        except Exception as e:
                            logger.error(f"Followup error: {e}")
                        continue
                    
                    # Collect items into one prompt
                    max_collect = queue.settings.collect_max_items
                    items_to_collect = queue.items[:max_collect]
                    queue.items = queue.items[max_collect:]
                    
                    collected_prompt = _build_collected_prompt(
                        items_to_collect,
                        queue.dropped_count,
                        queue.dropped_summaries,
                    )
                    
                    # Use last item's routing/context
                    last_item = items_to_collect[-1]
                    collected_run = FollowupRun(
                        prompt=collected_prompt,
                        session_key=last_item.session_key,
                        model_override=last_item.model_override,
                        originating_channel=last_item.originating_channel,
                        originating_to=last_item.originating_to,
                        originating_account_id=last_item.originating_account_id,
                        originating_thread_id=last_item.originating_thread_id,
                    )
                    
                    # Clear dropped tracking
                    queue.dropped_count = 0
                    queue.dropped_summaries.clear()
                    
                    try:
                        run_followup(collected_run)
                        processed += len(items_to_collect)
                    except Exception as e:
                        logger.error(f"Collected followup error: {e}")
                    continue
                
        finally:
            queue.draining = False
            logger.debug(f"Queue {key} drain complete: {processed} processed")
        
        return processed
    
    if async_mode:
        thread = threading.Thread(target=_drain, daemon=True)
        thread.start()
        return 0
    else:
        return _drain()


def schedule_followup_drain(
    key: str,
    run_followup: Callable[[FollowupRun], None],
) -> None:
    """
    Schedule a queue drain.
    
    This is the main entry point called after agent runs complete.
    """
    drain_queue(key, run_followup, async_mode=True)


# ============================================================================
# Convenience Functions
# ============================================================================

def enqueue_and_drain(
    key: str,
    prompt: str,
    run_followup: Callable[[FollowupRun], None],
    session_key: str = "main",
    **kwargs,
) -> bool:
    """Enqueue a followup and schedule drain."""
    run = FollowupRun(
        prompt=prompt,
        session_key=session_key,
        **kwargs,
    )
    
    enqueued = enqueue_followup(key, run)
    
    if enqueued:
        schedule_followup_drain(key, run_followup)
    
    return enqueued


def create_followup_runner(
    on_run: Callable[[str, str, Optional[str]], Any],
) -> Callable[[FollowupRun], None]:
    """
    Create a followup runner callback.
    
    Args:
        on_run: Callback(session_key, prompt, model_override) -> result
        
    Returns:
        Callback suitable for drain_queue/schedule_followup_drain
    """
    def runner(followup: FollowupRun) -> None:
        logger.info(f"Running followup: {followup.message_id}")
        on_run(
            followup.session_key,
            followup.prompt,
            followup.model_override,
        )
    
    return runner
