"""
File Tool - Read, write, and edit files
========================================
Features:
- Read files with line number support
- Write new files
- Edit existing files (find/replace)
- List directory contents
- File info (size, modified, etc.)
"""

import os
import re
import hashlib
import logging
import shutil
from typing import Dict, Any, Optional, List
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

# Security: Paths that should never be modified
PROTECTED_PATHS = [
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/boot",
]

# Maximum file size to read (10MB)
MAX_READ_SIZE = 10 * 1024 * 1024

# Maximum file size to write (50MB)
MAX_WRITE_SIZE = 50 * 1024 * 1024


def _is_protected_path(path: str) -> bool:
    """Check if a path is protected from modification."""
    abs_path = os.path.abspath(path).lower()
    for protected in PROTECTED_PATHS:
        if abs_path.startswith(protected.lower()):
            return True
    return False


# Soma — the agent's own codebase / project root
SOMA = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def _resolve_path(path: str, base_dir: Optional[str] = None) -> str:
    """Resolve a path, expanding ~ and making absolute.
    Relative paths resolve from SOMA (project root)."""
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        if base_dir:
            path = os.path.join(base_dir, path)
        else:
            path = os.path.join(SOMA, path)
    return os.path.abspath(path)


def read_file(
    path: str,
    start_line: Optional[int] = None,
    end_line: Optional[int] = None,
    encoding: str = "utf-8",
    base_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Read a file's contents.
    
    Args:
        path: Path to the file
        start_line: Starting line number (1-indexed, optional)
        end_line: Ending line number (inclusive, optional)
        encoding: File encoding (default: utf-8)
        base_dir: Base directory for relative paths
        
    Returns:
        Dict with file contents and metadata
    """
    try:
        full_path = _resolve_path(path, base_dir)
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "error": f"File not found: {path}",
            }
        
        if not os.path.isfile(full_path):
            return {
                "status": "error",
                "error": f"Not a file: {path}",
            }
        
        # Check file size
        file_size = os.path.getsize(full_path)
        if file_size > MAX_READ_SIZE:
            return {
                "status": "error",
                "error": f"File too large ({file_size} bytes). Max: {MAX_READ_SIZE} bytes",
            }
        
        # Read file
        try:
            with open(full_path, 'r', encoding=encoding, errors='replace') as f:
                lines = f.readlines()
        except UnicodeDecodeError:
            # Try binary read for non-text files
            with open(full_path, 'rb') as f:
                content = f.read()
            return {
                "status": "success",
                "path": full_path,
                "content": f"[Binary file, {len(content)} bytes]",
                "is_binary": True,
                "size": len(content),
            }
        
        total_lines = len(lines)
        
        # Apply line range
        if start_line is not None or end_line is not None:
            start = (start_line or 1) - 1  # Convert to 0-indexed
            end = end_line or total_lines
            start = max(0, start)
            end = min(total_lines, end)
            selected_lines = lines[start:end]
            
            # Add line numbers
            numbered_content = ""
            for i, line in enumerate(selected_lines, start=start + 1):
                numbered_content += f"{i:6d}\t{line}"
            
            return {
                "status": "success",
                "path": full_path,
                "content": numbered_content,
                "start_line": start + 1,
                "end_line": end,
                "total_lines": total_lines,
                "size": file_size,
            }
        else:
            content = ''.join(lines)
            return {
                "status": "success",
                "path": full_path,
                "content": content,
                "total_lines": total_lines,
                "size": file_size,
            }
            
    except Exception as e:
        logger.error(f"Error reading file {path}: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def write_file(
    path: str,
    content: str,
    encoding: str = "utf-8",
    create_dirs: bool = True,
    overwrite: bool = False,
    base_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Write content to a file.
    
    Args:
        path: Path to the file
        content: Content to write
        encoding: File encoding (default: utf-8)
        create_dirs: Create parent directories if needed
        overwrite: Allow overwriting existing files
        base_dir: Base directory for relative paths
        
    Returns:
        Dict with result
    """
    try:
        full_path = _resolve_path(path, base_dir)
        
        # Security check
        if _is_protected_path(full_path):
            return {
                "status": "error",
                "error": f"Cannot write to protected path: {path}",
            }
        
        # Check content size
        content_bytes = content.encode(encoding)
        if len(content_bytes) > MAX_WRITE_SIZE:
            return {
                "status": "error",
                "error": f"Content too large ({len(content_bytes)} bytes). Max: {MAX_WRITE_SIZE} bytes",
            }
        
        # Check if file exists
        if os.path.exists(full_path) and not overwrite:
            return {
                "status": "error",
                "error": f"File already exists: {path}. Use overwrite=True to replace.",
            }
        
        # Create directories if needed
        parent_dir = os.path.dirname(full_path)
        if create_dirs and parent_dir and not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)
        
        # Write file
        with open(full_path, 'w', encoding=encoding) as f:
            f.write(content)
        
        return {
            "status": "success",
            "path": full_path,
            "size": len(content_bytes),
            "message": f"File written: {path}",
        }
        
    except Exception as e:
        logger.error(f"Error writing file {path}: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def edit_file(
    path: str,
    old_string: str,
    new_string: str,
    encoding: str = "utf-8",
    replace_all: bool = False,
    base_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Edit a file by replacing text.
    
    Args:
        path: Path to the file
        old_string: Text to find
        new_string: Text to replace with
        encoding: File encoding (default: utf-8)
        replace_all: Replace all occurrences (default: first only)
        base_dir: Base directory for relative paths
        
    Returns:
        Dict with result
    """
    try:
        full_path = _resolve_path(path, base_dir)
        
        # Security check
        if _is_protected_path(full_path):
            return {
                "status": "error",
                "error": f"Cannot edit protected path: {path}",
            }
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "error": f"File not found: {path}",
            }
        
        # Read current content
        with open(full_path, 'r', encoding=encoding) as f:
            content = f.read()
        
        # Check if old_string exists
        if old_string not in content:
            return {
                "status": "error",
                "error": f"String not found in file: {old_string[:50]}...",
            }
        
        # Check for uniqueness if not replace_all
        if not replace_all and content.count(old_string) > 1:
            return {
                "status": "error",
                "error": f"String appears {content.count(old_string)} times. Use replace_all=True or provide more context.",
            }
        
        # Perform replacement
        if replace_all:
            new_content = content.replace(old_string, new_string)
            replacements = content.count(old_string)
        else:
            new_content = content.replace(old_string, new_string, 1)
            replacements = 1
        
        # Write back
        with open(full_path, 'w', encoding=encoding) as f:
            f.write(new_content)
        
        # Build a short diff preview (2 lines of context around first replacement)
        snippet = ""
        try:
            new_lines = new_content.splitlines()
            # Find the first line containing the new_string
            target_line = None
            for i, line in enumerate(new_lines):
                if new_string and new_string.splitlines()[0] in line:
                    target_line = i
                    break
            if target_line is not None:
                start = max(0, target_line - 2)
                end = min(len(new_lines), target_line + len(new_string.splitlines()) + 2)
                snippet = "\n".join(f"{start + j + 1}: {new_lines[start + j]}" for j in range(end - start))
        except Exception:
            pass
        
        result = {
            "status": "success",
            "path": full_path,
            "replacements": replacements,
            "message": f"Made {replacements} replacement(s) in {path}",
        }
        if snippet:
            result["snippet"] = snippet
        return result
        
    except Exception as e:
        logger.error(f"Error editing file {path}: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def list_directory(
    path: str,
    recursive: bool = False,
    max_depth: int = 3,
    pattern: Optional[str] = None,
    base_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    List directory contents.
    
    Args:
        path: Path to the directory
        recursive: List recursively
        max_depth: Maximum recursion depth
        pattern: Glob pattern to filter files
        base_dir: Base directory for relative paths
        
    Returns:
        Dict with directory listing
    """
    try:
        full_path = _resolve_path(path, base_dir)
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "error": f"Path not found: {path}",
            }
        
        if not os.path.isdir(full_path):
            return {
                "status": "error",
                "error": f"Not a directory: {path}",
            }
        
        items = []
        
        def scan_dir(dir_path: str, depth: int = 0):
            if depth > max_depth:
                return
            
            try:
                for entry in os.scandir(dir_path):
                    try:
                        rel_path = os.path.relpath(entry.path, full_path)
                        
                        # Apply pattern filter
                        if pattern:
                            import fnmatch
                            if not fnmatch.fnmatch(entry.name, pattern):
                                if not entry.is_dir():
                                    continue
                        
                        stat = entry.stat()
                        item = {
                            "name": entry.name,
                            "path": rel_path,
                            "type": "directory" if entry.is_dir() else "file",
                            "size": stat.st_size if entry.is_file() else None,
                            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        }
                        items.append(item)
                        
                        if recursive and entry.is_dir():
                            scan_dir(entry.path, depth + 1)
                            
                    except (PermissionError, OSError):
                        continue
                        
            except PermissionError:
                pass
        
        scan_dir(full_path)
        
        # Sort: directories first, then by name
        items.sort(key=lambda x: (x["type"] != "directory", x["name"].lower()))
        
        return {
            "status": "success",
            "path": full_path,
            "items": items[:500],  # Limit results
            "total": len(items),
            "truncated": len(items) > 500,
        }
        
    except Exception as e:
        logger.error(f"Error listing directory {path}: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def file_info(path: str, base_dir: Optional[str] = None) -> Dict[str, Any]:
    """Get detailed information about a file or directory."""
    try:
        full_path = _resolve_path(path, base_dir)
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "error": f"Path not found: {path}",
            }
        
        stat = os.stat(full_path)
        
        info = {
            "status": "success",
            "path": full_path,
            "name": os.path.basename(full_path),
            "type": "directory" if os.path.isdir(full_path) else "file",
            "size": stat.st_size,
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "accessed": datetime.fromtimestamp(stat.st_atime).isoformat(),
        }
        
        if os.path.isfile(full_path):
            # Add file-specific info
            _, ext = os.path.splitext(full_path)
            info["extension"] = ext.lower()
            
            # Calculate hash for small files
            if stat.st_size < 1024 * 1024:  # 1MB
                with open(full_path, 'rb') as f:
                    info["md5"] = hashlib.md5(f.read()).hexdigest()
        
        return info
        
    except Exception as e:
        logger.error(f"Error getting file info {path}: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


class FileTool:
    """
    File tool for LLM function calling.
    """
    
    name = "file"
    description = "Read, write, and edit files on the system"
    
    @staticmethod
    def read(path: str, start_line: int = None, end_line: int = None) -> Dict[str, Any]:
        return read_file(path, start_line, end_line)
    
    @staticmethod
    def write(path: str, content: str, overwrite: bool = False) -> Dict[str, Any]:
        return write_file(path, content, overwrite=overwrite)
    
    @staticmethod
    def edit(path: str, old_string: str, new_string: str, replace_all: bool = False) -> Dict[str, Any]:
        return edit_file(path, old_string, new_string, replace_all=replace_all)
    
    @staticmethod
    def list(path: str, recursive: bool = False, pattern: str = None) -> Dict[str, Any]:
        return list_directory(path, recursive=recursive, pattern=pattern)
    
    @staticmethod
    def info(path: str) -> Dict[str, Any]:
        return file_info(path)
