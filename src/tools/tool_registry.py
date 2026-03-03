"""
Tool Registry - Central registry for all tools
===============================================
Manages tool registration, execution, and policy enforcement.

Features:
- Register tools with schemas
- Execute tools by name
- Tool policy (allow/deny lists)
- Tool execution logging
"""

import logging
import time
import threading
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


# ── Dispatcher functions ─────────────────────────────────────────────
# Each dispatcher consolidates many individual tools into one action-based tool.

def _browser_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch browser CDP actions."""
    # ── Normalize common key aliases ──
    if "link" in kwargs and "url" not in kwargs:
        kwargs["url"] = kwargs.pop("link")
    if "content" in kwargs and "text" not in kwargs:
        kwargs["text"] = kwargs.pop("content")
    if "value" in kwargs and "text" not in kwargs:
        kwargs["text"] = kwargs.pop("value")
    if "reference" in kwargs and "ref" not in kwargs:
        kwargs["ref"] = kwargs.pop("reference")
    if "javascript" in kwargs and "expression" not in kwargs:
        kwargs["expression"] = kwargs.pop("javascript")
    if "js" in kwargs and "expression" not in kwargs:
        kwargs["expression"] = kwargs.pop("js")

    try:
        from ..browser.cdp_browser import (
            cdp_list_tabs, cdp_navigate, cdp_click, cdp_type,
            cdp_submit, cdp_read_page, cdp_get_elements,
            cdp_screenshot_tab, cdp_evaluate, cdp_new_tab, cdp_close_tab,
            cdp_snapshot, cdp_click_ref, cdp_type_ref,
            cdp_scroll, cdp_go_back, cdp_go_forward,
            cdp_hover, cdp_select_option, cdp_press_key,
            cdp_wait_for, cdp_activate_tab, cdp_status,
            cdp_start_browser, cdp_stop_browser, cdp_console, cdp_pdf,
            cdp_upload, cdp_dialog, cdp_drag, cdp_resize, cdp_fill,
            cdp_click_enhanced, cdp_type_slowly, cdp_wait_time,
            cdp_wait_text_gone, cdp_snapshot_enhanced, cdp_screenshot_element,
        )
    except ImportError:
        return {"status": "error", "error": "CDP browser not available"}
    
    actions = {
        "tabs": lambda: cdp_list_tabs(),
        "navigate": lambda: cdp_navigate(url=kwargs.get("url", ""), tab_id=kwargs.get("tab_id")),
        "click": lambda: cdp_click(selector=kwargs.get("selector", ""), tab_id=kwargs.get("tab_id")),
        "type": lambda: cdp_type(selector=kwargs.get("selector", ""), text=kwargs.get("text", ""), clear=kwargs.get("clear", True), tab_id=kwargs.get("tab_id")),
        "submit": lambda: cdp_submit(selector=kwargs.get("selector", "form"), tab_id=kwargs.get("tab_id")),
        "read": lambda: cdp_read_page(tab_id=kwargs.get("tab_id"), max_chars=kwargs.get("max_chars", 50000)),
        "elements": lambda: cdp_get_elements(tab_id=kwargs.get("tab_id"), max_elements=kwargs.get("max_elements", 50)),
        "screenshot": lambda: cdp_screenshot_tab(tab_id=kwargs.get("tab_id"), quality=kwargs.get("quality", 80), full_page=kwargs.get("full_page", False)),
        "eval": lambda: cdp_evaluate(expression=kwargs.get("expression", ""), tab_id=kwargs.get("tab_id")),
        "new_tab": lambda: cdp_new_tab(url=kwargs.get("url")),
        "close_tab": lambda: cdp_close_tab(tab_id=kwargs.get("tab_id")),
        "snapshot": lambda: cdp_snapshot(tab_id=kwargs.get("tab_id"), interactive_only=kwargs.get("interactive_only", True), max_elements=kwargs.get("max_elements", 60)),
        "click_ref": lambda: cdp_click_ref(ref=kwargs.get("ref", ""), tab_id=kwargs.get("tab_id")),
        "type_ref": lambda: cdp_type_ref(ref=kwargs.get("ref", ""), text=kwargs.get("text", ""), clear=kwargs.get("clear", True), submit=kwargs.get("submit", False), tab_id=kwargs.get("tab_id")),
        "scroll": lambda: cdp_scroll(direction=kwargs.get("direction", "down"), amount=kwargs.get("amount", 500), selector=kwargs.get("selector"), tab_id=kwargs.get("tab_id")),
        "back": lambda: cdp_go_back(tab_id=kwargs.get("tab_id")),
        "forward": lambda: cdp_go_forward(tab_id=kwargs.get("tab_id")),
        "hover": lambda: cdp_hover(selector=kwargs.get("selector", ""), tab_id=kwargs.get("tab_id")),
        "select": lambda: cdp_select_option(selector=kwargs.get("selector", ""), value=kwargs.get("value"), label=kwargs.get("label"), index=kwargs.get("index"), tab_id=kwargs.get("tab_id")),
        "press_key": lambda: cdp_press_key(key=kwargs.get("key", ""), selector=kwargs.get("selector"), tab_id=kwargs.get("tab_id")),
        "wait_for": lambda: cdp_wait_for(selector=kwargs.get("selector", ""), timeout=kwargs.get("timeout", 10.0), visible=kwargs.get("visible", True), tab_id=kwargs.get("tab_id")),
        "activate_tab": lambda: cdp_activate_tab(tab_id=kwargs.get("tab_id", "")),
        "status": lambda: cdp_status(),
        "start": lambda: cdp_start_browser(url=kwargs.get("url", "https://www.google.com")),
        "stop": lambda: cdp_stop_browser(),
        "console": lambda: cdp_console(tab_id=kwargs.get("tab_id"), level=kwargs.get("level")),
        "pdf": lambda: cdp_pdf(tab_id=kwargs.get("tab_id")),
        "upload": lambda: cdp_upload(paths=kwargs.get("paths", []), selector=kwargs.get("selector"), ref=kwargs.get("ref"), tab_id=kwargs.get("tab_id")),
        "dialog": lambda: cdp_dialog(accept=kwargs.get("accept", True), prompt_text=kwargs.get("prompt_text"), tab_id=kwargs.get("tab_id")),
        "drag": lambda: cdp_drag(start_selector=kwargs.get("start_selector"), end_selector=kwargs.get("end_selector"), start_ref=kwargs.get("start_ref"), end_ref=kwargs.get("end_ref"), tab_id=kwargs.get("tab_id")),
        "resize": lambda: cdp_resize(width=kwargs.get("width", 1280), height=kwargs.get("height", 720), tab_id=kwargs.get("tab_id")),
        "fill": lambda: cdp_fill(fields=kwargs.get("fields", []), tab_id=kwargs.get("tab_id")),
        "click_enhanced": lambda: cdp_click_enhanced(selector=kwargs.get("selector"), ref=kwargs.get("ref"), double_click=kwargs.get("double_click", False), button=kwargs.get("button", "left"), modifiers=kwargs.get("modifiers"), tab_id=kwargs.get("tab_id")),
        "type_slowly": lambda: cdp_type_slowly(selector=kwargs.get("selector"), ref=kwargs.get("ref"), text=kwargs.get("text", ""), delay_ms=kwargs.get("delay_ms", 50), tab_id=kwargs.get("tab_id")),
        "wait_time": lambda: cdp_wait_time(time_ms=kwargs.get("time_ms", 1000)),
        "wait_text_gone": lambda: cdp_wait_text_gone(text=kwargs.get("text", ""), timeout=kwargs.get("timeout", 10.0), tab_id=kwargs.get("tab_id")),
        "snapshot_enhanced": lambda: cdp_snapshot_enhanced(tab_id=kwargs.get("tab_id"), interactive_only=kwargs.get("interactive_only", True), max_elements=kwargs.get("max_elements", 60), selector=kwargs.get("selector"), frame=kwargs.get("frame"), compact=kwargs.get("compact", False), depth=kwargs.get("depth")),
        "screenshot_element": lambda: cdp_screenshot_element(selector=kwargs.get("selector"), ref=kwargs.get("ref"), quality=kwargs.get("quality", 80), tab_id=kwargs.get("tab_id")),
        "open_default": lambda: _open_in_default_browser(kwargs.get("url", "")),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown browser action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _open_in_default_browser(url: str) -> Dict[str, Any]:
    """Open a URL in the user's default browser (not CDP)."""
    try:
        from .web_tool import open_url
        return open_url(url=url)
    except ImportError:
        import webbrowser
        webbrowser.open(url)
        return {"status": "success", "message": f"Opened {url} in default browser"}


