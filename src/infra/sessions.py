"""
Session Management - Isolated session contexts.
Provides:
- Session isolation for different tasks
- Main session vs isolated sessions (cron, subagents)
- Session state persistence
- Cross-session communication
"""

import json
import time
import logging
import threading
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field, asdict
from pathlib import Path
import uuid

logger = logging.getLogger(__name__)

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
SESSIONS_DIR = DATA_DIR / "sessions"


@dataclass
class SessionMessage:
    """A message in a session."""
    role: str  # "user", "assistant", "system"
    content: str
    timestamp: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SessionMessage':
        return cls(
            role=data["role"],
            content=data["content"],
            timestamp=data.get("timestamp", time.time()),
            metadata=data.get("metadata", {}),
        )


@dataclass
class Session:
    """An isolated session context."""
    key: str  # Unique session key
    session_type: str = "main"  # "main", "cron", "subagent", "isolated"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    messages: List[SessionMessage] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    parent_session: Optional[str] = None  # For subagent sessions
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "sessionType": self.session_type,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "messages": [m.to_dict() for m in self.messages],
            "metadata": self.metadata,
            "parentSession": self.parent_session,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Session':
        return cls(
            key=data["key"],
            session_type=data.get("sessionType", "main"),
            created_at=data.get("createdAt", time.time()),
            updated_at=data.get("updatedAt", time.time()),
            messages=[SessionMessage.from_dict(m) for m in data.get("messages", [])],
            metadata=data.get("metadata", {}),
            parent_session=data.get("parentSession"),
        )
    
    def add_message(self, role: str, content: str, metadata: Optional[Dict] = None):
        """Add a message to the session."""
        msg = SessionMessage(
            role=role,
            content=content,
            metadata=metadata or {},
        )
        self.messages.append(msg)
        self.updated_at = time.time()
    
    def get_messages_for_llm(self) -> List[Dict[str, str]]:
        """Get messages in LLM-compatible format."""
        return [{"role": m.role, "content": m.content} for m in self.messages]
    
    def clear_messages(self):
        """Clear all messages."""
        self.messages.clear()
        self.updated_at = time.time()


