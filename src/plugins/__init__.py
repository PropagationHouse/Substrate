"""
Plugin System - Extensibility.

Provides:
- Plugin discovery and loading
- Lifecycle hooks (before_agent_start, after_tool_call, etc.)
- Plugin registry with enable/disable
- Custom tools from plugins
"""

from .registry import PluginRegistry, get_plugin_registry
from .hooks import HookRunner, create_hook_runner
from .types import (
    Plugin,
    PluginManifest,
    PluginHookName,
    PluginHookRegistration,
)
from .loader import load_plugin, discover_plugins

__all__ = [
    "PluginRegistry",
    "get_plugin_registry",
    "HookRunner",
    "create_hook_runner",
    "Plugin",
    "PluginManifest",
    "PluginHookName",
    "PluginHookRegistration",
    "load_plugin",
    "discover_plugins",
]