def _desktop_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch desktop UI automation actions via pywinauto."""
    try:
        from .desktop_tool import (
            desktop_list_windows, desktop_window_action, desktop_get_elements,
            desktop_dump_tree, desktop_click_element, desktop_type_in_element,
            desktop_send_keys, desktop_read_element, desktop_select_item,
            desktop_toggle, desktop_expand_collapse, desktop_scroll,
            desktop_set_value, desktop_drag, desktop_get_element_props,
            desktop_wait, desktop_launch_app, desktop_menu_select,
            desktop_clipboard, desktop_screenshot_window, desktop_find_by_id,
            desktop_read_table, desktop_context_menu, desktop_handle_dialog,
            desktop_read_all_text, desktop_invoke, desktop_multi_select,
            desktop_toolbar_click,
        )
    except ImportError:
        return {"status": "error", "error": "Desktop automation (pywinauto) not available. Install: pip install pywinauto"}
    
    actions = {
        "list_windows": lambda: desktop_list_windows(**kwargs),
        "window_action": lambda: desktop_window_action(title=kwargs.get("title", ""), action=kwargs.get("action_type", "focus"), x=kwargs.get("x"), y=kwargs.get("y"), width=kwargs.get("width"), height=kwargs.get("height")),
        "get_elements": lambda: desktop_get_elements(**kwargs),
        "dump_tree": lambda: desktop_dump_tree(**kwargs),
        "click": lambda: desktop_click_element(**kwargs),
        "type": lambda: desktop_type_in_element(**kwargs),
        "send_keys": lambda: desktop_send_keys(**kwargs),
        "read_element": lambda: desktop_read_element(**kwargs),
        "select_item": lambda: desktop_select_item(**kwargs),
        "toggle": lambda: desktop_toggle(**kwargs),
        "expand_collapse": lambda: desktop_expand_collapse(title=kwargs.get("title", ""), element_name=kwargs.get("element_name", ""), action=kwargs.get("action_type", "expand")),
        "scroll": lambda: desktop_scroll(**kwargs),
        "set_value": lambda: desktop_set_value(**kwargs),
        "drag": lambda: desktop_drag(**kwargs),
        "get_props": lambda: desktop_get_element_props(**kwargs),
        "wait": lambda: desktop_wait(**kwargs),
        "launch_app": lambda: desktop_launch_app(**kwargs),
        "menu_select": lambda: desktop_menu_select(**kwargs),
        "clipboard": lambda: desktop_clipboard(action=kwargs.get("action_type", "read"), text=kwargs.get("text", "")),
        "screenshot_window": lambda: desktop_screenshot_window(**kwargs),
        "find_by_id": lambda: desktop_find_by_id(**kwargs),
        "read_table": lambda: desktop_read_table(**kwargs),
        "context_menu": lambda: desktop_context_menu(**kwargs),
        "handle_dialog": lambda: desktop_handle_dialog(title=kwargs.get("title", ""), action=kwargs.get("action_type", "detect"), button=kwargs.get("button", ""), file_path=kwargs.get("file_path", "")),
        "read_all_text": lambda: desktop_read_all_text(**kwargs),
        "invoke": lambda: desktop_invoke(**kwargs),
        "multi_select": lambda: desktop_multi_select(**kwargs),
        "toolbar_click": lambda: desktop_toolbar_click(**kwargs),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown desktop action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _screen_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch screen capture actions."""
    try:
        from .screen_tool import take_screenshot, get_screen_info, start_recording, stop_recording, get_recording_status
    except ImportError:
        return {"status": "error", "error": "Screen tool not available. Install: pip install mss Pillow"}
    
    actions = {
        "screenshot": lambda: take_screenshot(
            screen_index=kwargs.get("screen_index", 0),
            region=kwargs.get("region"),
            save_path=kwargs.get("save_path"),
            quality=kwargs.get("quality", 85),
        ),
        "info": lambda: get_screen_info(),
        "record_start": lambda: start_recording(
            output_path=kwargs.get("output_path"),
            fps=kwargs.get("fps", 10),
            screen_index=kwargs.get("screen_index", 0),
            max_duration_sec=kwargs.get("max_duration_sec", 300),
        ),
        "record_stop": lambda: stop_recording(),
        "record_status": lambda: get_recording_status(),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown screen action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _mouse_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch mouse control actions."""
    try:
        from .mouse_tool import mouse_click, mouse_move, mouse_drag, mouse_scroll, mouse_position, screen_size, hotkey
    except ImportError:
        return {"status": "error", "error": "Mouse tool not available. Install: pip install pyautogui"}
    
    actions = {
        "click": lambda: mouse_click(
            x=kwargs.get("x", 0), y=kwargs.get("y", 0),
            button=kwargs.get("button", "left"),
            clicks=kwargs.get("clicks", 1),
        ),
        "move": lambda: mouse_move(
            x=kwargs.get("x", 0), y=kwargs.get("y", 0),
            duration=kwargs.get("duration", 0.3),
        ),
        "drag": lambda: mouse_drag(
            from_x=kwargs.get("from_x", 0), from_y=kwargs.get("from_y", 0),
            to_x=kwargs.get("to_x", 0), to_y=kwargs.get("to_y", 0),
            duration=kwargs.get("duration", 0.5),
            button=kwargs.get("button", "left"),
        ),
        "scroll": lambda: mouse_scroll(
            clicks=kwargs.get("clicks", -3),
            x=kwargs.get("x"), y=kwargs.get("y"),
        ),
        "position": lambda: mouse_position(),
        "screen_size": lambda: screen_size(),
        "hotkey": lambda: hotkey(*kwargs.get("keys", [])),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown mouse action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _pdf_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch PDF tool actions."""
    try:
        from .pdf_tool import extract_text, get_info, search_text
    except ImportError:
        return {"status": "error", "error": "PDF tool not available. Install: pip install pdfplumber"}
    
    actions = {
        "extract": lambda: extract_text(
            path=kwargs.get("path", ""),
            pages=kwargs.get("pages"),
            max_chars=kwargs.get("max_chars", 100000),
        ),
        "metadata": lambda: get_info(path=kwargs.get("path", "")),
        "search": lambda: search_text(
            path=kwargs.get("path", ""),
            query=kwargs.get("query", ""),
        ),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown pdf action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _memory_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch memory actions: search, facts, store_fact."""
    try:
        from .memory_tool import memory_search, get_user_facts, memory_store_fact
    except ImportError:
        return {"status": "error", "error": "Memory tool not available"}
    
    actions = {
        "search": lambda: memory_search(
            query=kwargs.get("query", ""),
            max_results=kwargs.get("max_results", 5),
            min_score=kwargs.get("min_score", 0.0),
        ),
        "facts": lambda: get_user_facts(),
        "store_fact": lambda: memory_store_fact(
            key=kwargs.get("key", ""),
            value=kwargs.get("value", ""),
        ),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown memory action: {action}. Available: {', '.join(actions.keys())}"}
    result = fn()
    if isinstance(result, str):
        return {"status": "success", "output": result}
    return result


def _obsidian_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch Obsidian vault actions."""
    try:
        from .obsidian_tool import (
            create_note, search_content, list_recent,
            daily_note, find_backlinks, list_tags, graph_neighbors,
        )
    except ImportError:
        return {"status": "error", "error": "Obsidian tool not available"}
    
    actions = {
        "create": lambda: create_note(
            title=kwargs.get("title", ""),
            content=kwargs.get("content", ""),
            folder=kwargs.get("folder"),
            tags=kwargs.get("tags"),
        ),
        "search": lambda: search_content(
            query=kwargs.get("query", ""),
        ),
        "list": lambda: list_recent(
            limit=kwargs.get("limit", 20),
        ),
        "read": lambda: search_content(
            query=kwargs.get("title", ""),
        ),
        "daily": lambda: daily_note(),
        "backlinks": lambda: find_backlinks(
            note_name=kwargs.get("title", ""),
        ),
        "tags": lambda: list_tags(),
        "graph": lambda: graph_neighbors(
            note_name=kwargs.get("title", ""),
        ),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown obsidian action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _process_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch process/window management actions."""
    from .exec_tool import get_session, kill_session, list_sessions
    try:
        from .process_tool import (
            list_processes, get_process_info, kill_process,
            list_windows, focus_window, send_keys, type_text,
            get_active_window, get_window_context, screenshot_window,
        )
    except ImportError:
        return {"status": "error", "error": "process_tool not available"}
    
    actions = {
        "exec_status": lambda: get_session(session_id=kwargs.get("session_id", "")),
        "exec_kill": lambda: kill_session(session_id=kwargs.get("session_id", "")),
        "exec_list": lambda: {"sessions": list_sessions(kwargs.get("active_only", False))},
        "list_processes": lambda: list_processes(name_filter=kwargs.get("name_filter"), limit=kwargs.get("limit")),
        "process_info": lambda: get_process_info(pid=kwargs.get("pid", 0)),
        "kill_process": lambda: kill_process(pid=kwargs.get("pid", 0), force=kwargs.get("force", False)),
        "list_windows": lambda: list_windows(title_filter=kwargs.get("title_filter")),
        "focus_window": lambda: focus_window(hwnd=kwargs.get("hwnd"), title=kwargs.get("title"), pid=kwargs.get("pid")),
        "send_keys": lambda: send_keys(keys=kwargs.get("keys", ""), hwnd=kwargs.get("hwnd"), title=kwargs.get("title")),
        "type_text": lambda: type_text(text=kwargs.get("text", ""), hwnd=kwargs.get("hwnd"), title=kwargs.get("title")),
        "active_window": lambda: get_active_window(),
        "window_context": lambda: get_window_context(),
        "screenshot_window": lambda: screenshot_window(hwnd=kwargs.get("hwnd"), title=kwargs.get("title"), save_path=kwargs.get("save_path")),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown process action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _media_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch media tool actions (GIF + PDF)."""
    if action in ("gif_search", "gif_random", "gif_trending"):
        try:
            from .gifgrep_tool import search as gif_search, random as gif_random, trending as gif_trending
            gif_actions = {
                "gif_search": lambda: gif_search(query=kwargs.get("query", ""), limit=kwargs.get("limit", 5)),
                "gif_random": lambda: gif_random(tag=kwargs.get("query", "")),
                "gif_trending": lambda: gif_trending(limit=kwargs.get("limit", 5)),
            }
            return gif_actions[action]()
        except ImportError:
            return {"status": "error", "error": "gifgrep_tool not available"}
    elif action in ("pdf_extract", "pdf_info", "pdf_search"):
        return _pdf_dispatch(
            action.replace("pdf_", "").replace("extract", "extract").replace("info", "metadata"),
            **kwargs
        )
    else:
        return {"status": "error", "error": f"Unknown media action: {action}. Available: gif_search, gif_random, gif_trending, pdf_extract, pdf_info, pdf_search"}


def _look_dispatch(**kwargs) -> Dict[str, Any]:
    """Camera — instant capture and describe."""
    try:
        from .camsnap_tool import look
        return look(**kwargs)
    except ImportError:
        return {"status": "error", "error": "camsnap_tool not available (needs opencv-python)"}


def _skills_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch skill management actions."""
    try:
        from .skills_tool import create_skill, find_skill, list_skills
    except ImportError:
        return {"status": "error", "error": "skills_tool not available"}
    
    actions = {
        "create": lambda: create_skill(
            name=kwargs.get("name", ""),
            content=kwargs.get("content", ""),
            description=kwargs.get("description", ""),
            triggers=kwargs.get("triggers", []),
        ),
        "find": lambda: find_skill(query=kwargs.get("query", "")),
        "list": lambda: list_skills(),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown skill action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _macro_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch macro actions: list, run, get."""
    try:
        from .macro_tool import list_macros, run_macro, get_macro
    except ImportError:
        return {"status": "error", "error": "macro_tool not available"}

    actions = {
        "list": lambda: list_macros(),
        "run": lambda: run_macro(
            name=kwargs.get("name", ""),
            variables=kwargs.get("variables", {}),
        ),
        "get": lambda: get_macro(name=kwargs.get("name", "")),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error", "error": f"Unknown macro action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


def _learn_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch skill learning actions — analyze, draft, save, promote."""
    try:
        from .skill_learner import (
            analyze_recording, generate_skill_draft,
            save_skill_draft, promote_skill,
        )
    except ImportError:
        return {"status": "error", "error": "skill_learner not available"}

    if action == "analyze":
        path = kwargs.get("path", "")
        if not path:
            return {"status": "error", "error": "path to recording JSON is required"}
        return analyze_recording(path)

    elif action == "draft":
        return generate_skill_draft(
            name=kwargs.get("name", ""),
            description=kwargs.get("description", ""),
            triggers=kwargs.get("triggers", []),
            goal=kwargs.get("goal", ""),
            apps=kwargs.get("apps", []),
            workflow_steps=kwargs.get("workflow_steps", []),
            decision_logic=kwargs.get("decision_logic", []),
            variables=kwargs.get("variables", []),
            success_criteria=kwargs.get("success_criteria", ""),
            notes=kwargs.get("notes", ""),
        )

    elif action == "save":
        return save_skill_draft(
            name=kwargs.get("name", ""),
            content=kwargs.get("content", ""),
        )

    elif action == "promote":
        return promote_skill(draft_path=kwargs.get("path", ""))

    else:
        return {"status": "error", "error": f"Unknown learn action: {action}. Available: analyze, draft, save, promote"}


def _agent_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch sub-agent actions — spawn, status, list, cancel, result."""
    try:
        from ..infra.subagents import (
            get_subagent_registry, SubagentStatus,
        )
    except ImportError:
        return {"status": "error", "error": "subagent infrastructure not available"}
    
    registry = get_subagent_registry()
    
    if action == "spawn":
        task_msg = kwargs.get("task", "")
        if not task_msg:
            return {"status": "error", "error": "task is required"}
        label = kwargs.get("label", "")
        model = kwargs.get("model")
        timeout = kwargs.get("timeout")
        wait = kwargs.get("wait", False)
        
        task = registry.spawn(
            name=label or task_msg[:60],
            message=task_msg,
            parent_session="main",
            model_override=model,
            timeout_seconds=timeout,
            wait=wait,
        )
        
        result = {
            "status": "accepted" if not wait else task.status.value,
            "run_id": task.id,
            "task": task.name,
        }
        if wait and task.result:
            result["output"] = task.result
        if wait and task.error:
            result["error"] = task.error
        return result
    
    elif action == "status":
        run_id = kwargs.get("run_id", "")
        if not run_id:
            return {"status": "error", "error": "run_id required"}
        task = registry.get_task(run_id)
        if not task:
            return {"status": "error", "error": f"No task found with id: {run_id}"}
        return task.to_dict()
    
    elif action == "list":
        tasks = registry.list_tasks(parent_session=kwargs.get("parent_session"))
        stats = registry.get_stats()
        return {"status": "success", "tasks": tasks, "stats": stats}
    
    elif action == "cancel":
        run_id = kwargs.get("run_id", "")
        if not run_id:
            return {"status": "error", "error": "run_id required"}
        cancelled = registry.cancel_task(run_id)
        if cancelled:
            return {"status": "success", "message": f"Task {run_id} cancelled"}
        task = registry.get_task(run_id)
        if task:
            return {"status": "error", "error": f"Cannot cancel task in state: {task.status.value}"}
        return {"status": "error", "error": f"No task found with id: {run_id}"}
    
    elif action == "result":
        run_id = kwargs.get("run_id", "")
        if not run_id:
            return {"status": "error", "error": "run_id required"}
        timeout = kwargs.get("timeout", 30)
        task = registry.wait_for_task(run_id, timeout=timeout)
        if not task:
            return {"status": "error", "error": f"No task found with id: {run_id}"}
        return {
            "status": task.status.value,
            "run_id": task.id,
            "task": task.name,
            "output": task.result,
            "error": task.error,
            "duration_seconds": round(task.completed_at - task.started_at, 1) if task.completed_at and task.started_at else None,
        }
    
    elif action == "cleanup":
        max_age = kwargs.get("max_age_seconds", 3600)
        registry.cleanup_old_tasks(max_age_seconds=max_age)
        return {"status": "success", "message": "Old tasks cleaned up"}
    
    else:
        return {"status": "error", "error": f"Unknown agent action: {action}. Available: spawn, status, list, cancel, result, cleanup"}


# ── Unified dispatchers (OpenClaw-style consolidation) ──────────────────

def _computer_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Unified computer control: desktop UI, mouse, screen capture, process management.
    Merges desktop + mouse + screen + process into one tool."""

    # ── Normalize common key aliases ──
    if "content" in kwargs and "text" not in kwargs:
        kwargs["text"] = kwargs.pop("content")
    if "query" in kwargs and "text" not in kwargs:
        kwargs["text"] = kwargs.pop("query")
    if "window" in kwargs and "title" not in kwargs:
        kwargs["title"] = kwargs.pop("window")
    if "name" in kwargs and "element_name" not in kwargs:
        kwargs["element_name"] = kwargs.pop("name")

    # ── Desktop UI actions (pywinauto) ──
    _desktop_actions = {
        "list_windows", "window_action", "get_elements", "dump_tree",
        "click", "type", "send_keys", "read_element", "select_item",
        "toggle", "expand_collapse", "scroll", "set_value", "drag",
        "get_props", "wait", "launch_app", "menu_select", "clipboard",
        "screenshot_window", "find_by_id", "read_table", "context_menu",
        "handle_dialog", "read_all_text", "invoke", "multi_select",
        "toolbar_click",
    }
    # ── Mouse actions ──
    _mouse_actions = {
        "mouse_click", "mouse_move", "mouse_drag", "mouse_scroll",
        "mouse_position", "screen_size", "hotkey",
    }
    # ── Screen actions ──
    _screen_actions = {
        "screenshot", "screen_info", "record_start", "record_stop",
        "record_status",
    }
    # ── Process actions ──
    _process_actions = {
        "exec_status", "exec_kill", "exec_list", "list_processes",
        "process_info", "kill_process", "focus_window", "process_send_keys",
        "process_type_text", "active_window", "window_context",
        "process_screenshot_window",
    }

    if action in _desktop_actions:
        result = _desktop_dispatch(action, **kwargs)
    elif action in _mouse_actions:
        short = action.replace("mouse_", "")
        result = _mouse_dispatch(short, **kwargs)
    elif action in _screen_actions:
        mapped = action.replace("screen_", "") if action.startswith("screen_") else action
        result = _screen_dispatch(mapped, **kwargs)
    elif action in _process_actions:
        if action == "process_send_keys":
            result = _process_dispatch("send_keys", **kwargs)
        elif action == "process_type_text":
            result = _process_dispatch("type_text", **kwargs)
        elif action == "process_screenshot_window":
            result = _process_dispatch("screenshot_window", **kwargs)
        else:
            result = _process_dispatch(action, **kwargs)
    else:
        all_actions = sorted(_desktop_actions | _mouse_actions | _screen_actions | _process_actions)
        return {"status": "error", "error": f"Unknown computer action: {action}. Available: {', '.join(all_actions)}"}

    # ── Enrich result with echo of what was done ──
    if isinstance(result, dict) and result.get("status") != "error":
        result.setdefault("action", action)
        # Echo key targeting params so LLM can confirm what was acted on
        for key in ("title", "element_name", "x", "y", "text", "keys", "pid", "session_id"):
            if key in kwargs and kwargs[key] is not None and key not in result:
                result[key] = kwargs[key]
    return result


def _text_editor_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Unified file operations: read, write, edit, list, info, grep.
    Merges read_file + write_file + edit_file + list_dir + file_info + grep."""
    try:
        from .exec_tool import exec_command
        from .file_tool import read_file, write_file, edit_file, list_directory, file_info
        from .grep_tool import grep
    except ImportError as e:
        return {"status": "error", "error": f"File tools not available: {e}"}

    # ── Normalize common key aliases ──
    if "file" in kwargs and "path" not in kwargs:
        kwargs["path"] = kwargs.pop("file")
    if "file_path" in kwargs and "path" not in kwargs:
        kwargs["path"] = kwargs.pop("file_path")
    if "text" in kwargs and "content" not in kwargs and action == "write":
        kwargs["content"] = kwargs.pop("text")
    if "search" in kwargs and "query" not in kwargs:
        kwargs["query"] = kwargs.pop("search")
    if "pattern" in kwargs and "query" not in kwargs and action == "grep":
        kwargs["query"] = kwargs.pop("pattern")

    if action == "read":
        return read_file(
            path=kwargs.get("path", ""),
            start_line=kwargs.get("start_line"),
            end_line=kwargs.get("end_line"),
        )
    elif action == "write":
        return write_file(
            path=kwargs.get("path", ""),
            content=kwargs.get("content", ""),
            overwrite=kwargs.get("overwrite", False),
        )
    elif action == "edit":
        return edit_file(
            path=kwargs.get("path", ""),
            old_string=kwargs.get("old_string", ""),
            new_string=kwargs.get("new_string", ""),
            replace_all=kwargs.get("replace_all", False),
        )
    elif action == "list":
        return list_directory(
            path=kwargs.get("path", "."),
            recursive=kwargs.get("recursive", False),
            pattern=kwargs.get("pattern"),
        )
    elif action == "info":
        return file_info(path=kwargs.get("path", ""))
    elif action == "grep":
        return grep(
            query=kwargs.get("query", ""),
            path=kwargs.get("path"),
            includes=kwargs.get("includes"),
            fixed_strings=kwargs.get("fixed_strings", False),
            context_lines=kwargs.get("context_lines"),
            max_results=kwargs.get("max_results"),
        )
    else:
        return {"status": "error", "error": f"Unknown text_editor action: {action}. Available: read, write, edit, list, info, grep"}


class ToolPolicy(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"  # Requires user confirmation


@dataclass
class ToolExecution:
    """Record of a tool execution."""
    tool_name: str
    args: Dict[str, Any]
    result: Dict[str, Any]
    started_at: float
    ended_at: float
    success: bool
    error: Optional[str] = None
    
    @property
    def duration_ms(self) -> int:
        return int((self.ended_at - self.started_at) * 1000)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool": self.tool_name,
            "args": self.args,
            "result": self.result,
            "duration_ms": self.duration_ms,
            "success": self.success,
            "error": self.error,
        }


@dataclass
class RegisteredTool:
    """A registered tool."""
    name: str
    description: str
    execute: Callable
    schema: Optional[Dict[str, Any]] = None
    policy: ToolPolicy = ToolPolicy.ALLOW
    requires_confirmation: bool = False
    category: str = "core"


class ToolRegistry:
    """
    Central registry for all tools.
    
    Provides:
    - Tool registration
    - Tool execution with logging
    - Policy enforcement
    - Execution history
    """
    
    def __init__(self):
        self._tools: Dict[str, RegisteredTool] = {}
        self._history: List[ToolExecution] = []
        self._lock = threading.Lock()
        self._max_history = 100
        
        # Default policy settings
        self._global_policy = ToolPolicy.ALLOW
        self._tool_policies: Dict[str, ToolPolicy] = {}
        self._denied_tools: set = set()
        self._allowed_tools: set = set()  # If non-empty, only these are allowed
    
    def register(
        self,
        name: str,
        execute: Callable,
        description: str = "",
        schema: Optional[Dict[str, Any]] = None,
        policy: ToolPolicy = ToolPolicy.ALLOW,
        requires_confirmation: bool = False,
        category: str = "core",
    ) -> None:
        """Register a tool."""
        with self._lock:
            self._tools[name] = RegisteredTool(
                name=name,
                description=description,
                execute=execute,
                schema=schema,
                policy=policy,
                requires_confirmation=requires_confirmation,
                category=category,
            )
            logger.info(f"Registered tool: {name} (category={category})")
    
    def register_tool_class(self, tool_class) -> None:
        """Register a tool from a class with name, description, and execute method."""
        name = getattr(tool_class, 'name', tool_class.__name__.lower())
        description = getattr(tool_class, 'description', '')
        schema = getattr(tool_class, 'schema', None)
        execute = getattr(tool_class, 'execute', None)
        
        if execute is None:
            raise ValueError(f"Tool class {tool_class} must have an execute method")
        
        self.register(
            name=name,
            execute=execute,
            description=description,
            schema=schema,
        )
    
    def unregister(self, name: str) -> bool:
        """Unregister a tool."""
        with self._lock:
            if name in self._tools:
                del self._tools[name]
                logger.info(f"Unregistered tool: {name}")
                return True
            return False
    
    def get_tool(self, name: str) -> Optional[RegisteredTool]:
        """Get a registered tool by name."""
        return self._tools.get(name)
    
    def list_tools(self) -> List[Dict[str, Any]]:
        """List all registered tools."""
        tools = []
        for tool in self._tools.values():
            tools.append({
                "name": tool.name,
                "description": tool.description,
                "schema": tool.schema,
                "policy": tool.policy.value,
            })
        return tools
    
    def set_policy(
        self,
        tool_name: Optional[str] = None,
        policy: ToolPolicy = ToolPolicy.ALLOW,
    ) -> None:
        """Set policy for a tool or globally."""
        with self._lock:
            if tool_name:
                self._tool_policies[tool_name] = policy
            else:
                self._global_policy = policy
    
    def deny_tool(self, name: str) -> None:
        """Add a tool to the deny list."""
        with self._lock:
            self._denied_tools.add(name)
    
    def allow_tool(self, name: str) -> None:
        """Add a tool to the allow list."""
        with self._lock:
            self._allowed_tools.add(name)
            self._denied_tools.discard(name)
    
    def _check_policy(self, name: str) -> ToolPolicy:
        """Check the effective policy for a tool."""
        # Deny list takes precedence
        if name in self._denied_tools:
            return ToolPolicy.DENY
        
        # If allow list is set, only those tools are allowed
        if self._allowed_tools and name not in self._allowed_tools:
            return ToolPolicy.DENY
        
        # Check tool-specific policy
        if name in self._tool_policies:
            return self._tool_policies[name]
        
        # Check tool's default policy
        tool = self._tools.get(name)
        if tool:
            return tool.policy
        
        # Fall back to global policy
        return self._global_policy
    
    def execute(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
        skip_policy: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute a tool by name.
        
        Args:
            name: Tool name
            args: Tool arguments
            skip_policy: Skip policy check (use with caution)
            
        Returns:
            Tool result
        """
        args = args or {}
        started_at = time.time()
        
        # Check if tool exists — auto-load on-demand tools if needed
        tool = self._tools.get(name)
        if not tool:
            if name in _ON_DEMAND_TOOLS:
                try:
                    _ON_DEMAND_TOOLS[name]["register"](self)
                    tool = self._tools.get(name)
                    logger.info(f"Auto-loaded on-demand tool: {name}")
                except Exception as e:
                    logger.warning(f"Failed to auto-load tool {name}: {e}")
            if not tool:
                return {
                    "status": "error",
                    "error": f"Tool not found: {name}",
                    "available_tools": list(self._tools.keys()),
                }
        
        # Check policy
        if not skip_policy:
            policy = self._check_policy(name)
            if policy == ToolPolicy.DENY:
                return {
                    "status": "denied",
                    "error": f"Tool '{name}' is not allowed by policy",
                }
            elif policy == ToolPolicy.ASK:
                return {
                    "status": "confirmation_required",
                    "tool": name,
                    "args": args,
                    "message": f"Tool '{name}' requires confirmation before execution",
                }
        
        # Execute tool
        try:
            logger.info(f"Executing tool: {name} with args: {list(args.keys())}")
            result = tool.execute(**args)
            
        except Exception as e:
            logger.error(f"Tool execution error: {name} - {e}")
            result = {
                "status": "error",
                "error": str(e),
            }
        
        ended_at = time.time()
        duration_ms = int((ended_at - started_at) * 1000)
        
        # Normalize result through standard contract
        try:
            from ..infra.tool_result import normalize_tool_result
            result = normalize_tool_result(name, result, duration_ms=duration_ms)
            success = result.get("_success", True)
            error = result.get("_error")
        except Exception:
            # Fallback if normalization fails
            success = result.get("status") != "error" if isinstance(result, dict) else True
            error = result.get("error") if isinstance(result, dict) else None
        
        # Record execution
        execution = ToolExecution(
            tool_name=name,
            args=args,
            result=result,
            started_at=started_at,
            ended_at=ended_at,
            success=success,
            error=error,
        )
        
        with self._lock:
            self._history.append(execution)
            # Trim history
            if len(self._history) > self._max_history:
                self._history = self._history[-self._max_history:]
        
        logger.info(f"Tool {name} completed in {execution.duration_ms}ms (success={success})")
        
        return result
    
    def get_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get recent tool execution history."""
        with self._lock:
            return [e.to_dict() for e in self._history[-limit:]]
    
    def get_categories(self) -> Dict[str, List[str]]:
        """Get all categories and their tool names."""
        cats: Dict[str, List[str]] = {}
        for tool in self._tools.values():
            cats.setdefault(tool.category, []).append(tool.name)
        return cats
    
    def get_schemas_for_llm(self, categories: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Get tool schemas for LLM. If categories given, only include those categories."""
        schemas = []
        for tool in self._tools.values():
            if self._check_policy(tool.name) == ToolPolicy.DENY:
                continue
            if categories is not None and tool.category not in categories:
                continue
            
            schema = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.schema or {
                        "type": "object",
                        "properties": {},
                    },
                },
            }
            schemas.append(schema)
        
        return schemas
    
    def get_ollama_tools(self, categories: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Get tool schemas in Ollama's tool format."""
        tools = []
        for tool in self._tools.values():
            if self._check_policy(tool.name) == ToolPolicy.DENY:
                continue
            if categories is not None and tool.category not in categories:
                continue
            
            tool_def = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.schema or {
                        "type": "object",
                        "properties": {},
                    },
                },
            }
            tools.append(tool_def)
        
        return tools


# Global registry instance
_registry: Optional[ToolRegistry] = None

def get_tool_registry() -> ToolRegistry:
    """Get the global tool registry, creating it if needed."""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
        _register_default_tools(_registry)
    return _registry


# Keep these for backward compat — they're no-ops now since all tools are always active
def get_active_categories() -> List[str]:
    """Get the currently active tool categories (all tools always active)."""
    return ["core"]


def set_active_categories(categories: List[str]) -> None:
    """No-op — all tools are always active now."""
    pass


def _register_default_tools(registry: ToolRegistry) -> None:
    """Register core tools — shell-first philosophy.
    
    Only 4 tools are always-on (OpenClaw-style). Everything else loads on-demand
    via load_contextual_tools() when the user's message warrants them.
    
    Core tools: bash, text_editor, computer, browser
    """
    from .exec_tool import exec_command
    
    # ── bash: shell command execution ──────────────────────────────────
    registry.register(
        name="bash",
        execute=exec_command,
        description="Run shell commands (PowerShell/CMD/Bash). Use for system info, installing packages, running scripts, opening apps, and anything else you can do from a terminal. Use background=true for long-running commands. Check on background commands with computer(action='exec_status', session_id=...).",
        schema={
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to execute"},
                "cwd": {"type": "string", "description": "Working directory"},
                "timeout_sec": {"type": "integer", "description": "Timeout in seconds"},
                "background": {"type": "boolean", "description": "Run in background"},
            },
            "required": ["command"],
        },
    )
    
    # ── text_editor: all file operations ───────────────────────────────
    registry.register(
        name="text_editor",
        execute=lambda action, **kwargs: _text_editor_dispatch(action, **kwargs),
        description="File operations: read, write, edit, list, info, grep. Use action='grep' to find files/lines, action='read' to view content, action='edit' for surgical find-and-replace, action='write' for new files, action='list' for directory contents, action='info' for metadata.",
        schema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["read", "write", "edit", "list", "info", "grep"]},
                "path": {"type": "string", "description": "File or directory path"},
                "content": {"type": "string", "description": "Content for write action"},
                "old_string": {"type": "string", "description": "Text to find (for edit)"},
                "new_string": {"type": "string", "description": "Replacement text (for edit)"},
                "replace_all": {"type": "boolean", "description": "Replace all occurrences (for edit)"},
                "overwrite": {"type": "boolean", "description": "Overwrite existing file (for write)"},
                "start_line": {"type": "integer", "description": "Start line for read (1-indexed)"},
                "end_line": {"type": "integer", "description": "End line for read (inclusive)"},
                "query": {"type": "string", "description": "Search pattern for grep (regex by default)"},
                "includes": {"type": "array", "items": {"type": "string"}, "description": "Glob filters for grep, e.g. [\"*.py\"]"},
                "fixed_strings": {"type": "boolean", "description": "Treat grep query as literal"},
                "context_lines": {"type": "integer", "description": "Context lines for grep (0-5)"},
                "max_results": {"type": "integer", "description": "Max grep matches"},
                "recursive": {"type": "boolean", "description": "Recursive listing (for list)"},
                "pattern": {"type": "string", "description": "Glob filter (for list)"},
            },
            "required": ["action"],
        },
    )
    
    # ── computer: unified desktop control ──────────────────────────────
    registry.register(
        name="computer",
        execute=lambda action, **kwargs: _computer_dispatch(action, **kwargs),
        description=(
            "Control the computer: desktop UI, mouse, screen capture, process management. "
            "Desktop UI (pywinauto): list_windows, get_elements, click, type, send_keys, read_element, read_all_text, scroll, launch_app, menu_select, clipboard, handle_dialog, drag, etc. "
            "Mouse: mouse_click, mouse_move, mouse_drag, mouse_scroll, mouse_position, screen_size, hotkey. "
            "Screen: screenshot, screen_info, record_start, record_stop. "
            "Process: exec_status, exec_kill, exec_list, list_processes, kill_process, focus_window, active_window. "
            "Extra params (automation_id, click_type, from_x/from_y/to_x/to_y, region, quality, etc.) are accepted as needed."
        ),
        schema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "description": "Action to perform (see description for full list)"},
                "title": {"type": "string", "description": "Window title substring"},
                "element_name": {"type": "string", "description": "UI element name or button name"},
                "text": {"type": "string", "description": "Text to type or content"},
                "keys": {"type": "string", "description": "Key sequence for send_keys/hotkey"},
                "x": {"type": "integer", "description": "X coordinate"},
                "y": {"type": "integer", "description": "Y coordinate"},
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                "session_id": {"type": "string", "description": "Background exec session ID"},
                "pid": {"type": "integer", "description": "Process ID"},
                "path": {"type": "string", "description": "File path (for save_path, launch, etc.)"},
            },
            "required": ["action"],
        },
    )

    # ── browser: CDP browser control ───────────────────────────────────
    registry.register(
        name="browser",
        execute=lambda action, **kwargs: _browser_dispatch(action, **kwargs),
        description=(
            "Control browser via Chrome DevTools Protocol (separate instance, not user's browser). "
            "WORKFLOW: snapshot → click_ref @N / type_ref @N. "
            "Actions: start, stop, navigate, snapshot, click_ref, type_ref, read, screenshot, eval, scroll, press_key, "
            "tabs, new_tab, close_tab, back, forward, wait_for, wait_time, status, and more."
        ),
        schema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["start", "stop", "navigate", "snapshot", "click_ref", "type_ref", "read", "screenshot", "eval", "scroll", "press_key", "tabs", "new_tab", "close_tab", "back", "forward", "wait_for", "wait_time", "status", "open_default", "elements", "click", "type", "hover", "select", "upload", "pdf", "dialog", "resize", "fill", "console", "activate_tab", "snapshot_enhanced", "click_enhanced", "type_slowly", "wait_text_gone", "screenshot_element", "drag"]},
                "url": {"type": "string", "description": "URL for navigate/start"},
                "selector": {"type": "string", "description": "CSS selector"},
                "text": {"type": "string", "description": "Text for type/type_ref"},
                "ref": {"type": "string", "description": "Element @ref from snapshot"},
                "tab_id": {"type": "string", "description": "Target tab ID"},
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                "amount": {"type": "integer", "description": "Scroll pixels (default 500)"},
                "key": {"type": "string", "description": "Key for press_key"},
                "expression": {"type": "string", "description": "JS for eval"},
                "clear": {"type": "boolean", "description": "Clear before typing"},
                "submit": {"type": "boolean", "description": "Press Enter after typing"},
                "timeout": {"type": "number", "description": "Wait timeout in seconds"},
                "max_elements": {"type": "integer", "description": "Max elements for snapshot"},
                "quality": {"type": "integer", "description": "Screenshot JPEG quality"},
                "full_page": {"type": "boolean", "description": "Full page screenshot"},
            },
            "required": ["action"],
        },
    )

    # ── web_search + web_fetch + browser_open ────────────────────────
    _register_web_tools(registry)

    # ── memory ────────────────────────────────────────────────────────
    registry.register(
        name="memory",
        execute=lambda action, **kwargs: _memory_dispatch(action, **kwargs),
        description="Search conversation memory, read user facts, or store new facts. Proactively store facts when user shares personal info. Actions: search, facts, store_fact.",
        schema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["search", "facts", "store_fact"]},
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer"},
                "key": {"type": "string", "description": "Fact key for store_fact"},
                "value": {"type": "string", "description": "Fact value for store_fact"},
            },
            "required": ["action"],
        },
    )

    logger.info(f"Registered {len(registry._tools)} core tools")


