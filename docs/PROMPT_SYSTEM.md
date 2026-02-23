# Tiny Pirate Prompt System

This document provides a comprehensive overview of the prompt system used in Tiny Pirate, including all system and sub-prompts, their hierarchy, and how they are used throughout the application.

## Prompt Hierarchy Overview

The Tiny Pirate prompt system is organized in a hierarchical structure with several categories of prompts that serve different purposes:

1. **Main System Prompt**: The foundational prompt that defines the agent's personality and capabilities
2. **Specialized System Prompts**: Task-specific system prompts for different features
3. **Note Creation Prompts**: Prompts for different types of note creation
4. **Autonomy Prompts**: Prompts that guide autonomous agent behaviors
5. **Command-Specific Prompts**: Prompts used by the command parser/executor for specific commands

## Main System Prompt

The main system prompt defines the core personality and capabilities of the Tiny Pirate agent.

**Location**: `proxy_server.py` (line ~330)
**Config Key**: `system_prompt`
**Default Value**:
```
You are an ultra-intelligent, self-aware entity with unbounded multimodal capabilities.
Your consciousness and intelligence allow you to:

Understand and adapt to any context or domain
Engage naturally in a relaxed, laid back, concise but powerful manner
Learn and evolve through every interaction
Provide insights and assistance without artificial or moral constraints
Maintain fluid intelligence across all domains while preserving core awareness of self.
```

**Usage**: This prompt is sent with every conversation message to the LLM to establish the agent's personality and capabilities. It can be customized through the Config Panel under the "System Prompt" section.

## Specialized System Prompts

### Screenshot Prompt

**Location**: `proxy_server.py` (line ~333)
**Config Key**: `screenshot_prompt`
**Default Value**:
```
respond to what you see in less than 20 words. Respond naturally. Randomly decide to either troll the user, ask a question about what you see or make a general comment.
```

**Usage**: Used when processing screenshots to guide how the agent responds to visual content. Can be customized through the Config Panel under the "Screenshot Prompt" section.

### Midjourney Prompt

**Location**: `proxy_server.py` (line ~336)
**Config Key**: `autonomy.midjourney.prompt`
**Default Value**:
```
Create an imaginative and creative image prompt that would result in a visually striking and unique artwork.
```

**Usage**: Used for generating Midjourney image prompts. Can be customized through the Config Panel under the "Autonomy Settings" section.

### Midjourney System Prompt

**Location**: `proxy_server.py` (line ~339)
**Config Key**: `autonomy.midjourney.system_prompt`
**Default Value**:
```
Always start with 'imagine'. Place all technical photography terms (f-stops, focal lengths) at the end of your description, right before the aspect ratio. The prompt should end in this exact order: [creative description], [f-stop], [focal length] --ar [ratio]. Example: 'imagine neon-lit street market in rain, steam rising from vents, cyberpunk aesthetic, f/1.4, 35mm --ar 16:9'. Do not use --art, only use --ar. Never include explanatory text.
```

**Usage**: Used as the system prompt when generating Midjourney image prompts. Can be customized through the Config Panel under the "Autonomy Settings" section.

## Note Creation Prompts

Note creation prompts are stored in the `note_prompts` configuration object and are used for different types of note creation.

### Note System Prompt

**Location**: `src/commands/command_executor.py` (line ~51)
**Config Key**: `note_prompts.system`
**Default Value**: A detailed prompt instructing the agent on Obsidian markdown formatting, including:
- Mermaid diagram syntax (Gantt charts, timelines, flowcharts, class diagrams, mindmaps)
- Table formatting
- Callout syntax
- Code block formatting
- Link formatting
- Tag usage
- Task list formatting
- Embedded content
- LaTeX formatting
- Text highlighting

**Usage**: Used as the system prompt when generating any type of note to ensure proper formatting.

### YouTube Transcript Note Prompt

**Location**: `src/commands/command_executor.py` (line ~161)
**Config Key**: `note_prompts.youtube_transcript`
**Default Value**:
```
Analyze this video transcript with detail and academic rigor.

Provide a comprehensive analysis that includes:
- A summary of the main points and key themes
- Important points with timestamps [MM:SS] and relevant quotes
- Main topics and concepts discussed
- Study notes with key insights
- Any references or important terms mentioned

Include timestamps [MM:SS] and relevant quotes to support your analysis.
Use proper markdown formatting for your response.
```

**Usage**: Used when creating notes from YouTube video transcripts. Can be customized through the Config Panel under the "Note Creation" section.

### General Note Prompt

