"""
Circuits System - Task-driven circuits
=======================================

Uses CIRCUITS.md file for persistent task management.
Agent reads the file and follows instructions strictly.
If nothing needs attention, agent replies CIRCUITS_OK.

Key features:
- File-based tasks (CIRCUITS.md in workspace)
- Single CIRCUITS_OK token for idle detection
- Token stripping from responses
- Skip API calls when file is effectively empty
- Max ack chars to suppress verbose "nothing to do" responses
"""

import os
import re
import logging
from pathlib import Path
from typing import Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger("gateway.circuits")

# Constants
CIRCUITS_TOKEN = "CIRCUITS_OK"
DEFAULT_CIRCUITS_EVERY = "30m"
DEFAULT_CIRCUITS_ACK_MAX_CHARS = 300

# Default prompt - concise, file-driven
CIRCUITS_PROMPT = (
    "Read CIRCUITS.md if it exists (workspace context). "
    "Follow it strictly. Do not infer or repeat old tasks from prior chats. "
    "If nothing needs attention, reply CIRCUITS_OK."
)


@dataclass
class CircuitsConfig:
    """Configuration for circuits system."""
    circuits_file: str = "CIRCUITS.md"
    prompt: str = CIRCUITS_PROMPT
    interval: str = DEFAULT_CIRCUITS_EVERY
    max_ack_chars: int = DEFAULT_CIRCUITS_ACK_MAX_CHARS
    skip_when_empty: bool = True


def resolve_circuits_file(workspace: Optional[str] = None) -> Path:
    """Resolve the path to CIRCUITS.md file."""
    if workspace:
        return Path(workspace) / "CIRCUITS.md"
    
    # Default to current directory or project root
    cwd = Path.cwd()
    if (cwd / "CIRCUITS.md").exists():
        return cwd / "CIRCUITS.md"
    
    # Check parent directories up to 3 levels
    for parent in [cwd.parent, cwd.parent.parent, cwd.parent.parent.parent]:
        if (parent / "CIRCUITS.md").exists():
            return parent / "CIRCUITS.md"
    
    # Default location
    return cwd / "CIRCUITS.md"


def read_circuits_file(workspace: Optional[str] = None) -> Optional[str]:
    """Read CIRCUITS.md content, return None if doesn't exist."""
    path = resolve_circuits_file(workspace)
    
    if not path.exists():
        return None
    
    try:
        return path.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to read CIRCUITS.md: {e}")
        return None


def is_circuits_content_effectively_empty(content: Optional[str]) -> bool:
    """
    Check if CIRCUITS.md content is "effectively empty" - no actionable tasks.
    
    A file is considered effectively empty if it contains only:
    - Whitespace
    - Markdown header lines (# Header)
    - HTML comments (<!-- comment -->)
    - Empty markdown list items (- [ ])
    - Empty lines
    
    Note: A missing file returns False (not effectively empty) so the LLM can
    still decide what to do.
    """
    if content is None:
        return False
    
    if not isinstance(content, str):
        return False
    
    # First, strip all HTML comments
    content_no_comments = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    
    lines = content_no_comments.split("\n")
    for line in lines:
        trimmed = line.strip()
        
        # Skip empty lines
        if not trimmed:
            continue
        
        # Skip markdown header lines (# followed by space or EOL)
        # This does NOT skip lines like "#TODO" which might be content
        if re.match(r'^#+(\s|$)', trimmed):
            continue
        
        # Skip empty markdown list items like "- [ ]" or "* [ ]" or just "- "
        if re.match(r'^[-*+]\s*(\[[\sXx]?\]\s*)?$', trimmed):
            continue
        
        # Found a non-empty, non-comment line - there's actionable content
        return False
    
    # All lines were either empty or comments
    return True


def strip_markup(text: str) -> str:
    """Strip HTML tags and markdown wrappers from text."""
    # Drop HTML tags
    text = re.sub(r'<[^>]*>', ' ', text)
    # Decode common nbsp variant
    text = re.sub(r'&nbsp;', ' ', text, flags=re.IGNORECASE)
    # Remove markdown-ish wrappers at the edges
    text = re.sub(r'^[*`~_]+', '', text)
    text = re.sub(r'[*`~_]+$', '', text)
    return text


def strip_token_at_edges(raw: str) -> Tuple[str, bool]:
    """Strip CIRCUITS_OK token from start/end of text."""
    text = raw.strip()
    if not text:
        return "", False
    
    if CIRCUITS_TOKEN not in text:
        return text, False
    
    did_strip = False
    changed = True
    
    while changed:
        changed = False
        text = text.strip()
        
        if text.startswith(CIRCUITS_TOKEN):
            text = text[len(CIRCUITS_TOKEN):].lstrip()
            did_strip = True
            changed = True
            continue
        
        if text.endswith(CIRCUITS_TOKEN):
            text = text[:-len(CIRCUITS_TOKEN)].rstrip()
            did_strip = True
            changed = True
    
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text, did_strip


