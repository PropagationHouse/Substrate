"""
Chrome Extension Relay - Attach to existing browser tabs.
This module provides a WebSocket server that a Chrome/Edge extension can connect to,
allowing control of existing browser tabs without launching a new browser instance.

Features:
- WebSocket server for extension communication
- Tab listing and selection
- Execute actions on attached tabs
- Screenshot capture from attached tabs
- DOM inspection and interaction
"""

import json
import logging
import threading
import time
import base64
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field
import asyncio

logger = logging.getLogger(__name__)

# Try to import websockets
try:
    import websockets
    from websockets.sync.server import serve as ws_serve
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False
    logger.warning("websockets not installed. Run: pip install websockets")


@dataclass
class AttachedTab:
    """Represents an attached browser tab."""
    tab_id: str
    url: str
    title: str
    favicon_url: Optional[str] = None
    attached_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)


@dataclass
class RelayConnection:
    """Represents a connection from the browser extension."""
    connection_id: str
    websocket: Any
    tabs: Dict[str, AttachedTab] = field(default_factory=dict)
    active_tab_id: Optional[str] = None
    connected_at: float = field(default_factory=time.time)


class ChromeRelayServer:
    """
    WebSocket server for Chrome extension relay.
    
    The extension connects to this server and forwards commands to browser tabs.
    """
    
    def __init__(self, host: str = "localhost", port: int = 8766):
        self.host = host
        self.port = port
        self._connections: Dict[str, RelayConnection] = {}
        self._server = None
        self._server_thread: Optional[threading.Thread] = None
        self._running = False
        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._request_counter = 0
        self._lock = threading.Lock()
    
    def start(self) -> bool:
        """Start the relay server."""
        if not HAS_WEBSOCKETS:
            logger.error("Cannot start relay server: websockets not installed")
            return False
        
        if self._running:
            logger.warning("Relay server already running")
            return True
        
        self._running = True
        self._server_thread = threading.Thread(target=self._run_server, daemon=True)
        self._server_thread.start()
        
        logger.info(f"Chrome relay server starting on ws://{self.host}:{self.port}")
        return True
    
    def stop(self):
        """Stop the relay server."""
        self._running = False
        if self._server:
            self._server.shutdown()
        logger.info("Chrome relay server stopped")
    
    def _run_server(self):
        """Run the WebSocket server."""
        try:
            with ws_serve(self._handle_connection, self.host, self.port) as server:
                self._server = server
                logger.info(f"Chrome relay server listening on ws://{self.host}:{self.port}")
                server.serve_forever()
        except Exception as e:
            logger.error(f"Relay server error: {e}")
            self._running = False
    
    def _handle_connection(self, websocket):
        """Handle a new WebSocket connection."""
        connection_id = f"conn_{int(time.time() * 1000)}"
        connection = RelayConnection(
            connection_id=connection_id,
            websocket=websocket,
        )
        self._connections[connection_id] = connection
        
        logger.info(f"Extension connected: {connection_id}")
        
        try:
            for message in websocket:
                self._handle_message(connection, message)
        except Exception as e:
            logger.error(f"Connection error: {e}")
        finally:
            del self._connections[connection_id]
            logger.info(f"Extension disconnected: {connection_id}")
    
    def _handle_message(self, connection: RelayConnection, message: str):
        """Handle a message from the extension."""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "tabs_update":
                # Extension is reporting available tabs
                tabs_data = data.get("tabs", [])
                connection.tabs.clear()
                for tab in tabs_data:
                    attached = AttachedTab(
                        tab_id=str(tab.get("id")),
                        url=tab.get("url", ""),
                        title=tab.get("title", ""),
                        favicon_url=tab.get("favIconUrl"),
                    )
                    connection.tabs[attached.tab_id] = attached
                logger.debug(f"Updated tabs: {len(connection.tabs)}")
            
            elif msg_type == "tab_attached":
                # A tab was attached
                tab_data = data.get("tab", {})
                tab_id = str(tab_data.get("id"))
                connection.tabs[tab_id] = AttachedTab(
                    tab_id=tab_id,
                    url=tab_data.get("url", ""),
                    title=tab_data.get("title", ""),
                )
                connection.active_tab_id = tab_id
                logger.info(f"Tab attached: {tab_id}")
            
            elif msg_type == "tab_detached":
                # A tab was detached
                tab_id = str(data.get("tabId"))
                if tab_id in connection.tabs:
                    del connection.tabs[tab_id]
                if connection.active_tab_id == tab_id:
                    connection.active_tab_id = None
                logger.info(f"Tab detached: {tab_id}")
            
            elif msg_type == "response":
                # Response to a request
                request_id = data.get("requestId")
                if request_id in self._pending_requests:
                    future = self._pending_requests.pop(request_id)
                    if data.get("error"):
                        future.set_exception(Exception(data["error"]))
                    else:
                        future.set_result(data.get("result"))
            
            elif msg_type == "event":
                # Event from the extension
                event_name = data.get("event")
                event_data = data.get("data", {})
                logger.debug(f"Extension event: {event_name}")
            
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON from extension: {message[:100]}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    def _send_request(
        self,
        connection: RelayConnection,
        action: str,
        params: Dict[str, Any],
        timeout: float = 10.0,
    ) -> Any:
        """Send a request to the extension and wait for response."""
        with self._lock:
            self._request_counter += 1
            request_id = f"req_{self._request_counter}"
        
        request = {
            "type": "request",
            "requestId": request_id,
            "action": action,
            "params": params,
        }
        
        # Create a future for the response
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        self._pending_requests[request_id] = future
        
        try:
            connection.websocket.send(json.dumps(request))
            
            # Wait for response with timeout
            start = time.time()
            while not future.done() and (time.time() - start) < timeout:
                time.sleep(0.05)
            
            if not future.done():
                self._pending_requests.pop(request_id, None)
                raise TimeoutError(f"Request timed out: {action}")
            
            return future.result()
        finally:
            loop.close()
    
    # Public API
    
    def get_status(self) -> Dict[str, Any]:
        """Get relay server status."""
        connections = []
        for conn in self._connections.values():
            connections.append({
                "connection_id": conn.connection_id,
                "tabs": len(conn.tabs),
                "active_tab": conn.active_tab_id,
                "connected_at": conn.connected_at,
            })
        
        return {
            "running": self._running,
            "host": self.host,
            "port": self.port,
            "connections": connections,
            "total_connections": len(self._connections),
        }
    
    def list_tabs(self) -> List[Dict[str, Any]]:
        """List all attached tabs across all connections."""
        tabs = []
        for conn in self._connections.values():
            for tab in conn.tabs.values():
                tabs.append({
                    "tab_id": tab.tab_id,
                    "url": tab.url,
                    "title": tab.title,
                    "connection_id": conn.connection_id,
                    "active": tab.tab_id == conn.active_tab_id,
                })
        return tabs
    
    def get_active_connection(self) -> Optional[RelayConnection]:
        """Get the first connection with an active tab."""
        for conn in self._connections.values():
            if conn.active_tab_id and conn.active_tab_id in conn.tabs:
                return conn
        # Return first connection with any tabs
        for conn in self._connections.values():
            if conn.tabs:
                return conn
        return None
    
    def execute_script(
        self,
        script: str,
        tab_id: Optional[str] = None,
        connection_id: Optional[str] = None,
    ) -> Any:
        """Execute JavaScript in a tab."""
        conn = self._get_connection(connection_id)
        if not conn:
            raise RuntimeError("No extension connected")
        
        target_tab = tab_id or conn.active_tab_id
        if not target_tab:
            raise RuntimeError("No active tab")
        
        return self._send_request(conn, "executeScript", {
            "tabId": target_tab,
            "script": script,
        })
    
    def get_page_content(
        self,
        tab_id: Optional[str] = None,
        connection_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get page content from a tab."""
        script = """
        (() => {
            return {
                url: window.location.href,
                title: document.title,
                text: document.body.innerText.slice(0, 50000),
                html: document.documentElement.outerHTML.slice(0, 100000),
            };
        })()
        """
        return self.execute_script(script, tab_id, connection_id)
    
    def take_screenshot(
        self,
        tab_id: Optional[str] = None,
        connection_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Take a screenshot of a tab."""
        conn = self._get_connection(connection_id)
        if not conn:
            raise RuntimeError("No extension connected")
        
        target_tab = tab_id or conn.active_tab_id
        if not target_tab:
            raise RuntimeError("No active tab")
        
        result = self._send_request(conn, "captureTab", {
            "tabId": target_tab,
        })
        
        return {
            "status": "success",
            "image": result.get("dataUrl", "").split(",", 1)[-1] if result else "",
            "format": "png",
        }
    
    def click_element(
        self,
        selector: str,
        tab_id: Optional[str] = None,
        connection_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Click an element in a tab."""
        script = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ success: false, error: 'Element not found' }};
            el.click();
            return {{ success: true }};
        }})()
        """
        return self.execute_script(script, tab_id, connection_id)
    
    def type_text(
        self,
        selector: str,
        text: str,
        tab_id: Optional[str] = None,
        connection_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Type text into an element."""
        script = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return {{ success: false, error: 'Element not found' }};
            el.focus();
            el.value = {json.dumps(text)};
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            return {{ success: true }};
        }})()
        """
        return self.execute_script(script, tab_id, connection_id)
    
    def get_snapshot(
        self,
        tab_id: Optional[str] = None,
        connection_id: Optional[str] = None,
        interactive_only: bool = True,
    ) -> Dict[str, Any]:
        """Get AI snapshot of page elements."""
        script = f"""
        (() => {{
            const interactive = 'button, a, input, select, textarea, [role="button"], [role="link"], [onclick]';
            const selector = {str(interactive_only).lower()} ? interactive : '*';
            const elements = Array.from(document.querySelectorAll(selector)).slice(0, 50);
            
            return elements.map((el, idx) => {{
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return null;
                
                return {{
                    ref: '@' + (idx + 1),
                    tag: el.tagName.toLowerCase(),
                    text: (el.innerText || el.value || '').trim().slice(0, 50),
                    selector: el.id ? '#' + el.id : el.tagName.toLowerCase(),
                }};
            }}).filter(e => e !== null);
        }})()
        """
        elements = self.execute_script(script, tab_id, connection_id)
        
        return {
            "status": "success",
            "elements": elements or [],
            "ref_count": len(elements) if elements else 0,
        }
    
    def _get_connection(self, connection_id: Optional[str] = None) -> Optional[RelayConnection]:
        """Get a connection by ID or the active one."""
        if connection_id:
            return self._connections.get(connection_id)
        return self.get_active_connection()


# Global relay server instance
_relay_server: Optional[ChromeRelayServer] = None


def get_chrome_relay() -> ChromeRelayServer:
    """Get the global Chrome relay server."""
    global _relay_server
    if _relay_server is None:
        _relay_server = ChromeRelayServer()
    return _relay_server


def start_chrome_relay(host: str = "localhost", port: int = 8766) -> ChromeRelayServer:
    """Start the Chrome relay server."""
    global _relay_server
    _relay_server = ChromeRelayServer(host, port)
    _relay_server.start()
    return _relay_server


# Chrome Extension manifest template
EXTENSION_MANIFEST = {
    "manifest_version": 3,
    "name": "Substrate Browser Relay",
    "version": "1.0.0",
    "description": "Connect browser tabs to Substrate agent",
    "permissions": [
        "tabs",
        "activeTab",
        "scripting",
    ],
    "host_permissions": ["<all_urls>"],
    "action": {
        "default_title": "Substrate Relay",
        "default_popup": "popup.html",
    },
    "background": {
        "service_worker": "background.js",
    },
}
