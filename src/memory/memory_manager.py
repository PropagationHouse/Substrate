"""Memory management system for storing and retrieving chat interactions."""

import sqlite3
import json
import time
import os
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Union
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer
import faiss

# Constants
IMPORTANCE_THRESHOLD = 0.7
EMBEDDING_DIMENSION = 384  # Based on all-MiniLM-L6-v2 model

# Create data directory within the application folder
DATA_DIR = Path(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data'))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Use fixed paths within the data directory
DB_PATH = DATA_DIR / "chat_memory.db"
VECTOR_PATH = DATA_DIR / "vector_store"

class ShortTermMemory:
    """Manages short-term memory for the current chat session."""
    
    def __init__(self, max_size: int = 100):
        self.max_size = max_size
        self.messages: List[Dict] = []
        
    def add(self, content: str, metadata: Optional[Dict] = None) -> None:
        """Add a message to short-term memory."""
        message = {
            'content': content,
            'timestamp': datetime.now().isoformat(),
            'metadata': metadata or {}
        }
        self.messages.append(message)
        
        # Remove oldest messages if we exceed max size
        if len(self.messages) > self.max_size:
            self.messages = self.messages[-self.max_size:]
            
    def get_recent(self, n: int = 10) -> List[Dict]:
        """Get the n most recent messages."""
        return self.messages[-n:]
    
    def clear(self) -> None:
        """Clear short-term memory."""
        self.messages = []

class LongTermMemory:
    """Manages long-term memory storage in SQLite."""
    
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()
        
    def _init_db(self) -> None:
        """Initialize the SQLite database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT,
                    importance_score FLOAT,
                    context TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    metadata JSON
                )
            """)
            conn.commit()
            
    def store(self, content: str, importance: float, context: str, metadata: Optional[Dict] = None) -> str:
        """Store a memory in the long-term database."""
        memory_id = f"mem_{int(time.time())}_{hash(content) % 10000}"
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO memories (id, content, importance_score, context, metadata)
                VALUES (?, ?, ?, ?, ?)
                """,
                (memory_id, content, importance, context, json.dumps(metadata or {}))
            )
            conn.commit()
            
        return memory_id
    
    def retrieve(self, query: str, limit: int = 10) -> List[Dict]:
        """Retrieve memories based on a text query."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT * FROM memories 
                WHERE content LIKE ? OR context LIKE ?
                ORDER BY importance_score DESC
                LIMIT ?
                """,
                (f"%{query}%", f"%{query}%", limit)
            )
            return [dict(row) for row in cursor.fetchall()]
    
    def cleanup(self, threshold: float = 0.5, days: int = 30) -> int:
        """Remove old, low-importance memories."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                DELETE FROM memories 
                WHERE importance_score < ?
                AND datetime(timestamp) < datetime('now', '-? days')
                """,
                (threshold, days)
            )
            return cursor.rowcount

class KnowledgeBase:
    """Manages vector-based semantic search for memories."""
    
    def __init__(self, vector_path: Path = VECTOR_PATH):
        self.vector_path = vector_path
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        self.index = faiss.IndexFlatL2(EMBEDDING_DIMENSION)
        self.texts: List[str] = []
        self._load_or_create_index()
        
    def _load_or_create_index(self) -> None:
        """Load existing index or create a new one."""
        if self.vector_path.exists():
            self.index = faiss.read_index(str(self.vector_path))
            # Load texts from a companion file
            texts_path = self.vector_path.with_suffix('.json')
            if texts_path.exists():
                self.texts = json.loads(texts_path.read_text())
        
    def _save_index(self) -> None:
        """Save the current index and texts."""
        self.vector_path.parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.index, str(self.vector_path))
        # Save texts to a companion file
        texts_path = self.vector_path.with_suffix('.json')
        texts_path.write_text(json.dumps(self.texts))
        
    def add(self, text: str) -> None:
        """Add a text to the knowledge base."""
        embedding = self.model.encode([text])[0]
        self.index.add(np.array([embedding], dtype=np.float32))
        self.texts.append(text)
        self._save_index()
        
    def search(self, query: str, k: int = 5) -> List[Tuple[str, float]]:
        """Search for similar texts in the knowledge base."""
        query_embedding = self.model.encode([query])[0]
        distances, indices = self.index.search(
            np.array([query_embedding], dtype=np.float32), k
        )
        
        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(self.texts):  # Ensure valid index
                results.append((self.texts[idx], float(distances[0][i])))
        return results

class MemoryManager:
    """Main class for managing all memory systems."""
    
    def __init__(self):
        self.short_term = ShortTermMemory()
        self.long_term = LongTermMemory()
        self.knowledge_base = KnowledgeBase()
        
    def add_memory(self, content: str, context: str = "", metadata: Optional[Dict] = None) -> None:
        """Add a memory to all relevant storage systems."""
        # Always add to short-term
        self.short_term.add(content, metadata)
        
        # Score importance
        importance = self.score_importance(content, context)
        
        # If important enough, add to long-term and knowledge base
        if importance > IMPORTANCE_THRESHOLD:
            self.long_term.store(content, importance, context, metadata)
            self.knowledge_base.add(content)
            
    def score_importance(self, content: str, context: str) -> float:
        """Score the importance of a memory."""
        # Basic scoring based on content length and complexity
        score = min(1.0, len(content) / 1000)  # Length factor
        
        # Add weight for code blocks
        if "```" in content:
            score += 0.2
            
        # Add weight for specific keywords
        keywords = ["important", "remember", "key", "critical", "bug", "error"]
        score += sum(0.1 for word in keywords if word.lower() in content.lower())
        
        # Add weight for context matches
        if context and any(word in context.lower() for word in keywords):
            score += 0.1
            
        return min(1.0, score)  # Ensure score is between 0 and 1
    
    def search(self, query: str, limit: int = 5) -> Dict[str, List]:
        """Search across all memory systems."""
        return {
            'short_term': self.short_term.get_recent(limit),
            'long_term': self.long_term.retrieve(query, limit),
            'semantic': self.knowledge_base.search(query, limit)
        }
    
    def consolidate(self) -> None:
        """Consolidate memories and clean up old ones."""
        self.long_term.cleanup()
        # Future: implement more sophisticated consolidation logic
