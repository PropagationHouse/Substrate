"""
TTS Directives - Voice control tags.

Parses [[tts:...]] directives from text to control voice synthesis:
- [[tts]] - Enable TTS for this response
- [[tts:text]]...[[/tts:text]] - Specify exact text to speak
- [[tts:voice=NAME]] - Override voice
- [[tts:speed=1.2]] - Override speed
- [[tts:provider=elevenlabs]] - Override provider

Example:
    "Here's the answer. [[tts:text]]The answer is 42.[[/tts:text]]"
    -> Displays full text but only speaks "The answer is 42."
"""

import re
import logging
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class TtsDirectiveResult:
    """Result of parsing TTS directives from text."""
    cleaned_text: str  # Text with directives removed
    tts_text: Optional[str] = None  # Specific text to speak (if [[tts:text]] used)
    has_directive: bool = False  # Whether any TTS directive was found
    enabled: bool = True  # Whether TTS is enabled
    overrides: Dict[str, Any] = field(default_factory=dict)  # Voice/speed/etc overrides
    warnings: list = field(default_factory=list)  # Parse warnings


# Supported providers
VALID_PROVIDERS = {"kokoro", "elevenlabs", "edge", "openai"}

# Supported voices by provider
VALID_VOICES = {
    "kokoro": {"af_heart", "af_bella", "af_sarah", "am_adam", "am_michael", "bf_emma", "bm_george"},
    "elevenlabs": set(),  # Any voice ID is valid
    "openai": {"alloy", "echo", "fable", "onyx", "nova", "shimmer"},
}


def parse_tts_directives(text: str, allow_overrides: bool = True) -> TtsDirectiveResult:
    """
    Parse TTS directives from text.
    
    Supported directives:
    - [[tts]] - Simple enable marker
    - [[tts:off]] - Disable TTS for this response
    - [[tts:text]]...[[/tts:text]] - Specific text to speak
    - [[tts:key=value]] - Override settings (voice, speed, provider, etc.)
    
    Args:
        text: Text containing potential TTS directives
        allow_overrides: Whether to allow voice/speed/etc overrides
        
    Returns:
        TtsDirectiveResult with parsed information
    """
    result = TtsDirectiveResult(cleaned_text=text)
    
    if not text:
        return result
    
    cleaned = text
    
    # Parse [[tts:text]]...[[/tts:text]] blocks first
    text_block_pattern = r'\[\[tts:text\]\]([\s\S]*?)\[\[/tts:text\]\]'
    text_matches = re.findall(text_block_pattern, cleaned, re.IGNORECASE)
    if text_matches:
        result.has_directive = True
        result.tts_text = ' '.join(m.strip() for m in text_matches)
        cleaned = re.sub(text_block_pattern, '', cleaned, flags=re.IGNORECASE)
    
    # Parse [[tts:key=value]] or [[tts:flag]] directives
    directive_pattern = r'\[\[tts(?::([^\]]+))?\]\]'
    
    for match in re.finditer(directive_pattern, cleaned, re.IGNORECASE):
        result.has_directive = True
        body = match.group(1)
        
        if not body:
            # Simple [[tts]] marker - just enable
            continue
        
        # Parse the body for key=value pairs or flags
        tokens = body.split()
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            
            # Check for off flag
            if token.lower() == 'off':
                result.enabled = False
                continue
            
            # Check for key=value
            if '=' in token:
                key, value = token.split('=', 1)
                key = key.lower().strip()
                value = value.strip().strip('"\'')
                
                if not allow_overrides:
                    result.warnings.append(f"Override '{key}' not allowed")
                    continue
                
                try:
                    _apply_override(result, key, value)
                except ValueError as e:
                    result.warnings.append(str(e))
    
    # Remove all TTS directives from cleaned text
    cleaned = re.sub(directive_pattern, '', cleaned, flags=re.IGNORECASE)
    
    # Clean up extra whitespace
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    cleaned = cleaned.strip()
    
    result.cleaned_text = cleaned
    return result


