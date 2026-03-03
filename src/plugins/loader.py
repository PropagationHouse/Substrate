"""
Plugin Loader - Discover and load plugins.
"""

import os
import json
import logging
import importlib.util
from typing import Dict, Any, Optional, List
from pathlib import Path

from .types import (
    Plugin,
    PluginManifest,
    PluginHookName,
    PluginHookRegistration,
    PluginTool,
)
from .registry import PluginRegistry, get_plugin_registry

logger = logging.getLogger(__name__)

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
PLUGINS_DIR = SOMA / "plugins"


def discover_plugins(plugins_dir: Optional[Path] = None) -> List[Path]:
    """
    Discover plugin directories.
    
    Each plugin should be a directory containing:
    - manifest.json: Plugin metadata
    - plugin.py: Plugin code (optional)
    
    Args:
        plugins_dir: Directory to search for plugins
        
    Returns:
        List of plugin directory paths
    """
    search_dir = plugins_dir or PLUGINS_DIR
    
    if not search_dir.exists():
        logger.info(f"Plugins directory does not exist: {search_dir}")
        return []
    
    plugins = []
    for item in search_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.'):
            manifest_path = item / "manifest.json"
            if manifest_path.exists():
                plugins.append(item)
    
    logger.info(f"Discovered {len(plugins)} plugins in {search_dir}")
    return plugins


def load_manifest(plugin_dir: Path) -> Optional[PluginManifest]:
    """Load plugin manifest from directory."""
    manifest_path = plugin_dir / "manifest.json"
    
    if not manifest_path.exists():
        logger.warning(f"No manifest.json in {plugin_dir}")
        return None
    
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return PluginManifest.from_dict(data)
    except Exception as e:
        logger.error(f"Error loading manifest from {plugin_dir}: {e}")
        return None


def load_plugin_module(plugin_dir: Path, manifest: PluginManifest) -> Optional[Any]:
    """Load plugin Python module."""
    plugin_file = plugin_dir / "plugin.py"
    
    if not plugin_file.exists():
        return None
    
    try:
        spec = importlib.util.spec_from_file_location(
            f"plugins.{manifest.id}",
            plugin_file
        )
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    except Exception as e:
        logger.error(f"Error loading plugin module {plugin_file}: {e}")
    
    return None


def load_plugin(plugin_dir: Path) -> Optional[Plugin]:
    """
    Load a plugin from a directory.
    
    Args:
        plugin_dir: Path to plugin directory
        
    Returns:
        Loaded Plugin or None
    """
    # Load manifest
    manifest = load_manifest(plugin_dir)
    if not manifest:
        return None
    
    # Create plugin instance
    plugin = Plugin(manifest=manifest)
    
    # Load config if exists
    config_path = plugin_dir / "config.json"
    if config_path.exists():
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                plugin.config = json.load(f)
        except Exception as e:
            logger.warning(f"Error loading plugin config: {e}")
    
    # Load Python module
    module = load_plugin_module(plugin_dir, manifest)
    if module:
        # Register hooks from module
        if hasattr(module, 'register_hooks'):
            try:
                hooks = module.register_hooks(plugin.config)
                if isinstance(hooks, list):
                    for hook_data in hooks:
                        hook = PluginHookRegistration(
                            hook_name=PluginHookName(hook_data.get('hook')),
                            plugin_id=manifest.id,
                            handler=hook_data.get('handler'),
                            priority=hook_data.get('priority', 0),
                        )
                        plugin.hooks.append(hook)
            except Exception as e:
                logger.error(f"Error registering hooks for {manifest.id}: {e}")
        
        # Register tools from module
        if hasattr(module, 'register_tools'):
            try:
                tools = module.register_tools(plugin.config)
                if isinstance(tools, list):
                    for tool_data in tools:
                        tool = PluginTool(
                            name=tool_data.get('name'),
                            description=tool_data.get('description', ''),
                            handler=tool_data.get('handler'),
                            schema=tool_data.get('schema'),
                            plugin_id=manifest.id,
                        )
                        plugin.tools.append(tool)
            except Exception as e:
                logger.error(f"Error registering tools for {manifest.id}: {e}")
        
        # Call plugin init if exists
        if hasattr(module, 'init'):
            try:
                module.init(plugin.config)
            except Exception as e:
                logger.error(f"Error initializing plugin {manifest.id}: {e}")
    
    logger.info(f"Loaded plugin: {manifest.name} ({manifest.id}) - {len(plugin.hooks)} hooks, {len(plugin.tools)} tools")
    return plugin


def load_all_plugins(
    plugins_dir: Optional[Path] = None,
    registry: Optional[PluginRegistry] = None,
) -> List[Plugin]:
    """
    Discover and load all plugins.
    
    Args:
        plugins_dir: Directory to search for plugins
        registry: Registry to register plugins with
        
    Returns:
        List of loaded plugins
    """
    reg = registry or get_plugin_registry()
    plugin_dirs = discover_plugins(plugins_dir)
    
    loaded = []
    for plugin_dir in plugin_dirs:
        plugin = load_plugin(plugin_dir)
        if plugin:
            reg.register(plugin)
            loaded.append(plugin)
    
    return loaded


def create_plugin_template(
    plugin_id: str,
    name: str,
    plugins_dir: Optional[Path] = None,
) -> Path:
    """
    Create a new plugin from template.
    
    Args:
        plugin_id: Plugin identifier (lowercase, no spaces)
        name: Human-readable plugin name
        plugins_dir: Directory to create plugin in
        
    Returns:
        Path to created plugin directory
    """
    base_dir = plugins_dir or PLUGINS_DIR
    plugin_dir = base_dir / plugin_id
    
    if plugin_dir.exists():
        raise ValueError(f"Plugin directory already exists: {plugin_dir}")
    
    plugin_dir.mkdir(parents=True)
    
    # Create manifest
    manifest = {
        "id": plugin_id,
        "name": name,
        "version": "1.0.0",
        "description": f"{name} plugin",
        "author": "",
        "capabilities": ["hooks", "tools"],
    }
    
    with open(plugin_dir / "manifest.json", 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    
    # Create plugin.py template
    plugin_code = f'''"""
{name} Plugin
"""

def init(config):
    """Initialize the plugin."""
    print(f"Initializing {name} plugin")


def register_hooks(config):
    """Register plugin hooks."""
    return [
        # Example hook:
        # {{
        #     "hook": "before_agent_start",
        #     "handler": my_hook_handler,
        #     "priority": 0,
        # }}
    ]


def register_tools(config):
    """Register plugin tools."""
    return [
        # Example tool:
        # {{
        #     "name": "my_tool",
        #     "description": "My custom tool",
        #     "handler": my_tool_handler,
        #     "schema": {{"type": "object", "properties": {{}}}},
        # }}
    ]
'''
    
    with open(plugin_dir / "plugin.py", 'w', encoding='utf-8') as f:
        f.write(plugin_code)
    
    # Create empty config
    with open(plugin_dir / "config.json", 'w', encoding='utf-8') as f:
        json.dump({}, f, indent=2)
    
    logger.info(f"Created plugin template: {plugin_dir}")
    return plugin_dir
