"""
Desktop Tool - pywinauto-based desktop automation (compact)
============================================================

Full Windows UI Automation via pywinauto 'uia' backend.
Merged tools to minimize schema token cost while keeping all capabilities.
"""

import os
import time
import json
import logging
import subprocess
from typing import Dict, Any, Optional, List

logger = logging.getLogger("tools.desktop")

# Lazy import
_pywinauto = None
_Desktop = None

HAS_PYWINAUTO = False
try:
    import pywinauto
    HAS_PYWINAUTO = True
except ImportError:
    pass


def _get_pywinauto():
    global _pywinauto, _Desktop
    if _pywinauto is None:
        import pywinauto
        from pywinauto import Desktop
        _pywinauto = pywinauto
        _Desktop = Desktop
    return _pywinauto, _Desktop


def _get_window(title):
    """Find first window matching title substring. Returns (window, error_dict)."""
    pwa, Desktop = _get_pywinauto()
    desktop = Desktop(backend="uia")
    windows = desktop.windows(title_re=f".*{title}.*")
    if not windows:
        return None, {"success": False, "error": f"No window matching '{title}'"}
    return windows[0], None


def _rect_dict(r):
    return {"left": r.left, "top": r.top, "right": r.right, "bottom": r.bottom}


# ============================================================================
# 1. desktop_list_windows — discover open windows
# ============================================================================

