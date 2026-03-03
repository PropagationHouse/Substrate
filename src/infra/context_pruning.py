"""
Context Pruning - Selective tool result trimming for token efficiency.
Two-phase approach:
1. Soft trim: Keep head+tail of large tool results when context exceeds soft threshold
2. Hard clear: Replace ancient tool results with placeholder when context exceeds hard threshold

This operates on the in-memory messages array before each LLM call.
It does NOT rewrite persisted session history.
"""

import logging
import json
from typing import Dict, Any, Optional, List, Set
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

CHARS_PER_TOKEN = 4


@dataclass
class PruningConfig:
    """Configuration for context pruning."""
    enabled: bool = True
    # Protect the last N assistant messages from pruning
    keep_last_assistants: int = 3
    # Context fill ratio thresholds (fraction of context window)
    soft_trim_ratio: float = 0.3   # Start soft-trimming tool results above this
    hard_clear_ratio: float = 0.5  # Start hard-clearing tool results above this
    # Minimum total prunable chars before we bother pruning
    min_prunable_chars: int = 50000
    # Soft trim settings
    soft_trim_max_chars: int = 4000   # Tool results smaller than this are left alone
    soft_trim_head_chars: int = 1500  # Keep first N chars
    soft_trim_tail_chars: int = 1500  # Keep last N chars
    # Hard clear settings
    hard_clear_enabled: bool = True
    hard_clear_placeholder: str = "[Old tool result cleared to save context]"
    # Tool allow/deny lists (empty = all tools prunable)
    tools_allow: List[str] = field(default_factory=list)  # If set, only these tools are prunable
    tools_deny: List[str] = field(default_factory=list)   # These tools are never pruned

    def to_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "keepLastAssistants": self.keep_last_assistants,
            "softTrimRatio": self.soft_trim_ratio,
            "hardClearRatio": self.hard_clear_ratio,
            "minPrunableChars": self.min_prunable_chars,
            "softTrim": {
                "maxChars": self.soft_trim_max_chars,
                "headChars": self.soft_trim_head_chars,
                "tailChars": self.soft_trim_tail_chars,
            },
            "hardClear": {
                "enabled": self.hard_clear_enabled,
                "placeholder": self.hard_clear_placeholder,
            },
            "tools": {
                "allow": self.tools_allow,
                "deny": self.tools_deny,
            },
        }


@dataclass
class PruningStats:
    """Stats from a pruning pass."""
    total_messages: int = 0
    prunable_found: int = 0
    soft_trimmed: int = 0
    hard_cleared: int = 0
    chars_before: int = 0
    chars_after: int = 0
    chars_saved: int = 0
    skipped_reason: Optional[str] = None


def _estimate_message_chars(msg: Dict[str, Any]) -> int:
    """Estimate character count for a message."""
    content = msg.get("content", "")
    if isinstance(content, str):
        return len(content)
    elif isinstance(content, list):
        total = 0
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    total += len(part.get("text", ""))
                elif part.get("type") == "image_url":
                    total += 8000  # Rough estimate for image tokens
                elif part.get("type") == "tool_result":
                    total += len(str(part.get("content", "")))
            elif isinstance(part, str):
                total += len(part)
        return total
    return len(str(content)) if content else 0


def _estimate_context_chars(messages: List[Dict[str, Any]]) -> int:
    """Total character estimate for all messages."""
    return sum(_estimate_message_chars(m) for m in messages)


def _get_message_text(msg: Dict[str, Any]) -> str:
    """Extract text content from a message."""
    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
            elif isinstance(part, str):
                parts.append(part)
        return "\n".join(parts)
    return str(content) if content else ""


