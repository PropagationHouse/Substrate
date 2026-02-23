"""
Unified Memory System for Substrate
================================
Single source of truth with:
- SQLite database for all storage
- Hybrid search (BM25 full-text + vector embeddings)
- Deduplication via content hashing
- Action-type metadata for multimedia/commands
- Embedding cache to avoid re-computing
"""

import sqlite3
import json
import time
import os
import hashlib
import logging
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
from enum import Enum

import numpy as np

logger = logging.getLogger(__name__)

# Lazy load heavy dependencies
_sentence_transformer = None
_embedding_lock = threading.Lock()

def get_embedding_model():
    """Lazy load the sentence transformer model."""
    global _sentence_transformer
    if _sentence_transformer is None:
        with _embedding_lock:
            if _sentence_transformer is None:
                from sentence_transformers import SentenceTransformer
                _sentence_transformer = SentenceTransformer('all-MiniLM-L6-v2')
                logger.info("Loaded sentence transformer model")
    return _sentence_transformer


class MemoryType(str, Enum):
    """Types of memory entries for filtering and search."""
    CHAT = "chat"
    SCREENSHOT = "screenshot"
    VISION = "vision"
    SEARCH = "search"
    NOTE = "note"
    COMMAND = "command"
    SYSTEM = "system"


# Constants
EMBEDDING_DIMENSION = 384
DEFAULT_CONTEXT_LIMIT = 10
MAX_MEMORY_ENTRIES = 1000
SNIPPET_MAX_CHARS = 500

# Data directory
DATA_DIR = Path(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data'))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "unified_memory.db"


def compute_content_hash(content: str) -> str:
    """Compute a hash for deduplication."""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]


