"""
Automation Tool - PyAutoGUI-based automations as tools
=======================================================

Bridges the existing command_executor automations into the tool system.
Provides both:
1. Tool-callable functions for agent models with tool support
2. Direct command parsing for non-tool-calling models

Fast-path automations that require zero thinking:
- "open [app]" → Start menu search
- "search [query] on youtube" → YouTube search + click first result
- "search [query] on fitgirl" → FitGirl Repacks search
- "search [query] apk" → APKMirror search
- "close [app]" → Close application
"""

import os
import re
import time
import logging
import urllib.parse
from typing import Dict, Any, Optional, List, Tuple, Callable
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger("tools.automation")

# Lazy imports for heavy dependencies
_pyautogui = None
_win32gui = None
_webbrowser = None


def _get_pyautogui():
    global _pyautogui
    if _pyautogui is None:
        import pyautogui
        pyautogui.FAILSAFE = True
        _pyautogui = pyautogui
    return _pyautogui


def _get_win32gui():
    global _win32gui
    if _win32gui is None:
        import win32gui
        _win32gui = win32gui
    return _win32gui


def _get_webbrowser():
    global _webbrowser
    if _webbrowser is None:
        import webbrowser
        _webbrowser = webbrowser
    return _webbrowser


# ============================================================================
# Automation Types
# ============================================================================

class AutomationType(str, Enum):
    """Types of automations available."""
    OPEN_APP = "open_app"
    CLOSE_APP = "close_app"
    SEARCH_YOUTUBE = "search_youtube"
    SEARCH_FITGIRL = "search_fitgirl"
    SEARCH_APK = "search_apk"
    SEARCH_SFLIX = "search_sflix"
    MIDJOURNEY = "midjourney"
    OPEN_URL = "open_url"
    TYPE_TEXT = "type_text"
    PRESS_KEY = "press_key"
    HOTKEY = "hotkey"
    CLICK = "click"
    SCREENSHOT = "screenshot"


@dataclass
class AutomationResult:
    """Result of an automation execution."""
    success: bool
    message: str
    automation_type: AutomationType
    details: Optional[Dict[str, Any]] = None


# ============================================================================
# Fast-Path Command Patterns (no LLM needed)
# ============================================================================

FAST_PATH_PATTERNS = {
    # Open app patterns
    "open_app": [
        r"^(?:open|launch|start|run)(?: up| the)?\s+(.+?)(?:\s+(?:app|application))?$",
        r"^(?:show|display|bring up)(?: me)?(?: the)?\s+(.+?)$",
    ],
    
    # Close app patterns
    "close_app": [
        r"^(?:close|quit|exit|terminate|end|kill)(?: the)?\s+(.+?)(?:\s+(?:app|application))?$",
        r"^(?:shut down|stop)(?: the)?\s+(.+?)(?:\s+(?:app|application))?$",
    ],
    
    # YouTube search patterns
    "search_youtube": [
        r"^(?:search|find|look up|show me)(?: for)?(?: a| an| the)?\s+(.+?)\s+(?:on|in)\s+(?:youtube|yt)$",
        r"^(?:search|find|look up|show me)(?: for)?(?: a| an| the)?\s+(.+?)\s+videos?$",
        r"^(?:youtube|yt)\s+(?:search|find)\s+(.+)$",
        r"^(?:play|watch)\s+(.+?)\s+(?:on|in)\s+(?:youtube|yt)$",
    ],
    
    # FitGirl/game search patterns
    "search_fitgirl": [
        r"^(?:search|find|look up|show me|get)(?: for)?(?: a| an| the)?\s+(.+?)\s+(?:on|in)\s+(?:fitgirl|fg)$",
        r"^(?:fitgirl|fg)\s+(?:search|find)\s+(.+)$",
        r"^(?:search|find|look up|show me|get)(?: for)?(?: a| an| the)?\s+(.+?)\s+(?:repack|game)$",
    ],
    
    # APK search patterns
    "search_apk": [
        r"^(?:search|find|look up|show me|get)(?: for)?(?: a| an| the)?\s+(.+?)\s+apk$",
        r"^(?:search|find|look up|show me|get)(?: for)?\s+apk\s+(?:for|of)\s+(.+)$",
        r"^(?:apk)\s+(?:search|find)\s+(.+)$",
    ],
    
    # SFlix/movie search patterns
    "search_sflix": [
        r"^(?:search|find|watch)(?: for)?(?: a| an| the)?\s+(.+?)\s+(?:on|in)\s+(?:sflix|sf)$",
        r"^(?:sflix|sf)\s+(?:search|find)\s+(.+)$",
        r"^(?:stream|watch)\s+(.+?)\s+(?:movie|show|series)$",
    ],
    
    # Midjourney patterns
    "midjourney": [
        r"^(?:imagine|/imagine)\s+(.+)$",
        r"^(?:midjourney|mj)\s+(?:imagine|create|generate)\s+(.+)$",
    ],
    
    # URL patterns
    "open_url": [
        r"^(?:open|go to|visit)\s+(https?://\S+)$",
        r"^(?:open|go to|visit)\s+(?:the\s+)?(?:website\s+)?(www\.\S+)$",
        r"^(?:open|go to|visit)\s+([\w.-]+\.(?:com|org|net|io|co|app|dev|edu|gov))$",
    ],
}