# ── On-demand tool definitions (loaded only when relevant) ─────────────

_ON_DEMAND_TOOLS = {
    "generate_image": {
        "keywords": ["generate image", "create image", "draw", "make a picture", "make an image", "dall-e", "dalle", "imagen", "image generation", "generate a photo", "create a picture", "make art", "generate art"],
        "register": lambda reg: reg.register(
            name="generate_image",
            execute=lambda **kwargs: _image_gen_dispatch(**kwargs),
            description="Generate an image from a text prompt using DALL-E 3 (OpenAI) or Imagen (Google). Returns the image inline in chat.",
            schema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Detailed text description of the image to generate."},
                    "provider": {"type": "string", "enum": ["auto", "openai", "google"], "description": "Provider: auto (default), openai, or google."},
                    "size": {"type": "string", "enum": ["1024x1024", "1792x1024", "1024x1792"], "description": "Image size."},
                    "quality": {"type": "string", "enum": ["auto", "standard", "hd"], "description": "Quality (OpenAI only)."},
                    "style": {"type": "string", "enum": ["vivid", "natural"], "description": "Style (OpenAI only)."},
                },
                "required": ["prompt"],
            },
            category="media",
        ),
    },
    "pdf": {
        "keywords": ["pdf", ".pdf", "read pdf", "extract pdf", "pdf text", "pdf file", "document"],
        "register": lambda reg: reg.register(
            name="pdf",
            execute=lambda action, **kwargs: _pdf_dispatch(action, **kwargs),
            description="Read and search PDF files. Actions: extract (get text), metadata (page count, author), search (find text in PDF).",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["extract", "metadata", "search"]},
                    "path": {"type": "string", "description": "Path to PDF file"},
                    "pages": {"type": "array", "items": {"type": "integer"}, "description": "Specific pages to extract (1-indexed)"},
                    "query": {"type": "string", "description": "Search query (for search action)"},
                    "max_chars": {"type": "integer", "description": "Max characters to return"},
                    "max_results": {"type": "integer", "description": "Max search results"},
                },
                "required": ["action", "path"],
            },
        ),
    },
    "obsidian": {
        "keywords": ["obsidian", "vault", "note", "daily note", "backlink", "knowledge base", "zettelkasten"],
        "register": lambda reg: reg.register(
            name="obsidian",
            execute=lambda action, **kwargs: _obsidian_dispatch(action, **kwargs),
            description="Manage Obsidian vault: create/read/search notes, daily notes, backlinks, tags, graph neighbors.",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "search", "list", "read", "daily", "backlinks", "tags", "graph"]},
                    "title": {"type": "string", "description": "Note title"},
                    "content": {"type": "string", "description": "Note content (markdown)"},
                    "folder": {"type": "string", "description": "Subfolder in vault"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to add"},
                    "query": {"type": "string", "description": "Search query"},
                    "limit": {"type": "integer", "description": "Max results"},
                    "max_results": {"type": "integer"},
                },
                "required": ["action"],
            },
        ),
    },
    "skill": {
        "keywords": ["skill", "workflow", "create skill", "find skill", "list skill", "automate"],
        "register": lambda reg: reg.register(
            name="skill",
            execute=lambda action, **kwargs: _skills_dispatch(action, **kwargs),
            description="Manage reusable workflow skills. Actions: create, find, list.",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "find", "list"]},
                    "name": {"type": "string"}, "content": {"type": "string"},
                    "description": {"type": "string"},
                    "triggers": {"type": "array", "items": {"type": "string"}},
                    "query": {"type": "string"},
                },
                "required": ["action"],
            },
        ),
    },
    "learn": {
        "keywords": ["learn", "recording", "f9", "skill learning", "analyze recording", "practice"],
        "register": lambda reg: reg.register(
            name="learn",
            execute=lambda action, **kwargs: _learn_dispatch(action, **kwargs),
            description="Skill learning from F9 recordings. Actions: analyze, draft, save, promote.",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["analyze", "draft", "save", "promote"]},
                    "path": {"type": "string"}, "name": {"type": "string"},
                    "description": {"type": "string"},
                    "triggers": {"type": "array", "items": {"type": "string"}},
                    "goal": {"type": "string"},
                    "apps": {"type": "array", "items": {"type": "string"}},
                    "workflow_steps": {"type": "array", "items": {"type": "string"}},
                    "decision_logic": {"type": "array", "items": {"type": "string"}},
                    "variables": {"type": "array", "items": {"type": "object"}},
                    "success_criteria": {"type": "string"},
                    "notes": {"type": "string"}, "content": {"type": "string"},
                },
                "required": ["action"],
            },
        ),
    },
    "media": {
        "keywords": ["gif", "giphy", "trending gif", "meme", "reaction gif"],
        "register": lambda reg: reg.register(
            name="media",
            execute=lambda action, **kwargs: _media_dispatch(action, **kwargs),
            description="GIF search. Actions: gif_search, gif_random, gif_trending.",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["gif_search", "gif_random", "gif_trending"]},
                    "query": {"type": "string"}, "limit": {"type": "integer"},
                },
                "required": ["action"],
            },
        ),
    },
    "look": {
        "keywords": ["camera", "webcam", "look at me", "take a photo", "see me", "what do i look like", "snap", "capture photo"],
        "register": lambda reg: reg.register(
            name="look",
            execute=lambda **kwargs: _look_dispatch(**kwargs),
            description="Capture a photo from the webcam and describe what's seen.",
            schema={
                "type": "object",
                "properties": {
                    "describe": {"type": "boolean", "description": "Auto-describe (default: true)"},
                    "camera_index": {"type": "integer"},
                },
            },
        ),
    },
    "notify": {
        "keywords": ["notify", "notification", "push notification", "alert me", "remind me", "send notification"],
        "register": lambda reg: reg.register(
            name="notify",
            execute=lambda **kwargs: _notify_dispatch(**kwargs),
            description="Send a push notification to the user's device.",
            schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"}, "body": {"type": "string"},
                },
                "required": ["title", "body"],
            },
        ),
    },
    "macro": {
        "keywords": ["macro", "run macro", "list macros"],
        "register": lambda reg: reg.register(
            name="macro",
            execute=lambda action, **kwargs: _macro_dispatch(action, **kwargs),
            description="Run deterministic parameterized macros. Macros are pre-built scripts with {{variable}} slots — you fill in the variables contextually, the script executes deterministically. Actions: list (see available macros), run (execute a macro with variables), get (view macro details).",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "run", "get"], "description": "list=see all macros, run=execute a macro, get=view macro details"},
                    "name": {"type": "string", "description": "Macro name or ID (for run/get)"},
                    "variables": {"type": "object", "description": "Variable values to fill into the macro template (for run). Keys are variable names, values are the content."},
                },
                "required": ["action"],
            },
            category="automation",
        ),
    },
    "agent": {
        "keywords": ["sub-agent", "subagent", "background task", "parallel", "spawn agent", "run in background"],
        "register": lambda reg: reg.register(
            name="agent",
            execute=lambda action, **kwargs: _agent_dispatch(action, **kwargs),
            description="Spawn and manage background sub-agents for parallel work. Actions: spawn, status, list, cancel, result.",
            schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["spawn", "status", "list", "cancel", "result"]},
                    "task": {"type": "string"}, "run_id": {"type": "string"},
                    "wait": {"type": "boolean"},
                },
                "required": ["action"],
            },
        ),
    },
}


