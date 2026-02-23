"""
Standardized Tool Result Contract
==================================
Every tool result gets normalized into a consistent structure so the LLM
and the event system can reliably determine success/failure without guessing.

Standard fields injected into every tool result dict:
  _verified: bool       — Was the result programmatically verified?
  _success: bool        — Did the tool succeed?
  _status: str          — "completed" | "failed" | "running" | "timeout" | "denied" | "error"
  _exit_code: int|None  — For exec tools: process exit code
  _duration_ms: int     — Execution time in milliseconds
  _error: str|None      — Error message if failed
  _tool: str            — Tool name
"""

import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


# Tools whose results can be verified by exit code
EXIT_CODE_TOOLS = {"exec", "process"}

# Status values that indicate success
SUCCESS_STATUSES = {"success", "completed", "ok", "accepted", "running"}

# Status values that indicate failure
FAILURE_STATUSES = {"error", "failed", "timeout", "denied", "killed"}


def normalize_tool_result(
    tool_name: str,
    raw_result: Any,
    duration_ms: int = 0,
) -> Dict[str, Any]:
    """
    Normalize any tool result into the standard contract.
    
    This wraps the raw result dict with structured verification metadata.
    The original result keys are preserved — we only ADD underscore-prefixed fields.
    
    Args:
        tool_name: Name of the tool that was executed
        raw_result: The raw result from the tool
        duration_ms: How long the tool took to execute
    
    Returns:
        The result dict with _verified, _success, _status, etc. injected
    """
    # Convert non-dict results
    if raw_result is None:
        result = {"output": None}
    elif not isinstance(raw_result, dict):
        if hasattr(raw_result, '__dict__'):
            result = {k: v for k, v in raw_result.__dict__.items() if not k.startswith('_')}
        else:
            result = {"output": str(raw_result)}
    else:
        result = dict(raw_result)  # Shallow copy to avoid mutating original
    
    # Extract signals from the result
    raw_status = str(result.get("status", "")).lower().strip()
    exit_code = result.get("exit_code")
    error = result.get("error")
    
    # Determine success/failure
    verified = True
    success = False
    status = "completed"
    error_msg = None
    
    # 1. Exit code is the strongest signal (for exec tools)
    if exit_code is not None and tool_name in EXIT_CODE_TOOLS:
        if isinstance(exit_code, int):
            success = (exit_code == 0)
            status = "completed" if success else "failed"
            if not success and not error:
                error_msg = f"Process exited with code {exit_code}"
            elif not success:
                error_msg = str(error)[:500]
        else:
            # Non-integer exit code — treat as unknown
            verified = False
            success = raw_status in SUCCESS_STATUSES
            status = raw_status or "unknown"
    
    # 2. Explicit status field
    elif raw_status:
        if raw_status in SUCCESS_STATUSES:
            success = True
            status = raw_status
        elif raw_status in FAILURE_STATUSES:
            success = False
            status = raw_status
            error_msg = str(error)[:500] if error else f"Tool returned status: {raw_status}"
        else:
            # Unknown status — can't verify
            verified = False
            success = True  # Assume success for unknown statuses
            status = raw_status
    
    # 3. Error field present without status
    elif error:
        success = False
        status = "error"
        error_msg = str(error)[:500]
    
    # 4. No status, no error — check for output
    else:
        output = result.get("output", result.get("content", result.get("text")))
        if output is not None:
            success = True
            status = "completed"
        else:
            # Truly ambiguous — can't verify
            verified = False
            success = True  # Optimistic default
            status = "unknown"
    
    # Inject standard fields
    result["_verified"] = verified
    result["_success"] = success
    result["_status"] = status
    result["_exit_code"] = exit_code if isinstance(exit_code, int) else None
    result["_duration_ms"] = duration_ms
    result["_error"] = error_msg
    result["_tool"] = tool_name
    
    return result


def is_tool_success(result: Dict[str, Any]) -> bool:
    """Quick check: did this tool result indicate success?"""
    if "_success" in result:
        return bool(result["_success"])
    # Fallback for non-normalized results
    status = str(result.get("status", "")).lower()
    if status in FAILURE_STATUSES:
        return False
    if result.get("error"):
        return False
    return True


def is_tool_verified(result: Dict[str, Any]) -> bool:
    """Quick check: was this result programmatically verified?"""
    return bool(result.get("_verified", False))


def get_tool_status(result: Dict[str, Any]) -> str:
    """Get the normalized status string."""
    return str(result.get("_status", result.get("status", "unknown")))


def format_verification_line(result: Dict[str, Any]) -> str:
    """
    Format a one-line verification summary for the LLM observation.
    
    Examples:
        "✓ VERIFIED: completed (exit code 0, 234ms)"
        "✗ VERIFIED: failed — Process exited with code 1 (1502ms)"
        "? UNVERIFIED: unknown status (45ms)"
    """
    verified = result.get("_verified", False)
    success = result.get("_success", True)
    status = result.get("_status", "unknown")
    exit_code = result.get("_exit_code")
    duration = result.get("_duration_ms", 0)
    error = result.get("_error")
    
    if verified and success:
        parts = [f"✓ VERIFIED: {status}"]
        if exit_code is not None:
            parts.append(f"(exit code {exit_code}, {duration}ms)")
        elif duration:
            parts.append(f"({duration}ms)")
        return " ".join(parts)
    
    elif verified and not success:
        parts = [f"✗ FAILED: {status}"]
        if error:
            parts.append(f"— {error}")
        if exit_code is not None:
            parts.append(f"(exit code {exit_code}, {duration}ms)")
        elif duration:
            parts.append(f"({duration}ms)")
        return " ".join(parts)
    
    else:
        return f"? UNVERIFIED: {status} ({duration}ms)"
