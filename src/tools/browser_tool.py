"""
Browser Tool - Browser automation via Playwright
=================================================
Features:
- Open/close browser tabs
- Navigate to URLs
- Take screenshots
- Click, type, scroll
- Extract page content
- Handle downloads
"""

import os
import time
import base64
import logging
import asyncio
import threading
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Playwright is disabled — browser tools now use simple webbrowser.open() + HTTP fetch
# via web_tool.py. The code below is preserved but inactive.
# To re-enable Playwright, change PLAYWRIGHT_DISABLED to False.
PLAYWRIGHT_DISABLED = True

if PLAYWRIGHT_DISABLED:
    HAS_PLAYWRIGHT = False
else:
    try:
        from playwright.sync_api import sync_playwright, Browser, Page, BrowserContext
        HAS_PLAYWRIGHT = True
    except ImportError:
        HAS_PLAYWRIGHT = False
        logger.warning("Playwright not installed. Run: pip install playwright && playwright install")


@dataclass
class ConsoleMessage:
    """Represents a browser console message."""
    type: str  # log, warning, error, info, debug
    text: str
    url: Optional[str] = None
    line: Optional[int] = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class BrowserSession:
    """Represents a browser session."""
    session_id: str
    browser: Optional[Any] = None
    context: Optional[Any] = None
    pages: Dict[str, Any] = field(default_factory=dict)
    active_page_id: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    console_messages: Dict[str, List[ConsoleMessage]] = field(default_factory=dict)  # page_id -> messages
    network_requests: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)  # page_id -> requests


# Global browser session
_browser_session: Optional[BrowserSession] = None
_browser_lock = threading.Lock()
_playwright = None
_browser_thread: Optional[threading.Thread] = None


def _run_in_thread(func, *args, **kwargs):
    """
    Run a function in a separate thread to avoid Playwright sync API conflicts
    with asyncio event loops. Returns the result or raises the exception.
    """
    result = [None]
    exception = [None]
    
    def wrapper():
        try:
            result[0] = func(*args, **kwargs)
        except Exception as e:
            exception[0] = e
    
    # Check if we're in an async context
    try:
        loop = asyncio.get_running_loop()
        in_async = True
    except RuntimeError:
        in_async = False
    
    if in_async:
        # Run in a separate thread to avoid "Playwright Sync API inside asyncio loop" error
        thread = threading.Thread(target=wrapper)
        thread.start()
        thread.join(timeout=60)  # 60 second timeout
        if thread.is_alive():
            raise TimeoutError("Browser operation timed out")
    else:
        # Not in async context, run directly
        wrapper()
    
    if exception[0]:
        raise exception[0]
    return result[0]


def _is_browser_alive() -> bool:
    """Check if the browser is actually alive and responsive."""
    global _browser_session, _playwright
    
    if _browser_session is None or _browser_session.context is None:
        return False
    
    try:
        # Try to access context.pages — this will throw if the browser is dead
        _ = _browser_session.context.pages
        return True
    except Exception:
        return False


def _reset_browser():
    """Clean up dead browser session and playwright instance."""
    global _browser_session, _playwright
    
    logger.info("[BROWSER] Resetting browser session...")
    
    if _browser_session:
        try:
            if _browser_session.context:
                _browser_session.context.close()
        except Exception:
            pass
        try:
            if _browser_session.browser and _browser_session.browser != _browser_session.context:
                _browser_session.browser.close()
        except Exception:
            pass
        _browser_session = None
    
    if _playwright:
        try:
            _playwright.stop()
        except Exception:
            pass
        _playwright = None
    
    logger.info("[BROWSER] Reset complete.")


def _with_browser_retry(func):
    """Decorator: if a browser call fails due to dead connection, reset and retry once."""
    import functools
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            err_str = str(e).lower()
            # Detect dead browser errors
            is_dead = any(phrase in err_str for phrase in [
                'target closed', 'browser has been closed', 'connection closed',
                'not connected', 'session closed', 'target page, context or browser has been closed',
                'browser.newcontext', 'channel closed', 'crashed', 'disposed',
                'protocol error', 'connection refused', 'target crashed',
            ])
            if is_dead:
                logger.warning(f"[BROWSER] Dead browser detected in {func.__name__}: {e}")
                _reset_browser()
                # Retry once after reset
                try:
                    return func(*args, **kwargs)
                except Exception as retry_err:
                    logger.error(f"[BROWSER] Retry also failed in {func.__name__}: {retry_err}")
                    return {"status": "error", "error": f"Browser restart failed: {retry_err}"}
            raise
    return wrapper


def _start_browser_internal() -> BrowserSession:
    """Internal function to start browser - runs in thread if needed."""
    global _browser_session, _playwright
    
    # Clean up any stale playwright instance before starting fresh
    if _playwright:
        try:
            _playwright.stop()
        except Exception:
            pass
        _playwright = None
    
    logger.info("Starting browser (Microsoft Edge)...")
    _playwright = sync_playwright().start()
    
    # Dedicated agent-owned profile — persists logins across sessions,
    # never conflicts with the user's open Edge browser
    soma = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    agent_profile_dir = os.path.join(soma, 'data', 'browser_profile')
    os.makedirs(agent_profile_dir, exist_ok=True)
    
    context = None
    
    # Primary: launch with dedicated agent profile
    try:
        logger.info(f"Launching Edge with agent profile: {agent_profile_dir}")
        context = _playwright.chromium.launch_persistent_context(
            user_data_dir=agent_profile_dir,
            channel='msedge',
            headless=False,
            viewport={'width': 1280, 'height': 720},
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
            ]
        )
    except Exception as e:
        logger.warning(f"Agent profile launch failed ({e}), trying fresh temp profile...")
    
    # Fallback: fresh temporary profile (no logins but always works)
    if context is None:
        try:
            import tempfile
            temp_profile = os.path.join(tempfile.gettempdir(), f'substrate_browser_{int(time.time())}')
            os.makedirs(temp_profile, exist_ok=True)
            logger.info(f"Launching Edge with temp profile: {temp_profile}")
            context = _playwright.chromium.launch_persistent_context(
                user_data_dir=temp_profile,
                channel='msedge',
                headless=False,
                viewport={'width': 1280, 'height': 720},
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                ]
            )
        except Exception as e2:
            logger.error(f"Temp profile also failed ({e2}), trying non-persistent launch...")
            # Last resort: non-persistent context
            browser_instance = _playwright.chromium.launch(
                channel='msedge',
                headless=False,
            )
            context = browser_instance.new_context(viewport={'width': 1280, 'height': 720})
    
    browser = context
    
    _browser_session = BrowserSession(
        session_id=f"browser_{int(time.time())}",
        browser=browser,
        context=context,
    )
    logger.info(f"Browser started: {_browser_session.session_id}")
    return _browser_session


