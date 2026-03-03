"""
MCP Client Manager — connects to MCP servers, discovers tools, bridges async→sync.

Reads server definitions from config/mcp_servers.json, connects via stdio or HTTP,
discovers tools via list_tools(), and provides a sync call_tool() interface for
the ToolRegistry to use.

Supports:
- stdio transport (spawns a subprocess)
- SSE transport (connects to HTTP endpoint)
- Streamable HTTP transport
"""

import asyncio
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Config types ──────────────────────────────────────────────────────

@dataclass
class MCPServerConfig:
    """Configuration for a single MCP server."""
    name: str
    transport: str = "stdio"  # "stdio", "sse", "http"
    command: Optional[str] = None  # For stdio: executable
    args: List[str] = field(default_factory=list)  # For stdio: command args
    env: Dict[str, str] = field(default_factory=dict)  # Extra env vars
    url: Optional[str] = None  # For sse/http: endpoint URL
    headers: Dict[str, str] = field(default_factory=dict)  # For http: headers
    enabled: bool = True
    tool_prefix: Optional[str] = None  # Override namespace prefix (default: server name)
    max_tools: int = 50  # Max tools to register from this server


@dataclass
class MCPToolInfo:
    """Discovered tool from an MCP server."""
    server_name: str
    tool_name: str  # Original name from server
    registered_name: str  # Prefixed name registered in ToolRegistry
    description: str
    schema: Dict[str, Any]


# ── Async event loop bridge ──────────────────────────────────────────

class _AsyncBridge:
    """Runs an asyncio event loop in a background daemon thread.
    
    Provides run_coroutine() to submit async work from sync code.
    """
    
    def __init__(self):
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
    
    def start(self):
        if self._loop is not None:
            return
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="mcp-async-bridge")
        self._thread.start()
        self._ready.wait(timeout=5.0)
    
    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._ready.set()
        self._loop.run_forever()
    
    def run_coroutine(self, coro, timeout: float = 60.0):
        """Submit a coroutine to the async loop and block until it completes."""
        if not self._loop:
            raise RuntimeError("Async bridge not started")
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)
    
    def stop(self):
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)
            if self._thread:
                self._thread.join(timeout=5.0)
            self._loop = None
            self._thread = None


# ── MCP Client Manager ───────────────────────────────────────────────