def _set_message_text(msg: Dict[str, Any], text: str) -> Dict[str, Any]:
    """Return a copy of the message with replaced text content."""
    result = dict(msg)
    content = msg.get("content", "")
    if isinstance(content, str):
        result["content"] = text
    elif isinstance(content, list):
        # Replace text parts, keep non-text parts
        new_content = []
        text_replaced = False
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text" and not text_replaced:
                new_content.append({"type": "text", "text": text})
                text_replaced = True
            elif isinstance(part, dict) and part.get("type") == "text":
                continue  # Skip additional text parts
            else:
                new_content.append(part)
        if not text_replaced:
            new_content.insert(0, {"type": "text", "text": text})
        result["content"] = new_content
    else:
        result["content"] = text
    return result


def _is_tool_result(msg: Dict[str, Any]) -> bool:
    """Check if a message is a tool result."""
    return msg.get("role") == "tool"


def _get_tool_name(msg: Dict[str, Any]) -> Optional[str]:
    """Get tool name from a tool result message."""
    return msg.get("name") or msg.get("tool_name")


def _is_tool_prunable(tool_name: Optional[str], config: PruningConfig) -> bool:
    """Check if a tool's results can be pruned."""
    if not tool_name:
        return True
    if config.tools_deny and tool_name in config.tools_deny:
        return False
    if config.tools_allow:
        return tool_name in config.tools_allow
    return True


def _has_image_content(msg: Dict[str, Any]) -> bool:
    """Check if message contains image data (skip pruning these)."""
    content = msg.get("content", "")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("image_url", "image"):
                return True
    if isinstance(content, str) and content.startswith("data:image"):
        return True
    return False


def _find_assistant_cutoff(messages: List[Dict[str, Any]], keep_last: int) -> Optional[int]:
    """Find the index before which tool results can be pruned.
    
    Returns the index of the Nth-from-last assistant message,
    meaning everything before this index is eligible for pruning.
    """
    if keep_last <= 0:
        return len(messages)
    
    remaining = keep_last
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant":
            remaining -= 1
            if remaining == 0:
                return i
    return None  # Not enough assistant messages


def _find_first_user_index(messages: List[Dict[str, Any]]) -> Optional[int]:
    """Find index of first user message (protect system/identity messages before it)."""
    for i, msg in enumerate(messages):
        if msg.get("role") == "user":
            return i
    return None


def _soft_trim_text(text: str, head_chars: int, tail_chars: int) -> Optional[str]:
    """Soft-trim text: keep head + tail with truncation marker.
    
    Returns None if text doesn't need trimming.
    """
    if len(text) <= head_chars + tail_chars:
        return None
    
    head = text[:head_chars]
    tail = text[-tail_chars:] if tail_chars > 0 else ""
    trimmed_chars = len(text) - head_chars - tail_chars
    
    return f"{head}\n...\n{tail}\n\n[Tool result trimmed: kept first {head_chars} and last {tail_chars} chars of {len(text)} total. {trimmed_chars} chars removed.]"


