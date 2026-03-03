"""
Autonomous Agent Runner - Full tool loop for gateway circuits
=============================================================

Provides autonomous execution:
- Full tool access during circuits/cron runs
- Auto-continue until task complete
- Followup queue for chained turns
- Result delivery via notifications

This replaces the simple Ollama call in tray_service.py with
a full agentic loop that can use browser, exec, file tools, etc.
"""

import os
import sys
import json
import time
import logging
import threading
import queue
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List, Callable, Tuple
from dataclasses import dataclass, field

logger = logging.getLogger("gateway.autonomous")

# Add src to path for imports
SRC_PATH = Path(__file__).parent.parent
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

# Import tool system
try:
    from tools.tool_registry import get_tool_registry, execute_tool
    HAS_TOOLS = True
except ImportError:
    try:
        # Try relative import
        import sys
        sys.path.insert(0, str(SRC_PATH))
        from tools.tool_registry import get_tool_registry, execute_tool
        HAS_TOOLS = True
    except ImportError as e:
        logger.warning(f"Tool system not available: {e}")
        HAS_TOOLS = False

# Import infra
try:
    from infra.system_events import drain_system_events, has_system_events
    from infra.sessions import get_session_manager, Session
    HAS_INFRA = True
except ImportError as e:
    logger.warning(f"Infra not available: {e}")
    HAS_INFRA = False


# ============================================================================
# Provider resolution (mirrors proxy_server logic)
# ============================================================================

def _get_nested(config: Dict, path: str) -> Optional[str]:
    """Get a nested config value by slash-separated path."""
    parts = path.split("/")
    current = config
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current if isinstance(current, str) else None


_PROVIDER_KEY_FIELDS = {
    "google": "remote_api_keys/google_api_key",
    "xai": "remote_api_keys/xai_api_key",
    "anthropic": "remote_api_keys/anthropic_api_key",
    "openai": "remote_api_keys/openai_api_key",
}

