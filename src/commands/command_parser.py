import re
import json
import os
import traceback
from ..intent.intent_classifier import IntentClassifier, IntentType

class CommandParser:
    def __init__(self):
        # Load editable command parser config (disabled triggers, aliases, etc.)
        self._config_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), '..', '..', 'command_parser_config.json'
        )
        self._cp_config = self._load_cp_config()

        # Load macro triggers from macros/ directory for fast-path matching
        self._macro_triggers = self._load_macro_triggers()

        # Load command patterns from knowledge base
        base_path = os.path.dirname(os.path.abspath(__file__))
        windows_path = os.path.join(base_path, '..', '..', 'knowledge', 'windows', 'cmd_commands.json')
        edge_path = os.path.join(base_path, '..', '..', 'knowledge', 'shortcuts', 'app_specific', 'browsers', 'edge.json')

        with open(windows_path, 'r') as file:
            self.command_patterns = json.load(file)['commands']

        with open(edge_path, 'r') as file:
            self.shortcut_patterns = json.load(file)['shortcuts']

        # Note creation patterns
        self.note_patterns = [
            r'^(?:create|write)(?: a| the)?(?: new)? note(?: about| saying| that says)? (.+?)$',
            r'^(?:write|create)(?: a| the)?(?: new)? (?:page|document|reference|text)(?: about| on| for)? (.+?)$',
            r'^(?:write|create)(?: a| the)?(?: new)? (.+?)$'
        ]
        
        # YouTube URL patterns
        self.youtube_url_patterns = [
            r'https?://(?:www\.)?youtube\.com/watch\?v=[\w-]+(?:&t=\d+s?)?',  # Standard with optional timestamp
            r'https?://youtu\.be/[\w-]+(?:\?t=\d+s?)?'  # Shortened with optional timestamp
        ]
        
        # Retry patterns
        self.retry_patterns = [
            r'^(?:okay |now |let\'s )?try again(?: with| and make it)? (.+?)?$',
            r'^(?:okay |now |let\'s )?do it again(?: with| and make it)? (.+?)?$'
        ]

        # Document keywords that should trigger note creation
        self.doc_keywords = {
            'page', 'document', 'reference', 'text', 'note'
        }

        # Initialize intent classifier
        self.intent_classifier = IntentClassifier()

        # System apps that should always be treated as app commands
        self.system_apps = {
            'task manager',
            'control panel',
            'file explorer',
            'settings',
            'command prompt',
            'powershell',
            'terminal',
            'calculator',
            'notepad',
        }

        # Web command patterns
        self.web_patterns = [
            r'open (?:the )?(https?://\S+)',  # Full URLs
            r'(?:go to|open|launch) (?:the )?(?:website )?(?:www\.)?([\w-]+\.com)',  # Domain names
            r'open (?:the )?(youtube|you ?tube|u ?tube|yourtube|utube|google|github)',  # Common websites
        ]
        
        # App command patterns - now more comprehensive
        self.app_patterns = [
            # Direct commands for any app
            r'^(?:open|launch|start|run)(?: up| the)? (.+?)(?:\s+(?:app|application))?$',
            # Show/display commands for system apps
            r'^(?:show|display|bring up)(?: me)?(?: the)? (.+?)(?:\s+(?:app|application))?$',
            # General app commands
            r'^(.+?)(?:\s+(?:app|application))?$',  # Fallback pattern for system apps only
        ]

        # Close command patterns
        self.close_patterns = [
            r'(?:close|quit|exit|terminate|end|kill)(?: the)? (.*?)(?: app| application)?$',
            r'shut down(?: the)? (.*?)(?: app| application)?$',
            r'stop(?: the)? (.*?)(?: app| application)?$',
        ]

        # Search command patterns
        self.search_patterns = [
            # Direct search commands
            r'(?:search for|look up|find|show me) (.+?)(?:\s+(?:on|in|using)\s+([\w]+))$',
            # YouTube specific searches
            r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:youtube|yt)$',
            r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) videos?$',
            # Game searches (FitGirl)
            r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:fitgirl|fg)$',
            # APK searches - updated patterns for better detection
            r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:apk)$',
            r'(?:find|search for|look up|show me)(?: a| an| the)? (.+?) (?:on|in) (?:apk|apkpure|apkmirror)$',
        ]

        # APK search patterns
        self.apk_patterns = [
            # Specific site patterns with APK keyword
            r'(?:search |find |look for |show me |get |)(?:a |the |)(?:apk for |apk of |)(?P<title>.*?)(?: on | in | at |)(?P<source>apkpure|apkmirror)(?:\s|$)',
            r'(?:search |find |look for |show me |get |)(?:a |the |)(?:apk for |apk of |)(?P<title>.*?)(?:\s|$)(?:on |in |at |)(?P<source>apkpure|apkmirror)(?:\s|$)',
            
            # Generic APK patterns - must include "apk" keyword
            r'(?:search |find |look for |show me |get |)(?:the |an |a |)apk (?:for |of |)(?P<title>.*?)(?:\s|$)',
            r'(?:search |find |look for |show me |get |)(?P<title>.*?)(?:\s|)apk(?:\s|$)',
            r'(?P<title>.*?)(?:\s|)apk(?:\s|$)'
        ]

        # Game search patterns
        self.game_patterns = [
            r'(?:search |find |look for |show me |get |)(?:a |the |)(?:copy of |download |repack of |)(?P<title>.*?)(?: on | in | at |)(?P<source>fitgirl|fg)(?:\s|$)',
            r'(?:search |find |look for |show me |get |)(?:a |the |)(?:copy of |download |repack of |)(?P<title>.*?)(?:\s|$)(?:on |in |at |)(?P<source>fitgirl|fg)(?:\s|$)',
            r'(?:search |find |look for |show me |get |)(?:a |the |)(?P<source>fitgirl|fg)(?:\s|$)(?:copy of |download |repack of |)(?P<title>.*?)(?:\s|$)',
            r'(?:search |find |look for |show me |get |)(?P<source>fitgirl|fg)(?:\s|$)(?:for |)(?P<title>.*?)(?:\s|$)'
        ]

        # Clock command patterns
        self.clock_patterns = [
            r'^(?:set|create|add)(?: an?)? alarm(?: for)? (.+)$',
            r'^(?:check|show|tell me|what(?:\'s| is))(?: the)? (?:current )?time(?:\?)?$',
            r'^(?:what(?:\'s| is))(?: the)? time(?:\?)?$',
            r'^what time is it(?:\?)?$',
            r'^(?:do you know )?what(?:\'s| is) the time(?:\?)?$',
            r'^(?:start|stop|pause|reset|manage)(?: the)? timer$'
        ]
        
        # System command patterns
        self.system_patterns = [
            r'^(?:restart|reboot|shutdown|turn off)(?: the)? computer$',
            r'^(?:log off|sign out|lock)(?: the)? computer$',
            r'^(?:sleep|hibernate)(?: the)? computer$',
        ]

        # Midjourney imagine patterns
        self.midjourney_patterns = [
            r'^imagine (.+)$',  # Captures everything after 'imagine' to end of line
            r'^/imagine (.+)$'  # Captures everything after '/imagine' to end of line
        ]

        # Question patterns that should remain as chat
        self.chat_patterns = [
            r'^(?:why|what|how|when|where|who|explain|tell me about|describe) (?:is |are |was |were |do |does |did |has |have |had |would |could |should |will |can |might )?.+',
            r'^(?:can you|could you) (?:explain|tell me|help me understand|clarify) .+',
            r'^(?:i (?:want|need|would like) to know|i\'m curious|i wonder) .+',
            r'^(?:what\'s|what is) (?:your|the) (?:opinion|thought|take|view) .+'
        ]

    # Weather command handling has been completely removed

    def _load_cp_config(self):
        """Load command parser config from JSON file."""
        defaults = {
            "disabled_triggers": [],
            "disabled_categories": [],
            "custom_aliases": {},
            "custom_triggers": {},
            "first_sentence_only": True,
        }
        try:
            if os.path.exists(self._config_path):
                with open(self._config_path, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                # Merge with defaults so new keys are always present
                for k, v in defaults.items():
                    loaded.setdefault(k, v)
                return loaded
        except Exception:
            pass
        return dict(defaults)

    def reload_config(self):
        """Hot-reload config from disk (called after UI saves)."""
        self._cp_config = self._load_cp_config()
        self._macro_triggers = self._load_macro_triggers()

    def save_config(self, new_config):
        """Save updated command parser config to disk."""
        # Merge with existing to preserve unknown keys
        merged = dict(self._cp_config)
        merged.update(new_config)
        try:
            with open(self._config_path, 'w', encoding='utf-8') as f:
                json.dump(merged, f, indent=2)
        except Exception:
            pass
        self._cp_config = merged

    def get_config(self):
        """Return current command parser config (for API/UI)."""
        return dict(self._cp_config)

    def _is_trigger_disabled(self, trigger_word):
        """Check if a trigger word has been disabled by the user."""
        disabled = self._cp_config.get('disabled_triggers', [])
        return trigger_word.lower() in [d.lower() for d in disabled]

    def _is_category_disabled(self, category):
        """Check if an entire command category has been disabled."""
        disabled = self._cp_config.get('disabled_categories', [])
        return category.lower() in [d.lower() for d in disabled]

    def _load_macro_triggers(self):
        """Load macro triggers from macros/ directory.
        
        Returns list of {trigger, macro_id, first_variable} sorted longest-first
        so "post to x" matches before "post".
        """
        triggers = []
        macros_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), '..', '..', 'macros'
        )
        if not os.path.isdir(macros_dir):
            return triggers

        for fname in os.listdir(macros_dir):
            if not (fname.endswith('.py') or fname.endswith('.ps1')):
                continue
            fpath = os.path.join(macros_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    raw = f.read(2000)
                # Quick frontmatter parse
                if not raw.startswith('---'):
                    continue
                end = raw.find('---', 3)
                if end == -1:
                    continue
                fm = raw[3:end]
                
                macro_id = os.path.splitext(fname)[0].lower()
                trigger_line = ''
                first_var = None
                in_variables = False
                
                for line in fm.split('\n'):
                    stripped = line.strip()
                    if stripped.startswith('triggers:'):
                        trigger_line = stripped[len('triggers:'):].strip()
                    elif stripped.startswith('variables:'):
                        in_variables = True
                    elif in_variables and (line.startswith('  ') or line.startswith('\t')):
                        if ':' in stripped and first_var is None:
                            first_var = stripped.split(':')[0].strip()
                    elif not line.startswith(' ') and not line.startswith('\t'):
                        in_variables = False
                
                if trigger_line:
                    for t in trigger_line.split(','):
                        t = t.strip().strip('"\'').lower()
                        if t:
                            triggers.append({
                                'trigger': t,
                                'macro_id': macro_id,
                                'first_variable': first_var,
                            })
            except Exception:
                continue

        # Sort longest trigger first so "post to x" matches before "post"
        triggers.sort(key=lambda x: len(x['trigger']), reverse=True)
        return triggers

    def _match_macro(self, text_lower, original_text):
        """Check if text matches any macro trigger.
        
        Returns {'type': 'macro', 'name': macro_id, 'variables': {...}} or None.
        Supports patterns like:
          "post to x: hello world"  → trigger="post to x", content="hello world"
          "tweet this is cool"      → trigger="tweet", content="this is cool"
          "quick post hey everyone" → trigger="quick post", content="hey everyone"
        """
        for entry in self._macro_triggers:
            trigger = entry['trigger']
            
            if text_lower.startswith(trigger):
                # Slice from original text to preserve case
                rest = original_text[len(trigger):].strip()
                # Strip leading colon/dash separator if present
                if rest and rest[0] in (':', '-'):
                    rest = rest[1:].strip()
                
                variables = {}
                if entry['first_variable'] and rest:
                    variables[entry['first_variable']] = rest
                
                return {
                    'type': 'macro',
                    'name': entry['macro_id'],
                    'variables': variables,
                }
        
        return None

    def _is_youtube_search_intent(self, text_lower):
        """Check if the user intends to SEARCH YouTube, not just mention it.
        
        Returns True only when youtube/yt is used as a destination:
          - "find cats on youtube"       → True  (youtube is the last word)
          - "youtube lofi beats"         → True  (youtube is the first word, search follows)
          - "pull up X on yt"            → True  (yt at end after on/in)
        Returns False when youtube is just mentioned in context:
          - "get the transcript of this youtube video"  → False
          - "what is this youtube link about"           → False
          - "summarize this youtube.com/watch?v=..."    → False
        """
        words = text_lower.split()
        if not words:
            return False
        
        yt_terms = {'youtube', 'yt', 'utube', 'yourtube'}
        yt_terms_spaced = ['you tube', 'u tube']
        
        # youtube/yt is the LAST word (e.g. "find cats on youtube")
        last_word = words[-1].rstrip('.,!?')
        if last_word in yt_terms:
            return True
        
        # Check spaced variants at end (e.g. "find cats on you tube")
        for term in yt_terms_spaced:
            if text_lower.rstrip('.,!? ').endswith(term):
                return True
        
        # youtube/yt is the FIRST word followed by content (e.g. "youtube lofi beats")
        first_word = words[0]
        if first_word in yt_terms and len(words) > 1:
            return True
        
        return False

    def parse(self, text):
        """Parse input and return command info, respecting disabled categories."""
        result = self._parse_inner(text)
        if result and self._is_category_disabled(result.get('type', '')):
            return None
        return result

    def _parse_inner(self, text):
        """Core parse logic. Returns command dict or None.
        
        Commands are zero-thinking fast-path directives. Only the FIRST
        SENTENCE of the input is checked for command triggers. If the user
        writes a multi-sentence message, the command words buried later
        should fall through to the LLM instead of firing mindlessly.
        """
        if not text:
            return None
        
        # Convert to lowercase once for case-insensitive matching
        text_lower = text.strip().lower()
        first_line = text_lower.split('\n')[0].strip()
        
        # ── First-sentence guard ──────────────────────────────────────
        # Commands are no-thinking directives. Only match the first sentence
        # so buried command words don't fire mindlessly.
        if self._cp_config.get('first_sentence_only', True):
            first_sentence = re.split(r'[.!?\n]', text_lower)[0].strip()
            if len(text_lower) > len(first_sentence) + 10:
                text_lower = first_sentence
                first_line = first_sentence
        
        # ── Custom alias expansion ────────────────────────────────────
        # If the first word matches a user-defined alias, swap it in.
        # e.g. alias "go" → "open" makes "go chrome" → "open chrome"
        aliases = self._cp_config.get('custom_aliases', {})
        if aliases:
            first_word = text_lower.split()[0] if text_lower.split() else ''
            if first_word in aliases:
                replacement = aliases[first_word]
                text_lower = replacement + text_lower[len(first_word):]
                first_line = replacement + first_line[len(first_word):]
        
        # First check for YouTube-specific commands to ensure they take priority
        # Only trigger when youtube/yt is used as a DESTINATION (end of query)
        # e.g. "find cats on youtube" YES, "get transcript of this youtube video" NO
        if self._is_youtube_search_intent(text_lower):
            # YouTube search patterns
            youtube_patterns = [
                r'(?:search|find|look up|show me|pull up|play)(?: for)? (.+?) (?:on|in) (?:youtube|you ?tube|u ?tube|yourtube|utube|yt)$',
                r'^(?:youtube|yt)(?: search| for)? (.+)',
            ]
            
            for pattern in youtube_patterns:
                match = re.search(pattern, text_lower)
                if match:
                    query = match.group(1).strip()
                    return {
                        'type': 'search',
                        'query': query,
                        'source': 'youtube'
                    }
        
        # Check for aurora forecast command
        aurora_phrases = [
            'aurora forecast', 'aurora map', 'show aurora', 'check aurora',
            'aurora prediction', 'aurora forecast map', 'show me aurora',
            'show the aurora', 'show me the aurora', 'check the aurora'
        ]
        
        # Check for any aurora phrase in the text
        if any(phrase in text_lower for phrase in aurora_phrases):
            # Aurora forecast command detected
            return {
                'type': 'web',
                'name': 'aurora_forecast',
                'urls': [
                    # Primary URL - NOAA aurora forecast image
                    'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg',
                    # Secondary URLs
                    'https://www.swpc.noaa.gov/communities/space-weather-enthusiasts',
                    'https://www.swpc.noaa.gov/products/real-time-solar-wind'
                ]
            }
        
        # Check if it's a retry command
        for pattern in self.retry_patterns:
            match = re.match(pattern, text, re.IGNORECASE)
            if match:
                content = match.group(1) if match.lastindex else ''
                return {
                    'type': 'note',
                    'action': 'retry',
                    'content': content.strip()
                }
        
        # Check for YouTube URL patterns — only auto-open if the URL is
        # essentially the whole message (bare link paste).  If the user wrote
        # additional words around it (e.g. "get the transcript of <url>"),
        # let the LLM handle it instead of hijacking the request.
        for pattern in self.youtube_url_patterns:
            match = re.search(pattern, text)
            if match:
                youtube_url = match.group(0)
                # Strip the URL from the message and check what's left
                remaining = text.replace(youtube_url, '').strip()
                # Only auto-open if there are at most 2 trivial words left
                # (e.g. "play" or "open this") — anything more is a real query
                if len(remaining.split()) <= 2:
                    return {
                        'type': 'web',
                        'name': 'youtube',
                        'url': youtube_url.strip()
                    }
        
        # Check for Midjourney imagine patterns
        for pattern in self.midjourney_patterns:
            match = re.match(pattern, text.lower())
            if match:
                prompt = match.group(1).strip()
                # DEBUG: Midjourney imagine pattern matched: {pattern}")
                # DEBUG: Prompt: {prompt}")
                return {
                    'type': 'search',
                    'query': prompt,
                    'source': 'midjourney'
                }
        
        # Check for macro triggers (zero-LLM fast-path)
        macro_match = self._match_macro(text_lower, text.strip())
        if macro_match:
            return macro_match
                
        # Check for chat patterns to avoid misclassifying questions
        for pattern in self.chat_patterns:
            if re.match(pattern, text.lower()):
                return None  # Let it be handled as chat
                
        # Check for document creation first to avoid false matches
        first_line = text.split('\n')[0].lower()
        if first_line.startswith(('create', 'write')):
            # Check if it's explicitly a document creation request
            for pattern in self.note_patterns:
                match = re.match(pattern, first_line)
                if match:
                    parts = text.split('\n', 1)
                    remainder = parts[1].strip() if len(parts) > 1 else ''
                    content = remainder if remainder else (match.group(1) if match.groups() else '')
                    return {
                        'type': 'note',
                        'action': 'create',
                        'content': content
                    }
            
            # Check if first word after create/write is a document keyword
            words = first_line.split()
            if len(words) > 1 and any(kw in words[1:3] for kw in self.doc_keywords):
                parts = text.split('\n', 1)
                remainder = parts[1].strip() if len(parts) > 1 else ''
                return {
                    'type': 'note',
                    'action': 'create',
                    'content': remainder
                }
        
        # Check if first word after create/write is a document keyword
        words = first_line.split()
        if len(words) > 1 and any(kw in words[1:3] for kw in self.doc_keywords):
            content = text[len(first_line):].strip()
            return {
                'type': 'note',
                'action': 'create',
                'content': content
            }
        
        # Check for open/launch/start/close commands first - HIGHEST PRIORITY AFTER AURORA
        # Build open pattern dynamically, filtering out disabled triggers
        # and including any user-added custom triggers for the 'app' category
        if not self._is_category_disabled('app'):
            custom_app = self._cp_config.get('custom_triggers', {}).get('app', [])
            open_verbs = [v for v in ['open', 'launch', 'start', 'run'] + custom_app if not self._is_trigger_disabled(v)]
            if open_verbs:
                open_pattern = r'^(?:' + '|'.join(re.escape(v) for v in open_verbs) + r')\s+(?:the\s+)?(.+?)(?:\s+(?:app|application))?$'
                match = re.match(open_pattern, text_lower)
                if match:
                    app_name = match.group(1).strip()
                    if not any(term in app_name for term in ['youtube', 'search for', 'look up', 'google earth']):
                        return {
                            'type': 'app',
                            'name': app_name,
                            'action': 'open'
                        }
            
            # Then check for close commands
            close_verbs = [v for v in ['close', 'quit', 'exit', 'terminate', 'end'] if not self._is_trigger_disabled(v)]
            if close_verbs:
                close_pattern = r'^(?:' + '|'.join(close_verbs) + r')\s+(?:the\s+)?(.+?)(?:\s+(?:app|application))?$'
                match = re.match(close_pattern, text_lower)
                if match:
                    app_name = match.group(1).strip()
                    return {
                        'type': 'app',
                        'name': app_name,
                        'action': 'close'
                    }
    
        # Check for specific command patterns first
        # YouTube search — only when youtube/yt is the destination (end of query)
        youtube_patterns = [
            r'(?:search|find|look up|show me|pull up|play)(?: for)? (.+?) (?:on|in) (?:youtube|you ?tube|u ?tube|yourtube|utube|yt)$',
            r'^(?:youtube|you ?tube|u ?tube|yourtube|utube|yt)(?: search| for)? (.+)',
        ]
        for pattern in youtube_patterns:
            match = re.search(pattern, text.lower())
            if match:
                return {
                    'type': 'search',
                    'query': match.group(1).strip(),
                    'source': 'youtube'
                }
                
        # SFlix search patterns
        sflix_patterns = [
            r'(?:search|find|look up|show me)(?: for)? (.+?) (?:on|in) (?:sflix|streaming)',
            r'(?:sflix|streaming)(?: search| for)? (.+)',
            r'(?:search|find|look up|show me)(?: for)? (.+?) (?:movie|show|series|film)'
        ]
        for pattern in sflix_patterns:
            match = re.search(pattern, text.lower())
            if match:
                return {
                    'type': 'search',
                    'query': match.group(1).strip(),
                    'source': 'sflix'
                }
                
        # APK search - must explicitly mention APK
        for pattern in self.apk_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                title = match.group('title').strip()
                return {
                    'type': 'web',
                    'name': 'apk_search',
                    'query': title
                }
                
        # Game search - must match game patterns
        for pattern in self.game_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return {
                    'type': 'search',
                    'query': match.group('title').strip() if 'title' in match.groupdict() else '',
                    'source': 'games'
                }
                
        # Note creation
        for pattern in self.note_patterns:
            match = re.match(pattern, first_line, re.IGNORECASE)
            if match:
                parts = text.split('\n', 1)
                remainder = parts[1].strip() if len(parts) > 1 else ''
                content = remainder if remainder else match.group(1).strip()
                return {
                    'type': 'note',
                    'action': 'create',
                    'content': content
                }
                
        # General search patterns
        for pattern in self.search_patterns:
            match = re.match(pattern, text, re.IGNORECASE)
            if match:
                query = match.group(1) if match.groups() else text
                source = match.group(2) if len(match.groups()) > 1 else None
                
                # Handle YouTube searches — only when the explicit source/destination is youtube
                if source and source.lower().replace(' ', '') in ['youtube', 'yourtube', 'utube', 'yt']:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'youtube'
                    }
                # Other search types will be handled by their specific patterns below
        
        # YouTube search patterns — only match when youtube/yt is the destination
        youtube_patterns = [
            r'(?:search|find|look up|show me|pull up|play)(?: for)? (.+?) (?:on|in) (?:youtube|you ?tube|u ?tube|yourtube|utube|yt)$',
            r'^(?:youtube|you ?tube|u ?tube|yourtube|utube|yt)(?: search| for)? (.+)',
        ]
        for pattern in youtube_patterns:
            match = re.search(pattern, text.lower())
            if match:
                return {
                    'type': 'search',
                    'query': match.group(1).strip(),
                    'source': 'youtube'
                }
                
        # SFlix search patterns
        sflix_patterns = [
            r'(?:search|find|look up|show me)(?: for)? (.+?) (?:on|in) (?:sflix|streaming)',
            r'(?:sflix|streaming)(?: search| for)? (.+)',
            r'(?:search|find|look up|show me)(?: for)? (.+?) (?:movie|show|series|film)'
        ]
        for pattern in sflix_patterns:
            match = re.search(pattern, text.lower())
            if match:
                return {
                    'type': 'search',
                    'query': match.group(1).strip(),
                    'source': 'sflix'
                }
                
        # APK search - must explicitly mention APK
        for pattern in self.apk_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                title = match.group('title').strip()
                return {
                    'type': 'web',
                    'name': 'apk_search',
                    'query': title
                }
                
        # Game search - must match game patterns
        for pattern in self.game_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return {
                    'type': 'search',
                    'query': match.group('title').strip() if 'title' in match.groupdict() else '',
                    'source': 'games'
                }
                
        # Note creation
        for pattern in self.note_patterns:
            match = re.match(pattern, first_line, re.IGNORECASE)
            if match:
                return {
                    'type': 'note',
                    'action': 'create',
                    'content': match.group(1).strip()
                }
                
        # Additional search patterns check
        for pattern in self.search_patterns:
            match = re.match(pattern, text, re.IGNORECASE)
            if match:
                query = match.group(1) if match.groups() else text
                source = match.group(2) if len(match.groups()) > 1 else None
                
                # Handle YouTube searches — only when explicit source is youtube
                if source and source.lower().replace(' ', '') in ['youtube', 'yourtube', 'utube', 'yt']:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'youtube'
                    }
                # Handle FitGirl/game searches
                elif source and source.lower() in ['fitgirl', 'fg']:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'games'
                    }
                # Handle APK searches
                elif source and source.lower() in ['apk', 'apkpure', 'apkmirror'] or 'apk' in text.lower():
                    # DEBUG: APK search pattern matched: {query}")
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'apk'
                    }
                # General search
                else:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': source.lower() if source else None
                    }
                
        # Clock commands
        for pattern in self.clock_patterns:
            match = re.match(pattern, text, re.IGNORECASE)
            if match:
                return {
                    'type': 'clock',
                    'action': self._determine_clock_action(text),
                    'time': match.group(1) if match.groups() else None
                }
                
        # Only check for search if it's an explicit search command
        for pattern in self.search_patterns:
            match = re.match(pattern, text, re.IGNORECASE)
            if match:
                query = match.group(1) if match.groups() else text
                source = match.group(2) if len(match.groups()) > 1 else None
                
                # Handle YouTube searches — only when explicit source is youtube
                if source and source.lower().replace(' ', '') in ['youtube', 'yourtube', 'utube', 'yt']:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'youtube'
                    }
                # Handle FitGirl/game searches
                elif source and source.lower() in ['fitgirl', 'fg']:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'games'
                    }
                # Handle APK searches
                elif source and source.lower() in ['apk', 'apkpure', 'apkmirror'] or 'apk' in text.lower():
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': 'apk'
                    }
                # General search
                else:
                    return {
                        'type': 'search',
                        'query': query.strip(),
                        'source': source.lower() if source else None
                    }
                
        # All location-related code and Google Earth functionality has been completely removed
        # If the user mentions Google Earth, we'll just treat it as a regular search
        if 'google earth' in text.lower():
            # DEBUG: Google Earth mention detected, treating as regular search")
            return {
                'type': 'search',
                'query': text,
                'source': 'google'
            }
            
        # Handle "show me" queries as regular searches
        if text.lower().startswith('show me ') and len(text.split()) >= 3:
            # DEBUG: Processing 'show me' query: {text}")
            remaining = text[8:].strip()  # Text after "show me "
            
            # Check if it's a common phrase like "show me the money"
            common_phrases = ['the money', 'what you', 'your', 'how to', 'the way', 'that', 'this', 'it']
            is_common_phrase = any(phrase in remaining.lower() for phrase in common_phrases)
            
            if not is_common_phrase:
                # DEBUG: 'Show me' query detected, treating as regular search")
                return {
                    'type': 'search',
                    'query': remaining,
                    'source': 'google'
                }
        
        # If no specific command matched, treat as chat
        return None  # Let it be handled as chat