def prune_context_messages(
    messages: List[Dict[str, Any]],
    context_window_tokens: int,
    config: Optional[PruningConfig] = None,
) -> tuple:
    """
    Prune tool results from the message context to reduce token usage.
    
    Args:
        messages: The full messages array (system + user + assistant + tool)
        context_window_tokens: The model's context window size in tokens
        config: Pruning configuration (uses defaults if None)
    
    Returns:
        (pruned_messages, stats) - New messages list and pruning statistics
    """
    if config is None:
        config = PruningConfig()
    
    stats = PruningStats(total_messages=len(messages))
    
    if not config.enabled:
        stats.skipped_reason = "pruning disabled"
        return messages, stats
    
    if context_window_tokens <= 0:
        stats.skipped_reason = "no context window"
        return messages, stats
    
    char_window = context_window_tokens * CHARS_PER_TOKEN
    total_chars = _estimate_context_chars(messages)
    stats.chars_before = total_chars
    
    ratio = total_chars / char_window if char_window > 0 else 0
    
    # Below soft threshold — no pruning needed
    if ratio < config.soft_trim_ratio:
        stats.chars_after = total_chars
        stats.skipped_reason = f"below soft threshold ({ratio:.2f} < {config.soft_trim_ratio})"
        return messages, stats
    
    # Find the cutoff: protect last N assistant messages
    cutoff = _find_assistant_cutoff(messages, config.keep_last_assistants)
    if cutoff is None:
        stats.chars_after = total_chars
        stats.skipped_reason = "not enough assistant messages for cutoff"
        return messages, stats
    
    # Protect everything before first user message (system prompts, identity)
    first_user = _find_first_user_index(messages)
    prune_start = first_user if first_user is not None else len(messages)
    
    # Find prunable tool result indices
    prunable_indices: List[int] = []
    for i in range(prune_start, cutoff):
        msg = messages[i]
        if not _is_tool_result(msg):
            continue
        if _has_image_content(msg):
            continue
        tool_name = _get_tool_name(msg)
        if not _is_tool_prunable(tool_name, config):
            continue
        prunable_indices.append(i)
    
    stats.prunable_found = len(prunable_indices)
    
    if not prunable_indices:
        stats.chars_after = total_chars
        stats.skipped_reason = "no prunable tool results found"
        return messages, stats
    
    # Phase 1: Soft trim — truncate large tool results to head+tail
    result = list(messages)  # Shallow copy
    
    for i in prunable_indices:
        msg = result[i]
        text = _get_message_text(msg)
        
        if len(text) <= config.soft_trim_max_chars:
            continue
        
        trimmed = _soft_trim_text(text, config.soft_trim_head_chars, config.soft_trim_tail_chars)
        if trimmed is None:
            continue
        
        before_chars = _estimate_message_chars(msg)
        result[i] = _set_message_text(msg, trimmed)
        after_chars = _estimate_message_chars(result[i])
        total_chars += (after_chars - before_chars)
        stats.soft_trimmed += 1
    
    # Check if we're below hard threshold after soft trimming
    ratio = total_chars / char_window if char_window > 0 else 0
    if ratio < config.hard_clear_ratio or not config.hard_clear_enabled:
        stats.chars_after = total_chars
        stats.chars_saved = stats.chars_before - stats.chars_after
        if stats.soft_trimmed > 0:
            logger.info(f"[PRUNE] Soft-trimmed {stats.soft_trimmed} tool results, saved {stats.chars_saved} chars ({stats.chars_saved // CHARS_PER_TOKEN} est. tokens)")
        return result, stats
    
    # Check minimum prunable chars threshold
    prunable_chars = sum(_estimate_message_chars(result[i]) for i in prunable_indices)
    if prunable_chars < config.min_prunable_chars:
        stats.chars_after = total_chars
        stats.chars_saved = stats.chars_before - stats.chars_after
        stats.skipped_reason = f"prunable chars ({prunable_chars}) below minimum ({config.min_prunable_chars})"
        return result, stats
    
    # Phase 2: Hard clear — replace oldest prunable tool results with placeholder
    for i in prunable_indices:
        if ratio < config.hard_clear_ratio:
            break
        
        msg = result[i]
        before_chars = _estimate_message_chars(msg)
        result[i] = _set_message_text(msg, config.hard_clear_placeholder)
        after_chars = _estimate_message_chars(result[i])
        total_chars += (after_chars - before_chars)
        ratio = total_chars / char_window if char_window > 0 else 0
        stats.hard_cleared += 1
    
    stats.chars_after = total_chars
    stats.chars_saved = stats.chars_before - stats.chars_after
    
    logger.info(
        f"[PRUNE] Pruned context: {stats.soft_trimmed} soft-trimmed, {stats.hard_cleared} hard-cleared, "
        f"saved {stats.chars_saved} chars ({stats.chars_saved // CHARS_PER_TOKEN} est. tokens), "
        f"ratio {stats.chars_before / char_window:.2f} -> {ratio:.2f}"
    )
    
    return result, stats