def _notify_dispatch(title="Substrate", body="", tag=""):
    """Send a push notification to connected WebUI clients."""
    try:
        import requests as _req
        resp = _req.post(
            "http://localhost:8765/api/notify",
            json={"title": title, "body": body, "tag": tag},
            timeout=5,
        )
        resp.raise_for_status()
        return {"success": True, "message": f"Notification sent: {title}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _image_gen_dispatch(prompt="", provider="auto", size="1024x1024", quality="auto", style="vivid", **kwargs):
    """Generate an image and return result with image data for inline rendering."""
    try:
        from .image_gen_tool import generate_image
        result = generate_image(
            prompt=prompt,
            provider=provider,
            size=size,
            quality=quality,
            style=style,
        )
        # Return full result including image_base64 so proxy_server can send image message
        return result
    except ImportError:
        return {"success": False, "error": "image_gen_tool module not available"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _register_web_tools(reg):
    """Register web_search and web_fetch. browser_open is now browser(action='open_default')."""
    try:
        from .web_tool import web_search, web_fetch
        reg.register(name="web_search", execute=web_search,
            description="Search the web for up-to-date information. Returns a summarized answer with citations.",
            schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]})
        reg.register(name="web_fetch", execute=web_fetch,
            description="Fetch and extract readable content from a URL as markdown. Use to read web pages yourself.",
            schema={"type": "object", "properties": {"url": {"type": "string"}, "extract_mode": {"type": "string", "enum": ["markdown", "text"]}, "max_chars": {"type": "integer"}}, "required": ["url"]})
    except ImportError as e:
        logger.warning(f"web tools not available: {e}")


