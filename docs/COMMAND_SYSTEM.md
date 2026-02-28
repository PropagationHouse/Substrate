# Substrate Command System

This document details the command system that enables Substrate to interpret and execute user commands.

## Overview

The command system processes natural language inputs and converts them into executable actions. It consists of three main components:

1. **Intent Classifier**: Determines whether user input is a command, search query, or chat message
2. **Command Parser**: Interprets user input and extracts command parameters
3. **Command Executor**: Executes identified commands with appropriate parameters

The system is designed to handle both explicit commands (like opening applications or searching the web) and natural language requests.

## Intent Classification

Located in `src/intent/intent_classifier.py`, the IntentClassifier determines the high-level intent of user input:

```python
class IntentType(Enum):
    COMMAND = "command"
    SEARCH = "search"
    CHAT = "chat"

class IntentClassifier:
    def __init__(self):
        # Command indicators - words that strongly suggest a command
        self.command_starters = {
            'open', 'launch', 'start', 'run', 'close', 'quit',
            'exit', 'kill', 'stop', 'shutdown', 'terminate', 'set',
            'check', 'manage'
        }

        # Search indicators
        self.search_starters = {
            'find', 'search', 'show', 'look', 'get', 'fetch',
            'display', 'watch', 'play', 'stream'
        }

        # Chat patterns and personal question patterns
        # ...
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

The classifier uses pattern matching to determine whether the input is:
- A command (e.g., "open notepad", "close chrome")
- A search query (e.g., "find information about Python", "search for weather")
- A chat message (e.g., "what do you think about...", "how are you")

## Command Parser

Located in `src/commands/command_parser.py`, the CommandParser class handles the processing of user input identified as commands:

```python
class CommandParser:
    def __init__(self):
        self.command_patterns = {
            # System commands
            r'^/config(?: (show|save|reset|help)(?: (.+))?)?$': self.handle_config_command,
            r'^/screenshot(?: (full|region|window))?$': self.handle_screenshot_command,
            r'^/search (.+)$': self.handle_search_command,
            r'^/note(?: (create|list|view|delete)(?: (.+))?)?$': self.handle_note_command,
            r'^/profile(?: (create|switch|delete|list)(?: (.+))?)?$': self.handle_profile_command,
            
            # Voice commands
            r'^/voice(?: (on|off|rate)(?: (.+))?)?$': self.handle_voice_command,
            
            # Help and system commands
            r'^/help(?: (.+))?$': self.handle_help_command,
            r'^/quit$': self.handle_quit_command,
            r'^/clear$': self.handle_clear_command,
            
            # Autonomous mode commands
            r'^/autonomous(?: (on|off|interval)(?: (.+))?)?$': self.handle_autonomous_command,
            
            # XGO commands
            r'^/xgo(?: (connect|disconnect|status)(?: (.+))?)?$': self.handle_xgo_command
        }
        
        # Intent recognition patterns
        self.intent_patterns = {
            'screenshot': [r'take a screenshot', r'capture( the)? screen', r'screenshot'],
            'search': [r'search for', r'look up', r'find information about'],
            'config': [r'change( the)? settings', r'update config', r'modify configuration'],
            'voice': [r'stop speaking', r'be quiet', r'speak (faster|slower)', r'enable voice', r'disable voice'],
            'note': [r'create a note', r'take notes', r'save this information', r'write this down'],
            'aurora': [r'aurora forecast', r'aurora map', r'show aurora', r'check aurora', r'aurora prediction', 
                      r'northern lights', r'aurora borealis'],
            'xgo': [r'connect to xgo', r'disconnect xgo', r'check xgo status', r'xgo connection']
        }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

### Command Parsing Process

```python
def parse_command(self, text):
    """Parse user input to identify commands"""
    # Check for direct command syntax (starting with /)
    if text.startswith('/'):
        return self.parse_direct_command(text)
    
    # Check for natural language commands
    return self.parse_natural_language(text)
    
def parse_direct_command(self, text):
    """Parse commands with direct syntax (/command)"""
    for pattern, handler in self.command_patterns.items():
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            # Extract command groups
            groups = match.groups()
            return handler(*groups) if groups else handler()
    
    # No matching command found
    return {
        'type': 'unknown_command',
        'text': text
    }
    
def parse_natural_language(self, text):
    """Parse natural language to identify command intents"""
    for intent, patterns in self.intent_patterns.items():
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                # Extract relevant parameters
                params = self.extract_parameters(intent, text)
                return {
                    'type': 'intent',
                    'intent': intent,
                    'text': text,
                    'params': params
                }
    
    # No intent identified, treat as chat
    return {
        'type': 'chat',
        'text': text
    }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Command Executor

Located in `src/commands/command_executor.py`, the CommandExecutor class handles the execution of identified commands:

```python
class CommandExecutor:
    def __init__(self, agent):
        self.agent = agent
        self.screenshot_handler = ScreenshotHandler()
        self.note_handler = NoteHandler(agent)
        
    def execute_command(self, command):
        """Execute a parsed command"""
        command_type = command.get('type')
        
        if command_type == 'config':
            return self.execute_config_command(command)
        elif command_type == 'screenshot':
            return self.execute_screenshot_command(command)
        elif command_type == 'search':
            return self.execute_search_command(command)
        elif command_type == 'note':
            return self.execute_note_command(command)
        elif command_type == 'voice':
            return self.execute_voice_command(command)
        elif command_type == 'profile':
            return self.execute_profile_command(command)
        elif command_type == 'system':
            return self.execute_system_command(command)
        elif command_type == 'intent':
            return self.execute_intent(command)
        else:
            return {
                'status': 'error',
                'result': f'Unknown command type: {command_type}'
            }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Command Types

