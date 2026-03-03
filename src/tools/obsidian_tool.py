"""
Obsidian Tool - Enhanced Vault Management
==========================================
Advanced Obsidian vault operations including:
- Daily notes
- Backlink analysis
- Tag management
- Dataview-style queries
- Graph neighbors (linked notes)
"""

import os
import re
import logging
from typing import Dict, Any, Optional, List, Set
from datetime import datetime, date
from pathlib import Path

logger = logging.getLogger(__name__)

# Default vault location
DEFAULT_VAULT = os.path.expandvars(r"%USERPROFILE%\Documents\Obsidian\Notes")


def _get_configured_vault() -> str:
    """Read vault_path from custom_settings.json, falling back to DEFAULT_VAULT."""
    try:
        settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'custom_settings.json')
        if os.path.isfile(settings_path):
            import json
            with open(settings_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            configured = cfg.get('vault_path', '').strip()
            if configured:
                return configured
    except Exception:
        pass
    return DEFAULT_VAULT


def _get_vault_path(vault_path: Optional[str] = None) -> str:
    """Get vault path, using configured path or default if not specified."""
    return vault_path or _get_configured_vault()


def _ensure_vault_exists(vault_path: str) -> bool:
    """Ensure vault directory exists."""
    if not os.path.exists(vault_path):
        os.makedirs(vault_path, exist_ok=True)
    return os.path.isdir(vault_path)


def _extract_wikilinks(content: str) -> List[str]:
    """Extract [[wikilinks]] from content."""
    pattern = r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]'
    return re.findall(pattern, content)


def _extract_tags(content: str) -> List[str]:
    """Extract #tags from content."""
    pattern = r'(?:^|\s)#([a-zA-Z0-9_/]+)'
    return list(set(re.findall(pattern, content)))


def _get_frontmatter(content: str) -> Dict[str, Any]:
    """Extract YAML frontmatter from note."""
    if not content.startswith('---'):
        return {}
    
    try:
        end = content.find('---', 3)
        if end == -1:
            return {}
        
        frontmatter_text = content[3:end].strip()
        # Simple YAML parsing (key: value)
        result = {}
        for line in frontmatter_text.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                result[key.strip()] = value.strip()
        return result
    except Exception:
        return {}