def desktop_list_windows(**kwargs) -> Dict[str, Any]:
    """List all visible top-level windows."""
    try:
        pwa, Desktop = _get_pywinauto()
        desktop = Desktop(backend="uia")
        result = []
        for w in desktop.windows():
            try:
                title = w.window_text()
                if not title or not title.strip():
                    continue
                result.append({
                    "title": title,
                    "class": w.class_name(),
                    "pid": w.process_id(),
                    "rect": _rect_dict(w.rectangle()),
                })
            except Exception:
                continue
        return {"success": True, "windows": result, "count": len(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 2. desktop_window_action — focus/minimize/maximize/restore/close/move/resize
# ============================================================================

def desktop_window_action(title: str, action: str, x: int = None, y: int = None,
                          width: int = None, height: int = None, **kwargs) -> Dict[str, Any]:
    """Perform an action on a window: focus, minimize, maximize, restore, close, move, resize."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        name = w.window_text()
        act = action.lower()
        if act == "focus":
            w.set_focus(); time.sleep(0.05)
        elif act == "minimize":
            w.minimize()
        elif act == "maximize":
            w.maximize()
        elif act == "restore":
            w.restore()
        elif act == "close":
            w.close()
        elif act == "move" and x is not None and y is not None:
            w.move_window(x=x, y=y)
        elif act == "resize" and width is not None and height is not None:
            rect = w.rectangle()
            w.move_window(x=rect.left, y=rect.top, width=width, height=height)
        else:
            return {"success": False, "error": f"Unknown action '{action}'. Use: focus, minimize, maximize, restore, close, move, resize"}
        return {"success": True, "message": f"{act}: {name}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 3. desktop_get_elements — inspect UI tree
# ============================================================================

def desktop_get_elements(title: str, control_type: str = "", name_filter: str = "",
                         max_depth: int = 5, **kwargs) -> Dict[str, Any]:
    """Inspect UI elements in a window. Filter by control_type (Button, Edit, Text, MenuItem, ListItem, TreeItem, ComboBox, CheckBox, RadioButton, Tab, Hyperlink) and/or name substring."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        elements = []
        _walk_elements(w, elements, control_type, name_filter, max_depth, 0)
        return {
            "success": True, "window": w.window_text(),
            "elements": elements[:100], "total": len(elements),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _walk_elements(el, results, ct_filter, name_filter, max_depth, depth):
    if depth > max_depth:
        return
    try:
        children = el.children()
    except Exception:
        return
    for child in children:
        try:
            ct = child.element_info.control_type
            name = child.window_text() or ""
            match = True
            if ct_filter and ct.lower() != ct_filter.lower():
                match = False
            if name_filter and name_filter.lower() not in name.lower():
                match = False
            if match:
                entry = {"name": name, "type": ct, "rect": _rect_dict(child.rectangle()), "enabled": child.is_enabled()}
                try:
                    if ct in ("Edit", "ComboBox", "Spinner"):
                        vp = child.iface_value
                        if vp:
                            entry["value"] = vp.CurrentValue
                except Exception:
                    pass
                results.append(entry)
            _walk_elements(child, results, ct_filter, name_filter, max_depth, depth + 1)
        except Exception:
            continue


# ============================================================================
# 4. desktop_dump_tree — full text hierarchy for debugging
# ============================================================================

def desktop_dump_tree(title: str, max_depth: int = 4, **kwargs) -> Dict[str, Any]:
    """Dump the full UI element tree as indented text. Great for debugging what's in a window."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        lines = []
        _dump_tree(w, lines, max_depth, 0)
        return {"success": True, "window": w.window_text(), "tree": "\n".join(lines[:500])}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _dump_tree(el, lines, max_depth, depth):
    if depth > max_depth:
        return
    try:
        children = el.children()
    except Exception:
        return
    for child in children:
        try:
            ct = child.element_info.control_type
            name = child.window_text() or ""
            indent = "  " * depth
            lines.append(f"{indent}[{ct}] {name!r}")
            _dump_tree(child, lines, max_depth, depth + 1)
        except Exception:
            continue


# ============================================================================
# 5. desktop_click_element — click/right-click/double-click by name
# ============================================================================

def desktop_click_element(title: str, element_name: str, control_type: str = "",
                          click_type: str = "left", **kwargs) -> Dict[str, Any]:
    """Click a UI element by name. click_type: left (default), right, double."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, control_type)
        if not el:
            return {"success": False, "error": f"Element '{element_name}' not found. Use desktop_get_elements first."}
        ct = click_type.lower()
        if ct == "right":
            el.click_input(button="right")
        elif ct == "double":
            el.click_input(double=True)
        else:
            el.click_input()
        time.sleep(0.05)
        return {"success": True, "message": f"{ct}-clicked '{el.window_text()}' ({el.element_info.control_type})"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 6. desktop_type_in_element — type into text fields by name
# ============================================================================

def _clipboard_paste(text):
    """Instant text entry via Win32 clipboard + keybd_event Ctrl+V. Zero pyautogui overhead."""
    import ctypes
    CF_UNICODETEXT = 13
    KEYEVENTF_KEYUP = 0x0002
    VK_CONTROL = 0x11
    VK_V = 0x56
    u32 = ctypes.windll.user32
    k32 = ctypes.windll.kernel32

    # Save current clipboard
    old_clip = None
    try:
        if u32.OpenClipboard(0):
            h = u32.GetClipboardData(CF_UNICODETEXT)
            if h:
                p = k32.GlobalLock(h)
                if p:
                    old_clip = ctypes.wstring_at(p)
                    k32.GlobalUnlock(h)
            u32.CloseClipboard()
    except Exception:
        pass

    # Set new text to clipboard
    if u32.OpenClipboard(0):
        u32.EmptyClipboard()
        data = text.encode('utf-16-le') + b'\x00\x00'
        h = k32.GlobalAlloc(0x0042, len(data))
        p = k32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k32.GlobalUnlock(h)
        u32.SetClipboardData(CF_UNICODETEXT, h)
        u32.CloseClipboard()

    # Ctrl+V via direct Win32 keybd_event (no pyautogui overhead)
    u32.keybd_event(VK_CONTROL, 0, 0, 0)
    u32.keybd_event(VK_V, 0, 0, 0)
    u32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
    u32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.02)

    # Restore old clipboard
    if old_clip is not None:
        try:
            if u32.OpenClipboard(0):
                u32.EmptyClipboard()
                data = old_clip.encode('utf-16-le') + b'\x00\x00'
                h = k32.GlobalAlloc(0x0042, len(data))
                p = k32.GlobalLock(h)
                ctypes.memmove(p, data, len(data))
                k32.GlobalUnlock(h)
                u32.SetClipboardData(CF_UNICODETEXT, h)
                u32.CloseClipboard()
        except Exception:
            pass


def desktop_type_in_element(title: str, element_name: str, text: str,
                            clear_first: bool = True, press_enter: bool = False, **kwargs) -> Dict[str, Any]:
    """Type text into a named text field. Clears first by default. Optional Enter after."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, "Edit") or _find_element(w, element_name, "")
        if not el:
            return {"success": False, "error": f"Field '{element_name}' not found. Use desktop_get_elements."}
        el.click_input(); time.sleep(0.02)
        if clear_first:
            el.type_keys("^a{DELETE}", with_spaces=True, pause=0.002); time.sleep(0.02)
        _clipboard_paste(text)
        if press_enter:
            el.type_keys("{ENTER}", pause=0.002)
        return {"success": True, "message": f"Typed into '{el.window_text()}'"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 7. desktop_send_keys — rich key sequences to a window
# ============================================================================

def desktop_send_keys(title: str, keys: str, **kwargs) -> Dict[str, Any]:
    """Send key sequence to a window. Supports pywinauto key syntax: {ENTER}, {TAB}, ^c (Ctrl+C), %{F4} (Alt+F4), +a (Shift+A), etc."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        # Only use type_keys for actual pywinauto key sequences
        has_key_syntax = '{' in keys or '^' in keys or '%' in keys
        if has_key_syntax:
            w.type_keys(keys, with_spaces=True, pause=0.002)
        else:
            _clipboard_paste(keys)
        return {"success": True, "message": f"Sent keys to '{w.window_text()}'"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 8. desktop_read_element — read text from controls
# ============================================================================

def desktop_read_element(title: str, element_name: str = "", control_type: str = "", **kwargs) -> Dict[str, Any]:
    """Read text from UI elements. Reads labels, status bars, text fields, list items."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        texts = []
        _collect_text(w, texts, control_type, element_name, 5, 0)
        return {"success": True, "window": w.window_text(), "texts": texts[:50]}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _collect_text(el, results, ct_filter, name_filter, max_depth, depth):
    if depth > max_depth:
        return
    try:
        children = el.children()
    except Exception:
        return
    for child in children:
        try:
            ct = child.element_info.control_type
            name = child.window_text() or ""
            if ct_filter and ct.lower() != ct_filter.lower():
                _collect_text(child, results, ct_filter, name_filter, max_depth, depth + 1)
                continue
            if name_filter and name_filter.lower() not in name.lower():
                _collect_text(child, results, ct_filter, name_filter, max_depth, depth + 1)
                continue
            if name.strip():
                results.append({"text": name, "type": ct})
            _collect_text(child, results, ct_filter, name_filter, max_depth, depth + 1)
        except Exception:
            continue


# ============================================================================
# 9. desktop_select_item — select in ComboBox/ListBox/Tab/TreeView
# ============================================================================

def desktop_select_item(title: str, element_name: str, item_text: str, **kwargs) -> Dict[str, Any]:
    """Select an item by text in a ComboBox, ListBox, Tab, or TreeView control."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, "")
        if not el:
            return {"success": False, "error": f"Control '{element_name}' not found."}
        ct = el.element_info.control_type
        if ct in ("ComboBox", "List"):
            el.select(item_text)
        elif ct == "Tab":
            el.select(item_text)
        elif ct == "Tree":
            item = el.get_item(item_text)
            item.select()
        else:
            # Try generic child click
            child = _find_element(el, item_text, "")
            if child:
                child.click_input()
            else:
                return {"success": False, "error": f"Cannot select in {ct} control. Item '{item_text}' not found."}
        return {"success": True, "message": f"Selected '{item_text}' in '{element_name}'"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 10. desktop_toggle — check/uncheck CheckBox, toggle RadioButton
# ============================================================================

def desktop_toggle(title: str, element_name: str, state: str = "toggle", **kwargs) -> Dict[str, Any]:
    """Toggle a CheckBox or RadioButton. state: 'on', 'off', or 'toggle' (default)."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, "CheckBox") or _find_element(w, element_name, "RadioButton")
        if not el:
            return {"success": False, "error": f"CheckBox/RadioButton '{element_name}' not found."}
        try:
            toggle_pattern = el.iface_toggle
            current = toggle_pattern.CurrentToggleState  # 0=off, 1=on, 2=indeterminate
        except Exception:
            current = -1
        s = state.lower()
        if s == "on" and current != 1:
            el.click_input()
        elif s == "off" and current != 0:
            el.click_input()
        elif s == "toggle":
            el.click_input()
        return {"success": True, "message": f"Toggled '{element_name}' ({state})"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 11. desktop_expand_collapse — expand/collapse TreeView nodes
# ============================================================================

def desktop_expand_collapse(title: str, element_name: str, action: str = "expand", **kwargs) -> Dict[str, Any]:
    """Expand or collapse a TreeView node or expandable element. action: expand or collapse."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, "")
        if not el:
            return {"success": False, "error": f"Element '{element_name}' not found."}
        try:
            ec = el.iface_expand_collapse
            if action.lower() == "expand":
                ec.Expand()
            else:
                ec.Collapse()
            return {"success": True, "message": f"{action}: '{element_name}'"}
        except Exception:
            return {"success": False, "error": f"Element '{element_name}' doesn't support expand/collapse."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 12. desktop_scroll — scroll within a scrollable container
# ============================================================================

def desktop_scroll(title: str, element_name: str = "", direction: str = "down",
                   amount: int = 3, **kwargs) -> Dict[str, Any]:
    """Scroll within a window or specific scrollable element. direction: up/down/left/right."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        target = w
        if element_name:
            el = _find_element(w, element_name, "")
            if el:
                target = el
        try:
            scroll = target.iface_scroll
            d = direction.lower()
            for _ in range(amount):
                if d == "down":
                    scroll.Scroll(0, 1)  # horizontal=0, vertical=1 (small increment)
                elif d == "up":
                    scroll.Scroll(0, -1)
                elif d == "right":
                    scroll.Scroll(1, 0)
                elif d == "left":
                    scroll.Scroll(-1, 0)
            return {"success": True, "message": f"Scrolled {direction} x{amount}"}
        except Exception:
            # Fallback: use mouse scroll via pyautogui if available
            try:
                import pyautogui
                rect = target.rectangle()
                cx = (rect.left + rect.right) // 2
                cy = (rect.top + rect.bottom) // 2
                clicks = -amount if direction.lower() == "down" else amount
                pyautogui.scroll(clicks, x=cx, y=cy)
                return {"success": True, "message": f"Scrolled {direction} x{amount} (mouse fallback)"}
            except Exception:
                return {"success": False, "error": "Element doesn't support scrolling and pyautogui fallback failed."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 13. desktop_set_value — set slider/spinner/range values
# ============================================================================

def desktop_set_value(title: str, element_name: str, value: str, **kwargs) -> Dict[str, Any]:
    """Set value on a slider, spinner, or range control."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, "")
        if not el:
            return {"success": False, "error": f"Element '{element_name}' not found."}
        try:
            vp = el.iface_value
            vp.SetValue(value)
            return {"success": True, "message": f"Set '{element_name}' to '{value}'"}
        except Exception:
            try:
                rp = el.iface_range_value
                rp.SetValue(float(value))
                return {"success": True, "message": f"Set '{element_name}' to {value}"}
            except Exception:
                return {"success": False, "error": f"Element '{element_name}' doesn't support SetValue."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 14. desktop_drag — drag one element to another
# ============================================================================

def desktop_drag(title: str, from_element: str, to_element: str, **kwargs) -> Dict[str, Any]:
    """Drag from one element to another within a window."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        src = _find_element(w, from_element, "")
        dst = _find_element(w, to_element, "")
        if not src:
            return {"success": False, "error": f"Source '{from_element}' not found."}
        if not dst:
            return {"success": False, "error": f"Target '{to_element}' not found."}
        sr = src.rectangle()
        dr = dst.rectangle()
        sx, sy = (sr.left + sr.right) // 2, (sr.top + sr.bottom) // 2
        dx, dy = (dr.left + dr.right) // 2, (dr.top + dr.bottom) // 2
        try:
            import pyautogui
            pyautogui.moveTo(sx, sy, duration=0.2)
            pyautogui.mouseDown()
            pyautogui.moveTo(dx, dy, duration=0.4)
            pyautogui.mouseUp()
        except ImportError:
            src.drag_mouse_input(dst_coords=(dx, dy))
        return {"success": True, "message": f"Dragged '{from_element}' to '{to_element}'"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 15. desktop_get_element_props — detailed properties of a specific element
# ============================================================================

def desktop_get_element_props(title: str, element_name: str, control_type: str = "", **kwargs) -> Dict[str, Any]:
    """Get detailed properties of a UI element: automation_id, patterns, help text, bounding rect, state."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        el = _find_element(w, element_name, control_type)
        if not el:
            return {"success": False, "error": f"Element '{element_name}' not found."}
        info = el.element_info
        props = {
            "name": el.window_text(),
            "control_type": info.control_type,
            "class_name": el.class_name(),
            "automation_id": info.automation_id,
            "rect": _rect_dict(el.rectangle()),
            "enabled": el.is_enabled(),
            "visible": el.is_visible(),
        }
        try:
            props["help_text"] = info.help_text
        except Exception:
            pass
        try:
            props["access_key"] = info.access_key
        except Exception:
            pass
        try:
            vp = el.iface_value
            if vp:
                props["value"] = vp.CurrentValue
        except Exception:
            pass
        try:
            tp = el.iface_toggle
            if tp:
                props["toggle_state"] = tp.CurrentToggleState
        except Exception:
            pass
        return {"success": True, "properties": props}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 16. desktop_wait — wait for window or element to appear
# ============================================================================

def desktop_wait(title: str, element_name: str = "", timeout: int = 10, **kwargs) -> Dict[str, Any]:
    """Wait for a window (or a specific element within it) to appear. Returns when found or after timeout."""
    try:
        pwa, Desktop = _get_pywinauto()
        desktop = Desktop(backend="uia")
        start = time.time()
        while time.time() - start < timeout:
            windows = desktop.windows(title_re=f".*{title}.*")
            if windows:
                w = windows[0]
                if not element_name:
                    return {"success": True, "message": f"Window found: {w.window_text()}", "waited": round(time.time() - start, 1)}
                el = _find_element(w, element_name, "")
                if el:
                    return {"success": True, "message": f"Element '{element_name}' found in '{w.window_text()}'", "waited": round(time.time() - start, 1)}
            time.sleep(0.5)
        what = f"element '{element_name}' in '{title}'" if element_name else f"window '{title}'"
        return {"success": False, "error": f"{what} not found within {timeout}s"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 17. desktop_launch_app — launch an app with process control
# ============================================================================

def desktop_launch_app(path: str, args: str = "", wait: bool = False, **kwargs) -> Dict[str, Any]:
    """Launch an application by path or name. Can pass arguments and optionally wait for it to start."""
    try:
        pwa, _ = _get_pywinauto()
        from pywinauto.application import Application
        cmd = path if not args else f"{path} {args}"
        app = Application(backend="uia").start(cmd)
        time.sleep(1)
        try:
            dlg = app.top_window()
            return {"success": True, "message": f"Launched: {dlg.window_text()}", "pid": app.process}
        except Exception:
            return {"success": True, "message": f"Launched: {path}", "pid": app.process}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 18. desktop_menu_select — navigate menus by path
# ============================================================================

def desktop_menu_select(title: str, menu_path: str, **kwargs) -> Dict[str, Any]:
    """Select a menu item by path. Example: 'File->Save As', 'Edit->Find->Find Next'."""
    try:
        pwa, _ = _get_pywinauto()
        from pywinauto.application import Application
        app = Application(backend="uia").connect(title_re=f".*{title}.*")
        dlg = app.top_window()
        dlg.set_focus(); time.sleep(0.05)
        dlg.menu_select(menu_path)
        return {"success": True, "message": f"Selected menu: {menu_path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 19. desktop_clipboard — read/write clipboard
# ============================================================================

def desktop_clipboard(action: str = "read", text: str = "", **kwargs) -> Dict[str, Any]:
    """Read or write the Windows clipboard. action: 'read' or 'write'."""
    try:
        import ctypes
        from ctypes import wintypes
        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32

        if action.lower() == "write":
            import subprocess
            process = subprocess.Popen(['clip'], stdin=subprocess.PIPE)
            process.communicate(text.encode('utf-16-le'))
            return {"success": True, "message": f"Wrote {len(text)} chars to clipboard"}
        else:
            u32.OpenClipboard(0)
            try:
                handle = u32.GetClipboardData(13)  # CF_UNICODETEXT
                if handle:
                    k32.GlobalLock.restype = ctypes.c_wchar_p
                    data = k32.GlobalLock(handle)
                    result = str(data) if data else ""
                    k32.GlobalUnlock(handle)
                    return {"success": True, "text": result}
                return {"success": True, "text": ""}
            finally:
                u32.CloseClipboard()
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 20. desktop_screenshot_window — capture just one window
# ============================================================================

def desktop_screenshot_window(title: str, save_path: str = "", **kwargs) -> Dict[str, Any]:
    """Capture a screenshot of a specific window. Returns base64 if no save_path."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        img = w.capture_as_image()
        if save_path:
            img.save(save_path)
            return {"success": True, "message": f"Saved screenshot to {save_path}"}
        else:
            import io, base64
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            return {"success": True, "image_base64": b64, "format": "png"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 21. desktop_find_by_id — find element by automation_id (more reliable)
# ============================================================================

def desktop_find_by_id(title: str, automation_id: str, **kwargs) -> Dict[str, Any]:
    """Find and return info about a UI element by its automation_id. More reliable than name matching."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        results = []
        _search_by_id(w, automation_id, results, 6, 0)
        if not results:
            return {"success": False, "error": f"No element with automation_id '{automation_id}'. Use desktop_get_element_props to discover IDs."}
        el = results[0]
        return {
            "success": True,
            "element": {
                "name": el.window_text(),
                "type": el.element_info.control_type,
                "automation_id": el.element_info.automation_id,
                "rect": _rect_dict(el.rectangle()),
                "enabled": el.is_enabled(),
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _search_by_id(el, auto_id, results, max_depth, depth):
    if depth > max_depth or results:
        return
    try:
        children = el.children()
    except Exception:
        return
    for child in children:
        if results:
            return
        try:
            if child.element_info.automation_id == auto_id:
                results.append(child)
                return
            _search_by_id(child, auto_id, results, max_depth, depth + 1)
        except Exception:
            continue


# ============================================================================
# 22. desktop_read_table — read DataGrid/Table/ListView rows
# ============================================================================

def desktop_read_table(title: str, element_name: str = "", max_rows: int = 50, **kwargs) -> Dict[str, Any]:
    """Read rows from a DataGrid, Table, or ListView control. Returns structured row data."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        # Find the table/grid/list
        target = None
        if element_name:
            target = _find_element(w, element_name, "DataGrid") or \
                     _find_element(w, element_name, "Table") or \
                     _find_element(w, element_name, "List") or \
                     _find_element(w, element_name, "")
        else:
            # Auto-find first table-like control
            for ct in ("DataGrid", "Table", "List"):
                target = _find_element_by_type(w, ct, 4, 0)
                if target:
                    break
        if not target:
            return {"success": False, "error": "No table/grid/list found. Specify element_name or check with desktop_get_elements."}
        
        rows = []
        try:
            children = target.children()
            # Try to read header first
            headers = []
            for child in children:
                ct = child.element_info.control_type
                if ct in ("Header", "HeaderItem"):
                    for hitem in child.children():
                        headers.append(hitem.window_text())
                elif ct in ("DataItem", "ListItem"):
                    if len(rows) >= max_rows:
                        break
                    row_data = []
                    for cell in child.children():
                        row_data.append(cell.window_text())
                    if not row_data:
                        row_data = [child.window_text()]
                    rows.append(row_data)
        except Exception:
            # Fallback: just read all children text
            for child in children[:max_rows]:
                rows.append([child.window_text()])
        
        return {
            "success": True,
            "headers": headers if headers else None,
            "rows": rows,
            "row_count": len(rows),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _find_element_by_type(el, control_type, max_depth, depth):
    """Find first element matching a control type."""
    if depth > max_depth:
        return None
    try:
        for child in el.children():
            try:
                if child.element_info.control_type == control_type:
                    return child
                found = _find_element_by_type(child, control_type, max_depth, depth + 1)
                if found:
                    return found
            except Exception:
                continue
    except Exception:
        pass
    return None


# ============================================================================
# 23. desktop_context_menu — right-click + select from context menu
# ============================================================================

def desktop_context_menu(title: str, element_name: str, menu_item: str, **kwargs) -> Dict[str, Any]:
    """Right-click an element to open its context menu, then click a menu item by name."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, "")
        if not el:
            return {"success": False, "error": f"Element '{element_name}' not found."}
        # Right-click to open context menu
        el.click_input(button="right")
        time.sleep(0.5)
        # Find and click the menu item in the popup
        pwa, Desktop = _get_pywinauto()
        desktop = Desktop(backend="uia")
        # Context menus appear as top-level windows with Menu control type
        for popup in desktop.windows():
            try:
                ct = popup.element_info.control_type
                if ct in ("Menu", "Window"):
                    item = _find_element(popup, menu_item, "MenuItem")
                    if item:
                        item.click_input()
                        return {"success": True, "message": f"Selected '{menu_item}' from context menu of '{element_name}'"}
            except Exception:
                continue
        # Fallback: try to find menu item anywhere
        time.sleep(0.3)
        for popup in desktop.windows():
            try:
                item = _find_element(popup, menu_item, "")
                if item and item.element_info.control_type in ("MenuItem", "Button", "Text"):
                    item.click_input()
                    return {"success": True, "message": f"Selected '{menu_item}' from context menu"}
            except Exception:
                continue
        return {"success": False, "error": f"Menu item '{menu_item}' not found in context menu. Try desktop_get_elements to see what appeared."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 24. desktop_handle_dialog — detect and interact with modal dialogs
# ============================================================================

def desktop_handle_dialog(title: str = "", action: str = "detect", button: str = "",
                          file_path: str = "", **kwargs) -> Dict[str, Any]:
    """Handle common modal dialogs (Save As, Open, Print, message boxes).
    action: detect (list dialogs), click (click a button), set_path (set file path in Save/Open dialog)."""
    try:
        pwa, Desktop = _get_pywinauto()
        desktop = Desktop(backend="uia")
        
        if action == "detect":
            dialogs = []
            for w in desktop.windows():
                try:
                    wt = w.window_text()
                    if not wt.strip():
                        continue
                    # Check for common dialog indicators
                    lower = wt.lower()
                    is_dialog = any(kw in lower for kw in [
                        "save", "open", "print", "error", "warning", "confirm",
                        "alert", "message", "dialog", "browse", "select",
                    ])
                    if title and title.lower() not in lower:
                        continue
                    if is_dialog or (not title):
                        buttons = []
                        _collect_buttons(w, buttons, 3, 0)
                        dialogs.append({
                            "title": wt,
                            "class": w.class_name(),
                            "buttons": buttons[:10],
                        })
                except Exception:
                    continue
            return {"success": True, "dialogs": dialogs, "count": len(dialogs)}
        
        elif action == "click" and button:
            w, err = _get_window(title) if title else (None, None)
            if not w:
                # Try to find any dialog with the button
                for win in desktop.windows():
                    el = _find_element(win, button, "Button")
                    if el:
                        w = win
                        break
            if not w:
                return {"success": False, "error": f"No dialog found with button '{button}'."}
            el = _find_element(w, button, "Button")
            if not el:
                return {"success": False, "error": f"Button '{button}' not found in dialog."}
            el.click_input()
            return {"success": True, "message": f"Clicked '{button}' in dialog '{w.window_text()}'"}
        
        elif action == "set_path" and file_path:
            w, err = _get_window(title) if title else (None, None)
            if not w:
                # Try common Save/Open dialog titles
                for t in ["Save As", "Save", "Open", "Browse"]:
                    w, _ = _get_window(t)
                    if w:
                        break
            if not w:
                return {"success": False, "error": "No file dialog found."}
            w.set_focus(); time.sleep(0.05)
            # Find the filename edit field
            edit = _find_element(w, "File name", "Edit") or \
                   _find_element(w, "filename", "Edit") or \
                   _find_element(w, "Name", "Edit")
            if not edit:
                # Try first Edit control
                edit = _find_element_by_type(w, "Edit", 4, 0)
            if not edit:
                return {"success": False, "error": "File name field not found in dialog."}
            edit.click_input(); time.sleep(0.02)
            edit.type_keys("^a{DELETE}", with_spaces=True, pause=0.002); time.sleep(0.02)
            _clipboard_paste(file_path)
            return {"success": True, "message": f"Set file path to '{file_path}' in dialog"}
        
        else:
            return {"success": False, "error": "action must be 'detect', 'click' (with button=), or 'set_path' (with file_path=)."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _collect_buttons(el, buttons, max_depth, depth):
    if depth > max_depth:
        return
    try:
        for child in el.children():
            try:
                if child.element_info.control_type == "Button":
                    name = child.window_text()
                    if name.strip():
                        buttons.append(name)
                _collect_buttons(child, buttons, max_depth, depth + 1)
            except Exception:
                continue
    except Exception:
        pass


# ============================================================================
# 25. desktop_read_all_text — read all text from a window at once
# ============================================================================

def desktop_read_all_text(title: str, max_chars: int = 5000, **kwargs) -> Dict[str, Any]:
    """Read ALL visible text from a window. Useful for scraping full window content."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        texts = []
        _collect_all_text(w, texts, 8, 0)
        full_text = "\n".join(texts)
        if len(full_text) > max_chars:
            full_text = full_text[:max_chars] + f"\n... (truncated, {len(full_text)} total chars)"
        return {"success": True, "window": w.window_text(), "text": full_text, "char_count": len(full_text)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _collect_all_text(el, texts, max_depth, depth):
    if depth > max_depth:
        return
    try:
        for child in el.children():
            try:
                ct = child.element_info.control_type
                name = child.window_text() or ""
                if name.strip() and ct in ("Text", "Edit", "Document", "Static", "Hyperlink", "ListItem", "DataItem", "TreeItem"):
                    texts.append(name.strip())
                _collect_all_text(child, texts, max_depth, depth + 1)
            except Exception:
                continue
    except Exception:
        pass


# ============================================================================
# 26. desktop_invoke — invoke buttons/links programmatically (no click)
# ============================================================================

def desktop_invoke(title: str, element_name: str, control_type: str = "", **kwargs) -> Dict[str, Any]:
    """Invoke a button or link programmatically via UIA Invoke pattern. More reliable than clicking for some controls."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        el = _find_element(w, element_name, control_type)
        if not el:
            return {"success": False, "error": f"Element '{element_name}' not found."}
        try:
            invoke = el.iface_invoke
            invoke.Invoke()
            return {"success": True, "message": f"Invoked '{el.window_text()}' ({el.element_info.control_type})"}
        except Exception:
            # Fallback to click
            el.click_input()
            return {"success": True, "message": f"Clicked '{el.window_text()}' (invoke not supported, used click fallback)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 27. desktop_multi_select — select multiple items in a list
# ============================================================================

def desktop_multi_select(title: str, element_name: str, items: List[str], **kwargs) -> Dict[str, Any]:
    """Select multiple items in a ListBox or ListView by holding Ctrl and clicking each."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        container = _find_element(w, element_name, "List") or _find_element(w, element_name, "")
        if not container:
            return {"success": False, "error": f"List '{element_name}' not found."}
        
        import pyautogui
        selected = []
        not_found = []
        first = True
        for item_text in items:
            el = _find_element(container, item_text, "")
            if el:
                if first:
                    el.click_input()
                    first = False
                else:
                    # Ctrl+click for multi-select
                    rect = el.rectangle()
                    cx = (rect.left + rect.right) // 2
                    cy = (rect.top + rect.bottom) // 2
                    pyautogui.keyDown('ctrl')
                    pyautogui.click(cx, cy)
                    pyautogui.keyUp('ctrl')
                selected.append(item_text)
            else:
                not_found.append(item_text)
            time.sleep(0.1)
        
        return {
            "success": True,
            "selected": selected,
            "not_found": not_found,
            "message": f"Selected {len(selected)} items" + (f", {len(not_found)} not found" if not_found else ""),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 28. desktop_toolbar_click — click toolbar buttons by tooltip/index
# ============================================================================

def desktop_toolbar_click(title: str, button_name: str = "", button_index: int = -1, **kwargs) -> Dict[str, Any]:
    """Click a toolbar button by tooltip text or index. Use desktop_get_elements to discover toolbar buttons first."""
    try:
        w, err = _get_window(title)
        if err:
            return err
        w.set_focus(); time.sleep(0.05)
        # Find toolbar
        toolbar = _find_element_by_type(w, "ToolBar", 4, 0)
        if not toolbar:
            return {"success": False, "error": "No toolbar found in window."}
        
        buttons = toolbar.children()
        if button_index >= 0:
            if button_index >= len(buttons):
                return {"success": False, "error": f"Button index {button_index} out of range (toolbar has {len(buttons)} buttons)."}
            btn = buttons[button_index]
            btn.click_input()
            return {"success": True, "message": f"Clicked toolbar button [{button_index}]: '{btn.window_text()}'"}
        
        if button_name:
            for btn in buttons:
                try:
                    name = btn.window_text() or ""
                    tooltip = ""
                    try:
                        tooltip = btn.element_info.help_text or ""
                    except Exception:
                        pass
                    if button_name.lower() in name.lower() or button_name.lower() in tooltip.lower():
                        btn.click_input()
                        return {"success": True, "message": f"Clicked toolbar button: '{name or tooltip}'"}
                except Exception:
                    continue
            # List available buttons for error message
            available = []
            for i, btn in enumerate(buttons):
                try:
                    available.append(f"[{i}] {btn.window_text() or '(unnamed)'}")
                except Exception:
                    pass
            return {"success": False, "error": f"Button '{button_name}' not found. Available: {', '.join(available[:15])}"}
        
        return {"success": False, "error": "Specify button_name or button_index."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# Helpers
# ============================================================================

def _find_element(parent, name, control_type, max_depth=5):
    results = []
    _search_element(parent, name, control_type, results, max_depth, 0)
    return results[0] if results else None


def _search_element(el, name, control_type, results, max_depth, depth):
    if depth > max_depth or results:
        return
    try:
        children = el.children()
    except Exception:
        return
    for child in children:
        if results:
            return
        try:
            ct = child.element_info.control_type
            cn = child.window_text() or ""
            if name.lower() in cn.lower():
                if not control_type or ct.lower() == control_type.lower():
                    results.append(child)
                    return
            _search_element(child, name, control_type, results, max_depth, depth + 1)
        except Exception:
            continue


# ============================================================================
# DESKTOP_TOOLS — compact schema definitions
# ============================================================================

DESKTOP_TOOLS = [
    {
        "name": "desktop_list_windows",
        "execute": desktop_list_windows,
        "description": "List all visible windows (titles, PIDs, positions).",
        "schema": None,
        "category": "desktop",
    },
    {
        "name": "desktop_window_action",
        "execute": desktop_window_action,
        "description": "Window action: focus, minimize, maximize, restore, close, move (x,y), resize (width,height).",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Window title substring"},
                "action": {"type": "string", "enum": ["focus", "minimize", "maximize", "restore", "close", "move", "resize"]},
                "x": {"type": "integer"}, "y": {"type": "integer"},
                "width": {"type": "integer"}, "height": {"type": "integer"},
            },
            "required": ["title", "action"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_get_elements",
        "execute": desktop_get_elements,
        "description": "Inspect UI elements in a window. Filter by control_type (Button/Edit/Text/MenuItem/ListItem/ComboBox/CheckBox/RadioButton/Tab/Hyperlink/TreeItem) and name.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "control_type": {"type": "string"},
                "name_filter": {"type": "string"}, "max_depth": {"type": "integer"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_dump_tree",
        "execute": desktop_dump_tree,
        "description": "Dump full UI element tree as indented text (debugging).",
        "schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "max_depth": {"type": "integer"}},
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_click_element",
        "execute": desktop_click_element,
        "description": "Click a UI element by name. click_type: left (default), right, double.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "control_type": {"type": "string"},
                "click_type": {"type": "string", "enum": ["left", "right", "double"]},
            },
            "required": ["title", "element_name"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_type_in_element",
        "execute": desktop_type_in_element,
        "description": "Type text into a named text field. Clears first by default.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "text": {"type": "string"}, "clear_first": {"type": "boolean"},
                "press_enter": {"type": "boolean"},
            },
            "required": ["title", "element_name", "text"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_send_keys",
        "execute": desktop_send_keys,
        "description": "Send key sequence to window. Syntax: {ENTER}, {TAB}, ^c (Ctrl+C), %{F4} (Alt+F4), +a (Shift+A).",
        "schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "keys": {"type": "string"}},
            "required": ["title", "keys"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_read_element",
        "execute": desktop_read_element,
        "description": "Read text from UI elements (labels, status bars, text fields).",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "control_type": {"type": "string"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_select_item",
        "execute": desktop_select_item,
        "description": "Select item by text in ComboBox, ListBox, Tab, or TreeView.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "item_text": {"type": "string"},
            },
            "required": ["title", "element_name", "item_text"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_toggle",
        "execute": desktop_toggle,
        "description": "Toggle CheckBox/RadioButton. state: on, off, or toggle.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "state": {"type": "string", "enum": ["on", "off", "toggle"]},
            },
            "required": ["title", "element_name"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_expand_collapse",
        "execute": desktop_expand_collapse,
        "description": "Expand or collapse a TreeView node.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "action": {"type": "string", "enum": ["expand", "collapse"]},
            },
            "required": ["title", "element_name"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_scroll",
        "execute": desktop_scroll,
        "description": "Scroll in a window or element. direction: up/down/left/right.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                "amount": {"type": "integer"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_set_value",
        "execute": desktop_set_value,
        "description": "Set value on slider, spinner, or range control.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["title", "element_name", "value"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_drag",
        "execute": desktop_drag,
        "description": "Drag one element to another within a window.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "from_element": {"type": "string"},
                "to_element": {"type": "string"},
            },
            "required": ["title", "from_element", "to_element"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_get_element_props",
        "execute": desktop_get_element_props,
        "description": "Get detailed element properties: automation_id, patterns, help text, state.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "control_type": {"type": "string"},
            },
            "required": ["title", "element_name"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_wait",
        "execute": desktop_wait,
        "description": "Wait for a window or element to appear (up to timeout seconds).",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "timeout": {"type": "integer"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_launch_app",
        "execute": desktop_launch_app,
        "description": "Launch an app by path/name with process control.",
        "schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "App path or executable name"},
                "args": {"type": "string"},
            },
            "required": ["path"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_menu_select",
        "execute": desktop_menu_select,
        "description": "Select menu item by path: 'File->Save As', 'Edit->Find'.",
        "schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "menu_path": {"type": "string"}},
            "required": ["title", "menu_path"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_clipboard",
        "execute": desktop_clipboard,
        "description": "Read or write the Windows clipboard.",
        "schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["read", "write"]},
                "text": {"type": "string", "description": "Text to write (for write action)"},
            },
            "required": ["action"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_screenshot_window",
        "execute": desktop_screenshot_window,
        "description": "Screenshot a specific window. Returns base64 PNG or saves to path.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "save_path": {"type": "string"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_find_by_id",
        "execute": desktop_find_by_id,
        "description": "Find UI element by automation_id (more reliable than name). Use desktop_get_element_props to discover IDs.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "automation_id": {"type": "string"},
            },
            "required": ["title", "automation_id"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_read_table",
        "execute": desktop_read_table,
        "description": "Read rows from DataGrid, Table, or ListView. Returns headers + row data.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "max_rows": {"type": "integer"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_context_menu",
        "execute": desktop_context_menu,
        "description": "Right-click an element to open context menu, then select an item by name.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "menu_item": {"type": "string"},
            },
            "required": ["title", "element_name", "menu_item"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_handle_dialog",
        "execute": desktop_handle_dialog,
        "description": "Handle modal dialogs (Save/Open/Print/message boxes). action: detect, click (button=), set_path (file_path=).",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "action": {"type": "string", "enum": ["detect", "click", "set_path"]},
                "button": {"type": "string"}, "file_path": {"type": "string"},
            },
            "required": ["action"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_read_all_text",
        "execute": desktop_read_all_text,
        "description": "Read ALL visible text from a window at once. Useful for scraping full content.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "max_chars": {"type": "integer"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_invoke",
        "execute": desktop_invoke,
        "description": "Invoke a button/link via UIA Invoke pattern (no click needed). Falls back to click.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "control_type": {"type": "string"},
            },
            "required": ["title", "element_name"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_multi_select",
        "execute": desktop_multi_select,
        "description": "Select multiple items in a ListBox/ListView via Ctrl+click.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "element_name": {"type": "string"},
                "items": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "element_name", "items"],
        },
        "category": "desktop",
    },
    {
        "name": "desktop_toolbar_click",
        "execute": desktop_toolbar_click,
        "description": "Click a toolbar button by name/tooltip or index.",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"}, "button_name": {"type": "string"},
                "button_index": {"type": "integer"},
            },
            "required": ["title"],
        },
        "category": "desktop",
    },
]