def _ensure_browser() -> BrowserSession:
    """Ensure browser is running and return session (liveness check + auto-restart)."""
    global _browser_session, _playwright
    
    if not HAS_PLAYWRIGHT:
        raise RuntimeError("Playwright not installed. Run: pip install playwright && playwright install")
    
    with _browser_lock:
        # Check if browser is actually alive, not just if the Python object exists
        if _browser_session is not None and not _is_browser_alive():
            logger.warning("[BROWSER] Session exists but browser is dead — resetting...")
            _reset_browser()
        
        if _browser_session is None:
            _run_in_thread(_start_browser_internal)
        
        if _browser_session is None:
            raise RuntimeError("Failed to start browser")
        
        return _browser_session


def _get_page(page_id: Optional[str] = None) -> Any:
    """Get a page by ID or the active page."""
    session = _ensure_browser()
    
    if page_id and page_id in session.pages:
        page = session.pages[page_id]
        # Validate page is still open
        try:
            if page.is_closed():
                del session.pages[page_id]
            else:
                return page
        except Exception:
            del session.pages[page_id]
    
    if session.active_page_id and session.active_page_id in session.pages:
        page = session.pages[session.active_page_id]
        try:
            if not page.is_closed():
                return page
            else:
                del session.pages[session.active_page_id]
                session.active_page_id = None
        except Exception:
            del session.pages[session.active_page_id]
            session.active_page_id = None
    
    # Create new page if none exists — open_tab returns a dict, get the page from session
    result = open_tab()
    if result.get('status') == 'success' and result.get('page_id'):
        return session.pages.get(result['page_id'])
    
    raise RuntimeError("Could not create a new browser tab")


def browser_status() -> Dict[str, Any]:
    """Get browser status."""
    global _browser_session
    
    if not HAS_PLAYWRIGHT:
        return {
            "status": "error",
            "error": "Playwright not installed",
            "install_command": "pip install playwright && playwright install",
        }
    
    if _browser_session is None or _browser_session.browser is None:
        return {
            "status": "stopped",
            "message": "Browser not running",
        }
    
    return {
        "status": "running",
        "session_id": _browser_session.session_id,
        "tabs": len(_browser_session.pages),
        "active_tab": _browser_session.active_page_id,
        "uptime_seconds": int(time.time() - _browser_session.started_at),
    }


