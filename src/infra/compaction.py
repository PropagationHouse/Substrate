"""
Compaction - Smart context window management.
Handles:
- Token estimation for messages
- Splitting messages into chunks
- LLM-powered summarization of dropped context (with progressive fallback)
- Staged summarization for very long histories
- Pruning history while preserving important information
"""

import logging
from typing import Dict, Any, Optional, List, Tuple, Callable, Awaitable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ─── Tiktoken encoder (lazy-loaded, fallback to heuristic) ───────────
_tiktoken_enc = None
_tiktoken_loaded = False

def _get_tiktoken_enc():
    global _tiktoken_enc, _tiktoken_loaded
    if not _tiktoken_loaded:
        _tiktoken_loaded = True
        try:
            import tiktoken
            _tiktoken_enc = tiktoken.get_encoding("cl100k_base")
            logger.debug("[COMPACT] Using tiktoken cl100k_base for token estimation")
        except Exception as e:
            logger.debug(f"[COMPACT] tiktoken unavailable, using heuristic: {e}")
    return _tiktoken_enc

# Constants
BASE_CHUNK_RATIO = 0.4
MIN_CHUNK_RATIO = 0.15
SAFETY_MARGIN = 1.2  # 20% buffer for estimation inaccuracy
DEFAULT_CONTEXT_TOKENS = 8192
DEFAULT_SUMMARY_FALLBACK = "No prior history."
DEFAULT_MAX_CHUNK_TOKENS = 4000  # Max tokens per chunk sent to summarizer
DEFAULT_RESERVE_TOKENS = 600    # Reserve for summary output
MIN_MESSAGES_FOR_SPLIT = 4      # Min messages before splitting into stages
MERGE_SUMMARIES_INSTRUCTIONS = (
    "Merge these partial summaries into a single cohesive summary. "
    "Preserve decisions, TODOs, open questions, and any constraints."
)

# Type for the summarizer callback
# Takes (messages_text: str, custom_instructions: str | None, previous_summary: str | None) -> str
SummarizerFn = Callable[[str, Optional[str], Optional[str]], Optional[str]]


def estimate_tokens(text: str) -> int:
    """
    Estimate token count for text.
    Uses tiktoken cl100k_base when available, falls back to ~4 chars/token heuristic.
    """
    if not text:
        return 0
    enc = _get_tiktoken_enc()
    if enc is not None:
        try:
            return len(enc.encode(text, disallowed_special=()))
        except Exception:
            pass
    return max(1, len(text) // 4)


def estimate_message_tokens(message: Dict[str, Any]) -> int:
    """Estimate tokens for a single message."""
    content = message.get("content", "")
    if isinstance(content, str):
        return estimate_tokens(content)
    elif isinstance(content, list):
        # Multi-part content (e.g., with images)
        total = 0
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    total += estimate_tokens(part.get("text", ""))
                elif part.get("type") == "image_url":
                    total += 85  # Base tokens for image reference
            elif isinstance(part, str):
                total += estimate_tokens(part)
        return total
    return 0


def estimate_messages_tokens(messages: List[Dict[str, Any]]) -> int:
    """Estimate total tokens for a list of messages."""
    return sum(estimate_message_tokens(m) for m in messages)


def compute_adaptive_chunk_ratio(
    messages: List[Dict[str, Any]],
    context_window: int,
) -> float:
    """
    Compute adaptive chunk ratio based on average message size.
    When messages are large, use smaller chunks to avoid exceeding
    the summarizer's own context limits.
    """
    if not messages or context_window <= 0:
        return BASE_CHUNK_RATIO
    
    total_tokens = estimate_messages_tokens(messages)
    avg_tokens = total_tokens / len(messages)
    safe_avg = avg_tokens * SAFETY_MARGIN
    avg_ratio = safe_avg / context_window
    
    if avg_ratio > 0.1:
        reduction = min(avg_ratio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO)
        return max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction)
    
    return BASE_CHUNK_RATIO