def daily_note(
    vault_path: Optional[str] = None,
    date_str: Optional[str] = None,
    template: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create or open today's daily note.
    
    Args:
        vault_path: Path to Obsidian vault
        date_str: Optional date string (YYYY-MM-DD), defaults to today
        template: Optional template content
        
    Returns:
        Dict with daily note info
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    # Determine date
    if date_str:
        try:
            note_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return {"status": "error", "error": f"Invalid date format: {date_str}. Use YYYY-MM-DD"}
    else:
        note_date = date.today()
    
    # Create daily notes folder if needed
    daily_folder = os.path.join(vault, "Daily Notes")
    os.makedirs(daily_folder, exist_ok=True)
    
    # Note filename
    filename = note_date.strftime("%Y-%m-%d") + ".md"
    filepath = os.path.join(daily_folder, filename)
    
    # Check if note exists
    exists = os.path.exists(filepath)
    
    if not exists:
        # Create new daily note
        if template:
            content = template
        else:
            weekday = note_date.strftime("%A")
            content = f"""# {note_date.strftime("%B %d, %Y")} - {weekday}

## Tasks
- [ ] 

## Notes


## Log


#daily-note #{note_date.strftime("%Y/%m")}
"""
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return {
            "status": "success",
            "action": "created",
            "path": filepath,
            "date": str(note_date),
            "message": f"Created daily note for {note_date}"
        }
    else:
        # Read existing note
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return {
            "status": "success",
            "action": "opened",
            "path": filepath,
            "date": str(note_date),
            "content": content,
            "message": f"Daily note exists for {note_date}"
        }


def find_backlinks(
    note_name: str,
    vault_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Find all notes that link to a given note.
    
    Args:
        note_name: Name of the note to find backlinks for
        vault_path: Path to Obsidian vault
        
    Returns:
        Dict with backlinks
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    # Normalize note name (remove .md if present)
    note_name = note_name.replace('.md', '')
    
    backlinks = []
    
    for root, dirs, files in os.walk(vault):
        for file in files:
            if file.endswith('.md'):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # Check for wikilinks to this note
                    links = _extract_wikilinks(content)
                    if note_name in links or note_name.lower() in [l.lower() for l in links]:
                        rel_path = os.path.relpath(filepath, vault)
                        backlinks.append({
                            "note": file.replace('.md', ''),
                            "path": rel_path,
                            "full_path": filepath
                        })
                except Exception as e:
                    logger.debug(f"Error reading {filepath}: {e}")
    
    return {
        "status": "success",
        "note": note_name,
        "backlink_count": len(backlinks),
        "backlinks": backlinks
    }


def list_tags(vault_path: Optional[str] = None) -> Dict[str, Any]:
    """
    List all tags used in the vault.
    
    Args:
        vault_path: Path to Obsidian vault
        
    Returns:
        Dict with all tags and their counts
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    tag_counts: Dict[str, int] = {}
    
    for root, dirs, files in os.walk(vault):
        for file in files:
            if file.endswith('.md'):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    tags = _extract_tags(content)
                    for tag in tags:
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1
                except Exception:
                    pass
    
    # Sort by count
    sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
    
    return {
        "status": "success",
        "total_tags": len(sorted_tags),
        "tags": [{"tag": t, "count": c} for t, c in sorted_tags]
    }


def find_by_tag(
    tag: str,
    vault_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Find all notes with a specific tag.
    
    Args:
        tag: Tag to search for (without #)
        vault_path: Path to Obsidian vault
        
    Returns:
        Dict with matching notes
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    # Remove # if present
    tag = tag.lstrip('#')
    
    matches = []
    
    for root, dirs, files in os.walk(vault):
        for file in files:
            if file.endswith('.md'):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    tags = _extract_tags(content)
                    if tag in tags or tag.lower() in [t.lower() for t in tags]:
                        rel_path = os.path.relpath(filepath, vault)
                        matches.append({
                            "note": file.replace('.md', ''),
                            "path": rel_path,
                            "full_path": filepath,
                            "all_tags": tags
                        })
                except Exception:
                    pass
    
    return {
        "status": "success",
        "tag": tag,
        "count": len(matches),
        "notes": matches
    }


def graph_neighbors(
    note_name: str,
    vault_path: Optional[str] = None,
    depth: int = 1
) -> Dict[str, Any]:
    """
    Get linked notes (graph neighbors) for a note.
    
    Args:
        note_name: Name of the note
        vault_path: Path to Obsidian vault
        depth: How many hops to traverse (1 = direct links only)
        
    Returns:
        Dict with linked notes
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    note_name = note_name.replace('.md', '')
    
    # Find the note file
    note_path = None
    for root, dirs, files in os.walk(vault):
        for file in files:
            if file.replace('.md', '').lower() == note_name.lower():
                note_path = os.path.join(root, file)
                break
        if note_path:
            break
    
    if not note_path:
        return {"status": "error", "error": f"Note not found: {note_name}"}
    
    # Read note and extract outgoing links
    with open(note_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    outgoing_links = _extract_wikilinks(content)
    
    # Get backlinks (incoming links)
    backlinks_result = find_backlinks(note_name, vault_path)
    incoming_links = [b["note"] for b in backlinks_result.get("backlinks", [])]
    
    return {
        "status": "success",
        "note": note_name,
        "outgoing_links": outgoing_links,
        "outgoing_count": len(outgoing_links),
        "incoming_links": incoming_links,
        "incoming_count": len(incoming_links),
        "total_connections": len(set(outgoing_links + incoming_links))
    }


def search_content(
    query: str,
    vault_path: Optional[str] = None,
    case_sensitive: bool = False,
    limit: int = 20
) -> Dict[str, Any]:
    """
    Search for text across all notes.
    
    Args:
        query: Search term
        vault_path: Path to Obsidian vault
        case_sensitive: Case-sensitive search
        limit: Maximum results
        
    Returns:
        Dict with search results
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    results = []
    search_query = query if case_sensitive else query.lower()
    
    for root, dirs, files in os.walk(vault):
        for file in files:
            if file.endswith('.md') and len(results) < limit:
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    search_content = content if case_sensitive else content.lower()
                    
                    if search_query in search_content:
                        # Get context around first match
                        pos = search_content.find(search_query)
                        start = max(0, pos - 50)
                        end = min(len(content), pos + len(query) + 50)
                        context = content[start:end]
                        
                        rel_path = os.path.relpath(filepath, vault)
                        results.append({
                            "note": file.replace('.md', ''),
                            "path": rel_path,
                            "context": f"...{context}...",
                            "full_path": filepath
                        })
                except Exception:
                    pass
    
    return {
        "status": "success",
        "query": query,
        "count": len(results),
        "results": results
    }


def list_recent(
    vault_path: Optional[str] = None,
    limit: int = 10
) -> Dict[str, Any]:
    """
    List recently modified notes.
    
    Args:
        vault_path: Path to Obsidian vault
        limit: Maximum notes to return
        
    Returns:
        Dict with recent notes
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    notes = []
    
    for root, dirs, files in os.walk(vault):
        for file in files:
            if file.endswith('.md'):
                filepath = os.path.join(root, file)
                try:
                    mtime = os.path.getmtime(filepath)
                    rel_path = os.path.relpath(filepath, vault)
                    notes.append({
                        "note": file.replace('.md', ''),
                        "path": rel_path,
                        "modified": datetime.fromtimestamp(mtime).isoformat(),
                        "full_path": filepath
                    })
                except Exception:
                    pass
    
    # Sort by modification time
    notes.sort(key=lambda x: x["modified"], reverse=True)
    
    return {
        "status": "success",
        "count": len(notes[:limit]),
        "total_notes": len(notes),
        "notes": notes[:limit]
    }


def create_note(
    title: str,
    content: str,
    vault_path: Optional[str] = None,
    folder: Optional[str] = None,
    tags: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Create a new note in the vault.
    
    Args:
        title: Note title (becomes filename)
        content: Note content
        vault_path: Path to Obsidian vault
        folder: Optional subfolder
        tags: Optional list of tags to add
        
    Returns:
        Dict with created note info
    """
    vault = _get_vault_path(vault_path)
    if not _ensure_vault_exists(vault):
        return {"status": "error", "error": f"Vault not found: {vault}"}
    
    # Sanitize title for filename
    safe_title = re.sub(r'[*"\\/<>:|?]', '', title)
    
    # Determine folder
    if folder:
        target_folder = os.path.join(vault, folder)
        os.makedirs(target_folder, exist_ok=True)
    else:
        target_folder = vault
    
    filepath = os.path.join(target_folder, f"{safe_title}.md")
    
    # Build content
    full_content = f"# {title}\n\n{content}"
    
    if tags:
        tag_str = ' '.join([f"#{t}" for t in tags])
        full_content += f"\n\n{tag_str}"
    
    # Write file
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(full_content)
    
    return {
        "status": "success",
        "title": title,
        "path": os.path.relpath(filepath, vault),
        "full_path": filepath,
        "message": f"Created note: {title}"
    }


# Tool definitions for registry
OBSIDIAN_TOOLS = {
    "obsidian_daily_note": {
        "function": daily_note,
        "description": "Create or open today's daily note in Obsidian",
        "parameters": {
            "type": "object",
            "properties": {
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"},
                "date_str": {"type": "string", "description": "Date in YYYY-MM-DD format (optional, defaults to today)"},
                "template": {"type": "string", "description": "Custom template content (optional)"}
            }
        }
    },
    "obsidian_backlinks": {
        "function": find_backlinks,
        "description": "Find all notes that link to a given note",
        "parameters": {
            "type": "object",
            "properties": {
                "note_name": {"type": "string", "description": "Name of the note to find backlinks for"},
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"}
            },
            "required": ["note_name"]
        }
    },
    "obsidian_list_tags": {
        "function": list_tags,
        "description": "List all tags used in the Obsidian vault with counts",
        "parameters": {
            "type": "object",
            "properties": {
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"}
            }
        }
    },
    "obsidian_find_by_tag": {
        "function": find_by_tag,
        "description": "Find all notes with a specific tag",
        "parameters": {
            "type": "object",
            "properties": {
                "tag": {"type": "string", "description": "Tag to search for (without #)"},
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"}
            },
            "required": ["tag"]
        }
    },
    "obsidian_graph_neighbors": {
        "function": graph_neighbors,
        "description": "Get linked notes (incoming and outgoing links) for a note",
        "parameters": {
            "type": "object",
            "properties": {
                "note_name": {"type": "string", "description": "Name of the note"},
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"}
            },
            "required": ["note_name"]
        }
    },
    "obsidian_search": {
        "function": search_content,
        "description": "Search for text across all notes in the vault",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term"},
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"},
                "case_sensitive": {"type": "boolean", "description": "Case-sensitive search", "default": False},
                "limit": {"type": "integer", "description": "Maximum results", "default": 20}
            },
            "required": ["query"]
        }
    },
    "obsidian_recent": {
        "function": list_recent,
        "description": "List recently modified notes",
        "parameters": {
            "type": "object",
            "properties": {
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"},
                "limit": {"type": "integer", "description": "Maximum notes to return", "default": 10}
            }
        }
    },
    "obsidian_create_note": {
        "function": create_note,
        "description": "Create a new note in the Obsidian vault",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Note title (becomes filename)"},
                "content": {"type": "string", "description": "Note content"},
                "vault_path": {"type": "string", "description": "Path to Obsidian vault (optional)"},
                "folder": {"type": "string", "description": "Subfolder to create note in (optional)"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to add (optional)"}
            },
            "required": ["title", "content"]
        }
    }
}
