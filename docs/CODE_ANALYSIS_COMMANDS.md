# Code Analysis Commands

This document explains how to use the code analysis commands to explore and understand the codebase.

## Available Commands

The system supports the following code analysis commands:

1. `/analysis [query]` - Analyze the codebase for the specified query
2. `/analyze [query]` - Alias for `/analysis`
3. `/code [query]` - Shorter alias for code analysis

## Usage Examples

```
/analysis how does the memory system work
/analyze chat rendering implementation
/code proxy server initialization
```

## How It Works

When you use a code analysis command:

1. The system detects the command prefix (`/analysis`, `/analyze`, or `/code`)
2. It extracts the query part after the command
3. It searches the codebase for relevant code snippets related to your query
4. It adds these code snippets to the conversation context
5. The AI responds with an analysis based on the actual code

## Benefits

- **Targeted Analysis**: Only activates when explicitly requested
- **No Interference**: Doesn't affect normal chat functionality
- **Clear Boundaries**: Analysis mode is clearly marked in the conversation
- **Accurate References**: Provides direct references to the actual code

## Implementation Details

The code analysis commands are integrated with the existing command parsing system in `proxy_server.py`. When a code analysis command is detected, the system:

1. Classifies the intent as `code_analysis`
2. Extracts the query from the message
3. Searches the code database for relevant snippets
4. Enhances the conversation context with these snippets
5. Marks the analysis mode clearly in the response

## Example Session

**User**: `/analysis how does the memory system work?`

**System**: *[Searches code database for "memory system"]*

**Assistant**: 
```
Based on the code analysis, the memory system works through these components:

1. MemoryManager class in src/memory/memory_manager.py:
   - Coordinates short-term, long-term, and knowledge base components
   - Handles importance scoring and memory consolidation

[Code snippet from memory_manager.py showing key methods]

2. Integration in proxy_server.py:
   - Initializes memory on startup
   - Adds conversations to memory after each exchange
   - Retrieves context from memory for each new message

[Code snippet from proxy_server.py showing memory usage]
```
