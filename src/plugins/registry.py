"""
Plugin Registry - Central registry for plugins.
"""

import logging
from typing import Dict, Any, Optional, List
from pathlib import Path

from .types import (
    Plugin,
    PluginManifest,
    PluginHookName,
    PluginHookRegistration,
    PluginTool,
)

logger = logging.getLogger(__name__)


class PluginRegistry:
    """
    Central registry for all plugins.
    
    Manages:
    - Plugin registration and discovery
    - Enable/disable state
    - Hook registrations
    - Tool registrations
    """
    
    def __init__(self):
        self._plugins: Dict[str, Plugin] = {}
        self._hooks: List[PluginHookRegistration] = []
        self._tools: Dict[str, PluginTool] = {}
        self._config: Dict[str, Any] = {}
    
    def register(self, plugin: Plugin) -> bool:
        """
        Register a plugin.
        
        Args:
            plugin: Plugin instance to register
            
        Returns:
            True if registered successfully
        """
        if plugin.id in self._plugins:
            logger.warning(f"Plugin {plugin.id} already registered, replacing")
        
        self._plugins[plugin.id] = plugin
        
        # Register hooks
        for hook in plugin.hooks:
            self._hooks.append(hook)
        
        # Register tools
        for tool in plugin.tools:
            tool.plugin_id = plugin.id
            self._tools[tool.name] = tool
        
        logger.info(f"Registered plugin: {plugin.name} ({plugin.id})")
        return True
    
    def unregister(self, plugin_id: str) -> bool:
        """
        Unregister a plugin.
        
        Args:
            plugin_id: ID of plugin to unregister
            
        Returns:
            True if unregistered successfully
        """
        if plugin_id not in self._plugins:
            return False
        
        plugin = self._plugins[plugin_id]
        
        # Remove hooks
        self._hooks = [h for h in self._hooks if h.plugin_id != plugin_id]
        
        # Remove tools
        self._tools = {k: v for k, v in self._tools.items() if v.plugin_id != plugin_id}
        
        del self._plugins[plugin_id]
        logger.info(f"Unregistered plugin: {plugin_id}")
        return True
    
    def get(self, plugin_id: str) -> Optional[Plugin]:
        """Get a plugin by ID."""
        return self._plugins.get(plugin_id)
    
    def list_plugins(self) -> List[Plugin]:
        """List all registered plugins."""
        return list(self._plugins.values())
    
    def list_enabled(self) -> List[Plugin]:
        """List enabled plugins."""
        return [p for p in self._plugins.values() if p.enabled]
    
    def enable(self, plugin_id: str) -> bool:
        """Enable a plugin."""
        if plugin_id not in self._plugins:
            return False
        self._plugins[plugin_id].enabled = True
        logger.info(f"Enabled plugin: {plugin_id}")
        return True
    
    def disable(self, plugin_id: str) -> bool:
        """Disable a plugin."""
        if plugin_id not in self._plugins:
            return False
        self._plugins[plugin_id].enabled = False
        logger.info(f"Disabled plugin: {plugin_id}")
        return True
    
    def get_hooks(self, hook_name: PluginHookName) -> List[PluginHookRegistration]:
        """
        Get all hooks for a hook name, sorted by priority.
        
        Args:
            hook_name: Hook name to get handlers for
            
        Returns:
            List of hook registrations, sorted by priority (high first)
        """
        hooks = [
            h for h in self._hooks
            if h.hook_name == hook_name
            and self._plugins.get(h.plugin_id, Plugin(PluginManifest("", "", ""))).enabled
        ]
        return sorted(hooks, key=lambda h: h.priority, reverse=True)
    
    def get_tools(self) -> Dict[str, PluginTool]:
        """Get all registered tools from enabled plugins."""
        return {
            name: tool
            for name, tool in self._tools.items()
            if self._plugins.get(tool.plugin_id, Plugin(PluginManifest("", "", ""))).enabled
        }
    
    def has_hooks(self, hook_name: PluginHookName) -> bool:
        """Check if any hooks are registered for a hook name."""
        return len(self.get_hooks(hook_name)) > 0
    
    def get_hook_count(self, hook_name: PluginHookName) -> int:
        """Get count of hooks for a hook name."""
        return len(self.get_hooks(hook_name))
    
    @property
    def typed_hooks(self) -> List[PluginHookRegistration]:
        """Get all hook registrations (for hook runner)."""
        return self._hooks
    
    def status(self) -> Dict[str, Any]:
        """Get registry status."""
        return {
            "plugins": {
                p.id: {
                    "name": p.name,
                    "version": p.manifest.version,
                    "enabled": p.enabled,
                    "hooks": len(p.hooks),
                    "tools": len(p.tools),
                }
                for p in self._plugins.values()
            },
            "total_plugins": len(self._plugins),
            "enabled_plugins": len([p for p in self._plugins.values() if p.enabled]),
            "total_hooks": len(self._hooks),
            "total_tools": len(self._tools),
        }


# Global registry instance
_registry: Optional[PluginRegistry] = None


def get_plugin_registry() -> PluginRegistry:
    """Get the global plugin registry."""
    global _registry
    if _registry is None:
        _registry = PluginRegistry()
    return _registry