class UnifiedMemoryManager:
    """
    Single unified memory system that replaces:
    - Legacy self.memory list
    - Legacy conversation_history.json
    - Old MemoryManager with separate SQLite + FAISS
    
    Features:
    - Single SQLite database
    - FTS5 full-text search (BM25)
    - Vector embeddings stored in DB
    - Embedding cache
    - Deduplication
    - Action-type metadata
    """
    
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._db_lock = threading.Lock()
        self._init_db()
        logger.info(f"UnifiedMemoryManager initialized with DB at {db_path}")
    
    def _get_connection(self) -> sqlite3.Connection:
        """Get a database connection with proper settings."""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn
    
    def _init_db(self) -> None:
        """Initialize the database schema."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                # Main memories table
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS memories (
                        id TEXT PRIMARY KEY,
                        timestamp REAL NOT NULL,
                        type TEXT NOT NULL,
                        model TEXT,
                        user_message TEXT,
                        assistant_response TEXT,
                        content_hash TEXT UNIQUE,
                        importance_score REAL DEFAULT 0.5,
                        metadata JSON,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create index on timestamp for fast recent queries
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_memories_timestamp 
                    ON memories(timestamp DESC)
                """)
                
                # Create index on type for filtering
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_memories_type 
                    ON memories(type)
                """)
                
                # Create index on content_hash for deduplication
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_memories_hash 
                    ON memories(content_hash)
                """)
                
                # FTS5 virtual table for full-text search
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                        id,
                        user_message,
                        assistant_response,
                        content='memories',
                        content_rowid='rowid',
                        tokenize='porter unicode61'
                    )
                """)
                
                # Triggers to keep FTS in sync
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                        INSERT INTO memories_fts(rowid, id, user_message, assistant_response)
                        VALUES (new.rowid, new.id, new.user_message, new.assistant_response);
                    END
                """)
                
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                        INSERT INTO memories_fts(memories_fts, rowid, id, user_message, assistant_response)
                        VALUES ('delete', old.rowid, old.id, old.user_message, old.assistant_response);
                    END
                """)
                
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                        INSERT INTO memories_fts(memories_fts, rowid, id, user_message, assistant_response)
                        VALUES ('delete', old.rowid, old.id, old.user_message, old.assistant_response);
                        INSERT INTO memories_fts(rowid, id, user_message, assistant_response)
                        VALUES (new.rowid, new.id, new.user_message, new.assistant_response);
                    END
                """)
                
                # Embeddings table (cached vectors)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS embeddings (
                        memory_id TEXT PRIMARY KEY,
                        embedding BLOB,
                        model_name TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
                    )
                """)
                
                conn.commit()
                logger.info("Database schema initialized")
            finally:
                conn.close()
    
    def _clean_message(self, message: str) -> str:
        """Remove nested conversation history from messages."""
        if not message:
            return ""
        
        # Remove the "--- Conversation History ---" blocks that cause loops
        if "--- Conversation History ---" in message:
            # Take only the content before the first history block
            parts = message.split("--- Conversation History ---")
            message = parts[0].strip()
        
        # Truncate extremely long messages
        if len(message) > 10000:
            message = message[:10000] + "... [truncated]"
        
        return message.strip()
    
    def add_memory(
        self,
        user_message: str,
        assistant_response: str,
        model: str = None,
        memory_type: MemoryType = MemoryType.CHAT,
        metadata: Optional[Dict[str, Any]] = None,
        importance_score: Optional[float] = None
    ) -> Optional[str]:
        """
        Add a memory entry with deduplication.
        
        Args:
            user_message: The user's message (cleaned of nested history)
            assistant_response: The assistant's response
            model: The model used for this interaction
            memory_type: Type of memory (chat, screenshot, search, etc.)
            metadata: Additional metadata (image_description, search_query, etc.)
            importance_score: Override importance score (0-1)
            
        Returns:
            Memory ID if stored, None if duplicate
        """
        # Clean messages to remove nested history
        user_message = self._clean_message(user_message)
        assistant_response = self._clean_message(assistant_response)
        
        # Skip empty entries
        if not user_message and not assistant_response:
            return None
        
        # Compute content hash for deduplication
        content = f"{user_message}|{assistant_response}"
        content_hash = compute_content_hash(content)
        
        # Generate unique ID
        memory_id = f"mem_{int(time.time() * 1000)}_{content_hash[:8]}"
        
        # Calculate importance if not provided
        if importance_score is None:
            importance_score = self._calculate_importance(
                user_message, assistant_response, memory_type, metadata
            )
        
        with self._db_lock:
            conn = self._get_connection()
            try:
                # Check for duplicate
                cursor = conn.execute(
                    "SELECT id FROM memories WHERE content_hash = ?",
                    (content_hash,)
                )
                if cursor.fetchone():
                    logger.debug(f"Duplicate memory detected, skipping: {content_hash}")
                    return None
                
                # Insert new memory
                conn.execute(
                    """
                    INSERT INTO memories 
                    (id, timestamp, type, model, user_message, assistant_response, 
                     content_hash, importance_score, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        memory_id,
                        time.time(),
                        memory_type.value if isinstance(memory_type, MemoryType) else memory_type,
                        model,
                        user_message,
                        assistant_response,
                        content_hash,
                        importance_score,
                        json.dumps(metadata or {})
                    )
                )
                conn.commit()
                
                # Compute and cache embedding asynchronously
                threading.Thread(
                    target=self._cache_embedding,
                    args=(memory_id, content),
                    daemon=True
                ).start()
                
                logger.debug(f"Added memory {memory_id} (type={memory_type}, importance={importance_score:.2f})")
                return memory_id
                
            except sqlite3.IntegrityError as e:
                logger.debug(f"Duplicate memory (integrity error): {e}")
                return None
            finally:
                conn.close()
    
    def _calculate_importance(
        self,
        user_message: str,
        assistant_response: str,
        memory_type: MemoryType,
        metadata: Optional[Dict]
    ) -> float:
        """Calculate importance score for a memory."""
        score = 0.5  # Base score
        
        content = f"{user_message} {assistant_response}".lower()
        
        # Type-based scoring
        type_weights = {
            MemoryType.NOTE: 0.9,
            MemoryType.SEARCH: 0.8,
            MemoryType.SCREENSHOT: 0.7,
            MemoryType.VISION: 0.7,
            MemoryType.COMMAND: 0.6,
            MemoryType.CHAT: 0.5,
            MemoryType.SYSTEM: 0.3,
        }
        score = type_weights.get(memory_type, 0.5)
        
        # Keyword boosting
        important_keywords = [
            "remember", "important", "note", "save", "key", "critical",
            "bug", "error", "fix", "solution", "password", "api key",
            "deadline", "meeting", "todo", "task"
        ]
        for keyword in important_keywords:
            if keyword in content:
                score = min(1.0, score + 0.1)
        
        # Code block boost
        if "```" in content:
            score = min(1.0, score + 0.15)
        
        # Length factor (longer = potentially more important)
        total_len = len(user_message) + len(assistant_response)
        if total_len > 500:
            score = min(1.0, score + 0.1)
        
        # Metadata boost
        if metadata:
            if metadata.get("note_path"):
                score = min(1.0, score + 0.2)
            if metadata.get("search_query"):
                score = min(1.0, score + 0.1)
            if metadata.get("image_description"):
                score = min(1.0, score + 0.1)
        
        return min(1.0, max(0.0, score))
    
    def _cache_embedding(self, memory_id: str, content: str) -> None:
        """Compute and cache embedding for a memory."""
        try:
            model = get_embedding_model()
            embedding = model.encode([content])[0]
            embedding_blob = embedding.astype(np.float32).tobytes()
            
            with self._db_lock:
                conn = self._get_connection()
                try:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO embeddings (memory_id, embedding, model_name)
                        VALUES (?, ?, ?)
                        """,
                        (memory_id, embedding_blob, 'all-MiniLM-L6-v2')
                    )
                    conn.commit()
                finally:
                    conn.close()
        except Exception as e:
            logger.error(f"Error caching embedding for {memory_id}: {e}")
    
    def get_recent_context(
        self,
        limit: int = DEFAULT_CONTEXT_LIMIT,
        memory_types: Optional[List[MemoryType]] = None,
        include_metadata: bool = False
    ) -> str:
        """
        Get recent conversation context as a formatted string.
        
        Args:
            limit: Maximum number of entries to retrieve
            memory_types: Filter by memory types (None = all)
            include_metadata: Include action metadata in context
            
        Returns:
            Formatted context string for LLM consumption
        """
        with self._db_lock:
            conn = self._get_connection()
            try:
                if memory_types:
                    type_placeholders = ','.join('?' * len(memory_types))
                    type_values = [t.value if isinstance(t, MemoryType) else t for t in memory_types]
                    cursor = conn.execute(
                        f"""
                        SELECT * FROM memories 
                        WHERE type IN ({type_placeholders})
                        ORDER BY timestamp DESC 
                        LIMIT ?
                        """,
                        (*type_values, limit)
                    )
                else:
                    cursor = conn.execute(
                        """
                        SELECT * FROM memories 
                        ORDER BY timestamp DESC 
                        LIMIT ?
                        """,
                        (limit,)
                    )
                
                rows = cursor.fetchall()
                
                if not rows:
                    return ""
                
                # Build context string (reverse to chronological order)
                context_parts = []
                for row in reversed(rows):
                    user_msg = row['user_message'] or ""
                    assistant_msg = row['assistant_response'] or ""
                    mem_type = row['type']
                    
                    # Add type prefix for non-chat memories
                    if mem_type != MemoryType.CHAT.value and mem_type != "chat":
                        type_label = f"[{mem_type.upper()}] "
                    else:
                        type_label = ""
                    
                    # Format timestamp from epoch
                    ts = row['timestamp']
                    try:
                        from datetime import datetime as _dt
                        ts_str = _dt.fromtimestamp(ts).strftime("[%b %d, %Y %I:%M %p]")
                    except Exception:
                        ts_str = ""
                    
                    if user_msg:
                        context_parts.append(f"{ts_str} User: {type_label}{user_msg}")
                    if assistant_msg:
                        context_parts.append(f"{ts_str} Assistant: {assistant_msg}")
                    
                    # Add metadata context if requested
                    if include_metadata and row['metadata']:
                        try:
                            meta = json.loads(row['metadata'])
                            if meta.get('image_description'):
                                context_parts.append(f"  [Saw: {meta['image_description']}]")
                            if meta.get('search_query'):
                                context_parts.append(f"  [Searched: {meta['search_query']}]")
                            if meta.get('note_title'):
                                context_parts.append(f"  [Created note: {meta['note_title']}]")
                        except json.JSONDecodeError:
                            pass
                
                if context_parts:
                    return "\n--- Conversation History ---\n" + "\n".join(context_parts) + "\n"
                return ""
                
            finally:
                conn.close()
    
    def get_recent_messages(self, count: int = 5) -> List[Dict]:
        """Get recent messages in a format suitable for note creation."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                cursor = conn.execute(
                    """
                    SELECT user_message, assistant_response 
                    FROM memories 
                    ORDER BY timestamp DESC 
                    LIMIT ?
                    """,
                    (count,)
                )
                
                messages = []
                for row in cursor.fetchall():
                    if row['user_message']:
                        messages.append({"role": "user", "content": row['user_message']})
                    if row['assistant_response']:
                        messages.append({"role": "assistant", "content": row['assistant_response']})
                
                return messages
            finally:
                conn.close()
    
    def search_hybrid(
        self,
        query: str,
        limit: int = 10,
        memory_types: Optional[List[MemoryType]] = None,
        vector_weight: float = 0.7,
        text_weight: float = 0.3
    ) -> List[Dict]:
        """
        Hybrid search combining BM25 full-text and vector similarity.
        
        Args:
            query: Search query
            limit: Maximum results
            memory_types: Filter by types
            vector_weight: Weight for vector similarity (0-1)
            text_weight: Weight for BM25 text match (0-1)
            
        Returns:
            List of matching memories with scores
        """
        # Normalize weights
        total = vector_weight + text_weight
        vector_weight = vector_weight / total
        text_weight = text_weight / total
        
        # Get BM25 results
        text_results = self._search_fts(query, limit * 2, memory_types)
        
        # Get vector results
        vector_results = self._search_vector(query, limit * 2, memory_types)
        
        # Merge results
        merged = {}
        
        for result in text_results:
            mem_id = result['id']
            merged[mem_id] = {
                **result,
                'text_score': result.get('score', 0),
                'vector_score': 0,
                'final_score': result.get('score', 0) * text_weight
            }
        
        for result in vector_results:
            mem_id = result['id']
            if mem_id in merged:
                merged[mem_id]['vector_score'] = result.get('score', 0)
                merged[mem_id]['final_score'] += result.get('score', 0) * vector_weight
            else:
                merged[mem_id] = {
                    **result,
                    'text_score': 0,
                    'vector_score': result.get('score', 0),
                    'final_score': result.get('score', 0) * vector_weight
                }
        
        # Sort by final score and return top results
        sorted_results = sorted(
            merged.values(),
            key=lambda x: x['final_score'],
            reverse=True
        )
        
        return sorted_results[:limit]
    
    def _search_fts(
        self,
        query: str,
        limit: int,
        memory_types: Optional[List[MemoryType]] = None
    ) -> List[Dict]:
        """Full-text search using FTS5 BM25."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                # Build FTS query
                fts_query = ' OR '.join(query.split())
                
                if memory_types:
                    type_placeholders = ','.join('?' * len(memory_types))
                    type_values = [t.value if isinstance(t, MemoryType) else t for t in memory_types]
                    
                    cursor = conn.execute(
                        f"""
                        SELECT m.*, bm25(memories_fts) as score
                        FROM memories_fts fts
                        JOIN memories m ON fts.id = m.id
                        WHERE memories_fts MATCH ?
                        AND m.type IN ({type_placeholders})
                        ORDER BY score
                        LIMIT ?
                        """,
                        (fts_query, *type_values, limit)
                    )
                else:
                    cursor = conn.execute(
                        """
                        SELECT m.*, bm25(memories_fts) as score
                        FROM memories_fts fts
                        JOIN memories m ON fts.id = m.id
                        WHERE memories_fts MATCH ?
                        ORDER BY score
                        LIMIT ?
                        """,
                        (fts_query, limit)
                    )
                
                results = []
                for row in cursor.fetchall():
                    result = dict(row)
                    # BM25 returns negative scores (lower = better), normalize to 0-1
                    result['score'] = 1.0 / (1.0 + abs(result.get('score', 0)))
                    results.append(result)
                
                return results
                
            except sqlite3.OperationalError as e:
                logger.warning(f"FTS search error: {e}")
                return []
            finally:
                conn.close()
    
    def _search_vector(
        self,
        query: str,
        limit: int,
        memory_types: Optional[List[MemoryType]] = None
    ) -> List[Dict]:
        """Vector similarity search using cached embeddings."""
        try:
            model = get_embedding_model()
            query_embedding = model.encode([query])[0].astype(np.float32)
        except Exception as e:
            logger.error(f"Error computing query embedding: {e}")
            return []
        
        with self._db_lock:
            conn = self._get_connection()
            try:
                # Get all embeddings
                if memory_types:
                    type_placeholders = ','.join('?' * len(memory_types))
                    type_values = [t.value if isinstance(t, MemoryType) else t for t in memory_types]
                    
                    cursor = conn.execute(
                        f"""
                        SELECT e.memory_id, e.embedding, m.*
                        FROM embeddings e
                        JOIN memories m ON e.memory_id = m.id
                        WHERE m.type IN ({type_placeholders})
                        """,
                        type_values
                    )
                else:
                    cursor = conn.execute(
                        """
                        SELECT e.memory_id, e.embedding, m.*
                        FROM embeddings e
                        JOIN memories m ON e.memory_id = m.id
                        """
                    )
                
                results = []
                for row in cursor.fetchall():
                    try:
                        embedding = np.frombuffer(row['embedding'], dtype=np.float32)
                        # Cosine similarity
                        similarity = np.dot(query_embedding, embedding) / (
                            np.linalg.norm(query_embedding) * np.linalg.norm(embedding) + 1e-8
                        )
                        
                        result = dict(row)
                        result['score'] = float(similarity)
                        results.append(result)
                    except Exception as e:
                        logger.debug(f"Error processing embedding: {e}")
                        continue
                
                # Sort by similarity (descending)
                results.sort(key=lambda x: x['score'], reverse=True)
                return results[:limit]
                
            finally:
                conn.close()
    
    def search_by_type(
        self,
        memory_type: MemoryType,
        limit: int = 20,
        since_timestamp: Optional[float] = None
    ) -> List[Dict]:
        """Get memories of a specific type."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                if since_timestamp:
                    cursor = conn.execute(
                        """
                        SELECT * FROM memories 
                        WHERE type = ? AND timestamp > ?
                        ORDER BY timestamp DESC 
                        LIMIT ?
                        """,
                        (memory_type.value, since_timestamp, limit)
                    )
                else:
                    cursor = conn.execute(
                        """
                        SELECT * FROM memories 
                        WHERE type = ?
                        ORDER BY timestamp DESC 
                        LIMIT ?
                        """,
                        (memory_type.value, limit)
                    )
                
                return [dict(row) for row in cursor.fetchall()]
            finally:
                conn.close()
    
    def get_memory_stats(self) -> Dict:
        """Get statistics about the memory database."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                stats = {}
                
                # Total count
                cursor = conn.execute("SELECT COUNT(*) as count FROM memories")
                stats['total_memories'] = cursor.fetchone()['count']
                
                # Count by type
                cursor = conn.execute(
                    "SELECT type, COUNT(*) as count FROM memories GROUP BY type"
                )
                stats['by_type'] = {row['type']: row['count'] for row in cursor.fetchall()}
                
                # Embeddings count
                cursor = conn.execute("SELECT COUNT(*) as count FROM embeddings")
                stats['cached_embeddings'] = cursor.fetchone()['count']
                
                # Database size
                stats['db_size_mb'] = os.path.getsize(self.db_path) / (1024 * 1024)
                
                return stats
            finally:
                conn.close()
    
    def get_memories_since(
        self,
        since_timestamp: float,
        memory_types: Optional[List[MemoryType]] = None,
        limit: int = 500
    ) -> List[Dict]:
        """Get all memories added since a given timestamp.
        
        Args:
            since_timestamp: Unix timestamp to query from
            memory_types: Optional filter by types
            limit: Maximum results
            
        Returns:
            List of memory dicts ordered chronologically (oldest first)
        """
        with self._db_lock:
            conn = self._get_connection()
            try:
                if memory_types:
                    type_placeholders = ','.join('?' * len(memory_types))
                    type_values = [t.value if isinstance(t, MemoryType) else t for t in memory_types]
                    cursor = conn.execute(
                        f"""
                        SELECT * FROM memories 
                        WHERE timestamp > ? AND type IN ({type_placeholders})
                        ORDER BY timestamp ASC 
                        LIMIT ?
                        """,
                        (since_timestamp, *type_values, limit)
                    )
                else:
                    cursor = conn.execute(
                        """
                        SELECT * FROM memories 
                        WHERE timestamp > ?
                        ORDER BY timestamp ASC 
                        LIMIT ?
                        """,
                        (since_timestamp, limit)
                    )
                return [dict(row) for row in cursor.fetchall()]
            finally:
                conn.close()

    def cleanup_old_memories(
        self,
        max_entries: int = MAX_MEMORY_ENTRIES,
        importance_threshold: float = 0.3
    ) -> int:
        """Remove old, low-importance memories to keep database size manageable."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                # Count current entries
                cursor = conn.execute("SELECT COUNT(*) as count FROM memories")
                current_count = cursor.fetchone()['count']
                
                if current_count <= max_entries:
                    return 0
                
                # Delete oldest low-importance entries
                to_delete = current_count - max_entries
                cursor = conn.execute(
                    """
                    DELETE FROM memories 
                    WHERE id IN (
                        SELECT id FROM memories 
                        WHERE importance_score < ?
                        ORDER BY timestamp ASC 
                        LIMIT ?
                    )
                    """,
                    (importance_threshold, to_delete)
                )
                
                deleted = cursor.rowcount
                conn.commit()
                
                # Vacuum to reclaim space
                conn.execute("VACUUM")
                
                logger.info(f"Cleaned up {deleted} old memories")
                return deleted
                
            finally:
                conn.close()
    
    def clear_all(self) -> None:
        """Clear all memories (use with caution!)."""
        with self._db_lock:
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM embeddings")
                conn.execute("DELETE FROM memories")
                conn.commit()
                conn.execute("VACUUM")
                logger.info("All memories cleared")
            finally:
                conn.close()
    
    def export_to_json(self, filepath: Optional[Path] = None) -> str:
        """Export all memories to JSON for backup."""
        if filepath is None:
            filepath = DATA_DIR / f"memory_backup_{int(time.time())}.json"
        
        with self._db_lock:
            conn = self._get_connection()
            try:
                cursor = conn.execute("SELECT * FROM memories ORDER BY timestamp")
                memories = [dict(row) for row in cursor.fetchall()]
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump({'memories': memories, 'exported_at': time.time()}, f, indent=2)
                
                logger.info(f"Exported {len(memories)} memories to {filepath}")
                return str(filepath)
            finally:
                conn.close()
    
    def import_from_legacy(self, legacy_json_path: Path) -> int:
        """Import memories from legacy conversation_history.json format."""
        if not legacy_json_path.exists():
            logger.warning(f"Legacy file not found: {legacy_json_path}")
            return 0
        
        try:
            with open(legacy_json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            conversations = data.get('conversations', [])
            imported = 0
            
            for conv in conversations:
                user_msg = conv.get('user_message', '')
                assistant_msg = conv.get('assistant_response', '')
                model = conv.get('model')
                timestamp = conv.get('timestamp', time.time())
                
                # Determine type from content
                memory_type = MemoryType.CHAT
                if '[Image Response]' in user_msg or 'What do you see' in user_msg:
                    memory_type = MemoryType.VISION
                elif '[Perplexity' in assistant_msg:
                    memory_type = MemoryType.SEARCH
                
                # Clean and add
                result = self.add_memory(
                    user_message=user_msg,
                    assistant_response=assistant_msg,
                    model=model,
                    memory_type=memory_type
                )
                
                if result:
                    imported += 1
            
            logger.info(f"Imported {imported} memories from legacy format")
            return imported
            
        except Exception as e:
            logger.error(f"Error importing legacy memories: {e}")
            return 0


# Singleton instance
_unified_memory: Optional[UnifiedMemoryManager] = None
_memory_lock = threading.Lock()


def get_unified_memory() -> UnifiedMemoryManager:
    """Get the singleton UnifiedMemoryManager instance."""
    global _unified_memory
    if _unified_memory is None:
        with _memory_lock:
            if _unified_memory is None:
                _unified_memory = UnifiedMemoryManager()
    return _unified_memory