def split_messages_by_token_share(
    messages: List[Dict[str, Any]],
    parts: int = 2,
) -> List[List[Dict[str, Any]]]:
    """
    Split messages into roughly equal token-sized chunks.
    
    Args:
        messages: List of messages to split
        parts: Number of parts to split into
        
    Returns:
        List of message chunks
    """
    if not messages:
        return []
    
    parts = max(1, min(parts, len(messages)))
    if parts <= 1:
        return [messages]
    
    total_tokens = estimate_messages_tokens(messages)
    target_tokens = total_tokens / parts
    
    chunks: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    current_tokens = 0
    
    for message in messages:
        msg_tokens = estimate_message_tokens(message)
        
        if (chunks and len(chunks) < parts - 1 and 
            current and current_tokens + msg_tokens > target_tokens):
            chunks.append(current)
            current = []
            current_tokens = 0
        
        current.append(message)
        current_tokens += msg_tokens
    
    if current:
        chunks.append(current)
    
    return chunks


def chunk_messages_by_max_tokens(
    messages: List[Dict[str, Any]],
    max_tokens: int,
) -> List[List[Dict[str, Any]]]:
    """
    Split messages into chunks that don't exceed max_tokens each.
    
    Args:
        messages: List of messages
        max_tokens: Maximum tokens per chunk
        
    Returns:
        List of message chunks
    """
    if not messages:
        return []
    
    chunks: List[List[Dict[str, Any]]] = []
    current_chunk: List[Dict[str, Any]] = []
    current_tokens = 0
    
    for message in messages:
        msg_tokens = estimate_message_tokens(message)
        
        if current_chunk and current_tokens + msg_tokens > max_tokens:
            chunks.append(current_chunk)
            current_chunk = []
            current_tokens = 0
        
        current_chunk.append(message)
        current_tokens += msg_tokens
        
        # Handle oversized single messages
        if msg_tokens > max_tokens:
            chunks.append(current_chunk)
            current_chunk = []
            current_tokens = 0
    
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks


def compute_adaptive_chunk_ratio(
    messages: List[Dict[str, Any]],
    context_window: int,
) -> float:
    """
    Compute adaptive chunk ratio based on average message size.
    Smaller chunks when messages are large.
    """
    if not messages:
        return BASE_CHUNK_RATIO
    
    total_tokens = estimate_messages_tokens(messages)
    avg_tokens = total_tokens / len(messages)
    
    # Apply safety margin
    safe_avg_tokens = avg_tokens * SAFETY_MARGIN
    avg_ratio = safe_avg_tokens / context_window
    
    # Reduce chunk ratio if average message is large
    if avg_ratio > 0.1:
        reduction = min(avg_ratio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO)
        return max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction)
    
    return BASE_CHUNK_RATIO


def is_oversized_for_summary(message: Dict[str, Any], context_window: int) -> bool:
    """Check if a message is too large to summarize safely."""
    tokens = estimate_message_tokens(message) * SAFETY_MARGIN
    return tokens > context_window * 0.5


@dataclass
class PruneResult:
    """Result of pruning history."""
    messages: List[Dict[str, Any]]
    dropped_messages: List[Dict[str, Any]]
    dropped_count: int
    dropped_tokens: int
    kept_tokens: int
    budget_tokens: int


def prune_history_for_context(
    messages: List[Dict[str, Any]],
    max_context_tokens: int,
    max_history_share: float = 0.5,
    parts: int = 2,
) -> PruneResult:
    """
    Prune message history to fit within context budget.
    
    Drops oldest messages first while trying to keep recent context.
    
    Args:
        messages: Full message history
        max_context_tokens: Maximum context window size
        max_history_share: Maximum share of context for history (0.5 = 50%)
        parts: Number of parts to split into when pruning
        
    Returns:
        PruneResult with kept and dropped messages
    """
    budget_tokens = max(1, int(max_context_tokens * max_history_share))
    kept_messages = messages.copy()
    all_dropped: List[Dict[str, Any]] = []
    dropped_count = 0
    dropped_tokens = 0
    
    parts = max(1, min(parts, len(kept_messages)))
    
    while kept_messages and estimate_messages_tokens(kept_messages) > budget_tokens:
        chunks = split_messages_by_token_share(kept_messages, parts)
        if len(chunks) <= 1:
            break
        
        # Drop oldest chunk
        dropped = chunks[0]
        dropped_count += len(dropped)
        dropped_tokens += estimate_messages_tokens(dropped)
        all_dropped.extend(dropped)
        
        # Keep remaining
        kept_messages = [m for chunk in chunks[1:] for m in chunk]
    
    return PruneResult(
        messages=kept_messages,
        dropped_messages=all_dropped,
        dropped_count=dropped_count,
        dropped_tokens=dropped_tokens,
        kept_tokens=estimate_messages_tokens(kept_messages),
        budget_tokens=budget_tokens,
    )