### Configuration Commands

```python
def handle_config_command(self, action=None, param=None):
    """Handle configuration commands"""
    if not action:
        action = 'show'
        
    return {
        'type': 'config',
        'action': action,
        'param': param
    }
    
def execute_config_command(self, command):
    """Execute configuration commands"""
    action = command.get('action', 'show')
    param = command.get('param')
    
    if action == 'show':
        # Return current configuration
        return {
            'status': 'success',
            'type': 'config',
            'content': self.agent.config,
            'result': 'Current configuration'
        }
    elif action == 'save':
        try:
            # Parse and save new configuration
            new_config = json.loads(param) if param else {}
            self.agent.update_config(new_config)
            return {
                'status': 'success',
                'type': 'config',
                'content': self.agent.config,
                'result': 'Configuration updated successfully'
            }
        except Exception as e:
            return {
                'status': 'error',
                'result': f'Error updating configuration: {str(e)}'
            }
    elif action == 'reset':
        # Reset configuration to defaults
        self.agent.reset_config()
        return {
            'status': 'success',
            'type': 'config',
            'content': self.agent.config,
            'result': 'Configuration reset to defaults'
        }
    elif action == 'help':
        # Return configuration help
        return {
            'status': 'success',
            'result': 'Configuration commands: /config show, /config save {json}, /config reset'
        }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

### Screenshot Commands

```python
def handle_screenshot_command(self, mode=None):
    """Handle screenshot commands"""
    if not mode:
        mode = 'full'
        
    return {
        'type': 'screenshot',
        'mode': mode
    }
    
def execute_screenshot_command(self, command):
    """Execute screenshot commands"""
    mode = command.get('mode', 'full')
    
    try:
        # Capture screenshot
        screenshot = self.screenshot_handler.capture(mode)
        
        if not screenshot:
            return {
                'status': 'error',
                'result': 'Failed to capture screenshot'
            }
            
        # Process screenshot for LLM
        b64_image = self.screenshot_handler.process_for_llm(screenshot)
        
        return {
            'status': 'success',
            'type': 'screenshot',
            'image': b64_image,
            'result': f'Screenshot captured ({mode})'
        }
    except Exception as e:
        return {
            'status': 'error',
            'result': f'Error capturing screenshot: {str(e)}'
        }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

### Note Commands

