# Memory System Documentation

This document provides a comprehensive overview of the memory system implemented in Tiny Pirate.

## Architecture Overview

The memory system is designed with a multi-layered approach to store, retrieve, and manage conversation history and important information:

1. **Short-term Memory**: Handles the active chat session
2. **Long-term Memory**: Persists important information in SQLite with importance scoring
3. **Knowledge Base**: Enables semantic search using vector embeddings

## File Structure and Storage Locations

```
Tiny Pirate/
├── src/
│   └── memory/
│       └── memory_manager.py   # Core memory system implementation
├── data/
│   ├── chat_memory.db         # SQLite database for long-term memory
│   ├── conversation_history.json # Legacy memory storage
│   ├── vector_store           # Vector embeddings for semantic search
│   └── vector_store.json      # Companion file for vector store
└── proxy_server.py           # Integration with chat system
```

**Important Update**: The implementation now uses a dedicated data directory:
- `DATA_DIR = Path(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data'))`
- `DB_PATH = DATA_DIR / "chat_memory.db"`
- `VECTOR_PATH = DATA_DIR / "vector_store"`

This ensures that memory files are always stored in the `data` directory within the application folder, regardless of the working directory or folder name.

### File Path Resolution

Memory files are now created in the application's data directory:
- `[Application Directory]/data/chat_memory.db`
- `[Application Directory]/data/vector_store/`
- `[Application Directory]/data/conversation_history.json`

This makes the memory system portable and independent of the folder name or working directory.

## Key Components

### ShortTermMemory

Manages the active chat session memory:

- Stores messages in an in-memory list
- Limited by a configurable maximum size (default: 100 messages)
- Automatically removes oldest messages when the limit is reached
- Each message contains content, timestamp, and optional metadata

### LongTermMemory

Handles persistent storage of important information:

- Uses SQLite database (`chat_memory.db`)
- Stores memories with importance scores, context, and metadata
- Provides retrieval based on text queries
- Implements cleanup of old, low-importance memories

### KnowledgeBase

Enables semantic search capabilities:

- Uses SentenceTransformer ('all-MiniLM-L6-v2') for text embeddings
- Stores vector embeddings using FAISS for efficient similarity search
- Saves index and texts to disk for persistence
- Provides semantic search functionality

### MemoryManager

Coordinates all memory systems:

- Integrates short-term, long-term, and knowledge base components
- Scores memory importance based on content and context
- Adds memories to appropriate storage systems based on importance
- Provides unified search across all memory systems
- Handles memory consolidation and cleanup

## Memory Flow

1. **Memory Creation**:
   - New messages are added to short-term memory
   - Importance is scored based on content and context
   - Important memories (score > 0.7) are added to long-term memory and knowledge base

2. **Memory Retrieval**:
   - Short-term: Returns most recent messages
   - Long-term: Text-based search in SQLite
   - Knowledge base: Semantic search using vector embeddings
   - Combined search results from all systems

3. **Memory Management**:
   - Short-term: Automatic removal of oldest messages when limit is reached
   - Long-term: Periodic cleanup of old, low-importance memories
   - Knowledge base: Continuous addition of important information

## Importance Scoring

The system automatically scores memory importance based on:

- Content length (longer content generally scores higher)
- Presence of code blocks (adds 0.2 to score)
- Specific keywords ("important", "remember", "key", "critical", "bug", "error")
- Context matches with important keywords

## Privacy and Data Control

The memory system is designed to be privacy-focused:
- All data is stored locally
- No external services are required for memory functionality
- User has full control over stored data

## Current Implementation Notes

1. **Relative Path Issue**: The current implementation uses relative paths for database and vector store, which may result in files being created in the working directory (potentially Desktop) rather than the main application folder.

2. **Integration Points**: The memory system integrates with:
   - Chat interface for message storage and retrieval
   - Knowledge base for semantic search
   - Profile management system to maintain separate memories per profile

## Recommendations for Improvement

1. **Absolute Paths**: Update storage paths to use absolute paths within the application directory:
   ```python
   DB_PATH = Path(__file__).parent.parent.parent / "data" / "chat_memory.db"
   VECTOR_PATH = Path(__file__).parent.parent.parent / "data" / "vector_store"
   ```

2. **Profile-Specific Storage**: Implement profile-specific memory storage to keep memories separate between profiles.

3. **Memory Export/Import**: Add functionality to export and import memories for backup and transfer purposes.

4. **Enhanced Importance Scoring**: Improve the importance scoring algorithm with more sophisticated NLP techniques.

5. **Memory Visualization**: Create a UI component to visualize and manage stored memories.

