"""
Process Tool - Manage running processes
========================================
Features:
- List running processes
- Kill processes
- Send keystrokes to windows
- Get process info
- Monitor process output
"""

import os
import signal
import logging
import subprocess
import threading
import time
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Try to import Windows-specific modules
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
    logger.warning("psutil not installed - process listing will be limited")

try:
    import win32gui
    import win32con
    import win32process
    import win32api
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False
    logger.warning("pywin32 not installed - window management will be limited")


def list_processes(
    name_filter: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    List running processes.
    
    Args:
        name_filter: Filter by process name (case-insensitive substring)
        limit: Maximum number of processes to return
        
    Returns:
        Dict with process list
    """
    if not HAS_PSUTIL:
        return {
            "status": "error",
            "error": "psutil not installed. Run: pip install psutil",
        }
    
    try:
        processes = []
        
        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'status', 'create_time']):
            try:
                info = proc.info
                
                # Apply name filter
                if name_filter:
                    pname = info.get('name') or ''
                    if name_filter.lower() not in pname.lower():
                        continue
                
                cpu = info.get('cpu_percent')
                mem = info.get('memory_percent')
                processes.append({
                    "pid": info['pid'],
                    "name": info.get('name', 'unknown'),
                    "cpu_percent": round(cpu, 1) if cpu is not None else 0.0,
                    "memory_percent": round(mem, 1) if mem is not None else 0.0,
                    "status": info.get('status', 'unknown'),
                })
                
                if len(processes) >= limit:
                    break
                    
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
        
        # Sort by CPU usage
        processes.sort(key=lambda x: x.get('cpu_percent', 0) or 0, reverse=True)
        
        return {
            "status": "success",
            "processes": processes,
            "total": len(processes),
        }
        
    except Exception as e:
        logger.error(f"Error listing processes: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def get_process_info(pid: int) -> Dict[str, Any]:
    """
    Get detailed information about a process.
    
    Args:
        pid: Process ID
        
    Returns:
        Dict with process details
    """
    if not HAS_PSUTIL:
        return {
            "status": "error",
            "error": "psutil not installed",
        }
    
    try:
        proc = psutil.Process(pid)
        
        with proc.oneshot():
            info = {
                "status": "success",
                "pid": pid,
                "name": proc.name(),
                "exe": proc.exe() if proc.exe() else None,
                "cwd": proc.cwd() if hasattr(proc, 'cwd') else None,
                "status": proc.status(),
                "cpu_percent": proc.cpu_percent(),
                "memory_percent": round(proc.memory_percent(), 2),
                "memory_mb": round(proc.memory_info().rss / 1024 / 1024, 2),
                "threads": proc.num_threads(),
                "create_time": proc.create_time(),
                "cmdline": proc.cmdline() if proc.cmdline() else None,
            }
            
            # Get parent info
            try:
                parent = proc.parent()
                if parent:
                    info["parent_pid"] = parent.pid
                    info["parent_name"] = parent.name()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
            
            # Get children
            try:
                children = proc.children()
                info["children"] = [{"pid": c.pid, "name": c.name()} for c in children[:10]]
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        
        return info
        
    except psutil.NoSuchProcess:
        return {
            "status": "error",
            "error": f"Process not found: {pid}",
        }
    except psutil.AccessDenied:
        return {
            "status": "error",
            "error": f"Access denied to process: {pid}",
        }
    except Exception as e:
        logger.error(f"Error getting process info: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def kill_process(
    pid: int,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Kill a process.
    
    Args:
        pid: Process ID
        force: Use SIGKILL instead of SIGTERM
        
    Returns:
        Dict with result
    """
    if not HAS_PSUTIL:
        return {
            "status": "error",
            "error": "psutil not installed",
        }
    
    try:
        proc = psutil.Process(pid)
        name = proc.name()
        
        if force:
            proc.kill()  # SIGKILL
        else:
            proc.terminate()  # SIGTERM
        
        # Wait for process to end
        try:
            proc.wait(timeout=5)
        except psutil.TimeoutExpired:
            if not force:
                # Try force kill
                proc.kill()
                proc.wait(timeout=3)
        
        return {
            "status": "success",
            "message": f"Killed process {pid} ({name})",
        }
        
    except psutil.NoSuchProcess:
        return {
            "status": "error",
            "error": f"Process not found: {pid}",
        }
    except psutil.AccessDenied:
        return {
            "status": "error",
            "error": f"Access denied. Try running as administrator.",
        }
    except Exception as e:
        logger.error(f"Error killing process: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def list_windows(
    title_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """
    List visible windows.
    
    Args:
        title_filter: Filter by window title (case-insensitive substring)
        
    Returns:
        Dict with window list
    """
    if not HAS_WIN32:
        return {
            "status": "error",
            "error": "pywin32 not installed. Run: pip install pywin32",
        }
    
    try:
        windows = []
        
        def enum_callback(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title:
                    # Apply filter
                    if title_filter and title_filter.lower() not in title.lower():
                        return True
                    
                    try:
                        _, pid = win32process.GetWindowThreadProcessId(hwnd)
                        rect = win32gui.GetWindowRect(hwnd)
                        
                        windows.append({
                            "hwnd": hwnd,
                            "title": title,
                            "pid": pid,
                            "rect": {
                                "left": rect[0],
                                "top": rect[1],
                                "right": rect[2],
                                "bottom": rect[3],
                            },
                        })
                    except Exception:
                        pass
            return True
        
        win32gui.EnumWindows(enum_callback, None)
        
        return {
            "status": "success",
            "windows": windows,
            "total": len(windows),
        }
        
    except Exception as e:
        logger.error(f"Error listing windows: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def focus_window(
    hwnd: Optional[int] = None,
    title: Optional[str] = None,
    pid: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Focus a window by handle, title, or process ID.
    
    Args:
        hwnd: Window handle
        title: Window title (partial match)
        pid: Process ID
        
    Returns:
        Dict with result
    """
    if not HAS_WIN32:
        return {
            "status": "error",
            "error": "pywin32 not installed",
        }
    
    try:
        target_hwnd = None
        
        if hwnd:
            target_hwnd = hwnd
        elif title or pid:
            # Find window
            def find_callback(h, _):
                nonlocal target_hwnd
                if win32gui.IsWindowVisible(h):
                    if title:
                        window_title = win32gui.GetWindowText(h)
                        if title.lower() in window_title.lower():
                            target_hwnd = h
                            return False
                    elif pid:
                        _, window_pid = win32process.GetWindowThreadProcessId(h)
                        if window_pid == pid:
                            target_hwnd = h
                            return False
                return True
            
            win32gui.EnumWindows(find_callback, None)
        
        if not target_hwnd:
            return {
                "status": "error",
                "error": "Window not found",
            }
        
        # Focus the window
        win32gui.SetForegroundWindow(target_hwnd)
        
        return {
            "status": "success",
            "hwnd": target_hwnd,
            "title": win32gui.GetWindowText(target_hwnd),
            "message": "Window focused",
        }
        
    except Exception as e:
        logger.error(f"Error focusing window: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def _win32_paste(text):
    """Instant text entry via Win32 clipboard + keybd_event Ctrl+V."""
    try:
        import ctypes
        CF_UNICODETEXT = 13
        KEYEVENTF_KEYUP = 0x0002
        VK_CONTROL, VK_V = 0x11, 0x56
        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32
        # Retry clipboard open up to 3 times (may be locked by another process)
        opened = False
        for _ in range(3):
            if u32.OpenClipboard(0):
                opened = True
                break
            time.sleep(0.05)
        if opened:
            u32.EmptyClipboard()
            data = text.encode('utf-16-le') + b'\x00\x00'
            h = k32.GlobalAlloc(0x0042, len(data))
            p = k32.GlobalLock(h)
            ctypes.memmove(p, data, len(data))
            k32.GlobalUnlock(h)
            u32.SetClipboardData(CF_UNICODETEXT, h)
            u32.CloseClipboard()
        else:
            # Fallback: use pyperclip if clipboard locked
            import pyperclip
            pyperclip.copy(text)
        u32.keybd_event(VK_CONTROL, 0, 0, 0)
        u32.keybd_event(VK_V, 0, 0, 0)
        u32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
        u32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.02)
    except Exception as e:
        # Ultimate fallback: pyautogui typewrite
        logger.warning(f"_win32_paste failed ({e}), falling back to pyautogui")
        import pyautogui
        pyautogui.typewrite(text, interval=0.005)


# Virtual key codes for direct keybd_event calls
_VK_MAP = {
    'enter': 0x0D, 'return': 0x0D, 'tab': 0x09, 'escape': 0x1B, 'esc': 0x1B,
    'space': 0x20, 'backspace': 0x08, 'delete': 0x2E,
    'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
    'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73,
    'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77,
    'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
    'ctrl': 0x11, 'control': 0x11, 'shift': 0x10, 'alt': 0x12,
    'win': 0x5B, 'lwin': 0x5B,
}


def _send_key_combo(special_str):
    """Send a key or key combo (e.g. 'CTRL+ENTER') via direct Win32 keybd_event."""
    import ctypes
    KEYEVENTF_KEYUP = 0x0002
    u32 = ctypes.windll.user32
    parts = [p.strip().lower() for p in special_str.split('+')]
    vk_codes = [_VK_MAP.get(p) for p in parts]
    if None in vk_codes:
        # Unknown key — fall back to pyautogui
        import pyautogui
        if len(parts) > 1:
            pyautogui.hotkey(*parts)
        else:
            pyautogui.press(parts[0])
        return
    # Press all keys down, then release in reverse
    for vk in vk_codes:
        u32.keybd_event(vk, 0, 0, 0)
    for vk in reversed(vk_codes):
        u32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.01)


def send_keys(
    keys: str,
    hwnd: Optional[int] = None,
    title: Optional[str] = None,
    delay: float = 0.05,
) -> Dict[str, Any]:
    """
    Send keystrokes to a window or the active window.
    Plain text is pasted instantly via clipboard. Special keys in {braces} are sent individually.
    
    Args:
        keys: Keys to send (supports special keys like {ENTER}, {TAB}, etc.)
        hwnd: Target window handle (optional)
        title: Target window title (optional)
        delay: Ignored for plain text (kept for API compat)
        
    Returns:
        Dict with result
    """
    try:
        import pyautogui
        
        # Focus target window if specified
        if hwnd or title:
            result = focus_window(hwnd=hwnd, title=title)
            if result["status"] != "success":
                return result
            time.sleep(0.05)
        
        # No special keys at all -> instant clipboard paste
        if '{' not in keys:
            _win32_paste(keys)
            return {
                "status": "success",
                "message": f"Sent {len(keys)} characters",
            }
        
        # Mixed: batch plain text between special keys, use direct Win32 for all
        buf = []  # accumulate plain text
        i = 0
        while i < len(keys):
            if keys[i] == '{':
                end = keys.find('}', i)
                if end != -1:
                    # Flush any buffered plain text first
                    if buf:
                        _win32_paste(''.join(buf))
                        buf.clear()
                    
                    special = keys[i+1:end]
                    _send_key_combo(special)
                    
                    i = end + 1
                    continue
            
            buf.append(keys[i])
            i += 1
        
        # Flush remaining plain text
        if buf:
            _win32_paste(''.join(buf))
        
        return {
            "status": "success",
            "message": f"Sent {len(keys)} characters",
        }
        
    except Exception as e:
        logger.error(f"Error sending keys: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def type_text(
    text: str,
    hwnd: Optional[int] = None,
    title: Optional[str] = None,
    interval: float = 0.005,
) -> Dict[str, Any]:
    """
    Type text into a window via clipboard paste (instant).
    
    Args:
        text: Text to type
        hwnd: Target window handle (optional)
        title: Target window title (optional)
        interval: Ignored (kept for API compat)
        
    Returns:
        Dict with result
    """
    try:
        import pyautogui
        
        # Focus target window if specified
        if hwnd or title:
            result = focus_window(hwnd=hwnd, title=title)
            if result["status"] != "success":
                return result
            time.sleep(0.1)
        
        # Clipboard paste via direct Win32 (no pyautogui overhead)
        import ctypes
        CF_UNICODETEXT = 13
        KEYEVENTF_KEYUP = 0x0002
        VK_CONTROL, VK_V = 0x11, 0x56
        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32
        if u32.OpenClipboard(0):
            u32.EmptyClipboard()
            data = text.encode('utf-16-le') + b'\x00\x00'
            h = k32.GlobalAlloc(0x0042, len(data))
            p = k32.GlobalLock(h)
            ctypes.memmove(p, data, len(data))
            k32.GlobalUnlock(h)
            u32.SetClipboardData(CF_UNICODETEXT, h)
            u32.CloseClipboard()
        u32.keybd_event(VK_CONTROL, 0, 0, 0)
        u32.keybd_event(VK_V, 0, 0, 0)
        u32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
        u32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.02)
        
        return {
            "status": "success",
            "message": f"Typed {len(text)} characters",
        }
        
    except Exception as e:
        logger.error(f"Error typing text: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def get_active_window() -> Dict[str, Any]:
    """
    Get information about the currently active/focused window.
    Useful for understanding what the user is looking at.
    
    Returns:
        Dict with active window info
    """
    if not HAS_WIN32:
        return {
            "status": "error",
            "error": "pywin32 not installed",
        }
    
    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return {
                "status": "error",
                "error": "No active window",
            }
        
        title = win32gui.GetWindowText(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        
        # Get process name
        process_name = None
        if HAS_PSUTIL:
            try:
                proc = psutil.Process(pid)
                process_name = proc.name()
            except:
                pass
        
        return {
            "status": "success",
            "hwnd": hwnd,
            "title": title,
            "pid": pid,
            "process_name": process_name,
            "rect": {
                "left": rect[0],
                "top": rect[1],
                "right": rect[2],
                "bottom": rect[3],
                "width": rect[2] - rect[0],
                "height": rect[3] - rect[1],
            },
        }
        
    except Exception as e:
        logger.error(f"Error getting active window: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def get_window_context() -> Dict[str, Any]:
    """
    Get comprehensive context about the current window state.
    Includes active window, recent windows, and browser tabs if applicable.
    
    Returns:
        Dict with window context for LLM awareness
    """
    context = {
        "status": "success",
        "active_window": None,
        "recent_windows": [],
        "browser_active": False,
    }
    
    # Get active window
    active = get_active_window()
    if active.get("status") == "success":
        context["active_window"] = {
            "title": active.get("title"),
            "process": active.get("process_name"),
            "hwnd": active.get("hwnd"),
        }
        
        # Check if browser is active
        process_name = (active.get("process_name") or "").lower()
        if any(b in process_name for b in ["chrome", "edge", "firefox", "brave", "msedge"]):
            context["browser_active"] = True
    
    # Get recent windows
    windows_result = list_windows()
    if windows_result.get("status") == "success":
        windows = windows_result.get("windows", [])[:10]
        context["recent_windows"] = [
            {"title": w.get("title", "")[:50], "hwnd": w.get("hwnd")}
            for w in windows
        ]
    
    return context


def screenshot_window(
    hwnd: Optional[int] = None,
    title: Optional[str] = None,
    save_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Take a screenshot of a specific window or the active window.
    
    Args:
        hwnd: Window handle (optional)
        title: Window title to find (optional)
        save_path: Path to save screenshot (optional, returns base64 if not provided)
        
    Returns:
        Dict with screenshot data or path
    """
    # Normalize save_path to screenshots/ directory
    if save_path is not None:
        screenshots_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'screenshots')
        os.makedirs(screenshots_dir, exist_ok=True)
        if os.path.dirname(save_path) in ('', '.'):
            save_path = os.path.join(screenshots_dir, save_path)
        elif not os.path.abspath(save_path).startswith(os.path.abspath(screenshots_dir)):
            save_path = os.path.join(screenshots_dir, os.path.basename(save_path))
    try:
        import pyautogui
        from PIL import Image
        import io
        import base64
        
        # Find target window
        target_hwnd = hwnd
        if not target_hwnd and title:
            result = focus_window(title=title)
            if result.get("status") == "success":
                target_hwnd = result.get("hwnd")
        
        if target_hwnd and HAS_WIN32:
            # Get window rect
            try:
                rect = win32gui.GetWindowRect(target_hwnd)
                region = (rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
                screenshot = pyautogui.screenshot(region=region)
            except:
                screenshot = pyautogui.screenshot()
        else:
            screenshot = pyautogui.screenshot()
        
        if save_path:
            screenshot.save(save_path)
            return {
                "status": "success",
                "path": save_path,
                "size": {"width": screenshot.width, "height": screenshot.height},
            }
        else:
            # Return base64
            buffer = io.BytesIO()
            screenshot.save(buffer, format="PNG")
            b64 = base64.b64encode(buffer.getvalue()).decode()
            return {
                "status": "success",
                "base64": b64[:100] + "...",  # Truncate for display
                "size": {"width": screenshot.width, "height": screenshot.height},
            }
            
    except Exception as e:
        logger.error(f"Error taking screenshot: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


class ProcessTool:
    """
    Process tool for LLM function calling.
    """
    
    name = "process"
    description = "Manage running processes and windows"
    
    @staticmethod
    def list(name_filter: str = None, limit: int = 50) -> Dict[str, Any]:
        return list_processes(name_filter, limit)
    
    @staticmethod
    def info(pid: int) -> Dict[str, Any]:
        return get_process_info(pid)
    
    @staticmethod
    def kill(pid: int, force: bool = False) -> Dict[str, Any]:
        return kill_process(pid, force)
    
    @staticmethod
    def windows(title_filter: str = None) -> Dict[str, Any]:
        return list_windows(title_filter)
    
    @staticmethod
    def focus(hwnd: int = None, title: str = None, pid: int = None) -> Dict[str, Any]:
        return focus_window(hwnd, title, pid)
    
    @staticmethod
    def send_keys(keys: str, hwnd: int = None, title: str = None) -> Dict[str, Any]:
        return send_keys(keys, hwnd, title)
    
    @staticmethod
    def type_text(text: str, hwnd: int = None, title: str = None) -> Dict[str, Any]:
        return type_text(text, hwnd, title)