# System apps that should always work
SYSTEM_APPS = {
    "task manager", "taskmgr", "control panel", "file explorer", "explorer",
    "settings", "command prompt", "cmd", "powershell", "terminal",
    "calculator", "calc", "notepad", "paint", "mspaint", "wordpad",
}

# Common websites for quick open
COMMON_WEBSITES = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "github": "https://www.github.com",
    "reddit": "https://www.reddit.com",
    "twitter": "https://www.twitter.com",
    "x": "https://www.x.com",
    "facebook": "https://www.facebook.com",
    "instagram": "https://www.instagram.com",
    "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com",
    "discord": "https://discord.com/app",
    "twitch": "https://www.twitch.tv",
    "amazon": "https://www.amazon.com",
}


# ============================================================================
# Fast-Path Parser
# ============================================================================

def parse_fast_path(text: str) -> Optional[Tuple[AutomationType, str]]:
    """
    Try to parse a command using fast-path patterns.
    
    Returns (automation_type, extracted_value) if matched, None otherwise.
    This allows instant execution without LLM involvement.
    """
    text_lower = text.lower().strip()
    
    for pattern_type, patterns in FAST_PATH_PATTERNS.items():
        for pattern in patterns:
            match = re.match(pattern, text_lower, re.IGNORECASE)
            if match:
                # Some patterns (like get_time) don't capture a value
                try:
                    value = match.group(1).strip() if match.lastindex else ""
                except IndexError:
                    value = ""
                automation_type = AutomationType(pattern_type)
                logger.debug(f"Fast-path match: {pattern_type} -> {value}")
                return (automation_type, value)
    
    # Check for common website shortcuts
    for site, url in COMMON_WEBSITES.items():
        if text_lower in [f"open {site}", f"go to {site}", site]:
            return (AutomationType.OPEN_URL, url)
    
    return None


# ============================================================================
# Automation Executors
# ============================================================================

def open_app(app_name: str) -> AutomationResult:
    """
    Open an application using Start menu search.
    
    This is the most reliable method for opening apps on Windows.
    """
    pyautogui = _get_pyautogui()
    
    try:
        logger.info(f"Opening app: {app_name}")
        
        # Press Windows key to open Start menu
        pyautogui.press('win')
        time.sleep(0.5)
        
        # Type the app name
        pyautogui.write(app_name, interval=0.02)
        time.sleep(0.5)
        
        # Press Enter to launch
        pyautogui.press('enter')
        time.sleep(0.2)
        pyautogui.press('enter')  # Second enter for confirmation dialogs
        
        return AutomationResult(
            success=True,
            message=f"Launched {app_name}",
            automation_type=AutomationType.OPEN_APP,
            details={"app_name": app_name},
        )
        
    except Exception as e:
        logger.error(f"Failed to open {app_name}: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to open {app_name}: {str(e)}",
            automation_type=AutomationType.OPEN_APP,
        )


def close_app(app_name: str) -> AutomationResult:
    """
    Close an application by finding its window and sending Alt+F4.
    """
    pyautogui = _get_pyautogui()
    win32gui = _get_win32gui()
    
    try:
        logger.info(f"Closing app: {app_name}")
        
        # Find window by title
        def find_window(hwnd, windows):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd).lower()
                if app_name.lower() in title:
                    windows.append(hwnd)
        
        windows = []
        win32gui.EnumWindows(find_window, windows)
        
        if windows:
            # Bring window to front and close it
            hwnd = windows[0]
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.3)
            pyautogui.hotkey('alt', 'F4')
            
            return AutomationResult(
                success=True,
                message=f"Closed {app_name}",
                automation_type=AutomationType.CLOSE_APP,
                details={"app_name": app_name, "window_handle": hwnd},
            )
        else:
            return AutomationResult(
                success=False,
                message=f"Could not find window for {app_name}",
                automation_type=AutomationType.CLOSE_APP,
            )
            
    except Exception as e:
        logger.error(f"Failed to close {app_name}: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to close {app_name}: {str(e)}",
            automation_type=AutomationType.CLOSE_APP,
        )