def _format_messages_for_summary(
    messages: List[Dict[str, Any]],
    max_chars_per_msg: int = 1500,
) -> str:
    """
    Format messages into readable text for the summarizer.
    Preserves role labels and tool names, truncates very long individual messages.
    """
    parts = []
    for msg in messages:
        role = msg.get('role', 'unknown')
        content = str(msg.get('content', ''))
        
        if role == 'tool':
            tool_name = msg.get('name', msg.get('tool_call_id', 'tool'))
            label = f"[Tool: {tool_name}]"
        else:
            label = f"[{role}]"
        
        if len(content) > max_chars_per_msg:
            content = content[:max_chars_per_msg] + f"... [truncated, {len(content)} chars total]"
        
        parts.append(f"{label} {content}")
    
    return "\n".join(parts)


def _basic_summary_fallback(dropped_messages: List[Dict[str, Any]]) -> str:
    """
    Generate a basic summary when LLM summarization is unavailable.
    Better than nothing — extracts key points from recent dropped messages.
    """
    msg_count = len(dropped_messages)
    token_count = estimate_messages_tokens(dropped_messages)
    
    key_points = []
    for msg in dropped_messages[-8:]:
        content = msg.get("content", "")
        if isinstance(content, str) and content.strip():
            snippet = content[:200].strip()
            if len(content) > 200:
                snippet += "..."
            key_points.append(f"- {msg.get('role', 'message')}: {snippet}")
    
    text = f"[Context compacted: {msg_count} messages (~{token_count} tokens) summarized]\n"
    if key_points:
        text += "Recent context:\n" + "\n".join(key_points)
    return text


def summarize_chunks(
    messages: List[Dict[str, Any]],
    summarizer: SummarizerFn,
    max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    custom_instructions: Optional[str] = None,
    previous_summary: Optional[str] = None,
) -> Optional[str]:
    """
    Summarize messages by chunking them and summarizing each chunk sequentially.
    Each chunk's summary feeds into the next as context.
    
    Args:
        messages: Messages to summarize
        summarizer: Callback that takes (text, instructions, prev_summary) -> summary
        max_chunk_tokens: Max tokens per chunk
        custom_instructions: Extra instructions for the summarizer
        previous_summary: Summary from a prior compaction to build on
    
    Returns:
        Summary string, or None if summarization failed entirely
    """
    if not messages:
        return previous_summary or DEFAULT_SUMMARY_FALLBACK
    
    chunks = chunk_messages_by_max_tokens(messages, max_chunk_tokens)
    summary = previous_summary
    
    for i, chunk in enumerate(chunks):
        chunk_text = _format_messages_for_summary(chunk)
        try:
            result = summarizer(chunk_text, custom_instructions, summary)
            if result:
                summary = result
            else:
                logger.warning(f"[COMPACT] Summarizer returned empty for chunk {i+1}/{len(chunks)}")
        except Exception as e:
            logger.warning(f"[COMPACT] Summarizer failed on chunk {i+1}/{len(chunks)}: {e}")
            # Continue with what we have
    
    return summary or DEFAULT_SUMMARY_FALLBACK


