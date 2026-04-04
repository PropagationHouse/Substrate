"""
Tool Input Validator — Lightweight JSON Schema validation for tool arguments.
==============================================================================
Validates tool inputs against their registered JSON Schema before execution.
No external dependencies — uses only Python builtins.

Supports:
- type checking (string, integer, number, boolean, array, object)
- required fields
- enum constraints
- nested object validation
- array item type validation
- default coercion (string→int, string→bool)

Usage:
    from src.tools.tool_validator import validate_tool_input

    errors = validate_tool_input(args, schema)
    if errors:
        return {"status": "error", "error": f"Invalid input: {'; '.join(errors)}"}
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Python type mapping for JSON Schema types
_TYPE_MAP = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
}


def _check_type(value: Any, expected_type: str) -> bool:
    """Check if a value matches a JSON Schema type."""
    py_type = _TYPE_MAP.get(expected_type)
    if py_type is None:
        return True  # Unknown type — pass through
    if expected_type == "integer":
        # Accept int but not bool (bool is subclass of int in Python)
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected_type == "boolean":
        return isinstance(value, bool)
    return isinstance(value, py_type)


def _coerce_value(value: Any, expected_type: str) -> Any:
    """
    Try to coerce a value to the expected type.
    LLMs sometimes send strings where ints/bools are expected.
    Returns the coerced value, or the original if coercion fails.
    """
    if expected_type == "integer" and isinstance(value, str):
        try:
            return int(value)
        except (ValueError, TypeError):
            pass
    elif expected_type == "number" and isinstance(value, str):
        try:
            return float(value)
        except (ValueError, TypeError):
            pass
    elif expected_type == "boolean" and isinstance(value, str):
        if value.lower() in ("true", "1", "yes"):
            return True
        if value.lower() in ("false", "0", "no"):
            return False
    elif expected_type == "integer" and isinstance(value, float):
        if value == int(value):
            return int(value)
    return value


def _validate_value(
    value: Any,
    prop_schema: Dict[str, Any],
    path: str,
    errors: List[str],
) -> Any:
    """
    Validate a single value against its property schema.
    Returns the (possibly coerced) value.
    """
    expected_type = prop_schema.get("type")

    # Type coercion — fix common LLM mistakes before checking
    if expected_type and not _check_type(value, expected_type):
        coerced = _coerce_value(value, expected_type)
        if _check_type(coerced, expected_type):
            value = coerced
        else:
            errors.append(f"{path}: expected {expected_type}, got {type(value).__name__}")
            return value

    # Enum check
    enum_values = prop_schema.get("enum")
    if enum_values is not None and value not in enum_values:
        errors.append(f"{path}: must be one of {enum_values}, got '{value}'")

    # Array items validation
    if expected_type == "array" and isinstance(value, list):
        items_schema = prop_schema.get("items")
        if items_schema:
            for i, item in enumerate(value):
                value[i] = _validate_value(item, items_schema, f"{path}[{i}]", errors)

    # Nested object validation
    if expected_type == "object" and isinstance(value, dict):
        nested_props = prop_schema.get("properties", {})
        nested_required = prop_schema.get("required", [])
        for req_key in nested_required:
            if req_key not in value:
                errors.append(f"{path}.{req_key}: required field missing")
        for key, val in list(value.items()):
            if key in nested_props:
                value[key] = _validate_value(val, nested_props[key], f"{path}.{key}", errors)

    return value


def validate_tool_input(
    args: Dict[str, Any],
    schema: Optional[Dict[str, Any]],
    tool_name: str = "",
) -> tuple:
    """
    Validate tool input args against a JSON Schema.

    Args:
        args: The tool arguments dict.
        schema: The JSON Schema for the tool (from RegisteredTool.schema).
        tool_name: Tool name for error messages.

    Returns:
        (coerced_args, errors) — coerced_args has type-fixed values,
        errors is a list of validation error strings (empty = valid).
    """
    if not schema or not isinstance(schema, dict):
        return args, []

    errors: List[str] = []
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    # Check required fields
    for req_key in required:
        if req_key not in args or args[req_key] is None:
            errors.append(f"'{req_key}' is required")

    # Validate and coerce each provided field
    coerced = dict(args)
    for key, value in list(coerced.items()):
        if value is None:
            continue
        prop_schema = properties.get(key)
        if prop_schema:
            coerced[key] = _validate_value(value, prop_schema, key, errors)

    if errors and tool_name:
        logger.warning(f"[TOOL_VALIDATOR] {tool_name}: {errors}")

    return coerced, errors