# Example usage
if __name__ == "__main__":
    parser = CommandParser()
    user_input = "Open Task Manager"
    result = parser.parse(user_input)
    print(result)  # Output: {'type': 'app', 'name': 'task manager', 'action': 'open'}

    # Test web commands
    print(parser.parse("open https://google.com"))  # Full URL
    print(parser.parse("go to youtube.com"))  # Domain name
    print(parser.parse("open youtube"))  # Common website
    
    # Test app commands
    print(parser.parse("open notepad"))  # Basic app
    print(parser.parse("launch visual studio code"))  # Multi-word app
    print(parser.parse("start the calculator app"))  # With 'the' and 'app'
    print(parser.parse("run chrome application"))  # With 'application'

    # Test search commands
    print(parser.parse("search for python"))  # General search
    print(parser.parse("look up python on google"))  # Browser-specific search
    print(parser.parse("what is the weather like today"))  # Status/forecast query

    # Test close commands
    print(parser.parse("close notepad"))  # Basic app
    print(parser.parse("quit visual studio code"))  # Multi-word app
    print(parser.parse("exit the calculator app"))  # With 'the' and 'app'
    print(parser.parse("terminate chrome application"))  # With 'application'

    # Test retry commands
    print(parser.parse("try again"))  # Basic retry
    print(parser.parse("try again with more context"))  # Retry with additional context
