"""
Session Memory Save - Auto-save context on reset
=================================================

Session memory that saves conversation context
before clearing/resetting. This preserves important context
that can be referenced later.

Features:
- Auto-save on /new or reset commands
- Timestamped memory files
- Searchable archive
- Configurable retention
"""

import os
import json
import time
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from dataclasses import dataclass, asdict

logger = logging.getLogger("gateway.session_memory")

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
MEMORY_DIR = DATA_DIR / "session_memories"


@dataclass
class SessionSnapshot:
    """A saved session snapshot."""
    session_id: str
    timestamp: float
    messages: List[Dict[str, Any]]
    metadata: Dict[str, Any]
    summary: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SessionSnapshot":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def ensure_memory_dir():
    """Ensure memory directory exists."""
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)


def save_session_memory(
    session_id: str,
    messages: List[Dict[str, Any]],
    metadata: Optional[Dict[str, Any]] = None,
    summary: Optional[str] = None,
) -> str:
    """
    Save session memory to file.
    
    Args:
        session_id: Session identifier
        messages: List of message dicts
        metadata: Optional metadata (model, tools used, etc.)
        summary: Optional summary of the session
    
    Returns:
        Path to saved file
    """
    ensure_memory_dir()
    
    timestamp = time.time()
    dt = datetime.fromtimestamp(timestamp)
    
    # Create filename with timestamp
    filename = f"{session_id}_{dt.strftime('%Y%m%d_%H%M%S')}.json"
    filepath = MEMORY_DIR / filename
    
    snapshot = SessionSnapshot(
        session_id=session_id,
        timestamp=timestamp,
        messages=messages,
        metadata=metadata or {},
        summary=summary,
    )
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(snapshot.to_dict(), f, indent=2, ensure_ascii=False)
        
        logger.info(f"Saved session memory: {filepath}")
        return str(filepath)
        
    except Exception as e:
        logger.error(f"Failed to save session memory: {e}")
        raise


def load_session_memory(filepath: str) -> Optional[SessionSnapshot]:
    """Load a session memory from file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return SessionSnapshot.from_dict(data)
    except Exception as e:
        logger.error(f"Failed to load session memory: {e}")
        return None


def list_session_memories(
    session_id: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    List saved session memories.
    
    Args:
        session_id: Filter by session ID (optional)
        limit: Maximum results
    
    Returns:
        List of memory info dicts
    """
    ensure_memory_dir()
    
    memories = []
    
    for filepath in sorted(MEMORY_DIR.glob("*.json"), reverse=True):
        if len(memories) >= limit:
            break
        
        try:
            # Quick parse for metadata
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if session_id and data.get('session_id') != session_id:
                continue
            
            memories.append({
                'filepath': str(filepath),
                'filename': filepath.name,
                'session_id': data.get('session_id'),
                'timestamp': data.get('timestamp'),
                'message_count': len(data.get('messages', [])),
                'summary': data.get('summary'),
            })
            
        except Exception:
            continue
    
    return memories


def search_session_memories(
    query: str,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """
    Search session memories for content.
    
    Args:
        query: Search query
        limit: Maximum results
    
    Returns:
        List of matching memories with context
    """
    ensure_memory_dir()
    
    results = []
    query_lower = query.lower()
    
    for filepath in MEMORY_DIR.glob("*.json"):
        if len(results) >= limit:
            break
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Search in messages
            for msg in data.get('messages', []):
                content = msg.get('content', '')
                if query_lower in content.lower():
                    results.append({
                        'filepath': str(filepath),
                        'session_id': data.get('session_id'),
                        'timestamp': data.get('timestamp'),
                        'match': content[:200],
                        'role': msg.get('role'),
                    })
                    break
            
            # Search in summary
            summary = data.get('summary', '')
            if summary and query_lower in summary.lower():
                results.append({
                    'filepath': str(filepath),
                    'session_id': data.get('session_id'),
                    'timestamp': data.get('timestamp'),
                    'match': summary[:200],
                    'role': 'summary',
                })
                
        except Exception:
            continue
    
    return results


def get_recent_context(
    session_id: str = "main",
    max_memories: int = 3,
) -> str:
    """
    Get recent context from saved memories for a session.
    
    Useful for providing historical context to the agent.
    """
    memories = list_session_memories(session_id=session_id, limit=max_memories)
    
    if not memories:
        return ""
    
    context_parts = ["## Recent Session History\n"]
    
    for mem in memories:
        dt = datetime.fromtimestamp(mem['timestamp'])
        context_parts.append(f"### {dt.strftime('%Y-%m-%d %H:%M')}")
        
        if mem.get('summary'):
            context_parts.append(mem['summary'])
        else:
            context_parts.append(f"({mem['message_count']} messages)")
        
        context_parts.append("")
    
    return "\n".join(context_parts)


def cleanup_old_memories(
    max_age_days: int = 30,
    max_count: int = 100,
) -> int:
    """
    Clean up old session memories.
    
    Returns number of files deleted.
    """
    ensure_memory_dir()
    
    cutoff_time = time.time() - (max_age_days * 24 * 60 * 60)
    deleted = 0
    
    # Get all memory files sorted by time
    files = sorted(MEMORY_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)
    
    # Delete old files
    for filepath in files:
        try:
            if filepath.stat().st_mtime < cutoff_time:
                filepath.unlink()
                deleted += 1
        except Exception:
            continue
    
    # Delete excess files (keep most recent max_count)
    files = sorted(MEMORY_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for filepath in files[max_count:]:
        try:
            filepath.unlink()
            deleted += 1
        except Exception:
            continue
    
    if deleted:
        logger.info(f"Cleaned up {deleted} old session memories")
    
    return deleted


# Exports
__all__ = [
    "SessionSnapshot",
    "save_session_memory",
    "load_session_memory",
    "list_session_memories",
    "search_session_memories",
    "get_recent_context",
    "cleanup_old_memories",
]