def _apply_override(result: TtsDirectiveResult, key: str, value: str):
    """Apply a single override to the result."""
    key = key.lower()
    
    if key in ('voice', 'v'):
        result.overrides['voice'] = value
        
    elif key in ('speed', 's', 'rate'):
        try:
            speed = float(value)
            if not 0.5 <= speed <= 2.0:
                raise ValueError(f"Speed must be between 0.5 and 2.0, got {speed}")
            result.overrides['speed'] = speed
        except ValueError:
            raise ValueError(f"Invalid speed value: {value}")
            
    elif key in ('provider', 'p'):
        provider = value.lower()
        if provider not in VALID_PROVIDERS:
            raise ValueError(f"Invalid provider: {value}. Valid: {', '.join(VALID_PROVIDERS)}")
        result.overrides['provider'] = provider
        
    elif key in ('pitch',):
        try:
            pitch = float(value)
            if not -1.0 <= pitch <= 1.0:
                raise ValueError(f"Pitch must be between -1.0 and 1.0, got {pitch}")
            result.overrides['pitch'] = pitch
        except ValueError:
            raise ValueError(f"Invalid pitch value: {value}")
            
    elif key in ('stability',):
        try:
            stability = float(value)
            if not 0 <= stability <= 1:
                raise ValueError(f"Stability must be between 0 and 1, got {stability}")
            result.overrides['stability'] = stability
        except ValueError:
            raise ValueError(f"Invalid stability value: {value}")
            
    elif key in ('similarity', 'similarity_boost'):
        try:
            sim = float(value)
            if not 0 <= sim <= 1:
                raise ValueError(f"Similarity must be between 0 and 1, got {sim}")
            result.overrides['similarity_boost'] = sim
        except ValueError:
            raise ValueError(f"Invalid similarity value: {value}")
            
    else:
        # Unknown key - store it anyway for extensibility
        result.overrides[key] = value


def extract_tts_text(text: str) -> Tuple[str, Optional[str]]:
    """
    Simple extraction: get cleaned text and TTS text.
    
    Args:
        text: Text with potential TTS directives
        
    Returns:
        Tuple of (cleaned_text, tts_text_or_none)
    """
    result = parse_tts_directives(text)
    return result.cleaned_text, result.tts_text


def should_speak(text: str) -> bool:
    """
    Check if text should be spoken (has TTS directive or is short enough).
    
    Args:
        text: Text to check
        
    Returns:
        True if text should be spoken
    """
    result = parse_tts_directives(text)
    
    # If explicitly disabled, don't speak
    if not result.enabled:
        return False
    
    # If has explicit TTS directive, speak
    if result.has_directive:
        return True
    
    # Default: speak if text is reasonably short
    return len(result.cleaned_text) < 2000


def get_speakable_text(text: str, max_length: int = 1500) -> str:
    """
    Get the text that should be spoken.
    
    Args:
        text: Full response text
        max_length: Maximum length before summarization would be needed
        
    Returns:
        Text to speak (may be subset of full text)
    """
    result = parse_tts_directives(text)
    
    # If specific TTS text was provided, use that
    if result.tts_text:
        return result.tts_text
    
    # Otherwise use cleaned text (with directives removed)
    speak_text = result.cleaned_text
    
    # Truncate if too long
    if len(speak_text) > max_length:
        speak_text = speak_text[:max_length] + "..."
    
    return speak_text


def apply_tts_overrides(base_settings: Dict[str, Any], text: str) -> Dict[str, Any]:
    """
    Apply TTS directive overrides to base settings.
    
    Args:
        base_settings: Base voice settings dict
        text: Text with potential TTS directives
        
    Returns:
        Settings dict with overrides applied
    """
    result = parse_tts_directives(text)
    
    if not result.overrides:
        return base_settings
    
    # Merge overrides into base settings
    merged = base_settings.copy()
    merged.update(result.overrides)
    
    return merged
