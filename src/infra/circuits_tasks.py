"""
Circuits Tasks - Agent-managed task list in CIRCUITS.md

Allows the agent to read, add, remove, and complete tasks in CIRCUITS.md.
This gives the agent self-management capability — it can schedule its own
recurring work by editing the circuits file directly.

CIRCUITS.md format:
    # CIRCUITS.md

    ## Active Tasks
    - Task description one
    - Task description two

    ## Completed
    - [2026-02-09] Task that was finished
"""

import re
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
CIRCUITS_PATH = SOMA / "CIRCUITS.md"


def _read_circuits() -> str:
    """Read CIRCUITS.md content."""
    if not CIRCUITS_PATH.exists():
        return ""
    return CIRCUITS_PATH.read_text(encoding='utf-8')


def _write_circuits(content: str):
    """Write CIRCUITS.md content."""
    CIRCUITS_PATH.write_text(content, encoding='utf-8')


def _parse_sections(content: str) -> Dict[str, List[str]]:
    """Parse CIRCUITS.md into sections with their task lines."""
    # Remove HTML comments
    clean = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    
    sections: Dict[str, List[str]] = {
        "active": [],
        "completed": [],
    }
    
    current_section = None
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped.lower().startswith('## active'):
            current_section = "active"
            continue
        elif stripped.lower().startswith('## completed'):
            current_section = "completed"
            continue
        elif stripped.startswith('## '):
            current_section = None
            continue
        
        if current_section and stripped.startswith('- '):
            task_text = stripped[2:].strip()
            if task_text:
                sections[current_section].append(task_text)
    
    return sections


def _rebuild_circuits(sections: Dict[str, List[str]]) -> str:
    """Rebuild CIRCUITS.md from sections."""
    lines = ["# CIRCUITS.md", "", ""]
    
    # Active Tasks
    lines.append("## Active Tasks")
    lines.append("")
    if sections["active"]:
        for task in sections["active"]:
            lines.append(f"- {task}")
    else:
        lines.append("<!-- No active tasks -->")
    lines.append("")
    lines.append("")
    
    # Completed
    lines.append("## Completed")
    lines.append("")
    if sections["completed"]:
        for task in sections["completed"]:
            lines.append(f"- {task}")
    else:
        lines.append("<!-- No completed tasks yet -->")
    lines.append("")
    
    return '\n'.join(lines)


# ============================================================================
# Tool functions
# ============================================================================

