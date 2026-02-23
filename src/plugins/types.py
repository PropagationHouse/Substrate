"""
Plugin Types - Type definitions for the plugin system.
"""

from typing import Dict, Any, Optional, List, Callable, Union
from dataclasses import dataclass, field
from enum import Enum


class PluginHookName(str, Enum):
    """Available plugin hooks."""
    # Agent lifecycle
    BEFORE_AGENT_START = "before_agent_start"
    AGENT_END = "agent_end"
    
    # Message lifecycle
    MESSAGE_RECEIVED = "message_received"
    MESSAGE_SENDING = "message_sending"
    MESSAGE_SENT = "message_sent"
    
    # Tool lifecycle
    BEFORE_TOOL_CALL = "before_tool_call"
    AFTER_TOOL_CALL = "after_tool_call"
    TOOL_RESULT_PERSIST = "tool_result_persist"
    
    # Session lifecycle
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    
    # Compaction
    BEFORE_COMPACTION = "before_compaction"
    AFTER_COMPACTION = "after_compaction"
    
    # Server lifecycle
    SERVER_START = "server_start"
    SERVER_STOP = "server_stop"


@dataclass
class PluginManifest:
    """Plugin manifest describing the plugin."""
    id: str
    name: str
    version: str
    description: str = ""
    author: str = ""
    homepage: str = ""
    requires: List[str] = field(default_factory=list)  # Required plugins
    capabilities: List[str] = field(default_factory=list)  # e.g., ["tools", "hooks"]
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PluginManifest":
        return cls(
            id=data.get("id", "unknown"),
            name=data.get("name", "Unknown Plugin"),
            version=data.get("version", "0.0.0"),
            description=data.get("description", ""),
            author=data.get("author", ""),
            homepage=data.get("homepage", ""),
            requires=data.get("requires", []),
            capabilities=data.get("capabilities", []),
        )


@dataclass
class PluginHookRegistration:
    """Registration of a hook handler."""
    hook_name: PluginHookName
    plugin_id: str
    handler: Callable
    priority: int = 0  # Higher priority runs first


@dataclass
class PluginTool:
    """A tool provided by a plugin."""
    name: str
    description: str
    handler: Callable
    schema: Optional[Dict[str, Any]] = None
    plugin_id: str = ""


@dataclass
class Plugin:
    """A loaded plugin instance."""
    manifest: PluginManifest
    enabled: bool = True
    hooks: List[PluginHookRegistration] = field(default_factory=list)
    tools: List[PluginTool] = field(default_factory=list)
    config: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def id(self) -> str:
        return self.manifest.id
    
    @property
    def name(self) -> str:
        return self.manifest.name


# Hook context types

@dataclass
class AgentContext:
    """Context passed to agent hooks."""
    session_key: str
    model: str
    provider: str
    config: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MessageContext:
    """Context passed to message hooks."""
    session_key: str
    channel: Optional[str] = None
    user_id: Optional[str] = None


@dataclass
class ToolContext:
    """Context passed to tool hooks."""
    session_key: str
    tool_name: str
    tool_call_id: str


# Hook event types

@dataclass
class BeforeAgentStartEvent:
    """Event for before_agent_start hook."""
    message: str
    system_prompt: str
    messages: List[Dict[str, Any]]


@dataclass
class BeforeAgentStartResult:
    """Result from before_agent_start hook."""
    system_prompt: Optional[str] = None
    prepend_context: Optional[str] = None


@dataclass
class AgentEndEvent:
    """Event for agent_end hook."""
    message: str
    response: str
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    duration_ms: int = 0


@dataclass
class MessageReceivedEvent:
    """Event for message_received hook."""
    content: str
    timestamp: float
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MessageSendingEvent:
    """Event for message_sending hook."""
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MessageSendingResult:
    """Result from message_sending hook."""
    content: Optional[str] = None
    cancel: bool = False


@dataclass
class BeforeToolCallEvent:
    """Event for before_tool_call hook."""
    tool_name: str
    params: Dict[str, Any]


@dataclass
class BeforeToolCallResult:
    """Result from before_tool_call hook."""
    params: Optional[Dict[str, Any]] = None
    block: bool = False
    block_reason: Optional[str] = None


@dataclass
class AfterToolCallEvent:
    """Event for after_tool_call hook."""
    tool_name: str
    params: Dict[str, Any]
    result: Any
    duration_ms: int = 0
    error: Optional[str] = None
