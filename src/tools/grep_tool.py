"""
Grep Tool - Search file contents with regex or literal patterns
================================================================
Provides fast codebase navigation without reading entire files.
Supports regex and literal string search, file glob filtering,
and context lines around matches.

This tool saves significant tokens by letting the agent find
exactly which files and lines are relevant before reading them.
"""

import os
import re
import fnmatch
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Default workspace directory
WORKSPACE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'workspace')

# Soma (project root)
SOMA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Directories to always skip
SKIP_DIRS = {
    '__pycache__', '.git', 'node_modules', '.venv', 'venv',
    '.mypy_cache', '.pytest_cache', 'dist', 'build', '.eggs',
    'electron', '.next', '.nuxt',
}

# Binary file extensions to skip
BINARY_EXTENSIONS = {
    '.pyc', '.pyo', '.so', '.dll', '.exe', '.bin', '.dat',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flac',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.sqlite', '.db', '.pickle', '.pkl',
}

# Max file size to search (2MB)
MAX_FILE_SIZE = 2 * 1024 * 1024

# Max total matches to return
MAX_MATCHES = 100

# Max files to scan
MAX_FILES = 5000


def _resolve_search_path(path: str) -> str:
    """Resolve search path, defaulting relative paths to project root."""
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        # Default '.' and empty to project root
        if path in ('.', ''):
            return SOMA
        # Try project root first, then workspace
        proj_path = os.path.join(SOMA, path)
        if os.path.exists(proj_path):
            return os.path.abspath(proj_path)
        ws_path = os.path.join(WORKSPACE_DIR, path)
        if os.path.exists(ws_path):
            return os.path.abspath(ws_path)
        return os.path.abspath(proj_path)  # Fall back to project root
    return os.path.abspath(path)


def _should_skip_file(filepath: str, includes: Optional[List[str]] = None) -> bool:
    """Check if a file should be skipped."""
    _, ext = os.path.splitext(filepath)
    if ext.lower() in BINARY_EXTENSIONS:
        return True
    
    # Apply include filters
    if includes:
        basename = os.path.basename(filepath)
        if not any(fnmatch.fnmatch(basename, pat) for pat in includes):
            return False  # Will be filtered out
    
    return False


def _collect_files(
    search_path: str,
    includes: Optional[List[str]] = None,
    max_depth: int = 10,
) -> List[str]:
    """Collect files to search, respecting filters."""
    files = []
    
    if os.path.isfile(search_path):
        return [search_path]
    
    if not os.path.isdir(search_path):
        return []
    
    file_count = 0
    for root, dirs, filenames in os.walk(search_path):
        # Skip hidden and known dirs
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        
        # Check depth
        depth = root.replace(search_path, '').count(os.sep)
        if depth >= max_depth:
            dirs.clear()
            continue
        
        for fname in filenames:
            if file_count >= MAX_FILES:
                break
            
            filepath = os.path.join(root, fname)
            _, ext = os.path.splitext(fname)
            
            # Skip binary files
            if ext.lower() in BINARY_EXTENSIONS:
                continue
            
            # Skip large files
            try:
                if os.path.getsize(filepath) > MAX_FILE_SIZE:
                    continue
            except OSError:
                continue
            
            # Apply include glob filters
            if includes:
                if not any(fnmatch.fnmatch(fname, pat) for pat in includes):
                    continue
            
            files.append(filepath)
            file_count += 1
        
        if file_count >= MAX_FILES:
            break
    
    return files