def circuits_tasks_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch circuits task actions."""
    if action == "list":
        return circuits_list()
    elif action == "add":
        task = kwargs.get("task", "")
        if not task:
            return {"status": "error", "error": "task text required"}
        return circuits_add(task)
    elif action == "remove":
        task = kwargs.get("task", "")
        index = kwargs.get("index")
        if not task and index is None:
            return {"status": "error", "error": "task text or index required"}
        return circuits_remove(task=task, index=index)
    elif action == "complete":
        task = kwargs.get("task", "")
        index = kwargs.get("index")
        if not task and index is None:
            return {"status": "error", "error": "task text or index required"}
        return circuits_complete(task=task, index=index)
    elif action == "clear_completed":
        return circuits_clear_completed()
    else:
        return {"status": "error", "error": f"Unknown action: {action}. Use: list, add, remove, complete, clear_completed"}


def circuits_list() -> Dict[str, Any]:
    """List all tasks in CIRCUITS.md."""
    content = _read_circuits()
    if not content:
        return {
            "status": "success",
            "active": [],
            "completed": [],
            "message": "CIRCUITS.md is empty or missing",
        }
    
    sections = _parse_sections(content)
    return {
        "status": "success",
        "active": sections["active"],
        "completed": sections["completed"],
        "activeCount": len(sections["active"]),
        "completedCount": len(sections["completed"]),
    }


def circuits_add(task: str) -> Dict[str, Any]:
    """Add a task to the Active Tasks section."""
    content = _read_circuits()
    
    if not content:
        # Create fresh CIRCUITS.md
        sections = {"active": [task], "completed": []}
    else:
        sections = _parse_sections(content)
        # Check for duplicates
        if task in sections["active"]:
            return {"status": "error", "error": f"Task already exists: {task}"}
        sections["active"].append(task)
    
    _write_circuits(_rebuild_circuits(sections))
    logger.info(f"CIRCUITS.md: Added task: {task}")
    
    return {
        "status": "success",
        "message": f"Added task: {task}",
        "activeCount": len(sections["active"]),
    }


def circuits_remove(task: str = "", index: Optional[int] = None) -> Dict[str, Any]:
    """Remove a task from Active Tasks (without completing it)."""
    content = _read_circuits()
    if not content:
        return {"status": "error", "error": "CIRCUITS.md is empty"}
    
    sections = _parse_sections(content)
    
    removed = None
    if index is not None:
        if 0 <= index < len(sections["active"]):
            removed = sections["active"].pop(index)
        else:
            return {"status": "error", "error": f"Index {index} out of range (0-{len(sections['active'])-1})"}
    elif task:
        # Fuzzy match: find task containing the text
        for i, t in enumerate(sections["active"]):
            if task.lower() in t.lower() or t.lower() in task.lower():
                removed = sections["active"].pop(i)
                break
        if not removed:
            return {"status": "error", "error": f"Task not found: {task}"}
    
    _write_circuits(_rebuild_circuits(sections))
    logger.info(f"CIRCUITS.md: Removed task: {removed}")
    
    return {
        "status": "success",
        "message": f"Removed task: {removed}",
        "activeCount": len(sections["active"]),
    }


def circuits_complete(task: str = "", index: Optional[int] = None) -> Dict[str, Any]:
    """Move a task from Active to Completed with timestamp."""
    content = _read_circuits()
    if not content:
        return {"status": "error", "error": "CIRCUITS.md is empty"}
    
    sections = _parse_sections(content)
    
    completed_task = None
    if index is not None:
        if 0 <= index < len(sections["active"]):
            completed_task = sections["active"].pop(index)
        else:
            return {"status": "error", "error": f"Index {index} out of range (0-{len(sections['active'])-1})"}
    elif task:
        for i, t in enumerate(sections["active"]):
            if task.lower() in t.lower() or t.lower() in task.lower():
                completed_task = sections["active"].pop(i)
                break
        if not completed_task:
            return {"status": "error", "error": f"Task not found: {task}"}
    
    # Add to completed with date stamp
    date_str = datetime.now().strftime("%Y-%m-%d")
    sections["completed"].insert(0, f"[{date_str}] {completed_task}")
    
    _write_circuits(_rebuild_circuits(sections))
    logger.info(f"CIRCUITS.md: Completed task: {completed_task}")
    
    return {
        "status": "success",
        "message": f"Completed task: {completed_task}",
        "activeCount": len(sections["active"]),
        "completedCount": len(sections["completed"]),
    }


def circuits_clear_completed() -> Dict[str, Any]:
    """Clear all completed tasks."""
    content = _read_circuits()
    if not content:
        return {"status": "error", "error": "CIRCUITS.md is empty"}
    
    sections = _parse_sections(content)
    cleared = len(sections["completed"])
    sections["completed"] = []
    
    _write_circuits(_rebuild_circuits(sections))
    logger.info(f"CIRCUITS.md: Cleared {cleared} completed tasks")
    
    return {
        "status": "success",
        "message": f"Cleared {cleared} completed tasks",
        "activeCount": len(sections["active"]),
    }


# Backward compatibility aliases
heartbeat_tasks_dispatch = circuits_tasks_dispatch
heartbeat_list = circuits_list
heartbeat_add = circuits_add
heartbeat_remove = circuits_remove
heartbeat_complete = circuits_complete
heartbeat_clear_completed = circuits_clear_completed