def summarize_with_fallback(
    messages: List[Dict[str, Any]],
    summarizer: SummarizerFn,
    context_window: int,
    max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    custom_instructions: Optional[str] = None,
    previous_summary: Optional[str] = None,
) -> str:
    """
    Summarize with progressive fallback for oversized messages.
    
    Strategy:
    1. Try full summarization of all messages
    2. If that fails, exclude oversized messages and summarize the rest
    3. If that also fails, return a basic text summary
    
    Args:
        messages: Messages to summarize
        summarizer: LLM summarizer callback
        context_window: Total context window size in tokens
        max_chunk_tokens: Max tokens per chunk
        custom_instructions: Extra instructions
        previous_summary: Previous summary to build on
    
    Returns:
        Summary string (always returns something)
    """
    if not messages:
        return previous_summary or DEFAULT_SUMMARY_FALLBACK
    
    # Try full summarization
    try:
        result = summarize_chunks(
            messages, summarizer, max_chunk_tokens,
            custom_instructions, previous_summary,
        )
        if result and result != DEFAULT_SUMMARY_FALLBACK:
            return result
    except Exception as e:
        logger.warning(f"[COMPACT] Full summarization failed, trying partial: {e}")
    
    # Fallback 1: exclude oversized messages, summarize the rest
    small_messages = []
    oversized_notes = []
    
    for msg in messages:
        if is_oversized_for_summary(msg, context_window):
            role = msg.get('role', 'message')
            tokens = estimate_message_tokens(msg)
            oversized_notes.append(
                f"[Large {role} (~{tokens // 1000}K tokens) omitted from summary]"
            )
        else:
            small_messages.append(msg)
    
    if small_messages:
        try:
            partial = summarize_chunks(
                small_messages, summarizer, max_chunk_tokens,
                custom_instructions, previous_summary,
            )
            if partial:
                notes = "\n" + "\n".join(oversized_notes) if oversized_notes else ""
                return partial + notes
        except Exception as e:
            logger.warning(f"[COMPACT] Partial summarization also failed: {e}")
    
    # Final fallback: basic text summary
    return _basic_summary_fallback(messages)


def summarize_in_stages(
    messages: List[Dict[str, Any]],
    summarizer: SummarizerFn,
    context_window: int,
    max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    custom_instructions: Optional[str] = None,
    previous_summary: Optional[str] = None,
    parts: int = 2,
) -> str:
    """
    Multi-stage summarization for very long histories.
    
    Splits messages into N parts, summarizes each independently,
    then merges the partial summaries into one cohesive summary.
    
    Args:
        messages: Messages to summarize
        summarizer: LLM summarizer callback
        context_window: Context window size
        max_chunk_tokens: Max tokens per chunk
        custom_instructions: Extra instructions
        previous_summary: Previous summary
        parts: Number of stages to split into
    
    Returns:
        Merged summary string
    """
    if not messages:
        return previous_summary or DEFAULT_SUMMARY_FALLBACK
    
    # Adaptive chunk sizing: shrink chunks when messages are large
    if max_chunk_tokens == DEFAULT_MAX_CHUNK_TOKENS and context_window > 0:
        ratio = compute_adaptive_chunk_ratio(messages, context_window)
        adaptive_max = int(context_window * ratio)
        if adaptive_max < max_chunk_tokens:
            logger.info(f"[COMPACT] Adaptive chunk ratio {ratio:.2f} → max_chunk_tokens {max_chunk_tokens} → {adaptive_max}")
            max_chunk_tokens = adaptive_max
    
    total_tokens = estimate_messages_tokens(messages)
    
    # If small enough, just do single-pass summarization
    if (parts <= 1 or len(messages) < MIN_MESSAGES_FOR_SPLIT 
            or total_tokens <= max_chunk_tokens):
        return summarize_with_fallback(
            messages, summarizer, context_window,
            max_chunk_tokens, custom_instructions, previous_summary,
        )
    
    # Split into stages
    splits = split_messages_by_token_share(messages, parts)
    splits = [s for s in splits if s]  # Remove empty
    
    if len(splits) <= 1:
        return summarize_with_fallback(
            messages, summarizer, context_window,
            max_chunk_tokens, custom_instructions, previous_summary,
        )
    
    # Summarize each stage independently
    partial_summaries = []
    for i, chunk in enumerate(splits):
        logger.info(f"[COMPACT] Summarizing stage {i+1}/{len(splits)} ({len(chunk)} messages)")
        partial = summarize_with_fallback(
            chunk, summarizer, context_window,
            max_chunk_tokens, custom_instructions, None,
        )
        partial_summaries.append(partial)
    
    if len(partial_summaries) == 1:
        return partial_summaries[0]
    
    # Merge partial summaries
    merge_instructions = MERGE_SUMMARIES_INSTRUCTIONS
    if custom_instructions:
        merge_instructions += f"\n\nAdditional focus:\n{custom_instructions}"
    
    combined_text = "\n\n---\n\n".join(
        f"Part {i+1}:\n{s}" for i, s in enumerate(partial_summaries)
    )
    
    try:
        merged = summarizer(combined_text, merge_instructions, previous_summary)
        if merged:
            return merged
    except Exception as e:
        logger.warning(f"[COMPACT] Merge summarization failed: {e}")
    
    # Fallback: concatenate partials
    return "\n\n".join(partial_summaries)


