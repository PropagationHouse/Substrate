"""
CDP Browser Client - Direct Chrome DevTools Protocol connection
===============================================================
Connects to Edge/Chrome via CDP for full DOM-level browser control
without Playwright or any browser extension.

Requirements:
- Edge/Chrome launched with --remote-debugging-port=9222
- Python stdlib only (urllib, json, websocket via websockets lib)

Features:
- Tab discovery and switching
- Page navigation
- DOM queries and interaction (click, type, get text)
- JavaScript execution in page context
- Screenshot capture from live tabs
- Page content extraction
"""

import json
import logging
import os
import subprocess
import threading
import time
import base64
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Try websocket libraries — prefer websockets (async), fall back to websocket-client (sync)
_ws_lib = None
try:
    import websocket as _ws_sync  # websocket-client (pip install websocket-client)
    _ws_lib = "websocket-client"
except ImportError:
    pass

if not _ws_lib:
    try:
        import websockets  # noqa: F401
        _ws_lib = "websockets"
    except ImportError:
        pass

HAS_WEBSOCKET = _ws_lib is not None


@dataclass
class CDPTab:
    """Represents a browser tab discovered via CDP."""
    tab_id: str
    url: str
    title: str
    ws_url: str
    tab_type: str = "page"
    favicon_url: Optional[str] = None


class CDPConnection:
    """
    Low-level CDP WebSocket connection to a single tab.
    Uses websocket-client (sync) for simplicity and thread safety.
    """

    def __init__(self, ws_url: str, timeout: float = 15.0):
        self._ws_url = ws_url
        self._timeout = timeout
        self._ws = None
        self._msg_id = 0
        self._lock = threading.Lock()
        self._responses: Dict[int, Any] = {}
        self._recv_thread: Optional[threading.Thread] = None
        self._running = False

    def connect(self) -> bool:
        """Open WebSocket connection to the tab."""
        if not HAS_WEBSOCKET:
            logger.error("No WebSocket library available. Install: pip install websocket-client")
            return False

        try:
            if _ws_lib == "websocket-client":
                self._ws = _ws_sync.WebSocket()
                self._ws.settimeout(self._timeout)
                self._ws.connect(self._ws_url)
            else:
                # websockets is async-only; for sync usage we'd need a wrapper.
                # Prefer websocket-client for this use case.
                logger.error("Only websocket-client is supported for sync CDP. Install: pip install websocket-client")
                return False

            self._running = True
            self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
            self._recv_thread.start()
            logger.info(f"CDP connected to {self._ws_url[:80]}")
            return True
        except Exception as e:
            logger.error(f"CDP connection failed: {e}")
            return False

    def disconnect(self):
        """Close the WebSocket connection."""
        self._running = False
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
        self._ws = None

    @property
    def connected(self) -> bool:
        return self._ws is not None and self._running

    def send(self, method: str, params: Optional[Dict] = None, timeout: float = None) -> Dict:
        """
        Send a CDP command and wait for the response.
        Returns the 'result' dict on success, or {'error': ...} on failure.
        """
        if not self.connected:
            return {"error": "Not connected"}

        timeout = timeout or self._timeout

        with self._lock:
            self._msg_id += 1
            msg_id = self._msg_id

        message = {"id": msg_id, "method": method}
        if params:
            message["params"] = params

        try:
            self._ws.send(json.dumps(message))
        except Exception as e:
            return {"error": f"Send failed: {e}"}

        # Wait for response
        start = time.time()
        while (time.time() - start) < timeout:
            if msg_id in self._responses:
                resp = self._responses.pop(msg_id)
                if "error" in resp:
                    return {"error": resp["error"].get("message", str(resp["error"]))}
                return resp.get("result", {})
            time.sleep(0.02)

        return {"error": f"Timeout waiting for response to {method}"}

    def _recv_loop(self):
        """Background thread to receive WebSocket messages."""
        while self._running and self._ws:
            try:
                raw = self._ws.recv()
                if not raw:
                    continue
                data = json.loads(raw)
                if "id" in data:
                    self._responses[data["id"]] = data
                # Events (no id) are ignored for now — could be used for console, network, etc.
            except _ws_sync.WebSocketTimeoutException:
                continue
            except Exception as e:
                if self._running:
                    logger.debug(f"CDP recv error: {e}")
                break

        self._running = False