_PROVIDER_ENV_VARS = {
    "google": "GOOGLE_API_KEY",
    "xai": "XAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}


_DISPLAY_TO_API_MODEL = {
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3-pro": "gemini-3-pro-preview",
    "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
    "claude-opus-4": "claude-opus-4-20250514",
    "claude-sonnet-4": "claude-sonnet-4-20250514",
}


def _resolve_provider(model_name: str, app_config: Dict) -> tuple:
    """Resolve (provider, api_key, remote_model) from model name and app config."""
    name_lower = model_name.lower()

    if any(tag in name_lower for tag in ("gemini", "gemma")):
        provider = "google"
        remote_model = _DISPLAY_TO_API_MODEL.get(model_name, model_name)
    elif any(tag in name_lower for tag in ("claude", "anthropic")):
        provider = "anthropic"
        remote_model = _DISPLAY_TO_API_MODEL.get(model_name, model_name)
    elif any(tag in name_lower for tag in ("grok", "xai")):
        provider = "xai"
        remote_model = model_name
    elif any(tag in name_lower for tag in ("gpt-", "o1-", "o3-", "o4-", "chatgpt", "openai")):
        provider = "openai"
        remote_model = model_name
    else:
        return ("ollama", None, None)

    # Resolve API key from config or env
    api_key = None
    field = _PROVIDER_KEY_FIELDS.get(provider)
    if field:
        api_key = _get_nested(app_config, field)
        if not api_key:
            env_var = _PROVIDER_ENV_VARS.get(provider, "")
            api_key = os.environ.get(env_var, "").strip() or None

    if not api_key:
        logger.warning(f"No API key for provider '{provider}' — falling back to Ollama")
        return ("ollama", None, None)

    return (provider, api_key, remote_model)


# ============================================================================
# Configuration
# ============================================================================

@dataclass
class AutonomousConfig:
    """Configuration for autonomous execution."""
    # Model settings
    ollama_url: str = "http://localhost:11434"
    default_model: str = "dolphin3:latest"
    provider: str = "ollama"  # ollama, google, anthropic, xai, openai
    api_key: Optional[str] = None  # Remote API key (if provider != ollama)
    remote_model: Optional[str] = None  # Remote model name (e.g. gemini-2.5-flash)
    _app_config: Optional[Dict[str, Any]] = field(default=None, repr=False)
    
    @classmethod
    def from_app_config(cls, **overrides) -> "AutonomousConfig":
        """Create config by reading the main app's config.json.
        
        This ensures the gateway uses the same model the user has
        selected in the UI, instead of hardcoded defaults.
        """
        repo_root = Path(__file__).parent.parent.parent
        # The app saves live config to custom_settings.json, not config.json
        custom_path = repo_root / "custom_settings.json"
        config_path = repo_root / "config.json"
        app_config = {}
        chosen_path = custom_path if custom_path.exists() else config_path
        if chosen_path.exists():
            try:
                import json as _json
                with open(chosen_path, 'r') as f:
                    app_config = _json.load(f)
                logger.info(f"Loaded config from {chosen_path.name}")
            except Exception as e:
                logger.warning(f"Could not load app config: {e}")
        
        model = app_config.get("model", "dolphin3:latest")
        ollama_url = app_config.get("api_endpoint", "http://localhost:11434/api/generate")
        # Strip /api/generate or /api/chat suffix to get base URL
        for suffix in ("/api/generate", "/api/chat", "/api"):
            if ollama_url.endswith(suffix):
                ollama_url = ollama_url[:-len(suffix)]
                break
        
        # Resolve provider and API key from model name
        provider, api_key, remote_model = _resolve_provider(model, app_config)
        
        # Optional: use a different model for circuits (set circuits_model in config.json)
        circuits_model = app_config.get("circuits_model")
        if circuits_model:
            logger.info(f"Circuits model override: {model} → {circuits_model}")
            model = circuits_model
            # Re-resolve provider for the circuits model
            provider, api_key, remote_model = _resolve_provider(model, app_config)
        
        defaults = {
            "ollama_url": ollama_url,
            "default_model": model,
            "provider": provider,
            "api_key": api_key,
            "remote_model": remote_model,
            "_app_config": app_config,
        }
        defaults.update(overrides)
        return cls(**defaults)
    
    # Execution limits (generous safety rails — natural stopping via done-detection + timeout)
    max_turns: int = 50  # Safety cap on agent turns per run
    max_tool_calls: int = 200  # Safety cap on tool calls per run
    turn_timeout_seconds: int = 120  # Timeout per turn
    total_timeout_seconds: int = 1800  # Total run timeout (30 min)
    
    # Auto-continue settings
    auto_continue: bool = True
    done_phrases: List[str] = field(default_factory=lambda: [
        "CIRCUITS_OK", "nothing to do", "no pending tasks",
        "all caught up", "no events to process",
        "task complete", "task is complete", "done.", "i'm done",
        "finished the task", "completed successfully"
    ])
    
    # Tool settings
    tools_enabled: bool = True
    dangerous_tools_allowed: bool = False  # Require approval for dangerous
    
    # Notification settings
    notify_on_complete: bool = True
    notify_on_error: bool = True
    notify_on_action: bool = False  # Notify when agent takes action
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "ollamaUrl": self.ollama_url,
            "defaultModel": self.default_model,
            "maxTurns": self.max_turns,
            "maxToolCalls": self.max_tool_calls,
            "turnTimeoutSeconds": self.turn_timeout_seconds,
            "totalTimeoutSeconds": self.total_timeout_seconds,
            "autoContinue": self.auto_continue,
            "donePhrases": self.done_phrases,
            "toolsEnabled": self.tools_enabled,
            "dangerousToolsAllowed": self.dangerous_tools_allowed,
            "notifyOnComplete": self.notify_on_complete,
            "notifyOnError": self.notify_on_error,
            "notifyOnAction": self.notify_on_action,
        }


# ============================================================================
# Followup Queue
# ============================================================================

# Import the full queue implementation
from .followup_queue import (
    FollowupRun,
    QueueSettings,
    QueueMode,
    QueueDropPolicy,
    QueueDedupeMode,
    enqueue_followup as _enqueue_followup,
    get_queue_depth,
    schedule_followup_drain,
    drain_queue,
    clear_queue,
    list_queues,
    create_followup_runner,
)


