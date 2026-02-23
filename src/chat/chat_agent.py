"""ChatAgent class for handling conversation context and note creation triggers."""

import re
import datetime
from typing import List, Dict, Any, Optional, Tuple

class ChatAgent:
    """Manages conversation context and handles natural language triggers for note creation."""
    
    def __init__(self, memory_manager=None, command_executor=None):
        """Initialize the ChatAgent with optional memory manager and command executor."""
        self.memory_manager = memory_manager
        self.command_executor = command_executor
        self.note_triggers = [
            r"create\s+(?:a\s+)?note\s+(?:about|on)\s+that",
            r"make\s+(?:a\s+)?note\s+(?:about|of)\s+that",
            r"take\s+notes?\s+on\s+that",
            r"create\s+(?:a\s+)?plan\s+(?:around|for)\s+that",
            r"make\s+(?:a\s+)?plan\s+for\s+that",
            r"summarize\s+this\s+in\s+(?:a\s+)?note",
            r"make\s+(?:a\s+)?note\s+about\s+our\s+conversation",
            r"create\s+(?:a\s+)?note\s+from\s+(?:our|this)\s+conversation"
        ]
        self.plan_triggers = [
            r"create\s+(?:a\s+)?plan",
            r"make\s+(?:a\s+)?plan",
            r"develop\s+(?:a\s+)?plan",
            r"plan\s+for"
        ]
        
    def set_memory_manager(self, memory_manager):
        """Set the memory manager after initialization."""
        self.memory_manager = memory_manager
        
    def set_command_executor(self, command_executor):
        """Set the command executor after initialization."""
        self.command_executor = command_executor
        
    def is_note_creation_trigger(self, message: str) -> bool:
        """Check if a message contains a note creation trigger."""
        message = message.lower()
        for trigger in self.note_triggers:
            if re.search(trigger, message):
                return True
        return False
        
    def is_plan_creation_trigger(self, message: str) -> bool:
        """Check if a message contains a plan creation trigger."""
        message = message.lower()
        for trigger in self.plan_triggers:
            if re.search(trigger, message):
                return True
        return False
        
    def get_recent_messages(self, count: int = 10) -> List[Dict[str, Any]]:
        """Get recent conversation messages from memory manager."""
        if self.memory_manager:
            return self.memory_manager.short_term.get_recent(count)
        return []
        
    def format_conversation_context(self, messages: List[Dict[str, Any]]) -> str:
        """Format conversation messages into a readable context."""
        formatted_messages = []
        for i, msg in enumerate(messages):
            if 'content' in msg:
                role = "User" if i % 2 == 0 else "Assistant"
                formatted_messages.append(f"{role}: {msg['content']}")
        return "\n\n".join(formatted_messages)
        
    def handle_note_creation_request(self, message: str) -> Dict[str, Any]:
        """Handle a note creation request based on conversation context."""
        if not self.command_executor:
            return {
                "status": "error",
                "result": "Command executor not available",
                "speak": True
            }
            
        # Get recent conversation context
        recent_messages = self.get_recent_messages(10)
        conversation_context = self.format_conversation_context(recent_messages)
        
        # Determine if this is a plan or regular note
        is_plan = self.is_plan_creation_trigger(message)
        note_type = "plan" if is_plan else "note"
        
        # Create the prompt for note generation
        if is_plan:
            prompt = f"Create a note based on:\nCreate a detailed action plan\n\nContext:\n{conversation_context}"
        else:
            prompt = f"Create a note based on:\nSummarize and organize the key information\n\nContext:\n{conversation_context}"
        
        # Create the note using the command executor
        result = self.command_executor.create_note(prompt, pre_processed=False)
        
        # Enhance the response with details about the note content
        if result.get("status") == "success":
            # Get the last note content for reference
            note_content = self.command_executor.last_note_content
            
            # Create a summary of what was included in the note
            summary = f"I've created a {note_type} based on our conversation that includes the key points we discussed."
            
            # Add the summary to the result
            result["result"] = summary
            
            # Store the note creation event in memory
            if self.memory_manager:
                self.memory_manager.add_memory(
                    f"Created a {note_type} in Obsidian with content: {note_content[:100]}...",
                    context="note_creation"
                )
                
        return result
