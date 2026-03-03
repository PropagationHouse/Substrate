"""
Memory Tool - Memory search and retrieval.

Provides:
- memory_search: Semantic search across memory/notes
- memory_get: Read specific lines from memory files
"""

import os
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)

# Soma (project root) and memory directories
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
MEMORY_DIR = DATA_DIR / "memory"
NOTES_DIR = SOMA / "notes"


def memory_search(
    query: str,
    max_results: int = 5,
    min_score: float = 0.0,
    session_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Semantic search across memory files.
    
    Args:
        query: Search query
        max_results: Maximum results to return
        min_score: Minimum relevance score (0-1)
        session_key: Optional session to search within
        
    Returns:
        Search results with snippets and citations
    """
    try:
        # Import unified memory for search
        from src.memory.unified_memory import get_unified_memory
        
        memory = get_unified_memory()
        results = memory.search_hybrid(query=query, limit=max_results)
        
        # Format results with citations
        formatted = []
        for r in results:
            score = r.get('final_score', r.get('score', 0))
            if score < min_score:
                continue
                
            formatted.append({
                'snippet': r.get('user_message', '')[:500] + '\n' + r.get('assistant_response', '')[:500],
                'score': score,
                'type': r.get('type', 'chat'),
                'timestamp': r.get('timestamp'),
                'citation': f"memory:{r.get('id', 'unknown')}",
            })
        
        return {
            'status': 'success',
            'results': formatted,
            'total': len(formatted),
            'query': query,
        }
        
    except Exception as e:
        logger.error(f"Memory search error: {e}")
        return {
            'status': 'error',
            'error': str(e),
            'results': [],
        }


def memory_get(
    path: str,
    from_line: Optional[int] = None,
    lines: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Read specific lines from a memory/notes file.
    
    Args:
        path: Relative path to file (e.g., "notes/todo.md", "memory/context.md")
        from_line: Starting line number (1-indexed)
        lines: Number of lines to read
        
    Returns:
        File content with line numbers
    """
    try:
        # Resolve path - check multiple locations
        resolved_path = None
        
        # Try relative to base dir
        candidate = BASE_DIR / path
        if candidate.exists():
            resolved_path = candidate
        
        # Try in notes dir
        if not resolved_path:
            candidate = NOTES_DIR / path
            if candidate.exists():
                resolved_path = candidate
        
        # Try in memory dir
        if not resolved_path:
            candidate = MEMORY_DIR / path
            if candidate.exists():
                resolved_path = candidate
        
        # Try in data dir
        if not resolved_path:
            candidate = DATA_DIR / path
            if candidate.exists():
                resolved_path = candidate
        
        if not resolved_path:
            return {
                'status': 'error',
                'error': f'File not found: {path}',
                'path': path,
                'text': '',
            }
        
        # Security check - ensure within allowed directories
        resolved_abs = resolved_path.resolve()
        allowed_roots = [BASE_DIR.resolve(), DATA_DIR.resolve(), NOTES_DIR.resolve()]
        if not any(str(resolved_abs).startswith(str(root)) for root in allowed_roots):
            return {
                'status': 'error',
                'error': 'Access denied: path outside allowed directories',
                'path': path,
                'text': '',
            }
        
        # Read file
        with open(resolved_path, 'r', encoding='utf-8', errors='replace') as f:
            all_lines = f.readlines()
        
        total_lines = len(all_lines)
        
        # Apply line range
        start_idx = 0
        end_idx = total_lines
        
        if from_line is not None:
            start_idx = max(0, from_line - 1)  # Convert to 0-indexed
        
        if lines is not None:
            end_idx = min(total_lines, start_idx + lines)
        
        selected_lines = all_lines[start_idx:end_idx]
        
        # Format with line numbers
        numbered_lines = []
        for i, line in enumerate(selected_lines, start=start_idx + 1):
            numbered_lines.append(f"{i:4d} | {line.rstrip()}")
        
        text = '\n'.join(numbered_lines)
        
        return {
            'status': 'success',
            'path': str(resolved_path.relative_to(BASE_DIR)),
            'text': text,
            'startLine': start_idx + 1,
            'endLine': start_idx + len(selected_lines),
            'totalLines': total_lines,
        }
        
    except Exception as e:
        logger.error(f"Memory get error: {e}")
        return {
            'status': 'error',
            'error': str(e),
            'path': path,
            'text': '',
        }


def memory_list(
    directory: Optional[str] = None,
) -> Dict[str, Any]:
    """
    List available memory/notes files.
    
    Args:
        directory: Optional subdirectory to list
        
    Returns:
        List of available files
    """
    try:
        files = []
        
        # List notes
        if NOTES_DIR.exists():
            for f in NOTES_DIR.rglob('*'):
                if f.is_file() and not f.name.startswith('.'):
                    rel_path = f.relative_to(BASE_DIR)
                    files.append({
                        'path': str(rel_path),
                        'name': f.name,
                        'size': f.stat().st_size,
                        'type': 'note',
                    })
        
        # List memory files
        if MEMORY_DIR.exists():
            for f in MEMORY_DIR.rglob('*'):
                if f.is_file() and not f.name.startswith('.'):
                    rel_path = f.relative_to(BASE_DIR)
                    files.append({
                        'path': str(rel_path),
                        'name': f.name,
                        'size': f.stat().st_size,
                        'type': 'memory',
                    })
        
        # List skills
        skills_dir = BASE_DIR / "skills"
        if skills_dir.exists():
            for f in skills_dir.rglob('*.md'):
                if f.is_file():
                    rel_path = f.relative_to(BASE_DIR)
                    files.append({
                        'path': str(rel_path),
                        'name': f.name,
                        'size': f.stat().st_size,
                        'type': 'skill',
                    })
        
        # List consolidated memory summaries
        consolidated_dir = DATA_DIR / "consolidated"
        if consolidated_dir.exists():
            for f in consolidated_dir.rglob('*.md'):
                if f.is_file():
                    rel_path = f.relative_to(BASE_DIR)
                    files.append({
                        'path': str(rel_path),
                        'name': f.name,
                        'size': f.stat().st_size,
                        'type': 'consolidated',
                    })
        
        return {
            'status': 'success',
            'files': files,
            'total': len(files),
        }
        
    except Exception as e:
        logger.error(f"Memory list error: {e}")
        return {
            'status': 'error',
            'error': str(e),
            'files': [],
        }


# ============================================================================
# User Facts — persistent key-value store
# ============================================================================

USER_FACTS_PATH = DATA_DIR / "user_facts.md"


def memory_store_fact(
    key: str,
    value: str,
    **kwargs,
) -> Dict[str, Any]:
    """
    Store a persistent fact about the user (name, preferences, timezone, etc.).
    Facts survive across sessions and are always loaded into context.
    
    Args:
        key: Fact key (e.g., "Name", "Timezone", "Preference")
        value: Fact value
        
    Returns:
        Confirmation of stored fact
    """
    try:
        # Read existing facts
        lines = []
        if USER_FACTS_PATH.exists():
            with open(USER_FACTS_PATH, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        
        # Check if key already exists — update in place
        key_prefix = f"- {key}:"
        updated = False
        for i, line in enumerate(lines):
            if line.strip().startswith(key_prefix):
                lines[i] = f"- {key}: {value}\n"
                updated = True
                break
        
        if not updated:
            # Append new fact
            if lines and not lines[-1].endswith('\n'):
                lines.append('\n')
            lines.append(f"- {key}: {value}\n")
        
        # Write back
        with open(USER_FACTS_PATH, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        
        action = "Updated" if updated else "Stored"
        logger.info(f"{action} user fact: {key} = {value}")
        return {
            'status': 'success',
            'message': f"{action} fact: {key} = {value}",
            'key': key,
            'value': value,
        }
        
    except Exception as e:
        logger.error(f"Error storing fact: {e}")
        return {'status': 'error', 'error': str(e)}


def get_user_facts() -> str:
    """Read all user facts as a string for context injection. Returns empty string if no facts."""
    try:
        if not USER_FACTS_PATH.exists():
            return ""
        with open(USER_FACTS_PATH, 'r', encoding='utf-8') as f:
            content = f.read().strip()
        # Only return if there are actual facts (not just the header)
        lines = [l for l in content.split('\n') if l.strip().startswith('- ')]
        if not lines:
            return ""
        return content
    except Exception:
        return ""


# ============================================================================
# Skill Promotion — move emergent scripts to finalized skills
# ============================================================================

WORKSPACE_DIR = SOMA / "workspace"
EMERGENT_DIR = WORKSPACE_DIR / "emergent"
SKILLS_DIR = SOMA / "skills"


def promote_skill(
    filename: str,
    skill_name: str = "",
    description: str = "",
    confirmed: bool = False,
    **kwargs,
) -> Dict[str, Any]:
    """
    Promote an emergent script to a finalized skill.
    IMPORTANT: Set confirmed=true ONLY after the user has explicitly approved promotion.
    Without confirmation, this returns a preview of what would happen.
    
    Args:
        filename: Name of the file in workspace/emergent/ to promote
        skill_name: Name for the skill .md file (auto-generated if empty)
        description: Brief description of what the skill does
        confirmed: Must be true (user approved) to actually promote
        
    Returns:
        Preview or confirmation of promotion
    """
    try:
        source = EMERGENT_DIR / filename
        if not source.exists():
            # List available files
            available = []
            if EMERGENT_DIR.exists():
                available = [f.name for f in EMERGENT_DIR.iterdir() if f.is_file()]
            return {
                'status': 'error',
                'error': f"File '{filename}' not found in workspace/emergent/",
                'available': available,
            }
        
        # Generate skill name from filename if not provided
        if not skill_name:
            skill_name = source.stem.replace('_', '-').replace(' ', '-')
        if not skill_name.endswith('.md'):
            skill_name = skill_name + '.md'
        
        dest = SKILLS_DIR / skill_name
        
        if not confirmed:
            return {
                'status': 'needs_confirmation',
                'message': f"Ready to promote '{filename}' to skill '{skill_name}'. Ask the user for approval, then call again with confirmed=true.",
                'source': str(source),
                'destination': str(dest),
                'description': description or '(no description provided)',
            }
        
        # Read source content
        with open(source, 'r', encoding='utf-8') as f:
            source_content = f.read()
        
        # Create .md skill wrapper
        ext = source.suffix
        desc_line = description or f"Emergent skill promoted from workspace/emergent/{filename}"
        
        skill_content = f"""# {source.stem.replace('_', ' ').title()}
{desc_line}

## Usage
Run this script to execute the skill:
```
python workspace/emergent/{filename}
```

## Source
```{ext.lstrip('.')}
{source_content}
```
"""
        
        # Write skill file
        SKILLS_DIR.mkdir(parents=True, exist_ok=True)
        with open(dest, 'w', encoding='utf-8') as f:
            f.write(skill_content)
        
        logger.info(f"Promoted skill: {filename} -> {skill_name}")
        
        # Play promotion sound
        try:
            from src.tools.recorder_tool import _play_sound, SOUND_SKILL_PROMOTED
            _play_sound(SOUND_SKILL_PROMOTED)
        except Exception:
            pass
        
        return {
            'status': 'success',
            'message': f"Promoted '{filename}' to skill '{skill_name}'",
            'skill_path': str(dest),
            'source_kept': True,
        }
        
    except Exception as e:
        logger.error(f"Error promoting skill: {e}")
        return {'status': 'error', 'error': str(e)}


# Tool schemas for LLM function calling
MEMORY_SEARCH_SCHEMA = {
    "name": "memory_search",
    "description": "Semantic search across memory and notes. Use before answering questions about prior work, decisions, preferences, or todos.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query"
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum results (default: 5)",
                "default": 5
            },
            "min_score": {
                "type": "number",
                "description": "Minimum relevance score 0-1 (default: 0)",
                "default": 0
            }
        },
        "required": ["query"]
    }
}