def load_contextual_tools(user_message: str, registry: Optional['ToolRegistry'] = None) -> List[str]:
    """Scan user message and load on-demand tools if keywords match.
    
    Returns list of tool names that were loaded.
    """
    if registry is None:
        registry = get_tool_registry()
    
    loaded = []
    text_lower = user_message.lower() if user_message else ""
    
    for tool_name, config in _ON_DEMAND_TOOLS.items():
        if registry.get_tool(tool_name):
            continue
        if any(kw in text_lower for kw in config["keywords"]):
            try:
                config["register"](registry)
                loaded.append(tool_name)
                logger.info(f"On-demand tool loaded: {tool_name}")
            except Exception as e:
                logger.warning(f"Failed to load on-demand tool {tool_name}: {e}")
    
    return loaded


def register_mcp_tools(registry: Optional['ToolRegistry'] = None) -> int:
    """Discover and flat-register MCP server tools into the ToolRegistry.
    
    Connects to all configured MCP servers, discovers their tools,
    and registers each one as a first-class tool with its own schema.
    
    Returns the number of MCP tools registered.
    """
    try:
        from ..infra.mcp_client import get_mcp_manager
    except ImportError:
        logger.warning("MCP client infrastructure not available")
        return 0
    
    manager = get_mcp_manager()
    if not manager:
        logger.debug("No MCP manager initialized, skipping MCP tool registration")
        return 0
    
    if registry is None:
        registry = get_tool_registry()
    
    tools = manager.get_discovered_tools()
    if not tools:
        logger.info("No MCP tools discovered")
        return 0
    
    count = 0
    for tool_info in tools:
        # Create a closure that captures the registered_name for this specific tool
        def _make_executor(reg_name):
            def _execute(**kwargs):
                mgr = get_mcp_manager()
                if not mgr:
                    return {"status": "error", "error": "MCP client not available"}
                return mgr.call_tool(reg_name, **kwargs)
            return _execute
        
        registry.register(
            name=tool_info.registered_name,
            execute=_make_executor(tool_info.registered_name),
            description=tool_info.description,
            schema=tool_info.schema,
            category="mcp",
        )
        count += 1
    
    logger.info(f"Registered {count} MCP tool(s) from external servers")
    return count


def execute_tool(name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Convenience function to execute a tool by name.
    
    Args:
        name: Tool name
        args: Tool arguments
        
    Returns:
        Tool result
    """
    registry = get_tool_registry()
    return registry.execute(name, args)