class MCPClientManager:
    """Manages connections to multiple MCP servers.
    
    Lifecycle:
    1. load_config() — read config/mcp_servers.json
    2. connect_all() — connect to all enabled servers, discover tools
    3. call_tool(server, tool, args) — invoke a tool (sync, thread-safe)
    4. shutdown() — disconnect all servers
    """
    
    def __init__(self, config_path: Optional[str] = None):
        soma = Path(__file__).parent.parent.parent
        self._config_path = config_path or str(
            soma / "config" / "mcp_servers.json"
        )
        self._servers: Dict[str, MCPServerConfig] = {}
        self._sessions: Dict[str, Any] = {}  # server_name -> ClientSession
        self._transports: Dict[str, Any] = {}  # server_name -> transport context managers
        self._tools: Dict[str, MCPToolInfo] = {}  # registered_name -> MCPToolInfo
        self._bridge = _AsyncBridge()
        self._lock = threading.Lock()
        self._connected = False
    
    def load_config(self) -> Dict[str, MCPServerConfig]:
        """Load server definitions from config file."""
        if not os.path.isfile(self._config_path):
            logger.info(f"MCP config not found at {self._config_path}, no MCP servers configured")
            return {}
        
        try:
            with open(self._config_path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
        except Exception as e:
            logger.error(f"Failed to parse MCP config: {e}")
            return {}
        
        servers_raw = raw.get("servers", raw.get("mcpServers", {}))
        if not isinstance(servers_raw, dict):
            logger.error("MCP config 'servers' must be an object")
            return {}
        
        servers = {}
        for name, cfg in servers_raw.items():
            if not isinstance(cfg, dict):
                continue
            
            # Auto-detect transport
            transport = cfg.get("transport", "stdio")
            if "url" in cfg and transport == "stdio":
                transport = "sse"
            
            # Resolve env vars (support ${VAR} syntax)
            env = {}
            for k, v in cfg.get("env", {}).items():
                if isinstance(v, str) and v.startswith("${") and v.endswith("}"):
                    env_var = v[2:-1]
                    env[k] = os.environ.get(env_var, "")
                else:
                    env[k] = str(v)
            
            servers[name] = MCPServerConfig(
                name=name,
                transport=transport,
                command=cfg.get("command"),
                args=cfg.get("args", []),
                env=env,
                url=cfg.get("url"),
                headers=cfg.get("headers", {}),
                enabled=cfg.get("enabled", True),
                tool_prefix=cfg.get("toolPrefix", cfg.get("tool_prefix")),
                max_tools=cfg.get("maxTools", cfg.get("max_tools", 50)),
            )
        
        self._servers = servers
        logger.info(f"MCP config loaded: {len(servers)} server(s) — {', '.join(servers.keys())}")
        return servers
    
    def connect_all(self) -> List[MCPToolInfo]:
        """Connect to all enabled servers and discover tools. Returns all discovered tools."""
        if not self._servers:
            self.load_config()
        
        enabled = {k: v for k, v in self._servers.items() if v.enabled}
        if not enabled:
            logger.info("No enabled MCP servers to connect")
            return []
        
        self._bridge.start()
        all_tools = []
        
        for name, cfg in enabled.items():
            try:
                tools = self._bridge.run_coroutine(
                    self._connect_server(name, cfg),
                    timeout=30.0,
                )
                all_tools.extend(tools)
                logger.info(f"MCP [{name}]: connected, {len(tools)} tool(s) discovered")
            except Exception as e:
                logger.error(f"MCP [{name}]: failed to connect — {e}")
        
        self._connected = True
        logger.info(f"MCP: {len(all_tools)} total tool(s) from {len(enabled)} server(s)")
        return all_tools
    
    async def _connect_server(self, name: str, cfg: MCPServerConfig) -> List[MCPToolInfo]:
        """Connect to a single server and discover its tools."""
        from mcp import ClientSession
        
        if cfg.transport == "stdio":
            return await self._connect_stdio(name, cfg)
        elif cfg.transport == "sse":
            return await self._connect_sse(name, cfg)
        elif cfg.transport == "http":
            return await self._connect_http(name, cfg)
        else:
            raise ValueError(f"Unknown transport: {cfg.transport}")
    
    async def _connect_stdio(self, name: str, cfg: MCPServerConfig) -> List[MCPToolInfo]:
        """Connect via stdio transport."""
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        
        if not cfg.command:
            raise ValueError(f"MCP [{name}]: 'command' required for stdio transport")
        
        # Build env: inherit current env + overrides
        env = {**os.environ, **cfg.env}
        
        server_params = StdioServerParameters(
            command=cfg.command,
            args=cfg.args,
            env=env,
        )
        
        # stdio_client is an async context manager that yields (read, write) streams
        transport_cm = stdio_client(server_params)
        streams = await transport_cm.__aenter__()
        read_stream, write_stream = streams
        
        # Create and initialize session
        session = ClientSession(read_stream, write_stream)
        await session.__aenter__()
        await session.initialize()
        
        # Store for later use
        self._transports[name] = transport_cm
        self._sessions[name] = session
        
        return await self._discover_tools(name, cfg, session)
    
    async def _connect_sse(self, name: str, cfg: MCPServerConfig) -> List[MCPToolInfo]:
        """Connect via SSE transport."""
        from mcp import ClientSession
        from mcp.client.sse import sse_client
        
        if not cfg.url:
            raise ValueError(f"MCP [{name}]: 'url' required for sse transport")
        
        transport_cm = sse_client(cfg.url, headers=cfg.headers if cfg.headers else None)
        streams = await transport_cm.__aenter__()
        read_stream, write_stream = streams
        
        session = ClientSession(read_stream, write_stream)
        await session.__aenter__()
        await session.initialize()
        
        self._transports[name] = transport_cm
        self._sessions[name] = session
        
        return await self._discover_tools(name, cfg, session)
    
    async def _connect_http(self, name: str, cfg: MCPServerConfig) -> List[MCPToolInfo]:
        """Connect via streamable HTTP transport."""
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client
        
        if not cfg.url:
            raise ValueError(f"MCP [{name}]: 'url' required for http transport")
        
        transport_cm = streamablehttp_client(cfg.url, headers=cfg.headers if cfg.headers else None)
        streams = await transport_cm.__aenter__()
        read_stream, write_stream = streams[0], streams[1]
        
        session = ClientSession(read_stream, write_stream)
        await session.__aenter__()
        await session.initialize()
        
        self._transports[name] = transport_cm
        self._sessions[name] = session
        
        return await self._discover_tools(name, cfg, session)
    
    @staticmethod
    def _sanitize_tool_name(raw_name: str) -> str:
        """Clean up MCP tool names to be LLM-friendly.
        
        Examples:
            'API-get-user' → 'get_user'
            'API-post-search' → 'search'
            'API-patch-page' → 'update_page'
            'API-retrieve-a-block' → 'retrieve_block'
            'API-delete-a-block' → 'delete_block'
            'API-query-data-source' → 'query_data_source'
        """
        import re
        name = raw_name
        # Strip common prefixes like 'API-'
        name = re.sub(r'^API-', '', name)
        # Map HTTP verbs to cleaner action names
        name = re.sub(r'^post-', '', name)
        name = re.sub(r'^patch-', 'update_', name)
        name = re.sub(r'^get-', 'get_', name)
        name = re.sub(r'^put-', 'set_', name)
        # Remove filler words like 'a', 'an', 'the'
        name = re.sub(r'-a-', '-', name)
        name = re.sub(r'-an-', '-', name)
        name = re.sub(r'-the-', '-', name)
        # Replace hyphens with underscores
        name = name.replace('-', '_')
        # Collapse double underscores
        name = re.sub(r'_+', '_', name)
        # Strip leading/trailing underscores
        name = name.strip('_')
        return name
    
    async def _discover_tools(
        self, name: str, cfg: MCPServerConfig, session: Any
    ) -> List[MCPToolInfo]:
        """Discover tools from a connected server."""
        result = await session.list_tools()
        
        prefix = cfg.tool_prefix or name
        tools = []
        seen_names = set()
        
        for tool in result.tools[:cfg.max_tools]:
            # Clean up tool name and build registered name with namespace prefix
            clean_name = self._sanitize_tool_name(tool.name)
            registered_name = f"{prefix}_{clean_name}"
            
            # Handle name collisions by appending a suffix
            if registered_name in seen_names:
                registered_name = f"{prefix}_{tool.name.replace('-', '_')}"
            seen_names.add(registered_name)
            
            # Convert MCP inputSchema to Gemini-compatible JSON schema
            schema = self._convert_schema(tool.inputSchema) if tool.inputSchema else {
                "type": "object",
                "properties": {},
            }
            
            info = MCPToolInfo(
                server_name=name,
                tool_name=tool.name,
                registered_name=registered_name,
                description=tool.description or f"MCP tool: {tool.name} (from {name})",
                schema=schema,
            )
            
            self._tools[registered_name] = info
            tools.append(info)
        
        if len(result.tools) > cfg.max_tools:
            logger.warning(
                f"MCP [{name}]: {len(result.tools)} tools available, "
                f"capped at {cfg.max_tools}. Increase maxTools in config to see more."
            )
        
        return tools
    
    @staticmethod
    def _convert_schema(input_schema: dict) -> dict:
        """Convert MCP inputSchema to Gemini-compatible JSON schema.
        
        Strips unsupported keywords like additionalProperties, $schema, etc.
        """
        if not input_schema:
            return {"type": "object", "properties": {}}
        
        def _clean(obj):
            if not isinstance(obj, dict):
                return obj
            cleaned = {}
            for k, v in obj.items():
                # Strip keywords Gemini doesn't support
                if k in ("additionalProperties", "$schema", "$id", "$ref",
                         "definitions", "$defs", "default", "examples"):
                    continue
                if isinstance(v, dict):
                    cleaned[k] = _clean(v)
                elif isinstance(v, list):
                    cleaned[k] = [_clean(item) if isinstance(item, dict) else item for item in v]
                else:
                    cleaned[k] = v
            return cleaned
        
        schema = _clean(input_schema)
        if "type" not in schema:
            schema["type"] = "object"
        if "properties" not in schema:
            schema["properties"] = {}
        return schema
    
    def call_tool(self, registered_name: str, **kwargs) -> Dict[str, Any]:
        """Call an MCP tool by its registered name. Sync, thread-safe."""
        info = self._tools.get(registered_name)
        if not info:
            return {"status": "error", "error": f"Unknown MCP tool: {registered_name}"}
        
        session = self._sessions.get(info.server_name)
        if not session:
            return {"status": "error", "error": f"MCP server not connected: {info.server_name}"}
        
        try:
            result = self._bridge.run_coroutine(
                session.call_tool(info.tool_name, arguments=kwargs),
                timeout=60.0,
            )
            
            # Extract text content from MCP result
            output_parts = []
            for content in result.content:
                if hasattr(content, 'text'):
                    output_parts.append(content.text)
                elif hasattr(content, 'data'):
                    output_parts.append(f"[binary data: {content.mimeType}]")
                else:
                    output_parts.append(str(content))
            
            output = "\n".join(output_parts) if output_parts else ""
            
            return {
                "status": "success" if not result.isError else "error",
                "output": output,
                "server": info.server_name,
                "tool": info.tool_name,
            }
            
        except Exception as e:
            logger.error(f"MCP tool call failed [{registered_name}]: {e}")
            return {"status": "error", "error": str(e)}
    
    def get_discovered_tools(self) -> List[MCPToolInfo]:
        """Get all discovered tools."""
        return list(self._tools.values())
    
    def get_server_status(self) -> Dict[str, Any]:
        """Get status of all configured servers."""
        status = {}
        for name, cfg in self._servers.items():
            connected = name in self._sessions
            tool_count = sum(1 for t in self._tools.values() if t.server_name == name)
            status[name] = {
                "enabled": cfg.enabled,
                "connected": connected,
                "transport": cfg.transport,
                "tools": tool_count,
            }
        return status
    
    def shutdown(self):
        """Disconnect all servers and stop the async bridge."""
        if not self._connected:
            return
        
        for name in list(self._sessions.keys()):
            try:
                session = self._sessions.pop(name, None)
                transport = self._transports.pop(name, None)
                if session:
                    try:
                        self._bridge.run_coroutine(session.__aexit__(None, None, None), timeout=5.0)
                    except Exception:
                        pass
                if transport:
                    try:
                        self._bridge.run_coroutine(transport.__aexit__(None, None, None), timeout=5.0)
                    except Exception:
                        pass
            except Exception as e:
                logger.warning(f"MCP [{name}]: error during shutdown — {e}")
        
        self._tools.clear()
        self._bridge.stop()
        self._connected = False
        logger.info("MCP: all servers disconnected")


# ── Global instance ───────────────────────────────────────────────────

_mcp_manager: Optional[MCPClientManager] = None
_mcp_lock = threading.Lock()


def get_mcp_manager() -> Optional[MCPClientManager]:
    """Get the global MCP client manager."""
    return _mcp_manager


def init_mcp_client(config_path: Optional[str] = None) -> MCPClientManager:
    """Initialize and connect the global MCP client manager.
    
    Returns the manager with all discovered tools.
    Call get_mcp_manager() afterward to access it.
    """
    global _mcp_manager
    
    with _mcp_lock:
        if _mcp_manager:
            _mcp_manager.shutdown()
        
        _mcp_manager = MCPClientManager(config_path=config_path)
        _mcp_manager.load_config()
        _mcp_manager.connect_all()
        
        return _mcp_manager


def shutdown_mcp_client():
    """Shutdown the global MCP client manager."""
    global _mcp_manager
    
    with _mcp_lock:
        if _mcp_manager:
            _mcp_manager.shutdown()
            _mcp_manager = None