def grep(
    query: str,
    path: str = ".",
    includes: Optional[List[str]] = None,
    fixed_strings: bool = False,
    case_sensitive: bool = False,
    context_lines: int = 0,
    max_results: int = 50,
) -> Dict[str, Any]:
    """
    Search file contents for a pattern.
    
    Args:
        query: Search pattern (regex by default, or literal if fixed_strings=True)
        path: Directory or file to search (relative to project root or absolute)
        includes: Glob patterns to filter files (e.g. ["*.py", "*.js"])
        fixed_strings: If True, treat query as literal string (no regex)
        case_sensitive: If True, case-sensitive search (default: case-insensitive)
        context_lines: Number of context lines before/after each match (0-5)
        max_results: Maximum number of matches to return (default 50, max 100)
        
    Returns:
        Dict with matches grouped by file, including line numbers and content
    """
    try:
        search_path = _resolve_search_path(path)
        
        if not os.path.exists(search_path):
            return {
                "status": "error",
                "error": f"Path not found: {path}",
            }
        
        # Compile regex
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            if fixed_strings:
                pattern = re.compile(re.escape(query), flags)
            else:
                pattern = re.compile(query, flags)
        except re.error as e:
            return {
                "status": "error",
                "error": f"Invalid regex pattern: {e}",
            }
        
        # Clamp parameters
        context_lines = max(0, min(5, context_lines))
        max_results = max(1, min(MAX_MATCHES, max_results))
        
        # Collect files
        files = _collect_files(search_path, includes)
        
        if not files:
            return {
                "status": "success",
                "matches": [],
                "total_matches": 0,
                "files_searched": 0,
                "message": "No files found matching criteria",
            }
        
        # Search files
        all_matches = []
        files_with_matches = set()
        total_match_count = 0
        
        for filepath in files:
            if total_match_count >= max_results:
                break
            
            try:
                with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                    lines = f.readlines()
            except (OSError, UnicodeDecodeError):
                continue
            
            file_matches = []
            for line_num, line in enumerate(lines, 1):
                if pattern.search(line):
                    file_matches.append((line_num, line.rstrip('\n\r')))
            
            if not file_matches:
                continue
            
            files_with_matches.add(filepath)
            
            # Make path relative to search_path for cleaner output
            try:
                rel_path = os.path.relpath(filepath, search_path)
            except ValueError:
                rel_path = filepath
            
            for line_num, line_text in file_matches:
                if total_match_count >= max_results:
                    break
                
                match_entry = {
                    "file": rel_path,
                    "line": line_num,
                    "text": line_text[:500],  # Truncate very long lines
                }
                
                # Add context lines if requested
                if context_lines > 0:
                    ctx_before = []
                    ctx_after = []
                    for i in range(max(0, line_num - 1 - context_lines), line_num - 1):
                        ctx_before.append(f"{i+1}: {lines[i].rstrip()[:300]}")
                    for i in range(line_num, min(len(lines), line_num + context_lines)):
                        ctx_after.append(f"{i+1}: {lines[i].rstrip()[:300]}")
                    if ctx_before:
                        match_entry["before"] = ctx_before
                    if ctx_after:
                        match_entry["after"] = ctx_after
                
                all_matches.append(match_entry)
                total_match_count += 1
        
        # Build compact output
        result = {
            "status": "success",
            "query": query,
            "path": search_path,
            "matches": all_matches,
            "total_matches": total_match_count,
            "files_with_matches": len(files_with_matches),
            "files_searched": len(files),
        }
        
        if total_match_count >= max_results:
            result["truncated"] = True
            result["message"] = f"Results capped at {max_results}. Use includes or a more specific query to narrow down."
        
        return result
        
    except Exception as e:
        logger.error(f"Error in grep: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def find_files(
    pattern: str = "*",
    path: str = ".",
    file_type: str = "any",
    max_depth: int = 5,
    max_results: int = 50,
) -> Dict[str, Any]:
    """
    Find files and directories by name pattern.
    
    Args:
        pattern: Glob pattern to match filenames (e.g. "*.py", "test_*")
        path: Directory to search (relative to project root or absolute)
        file_type: Filter by type: "file", "directory", or "any"
        max_depth: Maximum directory depth to search
        max_results: Maximum results to return
        
    Returns:
        Dict with matching file/directory paths and metadata
    """
    try:
        search_path = _resolve_search_path(path)
        
        if not os.path.exists(search_path):
            return {
                "status": "error",
                "error": f"Path not found: {path}",
            }
        
        if not os.path.isdir(search_path):
            return {
                "status": "error",
                "error": f"Not a directory: {path}",
            }
        
        results = []
        count = 0
        
        for root, dirs, files in os.walk(search_path):
            # Skip hidden and known dirs
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
            
            depth = root.replace(search_path, '').count(os.sep)
            if depth >= max_depth:
                dirs.clear()
                continue
            
            # Check directories
            if file_type in ("directory", "any"):
                for d in dirs:
                    if count >= max_results:
                        break
                    if fnmatch.fnmatch(d, pattern):
                        rel = os.path.relpath(os.path.join(root, d), search_path)
                        results.append({"path": rel, "type": "directory"})
                        count += 1
            
            # Check files
            if file_type in ("file", "any"):
                for f in files:
                    if count >= max_results:
                        break
                    if fnmatch.fnmatch(f, pattern):
                        filepath = os.path.join(root, f)
                        rel = os.path.relpath(filepath, search_path)
                        try:
                            size = os.path.getsize(filepath)
                        except OSError:
                            size = 0
                        results.append({"path": rel, "type": "file", "size": size})
                        count += 1
            
            if count >= max_results:
                break
        
        return {
            "status": "success",
            "path": search_path,
            "pattern": pattern,
            "results": results,
            "total": len(results),
            "truncated": len(results) >= max_results,
        }
        
    except Exception as e:
        logger.error(f"Error in find_files: {e}")
        return {
            "status": "error",
            "error": str(e),
        }