```python
def handle_note_command(self, action=None, param=None):
    """Handle note commands"""
    if not action:
        action = 'create'
        
    return {
        'type': 'note',
        'action': action,
        'param': param
    }
    
def execute_note_command(self, command):
    """Execute note commands"""
    action = command.get('action', 'create')
    param = command.get('param')
    
    if action == 'create':
        # Create a new note
        note_id = self.note_handler.create_note(param)
        return {
            'status': 'success',
            'result': f'Note created with ID: {note_id}'
        }
    elif action == 'list':
        # List all notes
        notes = self.note_handler.list_notes()
        return {
            'status': 'success',
            'type': 'note_list',
            'content': notes,
            'result': f'Found {len(notes)} notes'
        }
    elif action == 'view':
        # View a specific note
        if not param:
            return {
                'status': 'error',
                'result': 'Note ID required'
            }
            
        note = self.note_handler.get_note(param)
        if not note:
            return {
                'status': 'error',
                'result': f'Note not found: {param}'
            }
            
        return {
            'status': 'success',
            'type': 'note',
            'content': note,
            'result': f'Note {param}'
        }
    elif action == 'delete':
        # Delete a note
        if not param:
            return {
                'status': 'error',
                'result': 'Note ID required'
            }
            
        success = self.note_handler.delete_note(param)
        if not success:
            return {
                'status': 'error',
                'result': f'Failed to delete note: {param}'
            }
            
        return {
            'status': 'success',
            'result': f'Note {param} deleted'
        }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Natural Language Intent Recognition

The system can recognize commands expressed in natural language:

```python
def extract_parameters(self, intent, text):
    """Extract parameters from natural language text"""
    params = {}
    
    if intent == 'screenshot':
        # Extract screenshot mode
        if re.search(r'full screen', text, re.IGNORECASE):
            params['mode'] = 'full'
        elif re.search(r'region', text, re.IGNORECASE):
            params['mode'] = 'region'
        elif re.search(r'window', text, re.IGNORECASE):
            params['mode'] = 'window'
        else:
            params['mode'] = 'full'
            
    elif intent == 'search':
        # Extract search query
        match = re.search(r'search for ["\']?([^"\']+)["\']?', text, re.IGNORECASE)
        if match:
            params['query'] = match.group(1)
        else:
            # Try alternative patterns
            match = re.search(r'look up ["\']?([^"\']+)["\']?', text, re.IGNORECASE)
            if match:
                params['query'] = match.group(1)
            else:
                # Extract everything after the intent phrase
                for pattern in self.intent_patterns['search']:
                    match = re.search(f'{pattern} (.*)', text, re.IGNORECASE)
                    if match:
                        params['query'] = match.group(1)
                        break
                        
    elif intent == 'voice':
        # Extract voice parameters
        if re.search(r'stop speaking|be quiet|mute', text, re.IGNORECASE):
            params['action'] = 'off'
        elif re.search(r'speak faster', text, re.IGNORECASE):
            params['action'] = 'rate'
            params['value'] = '1.5'
        elif re.search(r'speak slower', text, re.IGNORECASE):
            params['action'] = 'rate'
            params['value'] = '0.8'
        elif re.search(r'enable voice|start speaking', text, re.IGNORECASE):
            params['action'] = 'on'
            
    return params
    
def execute_intent(self, command):
    """Execute a natural language intent"""
    intent = command.get('intent')
    params = command.get('params', {})
    
    # Convert intent to command
    if intent == 'screenshot':
        return self.execute_screenshot_command({
            'type': 'screenshot',
            'mode': params.get('mode', 'full')
        })
    elif intent == 'search':
        return self.execute_search_command({
            'type': 'search',
            'query': params.get('query', '')
        })
    elif intent == 'voice':
        return self.execute_voice_command({
            'type': 'voice',
            'action': params.get('action', 'on'),
            'value': params.get('value')
        })
    # Handle other intents...
    elif intent == 'aurora':
        return self.execute_aurora_command({
            'type': 'search',
            'query': command.get('text', ''),
            'source': 'aurora'
        })
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Aurora Forecast Commands

The system supports aurora forecast commands to check aurora borealis activity:

```python
def _handle_weather_command(self, query, location):
    """Weather functionality has been removed. Only aurora forecast is supported."""
    # Only handle aurora forecast queries
    if 'aurora' in query.lower() and ('forecast' in query.lower() or 'show' in query.lower() or 'check' in query.lower()):
        return {'type': 'search', 'query': query.strip(), 'source': 'aurora'}
    # All other weather queries are disabled
    return None
    
def execute_aurora_command(self, command):
    """Execute aurora forecast commands"""
    query = command.get('query', '')
    
    try:
        # Open aurora forecast website
        url = "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast"
        webbrowser.open(url)
        
        return {
            'status': 'success',
            'result': f"Opening aurora forecast for your viewing. The aurora forecast shows the current and predicted aurora activity."
        }
    except Exception as e:
        return {
            'status': 'error',
            'result': f"Error accessing aurora forecast: {str(e)}"
        }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Command Help System

The system includes a help command to provide guidance on available commands:

```python
def handle_help_command(self, topic=None):
    """Handle help command"""
    return {
        'type': 'help',
        'topic': topic
    }
    