class SessionManager:
    """
    Manages multiple isolated sessions.
    
    Session types:
    - main: Primary user interaction session
    - cron:<jobId>: Isolated session for cron job execution
    - subagent:<id>: Isolated session for subagent tasks
    - isolated:<id>: Generic isolated session
    """
    
    def __init__(self, persist: bool = True):
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()
        self._persist = persist
        
        if persist:
            self._ensure_dirs()
            self._load_sessions()
    
    def _ensure_dirs(self):
        """Ensure storage directories exist."""
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    
    def _session_file(self, key: str) -> Path:
        """Get file path for a session."""
        # Sanitize key for filename
        safe_key = key.replace(":", "_").replace("/", "_")
        return SESSIONS_DIR / f"{safe_key}.json"
    
    def _load_sessions(self):
        """Load sessions from disk."""
        try:
            for file in SESSIONS_DIR.glob("*.json"):
                try:
                    data = json.loads(file.read_text())
                    session = Session.from_dict(data)
                    self._sessions[session.key] = session
                except Exception as e:
                    logger.warning(f"Error loading session {file}: {e}")
            
            logger.info(f"Loaded {len(self._sessions)} sessions")
        except Exception as e:
            logger.error(f"Error loading sessions: {e}")
    
    def _save_session(self, session: Session):
        """Save a session to disk."""
        if not self._persist:
            return
        
        try:
            self._ensure_dirs()
            file = self._session_file(session.key)
            file.write_text(json.dumps(session.to_dict(), indent=2))
        except Exception as e:
            logger.error(f"Error saving session {session.key}: {e}")
    
    def _delete_session_file(self, key: str):
        """Delete session file from disk."""
        if not self._persist:
            return
        
        try:
            file = self._session_file(key)
            if file.exists():
                file.unlink()
        except Exception as e:
            logger.error(f"Error deleting session file {key}: {e}")
    
    def get(self, key: str) -> Optional[Session]:
        """Get a session by key."""
        with self._lock:
            return self._sessions.get(key)
    
    def get_or_create(
        self,
        key: str,
        session_type: str = "main",
        parent_session: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ) -> Session:
        """Get existing session or create new one."""
        with self._lock:
            if key in self._sessions:
                return self._sessions[key]
            
            session = Session(
                key=key,
                session_type=session_type,
                parent_session=parent_session,
                metadata=metadata or {},
            )
            self._sessions[key] = session
            self._save_session(session)
            
            logger.info(f"Created session: {key} (type: {session_type})")
            return session
    
    def create_isolated(
        self,
        prefix: str = "isolated",
        parent_session: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ) -> Session:
        """Create a new isolated session with unique ID."""
        session_id = str(uuid.uuid4())[:8]
        key = f"{prefix}:{session_id}"
        return self.get_or_create(
            key=key,
            session_type=prefix,
            parent_session=parent_session,
            metadata=metadata,
        )
    
    def update(self, session: Session):
        """Update a session."""
        with self._lock:
            session.updated_at = time.time()
            self._sessions[session.key] = session
            self._save_session(session)
    
    def delete(self, key: str) -> bool:
        """Delete a session."""
        with self._lock:
            if key in self._sessions:
                del self._sessions[key]
                self._delete_session_file(key)
                logger.info(f"Deleted session: {key}")
                return True
            return False
    
    def list_sessions(
        self,
        session_type: Optional[str] = None,
        include_empty: bool = False,
    ) -> List[Dict[str, Any]]:
        """List all sessions."""
        with self._lock:
            sessions = []
            for session in self._sessions.values():
                if session_type and session.session_type != session_type:
                    continue
                if not include_empty and not session.messages:
                    continue
                
                sessions.append({
                    "key": session.key,
                    "type": session.session_type,
                    "messageCount": len(session.messages),
                    "createdAt": session.created_at,
                    "updatedAt": session.updated_at,
                    "parentSession": session.parent_session,
                })
            
            return sorted(sessions, key=lambda s: s["updatedAt"], reverse=True)
    
    def get_main_session(self) -> Session:
        """Get or create the main session."""
        return self.get_or_create("main", session_type="main")
    
    def clear_session(self, key: str):
        """Clear messages from a session but keep it."""
        with self._lock:
            if key in self._sessions:
                self._sessions[key].clear_messages()
                self._save_session(self._sessions[key])
    
    def add_message(
        self,
        key: str,
        role: str,
        content: str,
        metadata: Optional[Dict] = None,
    ):
        """Add a message to a session."""
        with self._lock:
            session = self._sessions.get(key)
            if session:
                session.add_message(role, content, metadata)
                self._save_session(session)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get session statistics."""
        with self._lock:
            by_type: Dict[str, int] = {}
            total_messages = 0
            
            for session in self._sessions.values():
                by_type[session.session_type] = by_type.get(session.session_type, 0) + 1
                total_messages += len(session.messages)
            
            return {
                "totalSessions": len(self._sessions),
                "totalMessages": total_messages,
                "byType": by_type,
            }


# Global instance
_session_manager: Optional[SessionManager] = None
_manager_lock = threading.Lock()


def get_session_manager() -> SessionManager:
    """Get the global session manager."""
    global _session_manager
    
    with _manager_lock:
        if _session_manager is None:
            _session_manager = SessionManager()
        return _session_manager


def create_isolated_session(
    prefix: str = "isolated",
    parent_session: Optional[str] = None,
    metadata: Optional[Dict] = None,
) -> Session:
    """Create a new isolated session."""
    return get_session_manager().create_isolated(prefix, parent_session, metadata)


def get_main_session() -> Session:
    """Get the main session."""
    return get_session_manager().get_main_session()
