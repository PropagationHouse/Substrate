"""
Substrate Tools Module
==================
Tool system for full computer access.

Core (always available — zero heavy deps):
- exec_tool: Execute shell commands with PTY support
- file_tool: Read, write, edit files
- grep_tool: Search file contents
- tool_registry: Central tool registration and dispatch

On-demand (loaded dynamically via tool_registry when keywords match):
- browser, desktop, screen, mouse, pdf, memory, obsidian, etc.

IMPORTANT: Only import modules here that have NO heavy dependencies
(no pyautogui, win32gui, psutil, pywinauto, etc). Fragile imports
here will cause TOOLS_AVAILABLE=False in proxy_server.py, silently
disabling the entire tool system.
"""

from .exec_tool import ExecTool, exec_command
from .file_tool import FileTool, read_file, write_file, edit_file
from .tool_registry import ToolRegistry, get_tool_registry, load_contextual_tools

__all__ = [
    'ExecTool',
    'exec_command',
    'FileTool',
    'read_file',
    'write_file',
    'edit_file',
    'ToolRegistry',
    'get_tool_registry',
    'load_contextual_tools',
]