def search_youtube(query: str, click_first: bool = True) -> AutomationResult:
    """
    Search YouTube and optionally click the first result.
    """
    pyautogui = _get_pyautogui()
    win32gui = _get_win32gui()
    webbrowser = _get_webbrowser()
    
    try:
        logger.info(f"YouTube search: {query}")
        
        # Build search URL
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
        
        # Open in browser
        webbrowser.open(url, new=2)
        
        if not click_first:
            return AutomationResult(
                success=True,
                message=f"Opened YouTube search for: {query}",
                automation_type=AutomationType.SEARCH_YOUTUBE,
                details={"query": query, "url": url},
            )
        
        # Wait for browser to open
        time.sleep(3.0)
        
        # Find YouTube window
        def find_youtube_window(hwnd, windows):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd).lower()
                if 'youtube' in title or 'edge' in title or 'chrome' in title:
                    windows.append(hwnd)
        
        windows = []
        win32gui.EnumWindows(find_youtube_window, windows)
        
        if windows:
            hwnd = windows[0]
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(1.0)
            
            # Get window dimensions
            rect = win32gui.GetWindowRect(hwnd)
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]
            
            # Click first result (approximately 45% across, 30% down)
            target_x = rect[0] + int(width * 0.45)
            target_y = rect[1] + int(height * 0.30)
            
            pyautogui.moveTo(target_x, target_y, duration=0.3)
            time.sleep(0.3)
            pyautogui.click()
            
            return AutomationResult(
                success=True,
                message=f"Opened YouTube video for: {query}",
                automation_type=AutomationType.SEARCH_YOUTUBE,
                details={"query": query, "url": url, "clicked_first": True},
            )
        
        return AutomationResult(
            success=True,
            message=f"Opened YouTube search for: {query} (no click)",
            automation_type=AutomationType.SEARCH_YOUTUBE,
            details={"query": query, "url": url, "clicked_first": False},
        )
        
    except Exception as e:
        logger.error(f"YouTube search failed: {e}")
        return AutomationResult(
            success=False,
            message=f"YouTube search failed: {str(e)}",
            automation_type=AutomationType.SEARCH_YOUTUBE,
        )


def search_fitgirl(query: str) -> AutomationResult:
    """
    Search FitGirl Repacks for games.
    """
    webbrowser = _get_webbrowser()
    
    try:
        logger.info(f"FitGirl search: {query}")
        
        url = f"https://fitgirl-repacks.site/?s={urllib.parse.quote(query)}"
        webbrowser.open(url, new=2)
        
        return AutomationResult(
            success=True,
            message=f"Searching FitGirl Repacks for: {query}",
            automation_type=AutomationType.SEARCH_FITGIRL,
            details={"query": query, "url": url},
        )
        
    except Exception as e:
        logger.error(f"FitGirl search failed: {e}")
        return AutomationResult(
            success=False,
            message=f"FitGirl search failed: {str(e)}",
            automation_type=AutomationType.SEARCH_FITGIRL,
        )


def search_apk(query: str) -> AutomationResult:
    """
    Search APKMirror for Android APKs.
    """
    webbrowser = _get_webbrowser()
    
    try:
        # Clean query
        clean_query = query.replace('APK', '').replace('apk', '').strip()
        logger.info(f"APK search: {clean_query}")
        
        url = f"https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s={urllib.parse.quote(clean_query)}"
        webbrowser.open(url, new=2)
        
        return AutomationResult(
            success=True,
            message=f"Searching APKMirror for: {clean_query}",
            automation_type=AutomationType.SEARCH_APK,
            details={"query": clean_query, "url": url},
        )
        
    except Exception as e:
        logger.error(f"APK search failed: {e}")
        return AutomationResult(
            success=False,
            message=f"APK search failed: {str(e)}",
            automation_type=AutomationType.SEARCH_APK,
        )


def search_sflix(query: str) -> AutomationResult:
    """
    Search SFlix for movies and TV shows.
    """
    webbrowser = _get_webbrowser()
    
    try:
        logger.info(f"SFlix search: {query}")
        
        url = f"https://sflix.to/search/{urllib.parse.quote(query)}"
        webbrowser.open(url, new=2)
        
        return AutomationResult(
            success=True,
            message=f"Searching SFlix for: {query}",
            automation_type=AutomationType.SEARCH_SFLIX,
            details={"query": query, "url": url},
        )
        
    except Exception as e:
        logger.error(f"SFlix search failed: {e}")
        return AutomationResult(
            success=False,
            message=f"SFlix search failed: {str(e)}",
            automation_type=AutomationType.SEARCH_SFLIX,
        )


def midjourney_imagine(prompt: str) -> AutomationResult:
    """
    Open Midjourney and submit an /imagine prompt.
    
    Opens the Midjourney website and types the prompt automatically.
    """
    pyautogui = _get_pyautogui()
    webbrowser = _get_webbrowser()
    
    try:
        logger.info(f"Midjourney imagine: {prompt}")
        
        # Open Midjourney
        url = "https://www.midjourney.com/imagine"
        webbrowser.open(url, new=2)
        
        # Wait for page to load
        time.sleep(3)
        
        # Type the prompt
        pyautogui.write(prompt, interval=0.02)
        time.sleep(0.5)
        
        # Press Enter to submit
        pyautogui.press('enter')
        
        return AutomationResult(
            success=True,
            message=f"Submitted Midjourney prompt: {prompt[:50]}...",
            automation_type=AutomationType.TYPE_TEXT,
            details={"prompt": prompt, "url": url},
        )
        
    except Exception as e:
        logger.error(f"Midjourney imagine failed: {e}")
        return AutomationResult(
            success=False,
            message=f"Midjourney imagine failed: {str(e)}",
            automation_type=AutomationType.TYPE_TEXT,
        )


def open_url(url: str) -> AutomationResult:
    """
    Open a URL in the default browser.
    """
    webbrowser = _get_webbrowser()
    
    try:
        # Add https:// if missing
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        
        logger.info(f"Opening URL: {url}")
        webbrowser.open(url, new=2)
        
        return AutomationResult(
            success=True,
            message=f"Opened {url}",
            automation_type=AutomationType.OPEN_URL,
            details={"url": url},
        )
        
    except Exception as e:
        logger.error(f"Failed to open URL: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to open URL: {str(e)}",
            automation_type=AutomationType.OPEN_URL,
        )