## Technical Details

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT,
    importance_score FLOAT,
    context TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata JSON
)
```

### Vector Embeddings

- Dimension: 384 (based on all-MiniLM-L6-v2 model)
- Index type: FAISS IndexFlatL2 (L2 distance for similarity)
- Storage: Binary index file + JSON companion file for texts

## Implementation Details

### Integration with Chat System

The memory system is integrated with the chat system in `proxy_server.py` through the following components:

1. **Initialization**:
   ```python
   # Import the memory manager
   from src.memory.memory_manager import MemoryManager
   
   # Initialize in ChatAgent.__init__
   self.memory_manager = MemoryManager()  # Advanced memory system
   self.memory = self.load_memory()       # Legacy memory system (for compatibility)
   ```

2. **Adding Memories**:
   ```python
   def add_to_memory(self, user_message, assistant_response, model):
       # Legacy memory storage
       entry = {
           "timestamp": time.time(),
           "model": model,
           "user_message": user_message,
           "assistant_response": assistant_response
       }
       self.memory.insert(0, entry)
       
       # Advanced memory system
       content = f"User: {user_message}\nAssistant: {assistant_response}"
       context = f"Model: {model}"
       metadata = {
           "timestamp": time.time(),
           "model": model,
           "user_message": user_message,
           "assistant_response": assistant_response
       }
       self.memory_manager.add_memory(content, context, metadata)
   ```

3. **Retrieving Context**:
   ```python
   def get_recent_context(self):
       # Try advanced memory system first
       memory_results = self.memory_manager.search("", limit=5)
       
       # Format results from different memory layers
       context_str = ""
       if memory_results['semantic']:
           for item, _ in memory_results['semantic']:
               context_str += f"{item}\n\n"
       
       # Fall back to legacy memory if needed
       if not context_str.strip() and self.memory:
           sorted_memory = sorted(self.memory, key=lambda x: x['timestamp'], reverse=True)
           for entry in sorted_memory[:5]:
               context_str += f"User: {entry['user_message']}\nAssistant: {entry['assistant_response']}\n\n"
       
       return context_str
   ```

4. **Using Context in Chat**:
   ```python
   def chat_response(self, message, image_data=None, override_messages=None, model_override=None):
       # Get recent context if no override messages
       context = ""
       if not override_messages and not image_data:
           context = self.get_recent_context()
       
       # Add context to system messages
       if context:
           messages.append({
               "role": "system",
               "content": f"Previous conversation context:\n{context}"
           })
   ```

### Usage Instructions

#### How Memory Works

1. **Automatic Memory**: The system automatically stores all conversations in both memory systems:
   - Legacy system: Simple JSON storage in `data/conversation_history.json`
   - Advanced system: Multi-layered storage with SQLite and vector embeddings

2. **Context Retrieval**: When you ask a question, the system:
   - Searches for relevant past conversations using both exact and semantic matching
   - Adds the most relevant conversations as context for the AI
   - Ensures the AI remembers important details from previous interactions

3. **Importance Scoring**: Not all memories are treated equally:
   - Longer, more detailed conversations get higher importance scores
   - Code blocks and technical content are prioritized
   - Keywords like "important", "remember", "key" increase importance

#### Customizing Memory

You can customize the memory system by modifying these parameters in `src/memory/memory_manager.py`:

- `IMPORTANCE_THRESHOLD`: Minimum score for long-term storage (default: 0.7)
- `ShortTermMemory.max_size`: Maximum number of messages in short-term memory (default: 100)
- Importance scoring weights in `MemoryManager.score_importance()`

#### Troubleshooting

If the system isn't remembering conversations properly:

1. Check that the data directory exists and contains memory files:
   - `data/chat_memory.db`
   - `data/vector_store`
   - `data/conversation_history.json`

2. Verify that the memory is being added correctly by checking logs:
   - Look for "Added memory to advanced memory system" messages
   - Check "Retrieved context for chat" messages

3. If memory files are missing, ensure the application has write permissions to the data directory.

4. For debugging, set logging level to DEBUG to see detailed memory operations.

## Recent Improvements

### Path Independence

The memory system has been updated to work regardless of folder name or working directory:

- **Dedicated Data Directory**: All memory files are now stored in a `data` directory within the application folder
- **Absolute Path Resolution**: Paths are constructed using the application's location rather than relative paths
- **Automatic Directory Creation**: The data directory is created automatically if it doesn't exist

### Enhanced Integration

The memory system is now fully integrated with the chat system:

- **Dual Memory Systems**: Both legacy and advanced memory systems work in parallel for reliability
- **Fallback Mechanism**: If the advanced system fails, the legacy system provides backup
- **Improved Context Formatting**: Better formatting of memory content for more effective context

### Debugging and Logging

Additional logging has been added to track memory operations:

- **Memory Addition Logging**: Logs when memories are added to the system
- **Context Retrieval Logging**: Logs when context is retrieved for chat
- **Error Handling**: Better error handling for memory operations

### Performance Optimizations

- **Asynchronous Saving**: Memory is saved asynchronously to avoid blocking the main thread
- **Empty Message Filtering**: Empty messages are skipped to avoid cluttering the memory
- **Metadata Enrichment**: More detailed metadata for better search and retrieval
