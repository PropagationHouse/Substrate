"""
Code Memory - Integration of codebase knowledge with the memory system

This module integrates the codebase knowledge with the memory system,
providing code-aware context and analysis capabilities.
"""

import os
import json
import time
import logging
from typing import Dict, List, Tuple, Optional
from pathlib import Path

from .memory_manager import MemoryManager

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Constants
CODE_METADATA_PATH = Path(os.path.dirname(os.path.abspath(__file__))).parent.parent / "data" / "code_metadata.json"

class CodeMemory:
    """Integrates codebase knowledge with the memory system."""
    
    def __init__(self, memory_manager: Optional[MemoryManager] = None):
        """Initialize the code memory.
        
        Args:
            memory_manager: Optional memory manager instance. If None, creates a new one.
        """
        self.memory_manager = memory_manager if memory_manager else MemoryManager()
        self.base_dir = Path(os.path.dirname(os.path.abspath(__file__))).parent.parent
        self.metadata = []
        self.load_metadata()
        
    def load_metadata(self) -> None:
        """Load the code metadata from disk."""
        try:
            if CODE_METADATA_PATH.exists():
                with open(CODE_METADATA_PATH, 'r', encoding='utf-8') as f:
                    self.metadata = json.load(f)
                logger.info(f"Loaded {len(self.metadata)} code chunks from {CODE_METADATA_PATH}")
            else:
                logger.warning(f"Code metadata file not found: {CODE_METADATA_PATH}")
                logger.warning("Please run initialize_code_memory.py to create the code database")
                self.metadata = []
        except Exception as e:
            logger.error(f"Error loading code metadata: {e}")
            self.metadata = []
        
    def search_code(self, query: str, k: int = 5) -> List[Tuple[Dict, float]]:
        """Search the codebase for relevant chunks.
        
        Args:
            query: Search query
            k: Number of results to return
            
        Returns:
            List of (metadata, score) tuples
        """
        if not self.metadata:
            logger.warning("No code metadata available for search")
            return []
            
        query = query.lower()
        results = []
        
        for chunk in self.metadata:
            content = chunk.get('content', '').lower()
            if query in content:
                # Calculate a simple relevance score based on frequency
                score = content.count(query)
                results.append((chunk, score))
        
        # Sort by score (descending)
        results.sort(key=lambda x: x[1], reverse=True)
        
        # Return top k results
        return results[:k]
        
    def get_code_context(self, query: str, k: int = 3) -> str:
        """Get code context for a query.
        
        Args:
            query: Search query
            k: Number of code chunks to include
            
        Returns:
            Formatted code context as string
        """
        results = self.search_code(query, k)
        
        if not results:
            return ""
            
        context = "\n--- Relevant Code ---\n"
        
        for metadata, score in results:
            file_path = metadata.get('file_path', 'unknown')
            file_type = metadata.get('file_type', 'unknown')
            chunk = metadata.get('content', '')
            
            # Add to context
            context += f"\nFile: {file_path} ({file_type})\n```{file_type}\n{chunk}\n```\n"
                
        return context
        
    def add_code_to_memory(self, query: str, k: int = 3) -> None:
        """Add relevant code to memory based on a query.
        
        Args:
            query: Search query
            k: Number of code chunks to include
        """
        code_context = self.get_code_context(query, k)
        
        if not code_context:
            return
            
        # Add to memory
        self.memory_manager.add_memory(
            content=code_context,
            context=f"Code context for query: {query}",
            metadata={
                "timestamp": time.time(),
                "type": "code_context",
                "query": query
            }
        )
        
        logger.info(f"Added code context for query '{query}' to memory")
        
    def enhance_context_with_code(self, query: str, context: str, k: int = 2) -> str:
        """Enhance existing context with relevant code.
        
        Args:
            query: Search query
            context: Existing context
            k: Number of code chunks to include
            
        Returns:
            Enhanced context with code
        """
        code_context = self.get_code_context(query, k)
        
        if not code_context:
            return context
            
        # Combine contexts
        enhanced_context = context
        
        if enhanced_context and not enhanced_context.endswith("\n\n"):
            enhanced_context += "\n\n"
            
        enhanced_context += code_context
        
        return enhanced_context