def type_text(text: str, interval: float = 0.005) -> AutomationResult:
    """
    Type text via clipboard paste (instant).
    """
    pyautogui = _get_pyautogui()
    
    try:
        logger.info(f"Typing text: {text[:50]}...")
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
        
        return AutomationResult(
            success=True,
            message=f"Typed {len(text)} characters",
            automation_type=AutomationType.TYPE_TEXT,
            details={"length": len(text)},
        )
        
    except Exception as e:
        logger.error(f"Failed to type text: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to type text: {str(e)}",
            automation_type=AutomationType.TYPE_TEXT,
        )


def press_key(key: str) -> AutomationResult:
    """
    Press a single key.
    """
    pyautogui = _get_pyautogui()
    
    try:
        logger.info(f"Pressing key: {key}")
        pyautogui.press(key)
        
        return AutomationResult(
            success=True,
            message=f"Pressed {key}",
            automation_type=AutomationType.PRESS_KEY,
            details={"key": key},
        )
        
    except Exception as e:
        logger.error(f"Failed to press key: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to press key: {str(e)}",
            automation_type=AutomationType.PRESS_KEY,
        )


def hotkey(*keys: str) -> AutomationResult:
    """
    Press a key combination (e.g., Ctrl+C).
    """
    pyautogui = _get_pyautogui()
    
    try:
        key_combo = "+".join(keys)
        logger.info(f"Pressing hotkey: {key_combo}")
        pyautogui.hotkey(*keys)
        
        return AutomationResult(
            success=True,
            message=f"Pressed {key_combo}",
            automation_type=AutomationType.HOTKEY,
            details={"keys": list(keys)},
        )
        
    except Exception as e:
        logger.error(f"Failed to press hotkey: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to press hotkey: {str(e)}",
            automation_type=AutomationType.HOTKEY,
        )


def click(x: Optional[int] = None, y: Optional[int] = None, button: str = "left") -> AutomationResult:
    """
    Click at coordinates or current position.
    """
    pyautogui = _get_pyautogui()
    
    try:
        if x is not None and y is not None:
            logger.info(f"Clicking at ({x}, {y})")
            pyautogui.click(x, y, button=button)
        else:
            logger.info("Clicking at current position")
            pyautogui.click(button=button)
        
        return AutomationResult(
            success=True,
            message=f"Clicked ({x}, {y})" if x else "Clicked",
            automation_type=AutomationType.CLICK,
            details={"x": x, "y": y, "button": button},
        )
        
    except Exception as e:
        logger.error(f"Failed to click: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to click: {str(e)}",
            automation_type=AutomationType.CLICK,
        )


# ============================================================================
# Unified Execution
# ============================================================================

def execute_automation(
    automation_type: AutomationType,
    value: str,
    **kwargs,
) -> AutomationResult:
    """
    Execute an automation by type.
    """
    executors = {
        AutomationType.OPEN_APP: lambda v, **kw: open_app(v),
        AutomationType.CLOSE_APP: lambda v, **kw: close_app(v),
        AutomationType.SEARCH_YOUTUBE: lambda v, **kw: search_youtube(v, **kw),
        AutomationType.SEARCH_FITGIRL: lambda v, **kw: search_fitgirl(v),
        AutomationType.SEARCH_APK: lambda v, **kw: search_apk(v),
        AutomationType.SEARCH_SFLIX: lambda v, **kw: search_sflix(v),
        AutomationType.MIDJOURNEY: lambda v, **kw: midjourney_imagine(v),
        AutomationType.OPEN_URL: lambda v, **kw: open_url(v),
    }
    
    executor = executors.get(automation_type)
    if executor:
        return executor(value, **kwargs)
    
    return AutomationResult(
        success=False,
        message=f"Unknown automation type: {automation_type}",
        automation_type=automation_type,
    )


def try_fast_path(text: str) -> Optional[AutomationResult]:
    """
    Try to execute a command via fast-path (no LLM needed).
    
    Returns AutomationResult if fast-path matched, None otherwise.
    """
    parsed = parse_fast_path(text)
    if parsed:
        automation_type, value = parsed
        return execute_automation(automation_type, value)
    return None


# ============================================================================
# Obsidian Notes Automation
# ============================================================================

# Default Obsidian vault path
_DEFAULT_OBSIDIAN_VAULT = os.path.expandvars(r"%USERPROFILE%\Documents\Obsidian\Notes")


def _get_configured_vault() -> str:
    """Read vault_path from custom_settings.json, falling back to default."""
    try:
        settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'custom_settings.json')
        if os.path.isfile(settings_path):
            import json as _json
            with open(settings_path, 'r', encoding='utf-8') as f:
                cfg = _json.load(f)
            configured = cfg.get('vault_path', '').strip()
            if configured:
                return configured
    except Exception:
        pass
    return _DEFAULT_OBSIDIAN_VAULT


# Property-like access so it's always fresh from config
OBSIDIAN_VAULT = _get_configured_vault()

# Lazy reference to CommandExecutor for full note creation
_command_executor = None