@dataclass
class StripResult:
    """Result of stripping CIRCUITS_OK token."""
    should_skip: bool  # Should this response be suppressed entirely?
    text: str  # Cleaned text (token removed)
    did_strip: bool  # Was the token found and stripped?


def strip_circuits_token(
    raw: Optional[str],
    mode: str = "message",  # "circuits" or "message"
    max_ack_chars: int = DEFAULT_CIRCUITS_ACK_MAX_CHARS,
) -> StripResult:
    """
    Strip CIRCUITS_OK token from response and decide if it should be shown.
    
    Args:
        raw: Raw response text
        mode: "circuits" suppresses short acks, "message" always shows remaining text
        max_ack_chars: Max chars for ack to be suppressed (only in circuits mode)
    
    Returns:
        StripResult with should_skip, cleaned text, and whether token was found
    """
    if not raw:
        return StripResult(should_skip=True, text="", did_strip=False)
    
    trimmed = raw.strip()
    if not trimmed:
        return StripResult(should_skip=True, text="", did_strip=False)
    
    # Normalize markup so CIRCUITS_OK wrapped in HTML/Markdown still strips
    trimmed_normalized = strip_markup(trimmed)
    
    has_token = (
        CIRCUITS_TOKEN in trimmed or 
        CIRCUITS_TOKEN in trimmed_normalized
    )
    
    if not has_token:
        return StripResult(should_skip=False, text=trimmed, did_strip=False)
    
    # Try stripping from original and normalized
    stripped_original = strip_token_at_edges(trimmed)
    stripped_normalized = strip_token_at_edges(trimmed_normalized)
    
    # Pick the one that successfully stripped
    if stripped_original[1] and stripped_original[0]:
        text, did_strip = stripped_original
    else:
        text, did_strip = stripped_normalized
    
    if not did_strip:
        return StripResult(should_skip=False, text=trimmed, did_strip=False)
    
    if not text:
        # Token was the entire response
        return StripResult(should_skip=True, text="", did_strip=True)
    
    rest = text.strip()
    
    # In circuits mode, suppress short acknowledgments
    if mode == "circuits":
        if len(rest) <= max_ack_chars:
            return StripResult(should_skip=True, text="", did_strip=True)
    
    # Show the remaining text (with token removed)
    return StripResult(should_skip=False, text=rest, did_strip=True)


def build_circuits_prompt(
    workspace: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> Tuple[str, bool]:
    """
    Build the circuits prompt, reading CIRCUITS.md if it exists.
    
    Returns:
        (prompt, should_skip) - should_skip is True if file is effectively empty
    """
    prompt = custom_prompt or CIRCUITS_PROMPT
    
    # Read circuits file
    content = read_circuits_file(workspace)
    
    if content is None:
        # File doesn't exist - let agent decide what to do
        return prompt, False
    
    # Check if effectively empty
    if is_circuits_content_effectively_empty(content):
        logger.info("CIRCUITS.md is effectively empty, skipping API call")
        return prompt, True
    
    # Include file content in prompt
    full_prompt = f"{prompt}\n\n---\n\nCIRCUITS.md contents:\n\n{content}"
    return full_prompt, False


def should_skip_circuits(workspace: Optional[str] = None) -> bool:
    """Check if circuits should be skipped (no tasks)."""
    content = read_circuits_file(workspace)
    
    if content is None:
        # No file - don't skip, let agent check
        return False
    
    return is_circuits_content_effectively_empty(content)


# Backward compatibility aliases
HEARTBEAT_TOKEN = CIRCUITS_TOKEN
HEARTBEAT_PROMPT = CIRCUITS_PROMPT
DEFAULT_HEARTBEAT_EVERY = DEFAULT_CIRCUITS_EVERY
DEFAULT_HEARTBEAT_ACK_MAX_CHARS = DEFAULT_CIRCUITS_ACK_MAX_CHARS
HeartbeatConfig = CircuitsConfig
resolve_heartbeat_file = resolve_circuits_file
read_heartbeat_file = read_circuits_file
is_heartbeat_content_effectively_empty = is_circuits_content_effectively_empty
strip_heartbeat_token = strip_circuits_token
build_heartbeat_prompt = build_circuits_prompt
should_skip_heartbeat = should_skip_circuits


# Export for use in autonomous_runner
__all__ = [
    "CIRCUITS_TOKEN",
    "CIRCUITS_PROMPT",
    "DEFAULT_CIRCUITS_EVERY",
    "DEFAULT_CIRCUITS_ACK_MAX_CHARS",
    "CircuitsConfig",
    "resolve_circuits_file",
    "read_circuits_file",
    "is_circuits_content_effectively_empty",
    "strip_circuits_token",
    "StripResult",
    "build_circuits_prompt",
    "should_skip_circuits",
    # Backward compat
    "HEARTBEAT_TOKEN",
    "HEARTBEAT_PROMPT",
    "HeartbeatConfig",
    "read_heartbeat_file",
    "strip_heartbeat_token",
    "build_heartbeat_prompt",
    "should_skip_heartbeat",
]
