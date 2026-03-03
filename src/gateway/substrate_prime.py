"""
SUBSTRATE.md and PRIME.md Support
==================================

Personality and startup script injection.

- SUBSTRATE.md: Agent personality/system prompt (prepended to all prompts)
- PRIME.md: Startup script (run once when gateway starts)
"""

import os
import re
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger("gateway.substrate_prime")


def resolve_file_path(filename: str, workspace: Optional[str] = None) -> Path:
    """Resolve path to SUBSTRATE.md or PRIME.md file."""
    if workspace:
        return Path(workspace) / filename
    
    # Check current directory and parent directories
    cwd = Path.cwd()
    for check_dir in [cwd, cwd.parent, cwd.parent.parent]:
        candidate = check_dir / filename
        if candidate.exists():
            return candidate
    
    # Default to soma (project root)
    soma = Path(__file__).parent.parent.parent
    return soma / filename


def read_substrate_file(workspace: Optional[str] = None) -> Optional[str]:
    """
    Read SUBSTRATE.md content for personality injection.
    
    Returns None if file doesn't exist.
    """
    path = resolve_file_path("SUBSTRATE.md", workspace)
    
    if not path.exists():
        return None
    
    try:
        content = path.read_text(encoding="utf-8")
        logger.info(f"Loaded SUBSTRATE.md from {path}")
        return content
    except Exception as e:
        logger.warning(f"Failed to read SUBSTRATE.md: {e}")
        return None


def read_prime_file(workspace: Optional[str] = None) -> Optional[str]:
    """
    Read PRIME.md content for startup script.
    
    Returns None if file doesn't exist.
    """
    path = resolve_file_path("PRIME.md", workspace)
    
    if not path.exists():
        return None
    
    try:
        content = path.read_text(encoding="utf-8")
        logger.info(f"Loaded PRIME.md from {path}")
        return content
    except Exception as e:
        logger.warning(f"Failed to read PRIME.md: {e}")
        return None


def is_prime_content_effectively_empty(content: Optional[str]) -> bool:
    """
    Check if PRIME.md has no actionable tasks.
    
    Similar to circuits empty detection.
    """
    if content is None:
        return True
    
    if not isinstance(content, str):
        return True
    
    # Strip HTML comments
    content_no_comments = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    
    lines = content_no_comments.split("\n")
    for line in lines:
        trimmed = line.strip()
        
        # Skip empty lines
        if not trimmed:
            continue
        
        # Skip markdown headers
        if re.match(r'^#+(\s|$)', trimmed):
            continue
        
        # Skip empty list items
        if re.match(r'^[-*+]\s*(\[[\sXx]?\]\s*)?$', trimmed):
            continue
        
        # Found actionable content
        return False
    
    return True


def extract_prime_tasks(content: str) -> List[str]:
    """
    Extract actionable tasks from PRIME.md.
    
    Looks for:
    - List items (- task)
    - Numbered items (1. task)
    """
    if not content:
        return []
    
    # Strip HTML comments
    content_no_comments = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    
    tasks = []
    for line in content_no_comments.split("\n"):
        trimmed = line.strip()
        
        # Match list items
        match = re.match(r'^[-*+]\s+(.+)$', trimmed)
        if match:
            task = match.group(1).strip()
            # Skip empty checkbox items
            if task and not re.match(r'^\[[\sXx]?\]\s*$', task):
                tasks.append(task)
            continue
        
        # Match numbered items
        match = re.match(r'^\d+\.\s+(.+)$', trimmed)
        if match:
            task = match.group(1).strip()
            if task:
                tasks.append(task)
    
    return tasks


def build_system_prompt_with_substrate(
    base_prompt: str,
    workspace: Optional[str] = None,
) -> str:
    """
    Build system prompt with SUBSTRATE.md prepended.
    
    Args:
        base_prompt: The base system prompt
        workspace: Optional workspace path
    
    Returns:
        Combined prompt with personality
    """
    substrate_content = read_substrate_file(workspace)
    
    if not substrate_content:
        return base_prompt
    
    # Prepend SUBSTRATE.md content
    return f"{substrate_content}\n\n---\n\n{base_prompt}"


@dataclass
class PrimeResult:
    """Result of running PRIME.md."""
    ran: bool
    tasks: List[str]
    skipped_reason: Optional[str] = None


def should_run_prime(workspace: Optional[str] = None) -> PrimeResult:
    """
    Check if PRIME.md should be run.
    
    Returns PrimeResult with tasks to run.
    """
    content = read_prime_file(workspace)
    
    if content is None:
        return PrimeResult(ran=False, tasks=[], skipped_reason="PRIME.md not found")
    
    if is_prime_content_effectively_empty(content):
        return PrimeResult(ran=False, tasks=[], skipped_reason="PRIME.md is empty")
    
    tasks = extract_prime_tasks(content)
    
    if not tasks:
        return PrimeResult(ran=False, tasks=[], skipped_reason="No actionable tasks in PRIME.md")
    
    return PrimeResult(ran=True, tasks=tasks)


# Track if prime has run this session
_prime_ran = False


def mark_prime_complete():
    """Mark that PRIME.md has been run this session."""
    global _prime_ran
    _prime_ran = True


def has_prime_run() -> bool:
    """Check if PRIME.md has already run this session."""
    return _prime_ran


def reset_prime_state():
    """Reset prime state (for testing or restart)."""
    global _prime_ran
    _prime_ran = False


# Backward compatibility aliases
read_soul_file = read_substrate_file
read_boot_file = read_prime_file
is_boot_content_effectively_empty = is_prime_content_effectively_empty
extract_boot_tasks = extract_prime_tasks
build_system_prompt_with_soul = build_system_prompt_with_substrate
should_run_boot = should_run_prime
BootResult = PrimeResult
mark_boot_complete = mark_prime_complete
has_boot_run = has_prime_run
reset_boot_state = reset_prime_state


# Exports
__all__ = [
    "read_substrate_file",
    "read_prime_file",
    "is_prime_content_effectively_empty",
    "extract_prime_tasks",
    "build_system_prompt_with_substrate",
    "should_run_prime",
    "PrimeResult",
    "mark_prime_complete",
    "has_prime_run",
    "reset_prime_state",
    # Backward compat
    "read_soul_file",
    "read_boot_file",
    "build_system_prompt_with_soul",
    "should_run_boot",
    "BootResult",
    "mark_boot_complete",
    "has_boot_run",
    "reset_boot_state",
]
