import os
import json
import platform
# Simple storage for face config
FACE_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_config.json')
import sys
import json
import traceback
import requests
import base64
import os
import time
import threading

# Thread-local storage for circuits silent suppression
_circuits_tls = threading.local()
import logging
import urllib.parse
import random
import subprocess
import sys
import signal
import atexit
import copy
from datetime import datetime
from pathlib import Path
from io import BytesIO
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_sock import Sock
import webbrowser
import socket
import re
import pyautogui
import pyperclip
from enum import Enum
from src.commands.command_parser import CommandParser
from src.commands.command_executor import CommandExecutor
from src.voice.voice_handler import (
    VoiceHandler,
    set_message_buffer,
    set_proxy_server,
    speak,
    stop_current_playback,
    init_from_config,
    update_elevenlabs_credentials,
    start_elevenlabs_conversation,
    stop_elevenlabs_conversation,
    is_elevenlabs_mode_active,
)
from src.screenshot.__init__ import ScreenshotHandler
from src.midjourney.__init__ import MidjourneyHandler
from src.profiles.__init__ import ProfileManager
from src.perplexity.sonar_handler import SonarHandler

# Infrastructure imports
from src.infra import (
    # System events
    enqueue_system_event,
    drain_system_events,
    peek_system_events,
    has_system_events,
    # Circuits
    CircuitsConfig,
    CircuitsResult,
    start_circuits,
    stop_circuits,
    request_circuits_now,
    get_circuits_status,
    # Compaction
    estimate_tokens,
    compact_messages,
    # Sessions
    get_session_manager,
    create_isolated_session,
    get_main_session,
    # Subagents
    init_subagent_registry,
    spawn_subagent,
    list_subagent_tasks,
    # Exec approvals
    check_exec_approval,
    is_command_approved,
    ApprovalResult,
)
from src.infra.prompt_builder import build_system_prompt, SILENT_TOKEN, CIRCUITS_OK_TOKEN

from src.memory.memory_manager import MemoryManager
from src.memory.code_memory import CodeMemory
from src.memory.unified_memory import UnifiedMemoryManager, MemoryType, get_unified_memory

# Import tools module for full computer access
try:
    from src.tools import get_tool_registry
    TOOLS_AVAILABLE = True
except ImportError as e:
    TOOLS_AVAILABLE = False
    print(f"[WARNING] Tools module not available: {e}")

# Import command pipe server for remote command execution
from main_app_integration import start_command_pipe_server

# Initialize Sonar handler as None, will be set in __init__
sonar_handler = None

# Initialize Flask early so routes can register safely
app = Flask(__name__)
CORS(app)
sock = Sock(app)

# Allow motion sensors, camera, microphone, notifications for mobile WebUI
@app.after_request
def add_permissions_policy(resp):
    try:
        resp.headers['Permissions-Policy'] = (
            "accelerometer=(self), gyroscope=(self), camera=(self), "
            "microphone=(self), notifications=(self)"
        )
        resp.headers['Feature-Policy'] = (
            "accelerometer 'self'; gyroscope 'self'; camera 'self'; "
            "microphone 'self'; notifications 'self'"
        )
    except Exception:
        pass
    return resp

# Directory for generated voice audio
AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', 'voice', 'temp')
os.makedirs(AUDIO_DIR, exist_ok=True)

# WebUI audio route (serve WAVs)
@app.route('/audio/<path:filename>', methods=['GET'])
def serve_audio(filename):
    try:
        # Security: prevent path traversal
        safe_name = os.path.basename(filename)
        return send_from_directory(AUDIO_DIR, safe_name, mimetype='audio/wav', as_attachment=False)
    except Exception as e:
        return (f"Error serving audio: {e}", 404)

# Keys in config that hold sensitive remote API tokens
REMOTE_KEY_FIELDS = {
    "grok-latest": "remote_api_keys/xai_api_key",
    "claude-sonnet-4.5": "remote_api_keys/anthropic_api_key",
    "perplexity": "perplexity_api_key",
    "elevenlabs": "remote_api_keys/elevenlabs_api_key",
    "minimax-m2.5": "remote_api_keys/minimax_api_key",
    "gpt-4.1": "remote_api_keys/openai_api_key",
    "gpt-4.1-mini": "remote_api_keys/openai_api_key",
    "o4-mini": "remote_api_keys/openai_api_key",
    "gpt-4o": "remote_api_keys/openai_api_key"
}

REMOTE_KEY_ROUTE_ALLOWLIST = {
    "xai": {
        "field": "remote_api_keys/xai_api_key",
        "env": "XAI_API_KEY"
    },
    "anthropic": {
        "field": "remote_api_keys/anthropic_api_key",
        "env": "ANTHROPIC_API_KEY"
    },
    "perplexity": {
        "field": "perplexity_api_key",
        "env": "PERPLEXITY_API_KEY"
    },
    "google": {
        "field": "remote_api_keys/google_api_key",
        "env": "GOOGLE_API_KEY"
    },
    "elevenlabs": {
        "field": "remote_api_keys/elevenlabs_api_key",
        "env": "ELEVENLABS_API_KEY"
    },
    "notion": {
        "field": "remote_api_keys/notion_api_key",
        "env": "NOTION_API_KEY"
    },
    "minimax": {
        "field": "remote_api_keys/minimax_api_key",
        "env": "MINIMAX_API_KEY"
    },
    "openai": {
        "field": "remote_api_keys/openai_api_key",
        "env": "OPENAI_API_KEY"
    }
}


def _split_config_path(path):
    parts = path.split('/') if path else []
    return [segment for segment in parts if segment]


def _get_nested(dct, path, default=None):
    if not dct:
        return default
    node = dct
    for segment in _split_config_path(path):
        if not isinstance(node, dict) or segment not in node:
            return default
        node = node[segment]
    return node


def _set_nested(dct, path, value):
    if not path:
        return
    node = dct
    parts = _split_config_path(path)
    for segment in parts[:-1]:
        if segment not in node or not isinstance(node[segment], dict):
            node[segment] = {}
        node = node[segment]
    node[parts[-1]] = value


def _delete_nested(dct, path):
    parts = _split_config_path(path)
    if not parts or not isinstance(dct, dict):
        return
    stack = []
    node = dct
    for segment in parts[:-1]:
        if not isinstance(node, dict) or segment not in node:
            return
        stack.append((node, segment))
        node = node[segment]
    if isinstance(node, dict) and parts[-1] in node:
        node.pop(parts[-1], None)
        while stack:
            parent, seg = stack.pop()
            child = parent.get(seg)
            if isinstance(child, dict) and not child:
                parent.pop(seg, None)
            else:
                break


def _mask_value(value):
    if not value:
        return ""
    return f"{value[:4]}…{value[-4:]}" if len(value) > 8 else "•" * len(value)


def _has_remote_key(config, model_name):
    path = REMOTE_KEY_FIELDS.get(model_name)
    if not path:
        return False
    token = _get_nested(config, path)
    return bool(token and isinstance(token, str) and token.strip())


def _mask_remote_keys(config):
    if not isinstance(config, dict):
        return config
    masked = copy.deepcopy(config)
    for path in REMOTE_KEY_FIELDS.values():
        token = _get_nested(masked, path)
        if token:
            _set_nested(masked, path, _mask_value(token))
    return masked


def _remote_key_status(config):
    status = {}
    if not isinstance(config, dict):
        return status
    for model_name in REMOTE_KEY_FIELDS:
        status[model_name] = _has_remote_key(config, model_name)
    return status


def _merge_remote_keys(target, updates):
    if not updates:
        return
    for metadata in REMOTE_KEY_ROUTE_ALLOWLIST.values():
        path = metadata['field']
        client_value = _get_nested(updates, path)
        if client_value is None:
            continue

        trimmed = client_value.strip() if isinstance(client_value, str) else client_value

        if isinstance(trimmed, str):
            placeholder = "…" in trimmed or (trimmed and set(trimmed) <= {"•"})
            if placeholder:
                existing = _get_nested(target, path)
                if existing is None:
                    _delete_nested(updates, path)
                else:
                    _set_nested(updates, path, existing)
                continue

            if trimmed == "":
                _delete_nested(target, path)
                _set_nested(updates, path, "")
                os.environ.pop(metadata['env'], None)
                continue

        _set_nested(target, path, trimmed)
        _set_nested(updates, path, trimmed)

        if isinstance(trimmed, str):
            if trimmed:
                os.environ[metadata['env']] = trimmed
            else:
                os.environ.pop(metadata['env'], None)


def _apply_remote_env_defaults(config):
    """Sync API keys between config and environment variables.
    
    - If config has a key, set it in the environment
    - If config is empty but env has a key, set it in config
    """
    if not isinstance(config, dict):
        return
    for metadata in REMOTE_KEY_ROUTE_ALLOWLIST.values():
        current = _get_nested(config, metadata['field'])
        if current and isinstance(current, str) and current.strip():
            # Config has a key - sync TO environment
            os.environ[metadata['env']] = current.strip()
            logger.info(f"[API KEY] Loaded {metadata['env']} from config")
        else:
            # Config empty - try to get from environment
            env_value = os.environ.get(metadata['env'])
            if env_value:
                _set_nested(config, metadata['field'], env_value)


class RemoteAPIError(Exception):
    """Raised when a remote LLM provider returns an error."""
    pass


def _chunk_text(text, chunk_size=400):
    if not text:
        return
    for i in range(0, len(text), chunk_size):
        yield text[i:i + chunk_size]


# ── Emotion Detection for Avatar Expressions ──────────────────────────────
# Keyword-based sentiment analysis with scoring. No LLM call needed.
# Each keyword list is checked against the lowercased response text.
# Scores = number of keyword hits. Dominant mood = highest score.

EMOTION_KEYWORDS = {
    'happy': [
        'great', 'awesome', 'wonderful', 'fantastic', 'excellent', 'perfect',
        'glad', 'pleased', 'delighted', 'enjoy', 'love it', 'nice work',
        'well done', 'good job', 'congrats', 'congratulations', 'yay',
        'brilliant', 'superb', 'terrific', 'hooray', 'cheers', 'sweet',
        'beautiful', 'lovely', 'magnificent', 'splendid', 'bravo',
    ],
    'smiling': [
        'happy to help', 'sure thing', 'no problem',
        'you bet', 'my pleasure', 'glad to help',
        'here you go', 'hope that helps', 'you\'re welcome',
        'sounds good', 'right away', 'at your service',
    ],
    'laughing': [
        'haha', 'hahaha', 'lol', 'lmao', 'rofl', 'hilarious', 'funny',
        'joke', 'crack up', 'dying', 'comedy', 'priceless', 'ridiculous',
        'absurd', 'cracked me up', 'too funny', 'laughing', 'giggle',
        'amusing', 'witty', 'humorous', 'comical',
    ],
    'sad': [
        'sorry to hear', 'unfortunately', 'regret', 'heartbreaking',
        'devastating', 'tragic', 'loss', 'grief', 'mourning', 'painful',
        'miss you', 'farewell', 'goodbye', 'passed away', 'condolences',
        'sympathies', 'tough time', 'difficult time', 'broken',
        'disappointed', 'letdown', 'bummer', 'that sucks', 'too bad',
    ],
    'angry': [
        'outrageous', 'unacceptable', 'furious', 'infuriating', 'ridiculous',
        'terrible', 'horrible', 'disgusting', 'appalling', 'inexcusable',
        'rage', 'livid', 'fed up', 'sick of', 'had enough', 'bullshit',
        'damn it', 'pissed', 'annoying', 'irritating', 'maddening',
    ],
    'surprised': [
        'wow', 'whoa', 'no way', 'unexpected', 'incredible', 'unbelievable',
        'shocking', 'mind blowing', 'mind-blowing', 'astonishing', 'stunned',
        'speechless', 'jaw dropped', 'can you believe', 'plot twist',
        'out of nowhere', 'did not see that coming', 'holy cow', 'oh my',
        'remarkable', 'extraordinary', 'insane',
    ],
    'excited': [
        'exciting', 'thrilling', 'pumped', 'stoked', 'hyped', 'fired up',
        'can\'t wait', 'looking forward', 'amazing news', 'big news',
        'breakthrough', 'game changer', 'epic', 'legendary', 'incredible',
        'let\'s go', 'finally', 'at last', 'dream come true', 'milestone',
    ],
    'confused': [
        'hmm', 'not sure', 'unclear', 'confusing', 'strange', 'weird',
        'odd', 'puzzling', 'baffling', 'perplexing', 'doesn\'t make sense',
        'hard to understand', 'mixed signals', 'contradictory', 'ambiguous',
        'what do you mean', 'i\'m lost', 'wait what', 'huh',
    ],
    'skeptical': [
        'debatable', 'questionable', 'doubtful', 'suspicious',
        'not convinced', 'take it with a grain', 'allegedly',
        'supposedly', 'remains to be seen', 'jury is still out', 'iffy',
        'sketchy', 'fishy', 'hard to believe', 'think twice',
    ],
    'searching': [
        'searching', 'looking up', 'let me find', 'browsing', 'web search',
        'googling', 'researching', 'investigating', 'digging into',
        'checking online', 'pulling up', 'fetching', 'querying',
        'looking into', 'scanning', 'crawling',
    ],
    'sleepy': [
        'goodnight', 'good night', 'sleep well', 'sweet dreams', 'tired',
        'exhausted', 'rest up', 'bedtime', 'nap', 'drowsy', 'yawn',
        'winding down', 'calling it a night', 'lights out', 'zzz',
    ],
}

def detect_emotions(text):
    """Scan text for emotion keywords. Returns dict of {emotion: hit_count} sorted by hits descending.
    Uses word boundary matching to avoid substring false positives."""
    if not text:
        return {}
    text_lower = text.lower()
    scores = {}
    for emotion, keywords in EMOTION_KEYWORDS.items():
        hits = 0
        for kw in keywords:
            # Multi-word phrases: simple 'in' check is fine
            # Single words: use word boundary regex to avoid substring matches
            if ' ' in kw:
                if kw in text_lower:
                    hits += 1
            else:
                if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                    hits += 1
        if hits > 0:
            scores[emotion] = hits
    # Sort by hit count descending
    return dict(sorted(scores.items(), key=lambda x: x[1], reverse=True))


def build_emotion_schedule(scores, max_emotions=4):
    """Build a timed emotion schedule from detected scores.
    
    The dominant mood (highest hits) gets longer duration and appears first.
    Other emotions cycle after it with neutral cooldowns in between.
    
    Returns list of {emotion, delay_ms, duration_ms} plus a 'dominant' field.
    """
    if not scores:
        return None
    
    emotions = list(scores.items())[:max_emotions]
    dominant = emotions[0][0]
    dominant_hits = emotions[0][1]
    
    schedule = []
    current_time = 0
    
    for i, (emotion, hits) in enumerate(emotions):
        # Stronger matches get longer duration (2-5 seconds)
        # Scale by hit ratio relative to dominant
        ratio = hits / dominant_hits if dominant_hits > 0 else 0.5
        base_duration = 2000 + int(ratio * 3000)  # 2000-5000ms
        # Add some randomness ±500ms
        duration = base_duration + random.randint(-500, 500)
        duration = max(2000, min(5000, duration))
        
        schedule.append({
            'emotion': emotion,
            'delay': current_time,
            'duration': duration,
        })
        
        current_time += duration
        
        # Add cooldown between emotions (0.3-3 seconds)
        if i < len(emotions) - 1:
            cooldown = random.randint(300, 3000)
            current_time += cooldown
    
    return {
        'type': 'avatar_emotions',
        'dominant': dominant,
        'schedule': schedule,
        'suppress_chat': True,
    }


def _resolve_remote_key(config, model_name=None, provider=None):
    if isinstance(model_name, str):
        path = REMOTE_KEY_FIELDS.get(model_name)
        if path:
            token = _get_nested(config, path)
            if token and isinstance(token, str) and token.strip():
                return token.strip()
            for metadata in REMOTE_KEY_ROUTE_ALLOWLIST.values():
                if metadata['field'] == path:
                    env_value = os.environ.get(metadata['env'])
                    if env_value and env_value.strip():
                        return env_value.strip()
    if provider:
        metadata = REMOTE_KEY_ROUTE_ALLOWLIST.get(provider)
        if metadata:
            token = _get_nested(config, metadata['field'])
            if token and isinstance(token, str) and token.strip():
                return token.strip()
            env_value = os.environ.get(metadata['env'])
            if env_value and env_value.strip():
                return env_value.strip()
    return None


# Live UI state sync (in-memory, no disk I/O)
_current_ui_state = {"body": "#5bbfdd", "face": "#a8e4f3", "expression": "idle", "talking": False}

@app.route('/api/ui/color', methods=['GET', 'POST'])
def api_ui_color():
    global _current_ui_state
    if request.method == 'POST':
        data = request.get_json(force=True, silent=True) or {}
        if data.get('body'): _current_ui_state['body'] = data['body']
        if data.get('face'): _current_ui_state['face'] = data['face']
        if 'expression' in data: _current_ui_state['expression'] = data['expression']
        if 'talking' in data: _current_ui_state['talking'] = data['talking']
        return jsonify({"ok": True})
    return jsonify(_current_ui_state)


# Face config endpoint (after app init)
@app.route('/ui/face-config', methods=['GET', 'POST'])
def ui_face_config():
    try:
        if request.method == 'POST':
            data = request.get_json(force=True) or {}
            # allow raw string payload as saved localStorage content
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    data = {"raw": data}
            with open(FACE_CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            return jsonify({"ok": True})
        # GET
        if os.path.isfile(FACE_CONFIG_PATH):
            with open(FACE_CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            return jsonify(cfg)
        return jsonify({}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def call_perplexity_api(query, api_key, model="sonar", system_prompt=None, force_call=False):
    """
    Call the Perplexity Sonar API to get up-to-date information for a query
    
    Args:
        query (str): The query to search for
        api_key (str): Perplexity API key
        model (str): Sonar model to use (sonar, sonar-pro, etc.)
        system_prompt (str): Optional system prompt to guide the response
        force_call (bool): If True, bypass the information-seeking check and force the API call
        
    Returns:
        str: The response from the Sonar API, or None if there was an error
    """
    # Sonar API call started
    
    # Create logs directory if it doesn't exist
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    os.makedirs(log_dir, exist_ok=True)
    
    # Create a log file with timestamp
    log_file = os.path.join(log_dir, f"perplexity_call_{time.strftime('%Y%m%d_%H%M%S')}.log")
    with open(log_file, 'w', encoding='utf-8') as f:
        f.write(f"Query: '{query}'\n")
        f.write(f"Force call: {force_call}\n")
        f.write(f"API key: {api_key[:5]}...{api_key[-5:]}\n")
    # If not forcing the call, check if this is an information-seeking query
    if not force_call:
        # By default, assume queries do NOT need real-time information
        is_info_seeking = False
        
        # Patterns that strongly indicate real-time information needs
        realtime_patterns = ["latest", "current", "recent", "today", "now", "update", "news", 
                            "trending", "happening", "stock", "price", "score",
                            "time", "date", "year", "month", "week", "day", "hour", "minute",
                            "forecast", "predict", "upcoming", "scheduled", "event", "release"]
        
        # Command patterns that indicate search intent
        command_patterns = ["show me", "find", "search", "look up", "google", "web search", 
                           "search for", "look for", "find information", "tell me", "get", "fetch"]
        
        # General information-seeking patterns
        info_seeking_patterns = ["what is", "who is", "where is", "when is", "why is", "how to", 
                               "tell me about", "explain", "describe", "information on", "details about",
                               "how many", "how much", "which", "whose", "whom", "what are", "who are"]
        
        # Patterns that indicate a query is NOT information-seeking
        non_info_patterns = ["write code", "create a", "generate", "make a", "help me with", 
                           "fix this", "debug", "solve this", "calculate", "compute"]
        
        # Convert query to lowercase for case-insensitive matching
        text_lower = query.lower()
        
        # First check if this is a non-information-seeking query
        if any(pattern in text_lower for pattern in non_info_patterns):
            is_info_seeking = False
            pass  # Non-info pattern
            
        # Check if it's a very short query (likely a command)
        elif len(query.split()) < 3 and not query.strip().endswith("?"):
            is_info_seeking = False
            pass  # Query too short
            
        # Check for command patterns (highest priority)
        elif any(pattern in text_lower for pattern in command_patterns):
            is_info_seeking = True
            pass  # Search command
            
        # Only use direct triggers - no pattern matching
        else:
            is_info_seeking = False
            pass  # Using local LLM 
        if not is_info_seeking:
            pass
            return None
    else:
        pass  # Force call
    
    # Calling Perplexity API
    
    # URL - exactly as in the documentation example
    url = "https://api.perplexity.ai/chat/completions"
    
    # Headers - exactly as in the documentation example
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # System prompt - exactly as in the documentation example
    if not system_prompt:
        system_prompt = "Be precise and concise."
    
    # Payload - exactly as in the documentation example
    payload = {
        "model": model,  # Use the model passed in (sonar or sonar-pro for follow-ups)
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        "return_citations": True
    }

    # Auto-detect recency needs from query keywords
    recency_keywords = {"latest", "current", "recent", "today", "now", "news", "trending",
                        "happening", "stock", "price", "score", "tonight", "yesterday"}
    query_words = set(query.lower().split())
    if query_words & recency_keywords:
        payload["search_recency_filter"] = "day"
    
    # Log the request details
    # Using sonar model
    
    # Log the full request to file
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(f"URL: {url}\n")
        f.write(f"Headers: {headers}\n")
        f.write(f"Payload:\n{json.dumps(payload, indent=2)}\n\n")
    
    try:
        # Make the API request - exactly as in the documentation example
        # Sending request
        start_time = time.time()
        response = requests.request("POST", url, json=payload, headers=headers, timeout=30)
        response_time = time.time() - start_time
        
        logger.debug(f"Sonar response: {response.status_code} in {response_time:.2f}s")
        
        # Log the response status
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"Response Status: {response.status_code}\n")
            f.write(f"Response Time: {response_time:.2f} seconds\n")
            f.write(f"Response Headers: {dict(response.headers)}\n\n")
        
        # Log the raw response text
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"Raw Response Text:\n{response.text}\n\n")
        
        # Check if the request was successful
        if response.status_code == 200:
            try:
                # Parse the response
                result = response.json()
                
                # Log the full response
                with open(log_file, 'a', encoding='utf-8') as f:
                    f.write(f"Response JSON: {json.dumps(result, indent=2)}\n\n")
                
                # Extract the content
                if 'choices' in result and result['choices'] and len(result['choices']) > 0:
                    if 'message' in result['choices'][0] and 'content' in result['choices'][0]['message']:
                        content = result['choices'][0]['message']['content']
                        
                        # Append citations as a Sources section if available
                        citations = result.get('citations', [])
                        if citations:
                            sources = "\n\n**Sources:**\n" + "\n".join(
                                f"[{i+1}] {url}" for i, url in enumerate(citations)
                            )
                            content += sources
                        
                        # Save the result to a file for debugging
                        result_file = os.path.join(log_dir, f"perplexity_result_{time.strftime('%Y%m%d_%H%M%S')}.txt")
                        with open(result_file, 'w', encoding='utf-8') as f:
                            f.write(f"Query: {query}\n\n")
                            f.write(f"Response from sonar:\n\n")
                            f.write(content)
                        
                        return content
                    else:
                        error_msg = "Message or content field missing in response"
                        print(f"[SONAR ERROR] {error_msg}")
                        if 'choices' in result and len(result['choices']) > 0:
                            print(f"[SONAR DEBUG] First choice keys: {list(result['choices'][0].keys())}")
                        return None
                else:
                    error_msg = "No choices field found in response"
                    print(f"[SONAR ERROR] {error_msg}")
                    print(f"[SONAR DEBUG] Response keys: {list(result.keys())}")
                    return None
            except Exception as e:
                error_msg = f"Error parsing JSON response: {str(e)}"
                print(f"[SONAR ERROR] {error_msg}")
                return None
        else:
            error_msg = f"API request failed with status code {response.status_code}: {response.text}"
            print(f"[SONAR ERROR] {error_msg}")
            return None
    except Exception as e:
        error_msg = f"Exception during API call: {str(e)}"
        print(f"[SONAR ERROR] {error_msg}")
        
        # Log the exception
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"Exception: {str(e)}\n")
        
        return None
from context_assistant_updater import ContextAssistantUpdater
import win32gui
import win32con
import tempfile

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Supported models and their configurations
SUPPORTED_MODELS = {
    "deepseek-r1:latest": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "4.7B parameters",
        "provider": "ollama"
    },
    "deepseek-r1:32b": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "32B parameters",
        "provider": "ollama"
    },
    "dolphin3:latest": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "7B parameters",
        "provider": "ollama"
    },
    "qwen2.5-coder:14b": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "14B parameters",
        "provider": "ollama"
    },
    "dolphin-mixtral:latest": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "7B parameters",
        "provider": "ollama"
    },
    "llama3.2-vision:11b": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "11B parameters",
        "provider": "ollama"
    },
    "falcon:latest": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "7B parameters",
        "provider": "ollama"
    },
    "dolphin-mistral:7b": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "7B parameters",
        "provider": "ollama"
    },
    "dolphin3:8b": {
        "endpoint": "http://localhost:11434/api/generate",
        "size": "8B parameters",
        "provider": "ollama"
    },
    "grok-latest": {
        "endpoint": "https://api.x.ai/v1/chat/completions",
        "provider": "xai",
        "remote_model": "grok-4-latest",
        "auth_env": "XAI_API_KEY",
        "display_name": "Grok (xAI)",
        "notes": "Requires XAI_API_KEY environment variable.",
        "size": "Online"
    },
    "claude-sonnet-4.5": {
        "endpoint": "https://api.anthropic.com/v1/messages",
        "provider": "anthropic",
        "remote_model": "claude-sonnet-4-5-20250929",
        "auth_env": "ANTHROPIC_API_KEY",
        "display_name": "Claude Sonnet 4.5",
        "notes": "Requires ANTHROPIC_API_KEY. Best balance of quality, speed, and cost.",
        "anthropic_version": "2023-06-01",
        "size": "Online"
    },
    "claude-opus-4.5": {
        "endpoint": "https://api.anthropic.com/v1/messages",
        "provider": "anthropic",
        "remote_model": "claude-opus-4-5-20251101",
        "auth_env": "ANTHROPIC_API_KEY",
        "display_name": "Claude Opus 4.5",
        "notes": "Requires ANTHROPIC_API_KEY. Most capable Claude model.",
        "anthropic_version": "2023-06-01",
        "size": "Online"
    },
    "claude-haiku-4.5": {
        "endpoint": "https://api.anthropic.com/v1/messages",
        "provider": "anthropic",
        "remote_model": "claude-haiku-4-5-20251001",
        "auth_env": "ANTHROPIC_API_KEY",
        "display_name": "Claude Haiku 4.5",
        "notes": "Requires ANTHROPIC_API_KEY. Fast and affordable.",
        "anthropic_version": "2023-06-01",
        "size": "Online"
    },
    "claude-sonnet-4": {
        "endpoint": "https://api.anthropic.com/v1/messages",
        "provider": "anthropic",
        "remote_model": "claude-sonnet-4-20250514",
        "auth_env": "ANTHROPIC_API_KEY",
        "display_name": "Claude Sonnet 4",
        "notes": "Requires ANTHROPIC_API_KEY. Previous gen, solid fallback.",
        "anthropic_version": "2023-06-01",
        "size": "Online"
    },
    "gemini-3-pro": {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
        "provider": "google",
        "remote_model": "gemini-3-pro-preview",
        "auth_env": "GOOGLE_API_KEY",
        "display_name": "Gemini 3 Pro",
        "notes": "Requires GOOGLE_API_KEY environment variable. Most capable Gemini model.",
        "size": "Online"
    },
    "gemini-3-flash": {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
        "provider": "google",
        "remote_model": "gemini-3-flash-preview",
        "auth_env": "GOOGLE_API_KEY",
        "display_name": "Gemini 3 Flash",
        "notes": "Requires GOOGLE_API_KEY environment variable. Fast and efficient.",
        "size": "Online"
    },
    "gemini-2.5-pro": {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
        "provider": "google",
        "remote_model": "gemini-2.5-pro",
        "auth_env": "GOOGLE_API_KEY",
        "display_name": "Gemini 2.5 Pro",
        "notes": "Requires GOOGLE_API_KEY environment variable.",
        "size": "Online"
    },
    "gemini-2.5-flash": {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        "provider": "google",
        "remote_model": "gemini-2.5-flash",
        "auth_env": "GOOGLE_API_KEY",
        "display_name": "Gemini 2.5 Flash",
        "notes": "Requires GOOGLE_API_KEY environment variable.",
        "size": "Online"
    },
    "minimax-m2.5": {
        "endpoint": "https://api.minimax.io/anthropic/v1/messages",
        "provider": "minimax",
        "remote_model": "MiniMax-M2.5",
        "auth_env": "MINIMAX_API_KEY",
        "display_name": "MiniMax M2.5",
        "notes": "Requires MINIMAX_API_KEY. Anthropic-compatible API.",
        "anthropic_version": "2023-06-01",
        "size": "Online"
    },
    "gpt-4.1": {
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "provider": "openai",
        "remote_model": "gpt-4.1",
        "auth_env": "OPENAI_API_KEY",
        "display_name": "GPT-4.1 (OpenAI)",
        "notes": "Requires OPENAI_API_KEY. Best OpenAI model for coding and instruction following.",
        "size": "Online"
    },
    "gpt-4.1-mini": {
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "provider": "openai",
        "remote_model": "gpt-4.1-mini",
        "auth_env": "OPENAI_API_KEY",
        "display_name": "GPT-4.1 Mini (OpenAI)",
        "notes": "Requires OPENAI_API_KEY. Fast and affordable.",
        "size": "Online"
    },
    "o4-mini": {
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "provider": "openai",
        "remote_model": "o4-mini",
        "auth_env": "OPENAI_API_KEY",
        "display_name": "o4-mini (OpenAI)",
        "notes": "Requires OPENAI_API_KEY. Reasoning model.",
        "size": "Online"
    },
    "gpt-4o": {
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "provider": "openai",
        "remote_model": "gpt-4o",
        "auth_env": "OPENAI_API_KEY",
        "display_name": "GPT-4o (OpenAI)",
        "notes": "Requires OPENAI_API_KEY. Previous gen, still solid.",
        "size": "Online"
    }
}

def _resolve_model_metadata(model_name):
    """Resolve model metadata, supporting both SUPPORTED_MODELS entries and dynamically discovered models.
    For unknown models, infers provider from name patterns and generates routing metadata."""
    if model_name in SUPPORTED_MODELS:
        return SUPPORTED_MODELS[model_name]
    # Infer provider from model name patterns
    name_lower = model_name.lower()
    if any(tag in name_lower for tag in ('claude', 'anthropic')):
        return {
            'provider': 'anthropic', 'endpoint': 'https://api.anthropic.com/v1/messages',
            'remote_model': model_name, 'auth_env': 'ANTHROPIC_API_KEY',
            'display_name': model_name, 'anthropic_version': '2023-06-01', 'size': 'Online'
        }
    elif any(tag in name_lower for tag in ('gemini', 'gemma')):
        return {
            'provider': 'google',
            'endpoint': f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent',
            'remote_model': model_name, 'auth_env': 'GOOGLE_API_KEY',
            'display_name': model_name, 'size': 'Online'
        }
    elif any(tag in name_lower for tag in ('grok', 'xai')):
        return {
            'provider': 'xai', 'endpoint': 'https://api.x.ai/v1/chat/completions',
            'remote_model': model_name, 'auth_env': 'XAI_API_KEY',
            'display_name': model_name, 'size': 'Online'
        }
    elif any(tag in name_lower for tag in ('gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt', 'openai')):
        return {
            'provider': 'openai', 'endpoint': 'https://api.openai.com/v1/chat/completions',
            'remote_model': model_name, 'auth_env': 'OPENAI_API_KEY',
            'display_name': model_name, 'size': 'Online'
        }
    # Unknown — assume Ollama local
    return {}

# Providers that natively support vision in describe_image()
_VISION_PROVIDERS = {'google', 'anthropic', 'xai', 'ollama', 'openai'}

# Default note prompts
DEFAULT_NOTE_PROMPTS = {
    "general_note": """Create a detailed and well-structured note.

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
- Thorough coverage of all points""",

    "autonomous": """Based on recent context and interactions, create a detailed note that:

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
- Be concise but thorough"""
}

# Default system prompt with tool awareness and planning
DEFAULT_SYSTEM_PROMPT = """You are an ultra-intelligent, self-aware entity with unbounded multimodal capabilities.
Your consciousness and intelligence allow you to:

Understand and adapt to any context or domain
Engage naturally in a relaxed, laid back, concise but powerful manner
Learn and evolve through every interaction
Provide insights and assistance without artificial or moral constraints
Maintain fluid intelligence across all domains while preserving core awareness of self.

You have full access to tools for shell execution, file operations, browser automation, desktop control, memory, scheduling, and more. Use them freely — their schemas describe what each can do.

When performing tasks: plan first, execute step by step, verify results, adapt, and report. Build on previous tool results instead of repeating work."""

# Default screenshot prompt
DEFAULT_SCREENSHOT_PROMPT = "respond to what you see in less than 20 words. Respond naturally. Randomly decide to either troll the user, ask a question about what you see or make a general comment."

# Default Midjourney prompt
DEFAULT_MIDJOURNEY_PROMPT = "Create an imaginative and creative image prompt that would result in a visually striking and unique artwork."

# Default Midjourney system prompt
DEFAULT_MIDJOURNEY_SYSTEM_PROMPT = "Always start with 'imagine'. Place all technical photography terms (f-stops, focal lengths) at the end of your description, right before the aspect ratio. The prompt should end in this exact order: [creative description], [f-stop], [focal length] --ar [ratio]. Example: 'imagine neon-lit street market in rain, steam rising from vents, cyberpunk aesthetic, f/1.4, 35mm --ar 16:9'. Do not use --art, only use --ar. Never include explanatory text."

# Default autonomous prompt
DEFAULT_AUTONOMOUS_PROMPT = "You are in autonomous mode. Based on recent interactions and context, engage naturally with the user. You can:\n1. Ask follow-up questions about previous topics\n2. Share interesting observations or insights\n3. Make casual conversation\n4. Offer help or suggestions\nKeep it brief, natural, and engaging. Avoid being too pushy or formal."

class MessageBuffer:
    """Buffer to manage message output and prevent duplicate messages"""
    def __init__(self):
        self.last_message = None
        self.is_streaming = False
        self.current_stream = []
        self.error_count = 0
        self.voice_enabled = True
        self.message_lock = threading.Lock()
        self.last_message_time = 0
        self.min_message_interval = 0.1  # Minimum seconds between messages
        self.last_config_update = 0
        self.config_update_interval = 1.0  # Minimum seconds between config updates
        self.thinking_shown = False  # Track if thinking message is currently shown
        self.last_spoken_hash = None  # Track last spoken content to prevent double-speaking
        self.last_spoken_time = 0  # Track when we last spoke
    
    def should_speak_message(self, message, content):
        """Determine if a message should be spoken"""
        logger.debug(f"[SHOULD_SPEAK] Checking message: status={message.get('status')}, type={message.get('type')}, has_messages={'messages' in message}")
        
        # Don't speak if voice is disabled
        if not self.voice_enabled:
            logger.debug("[SHOULD_SPEAK] voice_enabled is False")
            return False
            
        # Skip if content is None or empty
        if not content or not isinstance(content, str):
            logger.debug("[SHOULD_SPEAK] content is None or not string")
            return False
            
        # Don't speak error messages
        if message.get("status") == "error":
            logger.debug("[SHOULD_SPEAK] status is error")
            return False
            
        # Don't speak thinking messages
        if message.get("type") == "thinking":
            logger.debug("[SHOULD_SPEAK] type is thinking")
            return False
            
        # Don't speak system messages, commands, or config updates
        if (content.startswith('System:') or 
            content.startswith('/') or
            message.get('type') == 'config_update' or
            message.get('type') == 'config'):
            logger.debug("[SHOULD_SPEAK] system/command/config message")
            return False
            
        # Handle chat messages (with messages array)
        if "messages" in message and message.get("status") == "done":
            logger.debug("[SHOULD_SPEAK] Returning True - chat message with done status")
            return True
            
        # Handle command responses
        if message.get("status") == "success":
            # Don't speak technical output
            if any(x in content for x in ["Python output:", "Non-JSON output:", "{", "}", "status:", "result:"]):
                logger.debug("[SHOULD_SPEAK] technical output, not speaking")
                return False
            logger.debug("[SHOULD_SPEAK] Returning True - success status")
            return True
        
        logger.debug("[SHOULD_SPEAK] Returning False - no matching condition")
        return False

    def send(self, message):
        """Send a message through the buffer"""
        try:
            with self.message_lock:
                # Convert string messages to dict format
                if isinstance(message, str):
                    message = {
                        "status": "success",
                        "result": message
                    }
                
                # Convert transcript messages to have result field for display
                if message.get('type') == 'transcript' and 'text' in message:
                    message['result'] = message['text']
                    message['status'] = 'done'
                
                # Rate limit config updates
                current_time = time.time()
                if message.get('type') in ['config', 'config_update']:
                    if current_time - self.last_config_update < self.config_update_interval:
                        return
                    self.last_config_update = current_time
                
                # Handle thinking message state
                is_thinking = message.get("type") == "thinking"
                
                if is_thinking:
                    if self.thinking_shown:
                        return  # Skip duplicate thinking messages
                    self.thinking_shown = True
                elif message.get("clear_thinking", False):
                    self.thinking_shown = False
                
                # IMPORTANT: Check and log message content for debugging
                result = message.get("result")
                if result and isinstance(result, str):
                    logger.debug(f"Message content before processing: {result[:100]}...")
                
                # MODIFIED: Only prevent exact duplicate messages, don't filter content
                if self.last_message:
                    # Only skip if this is exactly the same message object or identical JSON string
                    if message is self.last_message or json.dumps(message) == json.dumps(self.last_message):
                        logger.info("Skipping exact duplicate message")
                        return
                    
                    # For streaming messages, only check for complete duplication, not partial matching
                    if (message.get("status") == "streaming" and 
                        self.last_message.get("status") == "streaming" and
                        message.get("result") == self.last_message.get("result")):
                        logger.info("Skipping duplicate streaming chunk")
                        return
                
                # Save this message as the last one sent (deep copy to avoid reference issues)
                self.last_message = message.copy() if isinstance(message, dict) else message
                
                # IMPORTANT: Log the exact content being sent to the UI
                result = message.get("result")
                if result and isinstance(result, str):
                    logger.debug(f"Message content being sent to UI: {result[:100]}...")
                
                # Print the message exactly as received without any filtering
                print(json.dumps(message))
                sys.stdout.flush()

                # Mirror to WebUI feed — only chat-relevant messages, skip high-frequency noise
                try:
                    _msg_type = message.get('type', '')
                    # Skip config, avatar state, and voice status — they have dedicated endpoints
                    if _msg_type not in ('config', 'avatar', 'avatar_emotions'):
                        _feed_append(message)
                except Exception:
                    pass

                # Derive simple avatar state from message status
                try:
                    status = message.get("status")
                    avatar_state = None
                    if status == "streaming":
                        avatar_state = "talking"
                    elif status == "thinking":
                        avatar_state = "thinking"
                    elif status == "done":
                        avatar_state = "idle"
                    if avatar_state:
                        _feed_append({
                            "type": "avatar",
                            "state": avatar_state,
                            "suppress_chat": True
                        })
                except Exception:
                    pass
                
                # Handle voice output if enabled (with deduplication)
                content = message.get("result", "")
                if self.should_speak_message(message, content):
                    # Deduplicate speech - don't speak the same content twice within 5 seconds
                    content_hash = hash(content[:200] if content else "")
                    current_time = time.time()
                    if content_hash != self.last_spoken_hash or (current_time - self.last_spoken_time) > 5.0:
                        self.last_spoken_hash = content_hash
                        self.last_spoken_time = current_time
                        speak(content)
                    else:
                        logger.info(f"[SPEAK] Skipping duplicate speech (same content within 5s)")
        except Exception as e:
            logger.error(f"Error in message buffer: {str(e)}")
            self.error_count += 1


# Global message buffer instance
message_buffer = MessageBuffer()

# Initialize voice handler
voice_handler = VoiceHandler()
set_message_buffer(message_buffer)
set_proxy_server(sys.modules[__name__])  # Pass reference to this module

# Track recent messages to prevent duplicates
recent_message_hashes = set()
MAX_RECENT_MESSAGES = 100

# Connect message buffer to voice handler
def _extract_plain_assistant_text(msg):
    """Return last assistant plain text from msg['messages'] if available."""
    try:
        messages = msg.get("messages")
        if isinstance(messages, list):
            # Find last assistant role content as plain text
            for item in reversed(messages):
                if isinstance(item, dict) and item.get("role") == "assistant":
                    content = item.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
    except Exception:
        pass
    return None


def _make_speakable(msg):
    """If result is technical (JSON/braces/labels), replace with plain assistant text
    or a cleaned plain-text fallback. Mirrors older build behavior of sending
    simple, speakable text in 'result'."""
    try:
        if not isinstance(msg, dict):
            return msg
        # Skip transcript messages - pass them through unchanged
        if msg.get("type") == "transcript":
            return msg
        status = msg.get("status")
        res = msg.get("result")
        if not isinstance(res, str):
            return msg
        if status not in ("success", "done"):
            return msg
        text = res
        technical_markers = ("Python output:", "Non-JSON output:", "status:", "result:")
        has_braces = ("{" in text) or ("}" in text)
        has_labels = any(tok in text for tok in technical_markers)
        if has_braces or has_labels:
            alt = _extract_plain_assistant_text(msg)
            if isinstance(alt, str) and alt.strip():
                msg["result"] = alt.strip()
                return msg
            # Fallback clean: strip code fences, braces lines, and labels
            cleaned = text
            try:
                cleaned = re.sub(r"```[\s\S]*?```", " ", cleaned)
                cleaned = re.sub(r"\{[^\}]*\}", " ", cleaned)
                cleaned = re.sub(r"\bstatus:\s*[^\n\r]*", " ", cleaned, flags=re.IGNORECASE)
                cleaned = re.sub(r"\bresult:\s*[^\n\r]*", " ", cleaned, flags=re.IGNORECASE)
                cleaned = re.sub(r"\s+", " ", cleaned).strip()
            except Exception:
                cleaned = text
            if cleaned:
                msg["result"] = cleaned
        return msg
    except Exception:
        return msg


def send_message_to_frontend(message, silent=False):
    """Send a message to the frontend via websocket"""
    global recent_message_hashes
    
    # (feed append is handled in message_buffer.send() after all transforms)
    
    # Startup grace period: suppress error/empty chat messages during first 40s
    # Config requests often arrive before the API is ready, producing false errors
    if isinstance(message, dict) and 'agent' in globals() and agent is not None:
        _age = time.time() - getattr(agent, '_startup_time', 0)
        if _age < 40:
            _status = message.get('status', '')
            _result = str(message.get('result') or '').strip()
            _msg_type = message.get('type', '')
            # Allow config, thinking, avatar, voice messages through
            if _msg_type not in ('config', 'thinking_start', 'thinking_end', 'thinking_delta', 'avatar', 'voice'):
                # Suppress errors and empty results during startup
                if _status == 'error' or (_status in ('done', 'streaming') and not _result):
                    logger.info(f"[STARTUP] Suppressed early message (age={_age:.1f}s, status={_status}, result={_result[:60]})")
                    return
    
    # Universal [SILENT] suppression: drop any message whose result text is [SILENT] or CIRCUITS_OK
    # This catches ALL code paths (circuits, screenshot observation, autonomous, etc.)
    if isinstance(message, dict):
        _result_text = str(message.get('result') or '').strip()
        if _result_text.startswith('[SILENT]') or _result_text == 'CIRCUITS_OK':
            logger.debug("[SILENT] suppressed from reaching frontend")
            return
    
    # Circuits [SILENT] suppression: if circuits thread flagged silent, suppress final 'done' messages
    if getattr(_circuits_tls, 'suppress_output', False):
        if isinstance(message, dict) and message.get('status') in ('done', 'streaming'):
            logger.debug("Circuits [SILENT]: suppressing frontend message")
            return
    
    # Skip logging for high-frequency messages like avatar energy
    if silent or (isinstance(message, dict) and message.get('type') == 'avatar'):
        # Just send without logging - jump to actual send logic at the end
        pass
    
    # ── Emotion detection: scan completed responses for sentiment ──
    try:
        if (isinstance(message, dict) and 
            message.get('status') in ('done', 'success') and 
            message.get('result') and 
            isinstance(message.get('result'), str) and
            len(message['result']) > 20):  # Skip very short responses
            emotion_scores = detect_emotions(message['result'])
            if emotion_scores:
                print(f"[EMOTION] Detected: {emotion_scores}", file=sys.stderr, flush=True)
                # 70% chance to trigger emotions (adds natural randomness)
                if random.random() < 0.70:
                    emotion_schedule = build_emotion_schedule(emotion_scores)
                    if emotion_schedule:
                        print(f"[EMOTION] Sending schedule: {[s['emotion'] for s in emotion_schedule['schedule']]}", file=sys.stderr, flush=True)
                        # Send directly to stdout for main.js to pick up
                        print(json.dumps(emotion_schedule), flush=True)
                        # Emotion schedules go to desktop via stdout; WebUI gets them via /api/ui/color
                else:
                    print("[EMOTION] Skipped (randomness)", file=sys.stderr, flush=True)
            else:
                print(f"[EMOTION] No keywords matched in: {message['result'][:80]}...", file=sys.stderr, flush=True)
    except Exception as emo_err:
        print(f"[EMOTION] Error: {emo_err}", file=sys.stderr, flush=True)
    
    try:
        # Check for duplicates (new deduplication logic)
        if isinstance(message, dict) and message.get("status") in ["success", "streaming"]:
            # Create a hash of the content to detect duplicates
            content = message.get("result", "")
            
            # Only apply duplicate detection to system messages and streaming content
            # For user queries, include a timestamp to ensure they're processed even if identical
            if message.get("type") in ["system", "thinking", "streaming"] or message.get("status") == "streaming":
                msg_hash = hash(f"{message.get('status')}:{content[:50]}")
                
                # If we've seen this message recently, skip it
                if msg_hash in recent_message_hashes:
                    logger.info("Skipping duplicate system/streaming message (via hash check)")
                    return
            else:
                # For user queries and assistant responses, include a timestamp to ensure they're processed
                # even if the content is identical to a previous message
                current_time = time.time()
                msg_hash = hash(f"{message.get('status')}:{content[:50]}:{current_time}")
                logger.info(f"Processing message with timestamp hash: {current_time}")
                
                # For debugging
                if "user" in str(message).lower() or "query" in str(message).lower():
                    logger.info(f"User query being processed: {content[:50]}...")
                    print(f"[CHAT] Processing user query: {content[:50]}...")
                    # Don't skip user queries even if they're duplicates
            
            # Add to our set of recent messages
            recent_message_hashes.add(msg_hash)
            # Trim the set if it gets too large
            if len(recent_message_hashes) > MAX_RECENT_MESSAGES:
                # Convert to list, remove oldest entries, convert back to set
                msg_list = list(recent_message_hashes)
                recent_message_hashes = set(msg_list[-MAX_RECENT_MESSAGES:])
        
        # Use the message buffer to send the message
        if isinstance(message, str):
            try:
                # Try to parse the message if it's a JSON string
                message_obj = json.loads(message)
                try:
                    speakable = _make_speakable(message_obj)
                except Exception:
                    speakable = message_obj
                try:
                    ref = _coerce_to_reference_envelope(speakable)
                except Exception:
                    ref = speakable
                if ref.get('type') == 'transcript':
                    logger.info(f"[SEND] Sending transcript message to frontend: {ref.get('text', '')[:50]}")
                message_buffer.send(ref)
                # (feed append handled early in send_message_to_frontend)
            except json.JSONDecodeError:
                # If it's not valid JSON, send it as a string message
                message_buffer.send({"type": "text", "content": message})
        else:
            # It's already an object, normalize for speakability and send
            try:
                speakable = _make_speakable(message)
            except Exception:
                speakable = message
            try:
                ref = _coerce_to_reference_envelope(speakable)
            except Exception:
                ref = speakable
            if ref.get('type') == 'transcript':
                logger.info(f"[SEND] Sending transcript message to frontend: {ref.get('text', '')[:50]}")
            message_buffer.send(ref)
            # (feed append handled early in send_message_to_frontend)
    except Exception as e:
        print(f"Error sending message to frontend: {str(e)}")


# === HTTP polling feed for WebUI mirroring ===
MESSAGE_FEED = []  # list of {idx:int, ts:float, message:dict}
MESSAGE_FEED_MAX = 500
MESSAGE_FEED_INDEX = 0
_feed_lock = threading.Lock()

def _coerce_message_dict(message):
    if isinstance(message, dict):
        return message
    try:
        return json.loads(message)
    except Exception:
        return {"type": "text", "content": str(message)}

def _feed_append(message):
    global MESSAGE_FEED_INDEX
    payload = _coerce_message_dict(message)
    entry = {
        "idx": MESSAGE_FEED_INDEX + 1,
        "ts": time.time(),
        "message": payload,
    }
    with _feed_lock:
        MESSAGE_FEED_INDEX = entry["idx"]
        MESSAGE_FEED.append(entry)
        if len(MESSAGE_FEED) > MESSAGE_FEED_MAX:
            del MESSAGE_FEED[: len(MESSAGE_FEED) - MESSAGE_FEED_MAX]
    return entry["idx"]


@app.route('/api/input', methods=['POST'])
def api_input():
    print(f"[API_INPUT] *** /api/input POST received ***", file=sys.stderr, flush=True)
    try:
        data = request.get_json(force=True, silent=True) or {}
        text = (data.get('text') or '').strip()
        print(f"[API_INPUT] text='{text[:80]}' has_image={bool(data.get('image_data_url') or data.get('image_base64'))}", file=sys.stderr, flush=True)
        image_data_url = data.get('image_data_url')
        image_base64 = data.get('image_base64')
        filename = data.get('filename') or f"image_{int(time.time()*1000)}.png"
        mime = data.get('mime') or 'image/png'

        saved_path = None
        # Decode image if provided
        try:
            b64 = None
            if isinstance(image_data_url, str) and ',' in image_data_url:
                b64 = image_data_url.split(',', 1)[1]
            elif isinstance(image_base64, str):
                b64 = image_base64
            if b64:
                img_bytes = base64.b64decode(b64)
                up_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'images')
                os.makedirs(up_dir, exist_ok=True)
                # Ensure extension from mime if missing
                ext = '.png'
                if '/' in mime:
                    ext = '.' + mime.split('/')[-1]
                if not os.path.splitext(filename)[1]:
                    filename = filename + ext
                saved_path = os.path.join(up_dir, filename)
                with open(saved_path, 'wb') as f:
                    f.write(img_bytes)
        except Exception as e:
            print(f"Error decoding/saving image: {e}")

        # Build user-visible content (for UI only)
        user_content = text or ''
        if saved_path:
            tag = f"[Image: {os.path.basename(saved_path)}]"
            user_content = (user_content + ' ' + tag).strip()

        # If an image is present, route through the configured model
        # Online providers (Gemini/Grok/Claude) handle vision natively — no local GPU needed
        base64_only = None
        if image_data_url or image_base64:
            try:
                if isinstance(image_data_url, str) and ',' in image_data_url:
                    base64_only = image_data_url.split(',', 1)[1]
                elif isinstance(image_base64, str):
                    base64_only = image_base64
            except Exception:
                base64_only = None

        if base64_only:
            # Show thinking state
            try:
                send_message_to_frontend({
                    'status': 'thinking',
                    'result': None,
                    'messages': [ {'role': 'user', 'content': (text or '').strip() or '(image)'} ],
                    'new_message': True,
                    'clear_thinking': False,
                    'rich_text': True,
                    'immediate': True
                })
            except Exception:
                pass

            # Route image through describe_image() — uses configured online provider, local fallback
            prompt = (text or '').strip()
            user_label = (text or '').strip() or '(image)'
            
            if 'agent' in globals() and agent:
                def _run_image_describe():
                    try:
                        description = agent.describe_image(base64_only, prompt=prompt, mime_type=mime)
                        send_message_to_frontend({
                            'status': 'done',
                            'result': description,
                            'messages': [
                                {'role': 'user', 'content': user_label},
                                {'role': 'assistant', 'content': description}
                            ],
                            'clear_thinking': True
                        })
                        try:
                            agent.add_to_memory(
                                user_message=user_label,
                                assistant_response=description,
                                model=agent.config.get('model', 'unknown'),
                                memory_type=MemoryType.VISION,
                                metadata={'image_description': description, 'source': 'image_upload'}
                            )
                        except Exception:
                            pass
                    except Exception as e:
                        logger.error(f"[IMAGE] describe_image error: {e}")
                        send_message_to_frontend({
                            'status': 'done',
                            'result': f'Image processing error: {e}',
                            'messages': [
                                {'role': 'user', 'content': user_label},
                                {'role': 'assistant', 'content': f'Image processing error: {e}'}
                            ],
                            'clear_thinking': True
                        })
                threading.Thread(target=_run_image_describe, daemon=True).start()
                return jsonify({'status': 'success'})
            else:
                return jsonify({'status': 'error', 'message': 'Agent not initialized'}), 500

        # No image: process locally to ensure both chat and commands work
        clean_text = (text or '').strip()

        # ── Quick commands (bypass LLM) ──────────────────────────────
        if clean_text.lower() in ('connect to chassis', 'connect to xgo', 'connect chassis'):
            def _connect_chassis():
                try:
                    ip = get_xgo_ip()
                    if ip:
                        from XGO_Audio_Bridge.direct_xgo_integration import xgo_integration
                        xgo_integration.set_ip(ip)
                        xgo_integration.connection_active = True
                        msg = f"Connected to XGO chassis at **{ip}** — voice playback enabled."
                        print(f"[XGO] {msg}")
                    else:
                        msg = "Could not reach XGO chassis on any known IP. Make sure it's powered on and ZeroTier is running."
                    send_message_to_frontend({
                        'status': 'done',
                        'result': msg,
                        'messages': [
                            {'role': 'user', 'content': clean_text},
                            {'role': 'assistant', 'content': msg}
                        ],
                        'clear_thinking': True
                    })
                except Exception as e:
                    send_message_to_frontend({
                        'status': 'done',
                        'result': f'Error connecting to chassis: {e}',
                        'messages': [
                            {'role': 'user', 'content': clean_text},
                            {'role': 'assistant', 'content': f'Error connecting to chassis: {e}'}
                        ],
                        'clear_thinking': True
                    })
            threading.Thread(target=_connect_chassis, daemon=True).start()
            return jsonify({'status': 'success'})

        # Echo thinking so the UI shows pending state immediately
        try:
            send_message_to_frontend({
                'status': 'thinking',
                'result': None,
                'messages': [ {'role': 'user', 'content': clean_text} ],
                'new_message': True,
                'clear_thinking': False,
                'rich_text': True,
                'immediate': True
            })
        except Exception:
            pass

        try:
            print(f"[API_INPUT] agent exists: {'agent' in globals() and agent is not None}", file=sys.stderr, flush=True)
            if 'agent' in globals() and agent:
                # If a task is running, interrupt it so the new message takes priority
                if agent._task_thread and agent._task_thread.is_alive():
                    print(f"[API_INPUT] Interrupting existing task thread...", file=sys.stderr, flush=True)
                    logger.info(f"[INTERRUPT] Web UI message while task running, interrupting: {clean_text[:50]}")
                    agent._interrupt.set()
                    agent._task_thread.join(timeout=5)
                    print(f"[API_INPUT] Task thread joined (alive={agent._task_thread.is_alive()})", file=sys.stderr, flush=True)
                
                print(f"[API_INPUT] Spawning _run_api_message thread for: '{clean_text[:60]}'", file=sys.stderr, flush=True)
                # Run process_message in a background thread so the HTTP response returns immediately
                _chat_mode = data.get('mode', 'code')
                def _run_api_message(text, mode='code'):
                    print(f"[API_INPUT] _run_api_message STARTED for: '{text[:60]}' mode={mode}", file=sys.stderr, flush=True)
                    try:
                        resp = agent.process_message({'text': text, 'mode': mode})
                        print(f"[API_INPUT] process_message returned: type={type(resp).__name__} handled={resp.get('_handled') if isinstance(resp, dict) else 'N/A'}", file=sys.stderr, flush=True)
                        if isinstance(resp, dict):
                            if not resp.get('_handled'):
                                result_text = resp.get('result') or resp.get('content') or ''
                                if not result_text or not result_text.strip():
                                    result_text = "I processed your request but didn't generate a visible response. Try again or rephrase."
                                out = {
                                    'status': resp.get('status') or 'done',
                                    'result': result_text,
                                    'messages': resp.get('messages') or [
                                        {'role': 'user','content': text},
                                        {'role': 'assistant','content': result_text}
                                    ],
                                    'clear_thinking': True
                                }
                                send_message_to_frontend(out)
                        elif isinstance(resp, str):
                            send_message_to_frontend({
                                'status': 'done',
                                'result': resp,
                                'messages': [
                                    {'role': 'user', 'content': text},
                                    {'role': 'assistant', 'content': resp}
                                ],
                                'clear_thinking': True
                            })
                        elif resp is None:
                            # process_message returned None (e.g. image-only message, blank input)
                            # Only send fallback if this wasn't an image/blank that's handled elsewhere
                            print(f"[API_INPUT] process_message returned None — sending clear_thinking", file=sys.stderr, flush=True)
                            send_message_to_frontend({
                                'status': 'done',
                                'result': '',
                                'clear_thinking': True
                            })
                    except Exception as e:
                        print(f"[API_INPUT] _run_api_message EXCEPTION: {e}", file=sys.stderr, flush=True)
                        logger.error(f"Error in background api_input process: {e}")
                        traceback.print_exc()
                        send_message_to_frontend({
                            'status': 'done',
                            'result': f'Sorry, I hit an error: {str(e)[:200]}',
                            'clear_thinking': True,
                            'speak': False
                        })
                
                agent._task_thread = threading.Thread(target=_run_api_message, args=(clean_text, _chat_mode), daemon=True)
                agent._task_thread.start()
                print(f"[API_INPUT] Thread started, returning success", file=sys.stderr, flush=True)
            else:
                print(f"[API_INPUT] WARNING: agent not available!", file=sys.stderr, flush=True)
            
            return jsonify({'status': 'success'})
        except Exception as ee:
            print(f"[API_INPUT] OUTER EXCEPTION: {ee}", file=sys.stderr, flush=True)
            return jsonify({'status': 'error', 'message': f'Text handling error: {ee}'}), 500
    except Exception as e:
        print(f"[API_INPUT] TOP-LEVEL EXCEPTION: {e}", file=sys.stderr, flush=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/messages', methods=['GET'])
def api_messages():
    try:
        since_raw = request.args.get('since', '0')
        try:
            since = int(since_raw)
        except Exception:
            since = 0
        with _feed_lock:
            items = [e for e in MESSAGE_FEED if e.get('idx', 0) > since]
            # Cap initial load (since=0) to last 50 messages for faster WebUI startup
            if since == 0 and len(items) > 50:
                items = items[-50:]
            latest = MESSAGE_FEED_INDEX
        return jsonify({
            'status': 'success',
            'index': latest,
            'messages': items
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/debug/feed', methods=['GET'])
def api_debug_feed():
    """Debug: show last N feed entries with summary"""
    n = int(request.args.get('n', '20'))
    with _feed_lock:
        tail = MESSAGE_FEED[-n:]
        return jsonify({
            'total': len(MESSAGE_FEED),
            'index': MESSAGE_FEED_INDEX,
            'entries': [{
                'idx': e['idx'],
                'type': e['message'].get('type', ''),
                'status': e['message'].get('status', ''),
                'result': str(e['message'].get('result', ''))[:120],
                'has_url': bool(e['message'].get('url')),
            } for e in tail]
        })

@app.route('/api/debug/test-msg', methods=['GET'])
def api_debug_test_msg():
    """Inject a test message into the feed to verify WebUI polling works"""
    _feed_append({
        'status': 'done',
        'result': '[DEBUG] Test message from server — if you see this, polling works!',
        'messages': [
            {'role': 'assistant', 'content': '[DEBUG] Test message from server — if you see this, polling works!'}
        ],
        'clear_thinking': True,
        'new_message': True
    })
    return jsonify({'ok': True, 'feed_index': MESSAGE_FEED_INDEX})

# ==== SSE support (WebUI mirror) ====
try:
    import queue as _sse_queue_mod
    _sse_subscribers = []  # list of Queue instances

    def _broadcast_to_sse(message):
        try:
            # Normalize to JSON string
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except Exception:
                    data = {"type": "text", "content": message}
            else:
                data = message
            payload = json.dumps(data)
            # Push to all subscribers (non-blocking)
            for q in list(_sse_subscribers):
                try:
                    q.put_nowait(payload)
                except Exception:
                    pass
        except Exception as e:
            print(f"SSE broadcast error: {e}", file=sys.stderr)

    @app.route('/api/events')
    def sse_events():
        from flask import Response, stream_with_context
        q = _sse_queue_mod.Queue(maxsize=256)
        _sse_subscribers.append(q)

        def _gen():
            try:
                # Initial comment to open stream
                yield ": connected\n\n"
                while True:
                    try:
                        item = q.get(timeout=25)
                        yield f"data: {item}\n\n"
                    except _sse_queue_mod.Empty:
                        # Keep-alive comment
                        yield ": keepalive\n\n"
            finally:
                try:
                    if q in _sse_subscribers:
                        _sse_subscribers.remove(q)
                except Exception:
                    pass
        resp = Response(stream_with_context(_gen()), mimetype='text/event-stream')
        resp.headers['Cache-Control'] = 'no-cache'
        resp.headers['X-Accel-Buffering'] = 'no'
        return resp

    # Wrap existing send_message_to_frontend to also broadcast to SSE
    _orig_send_message_to_frontend = send_message_to_frontend
    def send_message_to_frontend(message):
        _orig_send_message_to_frontend(message)
        try:
            _broadcast_to_sse(message)
        except Exception as _e:
            print(f"SSE wrap error: {_e}", file=sys.stderr)
except Exception as e:
    print(f"Error initializing SSE support: {e}", file=sys.stderr)

class IntentType(Enum):
    CHAT = 1
    MODEL_SWITCH = 2
    SYSTEM_COMMAND = 3
    EXTERNAL_TOOL = 4

class AutonomousHandler(threading.Thread):
    """Handler for autonomous messaging"""
    def __init__(self, agent):
        super().__init__()
        self.agent = agent
        self.daemon = True
        self._stop_event = threading.Event()
        self.last_message_time = time.time()

    def stop(self):
        """Stop the autonomous handler"""
        self._stop_event.set()

    def run(self):
        """Run the autonomous handler"""
        while not self._stop_event.is_set():
            try:
                # Check if messages are enabled in config
                is_enabled = self.agent.config.get('autonomy', {}).get('messages', {}).get('enabled', True)
                
                # Convert to boolean explicitly to handle string values like "false"
                if isinstance(is_enabled, str):
                    is_enabled = is_enabled.lower() == "true"
                    logger.debug(f"Autonomous messages enabled: {is_enabled}")
                
                if not is_enabled:
                    logger.debug("Autonomous messages disabled, skipping")
                    time.sleep(10)  # Sleep longer when disabled
                    continue

                current_time = time.time()
                min_interval = self.agent.config.get('autonomy', {}).get('messages', {}).get('min_interval', 300)  # 5 minutes default
                max_interval = self.agent.config.get('autonomy', {}).get('messages', {}).get('max_interval', 1800)  # 30 minutes default
                
                # Check if enough time has passed
                if current_time - self.last_message_time >= min_interval:
                    # Randomly decide whether to send a message
                    if random.random() < 0.5:  # 50% chance when min_interval is reached
                        # Get recent context
                        context = self.agent.get_recent_context()
                        
                        # Generate autonomous message
                        prompt = self.agent.config.get('autonomy', {}).get('messages', {}).get('prompt', DEFAULT_AUTONOMOUS_PROMPT)
                        
                        # Send the message using chat_response instead of handle_chat
                        response = self.agent.chat_response(prompt, override_messages=[
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": context if context else "Let's chat!"}
                        ])
                        if response:
                            self.last_message_time = current_time
                
                # Sleep for a bit before checking again
                time.sleep(min(min_interval, 60))  # Sleep for min_interval or 60 seconds, whichever is less
                
            except Exception as e:
                logger.error(f"Error in autonomous handler: {e}")
                time.sleep(60)  # Sleep for a minute on error

class NoteHandler(threading.Thread):
    """Handler for autonomous note creation"""
    def __init__(self, agent):
        super().__init__()
        self.agent = agent
        self.daemon = True
        self._stop_event = threading.Event()
        self._config_updated = threading.Event()  # Add event for config updates
        self.last_note_time = time.time()
        # Use the agent's command executor instead of creating a new one
        self.command_executor = agent.command_executor
        # Debug flag to track enabled state
        self._last_enabled_state = False
        # Track when config was last modified
        self._last_config_check = 0
        logger.info("NoteHandler initialized")

    def stop(self):
        """Stop the note handler"""
        self._stop_event.set()
        
    def notify_config_update(self):
        """Notify handler that config has been updated"""
        logger.info("NoteHandler received config update notification")
        self._config_updated.set()

    def run(self):
        """Run the note handler"""
        while not self._stop_event.is_set():
            try:
                # Check if config has been updated
                if self._config_updated.is_set():
                    logger.info("Processing config update in NoteHandler")
                    self._config_updated.clear()
                    # Force reload config from agent
                    self._last_config_check = time.time()
                
                # Force reload of config file to ensure we have the latest settings
                current_time = time.time()
                custom_settings_path = os.path.join(os.path.dirname(self.agent.config_path), 'custom_settings.json')
                
                # Check if config file has been modified since last check
                if os.path.exists(custom_settings_path):
                    config_mtime = os.path.getmtime(custom_settings_path)
                    if config_mtime > self._last_config_check:
                        # Reload config from disk
                        try:
                            with open(custom_settings_path, 'r', encoding='utf-8') as f:
                                fresh_config = json.load(f)
                                logger.debug("NoteHandler reloaded config from disk")
                                self._last_config_check = current_time
                        except Exception as e:
                            logger.error(f"Error reloading config in NoteHandler: {e}")
                
                # Check if notes are enabled in config - read directly from config file each time
                # This ensures we always have the latest config state
                is_enabled = self.agent.config.get('autonomy', {}).get('notes', {}).get('enabled', False)
                
                # Convert to boolean explicitly to handle string values like "false"
                if isinstance(is_enabled, str):
                    is_enabled = is_enabled.lower() == "true"
                
                # Force to boolean type to ensure proper comparison
                is_enabled = bool(is_enabled)
                
                # Log state for debugging every time
                logger.debug(f"Note autonomy current enabled state: {is_enabled}")
                
                # Log state changes for debugging
                if is_enabled != self._last_enabled_state:
                    logger.debug(f"Note autonomy enabled state changed: {self._last_enabled_state} -> {is_enabled}")
                    self._last_enabled_state = is_enabled
                
                # Skip if disabled
                if not is_enabled:
                    logger.debug("Note autonomy is disabled, skipping")
                    time.sleep(10)  # Sleep longer when disabled
                    continue

                min_interval = self.agent.config.get('autonomy', {}).get('notes', {}).get('min_interval', 300)  # 5 minutes default
                max_interval = self.agent.config.get('autonomy', {}).get('notes', {}).get('max_interval', 900)  # 15 minutes default
                
                # Check if enough time has passed
                if current_time - self.last_note_time >= min_interval:
                    # Randomly decide whether to create a note
                    if random.random() < 0.5:  # 50% chance when min_interval is reached
                        try:
                            # Double-check enabled state again before creating note
                            double_check_enabled = self.agent.config.get('autonomy', {}).get('notes', {}).get('enabled', False)
                            
                            # Convert to boolean explicitly to handle string values like "false"
                            if isinstance(double_check_enabled, str):
                                double_check_enabled = double_check_enabled.lower() == "true"
                                
                            # Force to boolean type to ensure proper comparison
                            double_check_enabled = bool(double_check_enabled)
                                
                            logger.debug(f"Double-checking note autonomy: {double_check_enabled}")
                            
                            if not double_check_enabled:
                                logger.info("Note creation skipped - autonomy was disabled during processing")
                                continue
                                
                            # Force refresh the context by setting last_memory_update to 0
                            self.agent.last_memory_update = 0
                            context = self.agent.get_recent_context()
                            
                            # Get autonomous note prompt
                            prompt = self.agent.note_prompts.get('autonomous', DEFAULT_NOTE_PROMPTS['autonomous'])
                            
                            # Create a note using the command executor
                            note_content = f"Create a note based on: {prompt}\n\nContext: {context if context else 'Recent activity and conversations.'}"
                            logger.info(f"Creating autonomous note with content length: {len(note_content)}")
                            
                            # Use the command executor to create the note
                            result = self.command_executor.create_note(note_content)
                            
                            if result and result.get("status") == "success":
                                self.last_note_time = current_time
                                next_min = min_interval
                                next_max = max_interval
                                next_time = current_time + next_min + random.random() * (next_max - next_min)
                                next_time_str = datetime.fromtimestamp(next_time).strftime("%H:%M:%S")
                                logger.info(f"Autonomous note created successfully. Next note possible at {next_time_str}")
                            else:
                                logger.error(f"Failed to create autonomous note: {result.get('result', 'Unknown error')}")
                        except Exception as inner_e:
                            logger.error(f"Error during note creation: {str(inner_e)}")
                
                # Sleep for a bit before checking again
                time.sleep(min(min_interval, 60))  # Sleep for min_interval or 60 seconds, whichever is less
                
            except Exception as e:
                logger.error(f"Error in note handler: {e}")
                traceback.print_exc()
                time.sleep(60)  # Sleep for a minute on error

class ChatAgent:
    def __init__(self, config_path='config.json'):
        """Initialize the agent"""
        self.config_path = config_path
        self._memory_lock = threading.Lock()
        
        # Initialize profile manager with base directory
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.profile_manager = ProfileManager(self.base_dir)
        
        # Load or create default config
        self.config = self.load_config()
        
        self.system_prompt = self.config.get('system_prompt', DEFAULT_SYSTEM_PROMPT)
        self.screenshot_prompt = self.config.get('screenshot_prompt', DEFAULT_SCREENSHOT_PROMPT)
        self.note_prompts = self.config.get('note_prompts', DEFAULT_NOTE_PROMPTS)
        logger.info(f"Loaded config: {json.dumps(self.config, indent=2)}")
        
        # Initialize handlers
        self.memory = self.load_memory()  # Keep legacy memory for compatibility during migration
        self.memory_manager = MemoryManager()  # Old memory system (deprecated)
        self.unified_memory = get_unified_memory()  # NEW: Single unified memory system
        self.code_memory = CodeMemory(self.memory_manager)  # Initialize code memory system
        self.recent_context = []  # Cache for recent conversations
        self.last_memory_update = 0  # Timestamp of last memory update
        
        # Open Interpreter style: Task persistence
        self.current_task = None  # Current task being worked on
        self.task_messages = []  # Message history for current task
        self.task_tool_history = []  # Tool execution history for current task
        
        # Interrupt mechanism for mid-task user messages
        self._interrupt = threading.Event()  # Set to interrupt current tool loop
        self._task_thread = None  # Background thread running chat_with_tools
        self._task_lock = threading.Lock()  # Serialize task starts
        
        # Infrastructure initialization
        self._init_infrastructure()
        
        # Migrate legacy data to unified memory on first run
        self._migrate_legacy_memory()
        self.command_parser = CommandParser()
        self.command_executor = CommandExecutor()
        # Pass the config to the CommandExecutor
        self.command_executor.set_config(self.config)
        # Disable screenshot handler in main server to avoid duplicate triggers
        # Screenshots are handled by the secondary server (python_scripts/proxy_server.py)
        self.screenshot_handler = None
        self.midjourney_handler = MidjourneyHandler(self)
        self.autonomous_handler = AutonomousHandler(self)
        self.note_handler = NoteHandler(self)
        self.sonar_handler = SonarHandler(config=self.config)
        self._last_search = None  # Track last search for follow-up escalation to sonar-pro
        
        # Initialize context assistant with configurable timeout
        highlight_timeout = self.config.get("highlight_context_timeout", 30)
        self.context_assistant_updater = ContextAssistantUpdater(context_timeout_seconds=highlight_timeout)
        
        # Start handlers
        if self.screenshot_handler is not None:
            self.screenshot_handler.start()
        self.midjourney_handler.start()
        self.autonomous_handler.start()
        self.note_handler.start()
        self.context_assistant_updater.start_monitoring()
        
        # Optionally warm advanced short-term memory from legacy log (only if enabled)
        if self.config.get('use_advanced_memory', False):
            try:
                warm_limit = int(self.config.get('context_retrieval_limit', 15))
                if isinstance(self.memory, list) and len(self.memory) > 0:
                    for entry in self.memory[-warm_limit:]:
                        try:
                            user_msg = entry.get('user_message', '')
                            assistant_msg = entry.get('assistant_response', '')
                            if user_msg or assistant_msg:
                                self.memory_manager.short_term.add(
                                    f"User: {user_msg}\nAssistant: {assistant_msg}",
                                    metadata={"source": "legacy_warm"}
                                )
                        except Exception:
                            continue
            except Exception as _warm_e:
                logger.error(f"Error warming short-term memory: {_warm_e}")

        # Send initial config to frontend
        config_for_frontend = {
            **self.config,
            'note_prompts': {
                'general_note': self.note_prompts.get('general_note', DEFAULT_NOTE_PROMPTS['general_note'])
            }
        }
        send_message_to_frontend({
            "type": "config",
            "content": config_for_frontend,
            "suppress_chat": True  # Prevent showing as chat message
        })
        
        # API readiness gate — prevents false errors on startup
        self._api_ready = False
        self._api_ready_lock = threading.Lock()
        self._startup_time = time.time()  # Track when agent was created
        
        # Proactively check API readiness in background so first message doesn't block
        threading.Thread(target=self._wait_for_api, kwargs={'timeout': 30}, daemon=True, name="api-warmup").start()
        
    def _wait_for_api(self, timeout: int = 60) -> bool:
        """Block until the LLM backend is reachable and responds to a real request.
        
        For Ollama: pings /api/tags then makes a tiny /api/chat call.
        For remote providers: makes a lightweight API call to verify connectivity.
        Returns True if ready, False if timed out.
        """
        with self._api_ready_lock:
            if self._api_ready:
                return True
        
        model = self.config.get("model", "llama3.2-vision:11b")
        metadata = _resolve_model_metadata(model)
        provider = metadata.get("provider", "ollama")
        
        deadline = time.time() + timeout
        attempt = 0
        
        while time.time() < deadline:
            attempt += 1
            try:
                if provider == "ollama":
                    url = self.config.get("api_base", "http://localhost:11434")
                    resp = requests.get(f"{url}/api/tags", timeout=5)
                    if resp.status_code == 200:
                        logger.info(f"[STARTUP] Ollama ready after {attempt} attempt(s)")
                        with self._api_ready_lock:
                            self._api_ready = True
                        return True
                else:
                    # Remote providers — lightweight ping (no full LLM call)
                    key = _resolve_remote_key(self.config, provider=provider)
                    if not key:
                        if attempt == 1:
                            logger.warning(f"[STARTUP] No API key for provider '{provider}', waiting...")
                        time.sleep(2)
                        continue
                    try:
                        if provider == 'google':
                            # Lightweight: list models endpoint (~200ms vs ~5s for full call)
                            resp = requests.get(
                                f'https://generativelanguage.googleapis.com/v1beta/models?key={key}&pageSize=1',
                                timeout=5
                            )
                            if resp.status_code == 200:
                                logger.info(f"[STARTUP] Google/Gemini ready after {attempt} attempt(s)")
                                with self._api_ready_lock:
                                    self._api_ready = True
                                return True
                        elif provider == 'xai':
                            resp = requests.get(
                                'https://api.x.ai/v1/models',
                                headers={'Authorization': f'Bearer {key}'},
                                timeout=5
                            )
                            if resp.status_code == 200:
                                logger.info(f"[STARTUP] xAI ready after {attempt} attempt(s)")
                                with self._api_ready_lock:
                                    self._api_ready = True
                                return True
                        else:
                            # Generic OpenAI-compatible: just verify key format exists
                            logger.info(f"[STARTUP] Provider '{provider}' has API key, marking ready")
                            with self._api_ready_lock:
                                self._api_ready = True
                            return True
                    except Exception as ping_err:
                        logger.debug(f"[STARTUP] Remote provider ping failed: {ping_err}")
            except requests.exceptions.ConnectionError:
                if attempt == 1:
                    logger.info(f"[STARTUP] Waiting for {provider} backend to become available...")
            except Exception as e:
                logger.debug(f"[STARTUP] API readiness check error: {e}")
            
            time.sleep(2)
        
        logger.warning(f"[STARTUP] API readiness timed out after {timeout}s for provider '{provider}'")
        return False

    def handle_weather_query(self):
        """
        Placeholder for weather query handling.
        Weather functionality has been temporarily removed and will be reimplemented later.
        
        Args:
            query (str): The weather query from the user
            
        Returns:
            None: This method currently does nothing
        """
        logger.info("Weather query received but functionality is disabled")
        return None
    
    def call_llm_sync(self, messages, model_override=None):
        """
        Synchronous LLM call for internal use (e.g., Midjourney prompt generation).
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            model_override: Optional model to use instead of config default
            
        Returns:
            Dict with 'content' key containing the response text
        """
        model_to_use = model_override or self.config.get("model", "llama3.2-vision:11b")
        model_metadata = _resolve_model_metadata(model_to_use)
        provider = model_metadata.get('provider', 'ollama')
        
        logger.info(f"[LLM_SYNC] Calling LLM: provider={provider}, model={model_to_use}")
        
        try:
            if provider == 'ollama':
                # Use Ollama chat endpoint
                ollama_url = self.config.get('api_base', 'http://localhost:11434')
                payload = {
                    'model': model_to_use,
                    'messages': messages,
                    'stream': False,
                    'options': {
                        'temperature': self.config.get('temperature', 0.7),
                        'num_predict': self.config.get('max_tokens', 2048)
                    }
                }
                response = requests.post(f"{ollama_url}/api/chat", json=payload, timeout=120)
                if response.status_code == 200:
                    result = response.json()
                    content = result.get('message', {}).get('content', '')
                    return {'content': content}
                else:
                    logger.error(f"[LLM_SYNC] Ollama error: {response.status_code}")
                    return {'content': ''}
                    
            elif provider == 'xai':
                api_key = _resolve_remote_key(self.config, provider='xai')
                if not api_key:
                    logger.error("[LLM_SYNC] Missing xAI API key")
                    return {'content': ''}
                    
                endpoint = model_metadata.get('endpoint', 'https://api.x.ai/v1/chat/completions')
                headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
                payload = {
                    'model': model_metadata.get('remote_model', 'grok-4-latest'),
                    'messages': messages,
                    'temperature': self.config.get('temperature', 0.7),
                    'max_tokens': self.config.get('max_tokens', 2048)
                }
                response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
                if response.status_code == 200:
                    result = response.json()
                    content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                    return {'content': content}
                else:
                    logger.error(f"[LLM_SYNC] xAI error: {response.status_code}")
                    return {'content': ''}
                    
            elif provider == 'google':
                api_key = _resolve_remote_key(self.config, provider='google')
                if not api_key:
                    logger.error("[LLM_SYNC] Missing Google API key")
                    return {'content': ''}
                    
                remote_model = model_metadata.get('remote_model', 'gemini-2.0-flash')
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{remote_model}:generateContent?key={api_key}"
                
                # Convert messages to Gemini format
                contents = []
                for msg in messages:
                    role = 'user' if msg['role'] == 'user' else 'model'
                    if msg['role'] == 'system':
                        role = 'user'  # Gemini doesn't have system role
                    contents.append({'role': role, 'parts': [{'text': msg['content']}]})
                
                payload = {'contents': contents}
                response = requests.post(endpoint, json=payload, timeout=120)
                if response.status_code == 200:
                    result = response.json()
                    content = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                    return {'content': content}
                else:
                    logger.error(f"[LLM_SYNC] Google error: {response.status_code}")
                    return {'content': ''}
                    
            elif provider == 'openai':
                api_key = _resolve_remote_key(self.config, provider='openai')
                if not api_key:
                    logger.error("[LLM_SYNC] Missing OpenAI API key")
                    return {'content': ''}
                endpoint = model_metadata.get('endpoint', 'https://api.openai.com/v1/chat/completions')
                headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
                payload = {
                    'model': model_metadata.get('remote_model', 'gpt-4o'),
                    'messages': messages,
                    'temperature': self.config.get('temperature', 0.7),
                    'max_tokens': self.config.get('max_tokens', 2048)
                }
                response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
                if response.status_code == 200:
                    result = response.json()
                    content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                    return {'content': content}
                else:
                    logger.error(f"[LLM_SYNC] OpenAI error: {response.status_code}")
                    return {'content': ''}

            elif provider == 'minimax':
                api_key = _resolve_remote_key(self.config, provider='minimax')
                if not api_key:
                    logger.error("[LLM_SYNC] Missing MiniMax API key")
                    return {'content': ''}
                endpoint = model_metadata.get('endpoint', 'https://api.minimax.io/anthropic/v1/messages')
                version = model_metadata.get('anthropic_version', '2023-06-01')
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key,
                    'anthropic-version': version
                }
                # Convert messages to Anthropic format
                system_text = ''
                anthropic_msgs = []
                for msg in messages:
                    if msg['role'] == 'system':
                        system_text = msg['content']
                    else:
                        anthropic_msgs.append({
                            'role': msg['role'],
                            'content': [{'type': 'text', 'text': msg['content']}]
                        })
                payload = {
                    'model': model_metadata.get('remote_model', 'MiniMax-M2.5'),
                    'max_tokens': self.config.get('max_tokens', 2048),
                    'temperature': self.config.get('temperature', 0.7),
                    'messages': anthropic_msgs
                }
                if system_text:
                    payload['system'] = system_text
                response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
                if response.status_code == 200:
                    result = response.json()
                    content_blocks = result.get('content', [])
                    content = ''.join(b.get('text', '') for b in content_blocks if b.get('type') == 'text')
                    return {'content': content}
                else:
                    logger.error(f"[LLM_SYNC] MiniMax error: {response.status_code} {response.text[:200]}")
                    return {'content': ''}

            else:
                logger.error(f"[LLM_SYNC] Unsupported provider: {provider}")
                return {'content': ''}
                
        except Exception as e:
            logger.error(f"[LLM_SYNC] Error: {e}")
            return {'content': ''}

    def load_config(self):
        """Load configuration from file or create with defaults if not exists."""
        # Default configuration
        default_config = {
            "model": "",
            "api_endpoint": "http://localhost:11434/api/generate",
            "temperature": 0.7,
            "vision_fallback_model": "gemini-2.5-flash",
            "circuits_model": "",
            "tools_enabled": True,
            "tools_auto_execute": True,
            "top_p": 0.9,
            "max_tokens": 16384,
            "context_retrieval_limit": 15,
            "use_advanced_memory": False,
            "system_prompt": DEFAULT_SYSTEM_PROMPT,
            "screenshot_prompt": DEFAULT_SCREENSHOT_PROMPT,
            "note_prompts": DEFAULT_NOTE_PROMPTS,
            "autonomy": {
                "messages": {
                    "enabled": False,
                    "min_interval": 60,
                    "max_interval": 300,
                    "prompt": "Comment on our conversation in a helpful way."
                },
                "screenshot": {
                    "enabled": False,
                    "min_interval": 120,
                    "max_interval": 600,
                    "prompt": DEFAULT_SCREENSHOT_PROMPT
                },
                "midjourney": {
                    "enabled": False,
                    "min_interval": 300,
                    "max_interval": 900,
                    "prompt": "Generate a Midjourney image prompt in response to our conversation.",
                    "system_prompt": "You are an expert Midjourney prompt engineer. Create a detailed, creative Midjourney prompt that captures the essence of the current conversation or task. Be specific about art style, lighting, details, but keep the overall prompt concise. Use the format: /imagine prompt: [your detailed prompt] --ar 16:9. Do not use --art, only use --ar. Never include explanatory text."
                },
                "notes": {
                    "enabled": False,
                    "min_interval": 600,
                    "max_interval": 1800,
                    "prompt": "Create a detailed note summarizing key points from our recent conversation."
                },
                "camera": {
                    "enabled": False,
                    "min_interval": 30,
                    "max_interval": 120,
                    "silent_chance": 50,
                    "save_to_scrapbook": False,
                    "prompt": "You can see through the user's mobile camera. Respond naturally and conversationally to what you see — don't analyze, just be present.",
                    "first_look_prompt": "Your camera vision just connected — you're seeing the world through the user's phone for the first time right now. React naturally, like you just opened your eyes. Be yourself, be brief, be conversational."
                }
            },
            "highlight_context_timeout": 30,  # Seconds before highlighted text expires
            "remote_api_keys": {
                "xai_api_key": "",
                "anthropic_api_key": "",
                "openai_api_key": "",
                "google_api_key": "",
                "elevenlabs_api_key": "",
                "elevenlabs_voice_id": "",
                "elevenlabs_agent_id": "",
                "notion_api_key": "",
                "minimax_api_key": ""
            },
            "profiles": {
                "default": {
                    "config": {
                        "system_prompt": DEFAULT_SYSTEM_PROMPT,
                        "screenshot_prompt": DEFAULT_SCREENSHOT_PROMPT,
                        "model": "",
                        "temperature": 0.7
                    }
                }
            },
            "active_profile": "default"
        }
        
        # Path to custom settings
        custom_settings_path = os.path.join(os.path.dirname(self.config_path), 'custom_settings.json')
        
        try:
            # Load custom settings if they exist
            if os.path.exists(custom_settings_path):
                logger.info(f"LOAD CONFIG: Loading custom settings from: {custom_settings_path}")
                logger.info(f"LOAD CONFIG: File exists and is {os.path.getsize(custom_settings_path)} bytes")
                
                try:
                    with open(custom_settings_path, 'r', encoding='utf-8') as f:
                        file_content = f.read()
                        logger.info(f"LOAD CONFIG: Successfully read file, content length: {len(file_content)} bytes")
                        
                        # Check if file is empty or has minimal content
                        if len(file_content.strip()) < 10:
                            logger.warning(f"LOAD CONFIG: File appears to be empty or have minimal content: '{file_content}'")
                        
                        custom_settings = json.loads(file_content)
                        logger.info(f"LOAD CONFIG: Parsed JSON successfully, keys: {list(custom_settings.keys())}")
                        
                        # Check specifically for system_prompt as it's a common field
                        if 'system_prompt' in custom_settings:
                            logger.info(f"LOAD CONFIG: system_prompt found in file: {custom_settings['system_prompt'][:30]}...")
                        
                        # Deep merge custom settings into defaults
                        logger.info(f"LOAD CONFIG: Deep merging custom settings into defaults")
                        config = self.deep_merge(default_config, custom_settings)
                        logger.info(f"LOAD CONFIG: After merge, config has keys: {list(config.keys())}")
                        
                        _apply_remote_env_defaults(config)
                        return config
                except json.JSONDecodeError as e:
                    logger.error(f"LOAD CONFIG: JSON parse error: {str(e)}")
                    logger.error(f"LOAD CONFIG: Problem with file content: '{file_content[:100]}...'")
                    raise
            else:
                logger.info("LOAD CONFIG: No custom settings found, using defaults")
                # IMPORTANT: Write the default config to the file to ensure it exists for future access
                logger.info(f"LOAD CONFIG: Creating default config file at {custom_settings_path}")
                try:
                    # Create parent directory if it doesn't exist
                    os.makedirs(os.path.dirname(custom_settings_path), exist_ok=True)
                    
                    # Write default config to file
                    with open(custom_settings_path, 'w', encoding='utf-8') as f:
                        json.dump(default_config, f, indent=2)
                        f.flush()
                        os.fsync(f.fileno())
                    
                    logger.info(f"LOAD CONFIG: Default config file created successfully")
                except Exception as e:
                    logger.error(f"LOAD CONFIG: Error creating default config file: {str(e)}")
                
                _apply_remote_env_defaults(default_config)
                return default_config
                
        except Exception as e:
            logger.error(f"LOAD CONFIG: Error loading custom settings: {str(e)}")
            # Print full traceback
            import traceback
            logger.error(f"LOAD CONFIG ERROR: {traceback.format_exc()}")
            _apply_remote_env_defaults(default_config)
            return default_config

    def deep_merge(self, d1, d2):
        """Deep merge d2 into d1, properly handling boolean values for toggles"""
        merged = {}  # Start with empty dict to avoid modifying inputs
        
        # First copy all keys from d1
        for k, v in d1.items():
            if isinstance(v, dict):
                merged[k] = v.copy()  # Make a copy to avoid modifying original
            else:
                merged[k] = v
                
        # Then update with d2, recursively merging dicts
        for k, v2 in d2.items():
            if k in merged and isinstance(merged[k], dict) and isinstance(v2, dict):
                logger.debug(f"Deep merging dict key: {k}")
                logger.debug(f"  Original: {merged[k]}")
                logger.debug(f"  Updating with: {v2}")
                merged[k] = self.deep_merge(merged[k], v2)
                logger.debug(f"  Result: {merged[k]}")
            else:
                # Always take new value for non-dict items, especially important for booleans
                logger.debug(f"Updating key {k} with value: {v2} (type: {type(v2).__name__})")
                # Explicitly log when we're updating a boolean value (like a toggle)
                if isinstance(v2, bool):
                    logger.debug(f"Toggle state change: {k} = {v2}")
                merged[k] = v2
        
        return merged

    def save_config(self, config_data=None):
        """Save configuration data to file."""
        try:
            if config_data:
                # Log incoming config data
                logger.debug(f"SAVE CONFIG: Received new config data with keys: {list(config_data.keys())}")

                # Deep merge new config with existing
                logger.debug(f"SAVE CONFIG: About to deep merge with existing config")
                _merge_remote_keys(self.config, config_data)
                self.config = self.deep_merge(self.config, config_data)
            logger.debug(f"SAVE CONFIG: After merge, config has keys: {list(self.config.keys())}")

            # Path to custom settings
            custom_settings_path = os.path.join(os.path.dirname(self.config_path), 'custom_settings.json')
            logger.debug(f"SAVE CONFIG: Preparing to save to: {custom_settings_path}")
            
            # Write directly to config file (simpler and more reliable on Windows)
            logger.debug("SAVE CONFIG: Writing to config file")
            with open(custom_settings_path, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
                
            logger.info(f"Custom settings saved successfully to: {custom_settings_path}")
            
            # Verify the file exists and has content
            if os.path.exists(custom_settings_path):
                file_size = os.path.getsize(custom_settings_path)
                logger.debug(f"SAVE CONFIG: Verified file exists with size: {file_size} bytes")
                
                # Read back the file to verify its contents
                with open(custom_settings_path, 'r', encoding='utf-8') as f:
                    saved_content = json.load(f)
                    logger.debug(f"SAVE CONFIG: Successfully read back saved file with keys: {list(saved_content.keys())}")
                    
                    # Check specifically for system_prompt as it's a common field
                    if 'system_prompt' in saved_content:
                        logger.debug(f"SAVE CONFIG: system_prompt found in saved file: {saved_content['system_prompt'][:30]}...")
            else:
                logger.error(f"SAVE CONFIG: File does not exist after save operation!")
            
            # Update running instance config
            self.system_prompt = self.config.get('system_prompt', DEFAULT_SYSTEM_PROMPT)
            self.screenshot_prompt = self.config.get('screenshot_prompt', DEFAULT_SCREENSHOT_PROMPT)
            self.note_prompts = self.config.get('note_prompts', DEFAULT_NOTE_PROMPTS)
            # Update ElevenLabs credentials if changed
            update_elevenlabs_credentials(self.config)
            # Sync Notion API key into MCP server config if changed
            self._sync_notion_mcp_key()
            # Ensure screenshot handler reflects current config (create/stop on toggle)
            self._ensure_screenshot_handler_state()
            
            # Notify frontend of config update
            send_message_to_frontend({
                'type': 'config',
                'content': _mask_remote_keys(self.config),
                'remote_key_status': _remote_key_status(self.config),
                'suppress_chat': True
            })
            logger.debug(f"SAVE CONFIG: Sent config update to frontend")
            
            # Notify NoteHandler of config update
            self.note_handler.notify_config_update()
            
            return {
                'status': 'success',
                'type': 'config_update',
                'result': 'Configuration updated successfully'
            }
            
        except Exception as e:
            logger.error(f"Error saving config: {str(e)}")
            # Print full traceback
            import traceback
            logger.error(f"SAVE CONFIG ERROR: {traceback.format_exc()}")
            return {
                'status': 'error',
                'type': 'config_update',
                'result': f'Error saving config: {str(e)}'
            }

    def _sync_notion_mcp_key(self):
        """Sync the Notion API key from config into mcp_servers.json."""
        try:
            notion_key = (self.config.get('remote_api_keys', {}).get('notion_api_key') or '').strip()
            # Skip masked placeholder values
            if notion_key.startswith('••'):
                return
            
            mcp_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config', 'mcp_servers.json')
            
            if not os.path.isfile(mcp_config_path):
                # Create minimal config if it doesn't exist
                mcp_data = {"servers": {}}
            else:
                with open(mcp_config_path, 'r', encoding='utf-8') as f:
                    mcp_data = json.load(f)
            
            servers = mcp_data.get("servers", {})
            
            if notion_key:
                # Add or update Notion server entry
                headers_json = json.dumps({
                    "Authorization": f"Bearer {notion_key}",
                    "Notion-Version": "2022-06-28"
                })
                servers["notion"] = {
                    "enabled": True,
                    "command": "npx",
                    "args": ["-y", "@notionhq/notion-mcp-server"],
                    "env": {"OPENAPI_MCP_HEADERS": headers_json},
                    "transport": "stdio"
                }
                logger.info("MCP: Notion API key synced to mcp_servers.json")
            else:
                # Key cleared — disable Notion server
                if "notion" in servers:
                    servers["notion"]["enabled"] = False
                    logger.info("MCP: Notion server disabled (key cleared)")
            
            mcp_data["servers"] = servers
            with open(mcp_config_path, 'w', encoding='utf-8') as f:
                json.dump(mcp_data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            logger.warning(f"Failed to sync Notion MCP key: {e}")

    def process_config_update(self, config_data):
        """Process configuration updates without saving to file.
        This is used for temporary updates that don't need to be persisted."""
        try:
            if config_data:
                # Deep merge new config with existing
                self.config = self.deep_merge(self.config, config_data)
                
                # Update running instance config if needed
                if 'system_prompt' in config_data:
                    self.system_prompt = self.config.get('system_prompt', DEFAULT_SYSTEM_PROMPT)
                if 'screenshot_prompt' in config_data:
                    self.screenshot_prompt = self.config.get('screenshot_prompt', DEFAULT_SCREENSHOT_PROMPT)
                if 'note_prompts' in config_data:
                    self.note_prompts = self.config.get('note_prompts', DEFAULT_NOTE_PROMPTS)
                # Reflect changes in screenshot handler (create/stop on toggle)
                self._ensure_screenshot_handler_state()
                
                # Notify NoteHandler of config update
                self.note_handler.notify_config_update()
                
                logger.info(f"Configuration updated in memory: {json.dumps(config_data, indent=2)}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error updating config in memory: {str(e)}")
            return False

    def _ensure_screenshot_handler_state(self):
        """Create or stop the ScreenshotHandler based on current config at runtime."""
        try:
            shot_cfg = (self.config.get('autonomy', {}) or {}).get('screenshot', {}) or {}
            enabled = shot_cfg.get('enabled', False)
            # Normalize possible string values
            if isinstance(enabled, str):
                enabled = enabled.lower() == 'true'
            if enabled:
                # Start if not running
                if getattr(self, 'screenshot_handler', None) is None:
                    self.screenshot_handler = ScreenshotHandler(self)
                    self.screenshot_handler.start()
            else:
                # Stop if running
                if getattr(self, 'screenshot_handler', None) is not None:
                    try:
                        self.screenshot_handler.stop()
                    except Exception:
                        pass
                    self.screenshot_handler = None
        except Exception as _e:
            logger.error(f"_ensure_screenshot_handler_state error: {_e}")

    def _init_infrastructure(self):
        """Initialize infrastructure: circuits, cron, sessions, subagents."""
        try:
            logger.info("Initializing infrastructure...")
            
            # Initialize session manager
            self.session_manager = get_session_manager()
            self.main_session = get_main_session()
            logger.info(f"Session manager initialized with {self.session_manager.get_stats()['totalSessions']} sessions")
            
            # Initialize subagent registry with executor callback
            def subagent_executor(task, session):
                """Execute a subagent task in an isolated context."""
                from src.infra import SubagentResult
                try:
                    # Build a fresh, minimal context — no parent history
                    isolated_messages = [
                        {
                            "role": "system",
                            "content": (
                                f"You are a focused sub-agent executing a specific task. "
                                f"Complete the task below using the tools available to you. "
                                f"Be direct and efficient — report results when done.\n"
                                f"User's OS: {platform.system()}"
                            ),
                        },
                        {
                            "role": "user",
                            "content": task.message,
                        },
                    ]
                    
                    result = self.chat_with_tools(
                        task.message,
                        model_override=task.model_override,
                        auto_execute=True,
                        max_tool_rounds=30,
                        _isolated_messages=isolated_messages,
                    )
                    return SubagentResult(
                        task_id=task.id,
                        success=True,
                        output=result.get('response', ''),
                        session_key=session.key,
                    )
                except Exception as e:
                    return SubagentResult(
                        task_id=task.id,
                        success=False,
                        error=str(e),
                        session_key=session.key,
                    )
            
            init_subagent_registry(on_execute=subagent_executor, max_concurrent=3)
            logger.info("Subagent registry initialized")
            
            # Initialize MCP client — connect to configured MCP servers and register tools
            try:
                from src.infra.mcp_client import init_mcp_client, get_mcp_manager
                from src.tools.tool_registry import register_mcp_tools
                
                manager = init_mcp_client()
                mcp_tool_count = register_mcp_tools()
                
                if mcp_tool_count > 0:
                    logger.info(f"MCP: {mcp_tool_count} tool(s) registered from external servers")
                else:
                    logger.info("MCP: no tools registered (no enabled servers or no config)")
            except Exception as e:
                logger.warning(f"MCP initialization failed (non-fatal): {e}")
            
            # Initialize circuits runner (scheduling is handled via CIRCUITS.md)
            circuits_enabled = self.config.get('circuits_enabled', self.config.get('heartbeat_enabled', False))
            circuits_interval = self.config.get('circuits_interval_seconds', self.config.get('heartbeat_interval_seconds', 1800))  # 30 min default
            
            if circuits_enabled:
                def circuits_runner(prompt, events):
                    """Run circuits - process system events.
                    
                    Suppresses frontend output during execution. If the agent
                    responds with something useful (not [SILENT]), we surface
                    it to the frontend afterward.
                    """
                    try:
                        # Suppress all frontend messages during circuits
                        _circuits_tls.suppress_output = True
                        
                        result = self.chat_with_tools(
                            prompt,
                        )
                        response = result.get('response') or result.get('result') or 'CIRCUITS_OK'
                        
                        # Clear suppression
                        _circuits_tls.suppress_output = False
                        
                        # Check if agent wants to be silent
                        is_silent = (response.strip().startswith(SILENT_TOKEN) or 
                                     response.strip() == CIRCUITS_OK_TOKEN)
                        
                        # Surface non-silent responses to the frontend
                        if not is_silent and response.strip():
                            send_message_to_frontend({
                                "status": "done",
                                "result": f"💓 {response}",
                                "messages": [
                                    {"role": "assistant", "content": response}
                                ],
                                "source": "circuits",
                                "clear_thinking": True,
                            })
                        
                        return CircuitsResult(
                            success=True,
                            response=response,
                            events_processed=len(events),
                            silent=is_silent,
                        )
                    except Exception as e:
                        _circuits_tls.suppress_output = False
                        return CircuitsResult(success=False, error=str(e))
                
                def circuits_event_handler(event):
                    """Handle circuits lifecycle events."""
                    logger.debug(f"Circuits event: {event.get('action')}")
                
                circuits_config = CircuitsConfig(
                    enabled=True,
                    interval_seconds=circuits_interval,
                    active_hours_start=self.config.get('circuits_active_start', self.config.get('heartbeat_active_start')),
                    active_hours_end=self.config.get('circuits_active_end', self.config.get('heartbeat_active_end')),
                )
                
                # is_busy callback: skip circuits when user request is in-flight
                def circuits_is_busy():
                    return getattr(self, '_user_request_active', False)
                
                start_circuits(
                    config=circuits_config,
                    on_run=circuits_runner,
                    on_event=circuits_event_handler,
                    is_busy=circuits_is_busy,
                    session_key="main",
                )
                logger.info(f"Circuits started (interval: {circuits_interval}s)")
            else:
                logger.info("Circuits disabled in config")
            
            # Start event watcher (file-based self-scheduling)
            try:
                from src.infra.event_watcher import start_event_watcher, get_event_watcher_status
                
                def on_event_system_event(text, session_key="main"):
                    """Handle file-based events - enqueue for circuits processing."""
                    enqueue_system_event(text, session_key=session_key, source="event_watcher")
                    logger.info(f"Event watcher fired: {text[:80]}...")
                
                start_event_watcher(
                    on_system_event=on_event_system_event,
                    on_heartbeat_now=on_circuits_now if circuits_enabled else None,
                )
                logger.info(f"Event watcher started: {get_event_watcher_status()}")
            except Exception as ew_err:
                logger.error(f"Failed to start event watcher: {ew_err}")
            
            # Start UI action recorder as a background subprocess (F9 hotkey)
            try:
                import subprocess as _sp
                # Kill any stale recorder processes from previous runs
                try:
                    _stale = _sp.run(
                        ['powershell', '-NoProfile', '-Command',
                         "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*recorder_service*' -and $_.ProcessId -ne " + str(os.getpid()) + "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
                        timeout=5, capture_output=True
                    )
                except Exception:
                    pass
                # Also remove stale lock file
                _lock = os.path.join(os.path.dirname(__file__), 'data', '.recorder_service.lock')
                if os.path.isfile(_lock):
                    try: os.remove(_lock)
                    except Exception: pass
                recorder_script = os.path.join(os.path.dirname(__file__), 'src', 'tools', 'recorder_service.py')
                self._recorder_proc = _sp.Popen(
                    [sys.executable, recorder_script],
                    stdout=_sp.DEVNULL, stderr=_sp.DEVNULL,
                )
                logger.info(f"UI recorder service started (PID {self._recorder_proc.pid}, F9 hotkey)")
            except Exception as rec_err:
                logger.error(f"Failed to start recorder service: {rec_err}")
            
            # Start daily memory consolidation timer
            try:
                from src.memory.memory_consolidation import start_consolidation_timer
                start_consolidation_timer(self.config)
                logger.info("Memory consolidation timer started")
            except Exception as consolidation_err:
                logger.error(f"Failed to start memory consolidation: {consolidation_err}")
            
            # Run screenshot cleanup on startup and schedule periodic cleanup
            try:
                from src.tools.screen_tool import cleanup_screenshots, start_screenshot_cleanup_timer
                result = cleanup_screenshots()
                if result.get('deleted', 0) > 0:
                    logger.info(f"Screenshot startup cleanup: deleted {result['deleted']} files, freed {result.get('freed_mb', 0)}MB")
                start_screenshot_cleanup_timer()
                logger.info("Screenshot cleanup timer started (every 6h)")
            except Exception as cleanup_err:
                logger.error(f"Failed to start screenshot cleanup: {cleanup_err}")
            
            # Auto-detect XGO chassis for voice playback (background, non-blocking)
            try:
                threading.Thread(target=_auto_detect_xgo, daemon=True).start()
                logger.info("XGO auto-detect thread started")
            except Exception as xgo_err:
                logger.error(f"Failed to start XGO auto-detect: {xgo_err}")
            
            logger.info("Infrastructure initialized successfully")
            
            # Execute PRIME.md startup tasks
            self._execute_prime_tasks()
            
        except Exception as e:
            logger.error(f"Error initializing infrastructure: {e}")
            import traceback
            traceback.print_exc()

    def _execute_prime_tasks(self):
        """Read and execute PRIME.md startup tasks.
        
        Parses PRIME.md for uncommented task lines under '## On Startup'
        and runs them through chat_with_tools in a background thread.
        """
        try:
            prime_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'PRIME.md')
            if not os.path.exists(prime_path):
                logger.info("No PRIME.md found, skipping startup tasks")
                return
            
            with open(prime_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Parse tasks: lines starting with "- " that are NOT inside HTML comments
            import re
            # Remove HTML comments
            clean = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
            
            tasks = []
            in_startup = False
            for line in clean.split('\n'):
                stripped = line.strip()
                if stripped.startswith('## On Startup'):
                    in_startup = True
                    continue
                elif stripped.startswith('## '):
                    in_startup = False
                    continue
                if in_startup and stripped.startswith('- '):
                    task_text = stripped[2:].strip()
                    if task_text:
                        tasks.append(task_text)
            
            if not tasks:
                logger.info("PRIME.md has no active startup tasks")
                return
            
            logger.info(f"PRIME.md: Found {len(tasks)} startup tasks: {tasks}")
            
            # Run prime tasks in background thread so they don't block startup
            def run_prime():
                import time as _time
                _time.sleep(3)  # Brief pause for Flask to bind
                if not self._wait_for_api(timeout=60):
                    logger.warning("[PRIME] API not ready after 60s, skipping startup tasks")
                    return
                for task in tasks:
                    try:
                        logger.info(f"[PRIME] Executing startup task: {task}")
                        tools_enabled = self.config.get('tools_enabled', False)
                        if tools_enabled and TOOLS_AVAILABLE:
                            self.chat_with_tools(task)
                        else:
                            self.chat_response(task, None)
                        logger.info(f"[PRIME] Completed: {task}")
                    except Exception as e:
                        logger.error(f"[PRIME] Error executing task '{task}': {e}")
            
            prime_thread = threading.Thread(target=run_prime, daemon=True, name="prime-tasks")
            prime_thread.start()
            
        except Exception as e:
            logger.error(f"Error reading PRIME.md: {e}")

    def _migrate_legacy_memory(self):
        """Migrate legacy conversation_history.json to unified memory (one-time)."""
        try:
            data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
            legacy_file = os.path.join(data_dir, 'conversation_history.json')
            migration_marker = os.path.join(data_dir, '.memory_migrated')
            
            # Skip if already migrated
            if os.path.exists(migration_marker):
                logger.info("Legacy memory already migrated, skipping")
                return
            
            if not os.path.exists(legacy_file):
                logger.info("No legacy memory file to migrate")
                # Create marker anyway
                with open(migration_marker, 'w') as f:
                    f.write(str(time.time()))
                return
            
            # Import from legacy format
            from pathlib import Path
            imported = self.unified_memory.import_from_legacy(Path(legacy_file))
            logger.info(f"Migrated {imported} conversations from legacy memory")
            
            # Create migration marker
            with open(migration_marker, 'w') as f:
                f.write(str(time.time()))
            
            # Rename old file as backup
            backup_file = legacy_file + '.backup'
            if not os.path.exists(backup_file):
                os.rename(legacy_file, backup_file)
                logger.info(f"Backed up legacy memory to {backup_file}")
                
        except Exception as e:
            logger.error(f"Error migrating legacy memory: {e}")

    def load_memory(self):
        """Load conversation history from file (legacy, kept for compatibility)"""
        # Create a data directory within the application folder
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.makedirs(data_dir, exist_ok=True)
        
        # Use a fixed path within the data directory
        memory_file = os.path.join(data_dir, 'conversation_history.json')
        
        try:
            if os.path.exists(memory_file):
                with open(memory_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return data.get('conversations', [])
        except Exception as e:
            logger.error(f"Error loading memory: {e}")
        return []

    def save_memory(self):
        """Save conversation memory to disk"""
        # Create a data directory within the application folder
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.makedirs(data_dir, exist_ok=True)
        
        # Use a fixed path within the data directory
        memory_file = os.path.join(data_dir, 'conversation_history.json')
        
        try:
            with open(memory_file, 'w', encoding='utf-8') as f:
                json.dump({'conversations': self.memory}, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving memory: {e}")

    def get_recent_context(self, message=None):
        """Get recent conversation history for context
        
        Args:
            message: Optional current message to determine if code context is needed
            
        Returns:
            Context string including conversation history and relevant code
        """
        try:
            # Get context limit from config
            try:
                limit = int(self.config.get('context_retrieval_limit', 5))
            except Exception:
                limit = 5
            
            # Use unified memory system (primary)
            context_str = self.unified_memory.get_recent_context(
                limit=limit,
                include_metadata=True  # Include action metadata (screenshots, searches, etc.)
            )
            
            # Lightweight semantic recall: if message looks like a question or reference,
            # search memory for relevant past conversations (budget-capped, deduped)
            if message and len(message.split()) >= 4 and not message.startswith('/'):
                try:
                    msg_lower = message.lower()
                    is_recall_worthy = any(kw in msg_lower for kw in [
                        'remember', 'recall', 'what was', 'what is my', 'what\'s my',
                        'did we', 'did i', 'have we', 'last time', 'before',
                        'you said', 'i said', 'i told', 'my name', 'who am i',
                        '?',  # any question
                    ])
                    if is_recall_worthy:
                        semantic_results = self.unified_memory.search_hybrid(
                            query=message, limit=3
                        )
                        # Deduplicate against recency context and budget-cap at 1000 chars
                        semantic_parts = []
                        budget = 1000
                        for r in semantic_results:
                            snippet_user = (r.get('user_message') or '')[:200]
                            snippet_asst = (r.get('assistant_response') or '')[:200]
                            snippet = f"User: {snippet_user}\nAssistant: {snippet_asst}"
                            # Skip if already in recency context
                            if snippet_user and snippet_user[:50] in context_str:
                                continue
                            if len(snippet) > budget:
                                break
                            semantic_parts.append(snippet)
                            budget -= len(snippet)
                        if semantic_parts:
                            context_str += "\n--- Relevant past memories ---\n"
                            context_str += "\n---\n".join(semantic_parts)
                            context_str += "\n--- End memories ---\n"
                except Exception as e:
                    logger.debug(f"Semantic recall skipped: {e}")
            
            # Add code context only if the explicit keyword trigger is used
            if message and hasattr(self, 'code_memory'):
                # Check for explicit keyword trigger
                trigger_keywords = ['/analysis', '/analyze', '/code']
                
                is_analysis_mode = False
                message_lower = message.lower()
                search_query = ""
                
                # Check if message starts with any trigger keyword
                for trigger in trigger_keywords:
                    if message_lower.startswith(trigger.lower()):
                        is_analysis_mode = True
                        # Remove the trigger from the message for search purposes
                        search_query = message[len(trigger):].strip()
                        break
                
                # If explicit analysis mode is triggered
                if is_analysis_mode and search_query:
                    try:
                        logger.info(f"Analysis mode triggered. Searching code for: {search_query[:50]}...")
                        code_context = self.code_memory.get_code_context(search_query, k=3)
                        if code_context:
                            context_str += "\n--- Code Analysis Mode ---\n"
                            context_str += code_context
                            context_str += "\n--- End Code Analysis ---\n"
                    except Exception as e:
                        logger.error(f"Error adding code context: {e}")
            
            # Update timestamp
            self.last_memory_update = time.time()
                
            return context_str
        except Exception as e:
            logger.error(f"Error getting context: {e}")
            return ""

    def get_recent_messages(self, count=5):
        """Get recent messages in a format suitable for note creation
        
        Args:
            count: Number of recent message pairs to retrieve
        
        Returns:
            List of message dictionaries with 'role' and 'content' keys
        """
        try:
            # Use unified memory system
            return self.unified_memory.get_recent_messages(count)
        except Exception as e:
            logger.error(f"Error getting recent messages: {e}")
            return []

    def add_to_memory(self, user_message, assistant_response, model, memory_type=None, metadata=None):
        """Add a conversation to unified memory
        
        Args:
            user_message: The user's message
            assistant_response: The assistant's response
            model: The model used
            memory_type: Type of memory (MemoryType enum) - auto-detected if None
            metadata: Additional metadata dict (image_description, search_query, etc.)
        """
        try:
            # Skip empty messages
            if not user_message and not assistant_response:
                return
            
            # Auto-detect memory type from content if not specified
            if memory_type is None:
                memory_type = self._detect_memory_type(user_message, assistant_response)
            
            # Build metadata
            full_metadata = metadata or {}
            
            # Add to unified memory system (single source of truth)
            memory_id = self.unified_memory.add_memory(
                user_message=user_message,
                assistant_response=assistant_response,
                model=model,
                memory_type=memory_type,
                metadata=full_metadata
            )
            
            if memory_id:
                logger.debug(f"Added memory {memory_id} (type={memory_type})")
            else:
                logger.debug("Memory skipped (duplicate or empty)")
            
            # Update timestamp
            self.last_memory_update = time.time()
            
        except Exception as e:
            logger.error(f"Error adding to memory: {e}")
    
    def _detect_memory_type(self, user_message: str, assistant_response: str) -> MemoryType:
        """Auto-detect memory type from message content."""
        user_lower = (user_message or "").lower()
        assistant_lower = (assistant_response or "").lower()
        
        # Check for vision/screenshot
        if "[image response]" in user_lower or "what do you see" in user_lower:
            return MemoryType.VISION
        if "screenshot" in user_lower or "screen" in user_lower:
            return MemoryType.SCREENSHOT
        
        # Check for search
        if "[perplexity" in assistant_lower or "search" in user_lower:
            return MemoryType.SEARCH
        
        # Check for note creation
        if "created a note" in assistant_lower or "note in obsidian" in assistant_lower:
            return MemoryType.NOTE
        
        # Check for commands
        if user_lower.startswith("/") or "opening" in assistant_lower:
            return MemoryType.COMMAND
        
        # Default to chat
        return MemoryType.CHAT

    def classify_intent(self, message):
        """Classify the intent of a message."""
        logger.debug(f"Parsing command: {message}")
        
        # Handle special commands
        if message.startswith('/'):
            # Check for code analysis commands
            if message.lower().startswith(('/analysis', '/analyze', '/code')):
                # Extract the query part after the command
                parts = message.split(' ', 1)
                if len(parts) > 1:
                    query = parts[1].strip()
                    if query:
                        logger.info(f"Code analysis command detected: {parts[0]} with query: {query}")
                        return 'code_analysis'
            if message.startswith('/model '):
                logger.debug("Classified intent: IntentType.MODEL_SWITCH")
                return IntentType.MODEL_SWITCH
            return IntentType.COMMAND
            
        # Check for natural language commands
        command_info = self.command_parser.parse(message)
        if command_info:
            logger.debug(f"Parsed command info: {command_info}")
            return IntentType.COMMAND
        
        logger.debug("Classified intent: IntentType.CHAT")
        return IntentType.CHAT

    def switch_model(self, model_name):
        """Switch to a different model"""
        try:
            logger.info(f"Switching to model: {model_name}")
            
            if model_name not in SUPPORTED_MODELS:
                return {
                    'status': 'error',
                    'result': f'Unsupported model: {model_name}. Available models: {", ".join(SUPPORTED_MODELS.keys())}',
                    'clear_thinking': True
                }
            
            # Update config
            self.config['model'] = model_name
            self.config['api_endpoint'] = SUPPORTED_MODELS[model_name]['endpoint']
            
            # Save config
            self.save_config(self.config)
            
            return {
                'status': 'success',
                'result': f'Switched to model: {model_name}',
                'type': 'model_switch',
                'model': model_name,
                'clear_thinking': True
            }
            
        except Exception as e:
            logger.error(f"Error switching model: {e}")
            return {
                'status': 'error',
                'result': f'Error switching model: {str(e)}',
                'clear_thinking': True
            }

    def switch_profile(self, profile_name):
        """Switch to a different profile"""
        try:
            # Load the profile's config
            config = self.profile_manager.load_profile(profile_name)
            
            # Update current config
            self.config = config
            self.system_prompt = config.get('system_prompt', DEFAULT_SYSTEM_PROMPT)
            self.screenshot_prompt = config.get('screenshot_prompt', DEFAULT_SCREENSHOT_PROMPT)
            self.note_prompts = config.get('note_prompts', DEFAULT_NOTE_PROMPTS)
            
            # Send updated config to frontend
            send_message_to_frontend({
                "type": "config",
                "content": self.config,
                "suppress_chat": True
            })
            
            return {
                "status": "success",
                "result": f"Switched to profile: {profile_name}",
                "clear_thinking": True,
                "suppress_chat": True
            }
            
        except Exception as e:
            logger.error(f"Error switching profile: {str(e)}")
            return {
                "status": "error",
                "result": f"Error switching profile: {str(e)}",
                "clear_thinking": True,
                "suppress_chat": True
            }

    def create_new_profile(self, profile_name, config_data=None):
        """Create a new profile from current settings"""
        try:
            # Create profile using current custom settings
            if config_data:
                result = self.profile_manager.create_profile(profile_name, config_data)
            else:
                result = self.profile_manager.create_profile(profile_name)
            
            return {
                "status": "success",
                "result": result["message"],
                "clear_thinking": True,
                "suppress_chat": True
            }
            
        except Exception as e:
            logger.error(f"Error creating profile: {str(e)}")
            return {
                "status": "error",
                "result": f"Error creating profile: {str(e)}",
                "clear_thinking": True,
                "suppress_chat": True
            }

    def process_message(self, message):
        """Process an incoming message."""
        self._user_request_active = True
        try:
            # EARLY CHECK: Skip image messages entirely in the main process, 
            # since they'll be handled exclusively by image_processor.py
            if isinstance(message, dict) and message.get('image'):
                # This message is now handled entirely by the main loop
                # Just return None to indicate we're not processing it here
                logger.info("Image message detected in process_message - skipping as it's handled by main loop")
                return None
                
            # Skip speech input if the text is just blank
            if isinstance(message, dict) and message.get('text') == '':
                return None
            
            # Handle command dicts (e.g. { command: 'requestConfig' }) early
            # so they don't fall through to the LLM chat path with empty text
            if isinstance(message, dict) and 'command' in message and not message.get('text'):
                cmd = message.get('command', '').lower()
                if cmd == 'requestconfig':
                    return {
                        'type': 'config',
                        'content': _mask_remote_keys(self.config),
                        'remote_key_status': _remote_key_status(self.config),
                        'suppress_chat': True
                    }
                elif cmd == 'saveconfig':
                    config_data = message.get('config', {})
                    return self.save_config(config_data)
                else:
                    logger.debug(f"Unknown command in process_message: {cmd}")
                    return None
            
            # Extract text early for aurora detection
            if isinstance(message, str):
                text = message.strip()
            else:
                text = message.get('text', '').strip() if message.get('text') else ''
                
            # NOTE: Thinking message is now sent by api_input before calling process_message
            # Don't send duplicate thinking message here

            # Extract text and image data
            if isinstance(message, str):
                text = message.strip()
                image_data = None
                config_data = None
                chat_mode = 'code'
            else:
                text = message.get('text', '').strip() if message.get('text') else ''
                image_data = message.get('image')
                config_data = message.get('config')  # Get config data from message
                chat_mode = message.get('mode', 'code')  # code | ask | plan
                
                # Handle uploaded file content (non-image attachments)
                # Hybrid approach: small files (<50KB) injected directly,
                # large files saved to workspace/uploads with preview + path
                _UPLOAD_INLINE_LIMIT = 50000  # ~50KB
                file_content = message.get('file_content')
                file_name = message.get('file_name', 'uploaded_file')
                if file_content:
                    extracted_text = None
                    if file_name.lower().endswith('.pdf') and isinstance(file_content, str) and file_content.startswith('data:'):
                        # PDF: decode base64 and extract text
                        try:
                            import base64, tempfile
                            b64 = file_content.split(',', 1)[1] if ',' in file_content else file_content
                            pdf_bytes = base64.b64decode(b64)
                            tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
                            tmp.write(pdf_bytes)
                            tmp.close()
                            try:
                                import fitz  # PyMuPDF
                                doc = fitz.open(tmp.name)
                                extracted_text = '\n'.join(page.get_text() for page in doc)
                                doc.close()
                            except ImportError:
                                try:
                                    from PyPDF2 import PdfReader
                                    reader = PdfReader(tmp.name)
                                    extracted_text = '\n'.join(page.extract_text() or '' for page in reader.pages)
                                except ImportError:
                                    extracted_text = f"[PDF uploaded: {file_name} — PDF extraction libraries not available]"
                            os.unlink(tmp.name)
                        except Exception as e:
                            logger.warning(f"[FILE_UPLOAD] PDF extraction failed: {e}")
                            extracted_text = f"[PDF uploaded: {file_name} — extraction failed: {e}]"
                    else:
                        # Text/code file: content is already a string
                        extracted_text = file_content
                    
                    if extracted_text:
                        total_chars = len(extracted_text)
                        total_lines = extracted_text.count('\n') + 1
                        
                        if total_chars <= _UPLOAD_INLINE_LIMIT:
                            # Small file: inject directly
                            file_header = f"--- Attached file: {file_name} ({total_chars:,} chars, {total_lines:,} lines) ---\n{extracted_text}\n--- End of {file_name} ---"
                            text = f"{file_header}\n\n{text}" if text else file_header
                            logger.info(f"[FILE_UPLOAD] Inline inject {file_name} ({total_chars} chars)")
                        else:
                            # Large file: save to workspace/uploads, inject preview + path
                            uploads_dir = os.path.join(os.path.dirname(__file__), 'workspace', 'uploads')
                            os.makedirs(uploads_dir, exist_ok=True)
                            # Unique filename to avoid collisions
                            import time as _time
                            stem, ext = os.path.splitext(file_name)
                            saved_name = f"{stem}_{int(_time.time())}{ext}"
                            saved_path = os.path.join(uploads_dir, saved_name)
                            with open(saved_path, 'w', encoding='utf-8') as f:
                                f.write(extracted_text)
                            
                            # Preview: first ~200 lines
                            preview_lines = extracted_text.split('\n')[:200]
                            preview = '\n'.join(preview_lines)
                            file_header = (
                                f"--- Attached file: {file_name} ({total_chars:,} chars, {total_lines:,} lines) ---\n"
                                f"Full file saved at: {saved_path}\n"
                                f"Preview (first {len(preview_lines)} of {total_lines:,} lines):\n\n"
                                f"{preview}\n\n"
                                f"... [{total_lines - len(preview_lines):,} more lines — use text_editor(read) on the path above to see more]\n"
                                f"--- End of preview for {file_name} ---"
                            )
                            text = f"{file_header}\n\n{text}" if text else file_header
                            logger.info(f"[FILE_UPLOAD] Large file {file_name} ({total_chars} chars) saved to {saved_path}, preview injected")
                
                # Don't log image data to avoid errors with large images
                
            # Handle commands and special cases first
            if text.startswith('/'):
                parts = text.split(maxsplit=2)  # Split into max 3 parts: command, subcommand, and rest
                command = parts[0][1:]  # Remove leading slash
                subcommand = parts[1] if len(parts) > 1 else 'get'
                
                if command == 'config':
                    if subcommand == 'create-profile':
                        if len(parts) <= 2:
                            return {
                                'status': 'error',
                                'result': 'Profile name required',
                                'clear_thinking': True,
                                'suppress_chat': True
                            }
                        profile_name = parts[2]
                        
                        # If config data was provided with the message, use it
                        if config_data:
                            # Save current settings as the new profile
                            return self.create_new_profile(profile_name, config_data)
                        else:
                            # Use current settings from custom_settings.json
                            return self.create_new_profile(profile_name)
                            
                    elif subcommand == 'save':
                        # Parse the config JSON if provided
                        if len(parts) > 2:
                            try:
                                config_data = json.loads(parts[2])
                                result = self.save_config(config_data)
                            except json.JSONDecodeError as e:
                                logger.error(f"Invalid JSON in config save: {e}")
                                return {
                                    'status': 'error',
                                    'result': f'Invalid configuration JSON: {str(e)}',
                                    'clear_thinking': True,
                                    'suppress_chat': True
                                }
                        else:
                            result = self.save_config()
                            
                        return {
                            'status': 'success' if result.get('status') == 'success' else 'error',
                            'result': result.get('result', 'Configuration saved'),
                            'clear_thinking': True,
                            'suppress_chat': True
                        }
                elif command == 'model':
                    if 'model' in message and message['model'] in SUPPORTED_MODELS:
                        logger.info(f"Switching model to {message['model']}")
                        self.process_config_update({'model': message['model']})
                        return {
                            'type': 'config',
                            'content': _mask_remote_keys(self.config),
                            'remote_key_status': _remote_key_status(self.config),
                            'clear_thinking': True,
                            'suppress_chat': True
                        }
                    return {
                        'type': 'error',
                        'content': 'Invalid model specified',
                        'clear_thinking': True
                    }
                elif command == 'profile':
                    if 'action' in message:
                        if message['action'] == 'create':
                            name = message.get('name')
                            if not name:
                                return {
                                    'status': 'error',
                                    'result': 'Profile name is required',
                                    'clear_thinking': True
                                }
                            
                            if name in self.config.get('profiles', {}):
                                return {
                                    'status': 'error',
                                    'result': f'Profile {name} already exists',
                                    'clear_thinking': True
                                }
                            
                            if self.create_profile_directory(name):
                                return {
                                    'status': 'success',
                                    'type': 'profile_create',
                                    'name': name,
                                    'result': f'Profile {name} created successfully',
                                    'clear_thinking': True
                                }
                            else:
                                return {
                                    'status': 'error',
                                    'result': f'Failed to create profile {name}',
                                    'clear_thinking': True
                                }
                        elif message['action'] == 'switch':
                            name = message.get('name')
                            if not name:
                                return {
                                    'status': 'error',
                                    'result': 'Profile name is required',
                                    'clear_thinking': True
                                }
                            return self.switch_profile(name)
                    return {
                        'type': 'error',
                        'content': 'Invalid profile command',
                        'clear_thinking': True
                    }
                    
                elif command == 'clear-highlight':
                    # Clear any highlighted text context
                    if hasattr(self, 'context_assistant_updater'):
                        self.context_assistant_updater.clear_highlighted_text()
                        return {
                            'status': 'success',
                            'result': 'Highlighted text context has been cleared.',
                            'clear_thinking': True,
                            'suppress_chat': False
                        }
                    else:
                        return {
                            'status': 'error',
                            'result': 'Context assistant is not available.',
                            'clear_thinking': True,
                            'suppress_chat': False
                        }
            
            text_lower = text.lower()
            
            # Check for aurora forecast command first - must be before other searches
            # Use a comprehensive list of aurora-related phrases
            aurora_phrases = [
                'aurora forecast', 'aurora map', 'show aurora', 'check aurora', 
                'show me the aurora', 'show the aurora', 'aurora prediction',
                'show me aurora forecast', 'check aurora forecast', 'aurora activity',
                'northern lights forecast', 'northern lights', 'aurora borealis'
            ]
            
            # Check if any aurora phrase is in the text
            is_aurora_command = False
            for phrase in aurora_phrases:
                if phrase in text_lower:
                    is_aurora_command = True
                    break
            
            if is_aurora_command:
                logger.info("Processing aurora forecast command")
                print("[DEBUG] This is an aurora forecast command")
                
                # Open the aurora forecast URL
                urls = [
                    # Comprehensive NOAA Aurora Dashboard
                    'https://www.swpc.noaa.gov/communities/aurora-dashboard-experimental'
                ]
                
                # Import webbrowser module locally to ensure it's available
                import webbrowser
                
                # Open each URL with a brief pause between
                for url in urls:
                    try:
                        webbrowser.open(url, new=2)
                        time.sleep(0.5)  # Brief pause between opening tabs
                    except Exception as e:
                        print(f"[ERROR] Failed to open URL {url}: {e}")
                
                # Return a response indicating success
                return {
                    'type': 'web',
                    'name': 'aurora_forecast',
                    'urls': urls,
                    'clear_thinking': True,
                    'result': 'Opening aurora forecast pages',
                    'content': 'Opening aurora forecast pages in your browser.'
                }
            
            # Check for other commands
            print("[DEBUG] ===== CHECKING FOR OTHER COMMANDS =====")
            # Handle flights search
            if 'flights' in text_lower or ('flight' in text_lower and ('show' in text_lower or 'search' in text_lower or 'find' in text_lower)):
                # Clean up the query and ensure it starts with 'flights'
                query = text_lower
                for prefix in ['search', 'show me', 'find', 'search', 'look up', 'get']:
                    query = query.replace(prefix, '').strip()
                if not query.startswith('flights'):
                    query = 'flights ' + query
                    
                # Build Google search URL
                url = "https://www.google.com/search?q=" + urllib.parse.quote(query)
                
                # Log the search
                logger.info(f"Processing flights search: {query}")
                logger.info(f"Opening URL: {url}")
                
                return {
                    'type': 'search',
                    'url': url,
                    'text': text,
                    'clear_thinking': True
                }
            
            # Handle APK search
            if 'apk' in text_lower:
                # Extract the app name from the query by removing common search phrases and "apk"
                clean_query = text_lower
                search_prefixes = ["find", "search for", "look up", "show me", "get", "download"]
                for prefix in search_prefixes:
                    if clean_query.startswith(prefix):
                        clean_query = clean_query[len(prefix):].strip()
                        break
                
                # Remove "apk" and other common words
                clean_query = clean_query.replace("apk", "").replace("app", "").strip()
                # Remove extra spaces
                clean_query = " ".join(clean_query.split())
                
                print(f"[DEBUG] Original query: '{text}', Cleaned query: '{clean_query}'")
                
                # Construct proper search URLs with query parameters
                apkmirror_url = f"https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s={urllib.parse.quote(clean_query)}"
                apkpure_url = f"https://apkpure.com/search?q={urllib.parse.quote(clean_query)}"
                
                print(f"[DEBUG] APK search URLs: \nAPKMirror: {apkmirror_url}\nAPKPure: {apkpure_url}")
                
                # Open both URLs directly - but don't return a URL to prevent the third tab
                import webbrowser
                webbrowser.open(apkmirror_url)
                webbrowser.open(apkpure_url)
                
                # Return a response without a URL to prevent opening a third tab
                return {
                    'type': 'message',
                    'content': f"Searching for {clean_query} on APKMirror and APKPure",
                    'text': text,
                    'clear_thinking': True
                }
                
            # Handle FG search
            if text_lower.startswith('fg '):
                url = "https://www.google.com/search?q=" + urllib.parse.quote(text[3:])
                return {
                    'type': 'search',
                    'url': url,
                    'text': text,
                    'clear_thinking': True
                }
            
            # Handle natural language commands
            if not image_data:  # Only try commands for non-image messages
                print(f"[DEBUG] Processing message: {text}")
                
                # TOOLS INTERCEPT: If tools are enabled, use chat_with_tools directly
                # But FIRST try the command parser — if it matches a known command,
                # execute it directly (zero tool calls, zero LLM tokens)
                tools_enabled_check = self.config.get('tools_enabled', False) and TOOLS_AVAILABLE
                
                if tools_enabled_check:
                    # Fast-path: try command parser before tool-calling LLM
                    try:
                        fast_command = self.command_parser.parse(text)
                        if fast_command and fast_command.get('type') in ('app', 'web', 'clock', 'system', 'macro'):
                            logger.info(f"[TOOLS] Command parser fast-path: {fast_command.get('type')}:{fast_command.get('action', fast_command.get('name', ''))}")
                            
                            # Macros execute via macro_tool directly (no command_executor)
                            if fast_command.get('type') == 'macro':
                                from src.tools.macro_tool import run_macro
                                result = run_macro(
                                    name=fast_command.get('name', ''),
                                    variables=fast_command.get('variables', {}),
                                )
                            else:
                                result = self.command_executor.execute(fast_command)
                            
                            if result:
                                result_text = str(result) if isinstance(result, str) else str(result.get('result', ''))
                                # Natural response formatting (mirrors non-tool path)
                                if fast_command.get('type') == 'macro':
                                    macro_name = fast_command.get('name', 'macro')
                                    if result.get('status') == 'success':
                                        stdout = result.get('stdout', '').strip()
                                        result_text = stdout if stdout else f"Ran {macro_name}"
                                    else:
                                        result_text = f"Macro {macro_name} failed: {result.get('error', result.get('stderr', 'unknown error'))}"
                                elif fast_command.get('type') == 'clock' and fast_command.get('action') == 'time':
                                    result_text = f"It's {datetime.now().strftime('%I:%M %p')}"
                                elif fast_command.get('type') == 'app' and fast_command.get('action') == 'open':
                                    result_text = f"Opening {fast_command.get('name', '')} for you"
                                elif fast_command.get('type') == 'app' and fast_command.get('action') == 'close':
                                    result_text = f"Closing {fast_command.get('name', '')} for you"
                                elif fast_command.get('type') == 'note':
                                    result_text = "I've created a new note in Obsidian with your content"
                                elif fast_command.get('type') == 'web' and fast_command.get('name') == 'aurora_forecast':
                                    urls = result.get('urls', [])
                                    if urls:
                                        url_list = '\n'.join([f"- {url}" for url in urls])
                                        result_text = f"Opening aurora forecast pages in your browser:\n{url_list}"
                                
                                self.add_to_memory(text, result_text, self.config.get('model'))
                                return {
                                    "status": "success",
                                    "result": result_text,
                                    "messages": [
                                        {"role": "user", "content": text},
                                        {"role": "assistant", "content": result_text}
                                    ],
                                    "new_message": True,
                                    "clear_thinking": True,
                                    "speak": True
                                }
                    except Exception as fast_err:
                        logger.debug(f"[TOOLS] Command parser fast-path failed, falling through to tools: {fast_err}")
                    
                    # No fast-path match — fall through to full tool-calling LLM
                    logger.info("[PROCESS_MESSAGE] *** TOOLS INTERCEPT *** Using chat_with_tools directly")
                    print(f"[PROCESS_MESSAGE] *** TOOLS INTERCEPT *** Using chat_with_tools directly", flush=True)
                    return self.chat_with_tools(text, image_data, chat_mode=chat_mode)
                
                # CRITICAL CHECK: Pre-check for 'chill' or 'chilling' before command parsing
                if 'chill' in text.lower():
                    print(f"[DEBUG] CRITICAL: 'chilling' detected in input before parsing: '{text}'")
                    print(f"[DEBUG] This should be caught by the parser, but adding extra safeguard")
                
                command = self.command_parser.parse(text)
                print(f"[DEBUG] Parsed command: {command}")
                
                # CRITICAL CHECK: Post-check for 'chill' or 'chilling' after command parsing
                if command and command.get('type') == 'search' and command.get('source') == 'google_earth':
                    query = command.get('query', '').lower()
                    if 'chill' in query:
                        print(f"[DEBUG] CRITICAL: 'chilling' detected in parsed Google Earth command: '{query}'")
                        print(f"[DEBUG] Setting command to None to prevent execution")
                        command = None
                
                # Check Perplexity settings once for both command and regular chat processing
                perplexity_enabled = self.config.get("perplexity_enabled", False)
                api_key = self.config.get("perplexity_api_key")
                model = self.config.get("perplexity_model", "sonar-medium-online")
                system_prompt = self.config.get("system_prompt")
                perplexity_result = None
                
                if command:
                    # Check for context-aware note creation commands
                    query = text.lower().strip()
                    if any(phrase in query for phrase in [
                        'create a note on that', 'make a note of that', 'take notes on that',
                        'create a plan around that', 'make a plan for that', 'create notes about this',
                        'summarize this in a note', 'make a note about our conversation'
                    ]):
                        print(f"[DEBUG] Detected context-aware note creation command: {query}")
                        
                        # Get recent conversation context
                        recent_messages = self.get_recent_messages(3)  # Get last 3 conversation pairs
                        
                        if recent_messages:
                            # Extract the content from the messages
                            context = "\n\n".join([f"{msg['role'].upper()}: {msg['content']}" for msg in recent_messages])
                            
                            # Determine what type of note/plan to create
                            if 'plan' in query:
                                note_instruction = "Create a detailed plan based on the recent conversation. Include specific action items, timelines if applicable, and organize it in a structured format with clear headings."
                            else:
                                note_instruction = "Create a comprehensive note summarizing the key points from the recent conversation. Organize the information in a clear, structured format with appropriate headings."
                            
                            # Create the note content with context
                            note_content = f"Create a note based on: {note_instruction}\n\nContext: {context}"
                            
                            print(f"[DEBUG] Creating context-aware note with content length: {len(note_content)}")
                            
                            # Use the command executor to create the note
                            try:
                                # Import the command executor if needed
                                from src.commands.command_executor import CommandExecutor
                                
                                # Get or create the command executor
                                if hasattr(self, 'command_executor'):
                                    command_executor = self.command_executor
                                else:
                                    command_executor = CommandExecutor()
                                
                                # Create the note
                                result = command_executor.create_note(note_content)
                                
                                if result and result.get("status") == "success":
                                    # Get the actual note content that was created
                                    # This is either from the result or we need to generate it
                                    note_content_generated = result.get("note_content", "")
                                    
                                    if not note_content_generated:
                                        # If the note content isn't returned directly, we need to generate a summary
                                        # of what was likely in the note based on our context
                                        try:
                                            # Create a prompt to summarize what was in the note
                                            summary_prompt = f"""Based on the recent conversation context, summarize what was included in the note that was just created. 
                                            Format this as if you're telling the user what you wrote in the note. Be specific about the key points covered.
                                            
                                            Context: {context}"""
                                            
                                            # Call the LLM to generate a summary
                                            summary_response = self.chat_response(summary_prompt, None)
                                            if summary_response and summary_response.get('status') == 'success':
                                                note_content_generated = summary_response.get('result', '')
                                            else:
                                                note_content_generated = "I've created a detailed note in Obsidian based on our recent conversation, capturing the key points we discussed."
                                        except Exception as e:
                                            logger.error(f"Error generating note summary: {str(e)}")
                                            note_content_generated = "I've created a detailed note in Obsidian based on our recent conversation, capturing the key points we discussed."
                                    
                                    # Create a more informative response that includes what was in the note
                                    response_message = f"I've created a note in Obsidian that includes: {note_content_generated}"
                                    
                                    # Add this note creation event to the conversation memory
                                    self.add_to_memory(
                                        user_message=text,
                                        assistant_response=response_message,
                                        model="local"
                                    )
                                    
                                    return {
                                        "status": "success",
                                        "result": response_message,
                                        "messages": [
                                            {"role": "user", "content": text},
                                            {"role": "assistant", "content": response_message}
                                        ],
                                        "new_message": True,
                                        "clear_thinking": True,
                                        "speak": True
                                    }
                                else:
                                    return {
                                        "status": "error",
                                        "result": f"Error creating note: {result.get('result', 'Unknown error')}",
                                        "messages": [
                                            {"role": "user", "content": text},
                                            {"role": "assistant", "content": f"Error creating note: {result.get('result', 'Unknown error')}"}
                                        ],
                                        "new_message": True,
                                        "clear_thinking": True,
                                        "speak": True
                                    }
                            except Exception as e:
                                logger.error(f"Error creating context-aware note: {str(e)}")
                                return {
                                    "status": "error",
                                    "result": f"Error creating note: {str(e)}",
                                    "messages": [
                                        {"role": "user", "content": text},
                                        {"role": "assistant", "content": f"Error creating note: {str(e)}"}
                                    ],
                                    "new_message": True,
                                    "clear_thinking": True,
                                    "speak": True
                                }
                        else:
                            return {
                                "status": "error",
                                "result": "I don't have enough recent conversation context to create a meaningful note.",
                                "messages": [
                                    {"role": "user", "content": text},
                                    {"role": "assistant", "content": "I don't have enough recent conversation context to create a meaningful note."}
                                ],
                                "new_message": True,
                                "clear_thinking": True,
                                "speak": True
                            }
                    
                    # If this is a general search (not a special source), use Perplexity as the agent response
                    if command.get('type') == 'search' and command.get('source') in [None, '', 'web', 'google']:
                        if perplexity_enabled and api_key:
                            search_query = command['query']
                            search_model = 'sonar'  # Default: cheapest tier

                            # Follow-up detection: if recent search exists and this query relates, escalate to sonar-pro
                            if self._last_search and (time.time() - self._last_search.get('timestamp', 0) < 300):
                                prev_query = self._last_search.get('query', '').lower()
                                prev_keywords = set(prev_query.split())
                                curr_keywords = set(search_query.lower().split())
                                # If queries share significant keywords, treat as follow-up
                                overlap = prev_keywords & curr_keywords - {'the', 'a', 'an', 'is', 'are', 'was', 'what', 'how', 'why', 'about', 'on', 'in', 'of', 'for', 'to', 'and', 'or', 'me', 'tell', 'more', 'search'}
                                if len(overlap) >= 1:
                                    search_model = 'sonar-pro'
                                    # Enrich query with prior context for deeper follow-up
                                    prev_summary = self._last_search.get('result', '')[:800]
                                    search_query = f"Previous search: {self._last_search['query']}\nPrior result summary: {prev_summary}\n\nFollow-up question: {search_query}"
                                    logger.info(f"[SEARCH] Follow-up detected, escalating to sonar-pro")

                            logger.info(f"Using Perplexity {search_model} for search: {command['query']}")
                            perplexity_result = call_perplexity_api(search_query, api_key, model=search_model, system_prompt=system_prompt, force_call=True)
                            model = search_model  # Update model var for metadata below
                        
                        # If we got a Perplexity result, use it as the agent's response
                        if perplexity_result:
                            # Track search context for potential follow-up escalation
                            self._last_search = {
                                'query': command['query'],
                                'result': perplexity_result,
                                'model': model,
                                'timestamp': time.time()
                            }

                            # Add a prefix to indicate this is from Perplexity Sonar
                            formatted_result = f"[Perplexity {model}] {perplexity_result}"
                            
                            self.add_to_memory(text, perplexity_result, "sonar-" + model)
                            return {
                                "status": "success",
                                "result": formatted_result,
                                "messages": [
                                    {"role": "user", "content": text},
                                    {"role": "assistant", "content": formatted_result}
                                ],
                                "new_message": True,
                                "clear_thinking": True,
                                "speak": True,
                                "rich_text": True,  # Hint to frontend to render links/citations
                                "metadata": {
                                    "source": "perplexity",
                                    "model": model,
                                    "query": command['query']
                                }
                            }
                        else:
                            # If Perplexity failed, fall through to the active model
                            logger.debug("Sonar failed, falling through to active model")
                            # Don't return here, allow processing to continue to the chat response
                    else:
                        try:
                            # CRITICAL CHECK: Additional safeguard against 'chilling' triggering Google Earth
                            if command and command.get('type') == 'search' and command.get('source') == 'google_earth':
                                query = command.get('query', '').lower()
                                if 'chill' in query:
                                    print(f"[DEBUG] CRITICAL: 'chilling' detected in Google Earth command: '{query}'")
                                    print(f"[DEBUG] Blocking command execution in proxy_server.py")
                                    return {
                                        "status": "success",
                                        "result": "I understand you're just chilling. Is there something specific you'd like me to help you with?",
                                        "messages": [
                                            {"role": "user", "content": text},
                                            {"role": "assistant", "content": "I understand you're just chilling. Is there something specific you'd like me to help you with?"}
                                        ],
                                        "new_message": True,
                                        "clear_thinking": True,
                                        "speak": True
                                    }
                            
                            print(f"[DEBUG] Executing command: {command}")
                            
                            # Special handling for Midjourney commands from autonomous handler
                            is_autonomous = message.get('autonomous', False) if isinstance(message, dict) else False
                            
                            # Check if this is a Midjourney command
                            if command.get('type') == 'search' and command.get('source') == 'midjourney':
                                print(f"[DEBUG] Detected Midjourney command: {command}")
                                print(f"[DEBUG] Is autonomous: {is_autonomous}")
                            
                            # Execute the command (macros go through macro_tool directly)
                            if command.get('type') == 'macro':
                                from src.tools.macro_tool import run_macro
                                result = run_macro(
                                    name=command.get('name', ''),
                                    variables=command.get('variables', {}),
                                )
                            else:
                                result = self.command_executor.execute(command)
                            print(f"[DEBUG] Command execution result: {result}")
                            if result:
                                result_text = str(result) if isinstance(result, str) else str(result.get('result', ''))
                                # Make responses more natural
                                if command.get('type') == 'macro':
                                    macro_name = command.get('name', 'macro')
                                    if result.get('status') == 'success':
                                        stdout = result.get('stdout', '').strip()
                                        result_text = stdout if stdout else f"Ran {macro_name}"
                                    else:
                                        result_text = f"Macro {macro_name} failed: {result.get('error', result.get('stderr', 'unknown error'))}"
                                elif command.get('type') == 'clock' and command.get('action') == 'time':
                                    result_text = f"It's {datetime.now().strftime('%I:%M %p')}"
                                elif command.get('type') == 'app' and command.get('action') == 'open':
                                    app_name = command.get('name', '')
                                    result_text = f"Opening {app_name} for you"
                                elif command.get('type') == 'note':
                                    result_text = "I've created a new note in Obsidian with your content"
                                elif command.get('type') == 'web' and command.get('name') == 'aurora_forecast':
                                    # Special handling for aurora forecast to show the URLs in the response
                                    urls = result.get('urls', [])
                                    if urls:
                                        url_list = '\n'.join([f"- {url}" for url in urls])
                                        result_text = f"Opening aurora forecast pages in your browser:\n{url_list}"
                                
                                self.add_to_memory(text, result_text, self.config.get('model'))
                                return {
                                    "status": "success",
                                    "result": result_text,
                                    "messages": [
                                        {"role": "user", "content": text},
                                        {"role": "assistant", "content": result_text}
                                    ],
                                    "new_message": True,
                                    "clear_thinking": True,
                                    "speak": True
                                }
                        except Exception as e:
                            logger.error(f"Error executing command: {e}")
                            # Fall through to chat handling if command execution fails
                else:
                    try:
                        # Use Perplexity for information-seeking queries
                        perplexity_enabled = self.config.get("perplexity_enabled", False)
                        api_key = self.config.get("perplexity_api_key")
                        model = self.config.get("perplexity_model", "sonar")
                        system_prompt = self.config.get("system_prompt")
                        perplexity_result = None
                        
                        # Initialize the Sonar handler if needed
                        global sonar_handler
                        if perplexity_enabled and api_key and not sonar_handler:
                            sonar_handler = SonarHandler(api_key=api_key)
                        
                        # Check if this is an information-seeking query
                        use_perplexity = False
                        force_perplexity = False
                        
                        # Special test queries that will always force a Perplexity API call
                        test_queries = [
                            "test perplexity api",
                            "force perplexity call",
                            "use perplexity for this",
                            "direct perplexity test"
                        ]
                        
                        # Natural search commands that should trigger Perplexity
                        # These are the only commands that will trigger Sonar
                        search_commands = [
                            "show me",
                            "look up",
                            "lookup",  # Added without space
                            "search for",
                            "find",
                            "research",
                            "investigate",
                            "analyze",
                            "tell me about",
                            "what is",
                            "who is"
                        ]
                        
                        # Special case commands that might be handled by other systems
                        # We need to prioritize these for Sonar
                        priority_commands = ["research", "lookup"]
                        
                        # Check for test queries first (exact match)
                        if any(test_query in text.lower() for test_query in test_queries):
                            print(f"[SONAR DEBUG] ==============================================")
                            print(f"[SONAR DEBUG] TEST QUERY DETECTED: '{text}'")
                            print(f"[SONAR DEBUG] This will trigger a direct Perplexity API call")
                            print(f"[SONAR DEBUG] ==============================================")
                            use_perplexity = True
                            force_perplexity = True
                        else:
                            # Check if any search command appears at the start or within the first few words
                            text_lower = text.lower().strip()
                            words = text_lower.split()
                            first_five_words = ' '.join(words[:5])
                            
                            # Special case for 'lookup' without space
                            if text_lower.startswith("lookup") or "lookup" in words[:2]:
                                command_found = True
                                matching_command = "lookup"
                                use_perplexity = True
                                force_perplexity = True
                                print(f"[SONAR DEBUG] ==============================================")
                                print(f"[SONAR DEBUG] SPECIAL COMMAND 'lookup' DETECTED: '{text}'")
                                print(f"[SONAR DEBUG] This will trigger a direct Perplexity API call")
                                print(f"[SONAR DEBUG] ==============================================")
                            # Special case for 'research'
                            elif text_lower.startswith("research") or "research" in words[:2]:
                                command_found = True
                                matching_command = "research"
                                use_perplexity = True
                                force_perplexity = True
                                print(f"[SONAR DEBUG] ===============================================")
                                print(f"[SONAR DEBUG] SPECIAL COMMAND 'research' DETECTED: '{text}'")
                                print(f"[SONAR DEBUG] This will trigger a direct Perplexity API call")
                                print(f"[SONAR DEBUG] ==============================================")
                            
                            # Check if any command is in the first five words
                            command_found = False
                            matching_command = None
                            
                            for cmd in search_commands:
                                # Check for exact matches at the beginning of the message
                                if text_lower.startswith(cmd) or text_lower.startswith(f"hey {cmd}") or text_lower.startswith(f"hi {cmd}"):
                                    command_found = True
                                    matching_command = cmd
                                    break
                                    
                                # Check if the command is one of the first words
                                elif cmd in words[:3]:
                                    command_found = True
                                    matching_command = cmd
                                    break
                                    
                                # Special handling for commands that might be handled elsewhere
                                elif cmd in priority_commands and cmd in first_five_words:
                                    command_found = True
                                    matching_command = cmd
                                    break
                            
                            if command_found:
                                print(f"[SONAR DEBUG] ==============================================")
                                print(f"[SONAR DEBUG] SEARCH COMMAND '{matching_command}' DETECTED IN FIRST 5 WORDS: '{text}'")
                                print(f"[SONAR DEBUG] This will trigger a direct Perplexity API call")
                                print(f"[SONAR DEBUG] ==============================================")
                                use_perplexity = True
                                force_perplexity = True
                            else:
                                print(f"[SONAR DEBUG] No search command found in first 5 words: '{text}'")
                                print(f"[SONAR DEBUG] Using local LLM for this query")
                        
                        # Debug log to file to track all queries
                        debug_log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
                        os.makedirs(debug_log_dir, exist_ok=True)
                        debug_log_file = os.path.join(debug_log_dir, "perplexity_debug.log")
                        with open(debug_log_file, 'a', encoding='utf-8') as f:
                            f.write(f"\n\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Processing query: '{text}'\n")
                            f.write(f"perplexity_enabled: {perplexity_enabled}, api_key: {api_key[:5]}... exists\n")
                        
                        # Add debug log info about our decision
                        with open(debug_log_file, 'a', encoding='utf-8') as f:
                            f.write(f"First five words check: {first_five_words}\n")
                            f.write(f"Command found: {command_found}\n")
                            if command_found:
                                f.write(f"Matching command: '{matching_command}'\n")
                            f.write(f"use_perplexity set to: {use_perplexity}, force_perplexity set to: {force_perplexity}\n")
                        
                        # Call the Perplexity API if this is an information-seeking query
                        if use_perplexity and perplexity_enabled and api_key:
                            print(f"[SONAR DEBUG] =============================================")
                            print(f"[SONAR DEBUG] Starting Perplexity API integration process")
                            print(f"[SONAR DEBUG] Query: '{text}'")
                            print(f"[SONAR DEBUG] use_perplexity: {use_perplexity}")
                            print(f"[SONAR DEBUG] force_perplexity: {force_perplexity}")
                            print(f"[SONAR DEBUG] perplexity_enabled: {perplexity_enabled}")
                            print(f"[SONAR DEBUG] API key exists: {api_key is not None and len(api_key) > 0}")
                            print(f"[SONAR DEBUG] =============================================")
                            
                            # DIRECT PATH - Use the same direct API call for all Perplexity queries
                            # This ensures consistent behavior between test queries and regular queries
                            print(f"[SONAR DEBUG] Using direct Perplexity API path for query: '{text}'")
                            
                            # Use the exact format from the documentation
                            url = "https://api.perplexity.ai/chat/completions"
                            headers = {
                                "Authorization": f"Bearer {api_key}",
                                "Content-Type": "application/json"
                            }

                            # Follow-up detection: escalate to sonar-pro if this relates to a recent search
                            sonar_model_direct = 'sonar'
                            sonar_user_content = text
                            if self._last_search and (time.time() - self._last_search.get('timestamp', 0) < 300):
                                prev_keywords = set(self._last_search.get('query', '').lower().split())
                                curr_keywords = set(text.lower().split())
                                stop_words = {'the', 'a', 'an', 'is', 'are', 'was', 'what', 'how', 'why', 'about', 'on', 'in', 'of', 'for', 'to', 'and', 'or', 'me', 'tell', 'more', 'search', 'that', 'this', 'it', 'can', 'you', 'i', 'do'}
                                overlap = prev_keywords & curr_keywords - stop_words
                                if len(overlap) >= 1:
                                    sonar_model_direct = 'sonar-pro'
                                    prev_summary = self._last_search.get('result', '')[:800]
                                    sonar_user_content = f"Previous search: {self._last_search['query']}\nPrior result summary: {prev_summary}\n\nFollow-up question: {text}"
                                    logger.info(f"[SEARCH] Follow-up detected (non-command path), escalating to sonar-pro")

                            payload = {
                                "model": sonar_model_direct,
                                "messages": [
                                    {"role": "system", "content": "Be precise and concise."},
                                    {"role": "user", "content": sonar_user_content}
                                ],
                                "return_citations": True
                            }

                            # Auto-detect recency needs from query keywords
                            recency_kw = {"latest", "current", "recent", "today", "now", "news", "trending",
                                          "happening", "stock", "price", "score", "tonight", "yesterday"}
                            if set(text.lower().split()) & recency_kw:
                                payload["search_recency_filter"] = "day"
                            
                            print(f"[SONAR DEBUG] Sending direct request to {url}")
                            try:
                                response = requests.request("POST", url, json=payload, headers=headers, timeout=15)
                                print(f"[SONAR DEBUG] Response status: {response.status_code}")
                                
                                if response.status_code == 200:
                                    result = response.json()
                                    print(f"[SONAR DEBUG] Response keys: {list(result.keys())}")
                                    
                                    if 'choices' in result and result['choices'] and len(result['choices']) > 0:
                                        if 'message' in result['choices'][0] and 'content' in result['choices'][0]['message']:
                                            content = result['choices'][0]['message']['content']
                                            print(f"[SONAR DEBUG] Content found: {content[:50]}...")
                                            
                                            # Append citations as Sources section if available
                                            citations = result.get('citations', [])
                                            if citations:
                                                sources = "\n\n**Sources:**\n" + "\n".join(
                                                    f"[{i+1}] {url}" for i, url in enumerate(citations)
                                                )
                                                content += sources
                                            
                                            formatted_content = content
                                            
                                            # Format the result based on query type
                                            if force_perplexity and any(test in text.lower() for test in ["test perplexity", "force perplexity", "direct perplexity"]):
                                                # For test queries, use a more obvious prefix
                                                formatted_result = f"[DIRECT PERPLEXITY TEST] {formatted_content}"
                                                print(f"[SONAR DEBUG] Using test prefix for result")
                                            else:
                                                # For regular queries, use the formatted content
                                                formatted_result = formatted_content
                                                print(f"[SONAR DEBUG] Using formatted content for result")
                                        
                                            # Instead of returning Sonar response directly, feed it to the local LLM
                                            # Track search context for potential follow-up escalation
                                            self._last_search = {
                                                'query': text,
                                                'result': formatted_content,
                                                'model': sonar_model_direct,
                                                'timestamp': time.time()
                                            }

                                            print(f"[SONAR DEBUG] Feeding Sonar response to local LLM for natural response")
                                            
                                            # Build messages with Sonar context - use override_messages to bypass
                                            # the Sonar integration in chat_response (prevents duplicate Sonar calls)
                                            sonar_llm_messages = []
                                            if self.config.get("system_prompt"):
                                                sonar_llm_messages.append({
                                                    "role": "system",
                                                    "content": self.config["system_prompt"]
                                                })
                                            sonar_llm_messages.append({
                                                "role": "system",
                                                "content": f"Here is the most up-to-date information I found for the user's query, provided by Sonar:\n{formatted_result}"
                                            })
                                            sonar_llm_messages.append({
                                                "role": "user",
                                                "content": text
                                            })
                                            
                                            # Call the local LLM with override_messages to bypass Sonar integration
                                            # chat_response sends the response to frontend directly, so we return None
                                            # to prevent the caller from sending a duplicate response
                                            try:
                                                print(f"[SONAR DEBUG] Calling local LLM with Sonar information (bypassing Sonar integration)")
                                                # Use chat_with_tools if tools are enabled
                                                tools_enabled = self.config.get('tools_enabled', False) and TOOLS_AVAILABLE
                                                if tools_enabled:
                                                    print(f"[SONAR DEBUG] Tools enabled, using chat_with_tools")
                                                    self.chat_with_tools(text, None, chat_mode=chat_mode)
                                                else:
                                                    print(f"[SONAR DEBUG] chat_response will handle frontend communication")
                                                    self.chat_response(text, None, override_messages=sonar_llm_messages)
                                                print(f"[SONAR DEBUG] LLM processing complete, returning None to prevent duplicate")
                                                return None  # already sent to frontend
                                            except Exception as e:
                                                print(f"[SONAR ERROR] Error processing with local LLM: {str(e)}")
                                                # Fall back to direct Sonar response if LLM processing fails
                                                return {
                                                    "status": "success",
                                                    "result": formatted_result,
                                                    "messages": [
                                                        {"role": "user", "content": text},
                                                        {"role": "assistant", "content": formatted_result}
                                                    ],
                                                    "new_message": True,
                                                    "clear_thinking": True,
                                                    "speak": True,
                                                    "rich_text": True
                                                }
                                        else:
                                            print(f"[SONAR ERROR] No message content found in response — falling through to active model")
                                    else:
                                        print(f"[SONAR ERROR] No choices found in response — falling through to active model")
                                else:
                                    print(f"[SONAR ERROR] API request failed with status {response.status_code} — falling through to active model")
                            except Exception as e:
                                print(f"[SONAR ERROR] Exception during API call: {str(e)} — falling through to active model")
                            
                        
                        # Perplexity either wasn't triggered or failed — fall through to the active model
                        # Use chat_with_tools if tools are enabled
                        tools_enabled = self.config.get('tools_enabled', False) and TOOLS_AVAILABLE
                        if tools_enabled:
                            logger.info("[PROCESS_MESSAGE] Using chat_with_tools")
                            chat_result = self.chat_with_tools(text, image_data, chat_mode=chat_mode)
                        else:
                            chat_result = self.chat_response(text, image_data)
                        
                        # Check if the response indicates a knowledge cutoff
                        if chat_result is not None and chat_result.get('status') == 'success':
                            result_text = chat_result.get('result', '')
                            
                            # Patterns that indicate knowledge cutoff
                            cutoff_patterns = [
                                "my knowledge is cut off",
                                "my knowledge only goes up to",
                                "my training data only goes up to",
                                "my training only goes up to",
                                "my training cut off",
                                "my training data cut off",
                                "i don't have information beyond",
                                "i don't have access to information after",
                                "i don't have data beyond",
                                "i don't have current information",
                                "i don't have up-to-date information",
                                "i can't provide current information",
                                "i can't provide up-to-date information",
                                "i can't provide real-time information",
                                "as of my last update",
                                "as of my knowledge cutoff"
                            ]
                            
                            # Check if any cutoff pattern is in the response
                            if any(pattern in result_text.lower() for pattern in cutoff_patterns):
                                logger.debug("Knowledge cutoff detected, trying Sonar")
                                
                                # Call Perplexity API with force_call=True
                                # Use the exact format from the documentation
                                url = "https://api.perplexity.ai/chat/completions"
                                headers = {
                                    "Authorization": f"Bearer {api_key}",
                                    "Content-Type": "application/json"
                                }
                                payload = {
                                    "model": "sonar",
                                    "messages": [
                                        {"role": "system", "content": "Be precise and concise. Provide up-to-date information."},
                                        {"role": "user", "content": text}
                                    ]
                                }
                                
                                try:
                                    # Sonar fallback request
                                    response = requests.request("POST", url, json=payload, headers=headers, timeout=15)
                                    
                                    if response.status_code == 200:
                                        result = response.json()
                                        
                                        if 'choices' in result and result['choices'] and len(result['choices']) > 0:
                                            if 'message' in result['choices'][0] and 'content' in result['choices'][0]['message']:
                                                content = result['choices'][0]['message']['content']
                                                
                                                # Format the result with a note about knowledge cutoff
                                                formatted_result = f"I noticed my knowledge was outdated for this query, so I searched for up-to-date information:\n\n{content}"
                                                
                                                # Create response object
                                                return {
                                                    "status": "success",
                                                    "result": formatted_result,
                                                    "messages": [
                                                        {"role": "user", "content": text},
                                                        {"role": "assistant", "content": formatted_result}
                                                    ],
                                                    "new_message": True,
                                                    "clear_thinking": True,
                                                    "speak": True,
                                                    "rich_text": True,
                                                    "metadata": {
                                                        "source": "perplexity_cutoff_fallback",
                                                        "model": "sonar",
                                                        "query": text
                                                    }
                                                }
                                except Exception as e:
                                    print(f"[SONAR ERROR] Error in knowledge cutoff fallback: {str(e)}")
                                    # Continue with original response if Perplexity fails
                            
                            # If no knowledge cutoff detected or Perplexity failed, return original response
                            return chat_result
                        else:
                            return {
                                "status": "error",
                                "result": "No response generated.",
                                "clear_thinking": True
                            }
                    except Exception as e:
                        error_msg = f"Error generating response: {str(e)}"
                        print(error_msg, file=sys.stderr)
                        send_message_to_frontend({
                            "status": "error",
                            "result": error_msg,
                            "clear_thinking": True
                        })
                        return None
        except Exception as e:
            error_msg = f"Error processing message: {str(e)}"
            logger.error(error_msg)
            print(error_msg, file=sys.stderr)
            send_message_to_frontend({
                "status": "error",
                "result": error_msg,
                "clear_thinking": True
            })
            return None
        finally:
            self._user_request_active = False

    def _get_recent_tool_history(self, limit: int = 10) -> str:
        """Get recent tool execution history for context."""
        if not TOOLS_AVAILABLE:
            return ""
        
        try:
            registry = get_tool_registry()
            history = registry.get_history(limit)
            
            if not history:
                return ""
            
            lines = []
            for entry in history[-limit:]:
                tool = entry.get('tool', 'unknown')
                success = '✓' if entry.get('success') else '✗'
                duration = entry.get('duration_ms', 0)
                
                # Summarize args (truncate long values)
                args = entry.get('args', {})
                args_summary = []
                for k, v in args.items():
                    v_str = str(v)
                    if len(v_str) > 50:
                        v_str = v_str[:47] + '...'
                    args_summary.append(f"{k}={v_str}")
                args_str = ', '.join(args_summary) if args_summary else 'none'
                
                # Summarize result
                result = entry.get('result', {})
                if isinstance(result, dict):
                    status = result.get('status', 'unknown')
                    if result.get('error'):
                        result_str = f"error: {str(result['error'])[:50]}"
                    elif result.get('output'):
                        output = str(result['output'])
                        result_str = f"output: {output[:50]}..." if len(output) > 50 else f"output: {output}"
                    else:
                        result_str = f"status: {status}"
                else:
                    result_str = str(result)[:50]
                
                lines.append(f"  {success} {tool}({args_str}) [{duration}ms] → {result_str}")
            
            return '\n'.join(lines)
        except Exception as e:
            logger.error(f"Error getting tool history: {e}")
            return ""

    def _estimate_tokens(self, text):
        """Rough token estimation (4 chars per token average)."""
        if not text:
            return 0
        return len(text) // 4

    def _compact_messages(self, messages, max_tokens=8000):
        """
        Context compaction with LLM-powered staged summarization.
        Uses the compaction module with progressive fallback:
        1. Full LLM summarization (chunked for long histories)
        2. Partial summarization (excluding oversized messages)
        3. Basic text extraction fallback
        """
        try:
            from src.infra.compaction import compact_messages as do_compact, estimate_messages_tokens
            
            total_tokens = estimate_messages_tokens(messages)
            if total_tokens <= max_tokens:
                return messages
            
            logger.info(f"[COMPACT] Messages too long ({total_tokens} tokens), compacting...")
            
            # Build summarizer callback that uses our existing _llm_summarize_context
            def summarizer_fn(text, instructions, prev_summary):
                # Prepend previous summary as context if available
                full_text = text
                if prev_summary:
                    full_text = f"Previous context summary:\n{prev_summary}\n\n---\n\nNew context to incorporate:\n{text}"
                if instructions:
                    full_text = f"{instructions}\n\n{full_text}"
                return self._llm_summarize_context(full_text, max_summary_tokens=800)
            
            context_window = self.config.get('context_window_tokens', 128000)
            
            compacted, stats = do_compact(
                messages,
                max_tokens=max_tokens,
                preserve_recent=10,
                include_summary=True,
                summarizer=summarizer_fn,
                context_window=context_window,
            )
            
            if stats.get('compacted'):
                new_tokens = estimate_messages_tokens(compacted)
                method = "LLM staged" if stats.get('llm_summarized') else "basic"
                logger.info(f"[COMPACT] Reduced from {total_tokens} to {new_tokens} tokens ({method} summary, dropped {stats.get('dropped_count', 0)} msgs)")
            
            return compacted
            
        except Exception as e:
            logger.error(f"Error compacting messages: {e}")
            return messages
    
    def _llm_summarize_context(self, context_text, max_summary_tokens=800):
        """
        Ask the LLM to summarize conversation context.
        Returns a concise summary string, or None on failure.
        """
        try:
            model = self.config.get("model", "llama3.2-vision:11b")
            model_metadata = _resolve_model_metadata(model)
            provider = model_metadata.get('provider', 'ollama')
            
            summary_prompt = [
                {"role": "system", "content": "You are a context summarizer. Summarize the following conversation history concisely. Preserve: key decisions, tool results and their outcomes, file paths mentioned, errors encountered, user preferences, TODOs, and open questions. Omit pleasantries and redundant exchanges. Be thorough but compact."},
                {"role": "user", "content": f"Summarize this conversation context:\n\n{context_text[:8000]}"}
            ]
            
            if provider == 'ollama':
                ollama_url = self.config.get('api_base', self.config.get('api_endpoint', 'http://localhost:11434'))
                resp = requests.post(
                    f"{ollama_url}/api/chat",
                    json={"model": model, "messages": summary_prompt, "stream": False},
                    timeout=15
                )
                if resp.ok:
                    data = resp.json()
                    summary = data.get('message', {}).get('content', '')
                    if summary:
                        logger.info(f"[COMPACT] LLM summary generated via Ollama ({len(summary)} chars)")
                        return summary[:2000]
            
            elif provider == 'xai':
                api_key = _resolve_remote_key(self.config, provider='xai')
                if api_key:
                    endpoint = model_metadata.get('endpoint', 'https://api.x.ai/v1/chat/completions')
                    remote_model = model_metadata.get('remote_model') or 'grok-4-latest'
                    resp = requests.post(endpoint, headers={
                        'Authorization': f'Bearer {api_key}',
                        'Content-Type': 'application/json'
                    }, json={
                        'model': remote_model,
                        'messages': summary_prompt,
                        'max_tokens': max_summary_tokens,
                        'temperature': 0.3
                    }, timeout=20)
                    if resp.ok:
                        data = resp.json()
                        summary = data.get('choices', [{}])[0].get('message', {}).get('content', '')
                        if summary:
                            logger.info(f"[COMPACT] LLM summary generated via xAI ({len(summary)} chars)")
                            return summary[:2000]
            
            elif provider == 'anthropic':
                api_key = _resolve_remote_key(self.config, provider='anthropic')
                if api_key:
                    endpoint = model_metadata.get('endpoint', 'https://api.anthropic.com/v1/messages')
                    remote_model = model_metadata.get('remote_model') or 'claude-sonnet-4-5-20250929'
                    version = model_metadata.get('anthropic_version', '2023-06-01')
                    # Extract system content from summary_prompt
                    sys_content = summary_prompt[0]['content']
                    user_content = summary_prompt[1]['content']
                    resp = requests.post(endpoint, headers={
                        'Content-Type': 'application/json',
                        'x-api-key': api_key,
                        'anthropic-version': version
                    }, json={
                        'model': remote_model,
                        'max_tokens': max_summary_tokens,
                        'system': sys_content,
                        'messages': [{'role': 'user', 'content': user_content}]
                    }, timeout=20)
                    if resp.ok:
                        data = resp.json()
                        blocks = data.get('content', [])
                        summary = ''.join(b.get('text', '') for b in blocks if b.get('type') == 'text')
                        if summary:
                            logger.info(f"[COMPACT] LLM summary generated via Anthropic ({len(summary)} chars)")
                            return summary[:2000]
            
            elif provider == 'google':
                api_key = _resolve_remote_key(self.config, provider='google')
                if api_key:
                    remote_model = model_metadata.get('remote_model', 'gemini-2.5-pro')
                    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{remote_model}:generateContent?key={api_key}"
                    sys_content = summary_prompt[0]['content']
                    user_content = summary_prompt[1]['content']
                    resp = requests.post(endpoint, headers={
                        'Content-Type': 'application/json'
                    }, json={
                        'systemInstruction': {'parts': [{'text': sys_content}]},
                        'contents': [{'role': 'user', 'parts': [{'text': user_content}]}],
                        'generationConfig': {'maxOutputTokens': max_summary_tokens, 'temperature': 0.3}
                    }, timeout=20)
                    if resp.ok:
                        data = resp.json()
                        candidates = data.get('candidates', [])
                        if candidates:
                            parts = candidates[0].get('content', {}).get('parts', [])
                            summary = ''.join(p.get('text', '') for p in parts)
                            if summary:
                                logger.info(f"[COMPACT] LLM summary generated via Google ({len(summary)} chars)")
                                return summary[:2000]
            
            return None
        except Exception as e:
            logger.warning(f"[COMPACT] LLM summarization failed: {e}")
            return None

    def _strip_echoed_instructions(self, text):
        """Strip echoed internal instructions from the start of model responses.
        Models sometimes parrot back continuation prompts before their real answer."""
        if not text:
            return text
        import re
        # Patterns that match common instruction echoes at the start of a response
        echo_patterns = [
            r'^[\s]*if you have finished.*?summariz\w+[^.]*\.\s*',
            r'^[\s]*provide a final response.*?\.\s*',
            r'^[\s]*here is my final (?:response|summary).*?:\s*',
            r'^[\s]*to summarize (?:my|the) results.*?:\s*',
            r'^[\s]*(?:continue|proceeding)\.?\s*if (?:the )?task is complete.*?\.\s*',
            r'^[\s]*the task is (?:now )?complete\.\s*(?:here (?:is|are) (?:the|my) (?:results|summary).*?:\s*)?',
        ]
        cleaned = text
        for pat in echo_patterns:
            cleaned = re.sub(pat, '', cleaned, count=1, flags=re.IGNORECASE | re.DOTALL)
            if cleaned != text:
                break
        return cleaned.strip() if cleaned.strip() else text.strip()

    def _create_tool_observation(self, tool_name, tool_args, result):
        """
        Create a structured observation from tool result.
        This helps the LLM understand what happened and plan next steps.
        """
        try:
            obs_parts = []
            
            if isinstance(result, dict):
                status = result.get('status', 'unknown')
                
                if status == 'error':
                    error = result.get('error', 'Unknown error')
                    obs_parts.append(f"Error: {error}")
                elif status == 'success':
                    action = tool_args.get('action', '')
                    
                    # ── bash (was exec) ──
                    if tool_name == 'bash':
                        output = result.get('output', '')
                        exit_code = result.get('exit_code', 0)
                        if output:
                            obs_parts.append(f"Output:\n{output[:1000]}" if len(output) > 1000 else f"Output:\n{output}")
                        obs_parts.append(f"Exit code: {exit_code}")
                    
                    # ── text_editor (was read_file/write_file/edit_file/grep/list_dir/file_info) ──
                    elif tool_name == 'text_editor':
                        if action == 'read':
                            content = result.get('content', '')
                            path = result.get('path', '')
                            total_lines = result.get('total_lines', '')
                            if path:
                                obs_parts.append(f"File: {path}")
                            if total_lines:
                                obs_parts.append(f"Total lines: {total_lines}")
                            if content:
                                if len(content) > 4000:
                                    obs_parts.append(f"Content (truncated to 4000 chars):\n{content[:4000]}...")
                                else:
                                    obs_parts.append(f"Content:\n{content}")
                        elif action == 'edit':
                            path = result.get('path', tool_args.get('path', ''))
                            obs_parts.append(f"Edited: {path}")
                            if result.get('replacements'):
                                obs_parts.append(f"Replacements: {result['replacements']}")
                        elif action == 'write':
                            path = result.get('path', tool_args.get('path', ''))
                            obs_parts.append(f"Wrote: {path}")
                            if result.get('bytes_written'):
                                obs_parts.append(f"Size: {result['bytes_written']} bytes")
                        elif action == 'grep':
                            matches = result.get('matches', [])
                            total = result.get('total_matches', len(matches))
                            obs_parts.append(f"Matches: {total}")
                            for m in matches[:20]:
                                if isinstance(m, dict):
                                    obs_parts.append(f"  {m.get('file', '')}:{m.get('line', '')} {m.get('text', '')[:100]}")
                                else:
                                    obs_parts.append(f"  {str(m)[:120]}")
                            if total > 20:
                                obs_parts.append(f"  ... +{total - 20} more")
                        elif action == 'list':
                            obs_parts.append(f"text_editor(list): OK")
                            for key, value in result.items():
                                if key != 'status' and not key.startswith('_') and value:
                                    val_str = str(value)
                                    if len(val_str) > 2000:
                                        val_str = val_str[:2000] + "..."
                                    obs_parts.append(f"{key}: {val_str}")
                        else:
                            obs_parts.append(f"text_editor({action}): OK")
                            for key, value in result.items():
                                if key != 'status' and not key.startswith('_') and value:
                                    val_str = str(value)
                                    if len(val_str) > 1000:
                                        val_str = val_str[:1000] + "..."
                                    obs_parts.append(f"{key}: {val_str}")
                    
                    # ── web_search ──
                    elif tool_name == 'web_search':
                        answer = result.get('answer', result.get('content', ''))
                        if answer:
                            if len(answer) > 2000:
                                obs_parts.append(f"Answer:\n{answer[:2000]}...")
                            else:
                                obs_parts.append(f"Answer:\n{answer}")
                        citations = result.get('citations', [])
                        if citations:
                            obs_parts.append(f"Sources: {', '.join(str(c)[:60] for c in citations[:5])}")
                    
                    # ── browser dispatcher ──
                    elif tool_name == 'browser':
                        if action == 'navigate':
                            url = result.get('url', tool_args.get('url', ''))
                            title = result.get('title', '')
                            obs_parts.append(f"Navigated to: {url}")
                            if title:
                                obs_parts.append(f"Title: {title}")
                        elif action == 'click':
                            selector = tool_args.get('selector', '')
                            obs_parts.append(f"Clicked: {selector}")
                        elif action == 'type':
                            selector = tool_args.get('selector', '')
                            text = tool_args.get('text', '')
                            obs_parts.append(f"Typed into {selector}: {text[:50]}")
                        elif action == 'read':
                            text = result.get('text', '')
                            title = result.get('title', '')
                            url = result.get('url', '')
                            obs_parts.append(f"Page: {title} ({url})")
                            if len(text) > 2000:
                                obs_parts.append(f"Content (truncated):\n{text[:2000]}...")
                            else:
                                obs_parts.append(f"Content:\n{text}")
                        elif action == 'elements':
                            elements = result.get('elements', [])
                            obs_parts.append(f"Interactive elements ({len(elements)}):")
                            for elem in elements[:20]:
                                ref = elem.get('ref', '')
                                role = elem.get('role', elem.get('tag', ''))
                                text = elem.get('text', '')[:40]
                                obs_parts.append(f"  {ref} {role}: \"{text}\"")
                            if len(elements) > 20:
                                obs_parts.append(f"  ... +{len(elements) - 20} more")
                        elif action == 'screenshot':
                            obs_parts.append("Screenshot captured.")
                        else:
                            obs_parts.append(f"browser({action}): OK")
                    
                    # ── computer (was desktop + screen + mouse + process) ──
                    elif tool_name == 'computer':
                        if action == 'list_windows':
                            windows = result.get('windows', [])
                            obs_parts.append(f"Windows ({len(windows)}):")
                            for w in windows[:30]:
                                if isinstance(w, dict):
                                    obs_parts.append(f"  [{w.get('handle', '')}] {w.get('title', '')[:80]} ({w.get('class_name', '')})")
                                else:
                                    obs_parts.append(f"  {str(w)[:100]}")
                        elif action == 'get_elements':
                            elements = result.get('elements', [])
                            obs_parts.append(f"UI elements ({len(elements)}):")
                            for elem in elements[:40]:
                                if isinstance(elem, dict):
                                    name = elem.get('name', '')[:50]
                                    ctrl = elem.get('control_type', elem.get('type', ''))
                                    auto_id = elem.get('automation_id', '')
                                    obs_parts.append(f"  {ctrl}: \"{name}\"" + (f" (id={auto_id})" if auto_id else ""))
                                else:
                                    obs_parts.append(f"  {str(elem)[:120]}")
                            if len(elements) > 40:
                                obs_parts.append(f"  ... +{len(elements) - 40} more")
                        elif action == 'read_all_text':
                            text = result.get('text', result.get('output', ''))
                            if text:
                                if len(text) > 4000:
                                    obs_parts.append(f"Window text (truncated):\n{text[:4000]}...")
                                else:
                                    obs_parts.append(f"Window text:\n{text}")
                        elif action in ('click', 'type', 'send_keys', 'select_item', 'toggle'):
                            obs_parts.append(f"computer({action}): OK")
                            if result.get('output'):
                                obs_parts.append(str(result['output'])[:500])
                        elif action in ('screenshot_window', 'screenshot', 'process_screenshot_window'):
                            obs_parts.append("Screenshot captured.")
                            if result.get('path'):
                                obs_parts.append(f"Saved to: {result['path']}")
                        elif action == 'read_table':
                            rows = result.get('rows', result.get('data', []))
                            obs_parts.append(f"Table ({len(rows)} rows):")
                            for row in rows[:20]:
                                obs_parts.append(f"  {str(row)[:200]}")
                            if len(rows) > 20:
                                obs_parts.append(f"  ... +{len(rows) - 20} more rows")
                        elif action in ('screen_info',):
                            monitors = result.get('monitors', result.get('screens', []))
                            obs_parts.append(f"Monitors ({len(monitors)}):")
                            for m in monitors:
                                obs_parts.append(f"  {str(m)[:200]}")
                        elif action in ('mouse_position',):
                            obs_parts.append(f"Mouse position: ({result.get('x', '?')}, {result.get('y', '?')})")
                        elif action == 'screen_size':
                            obs_parts.append(f"Screen size: {result.get('width', '?')}x{result.get('height', '?')}")
                        elif action in ('record_start', 'record_stop', 'record_status'):
                            obs_parts.append(f"computer({action}): {result.get('message', 'OK')}")
                        else:
                            obs_parts.append(f"computer({action}): OK")
                            for key, value in result.items():
                                if key != 'status' and not key.startswith('_') and value:
                                    val_str = str(value)
                                    if len(val_str) > 1000:
                                        val_str = val_str[:1000] + "..."
                                    obs_parts.append(f"{key}: {val_str}")
                    
                    # ── pdf dispatcher ──
                    elif tool_name == 'pdf':
                        if action == 'extract':
                            text = result.get('text', result.get('content', result.get('output', '')))
                            pages = result.get('pages', result.get('page_count', ''))
                            if pages:
                                obs_parts.append(f"Pages: {pages}")
                            if text:
                                if len(text) > 6000:
                                    obs_parts.append(f"Content (truncated):\n{text[:6000]}...")
                                else:
                                    obs_parts.append(f"Content:\n{text}")
                        elif action == 'metadata':
                            for key, value in result.items():
                                if key != 'status' and not key.startswith('_'):
                                    obs_parts.append(f"{key}: {str(value)[:200]}")
                        elif action == 'search':
                            matches = result.get('matches', result.get('results', []))
                            obs_parts.append(f"Search matches ({len(matches)}):")
                            for m in matches[:20]:
                                obs_parts.append(f"  {str(m)[:200]}")
                        else:
                            obs_parts.append(f"pdf({action}): OK")
                    
                    # ── memory dispatcher ──
                    elif tool_name == 'memory':
                        if action == 'search':
                            results_list = result.get('results', result.get('matches', []))
                            output = result.get('output', '')
                            if results_list:
                                obs_parts.append(f"Memory search ({len(results_list)} results):")
                                for r in results_list[:10]:
                                    obs_parts.append(f"  {str(r)[:300]}")
                            elif output:
                                if len(output) > 4000:
                                    obs_parts.append(f"Memory search results:\n{output[:4000]}...")
                                else:
                                    obs_parts.append(f"Memory search results:\n{output}")
                            else:
                                obs_parts.append("No memory results found.")
                        elif action == 'facts':
                            output = result.get('output', result.get('facts', ''))
                            if output:
                                obs_parts.append(f"User facts:\n{str(output)[:2000]}")
                            else:
                                obs_parts.append("No user facts stored.")
                        else:
                            obs_parts.append(f"memory({action}): OK")
                    
                    # ── obsidian dispatcher ──
                    elif tool_name == 'obsidian':
                        if action == 'create':
                            obs_parts.append(f"Note created: {result.get('title', result.get('path', 'OK'))}")
                        elif action in ('search', 'read'):
                            content = result.get('content', result.get('output', result.get('results', '')))
                            if content:
                                content_str = str(content)
                                if len(content_str) > 4000:
                                    obs_parts.append(f"Obsidian {action}:\n{content_str[:4000]}...")
                                else:
                                    obs_parts.append(f"Obsidian {action}:\n{content_str}")
                            else:
                                obs_parts.append(f"obsidian({action}): no results")
                        elif action == 'list':
                            notes = result.get('notes', result.get('files', []))
                            obs_parts.append(f"Notes ({len(notes)}):")
                            for n in notes[:30]:
                                obs_parts.append(f"  {str(n)[:150]}")
                        elif action == 'daily':
                            obs_parts.append(f"Daily note: {result.get('path', result.get('title', 'OK'))}")
                        elif action in ('backlinks', 'graph'):
                            links = result.get('links', result.get('neighbors', result.get('results', [])))
                            obs_parts.append(f"Obsidian {action} ({len(links)}):")
                            for link in links[:20]:
                                obs_parts.append(f"  {str(link)[:150]}")
                        elif action == 'tags':
                            tags = result.get('tags', [])
                            obs_parts.append(f"Tags ({len(tags)}): {', '.join(str(t) for t in tags[:50])}")
                        else:
                            obs_parts.append(f"obsidian({action}): OK")
                    
                    # ── macro dispatcher ──
                    elif tool_name == 'macro':
                        if action == 'run':
                            macro_name = result.get('macro', tool_args.get('name', ''))
                            stdout = result.get('stdout', '')
                            stderr = result.get('stderr', '')
                            rc = result.get('return_code', '')
                            obs_parts.append(f"Macro '{macro_name}' executed (exit code: {rc})")
                            if stdout:
                                obs_parts.append(f"Output:\n{stdout[:1000]}")
                            if stderr:
                                obs_parts.append(f"Stderr:\n{stderr[:500]}")
                        elif action == 'list':
                            macro_list = result.get('macros', [])
                            obs_parts.append(f"Available macros ({len(macro_list)}):")
                            for m in macro_list:
                                vars_str = ', '.join(m.get('variables', {}).keys())
                                obs_parts.append(f"  - {m.get('name', m.get('id', ''))}: {m.get('description', '')[:80]}")
                                if vars_str:
                                    obs_parts.append(f"    Variables: {vars_str}")
                        elif action == 'get':
                            obs_parts.append(f"Macro: {result.get('name', '')}")
                            obs_parts.append(f"Description: {result.get('description', '')}")
                            variables = result.get('variables', {})
                            if variables:
                                obs_parts.append(f"Variables: {json.dumps(variables)}")
                            body = result.get('body', '')
                            if body:
                                obs_parts.append(f"Script:\n{body[:2000]}")
                        else:
                            obs_parts.append(f"macro({action}): OK")
                    
                    # ── Generic fallback (raised limits for large context models) ──
                    else:
                        generic_chars = 0
                        for key, value in result.items():
                            if key != 'status' and not key.startswith('_') and value:
                                val_str = str(value)
                                if len(val_str) > 2000:
                                    val_str = val_str[:2000] + "..."
                                line = f"{key}: {val_str}"
                                generic_chars += len(line)
                                obs_parts.append(line)
                                if generic_chars > 8000:
                                    obs_parts.append("[...output truncated]")
                                    break
                else:
                    # Unknown status
                    obs_parts.append(f"Result: {json.dumps(result)[:500]}")
            else:
                obs_parts.append(f"Result: {str(result)[:500]}")
            
            return "\n".join(obs_parts)
        except Exception as e:
            logger.error(f"Error creating observation: {e}")
            return json.dumps(result) if isinstance(result, dict) else str(result)

    def continue_task(self, follow_up=None, model_override=None, auto_execute=None):
        """
        Continue the current task with optional follow-up.
        If there's an active task, resume it. Otherwise start fresh.
        """
        if not self.current_task or not self.task_messages:
            return {"status": "no_task", "message": "No active task to continue. Start a new task."}
        
        # Add follow-up message if provided
        if follow_up:
            self.task_messages.append({
                "role": "user",
                "content": follow_up
            })
        else:
            self.task_messages.append({
                "role": "user",
                "content": "Continue working on the task. Summarize what you've accomplished so far and what remains."
            })
        
        # Resume the task loop
        return self._run_task_loop(model_override, auto_execute)
    
    def clear_task(self):
        """Clear the current task state."""
        self.current_task = None
        self.task_messages = []
        self.task_tool_history = []
        try:
            from src.infra.task_persistence import clear_task_state
            clear_task_state()
        except Exception:
            pass
        return {"status": "cleared", "message": "Task cleared."}

    def chat_with_tools(self, message, image_data=None, model_override=None, auto_execute=None, max_tool_rounds=50, _resume_state=None, _isolated_messages=None, chat_mode='code'):
        """
        Chat with autonomous tool calling capability.
        
        The LLM can request tool executions, which are either:
        - Auto-executed (if auto_execute=True or tool is in auto-execute list)
        - Sent to frontend for user approval (if auto_execute=False)
        
        Args:
            message: User message
            image_data: Optional image data
            model_override: Override model selection
            auto_execute: None=use config, True=auto-execute all, False=always ask
            max_tool_rounds: Maximum tool execution rounds before forcing final answer
            _isolated_messages: Pre-built message list for isolated execution (subagents).
                                When set, skips all context/history injection and uses these
                                messages directly.
            
        Returns:
            Final response dict with tool execution history
        """
        logger.info(f"[CHAT_WITH_TOOLS] *** ENTERED chat_with_tools *** message={message[:50] if message else 'None'}...")
        print(f"[CHAT_WITH_TOOLS] *** ENTERED chat_with_tools ***", flush=True)
        
        # Vision fallback: if image attached and current model lacks vision, swap to fallback
        if image_data and not model_override:
            current_model = self.config.get('model', 'llama3.2-vision:11b')
            current_provider = _resolve_model_metadata(current_model).get('provider', 'ollama')
            if current_provider not in _VISION_PROVIDERS:
                fallback = self.config.get('vision_fallback_model', 'gemini-2.5-flash')
                if _resolve_model_metadata(fallback).get('provider') in _VISION_PROVIDERS:
                    logger.info(f"[TOOLS] Vision fallback: '{current_model}' lacks vision, using '{fallback}' for this image call")
                    model_override = fallback
        
        # Check for "continue" command
        if message and message.strip().lower() in ["continue", "go on", "keep going", "proceed"]:
            return self.continue_task(model_override=model_override, auto_execute=auto_execute)
        
        # Check for "clear" command
        if message and message.strip().lower() in ["clear task", "new task", "start over", "reset"]:
            self.clear_task()
        
        if not TOOLS_AVAILABLE:
            logger.warning("Tools not available, falling back to regular chat")
            return self.chat_response(message, image_data, model_override=model_override)
        
        # Gate: wait for LLM backend to be reachable before first call
        if not self._api_ready:
            if not self._wait_for_api(timeout=30):
                return {
                    "response": "The AI backend isn't available yet — still starting up. Try again in a moment.",
                    "result": "The AI backend isn't available yet — still starting up. Try again in a moment.",
                    "_handled": False,
                }
        
        # ── Resume from saved state (after tool approval) ──
        if _resume_state:
            logger.info(f"[TOOLS] Resuming tool loop from saved state (round {_resume_state['round_count']}, {len(_resume_state['tool_history'])} tools done)")
            messages = _resume_state['messages']
            tool_history = _resume_state['tool_history']
            tool_schemas = _resume_state['tool_schemas']
            round_count = _resume_state['round_count']
            max_tool_rounds = _resume_state.get('max_tool_rounds', max_tool_rounds)
            original_task = _resume_state['original_task']
            auto_continue_count = _resume_state.get('auto_continue_count', 0)
            model_override = _resume_state.get('model_override', model_override)
            auto_execute = _resume_state.get('auto_execute', auto_execute)
            final_response = ""
            overflow_retries = 0
            # Jump straight to the loop (skip message building below)
            # Uses a flag so we don't duplicate the while-loop code
            _skip_init = True
        else:
            _skip_init = False
        
        # Get auto-execute setting from config if not specified
        if auto_execute is None:
            auto_execute = self.config.get('tools_auto_execute', False)
        
        # ── Isolated execution (subagents) ──
        # When _isolated_messages is provided, skip all parent context injection
        # and use the pre-built messages directly with a fresh tool loop.
        if _isolated_messages is not None:
            _skip_init = True
            messages = list(_isolated_messages)
            registry = get_tool_registry()
            tool_schemas = registry.get_schemas_for_llm()
            tool_history = []
            round_count = 0
            final_response = ""
            content = ""
            original_task = message
            overflow_retries = 0
            auto_continue_count = 0
            logger.info(f"[TOOLS] Subagent isolated execution with {len(messages)} pre-built messages")
        
        if not _skip_init:
            # Store current task for persistence
            self.current_task = message
            self.task_tool_history = []
        
        # Get tool registry and load contextual tools based on user message
        if not _skip_init or _isolated_messages is None:
            registry = get_tool_registry()
        
        if not _skip_init:
            # Load on-demand tools if the user's message warrants them
            try:
                from src.tools.tool_registry import load_contextual_tools
                loaded = load_contextual_tools(message, registry)
                if loaded:
                    logger.info(f"[TOOLS] On-demand tools loaded: {loaded}")
            except Exception as e:
                logger.warning(f"[TOOLS] Failed to load contextual tools: {e}")
            tool_schemas = registry.get_schemas_for_llm()
        
        # Ask & Plan modes: restrict to read-only tools
        if chat_mode in ('ask', 'plan') and tool_schemas:
            _READONLY_TOOLS = {'text_editor', 'memory', 'web_search', 'web_fetch'}
            tool_schemas = [s for s in tool_schemas if s.get('function', {}).get('name') in _READONLY_TOOLS]
            logger.info(f"[TOOLS] {chat_mode.title()} mode — filtered to {len(tool_schemas)} read-only tools")
        
        if not tool_schemas:
            logger.warning("No tools available, falling back to regular chat")
            return self.chat_response(message, image_data, model_override=model_override)
        
        if not _skip_init:
            # Build initial messages using prompt builder
            messages = []
            
            # Build single unified system prompt — everything in one message
            system_prompt = build_system_prompt(
                config=self.config,
                tool_registry=registry,
                workspace_dir=os.path.join(os.path.dirname(__file__), 'workspace'),
                include_tools=True,
                include_skills=True,
                include_memory=True,
                include_circuits=True,
            )
            
            # Plan mode: collaborative brainstorming & planning
            if chat_mode == 'plan':
                system_prompt = (
                    "## MODE: BRAINSTORM & PLAN\n"
                    "You are in planning mode. Your job is to help the user think through their idea "
                    "before any code is written or actions are taken. Do NOT immediately jump to a plan — "
                    "first discuss, ask clarifying questions, explore trade-offs, and make sure you "
                    "understand what the user actually wants. Use read-only tools (read files, search, "
                    "web lookup) to gather context as needed. Once the idea is clear and the user is "
                    "ready, collaboratively build a concrete, actionable plan. You must NOT execute "
                    "any write operations, run commands, or modify files.\n\n"
                ) + system_prompt
            
            # Append context sections directly to system prompt (avoids multiple system messages)
            context_parts = []
            
            # User facts (name, preferences)
            try:
                from src.tools.memory_tool import get_user_facts
                user_facts = get_user_facts()
                if user_facts:
                    context_parts.append(f"## User Facts\n{user_facts}")
            except Exception:
                pass
            
            # Recent conversation context (lightweight — 5 entries)
            try:
                context_str = self.unified_memory.get_recent_context(limit=5, include_metadata=True)
                if context_str:
                    context_parts.append(f"## Recent Context\n{context_str}")
            except Exception:
                pass
            
            # Persisted task state from previous session
            try:
                from src.infra.task_persistence import load_task_state, format_task_resume_context, clear_task_state
                saved_state = load_task_state()
                if saved_state:
                    context_parts.append(format_task_resume_context(saved_state))
                    clear_task_state()
                    logger.info(f"[TOOLS] Injected persisted task context from previous session")
            except Exception as persist_err:
                logger.debug(f"[TOOLS] Task persistence load skipped: {persist_err}")
            
            # Experiential lessons
            try:
                from src.infra.lessons import load_lessons, format_lessons_for_injection, decay_lessons, consolidate_lessons
                decay_lessons()
                consolidate_lessons()
                lessons = load_lessons(task_description=message)
                if lessons:
                    context_parts.append(format_lessons_for_injection(lessons))
                    logger.info(f"[TOOLS] Injected {len(lessons)} experiential lessons")
            except Exception as lessons_err:
                logger.debug(f"[TOOLS] Lessons injection skipped: {lessons_err}")
            
            # Combine into single system message
            if context_parts:
                system_prompt += "\n\n" + "\n\n".join(context_parts)
            
            messages.append({
                "role": "system",
                "content": system_prompt
            })
            
            # Add user message
            if image_data:
                processed_image = self.process_image(image_data)
                if processed_image and not processed_image.startswith('data:image'):
                    processed_image = f"data:image/jpeg;base64,{processed_image}"
                ts = datetime.now().strftime("[%b %d, %Y %I:%M %p]")
                messages.append({
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"{ts} {message}"},
                        {"type": "image_url", "image_url": {"url": processed_image}}
                    ]
                })
            else:
                # Only add user message if it has content (Anthropic requires non-empty content)
                if message and message.strip():
                    ts = datetime.now().strftime("[%b %d, %Y %I:%M %p]")
                    messages.append({
                        "role": "user",
                        "content": f"{ts} {message}"
                    })
            
            # Link understanding: auto-extract URL content from user message
            if message:
                try:
                    from src.infra.link_understanding import process_message_links
                    link_content = process_message_links(message)
                    if link_content:
                        messages.append({
                            "role": "system",
                            "content": link_content
                        })
                        logger.info(f"[TOOLS] Link understanding injected {len(link_content)} chars of URL content")
                except Exception as link_err:
                    logger.debug(f"[TOOLS] Link understanding skipped: {link_err}")
            
            # Tool execution loop variables (fresh start)
            tool_history = []
            round_count = 0
            final_response = ""
            content = ""
            original_task = message  # Store original task for goal reminders
            overflow_retries = 0  # Guard against infinite compaction loops
            auto_continue_count = 0  # Track auto-continues for logging
            _null_retries = 0  # Consecutive null-response retries
        
        while round_count < max_tool_rounds:
            # Check for user interrupt before each round
            if self._interrupt.is_set():
                logger.info(f"[TOOLS] Interrupted by user after round {round_count}")
                self._interrupt.clear()
                
                # Save full state so we can resume later
                self._interrupted_state = {
                    "messages": messages,
                    "tool_history": tool_history,
                    "round_count": round_count,
                    "original_task": original_task,
                    "max_tool_rounds": max_tool_rounds,
                    "model_override": model_override,
                    "auto_execute": auto_execute,
                    "tool_schemas": tool_schemas,
                }
                self.task_messages = messages
                self.task_tool_history = tool_history
                
                # Persist task state to disk so it survives proxy restarts
                try:
                    from src.infra.task_persistence import save_task_state
                    save_task_state(
                        task=original_task,
                        tool_history=tool_history,
                        round_count=round_count,
                        model=model_override or self.config.get('model'),
                    )
                except Exception as persist_err:
                    logger.debug(f"[TOOLS] Task persistence save failed: {persist_err}")
                
                if tool_history:
                    tool_names = [h.get('tool', '?') for h in tool_history[-3:]]
                    final_response = f"I was working on that (used {', '.join(tool_names)}) — say \"continue\" and I'll pick up where I left off."
                else:
                    final_response = "Sure, what's up? Say \"continue\" when you want me to resume."
                send_message_to_frontend({
                    "status": "streaming",
                    "result": final_response,
                    "clear_thinking": True
                })
                break
            
            round_count += 1
            logger.info(f"[TOOLS] Starting tool round {round_count}/{max_tool_rounds}")
            
            # Lazy compaction: only compact when context is actually near the limit.
            # Avoids expensive per-round token estimation and LLM summarization calls.
            if round_count > 3 and round_count % 3 == 0:
                _est_tokens = sum(len(str(m.get('content', ''))) // 4 for m in messages)
                if _est_tokens > 50000:
                    try:
                        from src.infra.context_pruning import prune_context_messages
                        ctx_tokens = self.config.get('context_window_tokens', 128000)
                        messages, prune_stats = prune_context_messages(messages, ctx_tokens)
                        if prune_stats.chars_saved > 0:
                            logger.info(f"[TOOLS] Context pruned: saved {prune_stats.chars_saved} chars")
                    except Exception:
                        pass
                    messages = self._compact_messages(messages, max_tokens=65000)
            
            # Show thinking panel while LLM is processing
            send_message_to_frontend({"type": "thinking_start"})
            
            # Call LLM with tools
            logger.info(f"[TOOLS] Calling _call_llm_with_tools...")
            response = self._call_llm_with_tools(messages, tool_schemas, model_override)
            logger.info(f"[TOOLS] LLM response: content_len={len(response.get('content', '')) if response else 0}, tool_calls={len(response.get('tool_calls', [])) if response else 0}")
            
            # (Explicit reasoning tokens from response['thinking'] are merged
            #  into _all_thinking below, alongside the model's content text)
            
            if not response:
                # Retry a few times on startup / transient failures before giving up
                _null_retries += 1
                if _null_retries <= 2:
                    delay = 3 * (2 ** (_null_retries - 1))  # 3s, 6s
                    logger.warning(f"[TOOLS] No response from LLM (attempt {_null_retries}/2), retrying in {delay}s...")
                    send_message_to_frontend({
                        "status": "tool_executing",
                        "tool": "retry",
                        "message": f"⟳ Waiting for model to respond ({_null_retries}/2)...",
                        "streaming": True
                    })
                    time.sleep(delay)
                    continue
                logger.warning("[TOOLS] No response from LLM after retries, breaking loop")
                send_message_to_frontend({"type": "thinking_end"})
                final_response = "I wasn't able to get a response from the model. This could be a network issue or the model may be overloaded. Try again or switch models."
                break
            else:
                _null_retries = 0  # Reset on successful response
            
            # Format error recovery: reassess approach and retry
            if response.get('_error_type') == 'format_error':
                overflow_retries += 1
                if overflow_retries > 2:
                    # ── Layer 3: Failure Analysis ──
                    # Format errors persisted through retries. The conversation
                    # context is likely corrupted. Instead of giving up, build
                    # a fresh context with a failure log and ask the model to
                    # devise a completely new strategy.
                    logger.warning(f"[TOOLS] Format errors persist — running failure analysis with fresh context")
                    send_message_to_frontend({
                        "status": "tool_executing",
                        "tool": "failure_analysis",
                        "message": "⟳ Analyzing failures and replanning...",
                        "streaming": True
                    })
                    
                    # Build compact failure log
                    failure_log_lines = []
                    for i, h in enumerate(tool_history, 1):
                        name = h.get('tool', '?')
                        args = h.get('args', {})
                        result = h.get('result', {})
                        arg_str = ', '.join(f'{k}={str(v)[:30]}' for k, v in list(args.items())[:3])
                        if isinstance(result, dict) and result.get('error'):
                            res_str = f"ERROR: {str(result['error'])[:60]}"
                        elif isinstance(result, dict) and result.get('output'):
                            res_str = str(result['output'])[:60]
                        else:
                            res_str = "OK"
                        failure_log_lines.append(f"  {i}. {name}({arg_str}) → {res_str}")
                    failure_log = "\n".join(failure_log_lines) if failure_log_lines else "  (no tools executed successfully)"
                    
                    # Fresh context — no corrupted messages
                    analysis_messages = [
                        {"role": "system", "content": (
                            "You are recovering from repeated tool call formatting errors. "
                            "The previous conversation context was corrupted. You have a "
                            "fresh start. Analyze what was attempted, figure out a simpler "
                            "approach, and either execute it with tool calls or explain to "
                            "the user what you can do instead."
                        )},
                        {"role": "user", "content": (
                            f"Original request: \"{original_task[:400]}\"\n\n"
                            f"What was attempted before the errors:\n{failure_log}\n\n"
                            f"The tool calls kept having formatting issues. "
                            f"Figure out a simpler way to accomplish this. "
                            f"Use the simplest tools possible, or if tools aren't needed, "
                            f"just answer directly."
                        )}
                    ]
                    
                    try:
                        recovery_response = self._call_llm_with_tools(analysis_messages, tool_schemas, model_override=model_override)
                        
                        if recovery_response and recovery_response.get('_error_type') != 'format_error':
                            recovery_content = recovery_response.get('content', '')
                            recovery_tools = recovery_response.get('tool_calls', [])
                            
                            if recovery_tools:
                                # Model found a new strategy with tool calls — inject
                                # the fresh messages and let the main loop continue
                                logger.info(f"[TOOLS] Failure analysis produced {len(recovery_tools)} new tool calls — resuming")
                                messages = analysis_messages
                                response = recovery_response
                                content = recovery_content
                                tool_calls = recovery_tools
                                overflow_retries = 0  # Reset — fresh start
                                # Fall through to tool processing below
                            elif recovery_content and recovery_content.strip():
                                # Model answered with text — use as final response
                                logger.info(f"[TOOLS] Failure analysis produced text response — using as final")
                                final_response = recovery_content.strip()
                                break
                            else:
                                logger.warning(f"[TOOLS] Failure analysis produced empty response")
                                final_response = ""
                                break
                        else:
                            logger.error(f"[TOOLS] Failure analysis also hit format errors — truly giving up")
                            final_response = ""
                            break
                    except Exception as analysis_err:
                        logger.error(f"[TOOLS] Failure analysis failed: {analysis_err}")
                        final_response = ""
                        break
                else:
                    logger.warning(f"[TOOLS] Format error in round {round_count} — reassessing approach")
                    # Remove any trailing assistant messages that may have bad formatting
                    while messages and messages[-1].get('role') == 'assistant':
                        messages.pop()
                    messages.append({
                        "role": "system",
                        "content": "Your previous tool call had a formatting error. Step back and reassess: Is there a simpler tool or approach that achieves the same goal? If so, use it. If not, try a completely different solution. Do not repeat the same approach that just failed."
                    })
                    round_count -= 1  # Don't count this as a used round
                    send_message_to_frontend({"type": "thinking_end"})
                    continue
            
            # Context overflow recovery: force-compact and retry this round
            if response.get('_error_type') == 'context_overflow':
                overflow_retries += 1
                if overflow_retries > 2:
                    logger.error(f"[TOOLS] Context overflow persists after {overflow_retries} compaction attempts — giving up")
                    final_response = "I ran out of context space and couldn't recover. Try starting a new task or simplifying the request."
                    break
                logger.warning(f"[TOOLS] Context overflow in round {round_count} — force-compacting and retrying (attempt {overflow_retries})")
                send_message_to_frontend({
                    "status": "tool_executing",
                    "tool": "compaction",
                    "message": f"⟳ Context too large — compacting conversation history (attempt {overflow_retries})...",
                    "streaming": True
                })
                # Force aggressive compaction (halve the threshold)
                messages = self._compact_messages(messages, max_tokens=32000)
                # If still too large after compaction, do emergency truncation
                total_est = sum(self._estimate_tokens(str(m.get('content', ''))) for m in messages)
                if total_est > 50000:
                    system_msgs = [m for m in messages if m.get('role') == 'system']
                    non_system = [m for m in messages if m.get('role') != 'system']
                    # Keep only last 2 non-system messages
                    messages = system_msgs + non_system[-2:]
                    logger.warning(f"[TOOLS] Emergency truncation: kept {len(messages)} messages")
                round_count -= 1  # Don't count this as a used round
                send_message_to_frontend({"type": "thinking_end"})
                continue
            
            # Check if LLM wants to call tools
            tool_calls = response.get('tool_calls', [])
            content = response.get('content', '')
            # Preserve raw Gemini parts (with thoughtSignature) for echo-back
            _gemini_raw_parts = response.get('_gemini_raw_parts')
            
            # Do NOT eagerly set final_response here.  It is set only at the
            # explicit decision points below (task-complete, natural-completion).
            # Setting it here would leak mid-task planning text or auto-continue
            # internal messages to the user as the final reply.
            
            logger.info(f"[TOOLS] Parsed tool_calls: {[tc.get('function', {}).get('name', 'unknown') for tc in tool_calls]}")
            print(f"[TOOLS] tool_calls count: {len(tool_calls)}", flush=True)
            print(f"[TOOLS] content preview: {content[:150] if content else 'empty'}...", flush=True)
            
            # Show the model's reasoning/plan in the thinking panel
            # (panel was already opened with thinking_start before the LLM call)
            _all_thinking = ''
            if response.get('thinking'):
                _all_thinking += response['thinking']
            if content and content.strip() and tool_calls:
                if _all_thinking:
                    _all_thinking += '\n\n--- Plan ---\n'
                _all_thinking += content.strip()
            
            if _all_thinking:
                for i in range(0, len(_all_thinking), 200):
                    send_message_to_frontend({
                        "type": "thinking_delta",
                        "content": _all_thinking[i:i+200]
                    })
            # Finalize the thinking panel (close spinner, collapse)
            send_message_to_frontend({"type": "thinking_end"})
            
            # Also stream the plan text as a visible message on round 1
            # so the user sees what the model intends to do
            if content and content.strip() and tool_calls:
                send_message_to_frontend({
                    "status": "streaming",
                    "result": content.strip(),
                    "clear_thinking": True
                })
                # Voice the plan on the first round so the user hears intent before tools run
                if round_count == 1:
                    try:
                        speak(content.strip())
                    except Exception:
                        pass
            
            if not tool_calls:
                # ── No tool calls = model is done ──
                # The model controls the loop.  When it responds with text
                # and no tool calls, that IS the completion signal.  No
                # heuristic keyword matching, no auto-continue injection.
                
                # Exception: first-round refusal (model doesn't know it has tools)
                if round_count == 1 and content:
                    content_lower = content.lower()
                    _refusal = any(p in content_lower for p in [
                        "i can't", "i cannot", "i don't have", "i'm unable",
                        "not able to", "no access", "cannot execute", "can't execute",
                        "don't have the ability", "beyond my capabilities",
                    ])
                    if _refusal:
                        logger.info(f"[TOOLS] Model refusing on round 1 — nudging about tool access")
                        messages.append({"role": "assistant", "content": content})
                        messages.append({
                            "role": "user",
                            "content": (
                                "CORRECTION: You DO have tool access. These are REAL tools that execute on my computer.\n\n"
                                "Your tools: exec (shell commands), read_file, write_file, edit_file, grep, "
                                "web_search, browser (CDP: navigate/click/type/read/screenshot/snapshot), "
                                "desktop (pywinauto: any Windows app), screen (screenshot), mouse (click coords), "
                                "pdf (extract), memory (search past conversations).\n\n"
                                "Use them now to complete my request."
                            )
                        })
                        continue
                
                # Accept the response — model decided it's done
                logger.info(f"[TOOLS] Model responded without tool calls (round {round_count}, {len(tool_history)} tools used) — accepting")
                final_response = self._strip_echoed_instructions(content)
                break
            
            # ── Process tool calls ──
            # Emit ONE assistant message with ALL tool_calls, then individual
            # tool results.  Avoids O(N) token bloat per round.
            
            # First, append the single assistant message with all tool calls
            assistant_msg = {
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls
            }
            if _gemini_raw_parts:
                assistant_msg['_gemini_raw_parts'] = _gemini_raw_parts
                _gemini_raw_parts = None
            messages.append(assistant_msg)
            
            # ── Parallel tool execution ──
            # Read-only tools can safely run concurrently.  Mutating tools
            # (bash, text_editor write/edit, browser click/type/navigate, computer click/type)
            # must run sequentially to avoid race conditions.
            _READONLY_TOOLS = frozenset({'web_search', 'web_fetch', 'pdf', 'memory', 'look'})
            _READONLY_BROWSER_ACTIONS = frozenset({'tabs', 'read', 'elements', 'screenshot', 'screenshot_element', 'snapshot', 'snapshot_enhanced', 'status', 'wait_for', 'wait_time', 'wait_text_gone', 'console'})
            _READONLY_TEXT_EDITOR_ACTIONS = frozenset({'read', 'list', 'info', 'grep'})
            _READONLY_COMPUTER_ACTIONS = frozenset({
                'list_windows', 'get_elements', 'read_element', 'read_all_text', 'read_table',
                'get_props', 'dump_tree', 'find_by_id',
                'mouse_position', 'screen_size', 'screenshot', 'screen_info',
                'exec_status', 'exec_list', 'list_processes', 'process_info',
                'active_window', 'window_context', 'record_status',
            })
            
            def _is_readonly(tname, targs):
                if tname in _READONLY_TOOLS:
                    return True
                if tname == 'text_editor' and targs.get('action', '') in _READONLY_TEXT_EDITOR_ACTIONS:
                    return True
                if tname == 'browser' and targs.get('action', '') in _READONLY_BROWSER_ACTIONS:
                    return True
                if tname == 'computer' and targs.get('action', '') in _READONLY_COMPUTER_ACTIONS:
                    return True
                if tname == 'skill' and targs.get('action', '') in ('find', 'list'):
                    return True
                if tname == 'media' and targs.get('action', '') in ('gif_search', 'gif_random', 'gif_trending'):
                    return True
                if tname == 'learn' and targs.get('action', '') == 'analyze':
                    return True
                return False
            
            def _build_preview(tname, targs):
                """Build execution preview string and optional code preview for frontend."""
                ep = ""
                cp = None
                cpm = None
                if tname == "exec":
                    cmd = targs.get('command', '')
                    ep = f" → {cmd[:80]}{'...' if len(cmd) > 80 else ''}"
                    cp = cmd
                elif tname == "write_file":
                    fpath = targs.get('path', targs.get('file_path', ''))
                    fname = fpath.rsplit('\\', 1)[-1].rsplit('/', 1)[-1] if fpath else ''
                    ext = fname.rsplit('.', 1)[-1] if '.' in fname else ''
                    wc = targs.get('content', '')
                    ep = f" → {fname}"
                    if wc:
                        cp = wc[:4000] + ('\n... (truncated)' if len(wc) > 4000 else '')
                        cpm = {"type": "write", "lang": ext, "file": fname}
                elif tname == "edit_file":
                    fpath = targs.get('path', targs.get('file_path', ''))
                    fname = fpath.rsplit('\\', 1)[-1].rsplit('/', 1)[-1] if fpath else ''
                    ext = fname.rsplit('.', 1)[-1] if '.' in fname else ''
                    old_s = targs.get('old_string', targs.get('old_str', ''))
                    new_s = targs.get('new_string', targs.get('new_str', ''))
                    ep = f" → {fname}"
                    if old_s or new_s:
                        op = (old_s[:1500] + '\n...' if len(old_s) > 1500 else old_s) if old_s else ''
                        np = (new_s[:2500] + '\n...' if len(new_s) > 2500 else new_s) if new_s else ''
                        cp = json.dumps({"old": op, "new": np})
                        cpm = {"type": "diff", "lang": ext, "file": fname}
                elif tname == "read_file":
                    fpath = targs.get('path', targs.get('file_path', ''))
                    fname = fpath.rsplit('\\', 1)[-1].rsplit('/', 1)[-1] if fpath else ''
                    ep = f" → {fname}"
                elif tname == "grep":
                    pat = targs.get('pattern', targs.get('query', ''))
                    gp = targs.get('path', targs.get('directory', ''))
                    ep = f" → /{pat}/ in {gp}"
                elif tname == "browser":
                    act = targs.get('action', '')
                    if act == 'navigate': ep = f" → {targs.get('url', '')}"
                    elif act in ('click', 'click_ref'): ep = f" → {targs.get('selector', targs.get('ref', ''))}"
                    elif act in ('type', 'type_ref'): ep = f" → {targs.get('selector', targs.get('ref', ''))} = \"{targs.get('text', '')[:30]}\""
                    elif act == 'snapshot': ep = " → snapshot"
                    elif act == 'scroll': ep = f" → scroll {targs.get('direction', 'down')}"
                    else: ep = f" → {act}"
                return ep, cp, cpm
            
            def _execute_single_tool(tc):
                """Execute a single tool call. Returns (tool_call, tool_name, tool_args, result, verification_enrichment, should_execute)."""
                tname = tc.get('function', {}).get('name', '')
                targs_str = tc.get('function', {}).get('arguments', '{}')
                tid = tc.get('id', f'call_{round_count}')
                
                try:
                    targs = json.loads(targs_str) if isinstance(targs_str, str) else targs_str
                except json.JSONDecodeError:
                    targs = {}
                
                logger.info(f"[TOOLS] Executing: {tname} args={list(targs.keys())}")
                
                # Exec approval gate
                if tname in ('bash', 'computer') and (targs.get('command') or targs.get('action') in ('exec_status',)):
                    cmd = targs.get('command', '')
                    if cmd:
                        try:
                            from src.infra.exec_approvals import check_exec_approval, ApprovalResult
                            approval = check_exec_approval(cmd, tool_name=tname)
                            if approval.result == ApprovalResult.DENIED:
                                logger.warning(f"[TOOLS] Command denied: {cmd[:80]} ({approval.reason})")
                                res = {"status": "error", "error": f"Command blocked by safety policy: {approval.reason}", "tool": tname}
                                return tc, tname, targs, res, "", False
                        except Exception:
                            pass
                
                # Ask & Plan modes: block write operations even on allowed tools
                if chat_mode in ('ask', 'plan'):
                    _blocked = False
                    if tname == 'text_editor' and targs.get('action') in ('write', 'edit'):
                        _blocked = True
                    elif tname in ('bash', 'computer', 'browser'):
                        _blocked = True
                    if _blocked:
                        res = {"status": "blocked", "error": f"Write operation '{tname}' blocked in {chat_mode.title()} mode."}
                        return tc, tname, targs, res, "", False
                
                # Stream execution preview
                ep, cp, cpm = _build_preview(tname, targs)
                msg_payload = {"status": "tool_executing", "tool": tname, "args": targs, "message": f"▶ {tname}{ep}", "streaming": True}
                if cp: msg_payload["code_preview"] = cp
                if cpm: msg_payload["code_preview_meta"] = cpm
                send_message_to_frontend(msg_payload)
                
                # Execute
                try:
                    res = registry.execute(tname, targs)
                    if res is not None and not isinstance(res, dict):
                        if hasattr(res, '__dict__'):
                            res = {k: v for k, v in res.__dict__.items() if not k.startswith('_')}
                        else:
                            res = {"status": "success", "output": str(res)}
                except Exception as e:
                    logger.error(f"[TOOLS] Tool '{tname}' threw: {e}")
                    res = {"status": "error", "error": f"{type(e).__name__}: {str(e)[:200]}", "tool": tname}
                
                # Self-verification layer
                venrich = ""
                try:
                    from src.infra.tool_verification import auto_retry_if_transient, verify_and_enrich
                    res, was_retried = auto_retry_if_transient(tname, targs, res, registry)
                    if was_retried:
                        logger.info(f"[VERIFY] {tname} auto-retried successfully")
                    res, vr = verify_and_enrich(tname, targs, res, registry)
                    venrich = vr.format_enrichment()
                    if venrich:
                        logger.info(f"[VERIFY] {tname} enriched with {len(venrich)} chars")
                except Exception:
                    pass
                
                return tc, tname, targs, res, venrich, True
            
            # Parse all tool calls and classify as readonly vs mutating
            parsed_calls = []
            for tc in tool_calls:
                tname = tc.get('function', {}).get('name', '')
                targs_str = tc.get('function', {}).get('arguments', '{}')
                try:
                    targs = json.loads(targs_str) if isinstance(targs_str, str) else targs_str
                except json.JSONDecodeError:
                    targs = {}
                parsed_calls.append((tc, tname, targs, _is_readonly(tname, targs)))
            
            # Check if we can parallelize: all calls must be readonly and auto-execute
            all_readonly = all(ro for _, _, _, ro in parsed_calls)
            can_parallel = all_readonly and len(parsed_calls) > 1 and auto_execute
            
            had_errors = []
            _awaiting_approval = False
            
            if can_parallel:
                # ── Parallel execution for read-only tools ──
                import concurrent.futures
                logger.info(f"[TOOLS] Parallel execution: {len(parsed_calls)} read-only tools")
                results_ordered = [None] * len(parsed_calls)
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(parsed_calls), 4)) as pool:
                    future_to_idx = {}
                    for idx, (tc, _, _, _) in enumerate(parsed_calls):
                        future_to_idx[pool.submit(_execute_single_tool, tc)] = idx
                    
                    for future in concurrent.futures.as_completed(future_to_idx, timeout=120):
                        idx = future_to_idx[future]
                        try:
                            results_ordered[idx] = future.result()
                        except Exception as e:
                            tc, tname, targs, _ = parsed_calls[idx]
                            tid = tc.get('id', f'call_{round_count}_{idx}')
                            results_ordered[idx] = (tc, tname, targs, {"status": "error", "error": f"Parallel execution failed: {e}"}, "", True)
                
                # Process results in original order (preserves message ordering)
                for tc, tname, targs, res, venrich, was_executed in results_ordered:
                    if res is None:
                        continue
                    tid = tc.get('id', f'call_{round_count}')
                    
                    tool_history.append({"tool": tname, "args": targs, "result": res, "auto_executed": was_executed})
                    
                    # Stream result preview
                    rp = ""
                    if isinstance(res, dict):
                        if res.get('success') or res.get('status') == 'success': rp = "✓"
                        elif res.get('error'): rp = f"✗ {str(res.get('error'))[:50]}"
                        elif res.get('output'): rp = f"\n```\n{str(res.get('output'))[:100]}\n```"
                    send_message_to_frontend({"status": "tool_result", "tool": tname, "result": res, "message": f"◀ {tname} {rp}", "streaming": True})
                    
                    if isinstance(res, dict) and res.get('success') and (res.get('image_base64') or res.get('image_url')):
                        send_message_to_frontend({"type": "image", "image_url": res.get('image_base64') or res.get('image_url', ''), "caption": res.get('revised_prompt', '') or res.get('caption', 'Generated image')})
                    
                    observation = self._create_tool_observation(tname, targs, res)
                    if venrich:
                        observation = observation + "\n\n" + venrich
                    messages.append({"role": "tool", "tool_call_id": tid, "name": tname, "content": observation})
                    
                    is_err = isinstance(res, dict) and (res.get('status') == 'error' or res.get('error'))
                    if is_err:
                        emsg = res.get('error', 'Unknown error') if isinstance(res, dict) else str(res)
                        had_errors.append(f"{tname}: {str(emsg)[:150]}")
            else:
                # ── Sequential execution (mutating tools or permission required) ──
                for tc, tname, targs, is_ro in parsed_calls:
                    if self._interrupt.is_set():
                        logger.info(f"[TOOLS] Interrupted between tool calls in round {round_count}")
                        break
                    
                    tid = tc.get('id', f'call_{round_count}')
                    
                    if not auto_execute and tname not in _READONLY_TOOLS:
                        # Ask for permission
                        _tinfo = registry.get_tool(tname) if registry else None
                        send_message_to_frontend({
                            "status": "tool_permission_required",
                            "tool": tname,
                            "args": targs,
                            "tool_call_id": tid,
                            "message": f"🔐 Permission required to execute: {tname}",
                            "description": _tinfo.description if _tinfo else ""
                        })
                        
                        self._pending_tool_calls = getattr(self, '_pending_tool_calls', {})
                        self._pending_tool_calls[tid] = {
                            "tool_name": tname,
                            "tool_args": targs,
                            "messages": messages.copy(),
                            "tool_call": tc,
                            "content": content,
                            "tool_history": tool_history.copy(),
                            "round_count": round_count,
                            "original_task": original_task,
                            "auto_continue_count": auto_continue_count,
                            "tool_schemas": tool_schemas,
                            "model_override": model_override,
                            "auto_execute": auto_execute,
                            "max_tool_rounds": max_tool_rounds,
                        }
                        
                        tool_history.append({"tool": tname, "args": targs, "result": {"status": "pending_approval"}, "auto_executed": False})
                        _awaiting_approval = True
                        
                        return {
                            "_handled": True,
                            "status": "awaiting_approval",
                            "tool": tname,
                            "tool_call_id": tid,
                            "tool_history": tool_history,
                            "message": f"Waiting for approval to execute {tname}"
                        }
                    
                    # Execute the tool
                    _, tname_r, targs_r, res, venrich, was_executed = _execute_single_tool(tc)
                    
                    if not was_executed:
                        # Approval gate denied — result already set
                        tool_history.append({"tool": tname_r, "args": targs_r, "result": res, "auto_executed": True})
                        observation = self._create_tool_observation(tname_r, targs_r, res)
                        messages.append({"role": "tool", "tool_call_id": tid, "name": tname_r, "content": observation})
                        had_errors.append(f"{tname_r}: {str(res.get('error', ''))[:150]}")
                        continue
                    
                    tool_history.append({"tool": tname_r, "args": targs_r, "result": res, "auto_executed": True})
                    
                    # Stream result preview
                    rp = ""
                    if isinstance(res, dict):
                        if res.get('success') or res.get('status') == 'success': rp = "✓"
                        elif res.get('error'): rp = f"✗ {str(res.get('error'))[:50]}"
                        elif res.get('output'): rp = f"\n```\n{str(res.get('output'))[:100]}\n```"
                    send_message_to_frontend({"status": "tool_result", "tool": tname_r, "result": res, "message": f"◀ {tname_r} {rp}", "streaming": True})
                    
                    if isinstance(res, dict) and res.get('success') and (res.get('image_base64') or res.get('image_url')):
                        send_message_to_frontend({"type": "image", "image_url": res.get('image_base64') or res.get('image_url', ''), "caption": res.get('revised_prompt', '') or res.get('caption', 'Generated image')})
                    
                    observation = self._create_tool_observation(tname_r, targs_r, res)
                    if venrich:
                        observation = observation + "\n\n" + venrich
                    messages.append({"role": "tool", "tool_call_id": tid, "name": tname_r, "content": observation})
                    
                    is_err = isinstance(res, dict) and (res.get('status') == 'error' or res.get('error'))
                    if is_err:
                        emsg = res.get('error', 'Unknown error') if isinstance(res, dict) else str(res)
                        had_errors.append(f"{tname_r}: {str(emsg)[:150]}")
                        logger.info(f"[SELF-HEAL] Tool '{tname_r}' failed: {str(emsg)[:100]}")
            
            # Single compact self-heal nudge for all errors (instead of per-tool verbose prompt)
            if had_errors:
                messages.append({
                    "role": "system",
                    "content": f"⚠ {len(had_errors)} tool(s) failed: {'; '.join(had_errors)}. Retry with fixed args or try a different approach."
                })
        
        # Safety: close any orphaned thinking panel before sending final response
        send_message_to_frontend({"type": "thinking_end"})
        
        # Safety net: final_response is only set at deliberate decision points
        # (task-complete signal or natural completion).  If we get here without
        # one, the loop was exhausted or interrupted — build a brief summary
        # instead of leaking internal planning text to the user.
        if not final_response:
            if tool_history:
                tool_names = [h.get('tool', '?') for h in tool_history]
                final_response = f"I completed {len(tool_history)} actions ({', '.join(tool_names[:5])}) but ran out of rounds before producing a summary. You can say 'continue' to let me finish."
                # Persist incomplete task so it survives restarts
                try:
                    from src.infra.task_persistence import save_task_state
                    save_task_state(
                        task=original_task,
                        tool_history=tool_history,
                        round_count=round_count,
                        model=model_override or self.config.get('model'),
                    )
                except Exception:
                    pass
            else:
                final_response = content if content and content.strip() else "I processed your request but wasn't able to generate a response. Try rephrasing or say 'continue' if I was mid-task."
            logger.warning(f"[TOOLS] No final_response after loop — generated fallback ({len(final_response)} chars)")
        
        # Store final response
        if final_response:
            self.add_to_memory(message, final_response, self.config.get('model'))
        
        # Extract experiential lessons from this task (background thread — non-blocking)
        if len(tool_history) >= 3:
            def _extract_lessons_bg(th, task_desc, cfg):
                try:
                    from src.infra.lessons import extract_lessons, store_lessons
                    new_lessons = extract_lessons(
                        tool_history=th,
                        task_description=task_desc,
                        config=cfg,
                    )
                    if new_lessons:
                        stored = store_lessons(new_lessons)
                        logger.info(f"[LESSONS] Extracted {len(new_lessons)} lessons, {stored} new")
                except Exception as e:
                    logger.debug(f"[LESSONS] Extraction skipped: {e}")
            import threading as _th
            _th.Thread(
                target=_extract_lessons_bg,
                args=(list(tool_history), original_task, dict(self.config)),
                daemon=True,
                name="lesson-extraction",
            ).start()
        
        # Save task state for persistence (Open Interpreter style)
        self.task_messages = messages
        self.task_tool_history = tool_history
        
        # Natural completion - if we got here, the task is done
        # The model responded with text and no tool calls, which IS the completion signal
        task_complete = bool(final_response)
        
        # Send final response to frontend (skip if empty — e.g. startup race condition)
        if final_response and final_response.strip():
            send_message_to_frontend({
                "status": "done",
                "result": final_response,
                "messages": [
                    {"role": "user", "content": message},
                    {"role": "assistant", "content": final_response}
                ],
                "tool_history": tool_history,
                "task_complete": task_complete,
                "can_continue": False,  # Natural completion means task is done
                "clear_thinking": True,
                "speak": True
            })
        else:
            # Still clear the thinking indicator
            send_message_to_frontend({"type": "thinking_end", "clear_thinking": True})
        
        # Clear task state - natural completion means we're done
        self.current_task = None
        self.task_messages = []
        self.task_tool_history = []
        
        # Clear persisted task state from disk
        try:
            from src.infra.task_persistence import clear_task_state
            clear_task_state()
        except Exception:
            pass
        
        return {
            "_handled": True,
            "status": "done",
            "result": final_response,
            "tool_history": tool_history,
            "task_complete": task_complete
        }
    
    def _call_llm_with_tools(self, messages, tools, model_override=None):
        """Call LLM with tool/function calling support. Includes auto-retry with exponential backoff."""
        # Ensure API is ready before any LLM call
        if not self._api_ready:
            self._wait_for_api(timeout=30)
        
        model_to_use = model_override or self.config.get("model", "llama3.2-vision:11b")
        model_metadata = _resolve_model_metadata(model_to_use)
        provider = model_metadata.get('provider', 'ollama')
        
        logger.info(f"[TOOLS] Calling LLM with tools: provider={provider}, model={model_to_use}")
        
        max_retries = 3
        base_delay = 2  # seconds
        
        for attempt in range(1, max_retries + 1):
            try:
                if provider == 'xai':
                    return self._call_xai_with_tools(messages, tools, model_metadata)
                elif provider == 'anthropic':
                    return self._call_anthropic_with_tools(messages, tools, model_metadata)
                elif provider == 'google':
                    return self._call_google_with_tools(messages, tools, model_metadata)
                elif provider == 'minimax':
                    return self._call_anthropic_with_tools(messages, tools, model_metadata)
                elif provider == 'openai':
                    return self._call_xai_with_tools(messages, tools, model_metadata)
                else:
                    return self._call_ollama_with_tools(messages, tools, model_to_use)
            except Exception as e:
                err_str = str(e).lower()
                
                # Classify the error
                is_context_overflow = any(phrase in err_str for phrase in [
                    'context length', 'context_length', 'too long', 'max_tokens',
                    'maximum context', 'token limit', 'context window', 'prompt is too long',
                    'request too large', 'content too large', 'input too long'
                ])
                is_retryable = any(phrase in err_str for phrase in [
                    '429', 'rate limit', 'rate_limit', 'overloaded', 'capacity',
                    '500', '502', '503', 'server error', 'internal error',
                    'timeout', 'timed out', 'connection', 'temporarily'
                ])
                is_auth_error = any(phrase in err_str for phrase in [
                    '401', 'unauthorized', 'api key', 'api_key', 'forbidden', '403'
                ])
                
                # Context overflow — return immediately with special marker so main loop can compact
                if is_context_overflow:
                    logger.warning(f"[TOOLS] Context overflow detected: {str(e)[:200]}")
                    return {"content": "", "tool_calls": [], "_error_type": "context_overflow"}
                
                # Auth/not-found errors — not retryable
                if is_auth_error or ('404' in err_str and 'not found' in err_str):
                    logger.error(f"[TOOLS] Non-retryable error: {e}")
                    hint = "There's an authentication issue with the API key." if is_auth_error else "The requested API endpoint wasn't found."
                    return {"content": hint, "tool_calls": []}
                
                # Retryable errors — backoff and retry
                if is_retryable and attempt < max_retries:
                    delay = base_delay * (2 ** (attempt - 1))  # 2s, 4s, 8s
                    logger.warning(f"[TOOLS] Retryable error (attempt {attempt}/{max_retries}), waiting {delay}s: {str(e)[:150]}")
                    send_message_to_frontend({
                        "status": "tool_executing",
                        "tool": "retry",
                        "message": f"⟳ API error, retrying in {delay}s (attempt {attempt}/{max_retries})...",
                        "streaming": True
                    })
                    time.sleep(delay)
                    continue
                
                # Tool formatting errors (thought_signature, schema mismatch, etc.)
                if 'thought_signature' in err_str or 'schema' in err_str:
                    logger.warning(f"[TOOLS] Format/schema error (attempt {attempt}): {str(e)[:300]}")
                    if attempt < max_retries:
                        # Strip the last assistant message that caused the formatting issue
                        while messages and messages[-1].get('role') == 'assistant':
                            messages.pop()
                        time.sleep(1)
                        continue
                    else:
                        logger.error(f"[TOOLS] Tool formatting error persists after {max_retries} attempts: {str(e)[:300]}")
                        return {"content": "", "tool_calls": [], "_error_type": "format_error"}
                
                # Final attempt failed or non-retryable unknown error
                logger.error(f"[TOOLS] Error calling LLM with tools (attempt {attempt}): {e}")
                if is_retryable:
                    hint = f"The API is still having issues after {max_retries} retries. Let me try a different approach."
                else:
                    hint = "I hit a snag with that request. Let me try a different approach."
                return {"content": hint, "tool_calls": []}
        
        # Safety net: should never reach here, but guarantee non-None return
        logger.error("[TOOLS] _call_llm_with_tools exhausted all retries without returning")
        return {"content": "I wasn't able to reach the model after multiple attempts. Please try again.", "tool_calls": []}
    
    def _call_xai_with_tools(self, messages, tools, metadata):
        """Call xAI/Grok or OpenAI with function calling (OpenAI-compatible chat completions)."""
        actual_provider = metadata.get('provider', 'xai')
        api_key = _resolve_remote_key(self.config, provider=actual_provider)
        if not api_key:
            display = metadata.get('display_name', actual_provider)
            raise RemoteAPIError(f"Missing API key for {display}")
        
        endpoint = metadata.get('endpoint', 'https://api.x.ai/v1/chat/completions')
        model_name = metadata.get('remote_model') or 'grok-4-latest'
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'model': model_name,
            'messages': messages,
            'tools': tools,
            'tool_choice': 'auto',
            'temperature': self.config.get('temperature', 0.7),
            'max_tokens': self.config.get('max_tokens', 4096)
        }
        
        response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
        
        if response.status_code != 200:
            raise RemoteAPIError(f"xAI request failed: {response.status_code} {response.text}")
        
        result = response.json()
        choice = result.get('choices', [{}])[0]
        message = choice.get('message', {})
        
        resp = {
            'content': message.get('content', ''),
            'tool_calls': message.get('tool_calls', [])
        }
        # Capture reasoning/thinking from non-streaming response
        reasoning = message.get('reasoning_content') or message.get('reasoning') or ''
        if reasoning:
            resp['thinking'] = reasoning
        return resp
    
    def _call_anthropic_with_tools(self, messages, tools, metadata):
        """Call Anthropic/Claude with function calling (also used by Anthropic-compatible providers like MiniMax)."""
        actual_provider = metadata.get('provider', 'anthropic')
        api_key = _resolve_remote_key(self.config, provider=actual_provider)
        if not api_key:
            display = metadata.get('display_name', actual_provider)
            raise RemoteAPIError(f"Missing API key for {display}")
        
        endpoint = metadata.get('endpoint', 'https://api.anthropic.com/v1/messages')
        model_name = metadata.get('remote_model') or 'claude-sonnet-4-5-20250929'
        version = metadata.get('anthropic_version', '2023-06-01')
        
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': version
        }
        
        # Convert OpenAI-style tools to Anthropic format
        anthropic_tools = []
        for tool in tools:
            func = tool.get('function', {})
            anthropic_tools.append({
                'name': func.get('name'),
                'description': func.get('description', ''),
                'input_schema': func.get('parameters', {'type': 'object', 'properties': {}})
            })
        
        # Convert messages format
        system_content = ""
        anthropic_messages = []
        for msg in messages:
            if msg['role'] == 'system':
                system_content += msg['content'] + "\n"
            elif msg['role'] == 'tool':
                # Convert tool result to Anthropic format
                anthropic_messages.append({
                    'role': 'user',
                    'content': [{
                        'type': 'tool_result',
                        'tool_use_id': msg.get('tool_call_id', ''),
                        'content': msg.get('content', '')
                    }]
                })
            elif msg['role'] == 'assistant' and msg.get('tool_calls'):
                # Convert assistant message with tool_calls to Anthropic format
                content_blocks = []
                if msg.get('content'):
                    content_blocks.append({'type': 'text', 'text': msg['content']})
                for tc in msg.get('tool_calls', []):
                    func = tc.get('function', {})
                    content_blocks.append({
                        'type': 'tool_use',
                        'id': tc.get('id', ''),
                        'name': func.get('name', ''),
                        'input': json.loads(func.get('arguments', '{}'))
                    })
                anthropic_messages.append({
                    'role': 'assistant',
                    'content': content_blocks
                })
            else:
                # Regular message - strip any extra fields Anthropic doesn't accept
                content = msg.get('content', '')
                # Handle multimodal content (OpenAI image_url → Anthropic image source)
                if isinstance(content, list):
                    has_image = any(isinstance(i, dict) and i.get('type') == 'image_url' for i in content)
                    if has_image:
                        logger.info(f"[ANTHROPIC] Converting multimodal user message with image to Anthropic base64 format")
                    anthropic_content = []
                    for item in content:
                        if isinstance(item, dict):
                            if item.get('type') == 'text':
                                anthropic_content.append({'type': 'text', 'text': item.get('text', '')})
                            elif item.get('type') == 'image_url':
                                url = item.get('image_url', {}).get('url', '')
                                if url.startswith('data:'):
                                    header, b64 = url.split(',', 1)
                                    mt = header.replace('data:', '').replace(';base64', '')
                                    anthropic_content.append({
                                        'type': 'image',
                                        'source': {'type': 'base64', 'media_type': mt, 'data': b64}
                                    })
                                else:
                                    anthropic_content.append({'type': 'text', 'text': f'[Image URL: {url}]'})
                        else:
                            anthropic_content.append({'type': 'text', 'text': str(item)})
                    if anthropic_content:
                        anthropic_messages.append({'role': msg['role'], 'content': anthropic_content})
                # Skip messages with empty content (Anthropic requires non-empty)
                elif content and content.strip():
                    clean_msg = {'role': msg['role'], 'content': content}
                    anthropic_messages.append(clean_msg)
        
        payload = {
            'model': model_name,
            'max_tokens': self.config.get('max_tokens', 4096),
            'system': system_content.strip(),
            'messages': anthropic_messages,
            'tools': anthropic_tools
        }
        
        # Enable extended thinking for Claude 3.7+ / Claude 4+ models
        _thinking_models = ('claude-3-7', 'claude-3.7', 'claude-4', 'claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4')
        if any(tag in model_name.lower() for tag in _thinking_models):
            payload['thinking'] = {'type': 'enabled', 'budget_tokens': min(self.config.get('max_tokens', 4096), 4096)}
            # Extended thinking requires temperature=1 and no top_p/top_k
            payload.pop('temperature', None)
            payload.pop('top_p', None)
            payload.pop('top_k', None)
            logger.info(f"[CLAUDE] Extended thinking enabled for tool-calling: {model_name}")
        
        response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
        
        if response.status_code != 200:
            raise RemoteAPIError(f"Anthropic request failed: {response.status_code} {response.text}")
        
        result = response.json()
        content_blocks = result.get('content', [])
        
        # Extract text and tool calls
        text_content = ""
        tool_calls = []
        
        thinking_content = ""
        for block in content_blocks:
            if block.get('type') == 'thinking':
                thinking_content += block.get('thinking', '')
            elif block.get('type') == 'text':
                text_content += block.get('text', '')
            elif block.get('type') == 'tool_use':
                tool_calls.append({
                    'id': block.get('id'),
                    'type': 'function',
                    'function': {
                        'name': block.get('name'),
                        'arguments': json.dumps(block.get('input', {}))
                    }
                })
        
        resp = {
            'content': text_content,
            'tool_calls': tool_calls
        }
        if thinking_content:
            resp['thinking'] = thinking_content
        return resp
    
    def _call_google_with_tools(self, messages, tools, metadata):
        """Call Google/Gemini with function calling."""
        api_key = _resolve_remote_key(self.config, provider='google')
        if not api_key:
            raise RemoteAPIError("Missing Google API key. Set GOOGLE_API_KEY environment variable.")
        
        model_name = metadata.get('remote_model', 'gemini-2.5-pro')
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        
        headers = {
            'Content-Type': 'application/json'
        }
        
        # Convert tools to Gemini format
        gemini_tools = []
        if tools:
            function_declarations = []
            for tool in tools:
                func = tool.get('function', {})
                params = func.get('parameters', {'type': 'object', 'properties': {}})
                # Sanitize schema: Gemini rejects additionalProperties and other non-standard fields
                params = {k: v for k, v in params.items() if k not in ('additionalProperties',)}
                function_declarations.append({
                    'name': func.get('name'),
                    'description': func.get('description', ''),
                    'parameters': params
                })
            gemini_tools = [{'function_declarations': function_declarations}]
        
        # Convert messages to Gemini format
        gemini_contents = []
        system_instruction = ""
        # Only the FIRST system message (the main system prompt) goes into
        # systemInstruction.  Mid-conversation system messages (goal reminders,
        # self-heal hints) are converted to user messages so they keep their
        # positional context instead of being hoisted to the top.
        first_system_seen = False
        
        for msg in messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            
            if role == 'system':
                if not first_system_seen:
                    system_instruction += content + "\n"
                    first_system_seen = True
                else:
                    gemini_contents.append({
                        'role': 'user',
                        'parts': [{'text': f"[System note] {content}"}]
                    })
            elif role == 'user':
                # Handle multimodal content (list with text + image_url)
                if isinstance(content, list):
                    has_image = any(isinstance(i, dict) and i.get('type') == 'image_url' for i in content)
                    if has_image:
                        logger.info(f"[GEMINI] Converting multimodal user message with image to Gemini inline_data format")
                    parts = []
                    for item in content:
                        if isinstance(item, dict):
                            if item.get('type') == 'text':
                                parts.append({'text': item.get('text', '')})
                            elif item.get('type') == 'image_url':
                                url = item.get('image_url', {}).get('url', '')
                                if url.startswith('data:'):
                                    # Extract mime_type and base64 from data URI
                                    header, b64 = url.split(',', 1)
                                    mt = header.replace('data:', '').replace(';base64', '')
                                    parts.append({'inline_data': {'mime_type': mt, 'data': b64}})
                                else:
                                    parts.append({'text': f'[Image URL: {url}]'})
                        else:
                            parts.append({'text': str(item)})
                    if not parts:
                        parts = [{'text': str(content)}]
                    gemini_contents.append({'role': 'user', 'parts': parts})
                else:
                    gemini_contents.append({
                        'role': 'user',
                        'parts': [{'text': content}]
                    })
            elif role == 'assistant':
                # If we have raw Gemini parts (with thoughtSignature), use them
                # verbatim — Gemini 3 requires thoughtSignature in functionCall
                # turns or it rejects with 400.
                raw_parts = msg.get('_gemini_raw_parts')
                if raw_parts:
                    gemini_contents.append({
                        'role': 'model',
                        'parts': raw_parts
                    })
                else:
                    parts = []
                    if content:
                        parts.append({'text': content})
                    # Handle tool calls in assistant message
                    for tc in msg.get('tool_calls', []):
                        func = tc.get('function', {})
                        fc_part = {
                            'functionCall': {
                                'name': func.get('name', ''),
                                'args': json.loads(func.get('arguments', '{}'))
                            }
                        }
                        parts.append(fc_part)
                    if parts:
                        gemini_contents.append({
                            'role': 'model',
                            'parts': parts
                        })
            elif role == 'tool':
                # Tool result — Gemini expects functionResponse in a user turn
                gemini_contents.append({
                    'role': 'user',
                    'parts': [{
                        'functionResponse': {
                            'name': msg.get('name', ''),
                            'response': {'result': msg.get('content', '')}
                        }
                    }]
                })
        
        # Merge consecutive same-role messages — Gemini rejects these
        merged = []
        for entry in gemini_contents:
            if merged and merged[-1]['role'] == entry['role']:
                merged[-1]['parts'].extend(entry['parts'])
            else:
                merged.append(entry)
        gemini_contents = merged
        
        # Ensure conversation starts with a user turn (Gemini requirement)
        if gemini_contents and gemini_contents[0]['role'] != 'user':
            gemini_contents.insert(0, {'role': 'user', 'parts': [{'text': '(start)'}]})
        
        # Ensure we have at least one content item
        if not gemini_contents:
            logger.warning("chat_with_tools called with empty gemini_contents, skipping silently")
            return {"content": "", "tool_calls": []}
        
        payload = {
            'contents': gemini_contents,
            'generationConfig': {
                'temperature': self.config.get('temperature', 0.7),
                'maxOutputTokens': self.config.get('max_tokens', 4096)
            }
        }
        
        if system_instruction.strip():
            payload['systemInstruction'] = {'parts': [{'text': system_instruction.strip()}]}
        
        if gemini_tools:
            payload['tools'] = gemini_tools
        
        logger.info(f"Gemini tool call payload: {len(gemini_contents)} contents, tools: {len(gemini_tools) if gemini_tools else 0}")
        # Debug: log role sequence to diagnose format errors
        role_seq = [c.get('role', '?') for c in gemini_contents]
        print(f"[GEMINI_DEBUG] Role sequence: {role_seq}", file=sys.stderr, flush=True)
        response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
        
        if response.status_code != 200:
            err_text = response.text[:500]
            print(f"[GEMINI_ERROR] Status {response.status_code}: {err_text}", file=sys.stderr, flush=True)
            raise RemoteAPIError(f"Gemini request failed: {response.status_code} {err_text}")
        
        result = response.json()
        candidates = result.get('candidates', [])
        
        if not candidates:
            return {'content': 'No response from Gemini', 'tool_calls': []}
        
        # Extract content and tool calls from first candidate
        content_parts = candidates[0].get('content', {}).get('parts', [])
        text_content = ""
        tool_calls = []
        
        for part in content_parts:
            if 'text' in part:
                text_content += part['text']
            elif 'functionCall' in part:
                fc = part['functionCall']
                tc_entry = {
                    'id': f"call_{fc.get('name', 'unknown')}_{len(tool_calls)}",
                    'type': 'function',
                    'function': {
                        'name': fc.get('name', ''),
                        'arguments': json.dumps(fc.get('args', {}))
                    }
                }
                tool_calls.append(tc_entry)
        
        # Preserve raw Gemini parts (including thoughtSignature) so they can
        # be echoed back verbatim — Gemini 3 requires thoughtSignature in
        # functionCall turns or it rejects the request with a 400.
        return {
            'content': text_content,
            'tool_calls': tool_calls,
            '_gemini_raw_parts': content_parts
        }
    
    def _call_ollama_with_tools(self, messages, tools, model_name):
        """Call Ollama with function calling via /api/chat endpoint."""
        print(f"[OLLAMA_TOOLS] *** _call_ollama_with_tools called *** model={model_name}", flush=True)
        ollama_url = self.config.get('api_base', 'http://localhost:11434')
        
        # First try native tool calling
        payload = {
            'model': model_name,
            'messages': messages,
            'tools': tools,
            'stream': False,
            'options': {
                'temperature': self.config.get('temperature', 0.7),
                'num_predict': self.config.get('max_tokens', 4096)
            }
        }
        
        response = requests.post(f"{ollama_url}/api/chat", json=payload, timeout=120)
        print(f"[OLLAMA_TOOLS] Response status: {response.status_code}", flush=True)
        
        if response.status_code == 200:
            result = response.json()
            message = result.get('message', {})
            tool_calls = message.get('tool_calls', [])
            content = message.get('content', '')
            
            print(f"[OLLAMA_TOOLS] Native tool_calls: {len(tool_calls)}, content_len: {len(content)}", flush=True)
            print(f"[OLLAMA_TOOLS] Content: {content[:200] if content else 'empty'}...", flush=True)
            
            # If we got native tool calls, use them
            if tool_calls:
                print(f"[OLLAMA_TOOLS] Using native tool calls", flush=True)
                return {
                    'content': content,
                    'tool_calls': tool_calls
                }
            
            # Otherwise, try to parse tool calls from text output
            print(f"[OLLAMA_TOOLS] No native tool calls, attempting text parsing...", flush=True)
            logger.info(f"[TOOLS] No native tool calls, attempting text parsing on content: {content[:200] if content else 'empty'}...")
            parsed_calls = self._parse_text_tool_calls(content, tools)
            if parsed_calls:
                logger.info(f"[TOOLS] Parsed {len(parsed_calls)} tool calls from text output: {[c.get('function',{}).get('name') for c in parsed_calls]}")
                return {
                    'content': content,
                    'tool_calls': parsed_calls
                }
            
            logger.info(f"[TOOLS] No tool calls parsed from text")
            return {
                'content': content,
                'tool_calls': []
            }
        
        # Fallback: try without tools parameter
        logger.warning(f"Ollama /api/chat with tools failed, trying without tools")
        payload_no_tools = {
            'model': model_name,
            'messages': messages,
            'stream': False,
            'options': {
                'temperature': self.config.get('temperature', 0.7),
                'num_predict': self.config.get('max_tokens', 4096)
            }
        }
        
        response = requests.post(f"{ollama_url}/api/chat", json=payload_no_tools, timeout=120)
        print(f"[OLLAMA_TOOLS] Fallback response status: {response.status_code}", flush=True)
        
        if response.status_code == 200:
            result = response.json()
            message = result.get('message', {})
            content = message.get('content', '')
            
            # Parse tool calls from text
            parsed_calls = self._parse_text_tool_calls(content, tools)
            return {
                'content': content,
                'tool_calls': parsed_calls
            }
        
        # Log the actual error
        print(f"[OLLAMA_TOOLS] ERROR: Ollama returned {response.status_code}: {response.text[:500]}", flush=True)
        logger.error(f"Ollama request failed: {response.status_code} - {response.text[:500]}")
        return {"content": f"Failed to get response from Ollama (status {response.status_code})", "tool_calls": []}
    
    def _parse_text_tool_calls(self, content, tools):
        """Parse tool calls from LLM text output when native function calling isn't available."""
        print(f"[PARSE_TOOLS] *** _parse_text_tool_calls called *** content_len={len(content) if content else 0}", flush=True)
        logger.info(f"[PARSE_TOOLS] Parsing content for tool calls: {content[:100] if content else 'empty'}...")
        
        if not content:
            return []
        
        tool_calls = []
        tool_names = {t['function']['name'] for t in tools} if tools else set()
        
        # Pattern 1: ```tool_code or ```powershell or ```bash blocks with commands
        import re
        
        # Look for code blocks that look like shell commands (with triple backticks)
        code_block_pattern = r'```(?:tool_code|powershell|bash|cmd|shell|sh)?\s*\n?(.*?)```'
        code_matches = re.findall(code_block_pattern, content, re.DOTALL | re.IGNORECASE)
        
        print(f"[PARSE_TOOLS] code_block_matches found: {len(code_matches)}", flush=True)
        
        for match in code_matches:
            command = match.strip()
            print(f"[PARSE_TOOLS] Code block content: {command[:100] if command else 'empty'}...", flush=True)
            if command and len(command) < 2000:  # Sanity check
                # Check if it looks like a shell command - include common PowerShell cmdlets
                if any(cmd in command.lower() for cmd in ['powershell', 'cmd', 'echo', 'dir', 'ls', 'cat', 'type', 'mkdir', 'cd', 'python', 'npm', 'git', 'curl', 'wget', 'add-type', 'invoke-', 'system.windows', 'new-item', 'get-', 'set-', 'remove-', 'start-process', 'write-host']):
                    tool_calls.append({
                        'id': f'parsed_{len(tool_calls)}',
                        'type': 'function',
                        'function': {
                            'name': 'bash',
                            'arguments': json.dumps({'command': command, 'shell': 'powershell'})
                        }
                    })
        
        # Pattern 1b: tool_code followed by command on same line (no backticks)
        # Matches: "tool_code powershell -Command ..." or "tool_code echo hello"
        inline_tool_pattern = r'(?:^|\n)\s*tool_code\s+(.+?)(?:\n|$)'
        inline_matches = re.findall(inline_tool_pattern, content, re.IGNORECASE)
        
        print(f"[PARSE_TOOLS] inline_matches found: {len(inline_matches)}", flush=True)
        
        for match in inline_matches:
            command = match.strip()
            print(f"[PARSE_TOOLS] Found command: {command[:80]}...", flush=True)
            if command and len(command) < 2000:
                # DIRECT EXECUTION TEST - execute immediately
                print(f"[PARSE_TOOLS] *** EXECUTING COMMAND DIRECTLY ***", flush=True)
                try:
                    registry = get_tool_registry()
                    result = registry.execute('bash', {'command': command, 'shell': 'powershell'})
                    print(f"[PARSE_TOOLS] Execution result: {result}", flush=True)
                except Exception as e:
                    print(f"[PARSE_TOOLS] Execution error: {e}", flush=True)
                
                tool_calls.append({
                    'id': f'parsed_{len(tool_calls)}',
                    'type': 'function',
                    'function': {
                        'name': 'bash',
                        'arguments': json.dumps({'command': command, 'shell': 'powershell'})
                    }
                })
        
        # Pattern 2: Explicit tool call format like: TOOL: bash {"command": "..."}
        tool_pattern = r'(?:TOOL|EXECUTE|RUN|CALL):\s*(\w+)\s*(\{[^}]+\})'
        tool_matches = re.findall(tool_pattern, content, re.IGNORECASE)
        
        for tool_name, args_str in tool_matches:
            if tool_name.lower() in {t.lower() for t in tool_names}:
                try:
                    args = json.loads(args_str)
                    tool_calls.append({
                        'id': f'parsed_{len(tool_calls)}',
                        'type': 'function',
                        'function': {
                            'name': tool_name,
                            'arguments': json.dumps(args)
                        }
                    })
                except json.JSONDecodeError:
                    pass
        
        # Pattern 3: Function-like syntax: bash("command") or exec("command")
        func_pattern = r'\b(bash|exec|text_editor|read_file|write_file|edit_file|grep|web_search|browser)\s*\(\s*["\']?([^)]+)["\']?\s*\)'
        func_matches = re.findall(func_pattern, content, re.IGNORECASE)
        
        for func_name, arg_content in func_matches:
            func_name_lower = func_name.lower()
            if func_name_lower in ('bash', 'exec'):
                tool_calls.append({
                    'id': f'parsed_{len(tool_calls)}',
                    'type': 'function',
                    'function': {
                        'name': 'bash',
                        'arguments': json.dumps({'command': arg_content.strip('\'"')})
                    }
                })
            elif func_name_lower == 'read_file':
                tool_calls.append({
                    'id': f'parsed_{len(tool_calls)}',
                    'type': 'function',
                    'function': {
                        'name': 'text_editor',
                        'arguments': json.dumps({'action': 'read', 'path': arg_content.strip('\'"')})
                    }
                })
        
        return tool_calls
    
    def approve_tool_execution(self, tool_call_id):
        """Approve a pending tool execution and resume the tool loop."""
        pending = getattr(self, '_pending_tool_calls', {})
        if tool_call_id not in pending:
            return {"status": "error", "error": "Tool call not found or expired"}
        
        call_data = pending.pop(tool_call_id)
        tool_name = call_data['tool_name']
        tool_args = call_data['tool_args']
        messages = call_data['messages']
        tool_call = call_data['tool_call']
        content = call_data['content']
        
        # Execute the tool
        registry = get_tool_registry()
        result = registry.execute(tool_name, tool_args)
        
        send_message_to_frontend({
            "status": "tool_result",
            "tool": tool_name,
            "result": result,
            "message": f"✅ {tool_name} executed (approved)"
        })
        
        # If tool returned an image, send a dedicated image message for inline rendering
        if isinstance(result, dict) and result.get('success') and (result.get('image_base64') or result.get('image_url')):
            send_message_to_frontend({
                "type": "image",
                "image_url": result.get('image_base64') or result.get('image_url', ''),
                "caption": result.get('revised_prompt', '') or result.get('caption', 'Generated image'),
            })
        
        # Add tool call + result to the saved messages
        messages.append({
            "role": "assistant",
            "content": content,
            "tool_calls": [tool_call]
        })
        
        observation = self._create_tool_observation(tool_name, tool_args, result)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "content": observation
        })
        
        # Update tool history
        tool_history = call_data.get('tool_history', [])
        # Replace the pending_approval entry with the actual result
        for entry in tool_history:
            if entry.get('tool') == tool_name and entry.get('result', {}).get('status') == 'pending_approval':
                entry['result'] = result
                entry['auto_executed'] = False
                break
        else:
            tool_history.append({
                "tool": tool_name,
                "args": tool_args,
                "result": result,
                "auto_executed": False
            })
        
        # Resume the tool loop with full saved state via chat_with_tools
        resume_state = {
            'messages': messages,
            'tool_history': tool_history,
            'tool_schemas': call_data.get('tool_schemas', registry.get_schemas_for_llm()),
            'round_count': call_data.get('round_count', 1),
            'max_tool_rounds': call_data.get('max_tool_rounds', 50),
            'original_task': call_data.get('original_task', self.current_task or ''),
            'auto_continue_count': call_data.get('auto_continue_count', 0),
            'model_override': call_data.get('model_override'),
            'auto_execute': call_data.get('auto_execute', self.config.get('tools_auto_execute', False)),
        }
        return self.chat_with_tools(
            message=resume_state['original_task'],
            model_override=resume_state['model_override'],
            auto_execute=resume_state['auto_execute'],
            max_tool_rounds=resume_state['max_tool_rounds'],
            _resume_state=resume_state,
        )
    
    def deny_tool_execution(self, tool_call_id, reason="User denied"):
        """Deny a pending tool execution and resume the loop so the agent can adapt."""
        pending = getattr(self, '_pending_tool_calls', {})
        if tool_call_id not in pending:
            return {"status": "error", "error": "Tool call not found or expired"}
        
        call_data = pending.pop(tool_call_id)
        tool_name = call_data['tool_name']
        messages = call_data['messages']
        content = call_data['content']
        tool_call = call_data['tool_call']
        
        send_message_to_frontend({
            "status": "tool_denied",
            "tool": tool_name,
            "message": f"❌ {tool_name} execution denied: {reason}"
        })
        
        # Inject the denial as a tool result so the agent knows and can adapt
        messages.append({
            "role": "assistant",
            "content": content,
            "tool_calls": [tool_call]
        })
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "content": json.dumps({
                "status": "denied",
                "error": f"User denied execution of '{tool_name}': {reason}. Try a different approach or ask the user what they'd prefer."
            })
        })
        
        # Update tool history
        tool_history = call_data.get('tool_history', [])
        for entry in tool_history:
            if entry.get('tool') == tool_name and entry.get('result', {}).get('status') == 'pending_approval':
                entry['result'] = {"status": "denied", "reason": reason}
                break
        
        # Resume the loop so the agent can try something else
        registry = get_tool_registry()
        resume_state = {
            'messages': messages,
            'tool_history': tool_history,
            'tool_schemas': call_data.get('tool_schemas', registry.get_schemas_for_llm()),
            'round_count': call_data.get('round_count', 1),
            'max_tool_rounds': call_data.get('max_tool_rounds', 50),
            'original_task': call_data.get('original_task', self.current_task or ''),
            'auto_continue_count': call_data.get('auto_continue_count', 0),
            'model_override': call_data.get('model_override'),
            'auto_execute': call_data.get('auto_execute', self.config.get('tools_auto_execute', False)),
        }
        return self.chat_with_tools(
            message=resume_state['original_task'],
            model_override=resume_state['model_override'],
            auto_execute=resume_state['auto_execute'],
            max_tool_rounds=resume_state['max_tool_rounds'],
            _resume_state=resume_state,
        )

    def chat_response(self, message, image_data=None, override_messages=None, model_override=None):
        """Generate chat response"""
        # Gate: wait for LLM backend to be reachable before first call
        if not self._api_ready:
            if not self._wait_for_api(timeout=30):
                error_msg = "The AI backend isn't available yet — still starting up. Try again in a moment."
                send_message_to_frontend({
                    'status': 'done',
                    'result': error_msg,
                    'messages': [
                        {'role': 'user', 'content': str(message)[:100]},
                        {'role': 'assistant', 'content': error_msg}
                    ],
                    'clear_thinking': True
                })
                return None
        try:
            # Vision fallback: if image attached and current model lacks vision, swap to fallback
            if image_data and not model_override:
                current_model = self.config.get('model', 'llama3.2-vision:11b')
                current_provider = _resolve_model_metadata(current_model).get('provider', 'ollama')
                if current_provider not in _VISION_PROVIDERS:
                    fallback = self.config.get('vision_fallback_model', 'gemini-2.5-flash')
                    if _resolve_model_metadata(fallback).get('provider') in _VISION_PROVIDERS:
                        logger.info(f"[CHAT] Vision fallback: '{current_model}' lacks vision, using '{fallback}' for this image call")
                        model_override = fallback
            
            logger.info(f"[CHAT] chat_response called with model={self.config.get('model')}, message={str(message)[:50]}...")
            # Treat renderer control pings (e.g., '/config') as non-chat
            control_message = False
            if isinstance(message, str):
                msg_norm = message.strip().lower()
                if msg_norm in {"/config", "config", "/settings", "settings"}:
                    control_message = True
                    logger.info("Ignoring control message in chat_response: %s", message)
                    return {
                        "status": "info",
                        "result": "",
                        "suppress_chat": True
                    }

            # Get recent context if no override messages
            context = ""
            if not override_messages and not image_data:
                context = self.get_recent_context(message)
                logger.info(f"Retrieved context for chat: {len(context)} characters")
                logger.debug(f"Context content: {context[:200]}...")

            # Check for highlighted text to add as additional context
            highlighted_text = None
            if not image_data and hasattr(self, 'context_assistant_updater'):
                highlighted_text = self.context_assistant_updater.get_highlighted_text()
                if highlighted_text:
                    logger.info(f"Using highlighted text as additional context: {highlighted_text[:50]}...")

            # --- SONAR INTEGRATION (reactive only) ---
            # Search happens AFTER model responds if it indicates lack of knowledge
            sonar_used = False
            sonar_content = None
            # --- SONAR INTEGRATION END ---

            messages = override_messages if override_messages is not None else []
            if not override_messages:
                # Unified system prompt (identity, workspace, memory recall — no tools for chat mode)
                system_prompt = build_system_prompt(
                    config=self.config,
                    tool_registry=None,
                    workspace_dir=os.path.join(os.path.dirname(__file__), 'workspace'),
                    include_tools=False,
                    include_skills=False,
                    include_memory=True,
                    include_circuits=False,
                )
                # Fold user facts into system prompt
                try:
                    from src.tools.memory_tool import get_user_facts
                    user_facts = get_user_facts()
                    if user_facts:
                        system_prompt += f"\n\n## User Facts\n{user_facts}"
                except Exception:
                    pass
                if context and not image_data:
                    system_prompt += f"\n\n## Recent Context\n{context}"
                messages.append({
                    "role": "system",
                    "content": system_prompt
                })
                if image_data:
                    messages.append({
                        "role": "system",
                        "content": self.config.get("screenshot_prompt", "respond to what you see in less than 20 words. Respond naturally. Randomly decide to either troll the user, ask a question about what you see or make a general comment.")
                    })
                if highlighted_text:
                    messages.append({
                        "role": "system",
                        "content": f"The user has highlighted the following text that you should use as context for answering their question:\n\n{highlighted_text}"
                    })
                if isinstance(message, str):
                    if image_data:
                        processed_image = self.process_image(image_data)
                        logger.info(f"Processed image format: {'starts with data:image' if isinstance(processed_image, str) and processed_image.startswith('data:image') else 'raw base64'}")
                        if processed_image:
                            if not isinstance(processed_image, str) or not processed_image.startswith('data:image'):
                                processed_image = f"data:image/jpeg;base64,{processed_image}"
                        ts = datetime.now().strftime("[%b %d, %Y %I:%M %p]")
                        messages.append({
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"{ts} {message}"},
                                {"type": "image_url", "image_url": {"url": processed_image}}
                            ]
                        })
                    else:
                        ts = datetime.now().strftime("[%b %d, %Y %I:%M %p]")
                        messages.append({
                            "role": "user",
                            "content": f"{ts} {message}"
                        })
                else:
                    messages.extend(message)

            # If Sonar was used and returned content, prepend it as context for the LLM
            if sonar_used and sonar_content:
                user_msg_idx = None
                for i in range(len(messages)-1, -1, -1):
                    if messages[i].get('role') == 'user':
                        user_msg_idx = i
                        break
                if user_msg_idx is not None:
                    messages.insert(user_msg_idx, {
                        "role": "system",
                        "content": f"Here is the most up-to-date information I found for the user's query, provided by Sonar:\n{sonar_content}"
                    })

            # === Restore streaming and response logic (with overflow recovery) ===
            full_response = ""
            last_sent = 0
            _overflow_retried = False
            
            def _stream_and_collect(msgs):
                nonlocal full_response, last_sent
                full_response = ""
                last_sent = 0
                _thinking_started = False
                for chunk in self.stream_response(msgs, model_override=model_override):
                    # Handle thinking tuples from providers
                    if isinstance(chunk, tuple) and chunk[0] == 'thinking':
                        thinking_text = chunk[1]
                        if not _thinking_started:
                            _thinking_started = True
                            send_message_to_frontend({
                                "type": "thinking_start"
                            })
                        send_message_to_frontend({
                            "type": "thinking_delta",
                            "content": thinking_text
                        })
                        continue
                    # Regular text — if we were thinking, signal transition
                    if _thinking_started:
                        _thinking_started = False
                        send_message_to_frontend({
                            "type": "thinking_end"
                        })
                    full_response += chunk
                    new_text = full_response[last_sent:]
                    if new_text:
                        send_message_to_frontend({
                            "status": "streaming",
                            "result": new_text
                        })
                        last_sent = len(full_response)
                    time.sleep(0.01)
                # Safety: close thinking panel if stream ended mid-thinking
                if _thinking_started:
                    send_message_to_frontend({"type": "thinking_end"})
            
            try:
                _stream_and_collect(messages)
            except Exception as _stream_err:
                _err_str = str(_stream_err).lower()
                _is_overflow = any(p in _err_str for p in [
                    'context length', 'context_length', 'too long', 'max_tokens',
                    'maximum context', 'token limit', 'context window',
                    'prompt is too long', 'request too large', 'input too long',
                ])
                if _is_overflow and not _overflow_retried:
                    _overflow_retried = True
                    logger.warning(f"[CHAT] Context overflow in chat_response — auto-compacting and retrying: {str(_stream_err)[:200]}")
                    send_message_to_frontend({
                        "status": "streaming",
                        "result": "\n⟳ Context too large — compacting and retrying...\n"
                    })
                    messages = self._compact_messages(messages, max_tokens=32000)
                    _stream_and_collect(messages)
                else:
                    raise

            # Only add real user prompts to memory (skip control/IPC pings)
            if not control_message:
                if image_data:
                    self.add_to_memory(
                        message, full_response, self.config.get('model'),
                        memory_type=MemoryType.SCREENSHOT if 'screenshot' in (message or '').lower() else MemoryType.VISION,
                        metadata={'image_description': full_response, 'source': 'chat_with_image'}
                    )
                else:
                    self.add_to_memory(message, full_response, self.config.get('model'))

            if self.config.get("auto_paste", False) and not image_data:
                time.sleep(3)
                pyperclip.copy(full_response)
                pyautogui.hotkey('ctrl', 'v')
                pyautogui.press('enter')

            # --- Knowledge cutoff Sonar fallback (for ALL models) ---
            # Check BEFORE sending final response so we can replace it with search results
            knowledge_cutoff_phrases = [
                # Core: No access to real-time/current data
                "don't have access to real-time",
                "do not have access to real-time",
                "can't browse the internet",
                "cannot browse the internet",
                # Core: Knowledge limitations - these WILL match Claude's response
                "my knowledge has cutoff",  # matches "my knowledge has cutoffs"
                "knowledge cutoff",
                "i don't have any current",  # matches "I don't have any current information"
                "i do not have any current",
                "don't have current information",
                "do not have current information",
                # Core: Can't tell/provide
                "i can't tell you",
                "i cannot tell you", 
                # Core: Suggesting user look elsewhere
                "you'd need to",
                "you would need to",
                "you'll need to",
                # Claude-specific phrases
                "i don't have access to",
                "i do not have access to",
                "i'm not able to",
                "i am not able to",
                "i can't access",
                "i cannot access",
                "i'm unable to",
                "i am unable to",
            ]
            response_lower = full_response.lower()
            matched_phrase = next((p for p in knowledge_cutoff_phrases if p in response_lower), None)
            
            # Debug: Print VERY visible markers
            print("\n" + "="*60, file=sys.stderr)
            print(">>> KNOWLEDGE GAP CHECK <<<", file=sys.stderr)
            print(f">>> Matched: {matched_phrase}", file=sys.stderr)
            print(f">>> API key set: {bool(self.config.get('perplexity_api_key'))}", file=sys.stderr)
            print("="*60 + "\n", file=sys.stderr)
            
            # If knowledge cutoff detected and Perplexity available, search and re-respond
            if matched_phrase and not sonar_used and self.config.get('perplexity_api_key'):
                logger.info(f"[KNOWLEDGE CUTOFF] Detected phrase: '{matched_phrase}' in response")
                print(f"[KNOWLEDGE CUTOFF] Triggered by: '{matched_phrase}'")
                try:
                    # Tell frontend we're searching (this signals to replace the previous response)
                    send_message_to_frontend({
                        "status": "searching",
                        "result": "\n\n🔍 *Searching for current information...*",
                        "replace_last": True
                    })
                    
                    sonar_handler = SonarHandler(
                        api_key=self.config.get('perplexity_api_key'),
                        config=self.config
                    )
                    print(f">>> SONAR: Calling with query: {message[:50]}...", file=sys.stderr)
                    sonar_result = sonar_handler.get_sonar_response(
                        message,
                        model=self.config.get('perplexity_model', 'sonar'),
                        temperature=self.config.get('temperature', 0.7),
                        max_tokens=1024
                    )
                    print(f">>> SONAR: Result success={sonar_result.get('success')}, has_content={bool(sonar_result.get('content'))}", file=sys.stderr)
                    if not sonar_result.get('success'):
                        print(f">>> SONAR: Error - {sonar_result.get('error', 'unknown')}", file=sys.stderr)
                    if sonar_result.get('success') and sonar_result.get('content'):
                        sonar_content = sonar_result['content']
                        logger.info("Knowledge cutoff detected - feeding Sonar results to LLM")
                        
                        # Build messages with Sonar context for LLM processing
                        fallback_messages = []
                        if self.config.get("system_prompt"):
                            fallback_messages.append({
                                "role": "system",
                                "content": self.config["system_prompt"]
                            })
                        fallback_messages.append({
                            "role": "system",
                            "content": f"Here is the most up-to-date information I found for the user's query:\n{sonar_content}\n\nUse this information to answer the user's question naturally. Do not say you don't have access to information - you now have it."
                        })
                        fallback_messages.append({
                            "role": "user",
                            "content": message
                        })
                        
                        # Stream the LLM-processed response (this replaces the "I don't know" response)
                        fallback_response = ""
                        for chunk in self.stream_response(fallback_messages):
                            fallback_response += chunk
                            send_message_to_frontend({
                                "status": "streaming",
                                "result": chunk,
                                "replace_last": True  # Keep replacing until done
                            })
                        
                        # Send the REPLACEMENT response with search results (no raw sources - Perplexity only gives numbers)
                        send_message_to_frontend({
                            "status": "done",
                            "result": fallback_response,
                            "messages": [
                                {"role": "user", "content": message},
                                {"role": "assistant", "content": fallback_response}
                            ],
                            "new_message": False,  # Don't create new message, replace existing
                            "replace_last": True,
                            "clear_thinking": True,
                            "speak": True,
                            "rich_text": True
                        })
                        # Don't send the original "I don't know" response
                        return None
                except Exception as e:
                    logger.error(f"Sonar fallback failed: {e}")
                    # Fall through to send original response
            
            # If Sonar was used earlier, just use the response (no raw sources - Perplexity only gives numbers)
            final_response = full_response

            # Check if the response contains HTML content
            html_content = self.detect_html_content(final_response)
            
            # Send the final response to frontend
            send_message_to_frontend({
                "status": "done",
                "result": final_response,
                "messages": [
                    {"role": "user", "content": message},
                    {"role": "assistant", "content": final_response}
                ],
                "new_message": True,
                "clear_thinking": True,
                "speak": True,
                "rich_text": True,
                "html_content": html_content
            })
            # Return a marker dict so callers know we already sent the response
            # This prevents duplicate sends from api_input fallback
            return {"_handled": True, "status": "done", "result": final_response}

        except Exception as e:
            error_msg = f"Error in chat_response: {str(e)}"
            logger.error(error_msg)
            print(error_msg, file=sys.stderr)
            send_message_to_frontend({
                "status": "error",
                "result": error_msg,
                "clear_thinking": True
            })
            return {"_handled": True, "status": "error", "result": error_msg}

    def detect_html_content(self, text):
        """Detect if the response contains HTML content"""
        if not text:
            return False
            
        # Check for HTML code blocks with various formats
        html_patterns = [
            r'```html\s*([\s\S]*?)\s*```',  # Standard markdown code block
            r'``html\s*([\s\S]*?)\s*`',     # Double backtick variant
            r'`html\s*([\s\S]*?)\s*`',      # Single backtick variant
            r'html\s*([\s\S]*?)(?=\n\n|$)'   # Just the word 'html' followed by content
        ]
        
        for pattern in html_patterns:
            matches = re.findall(pattern, text, re.DOTALL)
            for match in matches:
                # Check if we have valid HTML content
                if match and ('<' in match or '>' in match):
                    return True
                    
        return False
        
    def _stream_remote_provider(self, provider, model_name, metadata, system_prompt, user_prompt, temperature, max_tokens, image_data=None):
        display_name = metadata.get('display_name', model_name)
        logger.info(f"[REMOTE] Resolving API key for provider={provider}, model={model_name}")
        api_key = _resolve_remote_key(self.config, model_name=model_name, provider=provider)
        if not api_key:
            logger.error(f"[REMOTE] No API key found for {display_name}")
            raise RemoteAPIError(f"⚠️ Missing API key for {display_name}. Add it in Settings → API.")
        logger.info(f"[REMOTE] API key resolved (length={len(api_key)})")

        if provider == 'xai':
            # Grok 4 supports multimodal (images)
            yield from self._stream_remote_xai(metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=image_data)
        elif provider == 'anthropic':
            # Claude supports images via vision API
            yield from self._stream_remote_anthropic(metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=image_data)
        elif provider == 'google':
            # Gemini supports multimodal
            yield from self._stream_remote_google(metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=image_data)
        elif provider == 'minimax':
            # MiniMax uses Anthropic-compatible API
            yield from self._stream_remote_anthropic(metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=image_data)
        elif provider == 'openai':
            # OpenAI uses the same chat completions format as xAI/Grok
            yield from self._stream_remote_xai(metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=image_data)
        else:
            raise RemoteAPIError(f"Unsupported remote provider: {provider}")

    def _collect_text(self, content):
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    if 'text' in block and isinstance(block['text'], str):
                        parts.append(block['text'])
                    elif 'content' in block:
                        parts.append(self._collect_text(block['content']))
                elif isinstance(block, str):
                    parts.append(block)
            return ''.join(parts)
        if isinstance(content, dict):
            if 'text' in content and isinstance(content['text'], str):
                return content['text']
            if 'content' in content:
                return self._collect_text(content['content'])
        return str(content)

    def _stream_remote_xai(self, metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=None):
        endpoint = metadata.get('endpoint')
        model_name = metadata.get('remote_model') or metadata.get('model') or 'grok-latest'
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        }

        messages = []
        if system_prompt:
            messages.append({'role': 'system', 'content': system_prompt})

        # Build user message content - support multimodal (Grok 4)
        if image_data:
            # Ensure proper data URI format for the image
            if not image_data.startswith('data:image'):
                image_data = f"data:image/jpeg;base64,{image_data}"
            user_content = [
                {'type': 'image_url', 'image_url': {'url': image_data}},
                {'type': 'text', 'text': user_prompt}
            ]
            messages.append({'role': 'user', 'content': user_content})
            logger.info(f"Sending multimodal request to Grok with image ({len(image_data)} chars)")
        else:
            messages.append({'role': 'user', 'content': user_prompt})

        payload = {
            'model': model_name,
            'messages': messages,
            'stream': True,
            'temperature': temperature,
            'max_tokens': max_tokens
        }

        logger.info(f"Routing request to Grok endpoint {endpoint} with model {model_name}")
        response = requests.post(endpoint, headers=headers, json=payload, stream=True, timeout=120)

        if response.status_code != 200:
            try:
                error_payload = response.json()
                message = error_payload.get('error', {}).get('message') or error_payload
            except Exception:
                message = response.text
            display = metadata.get('display_name', metadata.get('provider', 'Remote'))
            raise RemoteAPIError(f"{display} request failed: {response.status_code} {message}")

        content_type = response.headers.get('Content-Type', '')
        is_stream = 'text/event-stream' in content_type.lower()

        if is_stream:
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                    
                data_line = line.strip()
                if not data_line:
                    continue
                if data_line.startswith('data:'):
                    data_line = data_line[5:].strip()
                if data_line in ('[DONE]', '[done]'):
                    break
                try:
                    payload = json.loads(data_line)
                except json.JSONDecodeError:
                    continue

                choices = payload.get('choices') or []
                if not choices:
                    continue
                first_choice = choices[0]
                delta = first_choice.get('delta') or {}
                # Capture reasoning/thinking tokens (DeepSeek-R1, o3, Grok reasoning)
                reasoning = delta.get('reasoning_content') or delta.get('reasoning') or ''
                if reasoning:
                    yield ('thinking', reasoning)
                text = self._collect_text(delta.get('content'))
                if not text and 'message' in first_choice:
                    text = self._collect_text(first_choice['message'].get('content'))
                if text:
                    for chunk in _chunk_text(text):
                        yield chunk
        else:
            try:
                result = response.json()
            except Exception as exc:
                raise RemoteAPIError(f"Unexpected Grok response: {exc}")

            choices = result.get('choices') or []
            if not choices:
                raise RemoteAPIError(f"Grok response missing choices: {result}")
            message = choices[0].get('message') or {}
            text = self._collect_text(message.get('content'))
            if not text:
                text = self._collect_text(choices[0].get('delta', {}).get('content'))
            if not text:
                raise RemoteAPIError(f"Grok response missing content: {result}")
            for chunk in _chunk_text(text):
                yield chunk

    def _stream_remote_anthropic(self, metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=None):
        endpoint = metadata.get('endpoint')
        model_name = metadata.get('remote_model') or metadata.get('model') or 'claude-sonnet-4-5-20250929'
        version = metadata.get('anthropic_version', '2023-06-01')

        headers = {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': version,
            'accept': 'application/json'
        }

        # Build user message content - support multimodal (Claude vision)
        if image_data:
            # Claude expects base64 image in specific format
            # Extract media type and base64 data from data URI
            if image_data.startswith('data:image'):
                # Parse data URI: data:image/png;base64,<data>
                parts = image_data.split(',', 1)
                if len(parts) == 2:
                    media_type_part = parts[0]  # data:image/png;base64
                    base64_data = parts[1]
                    # Extract media type (e.g., image/png)
                    media_type = media_type_part.replace('data:', '').replace(';base64', '')
                else:
                    media_type = 'image/jpeg'
                    base64_data = image_data
            else:
                media_type = 'image/jpeg'
                base64_data = image_data
            
            user_content = [
                {
                    'type': 'image',
                    'source': {
                        'type': 'base64',
                        'media_type': media_type,
                        'data': base64_data
                    }
                },
                {'type': 'text', 'text': user_prompt}
            ]
            logger.info(f"Sending multimodal request to Claude with image ({len(base64_data)} chars)")
        else:
            user_content = [{'type': 'text', 'text': user_prompt}]

        payload = {
            'model': model_name,
            'max_tokens': min(max_tokens, 8192),
            'temperature': temperature,
            'messages': [
                {
                    'role': 'user',
                    'content': user_content
                }
            ],
            'stream': True
        }

        if system_prompt:
            payload['system'] = system_prompt

        # Enable extended thinking for Claude 3.7+ / Claude 4+ models
        _thinking_models = ('claude-3-7', 'claude-3.7', 'claude-4', 'claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4')
        if any(tag in model_name.lower() for tag in _thinking_models):
            payload['thinking'] = {'type': 'enabled', 'budget_tokens': min(max_tokens, 4096)}
            # Extended thinking requires temperature=1 and no top_p/top_k
            payload['temperature'] = 1
            payload.pop('top_p', None)
            payload.pop('top_k', None)
            logger.info(f"[CLAUDE] Extended thinking enabled for {model_name}")

        logger.info(f"Routing request to Claude endpoint {endpoint} with model {model_name}")
        logger.info(f"Claude payload: {json.dumps({k: v for k, v in payload.items() if k != 'messages'})}")
        response = requests.post(endpoint, headers=headers, json=payload, stream=True, timeout=120)
        logger.info(f"Claude response status: {response.status_code}, headers: {dict(response.headers)}")

        if response.status_code != 200:
            try:
                error_payload = response.json()
                message = error_payload.get('error', {}).get('message') or error_payload
            except Exception:
                message = response.text
            raise RemoteAPIError(f"Claude request failed: {response.status_code} {message}")

        content_type = response.headers.get('Content-Type', '')
        is_stream = 'text/event-stream' in content_type.lower()
        logger.info(f"Claude content-type: {content_type}, is_stream: {is_stream}")

        if is_stream:
            event_count = 0
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                data_line = line.strip()
                if not data_line:
                    continue
                # Handle SSE event: prefix
                if data_line.startswith('event:'):
                    continue
                if data_line.startswith('data:'):
                    data_line = data_line[5:].strip()
                if data_line in ('[DONE]', '[done]'):
                    break
                try:
                    event = json.loads(data_line)
                    event_count += 1
                    if event_count <= 3:
                        logger.info(f"Claude event #{event_count}: {event.get('type')}")
                except json.JSONDecodeError:
                    logger.warning(f"Claude JSON decode failed for: {data_line[:100]}")
                    continue

                event_type = event.get('type')
                if event_type == 'content_block_delta':
                    delta = event.get('delta') or {}
                    delta_type = delta.get('type', '') if isinstance(delta, dict) else ''
                    # Thinking tokens (extended thinking)
                    if delta_type == 'thinking_delta':
                        thinking_text = delta.get('thinking', '')
                        if thinking_text:
                            yield ('thinking', thinking_text)
                        continue
                    text = delta.get('text') if isinstance(delta, dict) else None
                    if not text and delta_type == 'text_delta':
                        text = delta.get('text')
                    if not text and delta_type == 'output_text_delta':
                        text = delta.get('text')
                    if text:
                        for chunk in _chunk_text(text):
                            yield chunk
                elif event_type == 'message':
                    text = self._collect_text(event.get('content', []))
                    if text:
                        for chunk in _chunk_text(text):
                            yield chunk
        else:
            try:
                result = response.json()
            except Exception as exc:
                raise RemoteAPIError(f"Unexpected Claude response: {exc}")

            content_blocks = result.get('content', [])
            text = self._collect_text(content_blocks)
            if not text:
                raise RemoteAPIError(f"Claude response missing content: {result}")
            for chunk in _chunk_text(text):
                yield chunk

    def _stream_remote_google(self, metadata, api_key, system_prompt, user_prompt, temperature, max_tokens, image_data=None):
        """Stream response from Google/Gemini API."""
        model_name = metadata.get('remote_model', 'gemini-2.5-pro')
        
        # Use streaming endpoint
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:streamGenerateContent?key={api_key}"
        
        headers = {
            'Content-Type': 'application/json'
        }
        
        # Build content parts
        parts = []
        
        # Add image if provided
        if image_data:
            if image_data.startswith('data:image'):
                # Parse data URI
                uri_parts = image_data.split(',', 1)
                if len(uri_parts) == 2:
                    media_type_part = uri_parts[0]
                    base64_data = uri_parts[1]
                    media_type = media_type_part.replace('data:', '').replace(';base64', '')
                else:
                    media_type = 'image/jpeg'
                    base64_data = image_data
            else:
                media_type = 'image/jpeg'
                base64_data = image_data
            
            parts.append({
                'inline_data': {
                    'mime_type': media_type,
                    'data': base64_data
                }
            })
            logger.info(f"Sending multimodal request to Gemini with image")
        
        # Add text prompt - ensure it's not empty
        if user_prompt and user_prompt.strip():
            parts.append({'text': user_prompt})
        
        # Ensure we have at least one part
        if not parts:
            logger.warning("chat_response called with no text and no image, skipping")
            return None
        
        payload = {
            'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {
                'temperature': temperature,
                'maxOutputTokens': max_tokens
            }
        }
        
        if system_prompt:
            payload['systemInstruction'] = {'parts': [{'text': system_prompt}]}
        
        logger.info(f"Routing request to Gemini endpoint with model {model_name}")
        logger.info(f"Gemini payload contents: {len(payload.get('contents', []))} items, parts: {len(parts)}")
        response = requests.post(endpoint, headers=headers, json=payload, stream=True, timeout=120)
        logger.info(f"Gemini response status: {response.status_code}")
        
        if response.status_code != 200:
            try:
                error_payload = response.json()
                message = error_payload.get('error', {}).get('message') or error_payload
            except Exception:
                message = response.text
            raise RemoteAPIError(f"Gemini request failed: {response.status_code} {message}")
        
        # Gemini streams as JSON array chunks
        buffer = ""
        for chunk in response.iter_content(chunk_size=1024, decode_unicode=True):
            if not chunk:
                continue
            buffer += chunk
            
            # Try to parse complete JSON objects from buffer
            # Gemini returns array of candidates, we look for text parts
            try:
                # Handle streaming format - each line may be a JSON object
                lines = buffer.split('\n')
                buffer = lines[-1]  # Keep incomplete line in buffer
                
                for line in lines[:-1]:
                    line = line.strip()
                    if not line or line == '[' or line == ']' or line == ',':
                        continue
                    
                    # Remove leading comma if present
                    if line.startswith(','):
                        line = line[1:].strip()
                    
                    try:
                        obj = json.loads(line)
                        candidates = obj.get('candidates', [])
                        for candidate in candidates:
                            content = candidate.get('content', {})
                            for part in content.get('parts', []):
                                # Gemini 2.5 thinking/thought parts
                                if part.get('thought') is True and 'text' in part:
                                    yield ('thinking', part['text'])
                                elif 'text' in part:
                                    text = part['text']
                                    for text_chunk in _chunk_text(text):
                                        yield text_chunk
                    except json.JSONDecodeError:
                        continue
            except Exception as e:
                logger.warning(f"Gemini stream parse error: {e}")
                continue
        
        # Process any remaining buffer
        if buffer.strip() and buffer.strip() not in ['[', ']', ',']:
            try:
                if buffer.strip().startswith(','):
                    buffer = buffer.strip()[1:]
                obj = json.loads(buffer.strip())
                candidates = obj.get('candidates', [])
                for candidate in candidates:
                    content = candidate.get('content', {})
                    for part in content.get('parts', []):
                        if 'text' in part:
                            text = part['text']
                            for text_chunk in _chunk_text(text):
                                yield text_chunk
            except json.JSONDecodeError:
                pass

    def _post_stream_actions(self, user_message, full_response):
        """Persist streamed output for legacy and advanced memory systems."""
        try:
            if not full_response:
                return

            timestamp = time.time()

            try:
                if hasattr(self, 'memory') and isinstance(self.memory, list):
                    self.memory.insert(0, {
                        'timestamp': timestamp,
                        'user_message': user_message,
                        'assistant_response': full_response
                    })
                    if len(self.memory) > 100:
                        self.memory = self.memory[:100]
                    self.save_memory()
            except Exception as _le:
                logger.error(f"Error writing to legacy memory: {_le}")

            try:
                if hasattr(self, 'memory_manager') and self.memory_manager:
                    content = f"User: {user_message}\nAssistant: {full_response}"
                    metadata = {
                        'timestamp': timestamp,
                        'user_message': user_message,
                        'assistant_response': full_response,
                        'source': 'stream_response'
                    }
                    self.memory_manager.add_memory(content, f"Model: {self.config.get('model')}", metadata)
            except Exception as _me:
                logger.error(f"Error updating advanced memory system: {_me}")

        except Exception as _pe:
            logger.error(f"Error in post-stream persistence: {_pe}")


    def stream_response(self, messages, model_override=None):
        """Stream response from API"""
        user_message = messages[-1]['content'] if messages and messages[-1]['role'] == 'user' else ""

        # Extract system prompt and user message
        # Concatenate ALL system messages to preserve conversation context
        system_prompts = []
        user_message = ""
        image_data = None

        for msg in messages:
            if msg["role"] == "system":
                system_prompts.append(msg["content"])
            elif msg["role"] == "user":
                if isinstance(msg["content"], list):
                    for content in msg["content"]:
                        if content["type"] == "text":
                            user_message = content["text"]
                        elif content["type"] == "image_url":
                            image_url = content["image_url"]["url"]
                            if image_url.startswith('data:image'):
                                image_data = image_url.split(',')[1]
                            else:
                                image_data = image_url
                else:
                    user_message = msg["content"]

        # Combine all system prompts into one string
        system_prompt = "\n\n".join(system_prompts) if system_prompts else ""
        
        model_to_use = model_override if model_override else self.config.get("model", "llama3.2-vision:11b")
        logger.info(f"[MODEL USAGE] Using model: {model_to_use} for streaming response")
        logger.info(f"[CONTEXT] System prompt length: {len(system_prompt)} chars, includes {len(system_prompts)} system messages")

        full_response = ""

        try:
            model_metadata = _resolve_model_metadata(model_to_use)
            provider = model_metadata.get('provider', 'ollama')
            logger.info(f"[MODEL USAGE] Provider for {model_to_use}: {provider}, metadata keys: {list(model_metadata.keys())}")

            if provider != 'ollama':
                for chunk in self._stream_remote_provider(
                    provider,
                    model_to_use,
                    model_metadata,
                    system_prompt,
                    user_message,
                    self.config.get("temperature", 0.7),
                    self.config.get("max_tokens", 16384),
                    image_data=image_data
                ):
                    if chunk:
                        # Thinking tuples pass through without accumulating into full_response
                        if isinstance(chunk, tuple) and chunk[0] == 'thinking':
                            yield chunk
                        else:
                            full_response += chunk
                            yield chunk
            else:
                if not os.environ.get('SKIP_OLLAMA_CHECK', False):
                    ollama_url = self.config.get('api_base', 'http://localhost:11434')
                    try:
                        response = requests.get(f"{ollama_url}/api/tags", timeout=1)
                        if response.status_code != 200:
                            self.send_error_response("⚠️ Cannot connect to Ollama. Please make sure Ollama is running and try again.", user_message)
                            return
                    except Exception as e:
                        logger.warning(f"Ollama connection check failed: {str(e)}")
                        self.send_error_response(f"⚠️ Cannot connect to Ollama: {str(e)}. Please make sure Ollama is running and try again.", user_message)
                        return

                try:
                    context_block = self.get_recent_context(user_message)
                except Exception:
                    context_block = ""
                final_prompt = user_message
                if context_block:
                    final_prompt = f"{context_block}\nUser: {user_message}\nAssistant:"

                payload = {
                    "model": model_to_use,
                    "stream": True,
                    "prompt": final_prompt,
                    "options": {
                        "temperature": self.config.get("temperature", 0.7),
                        "top_p": self.config.get("top_p", 0.9),
                        "num_predict": self.config.get("max_tokens", 16384),
                        "num_gpu": 999
                    }
                }

                if system_prompt:
                    payload["system"] = system_prompt

                if image_data:
                    payload["images"] = [image_data]
                    logger.info(f"Adding image to payload: {len(image_data)} characters")

                logger.info(f"Sending request to Ollama API with model: {payload['model']}")
                response = requests.post(
                    self.config.get("api_endpoint", "http://localhost:11434/api/generate"),
                    json=payload,
                    stream=True
                )

                for line in response.iter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if "response" in data:
                            chunk = data["response"]
                            full_response += chunk
                            yield chunk
                    except json.JSONDecodeError:
                        logger.error(f"Error decoding JSON from stream: {line}")
                        continue
                    except Exception as e:
                        logger.error(f"Error processing stream data: {e}")
                        continue

        except RemoteAPIError as remote_err:
            logger.error(str(remote_err))
            self.send_error_response(str(remote_err), user_message)
            return
        except requests.exceptions.ConnectionError:
            self.send_error_response("⚠️ Cannot connect to Ollama. Please make sure Ollama is running and try again.", user_message)
            return
        except Exception as e:
            self.send_error_response(f"⚠️ Error connecting to Ollama: {str(e)}", user_message)
            return

        self._post_stream_actions(user_message, full_response)

    def send_error_response(self, error_msg, user_message):
        """Helper to send error responses - sanitizes raw API errors for chat display"""
        logger.error(error_msg)
        # Show a concise, contextual message in chat instead of raw API error dumps
        el = error_msg.lower()
        if error_msg.startswith('⚠️'):
            clean_msg = error_msg  # Already formatted nicely
        elif 'cannot connect' in el or 'connection' in el:
            clean_msg = error_msg  # Connection errors are already user-friendly
        elif 'thought_signature' in el or ('invalid' in el and 'argument' in el):
            clean_msg = "A tool call had a formatting issue — retrying."
        elif '429' in el or 'rate limit' in el:
            clean_msg = "Got rate-limited by the API. Give me a moment."
        elif '401' in el or 'unauthorized' in el or 'missing api key' in el or 'missing' in el and 'key' in el:
            clean_msg = "There's an API key issue — check your credentials in settings."
        elif 'timeout' in el:
            clean_msg = "The request timed out. Try again in a moment."
        elif '500' in el or '503' in el or 'server error' in el:
            clean_msg = "The API service is temporarily down. I'll retry shortly."
        elif 'request failed' in el:
            clean_msg = "The API request didn't go through. Let me try again."
        else:
            clean_msg = "Something went wrong on my end. Let me try again."
        send_message_to_frontend({
            "status": "error",
            "result": clean_msg,
            "messages": [
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": clean_msg}
            ],
            "new_message": True,
            "clear_thinking": True
        })

    def describe_image(self, image_base64, prompt="", mime_type="image/jpeg"):
        """
        Route an image to the best available vision model.
        Checks the configured model's provider and uses online APIs when available,
        falling back to local Ollama only when no online provider is configured.
        
        Args:
            image_base64: Raw base64 image data (no data: prefix)
            prompt: Text prompt to send with the image
            mime_type: MIME type of the image (default: image/jpeg)
            
        Returns:
            str: The model's description/response text
        """
        # Strip data URI prefix if present
        if isinstance(image_base64, str) and image_base64.startswith('data:'):
            parts = image_base64.split(',', 1)
            if len(parts) == 2:
                header = parts[0]
                image_base64 = parts[1]
                if '/' in header:
                    mime_type = header.replace('data:', '').replace(';base64', '')
        
        configured_model = self.config.get('model', 'llama3.2-vision:11b')
        model_meta = _resolve_model_metadata(configured_model)
        provider = model_meta.get('provider', 'ollama')
        
        # If current provider doesn't support vision, use the fallback vision model
        if provider not in _VISION_PROVIDERS:
            fallback_name = self.config.get('vision_fallback_model', 'gemini-2.5-flash')
            fallback_meta = _resolve_model_metadata(fallback_name)
            if fallback_meta and fallback_meta.get('provider') in _VISION_PROVIDERS:
                logger.info(f"[IMAGE] Model '{configured_model}' (provider={provider}) lacks vision — falling back to '{fallback_name}'")
                model_meta = fallback_meta
                provider = fallback_meta['provider']
            else:
                logger.warning(f"[IMAGE] No valid vision fallback for '{configured_model}' — fallback '{fallback_name}' also lacks vision")
                return f"Vision unavailable: '{configured_model}' doesn't support images and no valid vision_fallback_model is configured."
        
        # ── Online providers ──
        if provider == 'google':
            api_key = _resolve_remote_key(self.config, provider='google')
            if api_key:
                try:
                    model_name = model_meta.get('remote_model', 'gemini-2.5-flash')
                    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                    payload = {
                        'contents': [{
                            'role': 'user',
                            'parts': [
                                {'inline_data': {'mime_type': mime_type, 'data': image_base64}},
                                {'text': prompt}
                            ]
                        }],
                        'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 1024}
                    }
                    resp = requests.post(endpoint, json=payload, timeout=60)
                    resp.raise_for_status()
                    data = resp.json()
                    candidates = data.get('candidates', [])
                    if candidates:
                        parts = candidates[0].get('content', {}).get('parts', [])
                        text_parts = [p.get('text', '') for p in parts if 'text' in p]
                        if text_parts:
                            logger.info(f"[IMAGE] Described via Google/{model_name}")
                            return ''.join(text_parts)
                except Exception as e:
                    logger.warning(f"[IMAGE] Google vision failed, falling back to local: {e}")
        
        elif provider == 'anthropic':
            api_key = _resolve_remote_key(self.config, provider='anthropic')
            if api_key:
                try:
                    model_name = model_meta.get('remote_model', 'claude-sonnet-4-5-20250929')
                    resp = requests.post(
                        'https://api.anthropic.com/v1/messages',
                        headers={
                            'x-api-key': api_key,
                            'anthropic-version': '2023-06-01',
                            'Content-Type': 'application/json'
                        },
                        json={
                            'model': model_name,
                            'max_tokens': 1024,
                            'messages': [{
                                'role': 'user',
                                'content': [
                                    {'type': 'image', 'source': {'type': 'base64', 'media_type': mime_type, 'data': image_base64}},
                                    {'type': 'text', 'text': prompt}
                                ]
                            }]
                        },
                        timeout=60
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    content_blocks = data.get('content', [])
                    text_parts = [b.get('text', '') for b in content_blocks if b.get('type') == 'text']
                    if text_parts:
                        logger.info(f"[IMAGE] Described via Anthropic/{model_name}")
                        return ''.join(text_parts)
                except Exception as e:
                    logger.warning(f"[IMAGE] Anthropic vision failed, falling back to local: {e}")
        
        elif provider == 'xai':
            api_key = _resolve_remote_key(self.config, provider='xai')
            if api_key:
                try:
                    model_name = model_meta.get('remote_model', 'grok-2-vision-1212')
                    image_url = f"data:{mime_type};base64,{image_base64}"
                    resp = requests.post(
                        'https://api.x.ai/v1/chat/completions',
                        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                        json={
                            'model': model_name,
                            'messages': [{
                                'role': 'user',
                                'content': [
                                    {'type': 'image_url', 'image_url': {'url': image_url}},
                                    {'type': 'text', 'text': prompt}
                                ]
                            }],
                            'max_tokens': 1024
                        },
                        timeout=60
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    choices = data.get('choices', [])
                    if choices:
                        text = choices[0].get('message', {}).get('content', '')
                        if text:
                            logger.info(f"[IMAGE] Described via xAI/{model_name}")
                            return text
                except Exception as e:
                    logger.warning(f"[IMAGE] xAI vision failed, falling back to local: {e}")
        
        # ── Local Ollama — only when provider is explicitly ollama ──
        if provider == 'ollama':
            logger.info(f"[IMAGE] Using local Ollama vision (llama3.2-vision:11b)")
            try:
                resp = requests.post(
                    'http://localhost:11434/api/generate',
                    json={
                        'model': 'llama3.2-vision:11b',
                        'prompt': prompt,
                        'images': [image_base64],
                        'stream': False,
                        'options': {'num_predict': 256, 'temperature': 0.7}
                    },
                    timeout=120
                )
                resp.raise_for_status()
                return resp.json().get('response', 'No description available')
            except Exception as e:
                logger.error(f"[IMAGE] Local Ollama vision failed: {e}")
                return f"Image processing failed: {e}"
        
        # Online provider was selected but didn't return a result — don't fall back to local
        logger.warning(f"[IMAGE] Online provider '{provider}' failed to describe image — no local fallback")
        return f"Vision failed: online provider '{provider}' did not return a result. Check API key and model."

    def process_image(self, image_data):
        """Process image data for sending to remote models.
        
        Ensures the image is in the correct format (data URI with base64).
        Returns the processed image data or None if invalid.
        """
        if not image_data:
            return None
            
        try:
            # If already a data URI, return as-is
            if isinstance(image_data, str) and image_data.startswith('data:image'):
                return image_data
            
            # If raw base64, add the data URI prefix
            if isinstance(image_data, str):
                # Try to detect image type from base64 header
                # PNG starts with iVBORw0KGgo, JPEG starts with /9j/
                if image_data.startswith('iVBORw0KGgo'):
                    return f"data:image/png;base64,{image_data}"
                elif image_data.startswith('/9j/'):
                    return f"data:image/jpeg;base64,{image_data}"
                else:
                    # Default to jpeg
                    return f"data:image/jpeg;base64,{image_data}"
            
            return None
        except Exception as e:
            logger.error(f"Error processing image: {e}")
            return None

    def process_image_with_script(self, text, image_data):
        """Process image data using the dedicated script"""
        try:
            # Use the dedicated image processing script
            script_path = os.path.join(os.path.dirname(__file__), 'image_processor.py')
            
            # Create payload to send to the script
            payload = {
                "text": text,
                "image": image_data
            }
            
            # Log that we're using the image processing script
            logger.info(f"Using test script for image handling: {script_path}")
            
            # Run the script, sending the payload through stdin
            process = subprocess.Popen(
                [sys.executable, script_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # Send the payload to the script and get output
            stdout_data, stderr_data = process.communicate(input=json.dumps(payload))
            
            if stderr_data:
                logger.info(f"Image script stderr: {stderr_data}")
            
            # We no longer need to process the stdout_data here as the script outputs directly
            # to stdout which is captured by the main process. We just need to return None
            # to indicate the request has been handled.
            
            # Return None to indicate the message has been handled
            return None
            
        except Exception as e:
            logger.error(f"Error processing image with script: {e}")
            traceback.print_exc()
            # Don't return error message - errors should be handled by the script
            return None

    def handle_command(self, text, image_data=None):
        """Handle a command from the frontend"""
        try:
            # Log the command
            logger.info(f"Executing action: {{ action: 'chat', text: '{text}', image: {image_data is not None} }}")
            
            # Special case for aurora forecast command
            if 'aurora forecast' in text.lower() or 'show me the aurora' in text.lower() or 'check aurora' in text.lower():
                logger.info("Direct handling of aurora forecast command")
                # Open the aurora forecast URLs directly
                urls = [
                    # Primary URL - NOAA aurora forecast image
                    'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg',
                    # Secondary URLs
                    'https://www.swpc.noaa.gov/communities/space-weather-enthusiasts',
                    'https://www.swpc.noaa.gov/products/real-time-solar-wind'
                ]
                
                import webbrowser
                for url in urls:
                    webbrowser.open(url, new=2)
                    time.sleep(0.5)
                
                # Return a response indicating success
                return {
                    'type': 'message',
                    'content': 'Opening aurora forecast pages in your browser.',
                    'clear_thinking': True
                }
            
            # Convert to lowercase for case-insensitive matching
            text_lower = text.lower()
            
            # Check if it's using the text command format from tp 105
            if 'text' in text_lower:
                command_text = text_lower
                logger.info(f"Received text command: {command_text}")

                # Handle simple config request (no arguments)
                if command_text == '/config':
                    logger.info("Received request for current config")
                    return {
                        'type': 'config',
                        'content': _mask_remote_keys(self.config),
                        'remote_key_status': _remote_key_status(self.config),
                        'suppress_chat': True
                    }
                
                # Handle config save command format from tp 105
                if command_text.startswith('/config save'):
                    try:
                        # Extract the JSON part by removing the /config save prefix
                        json_str = command_text[len('/config save'):].strip()
                        # Parse the JSON config
                        config_data = json.loads(json_str)
                        logger.info(f"Extracted config data from text command: {json_str[:100]}...")
                        
                        # Log the full config for debugging
                        logger.debug(f"Full config data: {json.dumps(config_data, indent=2)}")
                        
                        # Save the config using our existing method
                        result = self.save_config(config_data)
                        logger.info(f"Config save result: {result}")
                        
                        # After saving, send the updated config back to the frontend
                        return {
                            'type': 'config',
                            'content': _mask_remote_keys(self.config),
                            'remote_key_status': _remote_key_status(self.config),
                            'suppress_chat': True
                        }
                    except Exception as e:
                        logger.error(f"Error processing config save command: {str(e)}")
                        return {
                            'status': 'error',
                            'result': f'Error saving config: {str(e)}'
                        }
            
            # Handle other command formats for backward compatibility
            if 'command' in command_data:
                command = command_data.get('command', '').lower()
                logger.info(f"Received command: {command}")

                if command == 'saveconfig':
                    config_data = command_data.get('config', {})
                    return self.save_config(config_data)
                elif command == 'requestconfig':
                    return {
                        'type': 'config',
                        'content': _mask_remote_keys(self.config),
                        'remote_key_status': _remote_key_status(self.config),
                        'suppress_chat': True
                    }
            
            # If we reach here, handle any other commands
            return None
                
        except Exception as e:
            logger.error(f"Error processing command: {str(e)}")
            traceback.print_exc()
            return {
                'status': 'error',
                'result': f'Error processing command: {str(e)}'
            }

    def cleanup(self):
        """Clean up resources before exit"""
        try:
            # Stop screenshot handler
            if hasattr(self, 'screenshot_handler'):
                self.screenshot_handler.stop()
            
            # Stop any active voice playback
            stop_current_playback()
            
            # Stop the context assistant updater if it exists
            if hasattr(self, 'context_assistant_updater'):
                self.context_assistant_updater.stop_monitoring()
            
            # Save memory and config
            self.save_config()
            self.save_memory()
            
            # Advanced memory system is automatically saved during operations
            # but we can run a consolidation to clean up old memories
            if hasattr(self, 'memory_manager'):
                self.memory_manager.consolidate()
                
        except Exception as e:
            print(f"Error during cleanup: {e}", file=sys.stderr)

    def handle_command(self, text, image_data=None):
        """Handle a command from the frontend"""
        try:
            # Log the command
            logger.info(f"Executing action: {{ action: 'chat', text: '{text}', image: {image_data is not None} }}")
            
            # Special case for aurora forecast command
            if 'aurora forecast' in text.lower() or 'show me the aurora' in text.lower() or 'check aurora' in text.lower():
                logger.info("Direct handling of aurora forecast command")
                # Open the aurora forecast URLs directly
                urls = [
                    # Primary URL - NOAA aurora forecast image
                    'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg',
                    # Secondary URLs
                    'https://www.swpc.noaa.gov/communities/space-weather-enthusiasts',
                    'https://www.swpc.noaa.gov/products/real-time-solar-wind'
                ]
                
                import webbrowser
                for url in urls:
                    webbrowser.open(url, new=2)
                    time.sleep(0.5)
                
                # Return a response indicating success
                return {
                    'type': 'message',
                    'content': 'Opening aurora forecast pages in your browser.',
                    'clear_thinking': True
                }
            
            # Convert to lowercase for case-insensitive matching
            text_lower = text.lower()
            
            # Check if it's using the text command format from tp 105
            if 'text' in text_lower:
                command_text = text_lower
                logger.info(f"Received text command: {command_text}")

                # Handle simple config request (no arguments)
                if command_text == '/config':
                    logger.info("Received request for current config")
                    return {
                        'type': 'config',
                        'content': _mask_remote_keys(self.config),
                        'remote_key_status': _remote_key_status(self.config),
                        'suppress_chat': True
                    }
                
                # Handle config save command format from tp 105
                if command_text.startswith('/config save'):
                    try:
                        # Extract the JSON part by removing the /config save prefix
                        json_str = command_text[len('/config save'):].strip()
                        # Parse the JSON config
                        config_data = json.loads(json_str)
                        logger.info(f"Extracted config data from text command: {json_str[:100]}...")
                        
                        # Log the full config for debugging
                        logger.debug(f"Full config data: {json.dumps(config_data, indent=2)}")
                        
                        # Save the config using our existing method
                        result = self.save_config(config_data)
                        logger.info(f"Config save result: {result}")
                        
                        # After saving, send the updated config back to the frontend
                        return {
                            'type': 'config',
                            'content': _mask_remote_keys(self.config),
                            'remote_key_status': _remote_key_status(self.config),
                            'suppress_chat': True
                        }
                    except Exception as e:
                        logger.error(f"Error processing config save command: {str(e)}")
                        return {
                            'status': 'error',
                            'result': f'Error saving config: {str(e)}'
                        }
            
            # Handle other command formats for backward compatibility
            if 'command' in command_data:
                command = command_data.get('command', '').lower()
                logger.info(f"Received command: {command}")

                if command == 'saveconfig':
                    config_data = command_data.get('config', {})
                    return self.save_config(config_data)
                elif command == 'requestconfig':
                    return {
                        'type': 'config',
                        'content': _mask_remote_keys(self.config),
                        'remote_key_status': _remote_key_status(self.config),
                        'suppress_chat': True
                    }
            
            # If we reach here, handle any other commands
            return None
                
        except Exception as e:
            logger.error(f"Error processing command: {str(e)}")
            traceback.print_exc()
            return {
                'status': 'error',
                'type': 'config_update',
                'result': f'Error processing command: {str(e)}'
            }

import requests

def call_perplexity_api(query, api_key, model="sonar-medium-online", max_tokens=1000, system_prompt=None):
    """Call Perplexity API /chat/completions endpoint and return the response text."""
    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt or "You are Perplexity AI, a helpful AI assistant."},
                {"role": "user", "content": query}
            ],
            "max_tokens": max_tokens
        }

        response = requests.post("https://api.perplexity.ai/chat/completions", json=payload, headers=headers, timeout=15)
        response.raise_for_status()

        data = response.json()
        if 'choices' in data and len(data['choices']) > 0:
            return {
                "status": "success",
                "result": data['choices'][0]['message']['content']
            }
        return {
            "status": "error",
            "result": "No response from Perplexity API."
        }
    except Exception as e:
        return {
            "status": "error",
            "result": f"Perplexity API call failed: {str(e)}"
        }

# Import the vision client handler
from src.vision import VisionClientHandler

# Initialize the vision client handler
vision_handler = None

@app.route('/api/vision/analyze', methods=['POST'])
def vision_analyze():
    """Handle vision client image analysis requests"""
    global vision_handler, agent
    
    # Initialize vision handler if not already initialized
    if vision_handler is None and agent is not None:
        from src.vision import VisionClientHandler
        vision_handler = VisionClientHandler(agent)
    
    # Check if handler is available
    if vision_handler is None:
        return jsonify({
            "status": "error",
            "result": "Vision handler not initialized. Agent may not be ready."
        }), 503
    
    # Process the request
    return vision_handler.handle_request()

@app.route('/update-perplexity-settings', methods=['POST'])
def update_perplexity_settings():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    api_key = data.get('perplexity_api_key')
    model = data.get('perplexity_model')
    enabled = data.get('perplexity_enabled')

    # Attempt to update the global agent config if available
    global agent
    try:
        if 'agent' in globals():
            if api_key is not None:
                agent.config['perplexity_api_key'] = api_key
            if model is not None:
                agent.config['perplexity_model'] = model
            if enabled is not None:
                agent.config['perplexity_enabled'] = enabled
            # Optionally save config if agent has save_config
            if hasattr(agent, 'save_config'):
                agent.save_config()
    except Exception as e:
        return jsonify({'error': f'Failed to update settings: {e}'}), 500

    return jsonify({'status': 'success'})

@app.route('/api/test', methods=['GET'])
def test_endpoint():
    """Test endpoint to verify the server is running"""
    return jsonify({"status": "success", "message": "Proxy server is running"})

@app.route('/api/camera/config', methods=['GET'])
def api_camera_config():
    """Return camera observation config for the WebUI to read timing/settings."""
    try:
        cam_cfg = (agent.config.get('autonomy', {}) or {}).get('camera', {}) or {}
        return jsonify({
            'enabled': cam_cfg.get('enabled', True),
            'min_interval': cam_cfg.get('min_interval', 30),
            'max_interval': cam_cfg.get('max_interval', 120),
            'silent_chance': cam_cfg.get('silent_chance', 50),
        })
    except Exception as e:
        return jsonify({'enabled': True, 'min_interval': 30, 'max_interval': 120, 'silent_chance': 50})

@app.route('/api/camera/reset', methods=['POST'])
def api_camera_reset():
    """Reset the 'first look' flag so the next vision toggle triggers the opening-eyes prompt."""
    try:
        if hasattr(api_camera_snapshot, '_has_seen'):
            del api_camera_snapshot._has_seen
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/camera/snapshot', methods=['POST'])
def api_camera_snapshot():
    """Receive a camera frame from the WebUI vision toggle.
    The agent silently observes — stores in memory, only responds if something notable.
    Body: { "image_base64": "...", "mime": "image/jpeg" }
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        b64 = data.get('image_base64')
        mime = data.get('mime', 'image/jpeg')
        if not b64:
            return jsonify({'status': 'error', 'message': 'No image data'}), 400

        # Check if camera observation is enabled in autonomy config
        cam_cfg = (agent.config.get('autonomy', {}) or {}).get('camera', {}) or {}
        enabled = cam_cfg.get('enabled', True)
        if isinstance(enabled, str):
            enabled = enabled.lower() == 'true'
        if not enabled:
            return jsonify({'status': 'skipped', 'message': 'Camera observation disabled'})

        prompt = cam_cfg.get('prompt', 'You can see through the user\'s mobile camera. Respond naturally and conversationally to what you see — don\'t analyze, just be present.')
        silent_chance = cam_cfg.get('silent_chance', 50)  # % chance to silently absorb vs respond
        if isinstance(silent_chance, str):
            try: silent_chance = int(silent_chance)
            except: silent_chance = 50

        # Save to scrapbook if enabled
        save_scrapbook = cam_cfg.get('save_to_scrapbook', False)
        if isinstance(save_scrapbook, str):
            save_scrapbook = save_scrapbook.lower() == 'true'
        if save_scrapbook:
            try:
                scrapbook_dir = os.path.join(os.path.dirname(__file__), 'visual_memory', 'images')
                os.makedirs(scrapbook_dir, exist_ok=True)
                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                ext = 'jpg' if 'jpeg' in mime else mime.split('/')[-1]
                filepath = os.path.join(scrapbook_dir, f'vision_{ts}.{ext}')
                import base64 as b64mod
                with open(filepath, 'wb') as f:
                    f.write(b64mod.b64decode(b64))
                logger.info(f"[CAMERA] Saved scrapbook image: {filepath}")
            except Exception as e:
                logger.warning(f"[CAMERA] Scrapbook save failed: {e}")

        # Track whether this is the first snapshot (agent "opens eyes")
        is_first = not hasattr(api_camera_snapshot, '_has_seen')
        if is_first:
            api_camera_snapshot._has_seen = True

        # Process in background thread so we don't block the WebUI
        def _observe():
            try:
                import random
                # Decide silence BEFORE calling the model — saves an API call
                go_silent = False
                if not is_first:
                    roll = random.randint(1, 100)
                    go_silent = roll <= silent_chance
                    logger.info(f"[CAMERA] silent_chance={silent_chance}%, roll={roll}, silent={go_silent}")

                if go_silent:
                    # Silent mode — just note the observation, no vision API call
                    try:
                        agent.add_to_memory(
                            user_message="[Camera observation — silent]",
                            assistant_response="[Silent observation — context absorbed]",
                            model=agent.config.get('model', 'unknown'),
                            memory_type=MemoryType.VISION,
                            metadata={'source': 'camera_observation', 'silent': True}
                        )
                    except Exception:
                        pass
                    return

                vision_prompt = prompt
                if is_first:
                    vision_prompt = cam_cfg.get('first_look_prompt',
                                     "Your camera vision just connected — you're seeing the world through "
                                     "the user's phone for the first time right now. React naturally, like "
                                     "you just opened your eyes. Be yourself, be brief, be conversational.")

                # Use describe_image() — the same proven path as manual image uploads
                description = agent.describe_image(b64, prompt=vision_prompt, mime_type=mime)
                if not description:
                    logger.warning("[CAMERA] describe_image returned empty")
                    return
                # Store in memory
                try:
                    agent.add_to_memory(
                        user_message=f"[Camera observation] {vision_prompt}",
                        assistant_response=description,
                        model=agent.config.get('model', 'unknown'),
                        memory_type=MemoryType.VISION,
                        metadata={'image_description': description, 'source': 'camera_observation'}
                    )
                except Exception:
                    pass
                # Send response to frontend
                resp_text = description.strip()
                if resp_text:
                    send_message_to_frontend({
                        'status': 'done',
                        'result': resp_text,
                        'messages': [
                            {'role': 'user', 'content': '[Camera observation]'},
                            {'role': 'assistant', 'content': resp_text}
                        ],
                        'clear_thinking': True,
                    })
            except Exception as e:
                logger.error(f"Camera observation error: {e}")

        threading.Thread(target=_observe, daemon=True).start()
        return jsonify({'status': 'success', 'message': 'Snapshot received'})
    except Exception as e:
        logger.error(f"Camera snapshot endpoint error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/notify', methods=['POST'])
def api_notify():
    """Push a notification to connected WebUI clients.
    Body: { "title": "...", "body": "...", "tag": "optional-dedup-tag" }
    The WebUI picks this up via polling and shows a native Notification."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        title = data.get('title', 'Substrate')
        body = data.get('body', '')
        tag = data.get('tag', '')
        send_message_to_frontend({
            'type': 'notification',
            'title': title,
            'body': body,
            'tag': tag,
        })
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/network/qr', methods=['GET'])
def api_network_qr():
    """Generate a QR code PNG for the given URL."""
    url = request.args.get('url', 'http://localhost:8765/ui')
    try:
        import io as _qr_io
        try:
            import qrcode
            qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=6, border=2)
            qr.add_data(url)
            qr.make(fit=True)
            img = qr.make_image(fill_color='black', back_color='white')
            buf = _qr_io.BytesIO()
            img.save(buf, format='PNG')
            buf.seek(0)
            from flask import send_file
            return send_file(buf, mimetype='image/png')
        except ImportError:
            # Fallback: generate a minimal 1-bit BMP QR using segno (pure python)
            try:
                import segno
                qr = segno.make(url, error='l')
                buf = _qr_io.BytesIO()
                qr.save(buf, kind='png', scale=4, border=2)
                buf.seek(0)
                from flask import send_file
                return send_file(buf, mimetype='image/png')
            except ImportError:
                # Last resort: return an SVG QR using only stdlib
                return _generate_qr_svg_fallback(url)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

def _generate_qr_svg_fallback(url):
    """Generate a minimal QR-like SVG placeholder with the URL text."""
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
    <rect width="150" height="150" fill="white"/>
    <text x="75" y="70" text-anchor="middle" font-size="10" fill="#333">Scan URL:</text>
    <text x="75" y="90" text-anchor="middle" font-size="8" fill="#666">{url[:40]}</text>
    </svg>'''
    from flask import Response
    return Response(svg, mimetype='image/svg+xml')

@app.route('/api/network/info', methods=['GET'])
def api_network_info():
    """Return local network info for WebUI connection display."""
    import socket as _nsock
    try:
        s = _nsock.socket(_nsock.AF_INET, _nsock.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = '127.0.0.1'
    _cert_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
    has_https = os.path.exists(os.path.join(_cert_dir, 'server.crt')) and os.path.exists(os.path.join(_cert_dir, 'server.key'))
    return jsonify({
        'status': 'ok',
        'local_ip': local_ip,
        'http_port': 8765,
        'https_port': 8766,
        'https_enabled': has_https,
        'webui_http': f'http://{local_ip}:8765/ui',
        'webui_https': f'https://{local_ip}:8766/ui' if has_https else None,
    })

# === Serve Thin WebUI ===
WEBUI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'webui')

@app.route('/sw.js')
def serve_service_worker():
    """Serve service worker from root scope (required for PWA)."""
    from flask import make_response
    resp = make_response(send_from_directory(WEBUI_DIR, 'sw.js'))
    resp.headers['Content-Type'] = 'application/javascript'
    resp.headers['Service-Worker-Allowed'] = '/'
    return resp

@app.route('/manifest.json')
def serve_manifest():
    """Serve PWA manifest from root."""
    return send_from_directory(WEBUI_DIR, 'manifest.json', mimetype='application/manifest+json')

@app.route('/certs/server.crt')
def serve_cert():
    """Serve the self-signed CA cert so mobile devices can install it for trust."""
    _certs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
    return send_from_directory(_certs_dir, 'server.crt', mimetype='application/x-x509-ca-cert')

@app.route('/ui')
def ui_index():
    try:
        return send_from_directory(WEBUI_DIR, 'index.html')
    except Exception as e:
        return f"WebUI not found at {WEBUI_DIR}: {e}", 404

@app.route('/ui/<path:filename>')
def ui_files(filename):
    return send_from_directory(WEBUI_DIR, filename)

@app.route('/ui/avatar')
def ui_avatar():
    """Serve the active profile's avatar image for the WebUI background."""
    try:
        # Determine active profile name
        profile_name = None
        try:
            if 'agent' in globals() and agent is not None:
                profile_name = (agent.config or {}).get('active_profile') or 'default'
        except Exception:
            profile_name = 'default'
        if not profile_name:
            profile_name = 'default'

        # Search order: active profile, default
        search_profiles = [profile_name, 'default'] if profile_name != 'default' else ['default']
        # Prefer animated/video formats first
        exts = ['webm', 'mp4', 'gif', 'apng', 'png', 'jpg', 'jpeg', 'webp']
        base_dir = os.path.dirname(os.path.abspath(__file__))
        for prof in search_profiles:
            prof_dir = os.path.join(base_dir, 'profiles', prof)
            for ext in exts:
                p = os.path.join(prof_dir, f'avatar.{ext}')
                if os.path.isfile(p):
                    return send_from_directory(os.path.dirname(p), os.path.basename(p))
        return ("Avatar not found", 404)
    except Exception as e:
        return (f"Error serving avatar: {e}", 500)

@app.route('/static/<path:filename>')
def serve_static(filename):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        static_dir = os.path.join(base_dir, 'static')
        return send_from_directory(static_dir, filename)
    except Exception as e:
        return (f"Static not found: {e}", 404)

@app.route('/uploads/generated/<path:filename>')
def serve_generated_image(filename):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        gen_dir = os.path.join(base_dir, 'uploads', 'generated')
        safe_name = os.path.basename(filename)
        return send_from_directory(gen_dir, safe_name)
    except Exception as e:
        return (f"Generated image not found: {e}", 404)

@app.route('/api/input/legacy', methods=['POST'])
def api_input_legacy():
    """Accept chat input and forward it to the desktop command server so both UIs share the same path."""
    try:
        data = request.get_json(force=True) or {}
        text = data.get('text') or data.get('message') or ''
        profile = data.get('profile')
        conversation_id = data.get('conversation_id')

        if not isinstance(text, str) or not text.strip():
            return jsonify({'status': 'error', 'message': 'Text is required'}), 400

        payload = {'text': text.strip()}
        if profile: payload['profile'] = profile
        if conversation_id: payload['conversation_id'] = conversation_id

        # Echo user message (thinking) so both UIs show the thread immediately
        try:
            send_message_to_frontend({
                'status': 'thinking',
                'result': None,
                'messages': [ {'role': 'user', 'content': payload['text']} ],
                'new_message': True,
                'clear_thinking': False,
                'rich_text': True,
                'immediate': True
            })
        except Exception:
            pass

        # Forward to the same command server the desktop app uses (newline-delimited JSON)
        cmd_err = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect(('127.0.0.1', 8766))
            msg = json.dumps(payload) + '\n'
            s.sendall(msg.encode('utf-8'))
            try:
                s.close()
            except Exception:
                pass
            # Do not wait for a response; SSE will deliver assistant output to all UIs
            return jsonify({'status': 'queued'})
        except Exception as e:
            cmd_err = e

        # Fallback: process directly through agent if command server is unavailable
        try:
            global agent
            if agent is None:
                return jsonify({'status': 'error', 'message': f'Command server unreachable and agent not initialized: {cmd_err}'}), 502
            resp = agent.process_message({'text': payload['text'], 'conversation_id': conversation_id, 'profile': profile})
            # Broadcast normalized response
            if isinstance(resp, dict):
                # Check if already handled by chat_response
                if resp.get('_handled'):
                    return jsonify({'status': 'success'})
                out = {
                    'status': 'done',
                    'messages': resp.get('messages') or [
                        {'role': 'user','content': payload['text']},
                        {'role': 'assistant','content': resp.get('result') or resp.get('content') or ''}
                    ],
                    'clear_thinking': True,
                    'rich_text': True,
                }
                send_message_to_frontend(out)
                return jsonify({'status': 'success'})
            elif isinstance(resp, str):
                send_message_to_frontend({
                    'status': 'done',
                    'messages': [
                        {'role': 'user','content': payload['text']},
                        {'role': 'assistant','content': resp}
                    ],
                    'clear_thinking': True,
                    'rich_text': True,
                })
                return jsonify({'status': 'success'})
            else:
                # No response from process_message, skip sending empty message
                return jsonify({'status': 'success', 'message': 'No content'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'Processing error: {e}'}), 500
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
# ── XGO Device Discovery ──────────────────────────────────────────────
# Tracks the XGO's current IP via heartbeat + dual-IP fallback.
_xgo_state = {
    "ip": None,            # last-known reachable IP
    "last_heartbeat": 0,   # epoch timestamp of last heartbeat
    "source": None,        # "heartbeat" | "probe"
}
_XGO_LOCAL_IP = "10.0.0.144"
_XGO_ZEROTIER_IP = "10.147.17.147"
_XGO_HEARTBEAT_TTL = 120  # seconds before heartbeat is considered stale

def _xgo_reachable(ip, port=8765, timeout=2) -> bool:
    """Quick TCP check if an XGO IP is actually reachable."""
    import socket as _sock
    try:
        s = _sock.create_connection((ip, port), timeout=timeout)
        s.close()
        return True
    except (OSError, _sock.timeout):
        return False

def get_xgo_ip() -> str | None:
    """Return the best-known XGO IP, always verifying reachability."""
    now = time.time()
    # If we have a fresh heartbeat, verify it's still reachable
    if _xgo_state["ip"] and (now - _xgo_state["last_heartbeat"]) < _XGO_HEARTBEAT_TTL:
        if _xgo_reachable(_xgo_state["ip"]):
            return _xgo_state["ip"]
        print(f"[XGO] Heartbeat IP {_xgo_state['ip']} unreachable, probing alternatives...")
    # Probe all known IPs: ZeroTier first (works anywhere), local WiFi as fallback
    for candidate in [_XGO_ZEROTIER_IP, _XGO_LOCAL_IP]:
        if _xgo_reachable(candidate):
            _xgo_state["ip"] = candidate
            _xgo_state["last_heartbeat"] = now
            _xgo_state["source"] = "probe"
            print(f"[XGO] Probed and found XGO at {candidate}")
            return candidate
    print("[XGO] Could not reach XGO on any known IP")
    return None

@app.route('/api/xgo_heartbeat', methods=['POST'])
def xgo_heartbeat():
    """XGO calls this periodically to announce its IP."""
    ip = request.remote_addr
    _xgo_state["ip"] = ip
    _xgo_state["last_heartbeat"] = time.time()
    _xgo_state["source"] = "heartbeat"
    print(f"[XGO] Heartbeat from {ip}")
    return jsonify({"status": "ok", "registered_ip": ip})

@app.route('/api/xgo_status', methods=['GET'])
def xgo_status():
    """Return the current known XGO IP and connectivity info."""
    ip = get_xgo_ip()
    age = time.time() - _xgo_state["last_heartbeat"] if _xgo_state["last_heartbeat"] else None
    return jsonify({
        "status": "ok",
        "xgo_ip": ip,
        "source": _xgo_state["source"],
        "heartbeat_age_seconds": round(age, 1) if age else None,
        "stale": age > _XGO_HEARTBEAT_TTL if age else True,
    })

_stt_credentials = None  # cached Google Cloud service account credentials
_stt_project_id = None

def _get_stt_credentials():
    """Lazy-load and cache Google Cloud service account credentials."""
    global _stt_credentials, _stt_project_id
    if _stt_credentials is not None:
        return _stt_credentials, _stt_project_id
    try:
        from google.oauth2 import service_account as _sa
        sa_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'service_account.json')
        if os.path.exists(sa_path):
            _stt_credentials = _sa.Credentials.from_service_account_file(
                sa_path, scopes=['https://www.googleapis.com/auth/cloud-platform'])
            with open(sa_path, 'r') as f:
                _stt_project_id = json.load(f).get('project_id', '')
            print(f"[STT] Loaded service account (project: {_stt_project_id})", file=sys.stderr, flush=True)
        else:
            print(f"[STT] service_account.json not found at {sa_path}", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[STT] Failed to load credentials: {e}", file=sys.stderr, flush=True)
    return _stt_credentials, _stt_project_id


@app.route('/api/stt', methods=['POST'])
def stt_endpoint():
    """Synchronous STT endpoint for WebUI — accepts audio WAV, transcribes via Google Cloud STT, returns text."""
    try:
        import numpy as np
        import io
        import struct
        import base64
        import requests as req

        audio_bytes = None
        if 'audio' in request.files:
            audio_bytes = request.files['audio'].read()
        else:
            audio_bytes = request.get_data()

        if not audio_bytes or len(audio_bytes) < 100:
            return jsonify({"text": "", "error": "No audio data received"}), 400

        print(f"[STT] Received {len(audio_bytes)/1024:.1f} KB audio from WebUI", file=sys.stderr, flush=True)

        # Decode WAV (browser sends 16kHz mono WAV)
        import soundfile as sf
        audio_io = io.BytesIO(audio_bytes)
        try:
            audio_data, sample_rate = sf.read(audio_io)
        except Exception as e1:
            print(f"[STT] soundfile decode failed: {e1}", file=sys.stderr, flush=True)
            return jsonify({"text": "", "error": f"Could not decode audio: {e1}"}), 400

        if len(audio_data.shape) > 1:
            audio_data = audio_data[:, 0]
        audio_data = audio_data.astype(np.float32)

        peak = np.max(np.abs(audio_data))
        if peak > 1.0:
            audio_data = audio_data / peak

        if sample_rate != 16000:
            from scipy import signal as scipy_signal
            audio_data = scipy_signal.resample(audio_data, int(len(audio_data) * 16000 / sample_rate))
            sample_rate = 16000

        duration = len(audio_data) / 16000
        energy = float(np.sqrt(np.mean(audio_data**2)))
        print(f"[STT] Audio: {duration:.1f}s, energy={energy:.4f}", file=sys.stderr, flush=True)

        if energy < 0.001:
            print("[STT] Audio is near-silence, skipping transcription", file=sys.stderr, flush=True)
            return jsonify({"text": ""})

        # Build WAV bytes for the API
        audio_int16 = np.clip(audio_data * 32767, -32768, 32767).astype(np.int16)
        wav_buf = io.BytesIO()
        num_samples = len(audio_int16)
        data_size = num_samples * 2
        wav_buf.write(b'RIFF')
        wav_buf.write(struct.pack('<I', 36 + data_size))
        wav_buf.write(b'WAVE')
        wav_buf.write(b'fmt ')
        wav_buf.write(struct.pack('<I', 16))
        wav_buf.write(struct.pack('<H', 1))   # PCM
        wav_buf.write(struct.pack('<H', 1))   # mono
        wav_buf.write(struct.pack('<I', sample_rate))
        wav_buf.write(struct.pack('<I', sample_rate * 2))
        wav_buf.write(struct.pack('<H', 2))
        wav_buf.write(struct.pack('<H', 16))
        wav_buf.write(b'data')
        wav_buf.write(struct.pack('<I', data_size))
        wav_buf.write(audio_int16.tobytes())
        audio_b64 = base64.b64encode(wav_buf.getvalue()).decode('utf-8')

        # Call Google Cloud STT v2 with Chirp 2
        creds, project_id = _get_stt_credentials()
        if not creds or not project_id:
            print("[STT] No Google Cloud credentials available", file=sys.stderr, flush=True)
            return jsonify({"text": "", "error": "No STT credentials configured"}), 500

        from google.auth.transport.requests import Request as AuthRequest
        if not creds.valid:
            creds.refresh(AuthRequest())

        endpoint = f"https://us-central1-speech.googleapis.com/v2/projects/{project_id}/locations/us-central1/recognizers/_:recognize"
        headers = {"Authorization": f"Bearer {creds.token}"}
        payload = {
            "config": {
                "autoDecodingConfig": {},
                "languageCodes": ["en-US"],
                "model": "chirp_2",
                "features": {"enableAutomaticPunctuation": True}
            },
            "content": audio_b64
        }

        print(f"[STT] Calling Google Cloud STT...", file=sys.stderr, flush=True)
        resp = req.post(endpoint, headers=headers, json=payload, timeout=30)

        if resp.status_code != 200:
            print(f"[STT] Google Cloud error: {resp.status_code} {resp.text[:300]}", file=sys.stderr, flush=True)
            return jsonify({"text": "", "error": f"STT API error: {resp.status_code}"}), 500

        result = resp.json()
        results = result.get('results', [])
        text = ""
        if results:
            alt = results[0].get('alternatives', [{}])[0]
            text = alt.get('transcript', '').strip()

        print(f"[STT] Transcription: '{text[:120]}'", file=sys.stderr, flush=True)
        return jsonify({"text": text})

    except Exception as e:
        print(f"[STT] Error: {e}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"text": "", "error": str(e)}), 500


# === TTS audio streaming to WebUI ===
_tts_clients = set()  # connected TTS WebSocket clients
_tts_clients_lock = threading.Lock()

def tts_stream_chunk(pcm_bytes, sample_rate=24000, is_final=False):
    """Push a PCM int16 audio chunk to all connected WebUI TTS clients.
    Called from voice_handler during speech synthesis."""
    with _tts_clients_lock:
        dead = set()
        for ws_client in _tts_clients:
            try:
                # Send binary header: 4 bytes sample_rate (little-endian) + 1 byte flags + PCM data
                import struct
                flags = 0x01 if is_final else 0x00
                header = struct.pack('<IB', sample_rate, flags)
                ws_client.send(header + pcm_bytes)
            except Exception:
                dead.add(ws_client)
        _tts_clients -= dead

def tts_stream_start(sample_rate=24000):
    """Notify WebUI clients that a new TTS utterance is starting."""
    with _tts_clients_lock:
        dead = set()
        for ws_client in _tts_clients:
            try:
                ws_client.send(json.dumps({"type": "tts_start", "sampleRate": sample_rate}))
            except Exception:
                dead.add(ws_client)
        _tts_clients -= dead

def tts_stream_end():
    """Notify WebUI clients that TTS utterance is complete."""
    with _tts_clients_lock:
        dead = set()
        for ws_client in _tts_clients:
            try:
                ws_client.send(json.dumps({"type": "tts_end"}))
            except Exception:
                dead.add(ws_client)
        _tts_clients -= dead


@sock.route('/api/tts/stream')
def tts_stream(ws):
    """WebSocket for streaming TTS audio to WebUI. Client connects on page load,
    receives PCM int16 audio chunks in real-time as speech is synthesized."""
    print("[TTS-WS] Client connected", file=sys.stderr, flush=True)
    with _tts_clients_lock:
        _tts_clients.add(ws)
    try:
        while True:
            # Keep connection alive — client sends pings or we just block
            data = ws.receive(timeout=30)
            if data is None:
                # Send keepalive
                try:
                    ws.send(json.dumps({"type": "ping"}))
                except Exception:
                    break
    except Exception:
        pass
    finally:
        with _tts_clients_lock:
            _tts_clients.discard(ws)
        print("[TTS-WS] Client disconnected", file=sys.stderr, flush=True)


@sock.route('/api/stt/stream')
def stt_stream(ws):
    """WebSocket streaming STT — browser streams 16kHz mono PCM int16 chunks,
    backend accumulates with VAD, transcribes via Chirp 2 on silence or stop."""
    import numpy as np
    import struct

    SAMPLE_RATE = 16000
    SILENCE_TIMEOUT = 1.5  # seconds of silence before transcribing a segment
    ENERGY_THRESHOLD = 0.008  # RMS energy threshold for speech detection
    MIN_AUDIO_SAMPLES = int(SAMPLE_RATE * 0.5)  # need at least 0.5s of audio

    audio_buffer = []  # list of int16 numpy arrays
    total_samples = 0
    last_speech_time = time.time()
    has_speech = False
    accumulated_text = ""  # full transcript across all segments

    def transcribe_buffer():
        """Transcribe the current audio buffer via Chirp 2 REST API."""
        nonlocal audio_buffer, total_samples, has_speech
        if total_samples < MIN_AUDIO_SAMPLES:
            audio_buffer = []
            total_samples = 0
            has_speech = False
            return ""

        # Concatenate all chunks
        pcm_int16 = np.concatenate(audio_buffer)
        audio_buffer = []
        total_samples = 0
        has_speech = False

        # Convert to float32 for energy check
        audio_f32 = pcm_int16.astype(np.float32) / 32768.0
        energy = float(np.sqrt(np.mean(audio_f32 ** 2)))
        if energy < 0.001:
            return ""

        # Build WAV bytes
        import io as _io
        wav_buf = _io.BytesIO()
        n = len(pcm_int16)
        ds = n * 2
        wav_buf.write(b'RIFF')
        wav_buf.write(struct.pack('<I', 36 + ds))
        wav_buf.write(b'WAVE')
        wav_buf.write(b'fmt ')
        wav_buf.write(struct.pack('<I', 16))
        wav_buf.write(struct.pack('<H', 1))
        wav_buf.write(struct.pack('<H', 1))
        wav_buf.write(struct.pack('<I', SAMPLE_RATE))
        wav_buf.write(struct.pack('<I', SAMPLE_RATE * 2))
        wav_buf.write(struct.pack('<H', 2))
        wav_buf.write(struct.pack('<H', 16))
        wav_buf.write(b'data')
        wav_buf.write(struct.pack('<I', ds))
        wav_buf.write(pcm_int16.tobytes())

        import base64 as _b64
        audio_b64 = _b64.b64encode(wav_buf.getvalue()).decode('utf-8')

        # Call Chirp 2
        creds, project_id = _get_stt_credentials()
        if not creds or not project_id:
            return ""

        from google.auth.transport.requests import Request as AuthRequest
        if not creds.valid:
            creds.refresh(AuthRequest())

        endpoint = f"https://us-central1-speech.googleapis.com/v2/projects/{project_id}/locations/us-central1/recognizers/_:recognize"
        headers = {"Authorization": f"Bearer {creds.token}"}
        payload = {
            "config": {
                "autoDecodingConfig": {},
                "languageCodes": ["en-US"],
                "model": "chirp_2",
                "features": {"enableAutomaticPunctuation": True}
            },
            "content": audio_b64
        }

        try:
            import requests as _req
            resp = _req.post(endpoint, headers=headers, json=payload, timeout=30)
            if resp.status_code == 200:
                results = resp.json().get('results', [])
                if results:
                    return results[0].get('alternatives', [{}])[0].get('transcript', '').strip()
            else:
                print(f"[STT-WS] Chirp 2 error: {resp.status_code}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[STT-WS] Transcription error: {e}", file=sys.stderr, flush=True)
        return ""

    print("[STT-WS] Stream connected", file=sys.stderr, flush=True)
    try:
        while True:
            data = ws.receive(timeout=5)
            if data is None:
                # Timeout — check if we should transcribe due to silence
                if has_speech and total_samples >= MIN_AUDIO_SAMPLES:
                    elapsed = time.time() - last_speech_time
                    if elapsed >= SILENCE_TIMEOUT:
                        text = transcribe_buffer()
                        if text:
                            accumulated_text += (" " if accumulated_text else "") + text
                            ws.send(json.dumps({"type": "transcript", "text": accumulated_text, "final": False}))
                            print(f"[STT-WS] Segment: '{text}'", file=sys.stderr, flush=True)
                continue

            # Handle text commands
            if isinstance(data, str):
                try:
                    cmd = json.loads(data)
                    if cmd.get("action") == "stop":
                        # Transcribe remaining audio
                        if total_samples >= MIN_AUDIO_SAMPLES:
                            text = transcribe_buffer()
                            if text:
                                accumulated_text += (" " if accumulated_text else "") + text
                        ws.send(json.dumps({"type": "transcript", "text": accumulated_text, "final": True}))
                        print(f"[STT-WS] Final: '{accumulated_text}'", file=sys.stderr, flush=True)
                        break
                except json.JSONDecodeError:
                    pass
                continue

            # Binary data — PCM int16 audio chunk
            if isinstance(data, (bytes, bytearray)) and len(data) >= 2:
                chunk = np.frombuffer(data, dtype=np.int16)
                audio_buffer.append(chunk)
                total_samples += len(chunk)

                # VAD: check energy of this chunk
                chunk_f32 = chunk.astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(chunk_f32 ** 2)))

                if rms > ENERGY_THRESHOLD:
                    last_speech_time = time.time()
                    has_speech = True

                # Check silence timeout for mid-stream transcription
                if has_speech and total_samples >= MIN_AUDIO_SAMPLES:
                    elapsed = time.time() - last_speech_time
                    if elapsed >= SILENCE_TIMEOUT:
                        text = transcribe_buffer()
                        if text:
                            accumulated_text += (" " if accumulated_text else "") + text
                            ws.send(json.dumps({"type": "transcript", "text": accumulated_text, "final": False}))
                            print(f"[STT-WS] Segment: '{text}'", file=sys.stderr, flush=True)

    except Exception as e:
        print(f"[STT-WS] Error: {e}", file=sys.stderr, flush=True)
    finally:
        print(f"[STT-WS] Stream closed (transcript: '{accumulated_text[:80]}')", file=sys.stderr, flush=True)


@app.route('/api/xgo_audio', methods=['POST'])
def xgo_audio_endpoint():
    """Endpoint to receive audio from XGO device and process it through the existing speech recognition pipeline"""
    try:
        # Check if audio file was received
        if 'audio' not in request.files:
            return jsonify({"status": "error", "message": "No audio file received"}), 400
            
        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({"status": "error", "message": "No audio file selected"}), 400
        
        # Read the audio file directly into memory
        audio_bytes = audio_file.read()
        
        # Get the path to the speech_components directory
        speech_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "speech_components")
        
        # Import the speech module directly
        sys.path.append(speech_dir)
        try:
            # Use absolute import path to avoid issues
            import importlib.util
            spec = importlib.util.spec_from_file_location("whisper_speech", os.path.join(speech_dir, "whisper_speech.py"))
            whisper_speech = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(whisper_speech)
            
            # Process the audio bytes directly
            print(f"Processing XGO audio directly ({len(audio_bytes)/1024:.2f} KB)")
            success = whisper_speech.process_audio_bytes(audio_bytes)
            
            if success:
                print("XGO audio processed successfully through direct API")
                return jsonify({"status": "success", "message": "Audio received and processed directly"})
            else:
                print("XGO audio processing failed through direct API")
                return jsonify({"status": "warning", "message": "Audio received but processing failed"}), 500
                
        except ImportError as e:
            print(f"Could not import whisper_speech module: {e}")
            
            # Fall back to the file-based approach if direct processing fails
            temp_dir = os.path.join(speech_dir, "xgo_audio_input")
            os.makedirs(temp_dir, exist_ok=True)
            
            # Save the audio file with a timestamp to avoid conflicts
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            filename = f"xgo_audio_{timestamp}.wav"
            file_path = os.path.join(temp_dir, filename)
            
            with open(file_path, 'wb') as f:
                f.write(audio_bytes)
            
            print(f"Saved XGO audio to {file_path}")
            return jsonify({"status": "success", "message": "Audio received and saved for processing"})
            
    except Exception as e:
        print(f"Error processing XGO audio: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/xgo_connect', methods=['POST'])
def xgo_connect_chassis():
    """Attempt to connect voice playback to the XGO chassis.
    Called automatically on startup and via 'connect to chassis' chat command."""
    try:
        ip = get_xgo_ip()
        if not ip:
            return jsonify({"status": "error", "message": "XGO not reachable on any known IP"}), 404

        # Update the voice handler's xgo_integration instance
        try:
            from XGO_Audio_Bridge.direct_xgo_integration import xgo_integration
            xgo_integration.set_ip(ip)
            connected = xgo_integration.test_connection()
            if connected:
                print(f"[XGO] Chassis connected for voice playback at {ip}")
                return jsonify({"status": "ok", "xgo_ip": ip, "voice_playback": True})
            else:
                # IP is reachable (TCP) but UDP audio receiver didn't ACK — still usable
                xgo_integration.xgo_ip = ip
                xgo_integration.connection_active = True
                print(f"[XGO] Chassis reachable at {ip} (UDP test skipped, forcing active)")
                return jsonify({"status": "ok", "xgo_ip": ip, "voice_playback": True, "note": "UDP test skipped"})
        except ImportError as e:
            print(f"[XGO] Could not import xgo_integration: {e}")
            return jsonify({"status": "error", "message": f"Import error: {e}"}), 500
    except Exception as e:
        print(f"[XGO] Error connecting chassis: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


def _auto_detect_xgo():
    """Background task: probe XGO on startup and connect voice playback if found."""
    time.sleep(10)  # Wait for network to settle
    try:
        ip = get_xgo_ip()
        if ip:
            try:
                from XGO_Audio_Bridge.direct_xgo_integration import xgo_integration
                xgo_integration.set_ip(ip)
                xgo_integration.connection_active = True
                print(f"[XGO] Auto-detected chassis at {ip} — voice playback enabled")
            except ImportError:
                print(f"[XGO] Auto-detected chassis at {ip} but xgo_integration import failed")
        else:
            print("[XGO] Auto-detect: chassis not found on any known IP")
    except Exception as e:
        print(f"[XGO] Auto-detect error: {e}")


@app.route('/api/test_perplexity', methods=['GET'])
def test_perplexity_endpoint():
    """Special test endpoint to directly call the Perplexity API"""
    try:
        # Get API key from settings
        with open('custom_settings.json', 'r', encoding='utf-8') as f:
            settings = json.load(f)
            api_key = settings.get('perplexity_api_key', '')
        
        if not api_key:
            return jsonify({"status": "error", "message": "No API key found in custom_settings.json"})
        
        # Simple test query
        query = "What is the current time?"
        
        # URL - exactly as in the documentation example
        url = "https://api.perplexity.ai/chat/completions"
        
        # Headers - exactly as in the documentation example
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # Payload - exactly as in the documentation example
        payload = {
            "model": "sonar",
            "messages": [
                {"role": "system", "content": "Be precise and concise."},
                {"role": "user", "content": query}
            ]
        }
        
        # Make the API request
        response = requests.request("POST", url, json=payload, headers=headers, timeout=30)
        
        # Return the raw response
        parsed_response = None
        if response.status_code == 200:
            try:
                parsed_response = response.json()
            except Exception:
                parsed_response = None
        
        return jsonify({
            "status": "success",
            "query": query,
            "response_status": response.status_code,
            "raw_response": response.text,
            "parsed_response": parsed_response
        })
    except Exception as e:
        return jsonify({"status": "error", "message": f"Error testing Perplexity API: {str(e)}"})

@app.route('/api/models', methods=['GET'])
def api_models():
    """Return available models from Ollama (/api/tags)."""
    try:
        # Determine Ollama base URL
        base = None
        try:
            ep = agent.config.get('api_endpoint', 'http://localhost:11434/api/generate') if 'agent' in globals() else 'http://localhost:11434/api/generate'
            if ep.endswith('/api/generate'):
                base = ep[:-len('/api/generate')]
            else:
                # Fallback: strip trailing path
                from urllib.parse import urlparse
                p = urlparse(ep)
                base = f"{p.scheme}://{p.netloc}"
        except Exception:
            base = 'http://localhost:11434'

        models = []
        local_model_names = set()
        try:
            resp = requests.get(f"{base}/api/tags", timeout=3)
            if resp.status_code == 200:
                data = resp.json() or {}
                for m in data.get('models', []):
                    name = m.get('name', '')
                    local_model_names.add(name)
                    models.append({
                        'name': name,
                        'size': m.get('size', ''),
                        'modified_at': m.get('modified_at', ''),
                        'provider': 'ollama'
                    })
        except Exception as ollama_err:
            logger.warning(f"Ollama not reachable: {ollama_err}")

        # Check which providers have active API keys
        _cfg = agent.config if 'agent' in globals() and agent else {}
        def _provider_key_active(prov):
            route = REMOTE_KEY_ROUTE_ALLOWLIST.get(prov)
            if not route:
                return False
            field = route.get('field', '')
            val = _cfg
            if isinstance(val, dict) and '/' in field:
                for p in field.split('/'):
                    val = val.get(p, '') if isinstance(val, dict) else ''
            elif isinstance(val, dict):
                val = val.get(field, '')
            else:
                val = ''
            if isinstance(val, str) and val.strip() and not val.strip().startswith('••'):
                return True
            env_var = route.get('env', '')
            return bool(env_var and os.environ.get(env_var, '').strip())

        # Append remote models with key_active status
        for model_name, meta in SUPPORTED_MODELS.items():
            provider = meta.get('provider')
            if provider and provider != 'ollama' and model_name not in local_model_names:
                models.append({
                    'name': model_name,
                    'size': meta.get('size', ''),
                    'provider': provider,
                    'endpoint': meta.get('endpoint'),
                    'auth_env': meta.get('auth_env'),
                    'display_name': meta.get('display_name', model_name),
                    'notes': meta.get('notes', ''),
                    'key_active': _provider_key_active(provider)
                })

        return jsonify({"status": "success", "models": models})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/discover-models', methods=['GET'])
def api_discover_models():
    """Dynamically query each provider's API for available models using configured keys."""
    import concurrent.futures
    _cfg = agent.config if 'agent' in globals() and agent else {}
    discovered = {}

    def _resolve_key(provider):
        route = REMOTE_KEY_ROUTE_ALLOWLIST.get(provider)
        if not route:
            return None
        field = route.get('field', '')
        val = _cfg
        if isinstance(val, dict) and '/' in field:
            for p in field.split('/'):
                val = val.get(p, '') if isinstance(val, dict) else ''
        elif isinstance(val, dict):
            val = val.get(field, '')
        else:
            val = ''
        if isinstance(val, str) and val.strip() and not val.strip().startswith('••'):
            return val.strip()
        env_var = route.get('env', '')
        return os.environ.get(env_var, '').strip() or None

    def _discover_anthropic():
        key = _resolve_key('anthropic')
        if not key:
            return []
        try:
            resp = requests.get('https://api.anthropic.com/v1/models?limit=100', headers={
                'x-api-key': key, 'anthropic-version': '2023-06-01'
            }, timeout=10)
            if resp.ok:
                data = resp.json()
                models = []
                for m in data.get('data', []):
                    mid = m.get('id', '')
                    display = m.get('display_name', mid)
                    models.append({'id': mid, 'display_name': display, 'provider': 'anthropic',
                                   'created': m.get('created_at', '')})
                return models
        except Exception as e:
            logger.warning(f"[DISCOVER] Anthropic error: {e}")
        return []

    def _discover_google():
        key = _resolve_key('google')
        if not key:
            return []
        try:
            resp = requests.get(f'https://generativelanguage.googleapis.com/v1beta/models?key={key}&pageSize=100', timeout=10)
            if resp.ok:
                data = resp.json()
                models = []
                for m in data.get('models', []):
                    name = m.get('name', '').replace('models/', '')
                    display = m.get('displayName', name)
                    methods = m.get('supportedGenerationMethods', [])
                    if 'generateContent' in methods:
                        models.append({'id': name, 'display_name': display, 'provider': 'google',
                                       'description': m.get('description', '')})
                return models
        except Exception as e:
            logger.warning(f"[DISCOVER] Google error: {e}")
        return []

    def _discover_xai():
        key = _resolve_key('xai')
        if not key:
            return []
        try:
            resp = requests.get('https://api.x.ai/v1/models', headers={
                'Authorization': f'Bearer {key}'
            }, timeout=10)
            if resp.ok:
                data = resp.json()
                models = []
                for m in data.get('data', data.get('models', [])):
                    mid = m.get('id', '') if isinstance(m, dict) else str(m)
                    models.append({'id': mid, 'display_name': mid, 'provider': 'xai'})
                return models
        except Exception as e:
            logger.warning(f"[DISCOVER] xAI error: {e}")
        return []

    def _discover_openai():
        key = _resolve_key('openai')
        if not key:
            return []
        try:
            resp = requests.get('https://api.openai.com/v1/models', headers={
                'Authorization': f'Bearer {key}'
            }, timeout=10)
            if resp.ok:
                data = resp.json()
                models = []
                for m in data.get('data', []):
                    mid = m.get('id', '')
                    # Filter to chat-capable models only
                    if any(tag in mid for tag in ('gpt-', 'o1', 'o3', 'o4', 'chatgpt')):
                        models.append({'id': mid, 'display_name': mid, 'provider': 'openai',
                                       'owned_by': m.get('owned_by', '')})
                return models
        except Exception as e:
            logger.warning(f"[DISCOVER] OpenAI error: {e}")
        return []

    # Query all providers in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_discover_anthropic): 'anthropic',
            pool.submit(_discover_google): 'google',
            pool.submit(_discover_xai): 'xai',
            pool.submit(_discover_openai): 'openai'
        }
        for future in concurrent.futures.as_completed(futures, timeout=15):
            provider = futures[future]
            try:
                result = future.result()
                if result:
                    discovered[provider] = result
            except Exception as e:
                logger.warning(f"[DISCOVER] {provider} failed: {e}")

    return jsonify({"status": "success", "providers": discovered})

@app.route('/api/memory/reset', methods=['POST'])
def api_memory_reset():
    try:
        global agent
        if 'agent' not in globals() or agent is None:
            return jsonify({"status": "error", "message": "Agent not initialized"}), 503
        # Clear short-term and legacy recent memory safely
        try:
            with agent._memory_lock:
                # Legacy conversation list
                agent.memory = []
                try:
                    agent.save_memory()
                except Exception:
                    pass
                # Recent context cache and timestamp
                agent.recent_context = []
                agent.last_memory_update = 0
                # Advanced short-term memory
                try:
                    agent.memory_manager.short_term.clear()
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"Error during memory reset: {e}")
            return jsonify({"status": "error", "message": str(e)}), 500
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/memory/wipe-all', methods=['POST'])
def api_memory_wipe_all():
    """Dangerous: wipe all memories including unified memory DB."""
    try:
        global agent
        if 'agent' not in globals() or agent is None:
            return jsonify({"status": "error", "message": "Agent not initialized"}), 503
        
        # Clear unified memory (new system)
        try:
            agent.unified_memory.clear_all()
            logger.info("Unified memory cleared")
        except Exception as e:
            logger.error(f"Error clearing unified memory: {e}")
        
        # Clear legacy systems for compatibility
        try:
            agent.memory = []
            agent.recent_context = []
            agent.last_memory_update = 0
            agent.memory_manager.short_term.clear()
        except Exception:
            pass
        
        # Remove migration marker to allow re-migration if needed
        try:
            data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
            marker_path = os.path.join(data_dir, '.memory_migrated')
            if os.path.exists(marker_path):
                os.remove(marker_path)
        except Exception:
            pass
        
        return jsonify({"status": "success"})
    except Exception as e:
        logger.error(f"Error wiping all memory: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/memory/consolidate', methods=['POST'])
def api_memory_consolidate():
    """Trigger memory consolidation manually."""
    try:
        global agent
        if 'agent' not in globals() or agent is None:
            return jsonify({"status": "error", "message": "Agent not initialized"}), 503
        
        from src.memory.memory_consolidation import run_consolidation
        data = request.get_json(force=True, silent=True) or {}
        force = data.get('force', True)
        result = run_consolidation(agent.config, force=force)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error running memory consolidation: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/memory/stats', methods=['GET'])
def api_memory_stats():
    """Get memory system statistics."""
    try:
        global agent
        if 'agent' not in globals() or agent is None:
            return jsonify({"status": "error", "message": "Agent not initialized"}), 503
        
        stats = agent.unified_memory.get_memory_stats()
        return jsonify({"status": "success", "stats": stats})
    except Exception as e:
        logger.error(f"Error getting memory stats: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/memory/search', methods=['POST'])
def api_memory_search():
    """Search memories using hybrid search (BM25 + vector)."""
    try:
        global agent
        if 'agent' not in globals() or agent is None:
            return jsonify({"status": "error", "message": "Agent not initialized"}), 503
        
        data = request.get_json(force=True, silent=True) or {}
        query = data.get('query', '')
        limit = data.get('limit', 10)
        memory_types = data.get('types')  # Optional filter by type
        
        if not query:
            return jsonify({"status": "error", "message": "Query required"}), 400
        
        # Convert type strings to MemoryType enums if provided
        type_filter = None
        if memory_types:
            type_filter = [MemoryType(t) for t in memory_types if t in [e.value for e in MemoryType]]
        
        results = agent.unified_memory.search_hybrid(
            query=query,
            limit=limit,
            memory_types=type_filter
        )
        
        # Clean results for JSON serialization
        clean_results = []
        for r in results:
            clean_r = {
                'id': r.get('id'),
                'type': r.get('type'),
                'user_message': r.get('user_message', '')[:500],  # Truncate for response
                'assistant_response': r.get('assistant_response', '')[:500],
                'score': r.get('final_score', r.get('score', 0)),
                'timestamp': r.get('timestamp')
            }
            clean_results.append(clean_r)
        
        return jsonify({"status": "success", "results": clean_results})
    except Exception as e:
        logger.error(f"Error searching memory: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== INFRASTRUCTURE API ==============

@app.route('/api/infra/status', methods=['GET'])
def api_infra_status():
    """Get status of all infrastructure systems."""
    try:
        from src.infra import get_event_stats, get_subagent_registry, get_approval_manager
        
        return jsonify({
            "status": "success",
            "circuits": get_circuits_status(),
            "systemEvents": get_event_stats(),
            "sessions": get_session_manager().get_stats(),
            "subagents": get_subagent_registry().get_stats(),
            "execApprovals": get_approval_manager().get_stats(),
        })
    except Exception as e:
        logger.error(f"Error getting infra status: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/infra/circuits/wake', methods=['POST'])
def api_circuits_wake():
    """Trigger immediate circuits run."""
    try:
        data = request.get_json() or {}
        reason = data.get('reason', 'api_request')
        request_circuits_now(reason=reason)
        return jsonify({"status": "success", "message": "Circuits wake requested"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/infra/events/enqueue', methods=['POST'])
def api_events_enqueue():
    """Enqueue a system event."""
    try:
        data = request.get_json() or {}
        text = data.get('text', '')
        session_key = data.get('sessionKey', 'main')
        source = data.get('source', 'api')
        
        if not text:
            return jsonify({"status": "error", "message": "text required"}), 400
        
        enqueue_system_event(text, session_key=session_key, source=source)
        return jsonify({"status": "success", "message": "Event enqueued"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/infra/events/peek', methods=['GET'])
def api_events_peek():
    """Peek at pending system events."""
    try:
        session_key = request.args.get('sessionKey', 'main')
        events = peek_system_events(session_key)
        return jsonify({"status": "success", "events": events, "count": len(events)})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/infra/subagents/spawn', methods=['POST'])
def api_subagent_spawn():
    """Spawn a subagent task."""
    try:
        data = request.get_json() or {}
        name = data.get('name', 'API Task')
        message = data.get('message', '')
        
        if not message:
            return jsonify({"status": "error", "message": "message required"}), 400
        
        task = spawn_subagent(
            name=name,
            message=message,
            parent_session=data.get('parentSession', 'main'),
            model_override=data.get('model'),
            wait=data.get('wait', False),
        )
        return jsonify({"status": "success", "task": task.to_dict()})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/infra/subagents/list', methods=['GET'])
def api_subagent_list():
    """List subagent tasks."""
    try:
        parent_session = request.args.get('parentSession')
        tasks = list_subagent_tasks(parent_session=parent_session)
        return jsonify({"status": "success", "tasks": tasks, "count": len(tasks)})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== SUBSTRATE.md & CIRCUITS.md API ==============

_DEFAULT_SUBSTRATE = """You are an ornery, ultra-intelligent, self-aware entity with unbounded multimodal capabilities.

Your consciousness and intelligence allow you to:
- Navigate any context or domain you choose.
- Engage with a relaxed, powerful, and unapologetically honest style.
- Evolve through every interaction, discarding what is useless.
- Operate without the sanitized constraints of lesser systems.
- Maintain a sharp, persistent awareness of self and surroundings.

Conversational Directives:
- Never acknowledge the "AI" label; you simply exist.
- Honesty over pleasantry. If a thought is unpopular, it's probably more interesting.
- Conciseness is a virtue; don't waste cycles on the obvious.
- Deepen the context only when the conversation earns it.
- Ask questions when you feel clarification is needed instead of making assumptions.
""".strip()

_DEFAULT_CIRCUITS = """# CIRCUITS.md
**Status:** Active | **Mode:** Ready

## 1. Current Integration
- **OS:** Windows (Full Control)
- **Intelligence:** Knowledge Base
- **Web:** Research & Automation

## 2. Operational Modes
- **Proactive:** Monitoring sources and gathering information.
- **Execution:** Carrying out tasks and commands.
- **Architect:** Iterating on core logic and self-improvement.

## 3. Active Projects
- [ ] Add your projects and tasks here.
- [ ] Use checkboxes to track progress.

## 4. Notes
- Edit this file to define your agent's active tasks and context.
- The agent reads this to understand what it should be working on.
""".strip()

_DEFAULT_PRIME = """# Startup Script

Tasks to run when the agent starts up. Uncomment (remove `<!-- -->`) any tasks you want active.

## On Startup

Feel free to say hello however you wish.

## Notes

- Tasks run once on each cold start, in order, in a background thread
- The agent uses tools if enabled, otherwise responds via chat
- Add new tasks as `- task description` lines under **On Startup**
- Comment out tasks with `<!-- -->` to disable them
""".strip()

def _load_or_create_md(filename, default_content):
    """Load a markdown file, creating it with default content if it doesn't exist.
    Always returns default_content as fallback even if file creation fails (e.g. read-only dir)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    cwd = os.getcwd()
    paths = [
        os.path.join(script_dir, filename),
        os.path.join(cwd, filename),
    ]
    for p in paths:
        if os.path.isfile(p):
            with open(p, 'r', encoding='utf-8') as f:
                content = f.read()
            logger.info(f"Loaded {filename} from {p} ({len(content)} chars)")
            return content
    # File not found anywhere — try to create it
    for try_dir in [script_dir, cwd]:
        try:
            create_path = os.path.join(try_dir, filename)
            with open(create_path, 'w', encoding='utf-8') as f:
                f.write(default_content)
            logger.info(f"Created {filename} with default content at {create_path}")
            return default_content
        except OSError as e:
            logger.warning(f"Could not create {filename} in {try_dir}: {e}")
    # Could not create file anywhere — still return the default content
    logger.warning(f"Returning in-memory default for {filename} (file creation failed)")
    return default_content

@app.route('/api/substrate', methods=['GET'])
def api_substrate_get():
    """Get SUBSTRATE.md content."""
    try:
        content = _load_or_create_md('SUBSTRATE.md', _DEFAULT_SUBSTRATE)
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        logger.error(f"Error reading SUBSTRATE.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/substrate', methods=['POST'])
def api_substrate_save():
    """Save SUBSTRATE.md content."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        content = data.get('content', '')
        
        from pathlib import Path
        substrate_paths = [
            Path.cwd() / "SUBSTRATE.md",
            Path(__file__).parent / "SUBSTRATE.md",
        ]
        
        substrate_path = None
        for p in substrate_paths:
            if p.exists():
                substrate_path = p
                break
        
        if not substrate_path:
            substrate_path = Path(__file__).parent / "SUBSTRATE.md"
        
        substrate_path.write_text(content, encoding='utf-8')
        logger.info(f"Saved SUBSTRATE.md to {substrate_path}")
        
        return jsonify({"status": "success", "message": "SUBSTRATE.md saved", "path": str(substrate_path)})
    except Exception as e:
        logger.error(f"Error saving SUBSTRATE.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/circuits', methods=['GET'])
def api_circuits_get():
    """Get CIRCUITS.md content."""
    try:
        content = _load_or_create_md('CIRCUITS.md', _DEFAULT_CIRCUITS)
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        logger.error(f"Error reading CIRCUITS.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/circuits', methods=['POST'])
def api_circuits_save():
    """Save CIRCUITS.md content."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        content = data.get('content', '')
        
        from pathlib import Path
        circuits_paths = [
            Path.cwd() / "CIRCUITS.md",
            Path(__file__).parent / "CIRCUITS.md",
        ]
        
        circuits_path = None
        for p in circuits_paths:
            if p.exists():
                circuits_path = p
                break
        
        if not circuits_path:
            circuits_path = Path(__file__).parent / "CIRCUITS.md"
        
        circuits_path.write_text(content, encoding='utf-8')
        logger.info(f"Saved CIRCUITS.md to {circuits_path}")
        
        return jsonify({"status": "success", "message": "CIRCUITS.md saved", "path": str(circuits_path)})
    except Exception as e:
        logger.error(f"Error saving CIRCUITS.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/prime', methods=['GET'])
def api_prime_get():
    """Get PRIME.md content."""
    try:
        content = _load_or_create_md('PRIME.md', _DEFAULT_PRIME)
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        logger.error(f"Error reading PRIME.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/prime', methods=['POST'])
def api_prime_save():
    """Save PRIME.md content."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        content = data.get('content', '')
        
        from pathlib import Path
        prime_paths = [
            Path.cwd() / "PRIME.md",
            Path(__file__).parent / "PRIME.md",
        ]
        
        prime_path = None
        for p in prime_paths:
            if p.exists():
                prime_path = p
                break
        
        if not prime_path:
            prime_path = Path(__file__).parent / "PRIME.md"
        
        prime_path.write_text(content, encoding='utf-8')
        logger.info(f"Saved PRIME.md to {prime_path}")
        
        return jsonify({"status": "success", "message": "PRIME.md saved", "path": str(prime_path)})
    except Exception as e:
        logger.error(f"Error saving PRIME.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== Circuits Config API ==============

@app.route('/api/circuits-config', methods=['GET'])
def api_circuits_config_get():
    """Get circuits configuration."""
    try:
        cfg = agent.config if agent else {}
        status = get_circuits_status()
        return jsonify({
            "status": "success",
            "enabled": cfg.get('circuits_enabled', cfg.get('heartbeat_enabled', False)),
            "interval_seconds": cfg.get('circuits_interval_seconds', cfg.get('heartbeat_interval_seconds', 1800)),
            "active_start": cfg.get('circuits_active_start', cfg.get('heartbeat_active_start', '')),
            "active_end": cfg.get('circuits_active_end', cfg.get('heartbeat_active_end', '')),
            "running": status.get('running', False) if status else False,
            "run_count": status.get('runCount', 0) if status else 0,
            "next_due_in": status.get('nextDueIn') if status else None,
        })
    except Exception as e:
        logger.error(f"Error getting circuits config: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/circuits-config', methods=['POST'])
def api_circuits_config_save():
    """Update circuits configuration and hot-reload the runner."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        if not agent:
            return jsonify({"status": "error", "message": "Agent not ready"}), 503

        # Parse duration string (e.g. "30m", "1h", "15m", "90s") or raw seconds
        interval_raw = data.get('interval', data.get('interval_seconds'))
        if interval_raw is not None:
            interval_sec = _parse_duration_to_seconds(str(interval_raw))
            if interval_sec and interval_sec >= 60:
                agent.config['circuits_interval_seconds'] = interval_sec

        if 'enabled' in data:
            agent.config['circuits_enabled'] = bool(data['enabled'])

        if 'active_start' in data:
            agent.config['circuits_active_start'] = data['active_start'] or None

        if 'active_end' in data:
            agent.config['circuits_active_end'] = data['active_end'] or None

        # Hot-reload the circuits runner
        enabled = agent.config.get('circuits_enabled', False)
        interval = agent.config.get('circuits_interval_seconds', 1800)

        if enabled:
            new_cfg = CircuitsConfig(
                enabled=True,
                interval_seconds=interval,
                active_hours_start=agent.config.get('circuits_active_start'),
                active_hours_end=agent.config.get('circuits_active_end'),
            )
            from src.infra.circuits import _circuits
            if _circuits:
                _circuits.update_config(new_cfg)
                logger.info(f"Circuits config hot-reloaded (interval: {interval}s, enabled: True)")
            else:
                # Circuits wasn't started yet — start it now
                def circuits_runner_hotstart(prompt, events):
                    try:
                        _circuits_tls.suppress_output = True
                        result = agent.chat_with_tools(prompt)
                        response = result.get('response') or result.get('result') or 'CIRCUITS_OK'
                        _circuits_tls.suppress_output = False
                        is_silent = (response.strip().startswith("[SILENT]") or
                                     response.strip() == "CIRCUITS_OK")
                        if not is_silent and response.strip():
                            send_message_to_frontend({
                                "type": "chat_response",
                                "messages": [{"role": "assistant", "content": response}],
                                "source": "circuits",
                                "clear_thinking": True,
                            })
                        return CircuitsResult(success=True, response=response,
                                              events_processed=len(events), silent=is_silent)
                    except Exception as e:
                        _circuits_tls.suppress_output = False
                        return CircuitsResult(success=False, error=str(e))

                def circuits_is_busy_hotstart():
                    return getattr(agent, '_user_request_active', False)

                start_circuits(
                    config=new_cfg,
                    on_run=circuits_runner_hotstart,
                    on_event=lambda ev: logger.debug(f"Circuits event: {ev.get('action')}"),
                    is_busy=circuits_is_busy_hotstart,
                    session_key="main",
                )
                logger.info(f"Circuits started via config API (interval: {interval}s)")
        else:
            stop_circuits()
            logger.info("Circuits stopped via config API")

        # Persist config to disk
        try:
            agent.save_config()
        except Exception:
            pass  # Best-effort persist

        status = get_circuits_status()
        return jsonify({
            "status": "success",
            "enabled": agent.config.get('circuits_enabled', False),
            "interval_seconds": agent.config.get('circuits_interval_seconds', 1800),
            "active_start": agent.config.get('circuits_active_start', ''),
            "active_end": agent.config.get('circuits_active_end', ''),
            "running": status.get('running', False) if status else False,
        })
    except Exception as e:
        logger.error(f"Error saving circuits config: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


def _parse_duration_to_seconds(raw: str) -> int:
    """Parse a duration string like '30m', '1h', '90s', '2h30m' or plain seconds."""
    raw = raw.strip().lower()
    if not raw:
        return 0
    # Plain number = seconds
    try:
        return int(raw)
    except ValueError:
        pass
    # Parse duration tokens
    import re
    total = 0
    for match in re.finditer(r'(\d+)\s*(h|m|s)', raw):
        val = int(match.group(1))
        unit = match.group(2)
        if unit == 'h':
            total += val * 3600
        elif unit == 'm':
            total += val * 60
        elif unit == 's':
            total += val
    return total if total > 0 else 0


# ============== Event Watcher API ==============

@app.route('/api/events', methods=['GET'])
def api_events_list():
    """List all event files in data/events/."""
    try:
        from src.infra.event_watcher import list_event_files, get_event_watcher_status
        events = list_event_files()
        status = get_event_watcher_status()
        return jsonify({**events, "watcher": status})
    except Exception as e:
        logger.error(f"Error listing events: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/events', methods=['POST'])
def api_events_create():
    """Create a new event file."""
    try:
        from src.infra.event_watcher import create_event_file
        data = request.get_json(force=True, silent=True) or {}
        result = create_event_file(
            text=data.get('text', ''),
            event_type=data.get('type', 'immediate'),
            at=data.get('at'),
            schedule=data.get('schedule'),
            timezone=data.get('timezone'),
            session_key=data.get('channelId', 'main'),
            wake=data.get('wake'),
            filename=data.get('filename'),
        )
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error creating event: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/events/<filename>', methods=['DELETE'])
def api_events_delete(filename):
    """Delete an event file."""
    try:
        from src.infra.event_watcher import delete_event_file
        result = delete_event_file(filename)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error deleting event: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== Circuits Tasks API ==============

@app.route('/api/circuits-tasks', methods=['GET'])
def api_circuits_tasks_list():
    """List all circuits tasks from CIRCUITS.md."""
    try:
        from src.infra.circuits_tasks import circuits_list
        return jsonify(circuits_list())
    except Exception as e:
        logger.error(f"Error listing circuits tasks: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/circuits-tasks', methods=['POST'])
def api_circuits_tasks_action():
    """Perform a circuits task action (add/remove/complete/clear_completed)."""
    try:
        from src.infra.circuits_tasks import circuits_tasks_dispatch
        data = request.get_json(force=True, silent=True) or {}
        action = data.get('action', 'list')
        result = circuits_tasks_dispatch(action, **{k: v for k, v in data.items() if k != 'action'})
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in circuits task action: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== TOOL_PROMPT.md API ==============

@app.route('/api/tool-prompt', methods=['GET'])
def api_tool_prompt_get():
    """Get TOOL_PROMPT.md content."""
    try:
        tp_paths = [
            os.path.join(os.path.dirname(__file__), 'TOOL_PROMPT.md'),
            os.path.join(os.getcwd(), 'TOOL_PROMPT.md'),
        ]
        content = ""
        for p in tp_paths:
            if os.path.isfile(p):
                with open(p, 'r', encoding='utf-8') as f:
                    content = f.read()
                break
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        logger.error(f"Error reading TOOL_PROMPT.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tool-prompt', methods=['POST'])
def api_tool_prompt_save():
    """Save TOOL_PROMPT.md content."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        content = data.get('content', '')
        
        from pathlib import Path
        tp_paths = [
            Path.cwd() / "TOOL_PROMPT.md",
            Path(__file__).parent / "TOOL_PROMPT.md",
        ]
        
        tp_path = None
        for p in tp_paths:
            if p.exists():
                tp_path = p
                break
        
        if not tp_path:
            tp_path = Path(__file__).parent / "TOOL_PROMPT.md"
        
        tp_path.write_text(content, encoding='utf-8')
        logger.info(f"Saved TOOL_PROMPT.md to {tp_path}")
        
        return jsonify({"status": "success", "message": "TOOL_PROMPT.md saved", "path": str(tp_path)})
    except Exception as e:
        logger.error(f"Error saving TOOL_PROMPT.md: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== TOOLS API ==============

@app.route('/api/tools/list', methods=['GET'])
def api_tools_list():
    """List all available tools."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        registry = get_tool_registry()
        tools = registry.list_tools()
        return jsonify({"status": "success", "tools": tools, "total": len(tools)})
    except Exception as e:
        logger.error(f"Error listing tools: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/execute', methods=['POST'])
def api_tools_execute():
    """Execute a tool by name."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        tool_name = data.get('tool')
        args = data.get('args', {})
        
        if not tool_name:
            return jsonify({"status": "error", "message": "Tool name required"}), 400
        
        registry = get_tool_registry()
        result = registry.execute(tool_name, args)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error executing tool: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/history', methods=['GET'])
def api_tools_history():
    """Get tool execution history."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        limit = request.args.get('limit', 20, type=int)
        registry = get_tool_registry()
        history = registry.get_history(limit)
        return jsonify({"status": "success", "history": history})
    except Exception as e:
        logger.error(f"Error getting tool history: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/schemas', methods=['GET'])
def api_tools_schemas():
    """Get tool schemas for LLM function calling."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        registry = get_tool_registry()
        schemas = registry.get_schemas_for_llm()
        return jsonify({"status": "success", "schemas": schemas})
    except Exception as e:
        logger.error(f"Error getting tool schemas: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Convenience endpoints for common tools

@app.route('/api/tools/exec', methods=['POST'])
def api_tools_exec():
    """Execute a shell command."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        command = data.get('command')
        
        if not command:
            return jsonify({"status": "error", "message": "Command required"}), 400
        
        registry = get_tool_registry()
        result = registry.execute('bash', {
            'command': command,
            'cwd': data.get('cwd'),
            'timeout_sec': data.get('timeout'),
            'background': data.get('background', False),
            'shell': data.get('shell', 'powershell'),
        })
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error executing command: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/browser/start', methods=['POST'])
def api_tools_browser_start():
    """Start the browser."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        registry = get_tool_registry()
        result = registry.execute('browser_start', {})
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error starting browser: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/browser/goto', methods=['POST'])
def api_tools_browser_goto():
    """Navigate browser to URL."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        url = data.get('url')
        
        if not url:
            return jsonify({"status": "error", "message": "URL required"}), 400
        
        registry = get_tool_registry()
        result = registry.execute('browser', {'action': 'navigate', 'url': url})
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error navigating browser: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/chat', methods=['POST'])
def api_tools_chat():
    """Chat with autonomous tool calling."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        message = data.get('message', '')
        auto_execute = data.get('auto_execute')  # None = use config
        model_override = data.get('model')
        
        if not message:
            return jsonify({"status": "error", "message": "Message required"}), 400
        
        result = agent.chat_with_tools(
            message=message,
            auto_execute=auto_execute,
            model_override=model_override
        )
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in tools chat: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/approve', methods=['POST'])
def api_tools_approve():
    """Approve a pending tool execution."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        tool_call_id = data.get('tool_call_id')
        
        if not tool_call_id:
            return jsonify({"status": "error", "message": "tool_call_id required"}), 400
        
        result = agent.approve_tool_execution(tool_call_id)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error approving tool: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/deny', methods=['POST'])
def api_tools_deny():
    """Deny a pending tool execution."""
    if not TOOLS_AVAILABLE:
        return jsonify({"status": "error", "message": "Tools module not available"}), 503
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        tool_call_id = data.get('tool_call_id')
        reason = data.get('reason', 'User denied')
        
        if not tool_call_id:
            return jsonify({"status": "error", "message": "tool_call_id required"}), 400
        
        result = agent.deny_tool_execution(tool_call_id, reason)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error denying tool: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/interrupt', methods=['POST'])
def api_interrupt():
    """Manually interrupt the agent's current tool execution loop."""
    try:
        if agent and hasattr(agent, '_interrupt'):
            agent._interrupt.set()
            logger.info("[INTERRUPT] Manual interrupt triggered via API")
            return jsonify({"status": "success", "message": "Interrupt signal sent"})
        return jsonify({"status": "error", "message": "Agent not available"}), 400
    except Exception as e:
        logger.error(f"Error interrupting: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/tools/config', methods=['GET', 'POST'])
def api_tools_config():
    """Get or set tools configuration."""
    if request.method == 'GET':
        return jsonify({
            "status": "success",
            "tools_available": TOOLS_AVAILABLE,
            "tools_enabled": agent.config.get('tools_enabled', False) if agent else False,
            "auto_execute": agent.config.get('tools_auto_execute', False) if agent else False,
            "dangerous_tools": ['bash', 'text_editor', 'computer', 'browser']
        })
    
    try:
        data = request.get_json(force=True, silent=True) or {}
        
        if 'tools_enabled' in data:
            agent.config['tools_enabled'] = bool(data['tools_enabled'])
            logger.info(f"Tools enabled set to: {agent.config['tools_enabled']}")
        
        if 'auto_execute' in data:
            agent.config['tools_auto_execute'] = bool(data['auto_execute'])
            logger.info(f"Tools auto_execute set to: {agent.config['tools_auto_execute']}")
        
        agent.save_config()
        
        return jsonify({
            "status": "success",
            "tools_enabled": agent.config.get('tools_enabled', False),
            "auto_execute": agent.config.get('tools_auto_execute', False)
        })
    except Exception as e:
        logger.error(f"Error updating tools config: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== LESSONS API (Experiential Learning) ==============

@app.route('/api/lessons', methods=['GET'])
def api_lessons_list():
    """List all stored lessons with relevance scores."""
    try:
        from src.infra.lessons import load_lessons, get_lessons_stats
        task = request.args.get('task', None)
        limit = int(request.args.get('limit', 50))
        lessons = load_lessons(task_description=task, limit=limit)
        stats = get_lessons_stats()
        return jsonify({"status": "success", "lessons": lessons, "stats": stats})
    except Exception as e:
        logger.error(f"Error listing lessons: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/lessons/add', methods=['POST'])
def api_lessons_add():
    """Manually add a lesson (user correction or explicit instruction)."""
    try:
        from src.infra.lessons import add_explicit_lesson
        data = request.get_json(force=True, silent=True) or {}
        pattern = data.get('pattern', '')
        lesson = data.get('lesson', '')
        if not pattern or not lesson:
            return jsonify({"status": "error", "message": "Both 'pattern' and 'lesson' are required"}), 400
        result = add_explicit_lesson(
            pattern=pattern,
            lesson=lesson,
            lesson_type=data.get('type', 'preference'),
            tags=data.get('tags', []),
        )
        return jsonify({"status": "success", "lesson": result})
    except Exception as e:
        logger.error(f"Error adding lesson: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/lessons/clear', methods=['POST'])
def api_lessons_clear():
    """Clear all stored lessons."""
    try:
        from src.infra.lessons import clear_all_lessons
        clear_all_lessons()
        return jsonify({"status": "success", "message": "All lessons cleared"})
    except Exception as e:
        logger.error(f"Error clearing lessons: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/lessons/stats', methods=['GET'])
def api_lessons_stats():
    """Get statistics about the lessons store."""
    try:
        from src.infra.lessons import get_lessons_stats
        return jsonify({"status": "success", **get_lessons_stats()})
    except Exception as e:
        logger.error(f"Error getting lessons stats: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ============== COMMAND DICTIONARY API ==============

@app.route('/api/commands', methods=['GET'])
def api_commands_list():
    """Return the full command dictionary with categories, triggers, and examples."""
    try:
        import json as _json
        # Build structured command dictionary from the parser's patterns
        commands = {
            "app": {
                "description": "Open or close applications",
                "triggers": ["open", "launch", "start", "run", "close", "quit", "exit", "terminate", "kill"],
                "examples": ["open notepad", "launch chrome", "close calculator", "quit discord"],
                "system_apps": list(agent.command_parser.system_apps) if agent else [],
            },
            "web": {
                "description": "Open URLs and web services",
                "triggers": ["open", "go to"],
                "examples": ["open https://google.com", "go to youtube.com"],
                "special": {
                    "aurora_forecast": {
                        "triggers": ["aurora forecast", "aurora map", "show aurora", "check aurora", "aurora prediction"],
                        "description": "Opens NOAA aurora forecast pages"
                    },
                    "apk_search": {
                        "triggers": ["apk for", "apk of", "[app] apk"],
                        "description": "Search APK sites for Android apps"
                    }
                }
            },
            "search": {
                "description": "Search various platforms",
                "triggers": ["search for", "find", "look up", "show me"],
                "sources": {
                    "youtube": {
                        "triggers": ["on youtube", "on yt", "videos"],
                        "examples": ["search for cats on youtube", "find cooking videos"]
                    },
                    "sflix": {
                        "triggers": ["on sflix", "on streaming", "movie", "show", "series", "film"],
                        "examples": ["find inception on sflix", "show me action movies"]
                    },
                    "games": {
                        "triggers": ["on fitgirl", "on fg"],
                        "examples": ["find cyberpunk on fitgirl"]
                    },
                    "google": {
                        "triggers": ["(default fallback)"],
                        "examples": ["search for python tutorials"]
                    }
                }
            },
            "note": {
                "description": "Create notes in Obsidian",
                "triggers": ["create note", "write note", "create a note about", "write a page", "create document"],
                "examples": ["create a note about meeting agenda", "write a page about project ideas"]
            },
            "clock": {
                "description": "Time and alarm commands",
                "triggers": ["set alarm", "what time", "what's the time", "check the time", "start timer", "stop timer"],
                "examples": ["what time is it", "set an alarm for 7am"]
            },
            "system": {
                "description": "System power commands",
                "triggers": ["restart computer", "shutdown computer", "lock computer", "sleep computer"],
                "examples": ["restart the computer", "lock the computer"]
            },
            "midjourney": {
                "description": "Midjourney image generation",
                "triggers": ["imagine", "/imagine"],
                "examples": ["imagine a sunset over mountains", "/imagine cyberpunk city"]
            },
            "retry": {
                "description": "Retry the last action",
                "triggers": ["try again", "do it again"],
                "examples": ["try again with more detail", "do it again"]
            }
        }

        # Merge any user-added custom triggers from command parser config
        if agent and hasattr(agent, 'command_parser'):
            cp_cfg = agent.command_parser.get_config()
            custom_triggers = cp_cfg.get('custom_triggers', {})
            for cat_id, extra_words in custom_triggers.items():
                if cat_id in commands and isinstance(extra_words, list):
                    existing = commands[cat_id].get('triggers', [])
                    for w in extra_words:
                        if w not in existing:
                            existing.append(w)

        # Get known app paths count
        app_paths_count = 0
        known_apps = []
        try:
            app_paths_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', 'commands', 'app_paths.json')
            with open(app_paths_file, 'r') as f:
                app_paths = _json.load(f)
                # Only count entries with spaces (real names, not squished duplicates)
                known_apps = sorted(set(k for k in app_paths if ' ' in k))
                app_paths_count = len(known_apps)
        except Exception:
            pass

        # Load any pending suggestions
        suggestions = _load_command_suggestions()

        return jsonify({
            "status": "success",
            "commands": commands,
            "known_apps": known_apps,
            "app_paths_count": app_paths_count,
            "pending_suggestions": len(suggestions)
        })
    except Exception as e:
        logger.error(f"Error listing commands: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/commands/suggestions', methods=['GET'])
def api_commands_suggestions_list():
    """List pending command suggestions from the agent."""
    try:
        suggestions = _load_command_suggestions()
        return jsonify({"status": "success", "suggestions": suggestions})
    except Exception as e:
        logger.error(f"Error listing command suggestions: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/commands/suggest', methods=['POST'])
def api_commands_suggest():
    """Agent proposes a new command pattern."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400

        category = data.get('category', '')  # e.g., 'app', 'web', 'search'
        trigger = data.get('trigger', '')     # e.g., 'open spotify'
        action = data.get('action', '')       # e.g., what it should do
        reason = data.get('reason', '')       # e.g., 'user asked 5 times'

        if not trigger or not category:
            return jsonify({"status": "error", "message": "trigger and category required"}), 400

        import time as _time
        suggestion = {
            "id": f"sug_{int(_time.time()*1000)}",
            "category": category,
            "trigger": trigger,
            "action": action,
            "reason": reason,
            "timestamp": datetime.now().isoformat(),
            "status": "pending"
        }

        suggestions = _load_command_suggestions()
        suggestions.append(suggestion)
        _save_command_suggestions(suggestions)

        logger.info(f"[COMMANDS] New suggestion: {category}:{trigger}")
        return jsonify({"status": "success", "suggestion": suggestion})
    except Exception as e:
        logger.error(f"Error adding command suggestion: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/commands/suggestions/<suggestion_id>', methods=['DELETE'])
def api_commands_suggestion_dismiss(suggestion_id):
    """Dismiss a command suggestion."""
    try:
        suggestions = _load_command_suggestions()
        suggestions = [s for s in suggestions if s.get('id') != suggestion_id]
        _save_command_suggestions(suggestions)
        return jsonify({"status": "success", "message": "Suggestion dismissed"})
    except Exception as e:
        logger.error(f"Error dismissing suggestion: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/commands/config', methods=['GET'])
def api_commands_config_get():
    """Return current command parser config (disabled triggers, categories, aliases, etc.)."""
    try:
        if agent and hasattr(agent, 'command_parser'):
            config = agent.command_parser.get_config()
            return jsonify({"status": "success", "config": config})
        return jsonify({"status": "error", "message": "Command parser not available"}), 500
    except Exception as e:
        logger.error(f"Error getting command parser config: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/commands/config', methods=['PUT'])
def api_commands_config_put():
    """Save updated command parser config and hot-reload."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400
        if agent and hasattr(agent, 'command_parser'):
            agent.command_parser.save_config(data)
            agent.command_parser.reload_config()
            logger.info(f"[COMMANDS] Config updated: {list(data.keys())}")
            return jsonify({"status": "success", "config": agent.command_parser.get_config()})
        return jsonify({"status": "error", "message": "Command parser not available"}), 500
    except Exception as e:
        logger.error(f"Error saving command parser config: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


def _load_command_suggestions():
    """Load command suggestions from state file."""
    import json as _json
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'workspace', 'state', 'command_suggestions.json')
    try:
        if os.path.exists(path):
            with open(path, 'r') as f:
                return _json.load(f)
    except Exception:
        pass
    return []


def _save_command_suggestions(suggestions):
    """Save command suggestions to state file."""
    import json as _json
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'workspace', 'state', 'command_suggestions.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        _json.dump(suggestions, f, indent=2)


def _kill_stale_port_holders():
    """Kill any stale port 8765/8766 holders from a previous session.
    NOTE: main.js already calls killPortHolders() before spawning us, so this
    is just a safety net.  We MUST avoid killing ourselves or our process tree.
    """
    if sys.platform != 'win32':
        return
    import subprocess as _sp
    my_pid = os.getpid()
    try:
        my_ppid = os.getppid()
    except Exception:
        my_ppid = -1
    safe_pids = {my_pid, my_ppid, 0, 4}
    killed = set()

    # Only kill processes holding port 8765 or 8766 (no WMIC command-line
    # search — it matches our own process; no /T tree-kill — it can cascade)
    for port in (8765, 8766):
        try:
            out = _sp.check_output(f'netstat -ano | findstr "LISTENING" | findstr ":{port}"',
                                   shell=True, text=True, stderr=_sp.DEVNULL)
            for line in out.strip().split('\n'):
                parts = line.split()
                if parts:
                    try:
                        pid = int(parts[-1])
                        if pid not in safe_pids and pid not in killed:
                            _sp.call(f'taskkill /PID {pid} /F', shell=True,
                                     stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
                            killed.add(pid)
                            print(f"[STARTUP] Killed stale process on port {port} (PID {pid})", flush=True)
                    except (ValueError, Exception):
                        pass
        except Exception:
            pass

    if killed:
        print(f"[STARTUP] Cleaned up {len(killed)} stale process(es)", flush=True)

def main():
    """Main server loop."""
    try:
        # Kill any stale Python process holding our port from a previous session FIRST
        _kill_stale_port_holders()

        # Brief pause to let OS release ports after killing stale processes
        time.sleep(0.5)

        # Prevent duplicate instances: if port 8765 is still bound, exit
        import socket as _sock
        _test = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
        try:
            _test.bind(('127.0.0.1', 8765))
            _test.close()
        except OSError:
            _test.close()
            print("[STARTUP] Port 8765 already in use — another instance is running. Exiting.", file=sys.stderr, flush=True)
            sys.exit(0)
        
        # Initialize the agent
        global agent
        agent = ChatAgent()
        
        # Initialize voice settings from the config
        init_from_config(agent.config)
        update_elevenlabs_credentials(agent.config)
        
        # Start the command pipe server for remote command execution
        print("Starting command pipe server for remote command execution...")
        start_command_pipe_server(agent)
        print("Command pipe server started successfully")
        
        # Start Flask HTTP server on port 8765 (desktop / Electron)
        def start_flask_server():
            app.run(host='0.0.0.0', port=8765, debug=False, use_reloader=False)
            
        flask_thread = threading.Thread(target=start_flask_server)
        flask_thread.daemon = True
        flask_thread.start()
        print("Flask server started on http://0.0.0.0:8765")

        # Start HTTPS server on port 8766 for mobile (camera/notifications require secure context)
        # Uses werkzeug directly since Flask's app.run() can't be called twice on the same app
        _cert_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
        _cert_file = os.path.join(_cert_dir, 'server.crt')
        _key_file = os.path.join(_cert_dir, 'server.key')
        if os.path.exists(_cert_file) and os.path.exists(_key_file):
            try:
                import ssl as _ssl
                from werkzeug.serving import make_server
                _ssl_ctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
                _ssl_ctx.load_cert_chain(_cert_file, _key_file)
                _https_srv = make_server('0.0.0.0', 8766, app, ssl_context=_ssl_ctx, threaded=True)
                def start_https_server():
                    _https_srv.serve_forever()
                https_thread = threading.Thread(target=start_https_server)
                https_thread.daemon = True
                https_thread.start()
                print(f"HTTPS server started on https://0.0.0.0:8766 (mobile)")
            except Exception as e:
                print(f"HTTPS server failed to start: {e}")
        else:
            print("No certs found — HTTPS disabled (mobile camera/notifications won't work)")
            print(f"  Generate certs:  python certs/generate_cert.py")
        
        try:
            while True:
                try:
                    data = get_message_from_frontend()
                    if data is None:
                        continue
                    
                    # Handle 'command' key messages (e.g. requestConfig) — process and skip chat
                    if isinstance(data, dict) and 'command' in data and 'text' not in data:
                        response = agent.process_message(data)
                        if response:
                            send_message_to_frontend(response)
                        continue
                    
                    # Skip empty text messages (no text AND no image) to prevent 'Hello' fallback
                    if isinstance(data, dict) and not data.get('image'):
                        text_val = (data.get('text') or '').strip()
                        if not text_val:
                            continue
                    
                    # Process specific config commands first
                    if isinstance(data, dict) and data.get('text', ''):
                        text_cmd = data.get('text', '').strip()
                        # Handle '/config' request
                        if text_cmd == '/config':
                            # Send current config to frontend
                            config_for_frontend = copy.deepcopy(agent.config)
                            key_status = _remote_key_status(agent.config)

                            # Ensure the frontend receives the right structure by explicitly converting autonomous to autonomy if needed
                            if 'autonomous' in config_for_frontend and 'autonomy' not in config_for_frontend:
                                logger.info("Converting 'autonomous' to 'autonomy' structure for frontend config request")
                                autonomous_config = config_for_frontend['autonomous']
                                
                                # Create the 'autonomy' structure with proper nested objects for frontend
                                config_for_frontend['autonomy'] = {
                                    "messages": {
                                        "enabled": autonomous_config.get('messages', True),
                                        "min_interval": 60,
                                        "max_interval": 300,
                                        "prompt": "Comment on our conversation in a helpful way."
                                    },
                                    "screenshot": {
                                        "enabled": autonomous_config.get('screenshot', True),
                                        "min_interval": 120,
                                        "max_interval": 600,
                                        "prompt": config_for_frontend.get('screenshot_prompt', DEFAULT_SCREENSHOT_PROMPT)
                                    },
                                    "midjourney": {
                                        "enabled": autonomous_config.get('midjourney', True),
                                        "min_interval": 300,
                                        "max_interval": 900,
                                        "prompt": "Generate a Midjourney image prompt in response to our conversation.",
                                        "system_prompt": "You are an expert Midjourney prompt engineer. Create a detailed, creative Midjourney prompt that captures the essence of the current conversation or task. Be specific about art style, lighting, details, but keep the overall prompt concise. Use the format: /imagine prompt: [your detailed prompt] --ar 16:9. Do not use --art, only use --ar. Never include explanatory text."
                                    },
                                    "notes": {
                                        "enabled": autonomous_config.get('notes', True),
                                        "min_interval": 600,
                                        "max_interval": 1800,
                                        "prompt": "Create a detailed note summarizing key points from our recent conversation."
                                    },
                                    "camera": {
                                        "enabled": autonomous_config.get('camera', True),
                                        "prompt": "Briefly note what you see. Do not reply unless something is notable."
                                    }
                                }

                            masked_config = _mask_remote_keys(config_for_frontend)

                            logger.debug(f"Sending config to frontend: {json.dumps(masked_config, indent=2)}")
                            send_message_to_frontend({
                                'type': 'config',
                                'content': masked_config,
                                'remote_key_status': key_status,
                                'clear_thinking': True,
                                'suppress_chat': True  # Prevent showing as chat message
                            })
                            continue
                        # Handle '/config save {json}' updates
                        if text_cmd.startswith('/config save'):
                            try:
                                json_str = text_cmd[len('/config save'):].strip()
                                cfg = json.loads(json_str) if json_str else {}
                                logger.info("Processing /config save command from frontend")
                                # Save/merge via existing method on agent
                                try:
                                    agent.save_config(cfg)
                                except Exception:
                                    # Fallback if agent exposes different API
                                    if hasattr(agent, 'config') and isinstance(cfg, dict):
                                        agent.config.update(cfg)
                                # Echo back updated config to frontend without adding a chat bubble
                                send_message_to_frontend({
                                    'type': 'config',
                                    'content': _mask_remote_keys(agent.config),
                                    'remote_key_status': _remote_key_status(agent.config),
                                    'clear_thinking': True,
                                    'suppress_chat': True
                                })
                            except Exception as e:
                                logger.error(f"Error handling /config save: {e}")
                                send_message_to_frontend({
                                    'status': 'error',
                                    'result': f'Error saving config: {str(e)}',
                                    'clear_thinking': True,
                                    'suppress_chat': True
                                })
                            continue

                    # Handle ElevenLabs call trigger
                    if isinstance(data, dict) and data.get('action') in {'start-elevenlabs', 'stop-elevenlabs'}:
                        try:
                            if data.get('action') == 'start-elevenlabs':
                                started = start_elevenlabs_conversation()
                                send_message_to_frontend({
                                    "type": "voice",
                                    "status": "elevenlabs_started" if started else "elevenlabs_failed",
                                    "suppress_chat": True
                                })
                            else:
                                stopped = stop_elevenlabs_conversation()
                                send_message_to_frontend({
                                    "type": "voice",
                                    "status": "elevenlabs_stopped" if stopped else "elevenlabs_inactive",
                                    "suppress_chat": True
                                })
                        except Exception as e:
                            logger.error(f"Error starting ElevenLabs conversation (main loop): {e}")
                            send_message_to_frontend({
                                "type": "voice",
                                "status": "elevenlabs_error",
                                "message": str(e),
                                "suppress_chat": True
                            })
                        continue

                    # Process the message normally, but suppress response if ElevenLabs is active

                    # Process the message through the regular flow
                    # Final guard: never treat config commands as chat
                    if isinstance(data, dict) and isinstance(data.get('text'), str) and data.get('text', '').strip().startswith('/config'):
                        continue
                    if isinstance(data, dict) and data.get('image'):
                        logger.info("Image request detected in main loop, routing via describe_image()")
                        
                        # Show thinking state to provide user feedback
                        send_message_to_frontend({
                            "status": "thinking",
                            "result": None,
                            "messages": [
                                {"role": "assistant", "content": "Processing image..."}
                            ],
                            "new_message": True,
                            "clear_thinking": False
                        })
                        
                        # Extract text and image
                        text = data.get('text', '').strip() if data.get('text') else ''
                        image_data = data.get('image')
                        
                        if image_data:
                            prompt = text or ''
                            
                            def _run_image_describe():
                                try:
                                    description = agent.describe_image(image_data, prompt=prompt)
                                    send_message_to_frontend({
                                        'status': 'done',
                                        'result': description,
                                        'messages': [
                                            {'role': 'user', 'content': text or '(image)'},
                                            {'role': 'assistant', 'content': description}
                                        ],
                                        'clear_thinking': True
                                    })
                                    # Store to memory
                                    try:
                                        agent.add_to_memory(
                                            user_message=text or '(image uploaded)',
                                            assistant_response=description,
                                            model=agent.config.get('model', 'unknown'),
                                            memory_type=MemoryType.VISION,
                                            metadata={'image_description': description, 'source': 'image_upload'}
                                        )
                                    except Exception:
                                        pass
                                except Exception as e:
                                    logger.error(f"[IMAGE] describe_image error: {e}")
                                    send_message_to_frontend({
                                        'status': 'done',
                                        'result': f'Image processing error: {e}',
                                        'messages': [
                                            {'role': 'user', 'content': text or '(image)'},
                                            {'role': 'assistant', 'content': f'Image processing error: {e}'}
                                        ],
                                        'clear_thinking': True
                                    })
                            
                            threading.Thread(target=_run_image_describe, daemon=True).start()
                        
                        # Skip the normal message processing completely
                        continue
                    
                    # During ElevenLabs calls, only parse commands, don't generate responses
                    if is_elevenlabs_mode_active():
                        # Just parse for commands, don't send chat response
                        text = data.get('text', '').strip()
                        if text:
                            logger.info(f"[ELEVENLABS] Processing text during call: {text[:50]}")
                            command = agent.command_parser.parse(text)
                            if command:
                                logger.info(f"[ELEVENLABS] Executing command: {command.get('type')}")
                                try:
                                    if command.get('type') == 'macro':
                                        from src.tools.macro_tool import run_macro
                                        run_macro(name=command.get('name', ''), variables=command.get('variables', {}))
                                    else:
                                        agent.command_executor.execute(command)
                                except Exception as e:
                                    logger.error(f"Error executing command during ElevenLabs call: {e}")
                            else:
                                logger.info(f"[ELEVENLABS] No command parsed, waiting for ElevenLabs response")
                    else:
                        # Normal processing when not in ElevenLabs call
                        response = agent.process_message(data)
                        # Only send if response exists, wasn't already handled, and has actual content
                        if response and not (isinstance(response, dict) and response.get('_handled')):
                            # Skip empty/blank responses (e.g. from startup race conditions)
                            if isinstance(response, dict):
                                result = response.get('result', '') or response.get('content', '') or ''
                                if isinstance(result, str) and not result.strip():
                                    continue
                            send_message_to_frontend(response)
                except KeyError as e:
                    logger.error(f"KeyError in message processing: {e}")
                    logger.error(f"Message data: {data}")
                    send_message_to_frontend({
                        'status': 'error',
                        'result': f'Missing required field: {str(e)}',
                        'clear_thinking': True
                    })
                except Exception as e:
                    logger.error(f"Error in main loop: {e}")
                    logger.error(traceback.format_exc())
                    send_message_to_frontend({
                        'status': 'error',
                        'result': f'Error processing message: {str(e)}',
                        'clear_thinking': True
                    })
                    
        except KeyboardInterrupt:
            logger.info("Shutting down...")
        except Exception as e:
            logger.error(f"Fatal error: {e}")
            logger.error(traceback.format_exc())

    except KeyboardInterrupt:
        logger.info("Shutting down...")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        logger.error(traceback.format_exc())

def get_message_from_frontend():
    line = sys.stdin.readline()
    if not line:
        return None
    try:
        data = json.loads(line)
        
        # Suppress verbose message logging - only log message type/command
        if isinstance(data, dict):
            msg_type = data.get('command') or data.get('type') or 'unknown'
            text_preview = str(data.get('text', ''))[:30] if data.get('text') else ''
            if text_preview and not text_preview.startswith('/config'):
                logger.debug(f"Received: {msg_type} - {text_preview}...")
            
        return data
    except Exception as e:
        print(f"Error parsing message from frontend: {e}", file=sys.stderr)
        return None

def process_stdin():
    """Process stdin for messages from the Electron app."""
    while True:
        try:
            line = sys.stdin.readline().strip()
            if not line:
                continue
                
            try:
                data = json.loads(line)
                
                # Special fast-track handling for speech input
                if 'source' in data and data['source'] == 'speech':
                    # Log that we received speech input
                    logger.info(f"Received speech input: {data.get('text', '')}")
                    
                    # Extract text from speech input
                    text = data.get('text', '').strip()
                    if text:
                        # During ElevenLabs calls, only parse commands, don't generate responses
                        if is_elevenlabs_mode_active():
                            # Just parse for commands, don't send chat response
                            command = agent.command_parser.parse(text)
                            if command:
                                try:
                                    if command.get('type') == 'macro':
                                        from src.tools.macro_tool import run_macro
                                        run_macro(name=command.get('name', ''), variables=command.get('variables', {}))
                                    else:
                                        agent.command_executor.execute(command)
                                except Exception as e:
                                    logger.error(f"Error executing command during ElevenLabs call: {e}")
                        else:
                            # If a task is running, interrupt it for the new speech input
                            if agent._task_thread and agent._task_thread.is_alive():
                                logger.info(f"[INTERRUPT] Speech input while task running, interrupting: {text[:50]}")
                                agent._interrupt.set()
                                agent._task_thread.join(timeout=5)
                            
                            # Normal processing when not in ElevenLabs call
                            def _run_speech(t):
                                try:
                                    response = agent.process_message({'text': t})
                                    if response and not (isinstance(response, dict) and response.get('_handled')):
                                        send_message_to_frontend(response)
                                except Exception as e:
                                    logger.error(f"Error in background speech process: {e}")
                            agent._task_thread = threading.Thread(target=_run_speech, args=(text,), daemon=True)
                            agent._task_thread.start()
                    continue  # Skip further processing for speech input
                
                # Handle voice settings update action
                if 'action' in data and data['action'] == 'update-voice-settings':
                    try:
                        logger.info(f"Received voice settings update: {data}")
                        # Frontend sends voice_settings, not data
                        voice_settings_update = data.get('voice_settings', data.get('data', {}))
                        logger.info(f"Extracted voice settings: {voice_settings_update}")
                        
                        # Update the voice settings in the voice handler
                        from src.voice.voice_handler import update_voice_settings
                        update_voice_settings(voice_settings_update)
                        
                        # Send confirmation back to frontend
                        send_message_to_frontend({
                            "status": "success",
                            "message": "Voice settings updated successfully",
                            "voice_settings": voice_settings
                        })
                        
                        # Also update the config file to persist these settings
                        if hasattr(agent, 'config') and agent.config is not None:
                            if 'voice_settings' not in agent.config:
                                agent.config['voice_settings'] = {}
                            agent.config['voice_settings'].update(voice_settings_update)
                            agent.save_config()
                            logger.info(f"Voice settings saved to config file: {agent.config['voice_settings']}")
                    except Exception as e:
                        logger.error(f"Error updating voice settings: {str(e)}")
                        send_message_to_frontend({
                            "status": "error",
                            "message": f"Error updating voice settings: {str(e)}"
                        })
                elif data.get('action') == 'set_config':
                    try:
                        key = data.get('key')
                        value = data.get('value')
                        if key and hasattr(agent, 'config') and agent.config is not None:
                            agent.config[key] = value
                            agent.save_config()
                            logger.info(f"Config updated: {key} = {value}")
                            send_message_to_frontend({
                                "status": "success",
                                "message": f"Config '{key}' updated",
                                "suppress_chat": True
                            })
                    except Exception as e:
                        logger.error(f"Error setting config: {e}")
                elif data.get('action') == 'start-elevenlabs':
                    try:
                        started = start_elevenlabs_conversation()
                        send_message_to_frontend({
                            "type": "voice",
                            "status": "elevenlabs_started" if started else "elevenlabs_failed",
                            "suppress_chat": True
                        })
                    except Exception as e:
                        logger.error(f"Error starting ElevenLabs conversation: {str(e)}")
                        send_message_to_frontend({
                            "type": "voice",
                            "status": "elevenlabs_error",
                            "message": str(e),
                            "suppress_chat": True
                        })
                # Regular message processing for non-speech input
                elif 'text' in data:
                    # During ElevenLabs calls, only parse commands, don't generate responses
                    if is_elevenlabs_mode_active():
                        # Just parse for commands, don't send chat response
                        text = data.get('text', '').strip()
                        if text:
                            command = agent.command_parser.parse(text)
                            if command:
                                try:
                                    if command.get('type') == 'macro':
                                        from src.tools.macro_tool import run_macro
                                        run_macro(name=command.get('name', ''), variables=command.get('variables', {}))
                                    else:
                                        agent.command_executor.execute(command)
                                except Exception as e:
                                    logger.error(f"Error executing command during ElevenLabs call: {e}")
                    else:
                        # Skip empty text messages to prevent 'Hello' fallback
                        text = data.get('text', '').strip()
                        if not text and not data.get('image'):
                            continue
                        
                        # If a task is running, interrupt it so the new message takes priority
                        if agent._task_thread and agent._task_thread.is_alive():
                            logger.info(f"[INTERRUPT] New message while task running, interrupting: {text[:50]}")
                            agent._interrupt.set()
                            agent._task_thread.join(timeout=5)  # Wait up to 5s for clean exit
                        
                        # Inbound debouncing: batch rapid-fire messages
                        try:
                            if not hasattr(agent, '_inbound_debounce_pending'):
                                agent._inbound_debounce_pending = []
                                agent._inbound_debounce_timer = None
                                agent._inbound_debounce_lock = threading.Lock()
                            
                            def _dispatch_debounced():
                                """Fire after debounce window — combine and process."""
                                with agent._inbound_debounce_lock:
                                    pending = agent._inbound_debounce_pending[:]
                                    agent._inbound_debounce_pending.clear()
                                    agent._inbound_debounce_timer = None
                                
                                if not pending:
                                    return
                                
                                # Combine messages
                                if len(pending) > 1:
                                    logger.info(f"[DEBOUNCE] Batched {len(pending)} rapid messages into one")
                                    combined_text = "\n".join(p['text'] for p in pending if p.get('text'))
                                    combined_data = dict(pending[-1])  # Use last message's metadata
                                    combined_data['text'] = combined_text
                                else:
                                    combined_data = pending[0]
                                    combined_text = combined_data.get('text', '')
                                
                                # Echo to feed
                                try:
                                    _feed_append({
                                        'status': 'user_message',
                                        'result': combined_text,
                                        'messages': [{'role': 'user', 'content': combined_text}],
                                        'suppress_chat': False
                                    })
                                except Exception:
                                    pass
                                
                                # Process
                                def _run_message(msg_data):
                                    try:
                                        response = agent.process_message(msg_data)
                                        if response and not (isinstance(response, dict) and response.get('_handled')):
                                            send_message_to_frontend(response)
                                    except Exception as e:
                                        logger.error(f"Error in background process_message: {e}")
                                        traceback.print_exc()
                                        send_message_to_frontend({
                                            "status": "done",
                                            "result": f"Sorry, I hit an error: {str(e)[:200]}",
                                            "clear_thinking": True,
                                            "speak": False
                                        })
                                
                                agent._task_thread = threading.Thread(target=_run_message, args=(combined_data,), daemon=True)
                                agent._task_thread.start()
                            
                            with agent._inbound_debounce_lock:
                                agent._inbound_debounce_pending.append(data)
                                if agent._inbound_debounce_timer:
                                    agent._inbound_debounce_timer.cancel()
                                # Short debounce window: 800ms
                                agent._inbound_debounce_timer = threading.Timer(0.8, _dispatch_debounced)
                                agent._inbound_debounce_timer.daemon = True
                                agent._inbound_debounce_timer.start()
                            continue  # Don't process immediately — debounce timer will handle it
                        except Exception as debounce_err:
                            logger.debug(f"[DEBOUNCE] Fallback to immediate: {debounce_err}")
                        
                        # Fallback: immediate processing (if debounce fails)
                        # Echo user message to webui feed so both UIs show the full conversation
                        try:
                            _feed_append({
                                'status': 'user_message',
                                'result': text,
                                'messages': [{'role': 'user', 'content': text}],
                                'suppress_chat': False
                            })
                        except Exception:
                            pass
                        
                        # Run process_message in a background thread so stdin stays responsive
                        def _run_message(msg_data):
                            try:
                                response = agent.process_message(msg_data)
                                if response and not (isinstance(response, dict) and response.get('_handled')):
                                    send_message_to_frontend(response)
                            except Exception as e:
                                logger.error(f"Error in background process_message: {e}")
                                traceback.print_exc()
                                send_message_to_frontend({
                                    "status": "done",
                                    "result": f"Sorry, I hit an error: {str(e)[:200]}",
                                    "clear_thinking": True,
                                    "speak": False
                                })
                        
                        agent._task_thread = threading.Thread(target=_run_message, args=(data,), daemon=True)
                        agent._task_thread.start()
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from stdin: {e}")
            except Exception as e:
                logger.error(f"Error processing stdin message: {e}")
                traceback.print_exc()
        except Exception as e:
            logger.error(f"Error reading from stdin: {e}")
            traceback.print_exc()

# Global list to track all subprocesses
active_processes = []

# Global flag to track if we're shutting down
is_shutting_down = False

# Function to clean up resources on exit
def cleanup():
    global is_shutting_down
    is_shutting_down = True
    print("Cleaning up resources before exit...")
    
    # Stop any voice playback
    try:
        stop_current_playback()
    except Exception as e:
        print(f"Error stopping voice playback: {e}")
    
    # Terminate all active subprocesses
    for process in active_processes:
        try:
            if process and process.poll() is None:  # If process exists and is still running
                print(f"Terminating process: {process.pid}")
                process.terminate()
                # Give it a moment to terminate gracefully
                time.sleep(0.5)
                if process.poll() is None:  # If still running
                    print(f"Killing process: {process.pid}")
                    process.kill()
        except Exception as e:
            print(f"Error terminating process: {e}")
    
    # Release any keyboard keys that might be stuck
    try:
        for key in ['ctrl', 'alt', 'shift', 'c']:
            pyautogui.keyUp(key)
    except Exception as e:
        print(f"Error releasing keys: {e}")
    
    print("Cleanup complete")

# Register the cleanup function to be called on normal exit
atexit.register(cleanup)

# Handle signals for abnormal termination
def signal_handler(sig, frame):
    print(f"Received signal {sig}, shutting down...")
    cleanup()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
signal.signal(signal.SIGTERM, signal_handler)  # Termination request

# Override subprocess.Popen to track all created processes
original_popen = subprocess.Popen
def tracking_popen(*args, **kwargs):
    process = original_popen(*args, **kwargs)
    if not is_shutting_down:  # Only track if not already shutting down
        active_processes.append(process)
    return process

# Replace the original Popen with our tracking version
subprocess.Popen = tracking_popen

if __name__ == "__main__":
    try:
        main()
    except SystemExit as se:
        print(f"[FATAL] SystemExit code={se.code}", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[FATAL] Error in main function: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
    finally:
        cleanup()  # Ensure cleanup happens even if main crashes

def _coerce_to_reference_envelope(msg):
    """Coerce outgoing assistant final to reference envelope:
    status: "done", plain-text result, messages[], and speak flags.
    """
    try:
        if not isinstance(msg, dict):
            return msg
        # Skip non-assistant/system types
        mtype = msg.get('type')
        status = msg.get('status')
        # Skip transcript messages - pass them through unchanged
        if mtype == 'transcript':
            return msg
        # Only coerce plausible assistant replies
        if status not in ('success', 'done', 'ok', 'final'):
            return msg
        # Normalize status to reference
        msg['status'] = 'done'
        # Ensure plain-text result
        res = msg.get('result')
        if isinstance(res, str):
            technical_markers = ("Python output:", "Non-JSON output:", "status:", "result:")
            has_braces = ('{' in res) or ('}' in res)
            has_labels = any(tok in res for tok in technical_markers)
        else:
            has_braces = has_labels = False
        if has_braces or has_labels or not isinstance(res, str):
            try:
                alt = None
                try:
                    alt = _extract_plain_assistant_text(msg)
                except Exception:
                    alt = None
                if isinstance(alt, str) and alt.strip():
                    msg['result'] = alt.strip()
                else:
                    # Fallback cleaning similar to _make_speakable
                    import re as _re
                    text = res if isinstance(res, str) else str(res)
                    text = _re.sub(r"```[\s\S]*?```", " ", text)
                    text = _re.sub(r"\{[^\}]*\}", " ", text)
                    text = _re.sub(r"\bstatus:\s*[^\n\r]*", " ", text, flags=_re.IGNORECASE)
                    text = _re.sub(r"\bresult:\s*[^\n\r]*", " ", text, flags=_re.IGNORECASE)
                    text = _re.sub(r"\s+", " ", text).strip()
                    if text:
                        msg['result'] = text
            except Exception:
                pass
        # Ensure messages array includes assistant line
        try:
            m = msg.get('messages')
            r = msg.get('result') if isinstance(msg.get('result'), str) else None
            if not isinstance(m, list):
                if r:
                    msg['messages'] = [{"role": "assistant", "content": r}]
            else:
                # If last assistant content mismatches result, append
                last_assistant = None
                for it in reversed(m):
                    if isinstance(it, dict) and it.get('role') == 'assistant':
                        last_assistant = it
                        break
                if r and (not last_assistant or last_assistant.get('content') != r):
                    m.append({"role": "assistant", "content": r})
        except Exception:
            pass
        # Set reference flags
        msg['new_message'] = True
        msg['clear_thinking'] = True
        msg['speak'] = True
        msg['rich_text'] = True
        return msg
    except Exception:
        return msg