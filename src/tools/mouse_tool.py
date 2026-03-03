"""
Mouse Tool - Full mouse control for computer-use agent
=======================================================
Gives the agent the ability to click, drag, scroll, and move
the mouse anywhere on screen. Combined with screen_tool (vision)
and process_tool (keyboard), this enables full computer-use.

Uses pyautogui for cross-platform mouse control.
"""

import logging
import time
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Try to import pyautogui
try:
    import pyautogui
    pyautogui.FAILSAFE = True  # Move mouse to corner to abort
    pyautogui.PAUSE = 0.01     # Minimal pause between actions
    HAS_PYAUTOGUI = True
except ImportError:
    HAS_PYAUTOGUI = False
    logger.warning("pyautogui not installed. Run: pip install pyautogui")


def _check_pyautogui() -> Optional[Dict[str, Any]]:
    """Return error dict if pyautogui is not available."""
    if not HAS_PYAUTOGUI:
        return {
            "status": "error",
            "error": "pyautogui not installed. Run: pip install pyautogui",
        }
    return None


def mouse_click(
    x: int,
    y: int,
    button: str = "left",
    clicks: int = 1,
    interval: float = 0.1,
) -> Dict[str, Any]:
    """
    Click at screen coordinates.
    
    Args:
        x: X coordinate on screen
        y: Y coordinate on screen
        button: "left", "right", or "middle"
        clicks: Number of clicks (2 for double-click)
        interval: Seconds between multiple clicks
        
    Returns:
        Dict with status and coordinates
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        if button not in ("left", "right", "middle"):
            return {"status": "error", "error": f"Invalid button: {button}. Use left, right, or middle."}
        
        pyautogui.click(x=x, y=y, clicks=clicks, interval=interval, button=button)
        
        action = "Clicked"
        if clicks == 2:
            action = "Double-clicked"
        elif clicks == 3:
            action = "Triple-clicked"
        if button != "left":
            action = f"{button.capitalize()}-clicked"
        
        return {
            "status": "success",
            "action": action,
            "x": x,
            "y": y,
            "button": button,
            "clicks": clicks,
            "message": f"{action} at ({x}, {y})",
        }
    except Exception as e:
        logger.error(f"Mouse click error: {e}")
        return {"status": "error", "error": str(e)}


def mouse_move(
    x: int,
    y: int,
    duration: float = 0.3,
) -> Dict[str, Any]:
    """
    Move mouse to screen coordinates.
    
    Args:
        x: X coordinate
        y: Y coordinate
        duration: Seconds to take moving (0 for instant)
        
    Returns:
        Dict with status
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        pyautogui.moveTo(x=x, y=y, duration=duration)
        return {
            "status": "success",
            "x": x,
            "y": y,
            "message": f"Moved mouse to ({x}, {y})",
        }
    except Exception as e:
        logger.error(f"Mouse move error: {e}")
        return {"status": "error", "error": str(e)}


def mouse_drag(
    from_x: int,
    from_y: int,
    to_x: int,
    to_y: int,
    duration: float = 0.5,
    button: str = "left",
) -> Dict[str, Any]:
    """
    Click and drag from one point to another.
    
    Args:
        from_x: Starting X coordinate
        from_y: Starting Y coordinate
        to_x: Ending X coordinate
        to_y: Ending Y coordinate
        duration: Seconds to take dragging
        button: Mouse button to hold during drag
        
    Returns:
        Dict with status
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        pyautogui.moveTo(from_x, from_y, duration=0.1)
        pyautogui.drag(
            to_x - from_x,
            to_y - from_y,
            duration=duration,
            button=button,
        )
        return {
            "status": "success",
            "from": {"x": from_x, "y": from_y},
            "to": {"x": to_x, "y": to_y},
            "button": button,
            "message": f"Dragged from ({from_x}, {from_y}) to ({to_x}, {to_y})",
        }
    except Exception as e:
        logger.error(f"Mouse drag error: {e}")
        return {"status": "error", "error": str(e)}


def mouse_scroll(
    clicks: int = -3,
    x: Optional[int] = None,
    y: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Scroll the mouse wheel.
    
    Args:
        clicks: Number of scroll clicks. Negative = scroll down, positive = scroll up.
        x: X coordinate to scroll at (None = current position)
        y: Y coordinate to scroll at (None = current position)
        
    Returns:
        Dict with status
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        if x is not None and y is not None:
            pyautogui.moveTo(x, y, duration=0.1)
        
        pyautogui.scroll(clicks)
        
        direction = "down" if clicks < 0 else "up"
        pos_msg = f" at ({x}, {y})" if x is not None else ""
        
        return {
            "status": "success",
            "clicks": clicks,
            "direction": direction,
            "message": f"Scrolled {direction} {abs(clicks)} clicks{pos_msg}",
        }
    except Exception as e:
        logger.error(f"Mouse scroll error: {e}")
        return {"status": "error", "error": str(e)}


def mouse_position() -> Dict[str, Any]:
    """
    Get current mouse position.
    
    Returns:
        Dict with x, y coordinates
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        pos = pyautogui.position()
        screen = pyautogui.size()
        return {
            "status": "success",
            "x": pos.x,
            "y": pos.y,
            "screen_width": screen.width,
            "screen_height": screen.height,
            "message": f"Mouse at ({pos.x}, {pos.y}), screen is {screen.width}x{screen.height}",
        }
    except Exception as e:
        logger.error(f"Mouse position error: {e}")
        return {"status": "error", "error": str(e)}


def screen_size() -> Dict[str, Any]:
    """
    Get screen dimensions.
    
    Returns:
        Dict with width and height
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        size = pyautogui.size()
        return {
            "status": "success",
            "width": size.width,
            "height": size.height,
            "message": f"Screen is {size.width}x{size.height}",
        }
    except Exception as e:
        logger.error(f"Screen size error: {e}")
        return {"status": "error", "error": str(e)}


def hotkey(*keys: str) -> Dict[str, Any]:
    """
    Press a keyboard hotkey combination.
    
    Args:
        keys: Keys to press together, e.g. hotkey("ctrl", "c") for Ctrl+C
        
    Returns:
        Dict with status
    """
    err = _check_pyautogui()
    if err:
        return err
    
    try:
        pyautogui.hotkey(*keys)
        combo = "+".join(keys)
        return {
            "status": "success",
            "keys": combo,
            "message": f"Pressed {combo}",
        }
    except Exception as e:
        logger.error(f"Hotkey error: {e}")
        return {"status": "error", "error": str(e)}