@_with_browser_retry
def start_browser() -> Dict[str, Any]:
    """Start the browser if not running."""
    try:
        session = _ensure_browser()
        return {
            "status": "success",
            "session_id": session.session_id,
            "message": "Browser started",
        }
    except Exception as e:
        logger.error(f"Error starting browser: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def stop_browser() -> Dict[str, Any]:
    """Stop the browser."""
    global _browser_session, _playwright
    
    with _browser_lock:
        if _browser_session and _browser_session.browser:
            try:
                _browser_session.browser.close()
            except Exception:
                pass
            _browser_session = None
        
        if _playwright:
            try:
                _playwright.stop()
            except Exception:
                pass
            _playwright = None
    
    return {
        "status": "success",
        "message": "Browser stopped",
    }


def _setup_page_listeners(session: BrowserSession, page: Any, page_id: str):
    """Set up console and network listeners for a page."""
    # Initialize message lists
    session.console_messages[page_id] = []
    session.network_requests[page_id] = []
    
    # Console message listener
    def on_console(msg):
        try:
            console_msg = ConsoleMessage(
                type=msg.type,
                text=msg.text,
                url=msg.location.get('url') if hasattr(msg, 'location') and msg.location else None,
                line=msg.location.get('lineNumber') if hasattr(msg, 'location') and msg.location else None,
            )
            messages = session.console_messages.get(page_id, [])
            messages.append(console_msg)
            # Keep only last 100 messages per page
            if len(messages) > 100:
                messages = messages[-100:]
            session.console_messages[page_id] = messages
        except Exception as e:
            logger.debug(f"Error capturing console message: {e}")
    
    # Network request listener
    def on_request(request):
        try:
            req_info = {
                "url": request.url,
                "method": request.method,
                "resource_type": request.resource_type,
                "timestamp": time.time(),
            }
            requests = session.network_requests.get(page_id, [])
            requests.append(req_info)
            # Keep only last 50 requests per page
            if len(requests) > 50:
                requests = requests[-50:]
            session.network_requests[page_id] = requests
        except Exception as e:
            logger.debug(f"Error capturing network request: {e}")
    
    # Attach listeners
    try:
        page.on("console", on_console)
        page.on("request", on_request)
    except Exception as e:
        logger.debug(f"Could not attach page listeners: {e}")


def _open_tab_internal(url: Optional[str] = None) -> Dict[str, Any]:
    """Internal function to open tab - runs in thread if needed."""
    global _browser_session
    session = _browser_session
    
    page = session.context.new_page()
    page_id = f"tab_{int(time.time() * 1000)}"
    
    # Set up console and network listeners
    _setup_page_listeners(session, page, page_id)
    
    session.pages[page_id] = page
    session.active_page_id = page_id
    
    if url:
        url = _normalize_url(url)
        page.goto(url, wait_until='domcontentloaded', timeout=30000)
    
    return {
        "status": "success",
        "page_id": page_id,
        "url": page.url,
        "title": page.title(),
        "message": f"Opened new tab: {page_id}",
    }


@_with_browser_retry
def open_tab(url: Optional[str] = None) -> Dict[str, Any]:
    """
    Open a new browser tab.
    
    Args:
        url: URL to navigate to (optional)
        
    Returns:
        Dict with tab info
    """
    try:
        _ensure_browser()
        return _run_in_thread(_open_tab_internal, url)
    except Exception as e:
        logger.error(f"Error opening tab: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


@_with_browser_retry
def close_tab(page_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Close a browser tab.
    
    Args:
        page_id: Tab ID to close (closes active tab if not specified)
        
    Returns:
        Dict with result
    """
    try:
        session = _ensure_browser()
        
        target_id = page_id or session.active_page_id
        if not target_id or target_id not in session.pages:
            return {
                "status": "error",
                "error": "Tab not found",
            }
        
        page = session.pages[target_id]
        page.close()
        del session.pages[target_id]
        
        # Update active page
        if session.active_page_id == target_id:
            session.active_page_id = next(iter(session.pages), None)
        
        return {
            "status": "success",
            "message": f"Closed tab: {target_id}",
        }
        
    except Exception as e:
        logger.error(f"Error closing tab: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def _normalize_url(url: str) -> str:
    """
    Normalize a URL to ensure it has proper protocol format.
    Fixes common issues like 'https//example.com' -> 'https://example.com'
    """
    if not url:
        return url
    
    url = url.strip()
    
    # Fix missing colon after protocol (https// -> https://)
    import re
    url = re.sub(r'^(https?)//(?!:)', r'\1://', url)
    
    # Add https:// if no protocol specified
    if not url.startswith(('http://', 'https://', 'file://')):
        url = 'https://' + url
    
    return url


def _navigate_internal(url: str, page_id: Optional[str], wait_until: str, timeout: int) -> Dict[str, Any]:
    """Internal navigate function - runs in thread."""
    global _browser_session
    session = _browser_session
    page = session.pages.get(page_id or session.active_page_id)
    
    if not page:
        return None  # Signal to open new tab
    
    page.goto(url, wait_until=wait_until, timeout=timeout)
    
    return {
        "status": "success",
        "url": page.url,
        "title": page.title(),
    }


@_with_browser_retry
def navigate(
    url: str,
    page_id: Optional[str] = None,
    wait_until: str = "domcontentloaded",
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Navigate to a URL.
    
    Args:
        url: URL to navigate to
        page_id: Tab ID (uses active tab if not specified)
        wait_until: Wait condition (domcontentloaded, load, networkidle)
        timeout: Timeout in milliseconds
        
    Returns:
        Dict with result
    """
    try:
        url = _normalize_url(url)
        _ensure_browser()
        
        result = _run_in_thread(_navigate_internal, url, page_id, wait_until, timeout)
        if result is None:
            return open_tab(url)
        return result
        
    except Exception as e:
        logger.error(f"Error navigating: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def _screenshot_internal(page_id: Optional[str], full_page: bool, selector: Optional[str], path: Optional[str]) -> Dict[str, Any]:
    """Internal screenshot function - runs in thread."""
    global _browser_session
    session = _browser_session
    page = session.pages.get(page_id or session.active_page_id)
    
    if not page:
        return {"status": "error", "error": "No active tab"}
    
    if selector:
        element = page.query_selector(selector)
        if not element:
            return {"status": "error", "error": f"Element not found: {selector}"}
        screenshot_bytes = element.screenshot()
    else:
        screenshot_bytes = page.screenshot(full_page=full_page)
    
    if path:
        with open(path, 'wb') as f:
            f.write(screenshot_bytes)
        return {"status": "success", "path": path, "size": len(screenshot_bytes)}
    else:
        return {
            "status": "success",
            "image": base64.b64encode(screenshot_bytes).decode('utf-8'),
            "size": len(screenshot_bytes),
        }


@_with_browser_retry
def screenshot(
    page_id: Optional[str] = None,
    full_page: bool = False,
    selector: Optional[str] = None,
    path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Take a screenshot.
    
    Args:
        page_id: Tab ID (uses active tab if not specified)
        full_page: Capture full page (not just viewport)
        selector: CSS selector to screenshot specific element
        path: Path to save screenshot (returns base64 if not specified)
        
    Returns:
        Dict with screenshot data
    """
    # Normalize path to screenshots/ directory
    if path is not None:
        screenshots_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'screenshots')
        os.makedirs(screenshots_dir, exist_ok=True)
        if os.path.dirname(path) in ('', '.'):
            path = os.path.join(screenshots_dir, path)
        elif not os.path.abspath(path).startswith(os.path.abspath(screenshots_dir)):
            path = os.path.join(screenshots_dir, os.path.basename(path))
    try:
        _ensure_browser()
        return _run_in_thread(_screenshot_internal, page_id, full_page, selector, path)
    except Exception as e:
        logger.error(f"Error taking screenshot: {e}")
        return {"status": "error", "error": str(e)}


def _click_internal(selector: str, page_id: Optional[str], button: str, click_count: int, timeout: int) -> Dict[str, Any]:
    """Internal click function - runs in thread."""
    global _browser_session
    session = _browser_session
    page = session.pages.get(page_id or session.active_page_id)
    
    if not page:
        return {"status": "error", "error": "No active tab"}
    
    # Try as CSS selector first, then as text
    try:
        page.click(selector, button=button, click_count=click_count, timeout=timeout)
    except Exception:
        page.click(f"text={selector}", button=button, click_count=click_count, timeout=timeout)
    
    return {"status": "success", "message": f"Clicked: {selector}"}


@_with_browser_retry
def click(
    selector: str,
    page_id: Optional[str] = None,
    button: str = "left",
    click_count: int = 1,
    timeout: int = 5000,
) -> Dict[str, Any]:
    """
    Click an element.
    
    Args:
        selector: CSS selector or text to click
        page_id: Tab ID
        button: Mouse button (left, right, middle)
        click_count: Number of clicks
        timeout: Timeout in milliseconds
        
    Returns:
        Dict with result
    """
    try:
        _ensure_browser()
        return _run_in_thread(_click_internal, selector, page_id, button, click_count, timeout)
    except Exception as e:
        logger.error(f"Error clicking: {e}")
        return {"status": "error", "error": str(e)}


def _type_text_internal(selector: str, text: str, page_id: Optional[str], clear: bool, delay: int, timeout: int) -> Dict[str, Any]:
    """Internal type_text function - runs in thread."""
    global _browser_session
    session = _browser_session
    page = session.pages.get(page_id or session.active_page_id)
    
    if not page:
        return {"status": "error", "error": "No active tab"}
    
    if clear:
        page.fill(selector, "", timeout=timeout)
    
    page.type(selector, text, delay=delay, timeout=timeout)
    return {"status": "success", "message": f"Typed {len(text)} characters into {selector}"}


@_with_browser_retry
def type_text(
    selector: str,
    text: str,
    page_id: Optional[str] = None,
    clear: bool = False,
    delay: int = 50,
    timeout: int = 5000,
) -> Dict[str, Any]:
    """
    Type text into an element.
    
    Args:
        selector: CSS selector of input element
        text: Text to type
        page_id: Tab ID
        clear: Clear existing text first
        delay: Delay between keystrokes in ms
        timeout: Timeout in milliseconds
        
    Returns:
        Dict with result
    """
    try:
        _ensure_browser()
        return _run_in_thread(_type_text_internal, selector, text, page_id, clear, delay, timeout)
    except Exception as e:
        logger.error(f"Error typing: {e}")
        return {"status": "error", "error": str(e)}


def _scroll_internal(direction: str, amount: int, page_id: Optional[str], selector: Optional[str]) -> Dict[str, Any]:
    """Internal scroll function - runs in thread."""
    global _browser_session
    session = _browser_session
    page = session.pages.get(page_id or session.active_page_id)
    
    if not page:
        return {"status": "error", "error": "No active tab"}
    
    delta_x, delta_y = 0, 0
    if direction == "down": delta_y = amount
    elif direction == "up": delta_y = -amount
    elif direction == "right": delta_x = amount
    elif direction == "left": delta_x = -amount
    
    if selector:
        page.evaluate(f"const el = document.querySelector('{selector}'); if (el) el.scrollBy({delta_x}, {delta_y});")
    else:
        page.evaluate(f"window.scrollBy({delta_x}, {delta_y})")
    
    return {"status": "success", "message": f"Scrolled {direction} by {amount}px"}


@_with_browser_retry
def scroll(
    direction: str = "down",
    amount: int = 500,
    page_id: Optional[str] = None,
    selector: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Scroll the page or an element.
    
    Args:
        direction: Scroll direction (up, down, left, right)
        amount: Scroll amount in pixels
        page_id: Tab ID
        selector: CSS selector to scroll within (scrolls page if not specified)
        
    Returns:
        Dict with result
    """
    try:
        _ensure_browser()
        return _run_in_thread(_scroll_internal, direction, amount, page_id, selector)
    except Exception as e:
        logger.error(f"Error scrolling: {e}")
        return {"status": "error", "error": str(e)}


def _get_content_internal(page_id: Optional[str], selector: Optional[str], include_html: bool, max_length: int) -> Dict[str, Any]:
    """Internal get_content function - runs in thread."""
    global _browser_session
    session = _browser_session
    page = session.pages.get(page_id or session.active_page_id)
    
    if not page:
        return {"status": "error", "error": "No active tab"}
    
    if selector:
        element = page.query_selector(selector)
        if not element:
            return {"status": "error", "error": f"Element not found: {selector}"}
        text = element.inner_text()
        html = element.inner_html() if include_html else None
    else:
        text = page.inner_text('body')
        html = page.content() if include_html else None
    
    if len(text) > max_length:
        text = text[:max_length] + f"\n... (truncated, {len(text)} total chars)"
    
    result = {"status": "success", "url": page.url, "title": page.title(), "text": text}
    
    if html:
        if len(html) > max_length:
            html = html[:max_length] + "<!-- truncated -->"
        result["html"] = html
    
    return result


@_with_browser_retry
def get_content(
    page_id: Optional[str] = None,
    selector: Optional[str] = None,
    include_html: bool = False,
    max_length: int = 50000,
) -> Dict[str, Any]:
    """
    Get page content.
    
    Args:
        page_id: Tab ID
        selector: CSS selector to get specific element content
        include_html: Include HTML in response
        max_length: Maximum content length
        
    Returns:
        Dict with page content
    """
    try:
        _ensure_browser()
        return _run_in_thread(_get_content_internal, page_id, selector, include_html, max_length)
    except Exception as e:
        logger.error(f"Error getting content: {e}")
        return {"status": "error", "error": str(e)}


@_with_browser_retry
def get_console_messages(
    page_id: Optional[str] = None,
    type_filter: Optional[str] = None,
    limit: int = 50,
    clear: bool = False,
) -> Dict[str, Any]:
    """
    Get console messages from a page.
    
    Args:
        page_id: Tab ID (uses active tab if not specified)
        type_filter: Filter by message type (log, warning, error, info, debug)
        limit: Maximum number of messages to return
        clear: Clear messages after retrieving
        
    Returns:
        Dict with console messages
    """
    try:
        session = _ensure_browser()
        target_id = page_id or session.active_page_id
        
        if not target_id:
            return {
                "status": "error",
                "error": "No active tab",
            }
        
        messages = session.console_messages.get(target_id, [])
        
        # Apply type filter
        if type_filter:
            messages = [m for m in messages if m.type == type_filter]
        
        # Limit results
        messages = messages[-limit:]
        
        # Format for output
        formatted = []
        for msg in messages:
            formatted.append({
                "type": msg.type,
                "text": msg.text[:500] if len(msg.text) > 500 else msg.text,
                "url": msg.url,
                "line": msg.line,
            })
        
        if clear and target_id in session.console_messages:
            session.console_messages[target_id] = []
        
        return {
            "status": "success",
            "page_id": target_id,
            "messages": formatted,
            "total": len(formatted),
            "has_errors": any(m["type"] == "error" for m in formatted),
        }
        
    except Exception as e:
        logger.error(f"Error getting console messages: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


@_with_browser_retry
def get_network_requests(
    page_id: Optional[str] = None,
    type_filter: Optional[str] = None,
    limit: int = 30,
    clear: bool = False,
) -> Dict[str, Any]:
    """
    Get network requests from a page.
    
    Args:
        page_id: Tab ID (uses active tab if not specified)
        type_filter: Filter by resource type (document, script, stylesheet, image, fetch, xhr)
        limit: Maximum number of requests to return
        clear: Clear requests after retrieving
        
    Returns:
        Dict with network requests
    """
    try:
        session = _ensure_browser()
        target_id = page_id or session.active_page_id
        
        if not target_id:
            return {
                "status": "error",
                "error": "No active tab",
            }
        
        requests = session.network_requests.get(target_id, [])
        
        # Apply type filter
        if type_filter:
            requests = [r for r in requests if r.get("resource_type") == type_filter]
        
        # Limit results
        requests = requests[-limit:]
        
        # Format for output (truncate long URLs)
        formatted = []
        for req in requests:
            url = req.get("url", "")
            formatted.append({
                "url": url[:200] if len(url) > 200 else url,
                "method": req.get("method"),
                "type": req.get("resource_type"),
            })
        
        if clear and target_id in session.network_requests:
            session.network_requests[target_id] = []
        
        return {
            "status": "success",
            "page_id": target_id,
            "requests": formatted,
            "total": len(formatted),
        }
        
    except Exception as e:
        logger.error(f"Error getting network requests: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


# Global ref storage for element references
# Now stores role-based info instead of just CSS selectors
_element_refs: Dict[str, Dict[str, Any]] = {}


def _to_ai_friendly_error(error: Exception, ref: str = "") -> str:
    """Convert an exception to an AI-friendly error message."""
    msg = str(error)
    
    # Common Playwright errors with helpful suggestions
    if "Timeout" in msg:
        return f"Element {ref} not found or not clickable within timeout. The page may have changed - run browser_snapshot again to get fresh refs."
    if "not visible" in msg.lower():
        return f"Element {ref} exists but is not visible. It may be hidden, off-screen, or covered by another element."
    if "intercept" in msg.lower() or "overlay" in msg.lower():
        return f"Element {ref} is covered by another element (popup, modal, or overlay). Try closing any dialogs first."
    if "detached" in msg.lower():
        return f"Element {ref} was removed from the page. The page content changed - run browser_snapshot again."
    if "disabled" in msg.lower():
        return f"Element {ref} is disabled and cannot be interacted with."
    
    return f"Error with {ref}: {msg}"


def _clamp_timeout(timeout_ms: Optional[int], default: int = 8000) -> int:
    """Clamp timeout to reasonable bounds (500ms - 60s)."""
    if timeout_ms is None:
        return default
    return max(500, min(60000, timeout_ms))


@_with_browser_retry
def get_snapshot(
    page_id: Optional[str] = None,
    interactive_only: bool = True,
    max_elements: int = 50,
) -> Dict[str, Any]:
    """
    Get a structured snapshot of page elements with refs.
    
    Returns elements with refs like @1, @2, @3 that store ROLE + NAME info
    for more reliable clicking via Playwright's semantic locators.
    
    Args:
        page_id: Tab ID
        interactive_only: Only show interactive elements (buttons, links, inputs)
        max_elements: Maximum number of elements to return
        
    Returns:
        Dict with structured element list and refs
    """
    global _element_refs
    
    try:
        session = _ensure_browser()
        page = session.pages.get(page_id or session.active_page_id)
        
        if not page:
            return {
                "status": "error",
                "error": "No active tab. Use browser_open to open a page first.",
            }
        
        # Clear old refs
        _element_refs.clear()
        
        # Enhanced JavaScript to extract elements with role-based info for semantic locators
        js_code = """
        () => {
            const interactive = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], [role="tab"], [role="option"], [onclick], [tabindex]';
            const all = 'button, a, input, select, textarea, h1, h2, h3, h4, h5, h6, p, span, div, label, img, [role]';
            
            const selectorStr = arguments[0] ? interactive : all;
            const maxElements = arguments[1] || 50;
            
            // Map HTML tags to ARIA roles
            const tagToRole = {
                'button': 'button',
                'a': 'link',
                'input': (el) => {
                    const type = el.type?.toLowerCase() || 'text';
                    if (type === 'checkbox') return 'checkbox';
                    if (type === 'radio') return 'radio';
                    if (type === 'submit' || type === 'button') return 'button';
                    if (type === 'search') return 'searchbox';
                    return 'textbox';
                },
                'select': 'combobox',
                'textarea': 'textbox',
                'img': 'img',
                'h1': 'heading',
                'h2': 'heading',
                'h3': 'heading',
                'h4': 'heading',
                'h5': 'heading',
                'h6': 'heading',
                'nav': 'navigation',
                'main': 'main',
                'aside': 'complementary',
                'footer': 'contentinfo',
                'header': 'banner',
                'form': 'form',
                'table': 'table',
                'ul': 'list',
                'ol': 'list',
                'li': 'listitem',
            };
            
            function getRole(el) {
                const explicitRole = el.getAttribute('role');
                if (explicitRole) return explicitRole;
                
                const tag = el.tagName.toLowerCase();
                const roleMapper = tagToRole[tag];
                if (typeof roleMapper === 'function') return roleMapper(el);
                if (roleMapper) return roleMapper;
                return tag;
            }
            
            function getAccessibleName(el) {
                // Priority: aria-label > aria-labelledby > alt > title > placeholder > visible text
                const ariaLabel = el.getAttribute('aria-label');
                if (ariaLabel) return ariaLabel.trim();
                
                const labelledBy = el.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const labelEl = document.getElementById(labelledBy);
                    if (labelEl) return labelEl.textContent?.trim() || '';
                }
                
                // For inputs, check associated label
                if (el.id) {
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    if (label) return label.textContent?.trim() || '';
                }
                
                const alt = el.getAttribute('alt');
                if (alt) return alt.trim();
                
                const title = el.getAttribute('title');
                if (title) return title.trim();
                
                const placeholder = el.getAttribute('placeholder');
                if (placeholder) return placeholder.trim();
                
                // Visible text (limit length)
                const text = (el.innerText || el.value || '').trim();
                return text.slice(0, 80);
            }
            
            const elements = Array.from(document.querySelectorAll(selectorStr));
            const results = [];
            const seenRoleNames = {};  // Track role+name combos for nth index
            
            for (const el of elements) {
                if (results.length >= maxElements) break;
                
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                
                // Visibility checks
                const isVisible = rect.width > 0 && rect.height > 0 && 
                                  style.visibility !== 'hidden' &&
                                  style.display !== 'none' &&
                                  style.opacity !== '0' &&
                                  rect.top < window.innerHeight && 
                                  rect.bottom > 0 &&
                                  rect.left < window.innerWidth &&
                                  rect.right > 0;
                
                if (!isVisible) continue;
                
                const tag = el.tagName.toLowerCase();
                const role = getRole(el);
                const name = getAccessibleName(el);
                const type = el.getAttribute('type') || '';
                const id = el.id || '';
                
                // Calculate nth index for duplicate role+name combos
                const roleNameKey = `${role}::${name}`;
                if (!seenRoleNames[roleNameKey]) {
                    seenRoleNames[roleNameKey] = 0;
                }
                const nth = seenRoleNames[roleNameKey];
                seenRoleNames[roleNameKey]++;
                
                // Build fallback CSS selector
                let cssSelector = tag;
                if (id) cssSelector = '#' + CSS.escape(id);
                else if (el.name) cssSelector = tag + '[name="' + el.name + '"]';
                
                results.push({
                    ref: '@' + (results.length + 1),
                    tag: tag,
                    role: role,
                    name: name,
                    type: type,
                    id: id,
                    nth: nth,  // For getByRole().nth(n)
                    cssSelector: cssSelector,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                });
            }
            
            return results;
        }
        """
        
        elements = page.evaluate(f"({js_code})({str(interactive_only).lower()}, {max_elements})")
        
        # Store refs with role-based info for semantic locator resolution
        for el in elements:
            _element_refs[el['ref']] = {
                'role': el['role'],
                'name': el['name'],
                'nth': el['nth'],
                'cssSelector': el['cssSelector'],
                'tag': el['tag'],
            }
        
        # Format for LLM - clear and actionable
        lines = [f"# {page.title()}", f"URL: {page.url}", "", "## Interactive Elements:"]
        for el in elements:
            role = el.get('role', el.get('tag', ''))
            name = el.get('name', '')[:50]
            ref = el.get('ref', '')
            el_type = el.get('type', '')
            
            if el_type:
                role = f"{role}[{el_type}]"
            
            if name:
                lines.append(f"  {ref} [{role}] \"{name}\"")
            else:
                lines.append(f"  {ref} [{role}]")
        
        lines.append("")
        lines.append("---")
        lines.append(f"Total: {len(elements)} elements. Use browser_click_ref @N to click, browser_type_ref @N to type.")
        
        return {
            "status": "success",
            "url": page.url,
            "title": page.title(),
            "snapshot": "\n".join(lines),
            "elements": elements,
            "ref_count": len(elements),
        }
        
    except Exception as e:
        logger.error(f"Error getting snapshot: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def _get_locator_for_ref(page, ref_info: Dict[str, Any]):
    """
    Get a Playwright locator for a ref using semantic locators.
    Falls back to CSS selector if semantic locator fails.
    
    Priority:
    1. getByRole with name (most reliable)
    2. getByRole without name + nth
    3. getByText (for links/buttons with text)
    4. CSS selector (fallback)
    """
    role = ref_info.get('role', '')
    name = ref_info.get('name', '')
    nth = ref_info.get('nth', 0)
    css = ref_info.get('cssSelector', '')
    
    # Map our roles to Playwright's expected role names
    playwright_roles = {
        'button', 'checkbox', 'combobox', 'grid', 'gridcell', 'heading',
        'img', 'link', 'list', 'listbox', 'listitem', 'menu', 'menubar',
        'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
        'option', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
        'rowgroup', 'scrollbar', 'searchbox', 'separator', 'slider',
        'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist',
        'tabpanel', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree',
        'treegrid', 'treeitem',
    }
    
    try:
        # Try semantic locator first
        if role in playwright_roles:
            if name:
                # Use getByRole with name for precise matching
                locator = page.get_by_role(role, name=name, exact=False)
                if nth > 0:
                    locator = locator.nth(nth)
                return locator
            else:
                # Use getByRole without name, rely on nth
                locator = page.get_by_role(role)
                if nth > 0:
                    locator = locator.nth(nth)
                return locator
        
        # For text-based elements, try getByText
        if name and role in ('link', 'button'):
            return page.get_by_text(name, exact=False).first
        
        # Fallback to CSS selector
        if css:
            return page.locator(css)
        
        # Last resort: try text selector
        if name:
            return page.locator(f"text={name}").first
            
    except Exception:
        pass
    
    # Ultimate fallback
    if css:
        return page.locator(css)
    
    return None


@_with_browser_retry
def click_ref(
    ref: str,
    page_id: Optional[str] = None,
    timeout: int = 8000,
    force: bool = False,
    double_click: bool = False,
) -> Dict[str, Any]:
    """
    Click an element by its ref (e.g., @1, @2).
    
    Uses semantic locators (getByRole) for reliable clicking.
    Automatically scrolls element into view and retries on failure.
    
    Args:
        ref: Element ref from snapshot (e.g., "@1", "@2")
        page_id: Tab ID
        timeout: Timeout in milliseconds (default 8000, clamped 500-60000)
        force: Force click even if element is not visible
        double_click: Double-click instead of single click
        
    Returns:
        Dict with result
    """
    global _element_refs
    
    try:
        session = _ensure_browser()
        page = session.pages.get(page_id or session.active_page_id)
        
        if not page:
            return {
                "status": "error",
                "error": "No active tab. Use browser_open to open a page first.",
            }
        
        # Normalize ref
        ref = ref.strip()
        if not ref.startswith('@'):
            ref = '@' + ref
        
        if ref not in _element_refs:
            available = list(_element_refs.keys())[:10]
            return {
                "status": "error",
                "error": f"Ref {ref} not found. Available refs: {available}. Run browser_snapshot to get current refs.",
            }
        
        ref_info = _element_refs[ref]
        timeout = _clamp_timeout(timeout)
        
        # Get semantic locator
        locator = _get_locator_for_ref(page, ref_info)
        if not locator:
            return {
                "status": "error",
                "error": f"Could not create locator for {ref}. Run browser_snapshot again.",
            }
        
        # Scroll into view first
        try:
            locator.scroll_into_view_if_needed(timeout=min(timeout, 5000))
        except Exception:
            pass  # Continue even if scroll fails
        
        # Attempt click with retries
        last_error = None
        for attempt in range(3):
            try:
                if double_click:
                    locator.dblclick(timeout=timeout, force=force)
                else:
                    locator.click(timeout=timeout, force=force)
                
                return {
                    "status": "success",
                    "message": f"{'Double-clicked' if double_click else 'Clicked'} {ref} ({ref_info.get('role', '')} \"{ref_info.get('name', '')[:30]}\")",
                    "ref": ref,
                }
            except Exception as e:
                last_error = e
                
                # On first failure, try force click
                if attempt == 0 and not force:
                    try:
                        if double_click:
                            locator.dblclick(timeout=timeout, force=True)
                        else:
                            locator.click(timeout=timeout, force=True)
                        return {
                            "status": "success",
                            "message": f"{'Double-clicked' if double_click else 'Clicked'} {ref} (force mode)",
                            "ref": ref,
                            "note": "Used force click - element may have been covered",
                        }
                    except Exception:
                        pass
                
                # On second failure, try JavaScript click
                if attempt == 1:
                    try:
                        locator.evaluate("el => el.click()")
                        return {
                            "status": "success",
                            "message": f"Clicked {ref} via JavaScript",
                            "ref": ref,
                            "note": "Used JS click fallback",
                        }
                    except Exception:
                        pass
                
                # Small delay before retry
                time.sleep(0.2)
        
        return {
            "status": "error",
            "error": _to_ai_friendly_error(last_error, ref),
        }
        
    except Exception as e:
        logger.error(f"Error clicking ref: {e}")
        return {
            "status": "error",
            "error": _to_ai_friendly_error(e, ref),
        }


@_with_browser_retry
def type_ref(
    ref: str,
    text: str,
    page_id: Optional[str] = None,
    clear: bool = True,
    submit: bool = False,
    slowly: bool = False,
    timeout: int = 8000,
) -> Dict[str, Any]:
    """
    Type into an element by its ref (e.g., @1, @2).
    
    Uses semantic locators for reliable typing.
    Automatically scrolls element into view.
    
    Args:
        ref: Element ref from snapshot (e.g., "@1", "@2")
        text: Text to type
        page_id: Tab ID
        clear: Clear existing text first (default True)
        submit: Press Enter after typing (default False)
        slowly: Type slowly with delays (for sites that need it)
        timeout: Timeout in milliseconds
        
    Returns:
        Dict with result
    """
    global _element_refs
    
    try:
        session = _ensure_browser()
        page = session.pages.get(page_id or session.active_page_id)
        
        if not page:
            return {
                "status": "error",
                "error": "No active tab. Use browser_open to open a page first.",
            }
        
        # Normalize ref
        ref = ref.strip()
        if not ref.startswith('@'):
            ref = '@' + ref
        
        if ref not in _element_refs:
            available = list(_element_refs.keys())[:10]
            return {
                "status": "error",
                "error": f"Ref {ref} not found. Available refs: {available}. Run browser_snapshot to get current refs.",
            }
        
        ref_info = _element_refs[ref]
        timeout = _clamp_timeout(timeout)
        
        # Get semantic locator
        locator = _get_locator_for_ref(page, ref_info)
        if not locator:
            return {
                "status": "error",
                "error": f"Could not create locator for {ref}. Run browser_snapshot again.",
            }
        
        # Scroll into view first
        try:
            locator.scroll_into_view_if_needed(timeout=min(timeout, 5000))
        except Exception:
            pass
        
        # Click to focus first
        try:
            locator.click(timeout=min(timeout, 3000))
        except Exception:
            pass  # Continue even if click fails
        
        # Type the text
        try:
            if slowly:
                # Type character by character with delay
                if clear:
                    locator.fill("", timeout=timeout)
                locator.type(text, delay=75, timeout=timeout)
            else:
                # Use fill for instant input (also clears)
                if clear:
                    locator.fill(text, timeout=timeout)
                else:
                    locator.type(text, timeout=timeout)
            
            # Submit if requested
            if submit:
                locator.press("Enter", timeout=timeout)
            
            display_text = text[:30] + '...' if len(text) > 30 else text
            return {
                "status": "success",
                "message": f"Typed '{display_text}' into {ref}" + (" and submitted" if submit else ""),
                "ref": ref,
            }
            
        except Exception as e:
            # Fallback: try JavaScript-based input
            try:
                locator.evaluate(f"el => {{ el.value = {repr(text)}; el.dispatchEvent(new Event('input', {{bubbles: true}})); }}")
                if submit:
                    locator.press("Enter", timeout=timeout)
                return {
                    "status": "success",
                    "message": f"Typed into {ref} via JavaScript",
                    "ref": ref,
                    "note": "Used JS fallback",
                }
            except Exception:
                pass
            
            return {
                "status": "error",
                "error": _to_ai_friendly_error(e, ref),
            }
        
    except Exception as e:
        logger.error(f"Error typing into ref: {e}")
        return {
            "status": "error",
            "error": _to_ai_friendly_error(e, ref),
        }


@_with_browser_retry
def get_ai_snapshot(
    page_id: Optional[str] = None,
    max_chars: int = 8000,
    include_hidden: bool = False,
    format: str = "ai",
) -> Dict[str, Any]:
    """
    AI snapshot - accessibility tree for LLM consumption.
    
    Returns a compact, AI-optimized representation of the page structure
    with interactive elements marked with refs for easy clicking.
    
    Args:
        page_id: Tab ID
        max_chars: Maximum characters in output
        include_hidden: Include hidden elements
        format: "ai" for compact LLM format, "aria" for full accessibility tree
        
    Returns:
        Dict with AI-optimized page snapshot
    """
    global _element_refs
    
    try:
        session = _ensure_browser()
        page = session.pages.get(page_id or session.active_page_id)
        
        if not page:
            return {
                "status": "error",
                "error": "No active tab",
            }
        
        # Clear old refs
        _element_refs.clear()
        
        # Enhanced JavaScript for accessibility tree extraction
        js_code = """
        () => {
            const maxChars = arguments[0] || 8000;
            const includeHidden = arguments[1] || false;
            
            function getAccessibleName(el) {
                return el.getAttribute('aria-label') || 
                       el.getAttribute('alt') || 
                       el.getAttribute('title') ||
                       el.getAttribute('placeholder') ||
                       (el.innerText || '').trim().slice(0, 60);
            }
            
            function getRole(el) {
                const role = el.getAttribute('role');
                if (role) return role;
                
                const tag = el.tagName.toLowerCase();
                const roleMap = {
                    'a': 'link',
                    'button': 'button',
                    'input': el.type === 'checkbox' ? 'checkbox' : 
                             el.type === 'radio' ? 'radio' :
                             el.type === 'submit' ? 'button' : 'textbox',
                    'select': 'combobox',
                    'textarea': 'textbox',
                    'img': 'img',
                    'h1': 'heading',
                    'h2': 'heading',
                    'h3': 'heading',
                    'nav': 'navigation',
                    'main': 'main',
                    'aside': 'complementary',
                    'footer': 'contentinfo',
                    'header': 'banner',
                    'form': 'form',
                    'table': 'table',
                    'ul': 'list',
                    'ol': 'list',
                    'li': 'listitem',
                };
                return roleMap[tag] || tag;
            }
            
            function isInteractive(el) {
                const tag = el.tagName.toLowerCase();
                return ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                       el.hasAttribute('onclick') ||
                       el.hasAttribute('role') && ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem'].includes(el.getAttribute('role'));
            }
            
            function isVisible(el) {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 &&
                       style.visibility !== 'hidden' &&
                       style.display !== 'none' &&
                       rect.top < window.innerHeight && rect.bottom > 0;
            }
            
            const elements = [];
            let refCounter = 1;
            let charCount = 0;
            
            // Walk the DOM
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_ELEMENT,
                {
                    acceptNode: (node) => {
                        if (!includeHidden && !isVisible(node)) return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            
            while (walker.nextNode() && charCount < maxChars) {
                const el = walker.currentNode;
                const interactive = isInteractive(el);
                const role = getRole(el);
                const name = getAccessibleName(el);
                
                // Skip non-interactive elements without meaningful content
                if (!interactive && !name && !['heading', 'img', 'navigation', 'main'].includes(role)) {
                    continue;
                }
                
                const rect = el.getBoundingClientRect();
                const ref = interactive ? '@' + refCounter++ : null;
                
                // Build selector for ref storage
                let selector = el.tagName.toLowerCase();
                if (el.id) selector = '#' + el.id;
                else if (el.name) selector = el.tagName.toLowerCase() + '[name="' + el.name + '"]';
                else if (name && name.length < 30) selector = 'text=' + name;
                
                const entry = {
                    ref: ref,
                    role: role,
                    name: name.slice(0, 60),
                    selector: selector,
                    interactive: interactive,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                };
                
                elements.push(entry);
                charCount += JSON.stringify(entry).length;
            }
            
            return {
                url: window.location.href,
                title: document.title,
                elements: elements,
            };
        }
        """
        
        result = page.evaluate(f"({js_code})({max_chars}, {str(include_hidden).lower()})")
        
        # Store refs for later use
        for el in result.get('elements', []):
            if el.get('ref'):
                _element_refs[el['ref']] = el['selector']
        
        # Build AI-optimized text representation
        lines = [
            f"# {result.get('title', 'Untitled')}",
            f"URL: {result.get('url', '')}",
            "",
        ]
        
        current_section = None
        for el in result.get('elements', []):
            role = el.get('role', '')
            name = el.get('name', '')
            ref = el.get('ref', '')
            
            # Section headers
            if role in ['navigation', 'main', 'complementary', 'banner', 'contentinfo']:
                current_section = role
                lines.append(f"\n## [{role.upper()}]")
                continue
            
            # Format based on role
            if role == 'heading':
                lines.append(f"\n### {name}")
            elif role in ['button', 'link'] and ref:
                lines.append(f"  {ref} [{role}] {name}")
            elif role in ['textbox', 'combobox'] and ref:
                lines.append(f"  {ref} [{role}] {name or '(input)'}")
            elif role in ['checkbox', 'radio'] and ref:
                lines.append(f"  {ref} [{role}] {name}")
            elif role == 'img' and name:
                lines.append(f"  [image: {name}]")
            elif name and el.get('interactive'):
                lines.append(f"  {ref} {name}")
        
        lines.append("")
        lines.append("---")
        lines.append(f"Interactive elements: {len(_element_refs)} (use browser_click_ref @N to click)")
        
        snapshot_text = "\n".join(lines)
        
        # Truncate if needed
        if len(snapshot_text) > max_chars:
            snapshot_text = snapshot_text[:max_chars] + "\n... (truncated)"
        
        return {
            "status": "success",
            "url": result.get('url'),
            "title": result.get('title'),
            "snapshot": snapshot_text,
            "format": format,
            "ref_count": len(_element_refs),
            "targetId": page_id or session.active_page_id,
        }
        
    except Exception as e:
        logger.error(f"Error getting AI snapshot: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


@_with_browser_retry
def list_tabs() -> Dict[str, Any]:
    """List all open tabs."""
    try:
        session = _ensure_browser()
        
        tabs = []
        for page_id, page in session.pages.items():
            try:
                tabs.append({
                    "page_id": page_id,
                    "url": page.url,
                    "title": page.title(),
                    "active": page_id == session.active_page_id,
                })
            except Exception:
                pass
        
        return {
            "status": "success",
            "tabs": tabs,
            "total": len(tabs),
        }
        
    except Exception as e:
        logger.error(f"Error listing tabs: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


@_with_browser_retry
def evaluate_js(
    script: str,
    page_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute JavaScript in the page.
    
    Args:
        script: JavaScript code to execute
        page_id: Tab ID
        
    Returns:
        Dict with result
    """
    try:
        session = _ensure_browser()
        page = session.pages.get(page_id or session.active_page_id)
        
        if not page:
            return {
                "status": "error",
                "error": "No active tab",
            }
        
        result = page.evaluate(script)
        
        return {
            "status": "success",
            "result": result,
        }
        
    except Exception as e:
        logger.error(f"Error evaluating JS: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


class BrowserTool:
    """
    Browser tool for LLM function calling.
    """
    
    name = "browser"
    description = "Control a web browser - navigate, click, type, screenshot"
    
    @staticmethod
    def status() -> Dict[str, Any]:
        return browser_status()
    
    @staticmethod
    def start() -> Dict[str, Any]:
        return start_browser()
    
    @staticmethod
    def stop() -> Dict[str, Any]:
        return stop_browser()
    
    @staticmethod
    def open(url: str = None) -> Dict[str, Any]:
        return open_tab(url)
    
    @staticmethod
    def close(page_id: str = None) -> Dict[str, Any]:
        return close_tab(page_id)
    
    @staticmethod
    def goto(url: str, page_id: str = None) -> Dict[str, Any]:
        return navigate(url, page_id)
    
    @staticmethod
    def screenshot(page_id: str = None, full_page: bool = False, selector: str = None) -> Dict[str, Any]:
        return screenshot(page_id, full_page, selector)
    
    @staticmethod
    def click(selector: str, page_id: str = None) -> Dict[str, Any]:
        return click(selector, page_id)
    
    @staticmethod
    def type(selector: str, text: str, page_id: str = None, clear: bool = False) -> Dict[str, Any]:
        return type_text(selector, text, page_id, clear)
    
    @staticmethod
    def scroll(direction: str = "down", amount: int = 500, page_id: str = None) -> Dict[str, Any]:
        return scroll(direction, amount, page_id)
    
    @staticmethod
    def content(page_id: str = None, selector: str = None) -> Dict[str, Any]:
        return get_content(page_id, selector)
    
    @staticmethod
    def tabs() -> Dict[str, Any]:
        return list_tabs()
    
    @staticmethod
    def eval(script: str, page_id: str = None) -> Dict[str, Any]:
        return evaluate_js(script, page_id)
