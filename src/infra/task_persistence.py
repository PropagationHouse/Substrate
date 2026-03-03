"""
Task Persistence — Save/restore agent task state across proxy restarts.
========================================================================
Saves the current task description and a compact summary of tool history
to disk so the agent can resume after a restart without the user having
to re-explain everything.

Design decisions:
- Saves to workspace/state/task_state.json (not in src/ — it's runtime data)
- Only saves the task description + compact tool history summary (NOT full
  messages — those are too large and contain stale context)
- On restore, injects a "you were working on X, here's what you did" system
  message so the agent has context without bloated message history
- Auto-expires after 4 hours (stale tasks are confusing)
- Thread-safe with file locking

Inspired by Open Interpreter's task persistence and Cascade's cross-session memory.
"""

import os
import json
import time
import logging
import threading
from typing import Dict, Any, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)

# State file location
SOMA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_STATE_DIR = os.path.join(SOMA, "workspace", "state")
_STATE_FILE = os.path.join(_STATE_DIR, "task_state.json")

# Task state expires after this many seconds (4 hours)
TASK_EXPIRY_SEC = 4 * 60 * 60

# Lock for thread safety
_lock = threading.Lock()


def _ensure_state_dir():
    """Create the state directory if it doesn't exist."""
    os.makedirs(_STATE_DIR, exist_ok=True)


def _compact_tool_history(tool_history: List[Dict[str, Any]], max_entries: int = 20) -> List[Dict[str, str]]:
    """
    Compact tool history into a minimal summary for persistence.
    Only keeps tool name, key args, and success/failure status.
    """
    compact = []
    for entry in tool_history[-max_entries:]:
        tool_name = entry.get("tool", "?")
        args = entry.get("args", {})
        result = entry.get("result", {})

        # Extract key args (just names, not full values)
        key_args = {}
        for k, v in list(args.items())[:3]:
            val_str = str(v)
            if len(val_str) > 80:
                val_str = val_str[:80] + "..."
            key_args[k] = val_str

        # Determine outcome
        if isinstance(result, dict):
            status = result.get("status", result.get("_status", "unknown"))
            error = result.get("error", result.get("_error"))
            if error:
                outcome = f"error: {str(error)[:100]}"
            else:
                outcome = status
        else:
            outcome = "completed"

        compact.append({
            "tool": tool_name,
            "args": key_args,
            "outcome": outcome,
        })

    return compact


def save_task_state(
    task: str,
    tool_history: List[Dict[str, Any]],
    round_count: int = 0,
    model: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Save current task state to disk.

    Args:
        task: The original task description
        tool_history: List of tool execution records
        round_count: Current round number in the tool loop
        model: Model being used
        extra: Any extra metadata to persist

    Returns:
        True if saved successfully
    """
    if not task:
        return False

    with _lock:
        try:
            _ensure_state_dir()

            state = {
                "task": task[:2000],  # Cap task description
                "tool_history": _compact_tool_history(tool_history),
                "round_count": round_count,
                "model": model,
                "saved_at": time.time(),
                "saved_at_human": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "tools_completed": len(tool_history),
            }
            if extra:
                state["extra"] = extra

            with open(_STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=2, default=str)

            logger.info(f"[TASK_PERSIST] Saved task state: {task[:60]}... ({len(tool_history)} tools)")
            return True

        except Exception as e:
            logger.error(f"[TASK_PERSIST] Failed to save task state: {e}")
            return False


def load_task_state() -> Optional[Dict[str, Any]]:
    """
    Load saved task state from disk.

    Returns:
        Task state dict, or None if no valid state exists.
        Automatically clears expired states.
    """
    with _lock:
        try:
            if not os.path.isfile(_STATE_FILE):
                return None

            with open(_STATE_FILE, 'r', encoding='utf-8') as f:
                state = json.load(f)

            # Check expiry
            saved_at = state.get("saved_at", 0)
            age = time.time() - saved_at
            if age > TASK_EXPIRY_SEC:
                logger.info(f"[TASK_PERSIST] Task state expired ({age:.0f}s old, max {TASK_EXPIRY_SEC}s)")
                clear_task_state()
                return None

            logger.info(f"[TASK_PERSIST] Loaded task state: {state.get('task', '?')[:60]}... "
                        f"(saved {age:.0f}s ago, {state.get('tools_completed', 0)} tools)")
            return state

        except Exception as e:
            logger.error(f"[TASK_PERSIST] Failed to load task state: {e}")
            return None


def clear_task_state() -> bool:
    """
    Clear saved task state from disk.

    Returns:
        True if cleared (or already empty)
    """
    with _lock:
        try:
            if os.path.isfile(_STATE_FILE):
                os.remove(_STATE_FILE)
                logger.info("[TASK_PERSIST] Cleared task state")
            return True
        except Exception as e:
            logger.error(f"[TASK_PERSIST] Failed to clear task state: {e}")
            return False


def format_task_resume_context(state: Dict[str, Any]) -> str:
    """
    Format a saved task state into a system message for the LLM.
    This gives the agent context about what it was doing before the restart.

    Args:
        state: Task state dict from load_task_state()

    Returns:
        Formatted string to inject as a system message
    """
    task = state.get("task", "Unknown task")
    tool_history = state.get("tool_history", [])
    saved_at = state.get("saved_at_human", "unknown time")
    round_count = state.get("round_count", 0)

    lines = [
        f"RESUMED TASK (saved at {saved_at}):",
        f"Original request: \"{task}\"",
        "",
    ]

    if tool_history:
        lines.append(f"Progress before restart ({len(tool_history)} tool calls, {round_count} rounds):")
        for i, entry in enumerate(tool_history, 1):
            tool = entry.get("tool", "?")
            args = entry.get("args", {})
            outcome = entry.get("outcome", "?")
            arg_str = ", ".join(f"{k}={v}" for k, v in list(args.items())[:2])
            if len(arg_str) > 80:
                arg_str = arg_str[:80] + "..."
            lines.append(f"  {i}. {tool}({arg_str}) → {outcome}")
        lines.append("")
        lines.append("Continue from where you left off. If the task appears complete, summarize what was done.")
    else:
        lines.append("No tools were executed before the restart. Start the task fresh.")

    return "\n".join(lines)