def create_summary_message(
    dropped_messages: List[Dict[str, Any]],
    summary_text: Optional[str] = None,
    summarizer: Optional[SummarizerFn] = None,
    context_window: int = DEFAULT_CONTEXT_TOKENS,
    custom_instructions: Optional[str] = None,
    previous_summary: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a summary message for dropped context.
    
    If a summarizer callback is provided, uses LLM-powered staged summarization.
    Otherwise falls back to basic text extraction.
    
    Args:
        dropped_messages: Messages that were dropped
        summary_text: Optional pre-generated summary (skips summarization)
        summarizer: Optional LLM summarizer callback
        context_window: Context window size for oversized detection
        custom_instructions: Extra instructions for summarizer
        previous_summary: Previous summary to build on
        
    Returns:
        System message with summary
    """
    if summary_text:
        text = summary_text
    elif summarizer and dropped_messages:
        # Use LLM-powered staged summarization
        msg_count = len(dropped_messages)
        token_count = estimate_messages_tokens(dropped_messages)
        logger.info(f"[COMPACT] Summarizing {msg_count} dropped messages (~{token_count} tokens) via LLM")
        
        text = summarize_in_stages(
            dropped_messages,
            summarizer=summarizer,
            context_window=context_window,
            custom_instructions=custom_instructions,
            previous_summary=previous_summary,
        )
        text = f"[Context compacted: {msg_count} messages (~{token_count} tokens)]\n{text}"
    else:
        text = _basic_summary_fallback(dropped_messages)
    
    return {
        "role": "system",
        "content": text,
    }


def compact_messages(
    messages: List[Dict[str, Any]],
    max_tokens: int,
    preserve_recent: int = 10,
    include_summary: bool = True,
    summarizer: Optional[SummarizerFn] = None,
    context_window: int = DEFAULT_CONTEXT_TOKENS,
    previous_summary: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Compact messages to fit within token budget.
    
    If a summarizer is provided, uses LLM-powered staged summarization
    for dropped context instead of basic truncation.
    
    Args:
        messages: Full message history
        max_tokens: Maximum tokens allowed
        preserve_recent: Number of recent messages to always keep
        include_summary: Whether to include summary of dropped content
        summarizer: Optional LLM summarizer callback for smart summaries
        context_window: Context window size (for oversized detection)
        previous_summary: Previous compaction summary to build on
        
    Returns:
        Tuple of (compacted messages, stats dict)
    """
    current_tokens = estimate_messages_tokens(messages)
    
    if current_tokens <= max_tokens:
        return messages, {
            "compacted": False,
            "original_tokens": current_tokens,
            "final_tokens": current_tokens,
        }
    
    # Split into old and recent
    if len(messages) > preserve_recent:
        old_messages = messages[:-preserve_recent]
        recent_messages = messages[-preserve_recent:]
    else:
        old_messages = []
        recent_messages = messages
    
    recent_tokens = estimate_messages_tokens(recent_messages)
    available_for_old = max_tokens - recent_tokens
    
    # Prune old messages
    if old_messages and available_for_old > 0:
        result = prune_history_for_context(
            old_messages,
            max_context_tokens=available_for_old * 2,  # Give some headroom
            max_history_share=1.0,
        )
        
        compacted = result.messages
        
        # Add summary if we dropped messages
        if include_summary and result.dropped_count > 0:
            summary = create_summary_message(
                result.dropped_messages,
                summarizer=summarizer,
                context_window=context_window,
                previous_summary=previous_summary,
            )
            compacted = [summary] + compacted
        
        final_messages = compacted + recent_messages
    else:
        # Can't fit old messages, just use recent
        if include_summary and old_messages:
            summary = create_summary_message(
                old_messages,
                summarizer=summarizer,
                context_window=context_window,
                previous_summary=previous_summary,
            )
            final_messages = [summary] + recent_messages
        else:
            final_messages = recent_messages
    
    final_tokens = estimate_messages_tokens(final_messages)
    
    return final_messages, {
        "compacted": True,
        "original_tokens": current_tokens,
        "final_tokens": final_tokens,
        "dropped_count": len(messages) - len(final_messages),
        "preserved_recent": len(recent_messages),
        "llm_summarized": summarizer is not None,
    }
