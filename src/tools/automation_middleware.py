"""
Automation Middleware - Bridge between command parsing and tool system
======================================================================

This middleware provides:
1. Fast-path execution for simple commands (no LLM needed)
2. Command parsing fallback for non-tool-calling models
3. Integration with the agent loop for seamless automation

Usage:
    from src.tools.automation_middleware import process_input
    
    # Returns (handled, result) tuple
    handled, result = process_input("open notepad")
    if handled:
        print(result)  # Automation executed
    else:
        # Pass to LLM for processing
        ...
"""

import re
import logging
from typing import Tuple, Optional, Dict, Any, List

from .automation_tool import (
    try_fast_path,
    AutomationResult,
    AutomationType,
    parse_fast_path,
    execute_automation,
    COMMON_WEBSITES,
)

logger = logging.getLogger("tools.automation_middleware")


# ============================================================================
# Input Processing
# ============================================================================

def process_input(
    text: str,
    allow_fast_path: bool = True,
    allow_command_parse: bool = True,
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    Process user input, attempting fast-path automation first.
    
    Args:
        text: User input text
        allow_fast_path: Whether to try fast-path execution
        allow_command_parse: Whether to try command parsing fallback
        
    Returns:
        (handled, result) tuple where:
        - handled: True if automation was executed
        - result: Dict with status, message, and details if handled
    """
    text = text.strip()
    
    if not text:
        return False, None
    
    # Try fast-path first (instant execution, no LLM)
    if allow_fast_path:
        result = try_fast_path(text)
        if result:
            logger.info(f"Fast-path executed: {result.automation_type.value}")
            return True, _result_to_dict(result)
    
    # Try command parsing fallback
    if allow_command_parse:
        parsed = _parse_command_fallback(text)
        if parsed:
            automation_type, value = parsed
            result = execute_automation(automation_type, value)
            logger.info(f"Command parse executed: {result.automation_type.value}")
            return True, _result_to_dict(result)
    
    return False, None


def _result_to_dict(result: AutomationResult) -> Dict[str, Any]:
    """Convert AutomationResult to dict."""
    return {
        "status": "success" if result.success else "error",
        "message": result.message,
        "automation_type": result.automation_type.value,
        "details": result.details or {},
    }


# ============================================================================
# Command Parsing Fallback
# ============================================================================

# Additional patterns for command parsing (more flexible than fast-path)
COMMAND_PATTERNS = {
    # App commands with more variations
    "open_app": [
        r"(?:can you |please |could you )?(?:open|launch|start|run)(?: up| the)?\s+(.+?)(?:\s+(?:app|application|for me))?$",
        r"(?:i want to |i need to |let's |let me )?(?:open|use)\s+(.+)$",
    ],
    
    # Search with more natural language
    "search_youtube": [
        r"(?:can you |please )?(?:find|search|look for|show)(?: me)?(?: a| an| the| some)?\s+(.+?)\s+(?:on|in|from)\s+(?:youtube|yt)$",
        r"(?:i want to |let's )?(?:watch|see|find)\s+(.+?)\s+(?:video|videos|on youtube)$",
        r"(?:youtube|yt)\s+(.+)$",
    ],
    
    "search_fitgirl": [
        r"(?:can you |please )?(?:find|search|look for|get)(?: me)?(?: a| an| the)?\s+(.+?)\s+(?:on|from|at)\s+(?:fitgirl|fg)$",
        r"(?:i want to |let's )?(?:download|get|find)\s+(.+?)\s+(?:repack|game|from fitgirl)$",
        r"(?:fitgirl|fg)\s+(.+)$",
    ],
    
    "search_apk": [
        r"(?:can you |please )?(?:find|search|look for|get)(?: me)?(?: a| an| the)?\s+(.+?)\s+apk$",
        r"(?:i want to |let's )?(?:download|get|find)\s+(.+?)\s+(?:android app|apk)$",
        r"apk\s+(?:for|of)\s+(.+)$",
    ],
    
    "search_google": [
        r"(?:can you |please )?(?:google|search for|look up)\s+(.+)$",
        r"(?:what is|what's|who is|who's|where is|where's)\s+(.+)\??$",
    ],
    
    "open_url": [
        r"(?:can you |please )?(?:go to|open|visit|navigate to)\s+(https?://\S+)$",
        r"(?:can you |please )?(?:go to|open|visit)\s+(?:the\s+)?(?:website\s+)?([\w.-]+\.(?:com|org|net|io|co|app|dev))$",
    ],
    
    "close_app": [
        r"(?:can you |please )?(?:close|quit|exit|stop|kill|terminate)\s+(.+?)(?:\s+(?:app|application|window))?$",
    ],
}


def _parse_command_fallback(text: str) -> Optional[Tuple[AutomationType, str]]:
    """
    Parse command using more flexible patterns.
    
    This is used as a fallback when fast-path doesn't match.
    """
    text_lower = text.lower().strip()
    
    for pattern_type, patterns in COMMAND_PATTERNS.items():
        for pattern in patterns:
            match = re.match(pattern, text_lower, re.IGNORECASE)
            if match:
                value = match.group(1).strip()
                
                # Skip if value is too short or looks like a question
                if len(value) < 2:
                    continue
                if value.endswith('?') and pattern_type not in ['search_google']:
                    continue
                
                automation_type = AutomationType(pattern_type)
                logger.debug(f"Command fallback match: {pattern_type} -> {value}")
                return (automation_type, value)
    
    # Check for website shortcuts with more variations
    for site, url in COMMON_WEBSITES.items():
        patterns = [
            f"(?:open|go to|visit|show me)\\s+{site}",
            f"{site}\\s+(?:please|now)?",
            f"take me to\\s+{site}",
        ]
        for pattern in patterns:
            if re.match(pattern, text_lower):
                return (AutomationType.OPEN_URL, url)
    
    return None


# ============================================================================
# Agent Integration
# ============================================================================

def create_automation_preprocessor(
    fast_path_enabled: bool = True,
    command_parse_enabled: bool = True,
):
    """
    Create a preprocessor function for the agent loop.
    
    This can be used to intercept user input before it reaches the LLM,
    executing automations directly when possible.
    
    Usage:
        preprocessor = create_automation_preprocessor()
        
        # In agent loop:
        handled, result = preprocessor(user_input)
        if handled:
            return result  # Skip LLM call
        else:
            # Continue with LLM processing
            ...
    """
    def preprocessor(text: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
        return process_input(
            text,
            allow_fast_path=fast_path_enabled,
            allow_command_parse=command_parse_enabled,
        )
    
    return preprocessor


def get_automation_system_prompt() -> str:
    """
    Get system prompt additions for models that support tool calling.
    
    This tells the model about available automations so it can use them.
    """
    return """
## Available Automations

You have access to fast desktop automations that execute instantly:

### App Control
- `open_app(app_name)` - Open any application via Start menu search
- `close_app(app_name)` - Close an application window

### Web Search
- `search_youtube(query)` - Search YouTube and click first result
- `search_fitgirl(query)` - Search FitGirl Repacks for games
- `search_apk(query)` - Search APKMirror for Android APKs
- `search_google(query)` - Search Google

### Browser
- `open_url(url)` - Open any URL in browser

### Input Simulation
- `type_text(text)` - Type text using keyboard
- `press_key(key)` - Press a single key
- `hotkey(keys)` - Press key combination (e.g., "ctrl+c")
- `click(x, y)` - Click at coordinates

Use these for quick actions instead of explaining how to do them manually.
"""


def get_non_tool_model_instructions() -> str:
    """
    Get instructions for models without tool calling support.
    
    This tells the model to use specific command formats that will be
    parsed and executed automatically.
    """
    return """
## Quick Commands

For fast actions, use these command formats (they execute instantly):

- "open [app name]" - Opens any application
- "close [app name]" - Closes an application
- "search [query] on youtube" - Searches YouTube and plays first result
- "search [query] on fitgirl" - Searches FitGirl Repacks
- "search [query] apk" - Searches for Android APKs
- "google [query]" - Searches Google
- "go to [url]" - Opens a website

Examples:
- "open notepad"
- "search lofi music on youtube"
- "search elden ring on fitgirl"
- "google python tutorials"
- "go to github.com"

These commands are executed directly without additional processing.
"""


# ============================================================================
# Response Parsing (for non-tool-calling models)
# ============================================================================

def parse_model_response(response: str) -> List[Tuple[AutomationType, str]]:
    """
    Parse a model's response for automation commands.
    
    This is useful for non-tool-calling models that might output
    commands in their response text.
    
    Returns list of (automation_type, value) tuples found.
    """
    commands = []
    
    # Look for command-like patterns in the response
    lines = response.split('\n')
    for line in lines:
        line = line.strip()
        
        # Skip empty lines and obvious non-commands
        if not line or line.startswith('#') or line.startswith('*'):
            continue
        
        # Try to parse as command
        parsed = parse_fast_path(line)
        if parsed:
            commands.append(parsed)
            continue
        
        parsed = _parse_command_fallback(line)
        if parsed:
            commands.append(parsed)
    
    return commands


def execute_commands_from_response(response: str) -> List[Dict[str, Any]]:
    """
    Parse and execute any automation commands found in a model response.
    
    Returns list of execution results.
    """
    commands = parse_model_response(response)
    results = []
    
    for automation_type, value in commands:
        result = execute_automation(automation_type, value)
        results.append(_result_to_dict(result))
    
    return results