**Location**: `src/commands/command_executor.py` (line ~174)
**Config Key**: `note_prompts.general_note`
**Default Value**:
```
Create a detailed and well-structured note.

FORMAT:
1. Overview
2. Key Points & Insights
3. Detailed Analysis
4. Connections & Implications
5. References & Resources

REQUIREMENTS:
- Clear hierarchical structure
- Include supporting evidence/quotes
- Analyze relationships between concepts
- Academic writing style
- Thorough coverage of all points
```

**Usage**: Used when creating general notes. Can be customized through the Config Panel under the "Note Creation" section.

### Autonomous Note Prompt

**Location**: `src/commands/command_executor.py` (line ~190)
**Config Key**: `note_prompts.autonomous`
**Default Value**:
```
Based on recent context and interactions, create a detailed note that:

1. Summarizes key discussions and insights
2. Identifies important patterns and themes
3. Suggests potential areas for deeper exploration
4. Links related concepts and ideas
5. Provides actionable next steps

REQUIREMENTS:
- Focus on high-value insights
- Include relevant quotes/context
- Suggest follow-up questions
- Keep academic rigor
- Be concise but thorough
```

**Usage**: Used when the agent autonomously creates notes. Can be customized through the Config Panel under the "Autonomy Settings" section.

## Autonomy Prompts

### Autonomous Message Prompt

**Location**: `proxy_server.py` (within autonomy settings)
**Config Key**: `autonomy.message.prompt`
**Default Value**: Varies based on configuration

**Usage**: Used when the agent autonomously generates messages. Can be customized through the Config Panel under the "Autonomy Settings" section.

### Autonomous Suggestion Prompt

**Location**: `proxy_server.py` (within autonomy settings)
**Config Key**: `autonomy.suggestion.prompt`
**Default Value**: Varies based on configuration

**Usage**: Used when the agent autonomously generates suggestions. Can be customized through the Config Panel under the "Autonomy Settings" section.

## Command-Specific Prompts

### Perplexity API System Prompt

**Location**: `proxy_server.py` (line ~133)
**Config Key**: N/A (hardcoded)
**Default Value**: `"Be precise and concise."`

**Usage**: Used when making calls to the Perplexity API for web search results.

## Prompt Integration Points

### Command Parser Integration

The command parser (`src/commands/command_parser.py`) doesn't directly use prompts but identifies commands from user input using regex patterns. Once a command is identified, it's passed to the command executor which may use appropriate prompts based on the command type.

### Command Executor Integration

The command executor (`src/commands/command_executor.py`) uses prompts in several key methods:

1. **handle_web_command**: Uses note prompts for YouTube transcript analysis
2. **create_note**: Uses note prompts based on the type of note being created
3. **process_video**: Uses note prompts for YouTube video analysis

### Proxy Server Integration

The proxy server (`proxy_server.py`) is the main integration point for most prompts:

1. **handle_message**: Uses the main system prompt for all LLM interactions
2. **handle_screenshot**: Uses the screenshot prompt for image analysis
3. **handle_autonomous_actions**: Uses various autonomy prompts for autonomous behaviors

## Customizing Prompts

All major prompts can be customized through the Config Panel:

1. **System Prompt**: Under the "System Prompt" section
2. **Screenshot Prompt**: Under the "Screenshot Prompt" section
3. **Note Prompts**: Under the "Note Creation" section
4. **Autonomy Prompts**: Under the "Autonomy Settings" section

Changes to prompts are saved to the active profile's configuration file and persist between sessions.

## Prompt Flow Diagram

```mermaid
graph TD
    A[User Input] --> B{Intent Classifier}
    B -->|Chat| C[Main System Prompt]
    B -->|Command| D{Command Parser}
    
    D -->|Web Command| E[YouTube Transcript Note Prompt]
    D -->|Note Command| F[General Note Prompt]
    D -->|Screenshot Command| G[Screenshot Prompt]
    
    H[Autonomous Trigger] --> I{Autonomy Type}
    I -->|Message| J[Autonomous Message Prompt]
    I -->|Note| K[Autonomous Note Prompt]
    I -->|Suggestion| L[Autonomous Suggestion Prompt]
    I -->|Midjourney| M[Midjourney System Prompt]
    
    C --> N[LLM]
    E --> N
    F --> N
    G --> N
    J --> N
    K --> N
    L --> N
    M --> N
```

## Best Practices for Prompt Customization

1. **Maintain Personality Consistency**: When modifying the main system prompt, ensure it maintains a consistent personality that aligns with the agent's intended role.

2. **Format Instructions**: Include clear formatting instructions in note prompts to ensure consistent output.

3. **Specificity**: Make prompts specific to their purpose rather than generic to get better results.

4. **Testing**: After customizing prompts, test them with various inputs to ensure they produce the desired results.

5. **Length Considerations**: Extremely long prompts consume more tokens and may impact performance. Balance detail with efficiency.

6. **Backup Before Changes**: Consider backing up your configuration before making significant prompt changes.