def execute_help_command(self, command):
    """Execute help command"""
    topic = command.get('topic')
    
    if not topic:
        # General help
        return {
            'status': 'success',
            'result': """
Available commands:
/config [show|save|reset] - Manage configuration
/screenshot [full|region|window] - Capture screenshots
/search <query> - Search the web
/note [create|list|view|delete] - Manage notes
/profile [create|switch|delete|list] - Manage profiles
/voice [on|off|rate] - Control voice
/help [topic] - Show help
/quit - Exit application
/clear - Clear chat history

You can also use natural language to issue commands.
Type /help <command> for more information on a specific command.
            """
        }
    else:
        # Topic-specific help
        help_topics = {
            'config': 'Configuration commands:\n/config show - Display current configuration\n/config save {json} - Update configuration\n/config reset - Reset to defaults',
            'screenshot': 'Screenshot commands:\n/screenshot - Capture full screen\n/screenshot region - Capture selected region\n/screenshot window - Capture active window',
            'search': 'Search command:\n/search <query> - Search the web for the specified query',
            'note': 'Note commands:\n/note create [text] - Create a new note\n/note list - List all notes\n/note view <id> - View a specific note\n/note delete <id> - Delete a note',
            'profile': 'Profile commands:\n/profile create <name> - Create a new profile\n/profile switch <name> - Switch to a profile\n/profile delete <name> - Delete a profile\n/profile list - List all profiles',
            'voice': 'Voice commands:\n/voice on - Enable voice\n/voice off - Disable voice\n/voice rate <value> - Set voice speed (0.5-2.0)',
            'aurora': 'Aurora commands:\nUse natural language to check aurora forecasts:\n- "show aurora forecast"\n- "check aurora borealis"\n- "aurora prediction"\n- "northern lights forecast"'
        }
        
        if topic in help_topics:
            return {
                'status': 'success',
                'result': help_topics[topic]
            }
        else:
            return {
                'status': 'error',
                'result': f'Unknown help topic: {topic}'
            }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Integration with LLM

The command system integrates with the LLM to handle ambiguous requests:

```python
def process_with_llm(self, text):
    """Process ambiguous text with LLM to identify commands"""
    prompt = f"""
The user has sent the following message:
"{text}"

Determine if this is a command or a general chat message.
If it's a command, identify the command type and parameters.
Respond in JSON format with the following structure:
{{
  "is_command": true/false,
  "command_type": "screenshot|search|config|voice|note|profile",
  "parameters": {{}}
}}
"""
    
    # Send to LLM for processing
    response = self.agent.query_llm(prompt)
    
    try:
        # Parse LLM response
        result = json.loads(response)
        
        if result.get('is_command'):
            # Convert to command format
            command_type = result.get('command_type')
            parameters = result.get('parameters', {})
            
            return {
                'type': command_type,
                **parameters
            }
        else:
            # Not a command
            return {
                'type': 'chat',
                'text': text
            }
    except:
        # Failed to parse LLM response
        return {
            'type': 'chat',
            'text': text
        }
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Security Considerations

The command system implements several security measures:

1. **Input Validation**: All command parameters are validated before execution
2. **Restricted System Access**: System commands are limited to safe operations
3. **Error Handling**: All commands include robust error handling
4. **Logging**: Commands are logged for security auditing

```python
def validate_command(self, command):
    """Validate command before execution"""
    command_type = command.get('type')
    
    if command_type == 'system':
        # Validate system commands
        action = command.get('action')
        if action not in ['info', 'time', 'memory', 'processes']:
            return False, 'Unauthorized system command'
            
    # Other validation rules...
    
    return True, None
```

### Command Pattern Examples

#### Search Commands

```python
# Search command patterns
self.search_patterns = [
    # Direct search commands
    r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
    # YouTube specific searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
    # Game searches (FitGirl)
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
    # APK searches
    r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
]
```

Examples:
- "search for Python tutorials"
- "find Python tutorials on YouTube"
- "look up weather forecast"

#### Close Commands

```python
# Close command patterns
self.close_patterns = [
    r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
    r'shut down(?: the)? (.*?)(?: app| application)?$',
    r'stop(?: the)? (.*?)(?: app| application)?$',
]
```

Examples:
- "close notepad"
- "quit chrome"
- "terminate visual studio code app"

#### Note Creation

```python
# Note creation patterns
self.note_patterns = [
    r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
    r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
]
```

Examples:
- "create a note about Python programming"
- "write a new document about machine learning"

#### Retry Commands

```python
# Retry patterns
self.retry_patterns = [
    r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
    r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
]
```

Examples:
- "try again"
- "try again with more context"

### Parsing Process

The main parsing function analyzes user input and returns a structured command object:

```python
def parse(self, text):
    """Parse the input text and return command info"""
    # Check for YouTube URLs
    for pattern in self.youtube_url_patterns:
        if re.search(pattern, text):
            return {
                'type': 'web',
                'url': text.strip()
            }
            
    # Check for retry commands
    for pattern in self.retry_patterns:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            additional_context = match.group(1) if match.groups() else None
            return {
                'type': 'retry',
                'context': additional_context
            }
    
    # Check for app commands
    # ...
    
    # Check for web commands
    # ...
    
    # Check for search commands
    # ...
    
    # If no specific command matched, treat as chat
    return None  # Let it be handled as chat
```

## Best Practices for Extending

When adding new commands:

1. Add command patterns to `command_patterns` dictionary
2. Add intent patterns to `intent_patterns` dictionary
3. Create handler and executor methods
4. Update help documentation
5. Implement proper validation and error handling