MEMORY_GET_SCHEMA = {
    "name": "memory_get",
    "description": "Read specific lines from a memory or notes file. Use after memory_search to pull only needed lines.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path to file (e.g., 'notes/todo.md', 'skills/google-search.md')"
            },
            "from_line": {
                "type": "integer",
                "description": "Starting line number (1-indexed)"
            },
            "lines": {
                "type": "integer",
                "description": "Number of lines to read"
            }
        },
        "required": ["path"]
    }
}

MEMORY_LIST_SCHEMA = {
    "name": "memory_list",
    "description": "List available memory and notes files.",
    "parameters": {
        "type": "object",
        "properties": {
            "directory": {
                "type": "string",
                "description": "Optional subdirectory to list"
            }
        },
        "required": []
    }
}

MEMORY_STORE_FACT_SCHEMA = {
    "name": "memory_store_fact",
    "description": "Store a persistent fact about the user (name, preferences, timezone, etc.). Facts persist across sessions and are always loaded into context.",
    "parameters": {
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Fact key (e.g., 'Name', 'Timezone', 'Preference')"
            },
            "value": {
                "type": "string",
                "description": "Fact value"
            }
        },
        "required": ["key", "value"]
    }
}

PROMOTE_SKILL_SCHEMA = {
    "name": "promote_skill",
    "description": "Promote an emergent script from workspace/emergent/ to a finalized skill in skills/. MUST get user approval first — call without confirmed=true to preview, then ask user, then call with confirmed=true.",
    "parameters": {
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Name of the file in workspace/emergent/ to promote"
            },
            "skill_name": {
                "type": "string",
                "description": "Name for the skill .md file (auto-generated if empty)"
            },
            "description": {
                "type": "string",
                "description": "Brief description of what the skill does"
            },
            "confirmed": {
                "type": "boolean",
                "description": "Set to true ONLY after user has explicitly approved. Default false."
            }
        },
        "required": ["filename"]
    }
}
