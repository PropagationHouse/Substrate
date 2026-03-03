import re
from enum import Enum

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

        # Strong single-word search triggers that should always indicate a search when they start a query
        self.search_starters = {
            'find', 'search', 'show', 'look', 'get', 'fetch',
            'display', 'watch', 'play', 'stream'
        }

        # Personal question patterns (always chat)
        self.personal_patterns = [
            r'^what (?:do|did|would|will) you',  # "what do you think"
            r'^what (?:are|were) you',  # "what are you doing"
            r'^what\'s your',  # "what's your opinion"
            r'^what is your',  # "what is your name"
            r'^how (?:do|did|would|will) you',  # "how do you feel"
            r'^how (?:are|were) you',  # "how are you doing"
            r'^why (?:do|did|would|will) you',  # "why do you think"
            r'^where (?:do|did|would|will) you',  # "where do you live"
            r'^when (?:do|did|would|will) you',  # "when do you sleep"
            r'^do you',  # "do you like"
            r'^can you',  # "can you help"
            r'^could you',  # "could you explain"
            r'^would you',  # "would you prefer"
            r'^are you',  # "are you sure"
            r'^have you',  # "have you tried"
            r'^tell me (?:your|what you)',  # "tell me your thoughts"
            r'^give me your',  # "give me your opinion"
            r'^i\'m (?:still |just |)thinking',  # "i'm still thinking"
            r'^i (?:want|need) it to',  # "i want it to be"
        ]

        # Chat patterns - common conversational patterns
        self.chat_patterns = [
            r'^(?:that\'s|thats) \w+$',  # "that's cool", "that's interesting"
            r'^(?:i|we) (?:see|get|understand)',  # "i see", "i get it"
            r'^(?:yes|no|maybe|ok|okay|sure|definitely|absolutely)(?:\s|$)',  # Single word responses
            r'^(?:thanks|thank you|ty)',  # Gratitude
            r'^(?:nice|good|great|awesome|excellent|amazing)',  # Single positive adjectives
            r'(?:lol|haha|hehe)',  # Laughter
            r'^(?:oh|ah|hmm|huh|wow|well)',  # Interjections
            r'^i (?:think|believe|feel|guess)',  # Personal opinions
            r'^(?:really|seriously|honestly|basically|actually)',  # Conversational starters
            r'^not (?:really |quite |)sure',  # Uncertainty expressions
            r'^still thinking',  # Thinking expressions
        ]

        # Casual question starters (2-3 words that are likely chat)
        self.casual_questions = {
            "what's up", "whats up", "what up",
            "how's it", "hows it", "how is it",
            "how are", "how're", "how r",
            "what's good", "whats good",
            "how about", "what about",
            "what do", "what if",
            "how do", "how can"
        }

        # Strong search indicators - these override other patterns
        self.strong_search_indicators = {
            'show me', 'find me', 'search for', 'look up',
            'tell me about', 'where can i find', 'how do i',
            'what is the', 'where is the', 'when is the',
            'who is the', 'why is the', 'which is the',
            'explain how', 'explain why', 'steps to',
            'guide for', 'tutorial on', 'help me find',
            'help me with', 'help me understand',
            'can you find', 'can you show', 'please show',
            'please find', 'please tell me about', 'could you find',
            'could you show', 'where to find', 'how to find'
        }

        # Regular search indicators - used with other context
        self.search_indicators = {
            'how to', 'what is', 'where is', 'when is',
            'who is', 'why does', 'which', 'whose',
            'explain', 'define', 'compare', 'difference between',
            'steps to', 'guide for', 'tutorial'
        }

    def classify(self, text):
        """
        Classify the intent of user input
        Returns: IntentType
        """
        if not text:
            return IntentType.CHAT

        text = text.lower().strip()
        words = text.split()
        first_word = words[0] if words else ''
        first_two = ' '.join(words[:2]) if len(words) >= 2 else ''
        first_three = ' '.join(words[:3]) if len(words) >= 3 else ''

        # Check for personal questions first (always chat)
        if any(re.match(pattern, text) for pattern in self.personal_patterns):
            return IntentType.CHAT

        # Check for casual questions (always chat)
        if first_two in self.casual_questions or first_three in self.casual_questions:
            return IntentType.CHAT

        # Check for chat patterns
        if any(re.match(pattern, text) for pattern in self.chat_patterns):
            return IntentType.CHAT

        # Check for strong search indicators
        for indicator in self.strong_search_indicators:
            if indicator in text:
                return IntentType.SEARCH

        # Check for command starters
        if first_word in self.command_starters:
            return IntentType.COMMAND

        # Check for search starters
        if first_word in self.search_starters:
            return IntentType.SEARCH

        # Check for regular search indicators
        for indicator in self.search_indicators:
            if indicator in text:
                return IntentType.SEARCH

        # Default to chat for anything else
        return IntentType.CHAT

    def explain_classification(self, text):
        """
        Explain why the text was classified as it was
        Useful for debugging and improving the classifier
        """
        text = text.lower().strip()
        words = text.split()
        first_word = words[0] if words else ''
        
        if first_word in self.command_starters:
            return f"Classified as COMMAND because it starts with '{first_word}'"

        for pattern in self.personal_patterns:
            if re.match(pattern, text):
                return f"Classified as CHAT because it matches personal pattern '{pattern}'"

        if first_word in self.search_starters:
            return f"Classified as SEARCH because it starts with search trigger '{first_word}'"

        for indicator in self.strong_search_indicators:
            if indicator in text:
                return f"Classified as SEARCH because it contains strong search indicator '{indicator}'"

        for pattern in self.chat_patterns:
            if re.search(pattern, text):
                return f"Classified as CHAT because it matches pattern '{pattern}'"

        for phrase in self.casual_questions:
            if text.startswith(phrase):
                return f"Classified as CHAT because it starts with casual phrase '{phrase}'"

        for indicator in self.search_indicators:
            if indicator in text:
                if len(words) <= 3 and not any(char.isdigit() for char in text):
                    return f"Classified as CHAT because although it contains search indicator '{indicator}', it's too short"
                return f"Classified as SEARCH because it contains indicator '{indicator}'"

        if len(words) <= 2:
            return "Classified as CHAT because it's very short"

        if text.endswith('?') and len(words) <= 3:
            return "Classified as CHAT because it's a short question"

        if text.endswith('?') and len(words) > 3:
            return "Classified as SEARCH because it's a longer question"

        return "Classified as CHAT by default (no strong indicators found)"
