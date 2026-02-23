# Code Memory System Documentation

This document provides a comprehensive overview of the Code Memory system implemented in Tiny Pirate, which enables the AI assistant to analyze and reference its own codebase.

## Overview

The Code Memory system extends the existing memory architecture by adding codebase awareness, allowing the AI to:

1. **Analyze its own code**: Understand its implementation details
2. **Answer code-related questions**: Provide context-aware responses about the codebase
3. **Self-debug**: Reference relevant code when troubleshooting issues
4. **Provide implementation details**: Explain how features are implemented

## Architecture

The Code Memory system consists of three main components:

1. **CodebaseEmbedder**: Scans, processes, and embeds the codebase
2. **CodeMemory**: Integrates codebase embeddings with the memory system
3. **Integration with ChatAgent**: Enhances context with relevant code snippets

## File Structure

```
Tiny Pirate/
├── src/
│   └── memory/
│       ├── memory_manager.py   # Core memory system
│       ├── codebase_embedder.py # Codebase embedding functionality
│       └── code_memory.py      # Code memory integration
├── data/
│   ├── code_vector_store       # Vector embeddings of code
│   └── code_vector_store.json  # Metadata for code embeddings
└── embed_codebase.py           # Script to generate initial embeddings
```

## How It Works

### 1. Codebase Embedding Process

The system processes the codebase through the following steps:

1. **Scanning**: The codebase is scanned for relevant files (ignoring binary files, libraries, etc.)
2. **Chunking**: Files are split into overlapping chunks of code
3. **Embedding**: Each chunk is converted to a vector embedding using SentenceTransformer
4. **Indexing**: Embeddings are stored in a FAISS index for efficient similarity search
5. **Metadata Storage**: File paths, types, and positions are stored alongside embeddings

### 2. Code Search and Retrieval

When a user asks a code-related question:

1. The system detects code-related keywords in the query
2. It converts the query to a vector embedding
3. It searches the code embeddings for similar chunks
4. It retrieves the most relevant code snippets with their file context
5. It adds these snippets to the conversation context

### 3. Integration with Memory System

The Code Memory system integrates with the existing memory architecture:

1. It extends the context retrieval process to include code snippets
2. It uses the same vector embedding technology as the knowledge base
3. It follows the same privacy-focused, local-first approach

## Technical Details

### Embedding Model

- **Model**: SentenceTransformer ('all-MiniLM-L6-v2')
- **Dimension**: 384
- **Index**: FAISS IndexFlatL2 (L2 distance for similarity)

### Chunking Strategy

- **Chunk Size**: 1000 characters
- **Overlap**: 200 characters
- This balance ensures that:
  - Chunks are small enough for precise retrieval
  - Overlap is sufficient to maintain context across chunk boundaries

### File Filtering

The system ignores:
- Binary files (.exe, .dll, etc.)
- Media files (.jpg, .png, etc.)
- Generated files (.pyc, etc.)
- External libraries (node_modules, venv, etc.)
- Git metadata (.git)

## Usage

### Generating Codebase Embeddings

To generate or update the codebase embeddings:

```bash
python embed_codebase.py
```

This will:
1. Scan the entire codebase
2. Generate embeddings for all code files
3. Save the embeddings to the data directory
4. Run test queries to verify functionality

### Code-Related Queries

The system automatically detects code-related queries using keywords like:
- code, function, class, method, implementation
- bug, error, fix, debug
- programming, develop, script, module
- syntax, variable, algorithm, codebase

When these keywords are detected, relevant code snippets are added to the context.

## Performance Considerations

- **Embedding Generation**: This is a one-time process that may take several minutes depending on codebase size
- **Memory Usage**: The embeddings typically require 10-50MB of disk space for a medium-sized project
- **Search Speed**: Code search is fast (typically <100ms) due to the FAISS index

## Privacy and Security

The Code Memory system maintains the privacy-focused approach of the main memory system:
- All code embeddings are stored locally
- No code is sent to external services
- The system only processes files within the project directory

## Example Interactions

### Example 1: Implementation Question

**User**: "How is the memory system implemented?"

**System**: *[Searches code embeddings for "memory system implementation"]*

**Response**: *[Includes relevant snippets from memory_manager.py with explanation]*

### Example 2: Debugging Question

**User**: "Why is the chat rendering not working?"

**System**: *[Searches code embeddings for "chat rendering"]*

**Response**: *[Includes relevant snippets from direct_chat_renderer.js with analysis]*

## Future Improvements

1. **Code Change Tracking**: Automatically update embeddings when code changes
2. **Function-Level Chunking**: Use AST parsing for more semantic code chunks
3. **Multi-File Context**: Connect related code across multiple files
4. **Code Generation Assistance**: Use code context to assist with code generation
5. **Visual Code Map**: Create a visualization of the codebase structure