def enqueue_followup(
    session_key: str,
    prompt: str,
    model_override: Optional[str] = None,
    message_id: Optional[str] = None,
    **metadata,
) -> bool:
    """
    Enqueue a followup agent turn.
    
    Returns True if enqueued, False if deduplicated/dropped.
    """
    run = FollowupRun(
        prompt=prompt,
        session_key=session_key,
        model_override=model_override,
        message_id=message_id,
        metadata=metadata,
    )
    return _enqueue_followup(session_key, run)


def get_followup_queue_depth(session_key: str = "main") -> int:
    """Get the number of items in a session's followup queue."""
    return get_queue_depth(session_key)


# ============================================================================
# Autonomous Runner
# ============================================================================

@dataclass
class RunResult:
    """Result of an autonomous run."""
    success: bool
    response: str
    turns: int = 0
    tool_calls: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
    actions_taken: List[str] = field(default_factory=list)
    followups_queued: int = 0


class AutonomousRunner:
    """
    Full autonomous agent runner with tool loop.
    
    This is the core execution engine that:
    1. Builds context from system events
    2. Runs agent with full tool access
    3. Auto-continues until task complete
    4. Queues followups as needed
    5. Delivers results via notifications
    """
    
    def __init__(
        self,
        config: Optional[AutonomousConfig] = None,
        on_notify: Optional[Callable[[str, str], None]] = None,
        on_action: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ):
        self.config = config or AutonomousConfig()
        self._on_notify = on_notify
        self._on_action = on_action
        self._running = False
        self._current_run_id: Optional[str] = None
    
    def _notify(self, title: str, message: str):
        """Send notification."""
        if self._on_notify:
            self._on_notify(title, message)
        else:
            logger.info(f"NOTIFY: {title} - {message}")
    
    def _is_task_complete(self, response: str) -> bool:
        """Check if agent indicated task is complete (idle state, not just finished an action)."""
        if not response:
            return False
        
        response_lower = response.lower().strip()
        
        # Only stop for explicit idle signals, not for describing completed actions
        for phrase in self.config.done_phrases:
            if phrase.lower() in response_lower:
                return True
        
        # Also check if response is very short and indicates nothing to do
        if len(response_lower) < 50 and any(x in response_lower for x in ["nothing", "no tasks", "idle", "waiting"]):
            return True
        
        return False
    
    def _build_system_prompt(self, events: List[Dict[str, Any]], circuits_content: Optional[str] = None) -> str:
        """Build system prompt for autonomous execution."""
        # Load SUBSTRATE.md for personality
        try:
            from .substrate_prime import read_substrate_file
            substrate_content = read_substrate_file()
        except Exception:
            substrate_content = None
        
        # Start with personality if available
        if substrate_content:
            prompt = f"{substrate_content}\n\n---\n\n"
        else:
            prompt = ""
        
        # Concise prompt
        prompt += (
            "Read CIRCUITS.md if it exists (workspace context). "
            "Follow it strictly. Do not infer or repeat old tasks from prior chats. "
            "If nothing needs attention, reply CIRCUITS_OK.\n\n"
            "You have access to browser, file, exec, and other tools. Use them freely.\n"
        )
        
        # Add CIRCUITS.md content if available
        if circuits_content:
            prompt += f"\n---\n\nCIRCUITS.md contents:\n\n{circuits_content}\n"
        
        # Add any system events
        if events:
            prompt += "\n---\n\nPENDING EVENTS:\n"
            for evt in events:
                evt_type = evt.get("type", "event")
                evt_text = evt.get("text", str(evt))
                prompt += f"- [{evt_type}] {evt_text}\n"
        
        return prompt
    
    def _call_ollama(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, Optional[List[Dict[str, Any]]]]:
        """Route model call to the correct provider."""
        provider = self.config.provider
        logger.info(f"Calling model: provider={provider}, model={self.config.default_model}")
        
        if provider == "google":
            return self._call_google(messages, tools)
        elif provider in ("xai", "openai"):
            return self._call_openai_compatible(messages, tools)
        elif provider == "anthropic":
            return self._call_anthropic(messages, tools)
        else:
            return self._call_ollama_local(messages, tools)
    
    def _call_ollama_local(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, Optional[List[Dict[str, Any]]]]:
        """Call Ollama local API with streaming to enforce real timeouts.
        
        Ollama's non-streaming mode holds the HTTP connection open during
        the entire generation, making requests.timeout useless. Streaming
        lets us enforce a per-chunk timeout so slow models don't hang.
        """
        import requests
        
        try:
            payload = {
                "model": self.config.default_model,
                "messages": messages,
                "stream": True,
            }
            if tools:
                payload["tools"] = tools
            
            response = requests.post(
                f"{self.config.ollama_url}/api/chat",
                json=payload,
                stream=True,
                timeout=(10, 30),  # 10s connect, 30s per chunk
            )
            
            if response.status_code == 404:
                return self._call_ollama_generate(messages)
            
            if not response.ok:
                return f"Error: Ollama {response.status_code}", None
            
            # Accumulate streamed response
            content_parts = []
            tool_calls = None
            final_message = {}
            deadline = time.time() + self.config.turn_timeout_seconds
            
            for line in response.iter_lines(decode_unicode=True):
                if time.time() > deadline:
                    logger.warning("Ollama response exceeded turn timeout — aborting")
                    response.close()
                    break
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                
                msg = chunk.get("message", {})
                if msg.get("content"):
                    content_parts.append(msg["content"])
                
                if chunk.get("done"):
                    final_message = msg
                    break
            
            content = "".join(content_parts)
            tool_calls = final_message.get("tool_calls") or None
            
            if not content and not tool_calls:
                content = "CIRCUITS_OK"
            
            return content, tool_calls
            
        except requests.Timeout:
            return "Error: Ollama request timed out", None
        except Exception as e:
            try:
                return self._call_ollama_generate(messages)
            except Exception:
                return f"Error: {str(e)}", None
    
    def _call_google(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, Optional[List[Dict[str, Any]]]]:
        """Call Google Gemini API."""
        import requests
        
        api_key = self.config.api_key
        model = self.config.remote_model or "gemini-2.5-flash"
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        
        # Convert messages to Gemini format
        contents = []
        system_text = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                system_text += content + "\n"
            elif role == "assistant":
                contents.append({"role": "model", "parts": [{"text": content}]})
            elif role == "tool":
                contents.append({"role": "user", "parts": [{"text": f"[Tool result] {content}"}]})
            else:
                contents.append({"role": "user", "parts": [{"text": content}]})
        
        payload = {"contents": contents}
        if system_text.strip():
            payload["systemInstruction"] = {"parts": [{"text": system_text.strip()}]}
        
        # Convert tools to Gemini format
        if tools:
            func_decls = []
            for tool in tools:
                func = tool.get("function", {})
                func_decls.append({
                    "name": func.get("name", ""),
                    "description": func.get("description", ""),
                    "parameters": func.get("parameters", {"type": "object", "properties": {}}),
                })
            payload["tools"] = [{"function_declarations": func_decls}]
        
        try:
            response = requests.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=(10, self.config.turn_timeout_seconds),
            )
            
            if not response.ok:
                return f"Error: Google API {response.status_code}: {response.text[:200]}", None
            
            result = response.json()
            candidates = result.get("candidates", [])
            if not candidates:
                return "Error: No candidates in Gemini response", None
            
            parts = candidates[0].get("content", {}).get("parts", [])
            text_parts = []
            tool_calls = []
            for part in parts:
                if "text" in part:
                    text_parts.append(part["text"])
                elif "functionCall" in part:
                    fc = part["functionCall"]
                    tool_calls.append({
                        "id": fc.get("name", ""),
                        "function": {
                            "name": fc.get("name", ""),
                            "arguments": fc.get("args", {}),
                        },
                    })
            
            content = "\n".join(text_parts)
            return content, tool_calls if tool_calls else None
            
        except requests.Timeout:
            return "Error: Google API timed out", None
        except Exception as e:
            return f"Error: Google API: {str(e)}", None
    
    def _call_openai_compatible(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, Optional[List[Dict[str, Any]]]]:
        """Call OpenAI-compatible API (XAI/Grok, OpenAI)."""
        import requests
        
        api_key = self.config.api_key
        model = self.config.remote_model or self.config.default_model
        
        if self.config.provider == "xai":
            endpoint = "https://api.x.ai/v1/chat/completions"
        else:
            endpoint = "https://api.openai.com/v1/chat/completions"
        
        payload = {
            "model": model,
            "messages": messages,
        }
        if tools:
            payload["tools"] = [{"type": "function", "function": t.get("function", t)} for t in tools]
        
        try:
            response = requests.post(
                endpoint,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=(10, self.config.turn_timeout_seconds),
            )
            
            if not response.ok:
                return f"Error: API {response.status_code}: {response.text[:200]}", None
            
            result = response.json()
            choice = result.get("choices", [{}])[0]
            message = choice.get("message", {})
            content = message.get("content", "") or ""
            tool_calls = message.get("tool_calls")
            return content, tool_calls
            
        except requests.Timeout:
            return "Error: API timed out", None
        except Exception as e:
            return f"Error: API: {str(e)}", None
    
    def _call_anthropic(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, Optional[List[Dict[str, Any]]]]:
        """Call Anthropic Claude API."""
        import requests
        
        api_key = self.config.api_key
        model = self.config.remote_model or "claude-sonnet-4-20250514"
        
        # Extract system message
        system_text = ""
        api_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_text += msg.get("content", "") + "\n"
            else:
                api_messages.append(msg)
        
        payload = {
            "model": model,
            "max_tokens": 4096,
            "messages": api_messages,
        }
        if system_text.strip():
            payload["system"] = system_text.strip()
        if tools:
            payload["tools"] = [{
                "name": t.get("function", {}).get("name", ""),
                "description": t.get("function", {}).get("description", ""),
                "input_schema": t.get("function", {}).get("parameters", {}),
            } for t in tools]
        
        try:
            response = requests.post(
                "https://api.anthropic.com/v1/messages",
                json=payload,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                timeout=(10, self.config.turn_timeout_seconds),
            )
            
            if not response.ok:
                return f"Error: Anthropic {response.status_code}: {response.text[:200]}", None
            
            result = response.json()
            content_blocks = result.get("content", [])
            text_parts = []
            tool_calls = []
            for block in content_blocks:
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tool_calls.append({
                        "id": block.get("id", ""),
                        "function": {
                            "name": block.get("name", ""),
                            "arguments": block.get("input", {}),
                        },
                    })
            
            content = "\n".join(text_parts)
            return content, tool_calls if tool_calls else None
            
        except requests.Timeout:
            return "Error: Anthropic API timed out", None
        except Exception as e:
            return f"Error: Anthropic API: {str(e)}", None
    
    def _call_ollama_generate(
        self,
        messages: List[Dict[str, Any]],
    ) -> Tuple[str, None]:
        """Fallback to /api/generate for older Ollama versions (no tool support)."""
        import requests
        
        # Convert messages to a single prompt
        prompt_parts = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                prompt_parts.append(f"System: {content}")
            elif role == "user":
                prompt_parts.append(f"User: {content}")
            elif role == "assistant":
                prompt_parts.append(f"Assistant: {content}")
        
        prompt = "\n\n".join(prompt_parts) + "\n\nAssistant:"
        
        response = requests.post(
            f"{self.config.ollama_url}/api/generate",
            json={
                "model": self.config.default_model,
                "prompt": prompt,
                "stream": False,
            },
            timeout=self.config.turn_timeout_seconds,
        )
        
        if response.ok:
            result = response.json()
            return result.get("response", ""), None
        
        return f"Error: {response.status_code}", None
    
    def _execute_tool_call(
        self,
        tool_call: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute a single tool call."""
        if not HAS_TOOLS:
            return {"error": "Tool system not available"}
        
        try:
            func = tool_call.get("function", {})
            tool_name = func.get("name", "")
            arguments = func.get("arguments", {})
            
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {}
            
            logger.info(f"Executing tool: {tool_name}")
            
            # Report action
            if self._on_action and self.config.notify_on_action:
                self._on_action(tool_name, arguments)
            
            # Execute via registry
            result = execute_tool(tool_name, arguments)
            
            return {
                "tool": tool_name,
                "success": True,
                "result": result,
            }
            
        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            return {
                "tool": tool_call.get("function", {}).get("name", "unknown"),
                "success": False,
                "error": str(e),
            }
    
    def _get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Get tool schemas for Ollama."""
        if not HAS_TOOLS:
            return []
        
        try:
            registry = get_tool_registry()
            return registry.get_ollama_tools()
        except Exception as e:
            logger.error(f"Error getting tool schemas: {e}")
            return []
    
    def run(
        self,
        session_key: str = "main",
        initial_prompt: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> RunResult:
        """
        Run autonomous agent execution.
        
        Args:
            session_key: Session to run in
            initial_prompt: Optional initial prompt (otherwise uses events)
            model_override: Optional model override
            
        Returns:
            RunResult with execution details
        """
        import uuid
        
        self._running = True
        self._current_run_id = str(uuid.uuid4())[:8]
        
        start_time = time.time()
        turns = 0
        tool_calls_count = 0
        actions_taken = []
        followups_queued = 0
        
        # Override model if specified
        if model_override:
            original_model = self.config.default_model
            self.config.default_model = model_override
        
        try:
            # Import circuits system
            from .circuits import (
                read_circuits_file,
                is_circuits_content_effectively_empty,
                strip_circuits_token,
            )
            
            # Read CIRCUITS.md
            circuits_content = read_circuits_file()
            
            # Gather system events
            events = []
            if HAS_INFRA:
                try:
                    events = drain_system_events(session_key)
                except Exception as e:
                    logger.warning(f"Could not drain events: {e}")
            
            # Check if we should skip (no tasks and no events)
            if (
                not initial_prompt 
                and not events 
                and is_circuits_content_effectively_empty(circuits_content)
            ):
                logger.info("No tasks in CIRCUITS.md and no events - skipping API call")
                return RunResult(
                    success=True,
                    response="CIRCUITS_OK",
                    turns=0,
                    tool_calls=0,
                    duration_ms=int((time.time() - start_time) * 1000),
                )
            
            # Build initial messages with circuits content
            system_prompt = self._build_system_prompt(events, circuits_content)
            
            messages = [
                {"role": "system", "content": system_prompt},
            ]
            
            if initial_prompt:
                messages.append({"role": "user", "content": initial_prompt})
            elif events:
                messages.append({"role": "user", "content": "Process the pending events."})
            else:
                messages.append({"role": "user", "content": "Circuits check."})
            
            # Get tool schemas — for local models, defer tools until the model
            # actually needs them (first turn is just reading CIRCUITS.md)
            all_tools = self._get_tool_schemas() if self.config.tools_enabled else None
            tools_deferred = (self.config.provider == "ollama" and all_tools)
            
            final_response = ""
            
            # Main execution loop
            while self._running and turns < self.config.max_turns:
                # Check total timeout
                elapsed = time.time() - start_time
                if elapsed > self.config.total_timeout_seconds:
                    logger.warning("Total timeout reached")
                    break
                
                turns += 1
                logger.info(f"Turn {turns}/{self.config.max_turns}")
                
                # For local models: skip tools on turn 1 (just read CIRCUITS.md)
                # Pass tools on turn 2+ once the model has decided to act
                if tools_deferred and turns == 1:
                    tools = None
                    logger.info("Local model: deferring tools to keep first turn fast")
                else:
                    tools = all_tools
                
                # Call LLM
                response, tool_calls = self._call_ollama(messages, tools)
                
                if response.startswith("Error:"):
                    return RunResult(
                        success=False,
                        response=response,
                        turns=turns,
                        tool_calls=tool_calls_count,
                        duration_ms=int((time.time() - start_time) * 1000),
                        error=response,
                        actions_taken=actions_taken,
                    )
                
                # Add assistant response to history
                assistant_msg = {"role": "assistant", "content": response}
                if tool_calls:
                    assistant_msg["tool_calls"] = tool_calls
                messages.append(assistant_msg)
                
                final_response = response
                
                # Handle tool calls
                if tool_calls and self.config.tools_enabled:
                    for tc in tool_calls:
                        if tool_calls_count >= self.config.max_tool_calls:
                            logger.warning("Max tool calls reached")
                            break
                        
                        tool_calls_count += 1
                        result = self._execute_tool_call(tc)
                        
                        tool_name = result.get("tool", "unknown")
                        actions_taken.append(tool_name)
                        
                        # Add tool result to messages
                        messages.append({
                            "role": "tool",
                            "content": json.dumps(result.get("result", result.get("error", ""))),
                            "tool_call_id": tc.get("id", ""),
                        })
                    
                    # Continue loop to process tool results
                    continue
                
                # Check if task is complete
                if self._is_task_complete(response):
                    logger.info("Task complete signal detected")
                    break
                
                # Auto-continue if enabled and we did something
                if self.config.auto_continue and tool_calls_count > 0:
                    messages.append({
                        "role": "user",
                        "content": "Continue. If the task is complete, say 'Done.'"
                    })
                else:
                    # No tools used and no complete signal - we're done
                    break
            
            # Calculate duration
            duration_ms = int((time.time() - start_time) * 1000)
            
            # Strip CIRCUITS_OK token from response
            strip_result = strip_circuits_token(final_response, mode="circuits")
            cleaned_response = strip_result.text if not strip_result.should_skip else ""
            
            # Notify if configured
            if self.config.notify_on_complete and actions_taken:
                summary = f"Completed {len(actions_taken)} actions in {turns} turns"
                self._notify("Substrate Task Complete", summary)
            
            return RunResult(
                success=True,
                response=cleaned_response or final_response,
                turns=turns,
                tool_calls=tool_calls_count,
                duration_ms=duration_ms,
                actions_taken=actions_taken,
                followups_queued=followups_queued,
            )
            
        except Exception as e:
            logger.error(f"Autonomous run error: {e}")
            
            if self.config.notify_on_error:
                self._notify("Substrate Error", str(e)[:200])
            
            return RunResult(
                success=False,
                response="",
                turns=turns,
                tool_calls=tool_calls_count,
                duration_ms=int((time.time() - start_time) * 1000),
                error=str(e),
                actions_taken=actions_taken,
            )
            
        finally:
            self._running = False
            self._current_run_id = None
            
            # Restore model if overridden
            if model_override:
                self.config.default_model = original_model
    
    def run_followups(self, session_key: str = "main") -> List[RunResult]:
        """
        Run queued followup turns.
        
        This schedules an async drain of the queue, running each
        followup as a new agent turn.
        """
        results: List[RunResult] = []
        
        def run_single_followup(followup: FollowupRun) -> None:
            logger.info(f"Running followup: {followup.message_id}")
            result = self.run(
                session_key=followup.session_key,
                initial_prompt=followup.prompt,
                model_override=followup.model_override,
            )
            results.append(result)
        
        # Drain synchronously to collect results
        drain_queue(session_key, run_single_followup, async_mode=False)
        
        return results
    
    def schedule_followup_drain(self, session_key: str = "main") -> None:
        """
        Schedule async drain of followup queue.
        
        This is called at the end of agent runs to process any
        queued followups in the background.
        """
        def run_single_followup(followup: FollowupRun) -> None:
            logger.info(f"Running scheduled followup: {followup.message_id}")
            self.run(
                session_key=followup.session_key,
                initial_prompt=followup.prompt,
                model_override=followup.model_override,
            )
        
        schedule_followup_drain(session_key, run_single_followup)
    
    def stop(self):
        """Stop current run."""
        self._running = False


# ============================================================================
# Global runner instance
# ============================================================================

_runner: Optional[AutonomousRunner] = None


def get_autonomous_runner(
    config: Optional[AutonomousConfig] = None,
    on_notify: Optional[Callable[[str, str], None]] = None,
) -> AutonomousRunner:
    """Get or create the global autonomous runner."""
    global _runner
    
    if _runner is None:
        _runner = AutonomousRunner(config=config, on_notify=on_notify)
    elif config:
        _runner.config = config
    
    if on_notify:
        _runner._on_notify = on_notify
    
    return _runner


def run_autonomous_circuits(
    session_key: str = "main",
    events: Optional[List[Dict[str, Any]]] = None,
) -> RunResult:
    """
    Convenience function to run an autonomous circuits check.
    
    This is the main entry point for the gateway tray service.
    """
    runner = get_autonomous_runner()
    
    # If events provided, queue them first
    if events and HAS_INFRA:
        from infra.system_events import enqueue_system_event
        for evt in events:
            enqueue_system_event(
                session_key,
                evt.get("type", "event"),
                evt.get("text", str(evt)),
            )
    
    # Run main execution
    result = runner.run(session_key=session_key)
    
    # Schedule async drain of any queued followups
    queue_depth = get_queue_depth(session_key)
    if queue_depth > 0:
        runner.schedule_followup_drain(session_key)
        result.followups_queued = queue_depth
    
    return result


# Backward compat alias
run_autonomous_heartbeat = run_autonomous_circuits