class CDPBrowser:
    """
    High-level CDP browser controller.
    Discovers tabs via HTTP, connects to individual tabs via WebSocket.
    """

    # Common Edge/Chrome paths on Windows
    _BROWSER_PATHS = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]

    def __init__(self, host: str = "localhost", port: int = 9222):
        self.host = host
        self.port = port
        self._base_url = f"http://{host}:{port}"
        self._connections: Dict[str, CDPConnection] = {}
        self._active_tab_id: Optional[str] = None
        self._lock = threading.Lock()
        self._browser_process: Optional[subprocess.Popen] = None

    # ── Auto-Launch ────────────────────────────────────────────────

    def _find_browser(self) -> Optional[str]:
        """Find Edge or Chrome executable on the system."""
        for path in self._BROWSER_PATHS:
            if os.path.isfile(path):
                return path
        return None

    def launch_browser(self, url: str = "https://www.google.com") -> bool:
        """Launch Edge/Chrome with CDP enabled if not already running.
        
        Uses a separate --user-data-dir so CDP can run alongside the user's
        existing browser instance (which doesn't have the debug port).
        """
        if self.is_browser_available():
            return True

        browser_path = self._find_browser()
        if not browser_path:
            logger.error("No Edge or Chrome found on system")
            return False

        # Use a dedicated profile dir so we don't conflict with the user's
        # already-running Edge (which won't have --remote-debugging-port).
        cdp_profile = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "cdp_profile")
        cdp_profile = os.path.normpath(cdp_profile)
        os.makedirs(cdp_profile, exist_ok=True)

        try:
            cmd = [
                browser_path,
                f"--remote-debugging-port={self.port}",
                f"--user-data-dir={cdp_profile}",
                "--remote-allow-origins=*",
                "--no-first-run",
                "--no-default-browser-check",
                url,
            ]
            self._browser_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info(f"Launched browser with CDP on port {self.port}: {browser_path}")

            # Wait for CDP to become available AND have at least one tab (up to 15s)
            for _ in range(75):
                time.sleep(0.2)
                if self.is_browser_available():
                    tabs = self.list_tabs()
                    if tabs:
                        logger.info(f"Browser CDP endpoint is ready with {len(tabs)} tab(s)")
                        self._active_tab_id = tabs[0].tab_id
                        return True

            logger.warning("Browser launched but CDP endpoint not responding or no tabs")
            return False
        except Exception as e:
            logger.error(f"Failed to launch browser: {e}")
            return False

    def ensure_browser(self) -> bool:
        """Ensure browser is available with at least one connectable tab.
        If the browser is reachable but has no tabs, open one."""
        if self.is_browser_available():
            tabs = self.list_tabs()
            if tabs:
                return True
            # Browser is running but has no page tabs — open one
            logger.info("Browser available but no tabs found, opening a new tab")
            result = self.new_tab("https://www.google.com")
            if result.get("status") == "success":
                time.sleep(1)
                return True
            return False
        return self.launch_browser()

    # ── Tab Discovery ──────────────────────────────────────────────

    def is_browser_available(self) -> bool:
        """Check if the browser is reachable via CDP."""
        try:
            req = urllib.request.Request(f"{self._base_url}/json/version", method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except Exception:
            return False

    def list_tabs(self) -> List[CDPTab]:
        """Discover all open tabs via CDP HTTP endpoint."""
        try:
            req = urllib.request.Request(f"{self._base_url}/json", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())

            tabs = []
            for entry in data:
                if entry.get("type") != "page":
                    continue
                tabs.append(CDPTab(
                    tab_id=entry.get("id", ""),
                    url=entry.get("url", ""),
                    title=entry.get("title", ""),
                    ws_url=entry.get("webSocketDebuggerUrl", ""),
                    tab_type=entry.get("type", "page"),
                    favicon_url=entry.get("faviconUrl"),
                ))
            return tabs
        except Exception as e:
            logger.error(f"CDP tab discovery failed: {e}")
            return []

    def get_tab_by_url(self, url_fragment: str) -> Optional[CDPTab]:
        """Find a tab whose URL contains the given fragment."""
        for tab in self.list_tabs():
            if url_fragment.lower() in tab.url.lower():
                return tab
        return None

    def get_tab_by_title(self, title_fragment: str) -> Optional[CDPTab]:
        """Find a tab whose title contains the given fragment."""
        for tab in self.list_tabs():
            if title_fragment.lower() in tab.title.lower():
                return tab
        return None

    # ── Connection Management ──────────────────────────────────────

    def _get_connection(self, tab_id: Optional[str] = None) -> Optional[CDPConnection]:
        """Get or create a CDP connection to a tab.
        
        Auto-selects the first available tab if none specified.
        Handles stale connections by reconnecting or falling back to another tab.
        """
        target_id = tab_id or self._active_tab_id

        if not target_id:
            # Auto-select first available tab
            tabs = self.list_tabs()
            if not tabs:
                logger.warning("No tabs available for CDP connection")
                return None
            target_id = tabs[0].tab_id
            self._active_tab_id = target_id

        with self._lock:
            # Check existing connection
            if target_id in self._connections:
                conn = self._connections[target_id]
                if conn.connected:
                    return conn
                # Stale connection — remove and try to reconnect
                conn.disconnect()
                del self._connections[target_id]
                logger.info(f"Cleared stale CDP connection for tab {target_id}")

            # Find the tab's WebSocket URL
            tabs = self.list_tabs()
            tab = next((t for t in tabs if t.tab_id == target_id), None)

            # If the requested tab is gone, fall back to any available tab
            if not tab or not tab.ws_url:
                if tab_id:  # User explicitly requested this tab — don't fall back
                    logger.error(f"Tab {target_id} not found or has no WebSocket URL")
                    return None
                # Try any other tab
                tab = next((t for t in tabs if t.ws_url), None)
                if not tab:
                    logger.error("No connectable tabs found")
                    return None
                target_id = tab.tab_id
                logger.info(f"Falling back to tab {target_id} ({tab.title[:40]})")

            conn = CDPConnection(tab.ws_url)
            if conn.connect():
                self._connections[target_id] = conn
                self._active_tab_id = target_id
                return conn

            logger.error(f"Failed to connect to tab {target_id} via WebSocket")
            return None

    def attach(self, tab_id: str) -> bool:
        """Attach to a specific tab by ID."""
        conn = self._get_connection(tab_id)
        if conn:
            self._active_tab_id = tab_id
            return True
        return False

    def detach(self, tab_id: Optional[str] = None):
        """Detach from a tab."""
        target_id = tab_id or self._active_tab_id
        if target_id and target_id in self._connections:
            self._connections[target_id].disconnect()
            del self._connections[target_id]
        if self._active_tab_id == target_id:
            self._active_tab_id = None

    def detach_all(self):
        """Detach from all tabs."""
        for conn in self._connections.values():
            conn.disconnect()
        self._connections.clear()
        self._active_tab_id = None

    # ── Navigation ─────────────────────────────────────────────────

    def navigate(self, url: str, tab_id: Optional[str] = None, wait: bool = True) -> Dict[str, Any]:
        """Navigate a tab to a URL."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected. Is Edge running with --remote-debugging-port=9222?"}

        result = conn.send("Page.navigate", {"url": url})
        if "error" in result:
            return {"status": "error", "error": result["error"]}

        if wait:
            # Wait for page load
            conn.send("Page.enable")
            time.sleep(1.5)  # Simple wait — could use Page.loadEventFired for precision

        return {
            "status": "success",
            "url": url,
            "frameId": result.get("frameId", ""),
        }

    # ── JavaScript Execution ───────────────────────────────────────

    def evaluate(self, expression: str, tab_id: Optional[str] = None, timeout: float = 15.0) -> Dict[str, Any]:
        """Execute JavaScript in the page context and return the result."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}

        result = conn.send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
            "timeout": int(timeout * 1000),
        }, timeout=timeout + 2)

        if "error" in result:
            return {"status": "error", "error": result["error"]}

        remote_obj = result.get("result", {})
        exception = result.get("exceptionDetails")

        if exception:
            return {
                "status": "error",
                "error": exception.get("text", str(exception)),
            }

        return {
            "status": "success",
            "value": remote_obj.get("value"),
            "type": remote_obj.get("type", "undefined"),
        }

    # ── DOM Interaction ────────────────────────────────────────────

    def query_selector(self, selector: str, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Find an element by CSS selector and return info about it."""
        js = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return {{
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.value || '').trim().slice(0, 200),
                href: el.href || null,
                id: el.id || null,
                className: el.className || null,
                rect: {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }},
                visible: rect.width > 0 && rect.height > 0,
            }};
        }})()
        """
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        if result.get("value") is None:
            return {"status": "error", "error": f"Element not found: {selector}"}
        return {"status": "success", "element": result["value"]}

    def click_element(self, selector: str, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Click an element by CSS selector."""
        js = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ success: false, error: 'Element not found: {selector}' }};
            el.scrollIntoView({{ block: 'center' }});
            el.click();
            return {{ success: true, tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim().slice(0, 100) }};
        }})()
        """
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Click failed")}
        return {"status": "success", "clicked": val.get("tag", ""), "text": val.get("text", "")}

    def type_text(self, selector: str, text: str, clear: bool = True, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Type text into an input element by CSS selector."""
        clear_js = "el.value = '';" if clear else ""
        js = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ success: false, error: 'Element not found: {selector}' }};
            el.scrollIntoView({{ block: 'center' }});
            el.focus();
            {clear_js}
            el.value = {json.dumps(text)};
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return {{ success: true }};
        }})()
        """
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Type failed")}
        return {"status": "success", "typed": text[:50]}

    def submit_form(self, selector: str = "form", tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Submit a form by CSS selector, or press Enter on the focused element."""
        js = f"""
        (() => {{
            const form = document.querySelector({json.dumps(selector)});
            if (form && form.tagName === 'FORM') {{
                form.submit();
                return {{ success: true, method: 'form.submit' }};
            }}
            // Try pressing Enter on active element
            const active = document.activeElement;
            if (active) {{
                active.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }}));
                active.dispatchEvent(new KeyboardEvent('keyup', {{ key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }}));
                return {{ success: true, method: 'enter_key' }};
            }}
            return {{ success: false, error: 'No form or active element found' }};
        }})()
        """
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Submit failed")}
        return {"status": "success", "method": val.get("method", "")}

    # ── Page Content ───────────────────────────────────────────────

    def get_page_content(self, tab_id: Optional[str] = None, max_chars: int = 50000) -> Dict[str, Any]:
        """Get the current page's URL, title, and text content."""
        js = f"""
        (() => {{
            return {{
                url: window.location.href,
                title: document.title,
                text: document.body ? document.body.innerText.slice(0, {max_chars}) : '',
            }};
        }})()
        """
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        return {"status": "success", **result.get("value", {})}

    def get_interactive_elements(self, tab_id: Optional[str] = None, max_elements: int = 50) -> Dict[str, Any]:
        """Get a snapshot of interactive elements on the page for AI consumption."""
        js = f"""
        (() => {{
            const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]';
            const elements = Array.from(document.querySelectorAll(selectors)).slice(0, {max_elements});
            return elements.map((el, idx) => {{
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return null;
                const tag = el.tagName.toLowerCase();
                let label = (el.innerText || el.value || el.placeholder || el.title || el.ariaLabel || '').trim().slice(0, 60);
                let selector = el.id ? '#' + el.id : (el.name ? tag + '[name="' + el.name + '"]' : null);
                if (!selector) {{
                    // Build a unique-ish selector
                    if (el.className && typeof el.className === 'string') {{
                        selector = tag + '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
                    }} else {{
                        selector = tag + ':nth-of-type(' + (Array.from(el.parentElement ? el.parentElement.children : []).filter(c => c.tagName === el.tagName).indexOf(el) + 1) + ')';
                    }}
                }}
                return {{
                    ref: idx + 1,
                    tag: tag,
                    type: el.type || null,
                    label: label || null,
                    href: el.href || null,
                    selector: selector,
                }};
            }}).filter(e => e !== null);
        }})()
        """
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        elements = result.get("value", [])
        return {
            "status": "success",
            "elements": elements,
            "count": len(elements) if elements else 0,
        }

    # ── Screenshots ────────────────────────────────────────────────

    def screenshot(self, tab_id: Optional[str] = None, quality: int = 80, full_page: bool = False) -> Dict[str, Any]:
        """Take a screenshot of the current tab."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}

        params = {
            "format": "jpeg",
            "quality": quality,
        }

        if full_page:
            # Get full page dimensions
            metrics = conn.send("Page.getLayoutMetrics")
            if "error" not in metrics:
                content_size = metrics.get("contentSize", {})
                params["clip"] = {
                    "x": 0,
                    "y": 0,
                    "width": content_size.get("width", 1920),
                    "height": content_size.get("height", 1080),
                    "scale": 1,
                }

        result = conn.send("Page.captureScreenshot", params, timeout=10)
        if "error" in result:
            return {"status": "error", "error": result["error"]}

        return {
            "status": "success",
            "image_base64": result.get("data", ""),
            "format": "jpeg",
        }

    # ── Tab Management ─────────────────────────────────────────────

    def new_tab(self, url: str = "about:blank") -> Dict[str, Any]:
        """Open a new tab."""
        try:
            req_url = f"{self._base_url}/json/new?{url}"
            req = urllib.request.Request(req_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                tab_id = data.get("id", "")
                self._active_tab_id = tab_id
                return {
                    "status": "success",
                    "tab_id": tab_id,
                    "url": data.get("url", url),
                }
        except Exception as e:
            return {"status": "error", "error": f"Failed to open new tab: {e}"}

    def close_tab(self, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Close a tab."""
        target_id = tab_id or self._active_tab_id
        if not target_id:
            return {"status": "error", "error": "No tab specified"}

        self.detach(target_id)

        try:
            req_url = f"{self._base_url}/json/close/{target_id}"
            req = urllib.request.Request(req_url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                return {"status": "success", "closed": target_id}
        except Exception as e:
            return {"status": "error", "error": f"Failed to close tab: {e}"}

    def activate_tab(self, tab_id: str) -> Dict[str, Any]:
        """Bring a tab to the foreground."""
        try:
            req_url = f"{self._base_url}/json/activate/{tab_id}"
            req = urllib.request.Request(req_url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                self._active_tab_id = tab_id
                return {"status": "success", "activated": tab_id}
        except Exception as e:
            return {"status": "error", "error": f"Failed to activate tab: {e}"}

    # ── Scroll ─────────────────────────────────────────────────────

    def scroll(self, direction: str = "down", amount: int = 500, selector: Optional[str] = None, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Scroll the page or a specific element."""
        dx, dy = 0, 0
        if direction == "down": dy = amount
        elif direction == "up": dy = -amount
        elif direction == "right": dx = amount
        elif direction == "left": dx = -amount
        else:
            return {"status": "error", "error": f"Invalid direction: {direction}. Use up/down/left/right."}

        if selector:
            js = f"""(() => {{
                const el = document.querySelector({json.dumps(selector)});
                if (!el) return {{ success: false, error: 'Element not found' }};
                el.scrollBy({dx}, {dy});
                return {{ success: true }};
            }})()"""
        else:
            js = f"""(() => {{
                window.scrollBy({dx}, {dy});
                return {{ success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight, innerHeight: window.innerHeight }};
            }})()"""

        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Scroll failed")}
        info = {"status": "success", "direction": direction, "amount": amount}
        if "scrollY" in val:
            info["scrollY"] = val["scrollY"]
            info["scrollHeight"] = val["scrollHeight"]
            info["atBottom"] = val["scrollY"] + val["innerHeight"] >= val["scrollHeight"] - 10
        return info

    # ── History Navigation ─────────────────────────────────────────

    def go_back(self, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Navigate back in browser history."""
        result = self.evaluate("(() => { history.back(); return { success: true }; })()", tab_id)
        if result.get("status") == "error":
            return result
        time.sleep(1)
        loc = self.evaluate("({ url: location.href, title: document.title })", tab_id)
        return {"status": "success", "url": loc.get("value", {}).get("url", ""), "title": loc.get("value", {}).get("title", "")}

    def go_forward(self, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Navigate forward in browser history."""
        result = self.evaluate("(() => { history.forward(); return { success: true }; })()", tab_id)
        if result.get("status") == "error":
            return result
        time.sleep(1)
        loc = self.evaluate("({ url: location.href, title: document.title })", tab_id)
        return {"status": "success", "url": loc.get("value", {}).get("url", ""), "title": loc.get("value", {}).get("title", "")}

    # ── Hover ──────────────────────────────────────────────────────

    def hover_element(self, selector: str, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Hover over an element by CSS selector (triggers mouseover/mouseenter)."""
        js = f"""(() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ success: false, error: 'Element not found' }};
            el.scrollIntoView({{ block: 'center' }});
            el.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
            el.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
            const rect = el.getBoundingClientRect();
            return {{ success: true, tag: el.tagName.toLowerCase(), x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) }};
        }})()"""
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Hover failed")}
        return {"status": "success", "tag": val.get("tag"), "x": val.get("x"), "y": val.get("y")}

    # ── Select Option ──────────────────────────────────────────────

    def select_option(self, selector: str, value: Optional[str] = None, label: Optional[str] = None, index: Optional[int] = None, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Select an option in a <select> dropdown by value, label, or index."""
        if value is not None:
            match_js = f"opt.value === {json.dumps(value)}"
        elif label is not None:
            match_js = f"opt.textContent.trim() === {json.dumps(label)}"
        elif index is not None:
            match_js = f"i === {index}"
        else:
            return {"status": "error", "error": "Provide value, label, or index to select an option."}

        js = f"""(() => {{
            const sel = document.querySelector({json.dumps(selector)});
            if (!sel || sel.tagName !== 'SELECT') return {{ success: false, error: 'Select element not found' }};
            const opts = Array.from(sel.options);
            const idx = opts.findIndex((opt, i) => {match_js});
            if (idx === -1) return {{ success: false, error: 'Option not found', available: opts.map(o => o.textContent.trim()).slice(0, 10) }};
            sel.selectedIndex = idx;
            sel.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return {{ success: true, selected: opts[idx].textContent.trim(), value: opts[idx].value }};
        }})()"""
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Select failed"), "available": val.get("available")}
        return {"status": "success", "selected": val.get("selected"), "value": val.get("value")}

    # ── Press Key ──────────────────────────────────────────────────

    def press_key(self, key: str, selector: Optional[str] = None, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Send a keyboard event (Enter, Escape, Tab, ArrowDown, etc.)."""
        key_map = {
            "enter": ("Enter", "Enter", 13),
            "escape": ("Escape", "Escape", 27),
            "tab": ("Tab", "Tab", 9),
            "backspace": ("Backspace", "Backspace", 8),
            "delete": ("Delete", "Delete", 46),
            "arrowup": ("ArrowUp", "ArrowUp", 38),
            "arrowdown": ("ArrowDown", "ArrowDown", 40),
            "arrowleft": ("ArrowLeft", "ArrowLeft", 37),
            "arrowright": ("ArrowRight", "ArrowRight", 39),
            "space": (" ", "Space", 32),
            "home": ("Home", "Home", 36),
            "end": ("End", "End", 35),
            "pageup": ("PageUp", "PageUp", 33),
            "pagedown": ("PageDown", "PageDown", 34),
        }
        k = key.lower().replace(" ", "").replace("_", "")
        key_name, code, key_code = key_map.get(k, (key, key, 0))

        target_js = f"document.querySelector({json.dumps(selector)})" if selector else "document.activeElement || document.body"
        js = f"""(() => {{
            const el = {target_js};
            if (!el) return {{ success: false, error: 'Element not found' }};
            el.dispatchEvent(new KeyboardEvent('keydown', {{ key: {json.dumps(key_name)}, code: {json.dumps(code)}, keyCode: {key_code}, bubbles: true }}));
            el.dispatchEvent(new KeyboardEvent('keypress', {{ key: {json.dumps(key_name)}, code: {json.dumps(code)}, keyCode: {key_code}, bubbles: true }}));
            el.dispatchEvent(new KeyboardEvent('keyup', {{ key: {json.dumps(key_name)}, code: {json.dumps(code)}, keyCode: {key_code}, bubbles: true }}));
            return {{ success: true, key: {json.dumps(key_name)} }};
        }})()"""
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Key press failed")}
        return {"status": "success", "key": key_name}

    # ── Wait For ───────────────────────────────────────────────────

    def wait_for_selector(self, selector: str, timeout: float = 10.0, visible: bool = True, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Wait for an element to appear on the page."""
        poll_interval = 0.3
        elapsed = 0.0
        while elapsed < timeout:
            js = f"""(() => {{
                const el = document.querySelector({json.dumps(selector)});
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                const vis = rect.width > 0 && rect.height > 0;
                return {{ found: true, visible: vis, tag: el.tagName.toLowerCase() }};
            }})()"""
            result = self.evaluate(js, tab_id)
            val = result.get("value")
            if val and val.get("found"):
                if not visible or val.get("visible"):
                    return {"status": "success", "selector": selector, "visible": val.get("visible"), "waited": round(elapsed, 1)}
            time.sleep(poll_interval)
            elapsed += poll_interval
        return {"status": "error", "error": f"Timeout waiting for '{selector}' after {timeout}s"}

    # ── @ref Snapshot System ───────────────────────────────────────

    _element_refs: Dict[str, Dict[str, Any]] = {}

    def get_snapshot(self, tab_id: Optional[str] = None, interactive_only: bool = True, max_elements: int = 60) -> Dict[str, Any]:
        """Get an accessibility-tree snapshot with @ref labels for every interactive element."""
        js = f"""(() => {{
            const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], [role="tab"], [role="option"], [onclick], [tabindex]';
            const ALL = INTERACTIVE + ', h1, h2, h3, h4, h5, h6, p, img, [role]';
            const selectorStr = {str(interactive_only).lower()} ? INTERACTIVE : ALL;
            const maxEls = {max_elements};

            const tagToRole = {{
                'button': 'button', 'a': 'link', 'select': 'combobox', 'textarea': 'textbox', 'img': 'img',
                'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
                'nav': 'navigation', 'main': 'main', 'form': 'form',
            }};
            function getRole(el) {{
                const r = el.getAttribute('role');
                if (r) return r;
                const tag = el.tagName.toLowerCase();
                if (tag === 'input') {{
                    const t = (el.type || 'text').toLowerCase();
                    if (t === 'checkbox') return 'checkbox';
                    if (t === 'radio') return 'radio';
                    if (t === 'submit' || t === 'button') return 'button';
                    if (t === 'search') return 'searchbox';
                    return 'textbox';
                }}
                return tagToRole[tag] || tag;
            }}
            function getName(el) {{
                return (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.innerText || el.value || '').trim()).slice(0, 80);
            }}

            const elements = Array.from(document.querySelectorAll(selectorStr));
            const results = [];
            for (const el of elements) {{
                if (results.length >= maxEls) break;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
                if (rect.bottom < 0 || rect.top > window.innerHeight * 2) continue;
                const tag = el.tagName.toLowerCase();
                const role = getRole(el);
                const name = getName(el);
                const type = el.getAttribute('type') || '';
                let css = tag;
                if (el.id) css = '#' + CSS.escape(el.id);
                else if (el.name) css = tag + '[name="' + el.name + '"]';
                else if (el.className && typeof el.className === 'string' && el.className.trim()) css = tag + '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
                results.push({{ ref: '@' + (results.length + 1), tag, role, name, type, css, inView: rect.top >= 0 && rect.bottom <= window.innerHeight, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }});
            }}
            return {{ url: location.href, title: document.title, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight, innerHeight: window.innerHeight, elements: results }};
        }})()"""

        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        data = result.get("value", {})
        if not data:
            return {"status": "error", "error": "Failed to extract page snapshot"}

        self.__class__._element_refs.clear()
        for el in data.get("elements", []):
            self.__class__._element_refs[el["ref"]] = {
                "css": el["css"],
                "role": el["role"],
                "name": el["name"],
                "tag": el["tag"],
            }

        lines = [
            f"# {data.get('title', 'Untitled')}",
            f"URL: {data.get('url', '')}",
            f"Scroll: {data.get('scrollY', 0)}/{data.get('scrollHeight', 0)}px",
            "",
        ]
        for el in data.get("elements", []):
            role = el.get("role", el.get("tag", ""))
            name = el.get("name", "")
            ref = el.get("ref", "")
            el_type = el.get("type", "")
            in_view = "v" if el.get("inView") else "."
            if el_type and el_type not in role:
                role = f"{role}[{el_type}]"
            if name:
                lines.append(f"  {ref} {in_view} [{role}] \"{name}\"")
            else:
                lines.append(f"  {ref} {in_view} [{role}]")

        lines.append("")
        lines.append(f"---  {len(data.get('elements', []))} elements. Use click_ref @N / type_ref @N to interact.")

        return {
            "status": "success",
            "snapshot": "\n".join(lines),
            "url": data.get("url"),
            "title": data.get("title"),
            "ref_count": len(self.__class__._element_refs),
            "scroll_position": data.get("scrollY", 0),
            "scroll_height": data.get("scrollHeight", 0),
        }

    def click_by_ref(self, ref: str, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Click an element by its @ref from the last snapshot.
        Tries: scrollIntoView + click, then dispatchEvent, then CDP coordinate click.
        """
        ref = ref.strip()
        if not ref.startswith("@"):
            ref = "@" + ref
        ref_info = self.__class__._element_refs.get(ref)
        if not ref_info:
            available = list(self.__class__._element_refs.keys())[:10]
            return {"status": "error", "error": f"Ref {ref} not found. Available: {available}. Run snapshot first."}

        css = ref_info["css"]
        js = f"""(() => {{
            const el = document.querySelector({json.dumps(css)});
            if (!el) return {{ success: false, error: 'Element gone from DOM. Run snapshot again.' }};
            el.scrollIntoView({{ block: 'center', behavior: 'instant' }});
            el.focus();
            el.click();
            return {{ success: true, tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim().slice(0, 80) }};
        }})()"""
        result = self.evaluate(js, tab_id)
        val = result.get("value", {})
        if val and val.get("success"):
            return {"status": "success", "ref": ref, "clicked": f"{ref_info['role']} \"{ref_info['name'][:40]}\"", "method": "click"}

        js2 = f"""(() => {{
            const el = document.querySelector({json.dumps(css)});
            if (!el) return {{ success: false, error: 'Element not found' }};
            el.scrollIntoView({{ block: 'center' }});
            el.dispatchEvent(new MouseEvent('click', {{ bubbles: true, cancelable: true, view: window }}));
            return {{ success: true }};
        }})()"""
        result2 = self.evaluate(js2, tab_id)
        val2 = result2.get("value", {})
        if val2 and val2.get("success"):
            return {"status": "success", "ref": ref, "clicked": f"{ref_info['role']} \"{ref_info['name'][:40]}\"", "method": "dispatchEvent"}

        js3 = f"""(() => {{
            const el = document.querySelector({json.dumps(css)});
            if (!el) return null;
            el.scrollIntoView({{ block: 'center' }});
            const rect = el.getBoundingClientRect();
            return {{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }};
        }})()"""
        result3 = self.evaluate(js3, tab_id)
        coords = result3.get("value")
        if coords and coords.get("x") is not None:
            conn = self._get_connection(tab_id)
            if conn:
                conn.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": coords["x"], "y": coords["y"], "button": "left", "clickCount": 1})
                conn.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": coords["x"], "y": coords["y"], "button": "left", "clickCount": 1})
                return {"status": "success", "ref": ref, "clicked": f"{ref_info['role']} \"{ref_info['name'][:40]}\"", "method": "coordinates"}

        return {"status": "error", "error": f"All click methods failed for {ref}. The page may have changed — run snapshot again."}

    def type_by_ref(self, ref: str, text: str, clear: bool = True, submit: bool = False, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Type text into an element by its @ref from the last snapshot."""
        ref = ref.strip()
        if not ref.startswith("@"):
            ref = "@" + ref
        ref_info = self.__class__._element_refs.get(ref)
        if not ref_info:
            available = list(self.__class__._element_refs.keys())[:10]
            return {"status": "error", "error": f"Ref {ref} not found. Available: {available}. Run snapshot first."}

        css = ref_info["css"]
        clear_js = "el.value = '';" if clear else ""
        submit_js = """
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            const form = el.closest('form');
            if (form) form.submit();
        """ if submit else ""

        js = f"""(() => {{
            const el = document.querySelector({json.dumps(css)});
            if (!el) return {{ success: false, error: 'Element gone from DOM. Run snapshot again.' }};
            el.scrollIntoView({{ block: 'center', behavior: 'instant' }});
            el.focus();
            {clear_js}
            el.value = {json.dumps(text)};
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            {submit_js}
            return {{ success: true }};
        }})()"""
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        val = result.get("value", {})
        if not val or not val.get("success"):
            return {"status": "error", "error": val.get("error", "Type failed")}
        msg = f"Typed into {ref}"
        if submit:
            msg += " and submitted"
        return {"status": "success", "ref": ref, "message": msg}

    # ── Browser Lifecycle ──────────────────────────────────────────

    def stop_browser(self) -> Dict[str, Any]:
        """Stop the CDP-managed browser process."""
        self.detach_all()
        if self._browser_process:
            try:
                self._browser_process.terminate()
                self._browser_process.wait(timeout=5)
            except Exception:
                try:
                    self._browser_process.kill()
                except Exception:
                    pass
            self._browser_process = None
            return {"status": "success", "message": "Browser stopped"}
        # Try sending Browser.close via CDP to any connected tab
        tabs = self.list_tabs()
        if tabs:
            try:
                conn = CDPConnection(tabs[0].ws_url)
                if conn.connect():
                    conn.send("Browser.close")
                    conn.disconnect()
                    return {"status": "success", "message": "Browser closed via CDP"}
            except Exception:
                pass
        return {"status": "error", "error": "No browser process to stop"}

    # ── Console Messages ────────────────────────────────────────────

    def enable_console(self, tab_id: Optional[str] = None) -> bool:
        """Enable console message capture for a tab."""
        conn = self._get_connection(tab_id)
        if not conn:
            return False
        conn.send("Runtime.enable")
        conn.send("Console.enable")
        return True

    def get_console_messages(self, tab_id: Optional[str] = None, level: Optional[str] = None) -> Dict[str, Any]:
        """Get console messages from the page. Uses Runtime.evaluate to capture console history."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        # Enable console capture
        conn.send("Runtime.enable")
        conn.send("Console.enable")
        # Use JS to capture console output
        level_filter = f"&& entry.level === {json.dumps(level)}" if level else ""
        js = f"""(() => {{
            if (!window.__cdp_console_log) {{
                window.__cdp_console_log = [];
                const orig = {{}};
                ['log','warn','error','info','debug'].forEach(m => {{
                    orig[m] = console[m];
                    console[m] = function() {{
                        window.__cdp_console_log.push({{
                            level: m,
                            text: Array.from(arguments).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
                            ts: Date.now()
                        }});
                        if (window.__cdp_console_log.length > 200) window.__cdp_console_log.shift();
                        orig[m].apply(console, arguments);
                    }};
                }});
            }}
            return window.__cdp_console_log.filter(entry => true {level_filter}).slice(-50);
        }})()"""
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        messages = result.get("value", [])
        return {"status": "success", "messages": messages or [], "count": len(messages or [])}

    # ── PDF Save ────────────────────────────────────────────────────

    def print_to_pdf(self, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Print the current page to PDF via CDP. Returns base64-encoded PDF data."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        result = conn.send("Page.printToPDF", {
            "printBackground": True,
            "preferCSSPageSize": True,
        }, timeout=30)
        if "error" in result:
            return {"status": "error", "error": result["error"]}
        pdf_data = result.get("data", "")
        if not pdf_data:
            return {"status": "error", "error": "No PDF data returned"}
        # Save to temp file
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".pdf", prefix="cdp_page_")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(base64.b64decode(pdf_data))
        return {"status": "success", "path": path, "size_bytes": os.path.getsize(path)}

    # ── File Upload ─────────────────────────────────────────────────

    def upload_files(self, file_paths: List[str], selector: Optional[str] = None, ref: Optional[str] = None, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Upload files to a file input element. Uses DOM.setFileInputFiles CDP method."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        # Resolve the target element
        if ref:
            ref = ref.strip()
            if not ref.startswith("@"):
                ref = "@" + ref
            ref_info = self.__class__._element_refs.get(ref)
            if not ref_info:
                return {"status": "error", "error": f"Ref {ref} not found. Run snapshot first."}
            selector = ref_info["css"]
        if not selector:
            selector = 'input[type="file"]'
        # Get the DOM node
        conn.send("DOM.enable")
        doc = conn.send("DOM.getDocument")
        if "error" in doc:
            return {"status": "error", "error": doc["error"]}
        root_id = doc.get("root", {}).get("nodeId", 0)
        node_result = conn.send("DOM.querySelector", {"nodeId": root_id, "selector": selector})
        if "error" in node_result:
            return {"status": "error", "error": node_result["error"]}
        node_id = node_result.get("nodeId", 0)
        if not node_id:
            return {"status": "error", "error": f"File input not found: {selector}"}
        # Validate file paths
        valid_paths = [p for p in file_paths if os.path.isfile(p)]
        if not valid_paths:
            return {"status": "error", "error": f"No valid files found: {file_paths}"}
        # Set files
        result = conn.send("DOM.setFileInputFiles", {"nodeId": node_id, "files": valid_paths})
        if "error" in result:
            return {"status": "error", "error": result["error"]}
        return {"status": "success", "uploaded": valid_paths, "count": len(valid_paths)}

    # ── Dialog Handling ─────────────────────────────────────────────

    def handle_dialog(self, accept: bool = True, prompt_text: Optional[str] = None, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Handle a JavaScript dialog (alert/confirm/prompt). Arms a handler for the next dialog."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        conn.send("Page.enable")
        # Handle any currently open dialog
        params = {"accept": accept}
        if prompt_text is not None:
            params["promptText"] = prompt_text
        result = conn.send("Page.handleJavaScriptDialog", params)
        if "error" in result:
            # No dialog open — set up auto-handler via JS
            auto_accept = "true" if accept else "false"
            prompt_js = f", {json.dumps(prompt_text)}" if prompt_text else ""
            js = f"""(() => {{
                window.__cdp_dialog_armed = {{ accept: {auto_accept}, promptText: {json.dumps(prompt_text or '')} }};
                if (!window.__cdp_dialog_handler) {{
                    window.__cdp_dialog_handler = true;
                    window.addEventListener('beforeunload', (e) => {{ e.preventDefault(); }});
                }}
                return {{ armed: true, accept: {auto_accept} }};
            }})()"""
            arm_result = self.evaluate(js, tab_id)
            return {"status": "success", "message": f"Dialog handler armed (accept={accept})", "details": arm_result.get("value")}
        return {"status": "success", "message": f"Dialog handled (accept={accept})"}

    # ── Drag ────────────────────────────────────────────────────────

    def drag_element(self, start_selector: Optional[str] = None, end_selector: Optional[str] = None,
                     start_ref: Optional[str] = None, end_ref: Optional[str] = None,
                     tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Drag from one element to another using CDP Input events."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        # Resolve selectors from refs
        if start_ref:
            r = start_ref.strip()
            if not r.startswith("@"): r = "@" + r
            info = self.__class__._element_refs.get(r)
            if not info:
                return {"status": "error", "error": f"Start ref {r} not found"}
            start_selector = info["css"]
        if end_ref:
            r = end_ref.strip()
            if not r.startswith("@"): r = "@" + r
            info = self.__class__._element_refs.get(r)
            if not info:
                return {"status": "error", "error": f"End ref {r} not found"}
            end_selector = info["css"]
        if not start_selector or not end_selector:
            return {"status": "error", "error": "Both start and end selectors (or refs) required"}
        # Get coordinates
        js = f"""(() => {{
            const s = document.querySelector({json.dumps(start_selector)});
            const e = document.querySelector({json.dumps(end_selector)});
            if (!s) return {{ error: 'Start element not found' }};
            if (!e) return {{ error: 'End element not found' }};
            s.scrollIntoView({{ block: 'center' }});
            const sr = s.getBoundingClientRect();
            const er = e.getBoundingClientRect();
            return {{ sx: sr.x + sr.width/2, sy: sr.y + sr.height/2, ex: er.x + er.width/2, ey: er.y + er.height/2 }};
        }})()"""
        result = self.evaluate(js, tab_id)
        coords = result.get("value", {})
        if coords.get("error"):
            return {"status": "error", "error": coords["error"]}
        sx, sy = coords.get("sx", 0), coords.get("sy", 0)
        ex, ey = coords.get("ex", 0), coords.get("ey", 0)
        # Perform drag via Input events
        conn.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": sx, "y": sy, "button": "left", "clickCount": 1})
        steps = 10
        for i in range(1, steps + 1):
            mx = sx + (ex - sx) * i / steps
            my = sy + (ey - sy) * i / steps
            conn.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": mx, "y": my, "button": "left"})
            time.sleep(0.02)
        conn.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": ex, "y": ey, "button": "left", "clickCount": 1})
        return {"status": "success", "from": start_selector, "to": end_selector}

    # ── Viewport Resize ─────────────────────────────────────────────

    def resize_viewport(self, width: int, height: int, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Resize the browser viewport via CDP Emulation."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        result = conn.send("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": False,
        })
        if "error" in result:
            return {"status": "error", "error": result["error"]}
        return {"status": "success", "width": width, "height": height}

    # ── Form Fill ───────────────────────────────────────────────────

    def fill_form(self, fields: List[Dict[str, str]], tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Fill multiple form fields at once. Each field: {selector, value} or {ref, value}."""
        results = []
        for field in fields:
            selector = field.get("selector")
            ref = field.get("ref")
            value = field.get("value", "")
            if ref:
                r = ref.strip()
                if not r.startswith("@"): r = "@" + r
                info = self.__class__._element_refs.get(r)
                if not info:
                    results.append({"ref": ref, "status": "error", "error": f"Ref {r} not found"})
                    continue
                selector = info["css"]
            if not selector:
                results.append({"status": "error", "error": "No selector or ref provided"})
                continue
            res = self.type_text(selector, value, clear=True, tab_id=tab_id)
            results.append({"selector": selector, **res})
        ok = sum(1 for r in results if r.get("status") == "success")
        return {"status": "success", "filled": ok, "total": len(fields), "details": results}

    # ── Enhanced Click ──────────────────────────────────────────────

    def click_enhanced(self, selector: Optional[str] = None, ref: Optional[str] = None,
                       double_click: bool = False, button: str = "left",
                       modifiers: Optional[List[str]] = None,
                       tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Enhanced click with double-click, right-click, and modifier key support."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        # Resolve ref to selector
        if ref:
            r = ref.strip()
            if not r.startswith("@"): r = "@" + r
            info = self.__class__._element_refs.get(r)
            if not info:
                return {"status": "error", "error": f"Ref {r} not found"}
            selector = info["css"]
        if not selector:
            return {"status": "error", "error": "Selector or ref required"}
        # Get element coordinates
        js = f"""(() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ error: 'Element not found' }};
            el.scrollIntoView({{ block: 'center' }});
            const rect = el.getBoundingClientRect();
            return {{ x: rect.x + rect.width/2, y: rect.y + rect.height/2 }};
        }})()"""
        result = self.evaluate(js, tab_id)
        coords = result.get("value", {})
        if coords.get("error"):
            return {"status": "error", "error": coords["error"]}
        x, y = coords.get("x", 0), coords.get("y", 0)
        # Build modifier flags
        mod_flags = 0
        if modifiers:
            for m in modifiers:
                ml = m.lower()
                if ml in ("alt", "option"): mod_flags |= 1
                elif ml in ("ctrl", "control"): mod_flags |= 2
                elif ml == "meta": mod_flags |= 4
                elif ml == "shift": mod_flags |= 8
        click_count = 2 if double_click else 1
        cdp_button = button if button in ("left", "right", "middle") else "left"
        # Dispatch mouse events
        for _ in range(click_count):
            conn.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": cdp_button, "clickCount": 1, "modifiers": mod_flags})
            conn.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": cdp_button, "clickCount": 1, "modifiers": mod_flags})
        desc = f"{'double-' if double_click else ''}{cdp_button}-click"
        if modifiers:
            desc = f"{'+'.join(modifiers)}+{desc}"
        return {"status": "success", "action": desc, "selector": selector}

    # ── Enhanced Type (slowly) ──────────────────────────────────────

    def type_slowly(self, selector: Optional[str] = None, ref: Optional[str] = None,
                    text: str = "", delay_ms: int = 50, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Type text character by character with delay (for sites that detect paste)."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        if ref:
            r = ref.strip()
            if not r.startswith("@"): r = "@" + r
            info = self.__class__._element_refs.get(r)
            if not info:
                return {"status": "error", "error": f"Ref {r} not found"}
            selector = info["css"]
        if not selector:
            return {"status": "error", "error": "Selector or ref required"}
        # Focus the element
        focus_js = f"""(() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ error: 'Element not found' }};
            el.scrollIntoView({{ block: 'center' }});
            el.focus();
            el.value = '';
            return {{ ok: true }};
        }})()"""
        focus_result = self.evaluate(focus_js, tab_id)
        val = focus_result.get("value", {})
        if val.get("error"):
            return {"status": "error", "error": val["error"]}
        # Type each character via CDP Input.dispatchKeyEvent
        delay_s = delay_ms / 1000.0
        for ch in text:
            conn.send("Input.dispatchKeyEvent", {"type": "keyDown", "text": ch, "key": ch, "code": f"Key{ch.upper()}" if ch.isalpha() else ch})
            conn.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": ch, "code": f"Key{ch.upper()}" if ch.isalpha() else ch})
            time.sleep(delay_s)
        return {"status": "success", "typed": text[:50], "chars": len(text), "delay_ms": delay_ms}

    # ── Enhanced Wait ───────────────────────────────────────────────

    def wait_time(self, time_ms: int = 1000, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Wait for a fixed amount of time (milliseconds)."""
        time.sleep(time_ms / 1000.0)
        return {"status": "success", "waited_ms": time_ms}

    def wait_text_gone(self, text: str, timeout: float = 10.0, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Wait until specific text disappears from the page."""
        poll_interval = 0.3
        elapsed = 0.0
        while elapsed < timeout:
            js = f"document.body.innerText.includes({json.dumps(text)})"
            result = self.evaluate(js, tab_id)
            if result.get("value") == False:
                return {"status": "success", "text": text, "waited": round(elapsed, 1)}
            time.sleep(poll_interval)
            elapsed += poll_interval
        return {"status": "error", "error": f"Text '{text[:50]}' still present after {timeout}s"}

    # ── Enhanced Snapshot ───────────────────────────────────────────

    def get_snapshot_enhanced(self, tab_id: Optional[str] = None, interactive_only: bool = True,
                              max_elements: int = 60, selector: Optional[str] = None,
                              frame: Optional[str] = None, compact: bool = False,
                              depth: Optional[int] = None) -> Dict[str, Any]:
        """Enhanced snapshot with selector scoping, iframe targeting, compact mode, and depth control."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        # Build the root context
        frame_js = ""
        if frame:
            frame_js = f"""
            const frameEl = document.querySelector({json.dumps(frame)});
            if (!frameEl || !frameEl.contentDocument) return {{ error: 'Frame not found or not accessible: {frame}' }};
            const doc = frameEl.contentDocument;
            const win = frameEl.contentWindow;
            """
        else:
            frame_js = "const doc = document; const win = window;"
        scope_js = f"doc.querySelector({json.dumps(selector)})" if selector else "doc"
        compact_fields = """tag, role, name: name.slice(0, 30), ref: '@' + (results.length + 1)""" if compact else """ref: '@' + (results.length + 1), tag, role, name, type, css, inView: rect.top >= 0 && rect.bottom <= win.innerHeight, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)"""
        depth_check = f"&& getDepth(el, scopeRoot) <= {depth}" if depth else ""
        js = f"""(() => {{
            {frame_js}
            const scopeRoot = {scope_js};
            if (!scopeRoot) return {{ error: 'Scope element not found' }};
            const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], [role="tab"], [role="option"], [onclick], [tabindex]';
            const ALL = INTERACTIVE + ', h1, h2, h3, h4, h5, h6, p, img, [role]';
            const selectorStr = {str(interactive_only).lower()} ? INTERACTIVE : ALL;
            const maxEls = {max_elements};
            function getDepth(el, root) {{ let d = 0; let n = el; while (n && n !== root) {{ d++; n = n.parentElement; }} return d; }}
            const tagToRole = {{'button': 'button', 'a': 'link', 'select': 'combobox', 'textarea': 'textbox', 'img': 'img', 'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading', 'nav': 'navigation', 'main': 'main', 'form': 'form'}};
            function getRole(el) {{ const r = el.getAttribute('role'); if (r) return r; const tag = el.tagName.toLowerCase(); if (tag === 'input') {{ const t = (el.type || 'text').toLowerCase(); if (t === 'checkbox') return 'checkbox'; if (t === 'radio') return 'radio'; if (t === 'submit' || t === 'button') return 'button'; if (t === 'search') return 'searchbox'; return 'textbox'; }} return tagToRole[tag] || tag; }}
            function getName(el) {{ return (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.innerText || el.value || '').trim()).slice(0, 80); }}
            const elements = Array.from(scopeRoot.querySelectorAll(selectorStr));
            const results = [];
            for (const el of elements) {{
                if (results.length >= maxEls) break;
                const rect = el.getBoundingClientRect();
                const style = win.getComputedStyle(el);
                if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
                if (true {depth_check}) {{
                    const tag = el.tagName.toLowerCase();
                    const role = getRole(el);
                    const name = getName(el);
                    const type = el.getAttribute('type') || '';
                    let css = tag;
                    if (el.id) css = '#' + CSS.escape(el.id);
                    else if (el.name) css = tag + '[name="' + el.name + '"]';
                    else if (el.className && typeof el.className === 'string' && el.className.trim()) css = tag + '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
                    results.push({{ {compact_fields} }});
                }}
            }}
            return {{ url: win.location.href, title: doc.title, scrollY: Math.round(win.scrollY), scrollHeight: doc.body ? doc.body.scrollHeight : 0, innerHeight: win.innerHeight, elements: results, scope: {json.dumps(selector or 'document')}, frame: {json.dumps(frame or None)} }};
        }})()"""
        result = self.evaluate(js, tab_id)
        if result.get("status") == "error":
            return result
        data = result.get("value", {})
        if not data:
            return {"status": "error", "error": "Failed to extract snapshot"}
        if data.get("error"):
            return {"status": "error", "error": data["error"]}
        # Update ref cache
        self.__class__._element_refs.clear()
        for el in data.get("elements", []):
            ref_key = el.get("ref", "")
            if ref_key and el.get("css"):
                self.__class__._element_refs[ref_key] = {
                    "css": el["css"], "role": el.get("role", ""), "name": el.get("name", ""), "tag": el.get("tag", ""),
                }
        # Format output
        lines = [f"# {data.get('title', 'Untitled')}", f"URL: {data.get('url', '')}", f"Scroll: {data.get('scrollY', 0)}/{data.get('scrollHeight', 0)}px"]
        if selector:
            lines.append(f"Scope: {selector}")
        if frame:
            lines.append(f"Frame: {frame}")
        lines.append("")
        for el in data.get("elements", []):
            role = el.get("role", el.get("tag", ""))
            name = el.get("name", "")
            ref_str = el.get("ref", "")
            el_type = el.get("type", "")
            in_view = "v" if el.get("inView") else "."
            if compact:
                lines.append(f"  {ref_str} [{role}] {name}")
            else:
                if el_type and el_type not in role:
                    role = f"{role}[{el_type}]"
                if name:
                    lines.append(f"  {ref_str} {in_view} [{role}] \"{name}\"")
                else:
                    lines.append(f"  {ref_str} {in_view} [{role}]")
        lines.append("")
        lines.append(f"---  {len(data.get('elements', []))} elements. Use click_ref @N / type_ref @N to interact.")
        return {
            "status": "success", "snapshot": "\n".join(lines),
            "url": data.get("url"), "title": data.get("title"),
            "ref_count": len(self.__class__._element_refs),
            "scroll_position": data.get("scrollY", 0), "scroll_height": data.get("scrollHeight", 0),
        }

    # ── Element-Targeted Screenshot ─────────────────────────────────

    def screenshot_element(self, selector: Optional[str] = None, ref: Optional[str] = None,
                           quality: int = 80, tab_id: Optional[str] = None) -> Dict[str, Any]:
        """Take a screenshot of a specific element by selector or @ref."""
        conn = self._get_connection(tab_id)
        if not conn:
            return {"status": "error", "error": "No tab connected"}
        if ref:
            r = ref.strip()
            if not r.startswith("@"): r = "@" + r
            info = self.__class__._element_refs.get(r)
            if not info:
                return {"status": "error", "error": f"Ref {r} not found"}
            selector = info["css"]
        if not selector:
            return {"status": "error", "error": "Selector or ref required"}
        # Get element bounding rect
        js = f"""(() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ error: 'Element not found' }};
            el.scrollIntoView({{ block: 'center' }});
            const rect = el.getBoundingClientRect();
            return {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }};
        }})()"""
        result = self.evaluate(js, tab_id)
        coords = result.get("value", {})
        if coords.get("error"):
            return {"status": "error", "error": coords["error"]}
        clip = {
            "x": coords.get("x", 0), "y": coords.get("y", 0),
            "width": coords.get("width", 100), "height": coords.get("height", 100),
            "scale": 1,
        }
        ss_result = conn.send("Page.captureScreenshot", {"format": "jpeg", "quality": quality, "clip": clip}, timeout=10)
        if "error" in ss_result:
            return {"status": "error", "error": ss_result["error"]}
        return {"status": "success", "image_base64": ss_result.get("data", ""), "format": "jpeg", "element": selector}

    # ── Convenience ────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """Get CDP connection status."""
        available = self.is_browser_available()
        tabs = self.list_tabs() if available else []
        return {
            "browser_available": available,
            "host": self.host,
            "port": self.port,
            "tabs": len(tabs),
            "active_tab": self._active_tab_id,
            "connected_tabs": list(self._connections.keys()),
        }


# ── Global Instance ────────────────────────────────────────────────

_cdp_browser: Optional[CDPBrowser] = None


def get_cdp_browser(host: str = "localhost", port: int = 9222) -> CDPBrowser:
    """Get or create the global CDP browser instance."""
    global _cdp_browser
    if _cdp_browser is None:
        _cdp_browser = CDPBrowser(host, port)
    return _cdp_browser


# ── Tool Functions (registered in tool_registry) ───────────────────

def _ensure() -> Optional[str]:
    """Ensure browser is available. Returns error string or None."""
    browser = get_cdp_browser()
    if not browser.ensure_browser():
        return "Browser not reachable and auto-launch failed. Launch Edge manually with: msedge --remote-debugging-port=9222"
    return None


def cdp_list_tabs(**kwargs) -> Dict[str, Any]:
    """List all open browser tabs."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    tabs = browser.list_tabs()
    return {
        "status": "success",
        "tabs": [{"id": t.tab_id, "title": t.title, "url": t.url} for t in tabs],
        "count": len(tabs),
        "active": browser._active_tab_id,
    }


def cdp_navigate(url: str, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Navigate to a URL in the active (or specified) tab."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    if url and not url.startswith(("http://", "https://", "about:", "file:", "chrome:")):
        url = "https://" + url
    return browser.navigate(url, tab_id=tab_id)


def cdp_click(selector: str, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Click an element by CSS selector."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.click_element(selector, tab_id=tab_id)


def cdp_type(selector: str, text: str, clear: bool = True, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Type text into an input element."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.type_text(selector, text, clear=clear, tab_id=tab_id)


def cdp_submit(selector: str = "form", tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Submit a form or press Enter."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.submit_form(selector, tab_id=tab_id)


def cdp_read_page(tab_id: str = None, max_chars: int = 50000, **kwargs) -> Dict[str, Any]:
    """Read the current page's text content."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.get_page_content(tab_id=tab_id, max_chars=max_chars)


def cdp_get_elements(tab_id: str = None, max_elements: int = 50, **kwargs) -> Dict[str, Any]:
    """Get interactive elements on the page (links, buttons, inputs)."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.get_interactive_elements(tab_id=tab_id, max_elements=max_elements)


def cdp_screenshot_tab(tab_id: str = None, quality: int = 80, full_page: bool = False, **kwargs) -> Dict[str, Any]:
    """Take a screenshot of the current tab."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.screenshot(tab_id=tab_id, quality=quality, full_page=full_page)


def cdp_evaluate(expression: str, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Execute JavaScript in the page context."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.evaluate(expression, tab_id=tab_id)


def cdp_new_tab(url: str = "about:blank", **kwargs) -> Dict[str, Any]:
    """Open a new browser tab."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    if url and not url.startswith(("http://", "https://", "about:", "file:", "chrome:")):
        url = "https://" + url
    return browser.new_tab(url)


def cdp_close_tab(tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Close a browser tab."""
    browser = get_cdp_browser()
    return browser.close_tab(tab_id=tab_id)


def cdp_activate_tab(tab_id: str, **kwargs) -> Dict[str, Any]:
    """Bring a tab to the foreground."""
    browser = get_cdp_browser()
    return browser.activate_tab(tab_id)


def cdp_status(**kwargs) -> Dict[str, Any]:
    """Check CDP browser connection status."""
    browser = get_cdp_browser()
    return browser.get_status()


def cdp_scroll(direction: str = "down", amount: int = 500, selector: str = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Scroll the page or a specific element."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.scroll(direction=direction, amount=amount, selector=selector, tab_id=tab_id)


def cdp_go_back(tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Navigate back in browser history."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.go_back(tab_id=tab_id)


def cdp_go_forward(tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Navigate forward in browser history."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.go_forward(tab_id=tab_id)


def cdp_hover(selector: str, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Hover over an element."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.hover_element(selector, tab_id=tab_id)


def cdp_select_option(selector: str, value: str = None, label: str = None, index: int = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Select an option in a dropdown."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.select_option(selector, value=value, label=label, index=index, tab_id=tab_id)


def cdp_press_key(key: str, selector: str = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Send a keyboard event."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.press_key(key, selector=selector, tab_id=tab_id)


def cdp_wait_for(selector: str, timeout: float = 10.0, visible: bool = True, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Wait for an element to appear on the page."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.wait_for_selector(selector, timeout=timeout, visible=visible, tab_id=tab_id)


def cdp_snapshot(tab_id: str = None, interactive_only: bool = True, max_elements: int = 60, **kwargs) -> Dict[str, Any]:
    """Get an accessibility-tree snapshot with @ref labels."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.get_snapshot(tab_id=tab_id, interactive_only=interactive_only, max_elements=max_elements)


def cdp_click_ref(ref: str, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Click an element by its @ref from the last snapshot."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.click_by_ref(ref, tab_id=tab_id)


def cdp_type_ref(ref: str, text: str, clear: bool = True, submit: bool = False, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Type text into an element by its @ref from the last snapshot."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.type_by_ref(ref, text, clear=clear, submit=submit, tab_id=tab_id)


# ── New Tool Functions ──────────────────────────────────────────────

def cdp_start_browser(url: str = "https://www.google.com", **kwargs) -> Dict[str, Any]:
    """Launch the CDP-managed browser."""
    browser = get_cdp_browser()
    if browser.launch_browser(url):
        return {"status": "success", "message": f"Browser launched on port {browser.port}"}
    return {"status": "error", "error": "Failed to launch browser"}


def cdp_stop_browser(**kwargs) -> Dict[str, Any]:
    """Stop the CDP-managed browser."""
    browser = get_cdp_browser()
    return browser.stop_browser()


def cdp_console(tab_id: str = None, level: str = None, **kwargs) -> Dict[str, Any]:
    """Get console messages from the page."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.get_console_messages(tab_id=tab_id, level=level)


def cdp_pdf(tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Save the current page as PDF."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.print_to_pdf(tab_id=tab_id)


def cdp_upload(paths: list = None, selector: str = None, ref: str = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Upload files to a file input element."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    if not paths:
        return {"status": "error", "error": "paths required (list of file paths)"}
    browser = get_cdp_browser()
    return browser.upload_files(paths, selector=selector, ref=ref, tab_id=tab_id)


def cdp_dialog(accept: bool = True, prompt_text: str = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Handle or arm a JavaScript dialog (alert/confirm/prompt)."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.handle_dialog(accept=accept, prompt_text=prompt_text, tab_id=tab_id)


def cdp_drag(start_selector: str = None, end_selector: str = None, start_ref: str = None, end_ref: str = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Drag from one element to another."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.drag_element(start_selector=start_selector, end_selector=end_selector, start_ref=start_ref, end_ref=end_ref, tab_id=tab_id)


def cdp_resize(width: int = 1280, height: int = 720, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Resize the browser viewport."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.resize_viewport(width, height, tab_id=tab_id)


def cdp_fill(fields: list = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Fill multiple form fields at once."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    if not fields:
        return {"status": "error", "error": "fields required (list of {selector/ref, value})"}
    browser = get_cdp_browser()
    return browser.fill_form(fields, tab_id=tab_id)


def cdp_click_enhanced(selector: str = None, ref: str = None, double_click: bool = False, button: str = "left", modifiers: list = None, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Enhanced click with double-click, right-click, and modifier keys."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.click_enhanced(selector=selector, ref=ref, double_click=double_click, button=button, modifiers=modifiers, tab_id=tab_id)


def cdp_type_slowly(selector: str = None, ref: str = None, text: str = "", delay_ms: int = 50, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Type text character by character with delay."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.type_slowly(selector=selector, ref=ref, text=text, delay_ms=delay_ms, tab_id=tab_id)


def cdp_wait_time(time_ms: int = 1000, **kwargs) -> Dict[str, Any]:
    """Wait for a fixed amount of time."""
    browser = get_cdp_browser()
    return browser.wait_time(time_ms=time_ms)


def cdp_wait_text_gone(text: str = "", timeout: float = 10.0, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Wait until specific text disappears from the page."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.wait_text_gone(text, timeout=timeout, tab_id=tab_id)


def cdp_snapshot_enhanced(tab_id: str = None, interactive_only: bool = True, max_elements: int = 60, selector: str = None, frame: str = None, compact: bool = False, depth: int = None, **kwargs) -> Dict[str, Any]:
    """Enhanced snapshot with selector scoping, iframe targeting, compact mode, depth control."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.get_snapshot_enhanced(tab_id=tab_id, interactive_only=interactive_only, max_elements=max_elements, selector=selector, frame=frame, compact=compact, depth=depth)


def cdp_screenshot_element(selector: str = None, ref: str = None, quality: int = 80, tab_id: str = None, **kwargs) -> Dict[str, Any]:
    """Take a screenshot of a specific element."""
    err = _ensure()
    if err:
        return {"status": "error", "error": err}
    browser = get_cdp_browser()
    return browser.screenshot_element(selector=selector, ref=ref, quality=quality, tab_id=tab_id)


# ── Tool Schemas for Registration ──────────────────────────────────

CDP_TOOLS = [
    {
        "name": "browser_tabs",
        "execute": cdp_list_tabs,
        "description": "List all open browser tabs. Shows tab IDs, titles, and URLs. Use this to find a tab to interact with.",
        "schema": None,
    },
    {
        "name": "browser_navigate",
        "execute": cdp_navigate,
        "description": "Navigate the active browser tab to a URL. Auto-attaches to the first tab if none selected. Requires Edge running with --remote-debugging-port=9222.",
        "schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to navigate to (https:// auto-prepended if missing)"},
                "tab_id": {"type": "string", "description": "Optional tab ID (from browser_tabs). Uses active tab if omitted."},
            },
            "required": ["url"],
        },
    },
    {
        "name": "browser_click",
        "execute": cdp_click,
        "description": "Click an element on the page by CSS selector. Use browser_elements first to discover selectors. Examples: '#submit-btn', 'a[href*=login]', 'button.primary'.",
        "schema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of element to click"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["selector"],
        },
    },
    {
        "name": "browser_type",
        "execute": cdp_type,
        "description": "Type text into an input field by CSS selector. Clears existing text by default. Use browser_elements to find input selectors.",
        "schema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of input element"},
                "text": {"type": "string", "description": "Text to type"},
                "clear": {"type": "boolean", "description": "Clear existing text first (default: true)"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["selector", "text"],
        },
    },
    {
        "name": "browser_submit",
        "execute": cdp_submit,
        "description": "Submit a form or press Enter on the focused element. Useful after typing into a search box.",
        "schema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of form (default: 'form')"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
        },
    },
    {
        "name": "browser_read",
        "execute": cdp_read_page,
        "description": "Read the current page's URL, title, and text content. Use this to understand what's on the page.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Optional tab ID"},
                "max_chars": {"type": "integer", "description": "Max characters to return (default: 50000)"},
            },
        },
    },
    {
        "name": "browser_elements",
        "execute": cdp_get_elements,
        "description": "Get a list of interactive elements on the page (links, buttons, inputs, etc.) with their CSS selectors. Use this before browser_click or browser_type to find the right selector.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Optional tab ID"},
                "max_elements": {"type": "integer", "description": "Max elements to return (default: 50)"},
            },
        },
    },
    {
        "name": "browser_screenshot",
        "execute": cdp_screenshot_tab,
        "description": "Take a screenshot of the current browser tab. Returns base64 JPEG. Use for visual verification of page state.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Optional tab ID"},
                "quality": {"type": "integer", "description": "JPEG quality 1-100 (default: 80)"},
                "full_page": {"type": "boolean", "description": "Capture full page including scrolled content (default: false)"},
            },
        },
    },
    {
        "name": "browser_eval",
        "execute": cdp_evaluate,
        "description": "Execute arbitrary JavaScript in the browser page context. Returns the result. Use for advanced DOM manipulation or data extraction.",
        "schema": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "JavaScript expression to evaluate"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["expression"],
        },
    },
    {
        "name": "browser_new_tab",
        "execute": cdp_new_tab,
        "description": "Open a new browser tab, optionally navigating to a URL.",
        "schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to open (default: about:blank)"},
            },
        },
    },
    {
        "name": "browser_close_tab",
        "execute": cdp_close_tab,
        "description": "Close a browser tab.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Tab ID to close (default: active tab)"},
            },
        },
    },
    {
        "name": "browser_snapshot",
        "execute": cdp_snapshot,
        "description": "Get a numbered snapshot of all interactive elements on the page (@1, @2, @3...). Use this BEFORE clicking or typing to discover what's on the page. Each element shows its role and label. Then use browser_click_ref or browser_type_ref with the @ref number.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Optional tab ID"},
                "interactive_only": {"type": "boolean", "description": "Only show interactive elements (default: true)"},
                "max_elements": {"type": "integer", "description": "Max elements to return (default: 60)"},
            },
        },
    },
    {
        "name": "browser_click_ref",
        "execute": cdp_click_ref,
        "description": "Click an element by its @ref number from browser_snapshot. Example: browser_click_ref ref='@3'. Auto-scrolls into view, retries with force click and coordinate click on failure.",
        "schema": {
            "type": "object",
            "properties": {
                "ref": {"type": "string", "description": "Element ref from snapshot (e.g. '@1', '@5', '3')"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["ref"],
        },
    },
    {
        "name": "browser_type_ref",
        "execute": cdp_type_ref,
        "description": "Type text into an element by its @ref number from browser_snapshot. Example: browser_type_ref ref='@2' text='hello'. Can optionally clear existing text and submit (press Enter).",
        "schema": {
            "type": "object",
            "properties": {
                "ref": {"type": "string", "description": "Element ref from snapshot (e.g. '@2')"},
                "text": {"type": "string", "description": "Text to type"},
                "clear": {"type": "boolean", "description": "Clear existing text first (default: true)"},
                "submit": {"type": "boolean", "description": "Press Enter after typing (default: false)"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["ref", "text"],
        },
    },
    {
        "name": "browser_scroll",
        "execute": cdp_scroll,
        "description": "Scroll the page or a specific element. Returns scroll position and whether you've reached the bottom.",
        "schema": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"], "description": "Scroll direction (default: down)"},
                "amount": {"type": "integer", "description": "Scroll amount in pixels (default: 500)"},
                "selector": {"type": "string", "description": "CSS selector to scroll within (scrolls page if omitted)"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
        },
    },
    {
        "name": "browser_back",
        "execute": cdp_go_back,
        "description": "Navigate back in browser history (like clicking the back button).",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
        },
    },
    {
        "name": "browser_forward",
        "execute": cdp_go_forward,
        "description": "Navigate forward in browser history.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
        },
    },
    {
        "name": "browser_hover",
        "execute": cdp_hover,
        "description": "Hover over an element by CSS selector. Triggers mouseover/mouseenter events. Useful for revealing tooltips or dropdown menus.",
        "schema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of element to hover"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["selector"],
        },
    },
    {
        "name": "browser_select",
        "execute": cdp_select_option,
        "description": "Select an option in a <select> dropdown by value, visible label, or index.",
        "schema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of the <select> element"},
                "value": {"type": "string", "description": "Option value to select"},
                "label": {"type": "string", "description": "Visible text of option to select"},
                "index": {"type": "integer", "description": "Zero-based index of option to select"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["selector"],
        },
    },
    {
        "name": "browser_press_key",
        "execute": cdp_press_key,
        "description": "Send a keyboard event. Supports: Enter, Escape, Tab, Backspace, Delete, ArrowUp/Down/Left/Right, Space, Home, End, PageUp, PageDown.",
        "schema": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Key to press (e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown')"},
                "selector": {"type": "string", "description": "CSS selector of target element (default: focused element)"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["key"],
        },
    },
    {
        "name": "browser_wait_for",
        "execute": cdp_wait_for,
        "description": "Wait for an element to appear on the page. Polls every 300ms until found or timeout.",
        "schema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector to wait for"},
                "timeout": {"type": "number", "description": "Timeout in seconds (default: 10)"},
                "visible": {"type": "boolean", "description": "Require element to be visible (default: true)"},
                "tab_id": {"type": "string", "description": "Optional tab ID"},
            },
            "required": ["selector"],
        },
    },
    {
        "name": "browser_activate_tab",
        "execute": cdp_activate_tab,
        "description": "Bring a browser tab to the foreground by its tab ID.",
        "schema": {
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "Tab ID to activate"},
            },
            "required": ["tab_id"],
        },
    },
    {
        "name": "browser_status",
        "execute": cdp_status,
        "description": "Check CDP browser connection status — whether browser is reachable, how many tabs, which tab is active.",
        "schema": None,
    },
]