def _get_command_executor():
    """Get or create the CommandExecutor instance for full Obsidian integration."""
    global _command_executor
    if _command_executor is None:
        try:
            from ..commands.command_executor import CommandExecutor
            _command_executor = CommandExecutor()
        except Exception as e:
            logger.warning(f"Could not load CommandExecutor: {e}")
    return _command_executor


def _find_obsidian_window():
    """Find Obsidian window handle by searching all visible windows."""
    win32gui = _get_win32gui()
    if not win32gui:
        return None
    
    obsidian_windows = []
    
    def enum_callback(hwnd, results):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd).lower()
            if 'obsidian' in title:
                results.append(hwnd)
    
    win32gui.EnumWindows(enum_callback, obsidian_windows)
    return obsidian_windows[0] if obsidian_windows else None


def _ensure_obsidian_open_and_focused() -> Tuple[bool, Optional[int], Optional[Tuple[int, int]]]:
    """
    Ensure Obsidian is open and focused, return window info.
    
    Returns:
        (success, hwnd, center_coords) - center_coords is (x, y) of window center
    """
    win32gui = _get_win32gui()
    webbrowser = _get_webbrowser()
    
    if not win32gui:
        logger.error("win32gui not available")
        return False, None, None
    
    # Import win32con for window constants
    try:
        import win32con
    except ImportError:
        logger.error("win32con not available")
        return False, None, None
    
    # Find existing Obsidian window
    hwnd = _find_obsidian_window()
    
    if not hwnd:
        # Launch Obsidian
        logger.info("Obsidian not running, launching...")
        try:
            import os
            os.startfile("obsidian://")
        except Exception:
            webbrowser.open("obsidian://")
        
        # Wait for it to open
        for _ in range(10):  # Try for up to 5 seconds
            time.sleep(0.5)
            hwnd = _find_obsidian_window()
            if hwnd:
                logger.info(f"Found Obsidian window after launch: {hwnd}")
                break
    
    if not hwnd:
        logger.error("Could not find or launch Obsidian")
        return False, None, None
    
    try:
        # Get window position first
        rect = win32gui.GetWindowRect(hwnd)
        left, top, right, bottom = rect
        width = right - left
        height = bottom - top
        
        # Calculate center
        center_x = left + (width // 2)
        center_y = top + (height // 2)
        
        logger.info(f"Obsidian at ({left}, {top}) size {width}x{height}, center ({center_x}, {center_y})")
        
        # Restore if minimized
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            time.sleep(0.3)
            # Re-get position after restore
            rect = win32gui.GetWindowRect(hwnd)
            left, top, right, bottom = rect
            center_x = left + ((right - left) // 2)
            center_y = top + ((bottom - top) // 2)
        
        # Use multiple methods to bring window to foreground
        # Method 1: Alt key trick to allow SetForegroundWindow
        try:
            import win32api
            win32api.keybd_event(0x12, 0, 0, 0)  # Alt press
            win32gui.SetForegroundWindow(hwnd)
            win32api.keybd_event(0x12, 0, 2, 0)  # Alt release
        except Exception:
            pass
        
        # Method 2: ShowWindow with SW_SHOW
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        except Exception:
            pass
        
        # Method 3: BringWindowToTop
        try:
            win32gui.BringWindowToTop(hwnd)
        except Exception:
            pass
        
        time.sleep(0.3)
        
        return True, hwnd, (center_x, center_y)
        
    except Exception as e:
        logger.error(f"Error focusing Obsidian: {e}")
        # Still return the center if we got it
        try:
            rect = win32gui.GetWindowRect(hwnd)
            left, top, right, bottom = rect
            center_x = left + ((right - left) // 2)
            center_y = top + ((bottom - top) // 2)
            return True, hwnd, (center_x, center_y)
        except:
            return False, hwnd, None


def create_obsidian_note(
    title: str,
    content: str,
    tags: Optional[List[str]] = None,
    folder: Optional[str] = None,
    use_app: bool = True,
) -> AutomationResult:
    """
    Create a note in Obsidian.
    
    - Opens Obsidian if not running
    - Brings window to front
    - Tracks actual window position
    - Clicks center of window
    - Creates new note via Ctrl+N
    - Pastes content via clipboard
    
    Args:
        title: Note title
        content: Note content (markdown)
        tags: Optional list of tags to add
        folder: Optional subfolder (only used in file-only mode)
        use_app: If True, use Obsidian app. If False, just write file.
    """
    # Add tags to content if provided
    if tags:
        tag_line = " ".join(f"#{tag}" for tag in tags)
        content = f"{content}\n\n{tag_line}"
    
    # Build full note content with title
    full_content = f"# {title}\n\n{content}"
    
    if not use_app:
        return _create_note_file(title, full_content, folder)
    
    pyautogui = _get_pyautogui()
    if not pyautogui:
        logger.warning("PyAutoGUI not available, falling back to file method")
        return _create_note_file(title, full_content, folder)
    
    # Import pyperclip for clipboard
    try:
        import pyperclip
    except ImportError:
        logger.warning("pyperclip not available, falling back to file method")
        return _create_note_file(title, full_content, folder)
    
    try:
        # Ensure Obsidian is open and get window position
        success, hwnd, center = _ensure_obsidian_open_and_focused()
        
        if not success or not center:
            logger.warning("Could not focus Obsidian, falling back to file method")
            return _create_note_file(title, full_content, folder)
        
        center_x, center_y = center
        
        # Move to center and click to ensure focus
        logger.info(f"Moving to Obsidian center at ({center_x}, {center_y})")
        pyautogui.moveTo(center_x, center_y, duration=0.2)
        time.sleep(0.2)
        pyautogui.click()
        time.sleep(0.3)
        
        # Create new note with Ctrl+N
        logger.info("Pressing Ctrl+N for new note")
        pyautogui.hotkey('ctrl', 'n')
        time.sleep(1.0)
        
        # Type/paste the title
        logger.info(f"Pasting title: {title}")
        pyperclip.copy(title)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.3)
        
        # Move to content area
        pyautogui.press('down')
        time.sleep(0.3)
        
        # Ensure no modifier keys stuck
        pyautogui.keyUp('ctrl')
        pyautogui.keyUp('shift')
        pyautogui.keyUp('alt')
        
        # Paste the content
        logger.info(f"Pasting content ({len(full_content)} chars)")
        pyperclip.copy(full_content)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.3)
        
        # Release keys again
        pyautogui.keyUp('ctrl')
        pyautogui.keyUp('shift')
        pyautogui.keyUp('alt')
        
        return AutomationResult(
            success=True,
            message=f"Created note: {title}",
            automation_type=AutomationType.OPEN_APP,
            details={"title": title, "tags": tags, "method": "app", "window_center": center},
        )
        
    except Exception as e:
        logger.error(f"Obsidian app method failed: {e}")
        return _create_note_file(title, full_content, folder)


def _create_note_file(
    title: str,
    content: str,
    folder: Optional[str] = None,
) -> AutomationResult:
    """
    Fallback: Create note as a file directly in the vault.
    """
    try:
        vault = _get_configured_vault()
        
        # Ensure vault exists
        if not os.path.exists(vault):
            os.makedirs(vault, exist_ok=True)
        
        # Handle subfolder
        if folder:
            vault = os.path.join(vault, folder)
            os.makedirs(vault, exist_ok=True)
        
        # Sanitize title for filename
        safe_title = re.sub(r'[<>:"/\\|?*]', '', title)
        filename = f"{safe_title}.md"
        filepath = os.path.join(vault, filename)
        
        # Write file
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        logger.info(f"Created Obsidian note file: {filepath}")
        
        return AutomationResult(
            success=True,
            message=f"Created note file: {title}",
            automation_type=AutomationType.OPEN_APP,
            details={"filepath": filepath, "title": title, "method": "file"},
        )
        
    except Exception as e:
        logger.error(f"Failed to create Obsidian note file: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to create note: {str(e)}",
            automation_type=AutomationType.OPEN_APP,
        )


def search_obsidian_notes(
    query: str,
    vault_path: Optional[str] = None,
    max_results: int = 10,
) -> AutomationResult:
    """
    Search notes in Obsidian vault.
    """
    import glob
    
    try:
        vault = vault_path or _get_configured_vault()
        
        if not os.path.exists(vault):
            return AutomationResult(
                success=False,
                message=f"Vault not found: {vault}",
                automation_type=AutomationType.OPEN_APP,
            )
        
        # Search all markdown files
        results = []
        pattern = os.path.join(vault, "**", "*.md")
        
        for filepath in glob.glob(pattern, recursive=True):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                if query.lower() in content.lower():
                    # Extract title from first heading or filename
                    title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
                    title = title_match.group(1) if title_match else os.path.basename(filepath)
                    
                    # Find matching line for context
                    for line in content.split('\n'):
                        if query.lower() in line.lower():
                            results.append({
                                "title": title,
                                "path": filepath,
                                "match": line.strip()[:100],
                            })
                            break
                    
                    if len(results) >= max_results:
                        break
                        
            except Exception:
                continue
        
        return AutomationResult(
            success=True,
            message=f"Found {len(results)} notes matching '{query}'",
            automation_type=AutomationType.OPEN_APP,
            details={"results": results, "query": query},
        )
        
    except Exception as e:
        logger.error(f"Failed to search Obsidian: {e}")
        return AutomationResult(
            success=False,
            message=f"Search failed: {str(e)}",
            automation_type=AutomationType.OPEN_APP,
        )


def list_obsidian_notes(
    folder: Optional[str] = None,
    vault_path: Optional[str] = None,
    limit: int = 20,
) -> AutomationResult:
    """
    List recent notes in Obsidian vault.
    """
    try:
        vault = vault_path or _get_configured_vault()
        
        if folder:
            vault = os.path.join(vault, folder)
        
        if not os.path.exists(vault):
            return AutomationResult(
                success=False,
                message=f"Path not found: {vault}",
                automation_type=AutomationType.OPEN_APP,
            )
        
        # Get all markdown files with modification time
        notes = []
        for root, dirs, files in os.walk(vault):
            for file in files:
                if file.endswith('.md'):
                    filepath = os.path.join(root, file)
                    mtime = os.path.getmtime(filepath)
                    notes.append({
                        "name": file[:-3],  # Remove .md
                        "path": filepath,
                        "modified": mtime,
                    })
        
        # Sort by modification time (newest first)
        notes.sort(key=lambda x: x["modified"], reverse=True)
        notes = notes[:limit]
        
        return AutomationResult(
            success=True,
            message=f"Found {len(notes)} notes",
            automation_type=AutomationType.OPEN_APP,
            details={"notes": notes},
        )
        
    except Exception as e:
        logger.error(f"Failed to list Obsidian notes: {e}")
        return AutomationResult(
            success=False,
            message=f"List failed: {str(e)}",
            automation_type=AutomationType.OPEN_APP,
        )


def open_obsidian_note(
    title: str,
    vault_path: Optional[str] = None,
) -> AutomationResult:
    """
    Open a note in Obsidian using the obsidian:// URI scheme.
    """
    webbrowser = _get_webbrowser()
    
    try:
        vault = vault_path or _get_configured_vault()
        vault_name = os.path.basename(vault)
        
        # Build Obsidian URI
        # obsidian://open?vault=VaultName&file=NoteName
        import urllib.parse
        uri = f"obsidian://open?vault={urllib.parse.quote(vault_name)}&file={urllib.parse.quote(title)}"
        
        webbrowser.open(uri)
        
        return AutomationResult(
            success=True,
            message=f"Opened note: {title}",
            automation_type=AutomationType.OPEN_URL,
            details={"title": title, "uri": uri},
        )
        
    except Exception as e:
        logger.error(f"Failed to open Obsidian note: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to open note: {str(e)}",
            automation_type=AutomationType.OPEN_URL,
        )


# ============================================================================
# Skills Self-Creation
# ============================================================================

SKILLS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "skills")


def create_skill(
    name: str,
    description: str,
    content: str,
    triggers: Optional[List[str]] = None,
) -> AutomationResult:
    """
    Create a new skill file that the agent can use in the future.
    
    This allows the agent to teach itself new workflows!
    
    Args:
        name: Skill name (becomes filename)
        description: Brief description of what the skill does
        content: Markdown content with instructions
        triggers: Keywords that activate this skill
    """
    try:
        os.makedirs(SKILLS_DIR, exist_ok=True)
        
        # Sanitize name for filename
        safe_name = re.sub(r'[<>:"/\\|?*]', '', name.lower().replace(' ', '-'))
        filename = f"{safe_name}.md"
        filepath = os.path.join(SKILLS_DIR, filename)
        
        # Build skill file
        trigger_str = ",".join(triggers) if triggers else name.lower()
        
        skill_content = f"""---
name: {name}
description: {description}
triggers: {trigger_str}
---

{content}
"""
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(skill_content)
        
        logger.info(f"Created skill: {filepath}")
        
        return AutomationResult(
            success=True,
            message=f"Created skill: {name}",
            automation_type=AutomationType.OPEN_APP,
            details={"filepath": filepath, "name": name, "triggers": triggers},
        )
        
    except Exception as e:
        logger.error(f"Failed to create skill: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to create skill: {str(e)}",
            automation_type=AutomationType.OPEN_APP,
        )


def list_skills() -> AutomationResult:
    """
    List all available skills.
    """
    try:
        if not os.path.exists(SKILLS_DIR):
            return AutomationResult(
                success=True,
                message="No skills directory found",
                automation_type=AutomationType.OPEN_APP,
                details={"skills": []},
            )
        
        skills = []
        for file in os.listdir(SKILLS_DIR):
            if file.endswith('.md'):
                filepath = os.path.join(SKILLS_DIR, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # Parse frontmatter
                    name = file[:-3]
                    description = ""
                    
                    if content.startswith('---'):
                        end_idx = content.find('---', 3)
                        if end_idx != -1:
                            frontmatter = content[3:end_idx]
                            for line in frontmatter.split('\n'):
                                if line.startswith('name:'):
                                    name = line.split(':', 1)[1].strip()
                                elif line.startswith('description:'):
                                    description = line.split(':', 1)[1].strip()
                    
                    skills.append({
                        "name": name,
                        "description": description,
                        "file": file,
                    })
                except Exception:
                    continue
        
        return AutomationResult(
            success=True,
            message=f"Found {len(skills)} skills",
            automation_type=AutomationType.OPEN_APP,
            details={"skills": skills},
        )
        
    except Exception as e:
        logger.error(f"Failed to list skills: {e}")
        return AutomationResult(
            success=False,
            message=f"Failed to list skills: {str(e)}",
            automation_type=AutomationType.OPEN_APP,
        )


# ============================================================================
# Tool Registration
# ============================================================================

def get_automation_tools() -> List[Dict[str, Any]]:
    """
    Get tool definitions for the automation system.
    
    These can be registered with the tool registry for agent use.
    """
    return [
        {
            "name": "open_app",
            "description": "Open an application using Start menu search. Works for any installed app.",
            "function": open_app,
            "schema": {
                "type": "object",
                "properties": {
                    "app_name": {"type": "string", "description": "Name of the application to open"},
                },
                "required": ["app_name"],
            },
        },
        {
            "name": "close_app",
            "description": "Close an application by finding its window and closing it.",
            "function": close_app,
            "schema": {
                "type": "object",
                "properties": {
                    "app_name": {"type": "string", "description": "Name of the application to close"},
                },
                "required": ["app_name"],
            },
        },
        {
            "name": "search_youtube",
            "description": "Search YouTube for videos. Can optionally click the first result.",
            "function": search_youtube,
            "schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "click_first": {"type": "boolean", "description": "Whether to click the first result", "default": True},
                },
                "required": ["query"],
            },
        },
        {
            "name": "search_fitgirl",
            "description": "Search FitGirl Repacks for game downloads.",
            "function": search_fitgirl,
            "schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Game name to search for"},
                },
                "required": ["query"],
            },
        },
        {
            "name": "search_apk",
            "description": "Search APKMirror for Android APK files.",
            "function": search_apk,
            "schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "App name to search for"},
                },
                "required": ["query"],
            },
        },
        {
            "name": "search_sflix",
            "description": "Search SFlix for movies and TV shows to stream.",
            "function": search_sflix,
            "schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Movie or TV show name"},
                },
                "required": ["query"],
            },
        },
        {
            "name": "midjourney_imagine",
            "description": "Open Midjourney and submit an /imagine prompt for AI image generation.",
            "function": midjourney_imagine,
            "schema": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Image generation prompt"},
                },
                "required": ["prompt"],
            },
        },
        {
            "name": "open_url",
            "description": "Open a URL in the default browser.",
            "function": open_url,
            "schema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to open"},
                },
                "required": ["url"],
            },
        },
        {
            "name": "type_text",
            "description": "Type text using keyboard simulation.",
            "function": type_text,
            "schema": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to type"},
                    "interval": {"type": "number", "description": "Delay between keystrokes in seconds", "default": 0.02},
                },
                "required": ["text"],
            },
        },
        {
            "name": "press_key",
            "description": "Press a single key (e.g., 'enter', 'tab', 'escape').",
            "function": press_key,
            "schema": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Key to press"},
                },
                "required": ["key"],
            },
        },
        {
            "name": "hotkey",
            "description": "Press a key combination (e.g., ctrl+c, alt+f4).",
            "function": lambda keys: hotkey(*keys.split('+')),
            "schema": {
                "type": "object",
                "properties": {
                    "keys": {"type": "string", "description": "Key combination separated by + (e.g., 'ctrl+c')"},
                },
                "required": ["keys"],
            },
        },
        {
            "name": "click",
            "description": "Click at coordinates or current mouse position.",
            "function": click,
            "schema": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "X coordinate (optional)"},
                    "y": {"type": "integer", "description": "Y coordinate (optional)"},
                    "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
                },
            },
        },
        # Obsidian Notes tools
        {
            "name": "obsidian_create_note",
            "description": "Create a note in Obsidian. Opens Obsidian app, creates new note via Ctrl+N, pastes content. Full integration with memory system.",
            "function": create_obsidian_note,
            "schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Note title"},
                    "content": {"type": "string", "description": "Note content in markdown"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to add to the note"},
                    "use_app": {"type": "boolean", "description": "Use Obsidian app (True) or just write file (False)", "default": True},
                },
                "required": ["title", "content"],
            },
        },
        {
            "name": "obsidian_search",
            "description": "Search notes in Obsidian vault by content.",
            "function": search_obsidian_notes,
            "schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "max_results": {"type": "integer", "description": "Maximum results to return", "default": 10},
                },
                "required": ["query"],
            },
        },
        {
            "name": "obsidian_list",
            "description": "List recent notes in Obsidian vault.",
            "function": list_obsidian_notes,
            "schema": {
                "type": "object",
                "properties": {
                    "folder": {"type": "string", "description": "Subfolder to list (optional)"},
                    "limit": {"type": "integer", "description": "Maximum notes to return", "default": 20},
                },
            },
        },
        {
            "name": "obsidian_open",
            "description": "Open a note in Obsidian app.",
            "function": open_obsidian_note,
            "schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Note title to open"},
                },
                "required": ["title"],
            },
        },
        # Skills self-creation tools
        {
            "name": "skill_create",
            "description": "Create a new skill that teaches the agent a workflow. Use this to learn new automations!",
            "function": create_skill,
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill name"},
                    "description": {"type": "string", "description": "Brief description of what the skill does"},
                    "content": {"type": "string", "description": "Markdown content with instructions and examples"},
                    "triggers": {"type": "array", "items": {"type": "string"}, "description": "Keywords that activate this skill"},
                },
                "required": ["name", "description", "content"],
            },
        },
        {
            "name": "skill_list",
            "description": "List all available skills the agent can use.",
            "function": list_skills,
            "schema": {
                "type": "object",
                "properties": {},
            },
        },
    ]


def register_automation_tools(registry) -> int:
    """
    Register all automation tools with a tool registry.
    
    Returns number of tools registered.
    """
    tools = get_automation_tools()
    count = 0
    
    for tool in tools:
        try:
            registry.register(
                name=tool["name"],
                execute=tool["function"],
                description=tool["description"],
                schema=tool.get("schema"),
                category="automation",
            )
            count += 1
            logger.info(f"Registered automation tool: {tool['name']}")
        except Exception as e:
            logger.warning(f"Failed to register {tool['name']}: {e}")
    
    return count
