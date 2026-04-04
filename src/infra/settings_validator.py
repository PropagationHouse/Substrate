"""
Settings Validator — Schema validation for custom_settings.json
================================================================
Validates agent configuration against a known schema on load and save.
Reports warnings for unknown keys and errors for invalid types/ranges.

No external dependencies — uses only Python builtins.

Usage:
    from src.infra.settings_validator import validate_settings, get_settings_schema

    errors, warnings = validate_settings(config_dict)
    if errors:
        logger.error(f"Config errors: {errors}")
    if warnings:
        logger.warning(f"Config warnings: {warnings}")
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Schema definition ────────────────────────────────────────────────
# Each key maps to a dict with:
#   type: expected Python type(s)
#   required: whether the key must exist
#   range: (min, max) for numeric values (optional)
#   children: nested schema for dicts (optional)
#   items_type: expected type for list/dict values (optional)
#   description: human-readable description

_AUTONOMY_SECTION_SCHEMA = {
    "enabled": {"type": bool, "required": False, "description": "Whether this autonomy feature is enabled"},
    "min_interval": {"type": (int, float), "required": False, "range": (1, 86400), "description": "Minimum interval in seconds"},
    "max_interval": {"type": (int, float), "required": False, "range": (1, 86400), "description": "Maximum interval in seconds"},
    "prompt": {"type": str, "required": False, "description": "Prompt template"},
    "system_prompt": {"type": str, "required": False, "description": "System prompt override"},
    "silent_chance": {"type": (int, float), "required": False, "range": (0, 100), "description": "Chance of silent response (0-100)"},
    "save_to_scrapbook": {"type": bool, "required": False, "description": "Save results to scrapbook"},
    "first_look_prompt": {"type": str, "required": False, "description": "First-look prompt for camera"},
}

_AUTONOMY_SCHEMA = {
    "messages": {"type": dict, "required": False, "children": _AUTONOMY_SECTION_SCHEMA, "description": "Autonomous messaging config"},
    "screenshot": {"type": dict, "required": False, "children": _AUTONOMY_SECTION_SCHEMA, "description": "Autonomous screenshot config"},
    "midjourney": {"type": dict, "required": False, "children": _AUTONOMY_SECTION_SCHEMA, "description": "Autonomous midjourney config"},
    "notes": {"type": dict, "required": False, "children": _AUTONOMY_SECTION_SCHEMA, "description": "Autonomous notes config"},
    "camera": {"type": dict, "required": False, "children": _AUTONOMY_SECTION_SCHEMA, "description": "Autonomous camera config"},
}

_API_KEYS_SCHEMA = {
    "xai_api_key": {"type": str, "required": False, "description": "xAI/Grok API key"},
    "anthropic_api_key": {"type": str, "required": False, "description": "Anthropic API key"},
    "openai_api_key": {"type": str, "required": False, "description": "OpenAI API key"},
    "google_api_key": {"type": str, "required": False, "description": "Google AI API key"},
    "elevenlabs_api_key": {"type": str, "required": False, "description": "ElevenLabs API key"},
    "elevenlabs_voice_id": {"type": str, "required": False, "description": "ElevenLabs voice ID"},
    "elevenlabs_agent_id": {"type": str, "required": False, "description": "ElevenLabs agent ID"},
    "notion_api_key": {"type": str, "required": False, "description": "Notion API key"},
    "minimax_api_key": {"type": str, "required": False, "description": "MiniMax API key"},
}

_PROFILE_CONFIG_SCHEMA = {
    "system_prompt": {"type": str, "required": False, "description": "Profile system prompt"},
    "screenshot_prompt": {"type": str, "required": False, "description": "Profile screenshot prompt"},
    "model": {"type": str, "required": False, "description": "Profile model override"},
    "temperature": {"type": (int, float), "required": False, "range": (0.0, 2.0), "description": "Profile temperature"},
}

SETTINGS_SCHEMA = {
    "model": {"type": str, "required": False, "description": "Primary LLM model name"},
    "api_endpoint": {"type": str, "required": False, "description": "Local API endpoint URL"},
    "temperature": {"type": (int, float), "required": False, "range": (0.0, 2.0), "description": "LLM temperature"},
    "vision_fallback_model": {"type": str, "required": False, "description": "Fallback model for vision tasks"},
    "circuits_model": {"type": str, "required": False, "description": "Model for circuits/heartbeat"},
    "tools_enabled": {"type": bool, "required": False, "description": "Enable tool use"},
    "tools_auto_execute": {"type": bool, "required": False, "description": "Auto-execute tool calls without confirmation"},
    "top_p": {"type": (int, float), "required": False, "range": (0.0, 1.0), "description": "Top-p sampling"},
    "max_tokens": {"type": int, "required": False, "range": (1, 1000000), "description": "Max output tokens"},
    "context_retrieval_limit": {"type": int, "required": False, "range": (0, 100), "description": "Max context messages to retrieve"},
    "use_advanced_memory": {"type": bool, "required": False, "description": "Enable advanced memory system"},
    "system_prompt": {"type": str, "required": False, "description": "System prompt"},
    "screenshot_prompt": {"type": str, "required": False, "description": "Screenshot analysis prompt"},
    "note_prompts": {"type": dict, "required": False, "description": "Note prompt templates"},
    "auto_continue": {"type": bool, "required": False, "description": "Auto-continue after tool use"},
    "autonomy": {"type": dict, "required": False, "children": _AUTONOMY_SCHEMA, "description": "Autonomy settings"},
    "highlight_context_timeout": {"type": (int, float), "required": False, "range": (0, 3600), "description": "Highlighted text context timeout (seconds)"},
    "remote_api_keys": {"type": dict, "required": False, "children": _API_KEYS_SCHEMA, "description": "Remote API keys"},
    "profiles": {"type": dict, "required": False, "description": "Named config profiles"},
    "active_profile": {"type": str, "required": False, "description": "Currently active profile name"},
}

# Keys the system may add dynamically that are not user-facing but valid
_DYNAMIC_KEYS = {
    "thinking_level", "thinking_budget", "agent_name",
    "tts_provider", "tts_voice", "tts_enabled", "stt_enabled",
    "perplexity_api_key", "search_provider",
    "mcp_servers", "exec_approvals",
}


# ── Validation logic ─────────────────────────────────────────────────

def _validate_dict(
    data: Dict[str, Any],
    schema: Dict[str, Dict[str, Any]],
    path: str,
    errors: List[str],
    warnings: List[str],
) -> None:
    """Recursively validate a dict against a schema."""
    known_keys = set(schema.keys()) | _DYNAMIC_KEYS

    # Check for unknown keys
    for key in data:
        if key not in known_keys and path == "":
            warnings.append(f"Unknown setting: '{key}'")
        elif key not in schema and path != "":
            warnings.append(f"Unknown setting: '{path}.{key}'")

    # Validate each known key
    for key, spec in schema.items():
        full_path = f"{path}.{key}" if path else key

        if key not in data:
            if spec.get("required"):
                errors.append(f"'{full_path}' is required")
            continue

        value = data[key]

        # Skip None values
        if value is None:
            continue

        # Type check
        expected = spec.get("type")
        if expected and not isinstance(value, expected):
            # Allow int where float is expected
            if expected == float and isinstance(value, int):
                pass
            else:
                type_name = expected.__name__ if isinstance(expected, type) else str(expected)
                errors.append(f"'{full_path}': expected {type_name}, got {type(value).__name__}")
                continue

        # Range check
        value_range = spec.get("range")
        if value_range and isinstance(value, (int, float)):
            lo, hi = value_range
            if value < lo or value > hi:
                errors.append(f"'{full_path}': value {value} out of range [{lo}, {hi}]")

        # Nested dict validation
        children = spec.get("children")
        if children and isinstance(value, dict):
            _validate_dict(value, children, full_path, errors, warnings)


def validate_settings(config: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    """
    Validate a settings dict against the known schema.

    Returns:
        (errors, warnings) — errors are invalid values, warnings are unknown keys.
        Empty lists mean the config is valid.
    """
    if not isinstance(config, dict):
        return ["Settings must be a JSON object (dict)"], []

    errors: List[str] = []
    warnings: List[str] = []
    _validate_dict(config, SETTINGS_SCHEMA, "", errors, warnings)

    if errors:
        logger.warning(f"[SETTINGS_VALIDATOR] {len(errors)} error(s): {errors}")
    if warnings:
        logger.debug(f"[SETTINGS_VALIDATOR] {len(warnings)} warning(s): {warnings}")

    return errors, warnings


def get_settings_schema() -> Dict[str, Any]:
    """
    Return the settings schema as a serializable dict for documentation or UI.
    """
    def _serialize_schema(schema: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        result = {}
        for key, spec in schema.items():
            entry: Dict[str, Any] = {
                "description": spec.get("description", ""),
            }
            expected = spec.get("type")
            if expected:
                if isinstance(expected, tuple):
                    entry["type"] = [t.__name__ for t in expected]
                else:
                    entry["type"] = expected.__name__
            if spec.get("required"):
                entry["required"] = True
            if spec.get("range"):
                entry["range"] = list(spec["range"])
            children = spec.get("children")
            if children:
                entry["children"] = _serialize_schema(children)
            result[key] = entry
        return result

    return _serialize_schema(SETTINGS_SCHEMA)
