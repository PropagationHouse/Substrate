"""
OpenCode Tool — Gives Substrate the ability to drive OpenCode as a coding agent.
================================================================================

Substrate can delegate complex coding tasks to OpenCode which provides:
- LSP-aware file editing
- Multi-step agentic coding loops (plan → edit → verify → iterate)
- apply_patch for multi-file changes
- Built-in agents (build, plan, explore, scout, etc.)

Integration modes:
1. `run` — headless single-shot execution (opencode run --format json)
2. `serve` + session API — persistent server for multi-turn sessions
"""

import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────

_OPENCODE_CLI = os.environ.get(
    "OPENCODE_CLI",
    r"C:\Users\Bl0ck\AppData\Local\OpenCode\opencode-cli.exe",
)

_DEFAULT_PORT = 19836  # Substrate-managed OpenCode server port
_SERVER_URL = f"http://127.0.0.1:{_DEFAULT_PORT}"
_SERVER_LOCK = threading.Lock()
_SERVER_PROCESS: Optional[subprocess.Popen] = None


# ── Server lifecycle ──────────────────────────────────────────────────────

def _find_cli() -> Optional[str]:
    """Locate the opencode-cli binary."""
    if os.path.isfile(_OPENCODE_CLI):
        return _OPENCODE_CLI
    # Try PATH
    import shutil
    found = shutil.which("opencode") or shutil.which("opencode-cli")
    return found


def _server_is_running() -> bool:
    """Check if our managed OpenCode server is responding."""
    try:
        resp = requests.get(f"{_SERVER_URL}/", timeout=2)
        return resp.status_code < 500
    except Exception:
        return False


def _start_server(working_dir: Optional[str] = None) -> Dict[str, Any]:
    """Start the OpenCode headless server if not already running."""
    global _SERVER_PROCESS

    if _server_is_running():
        return {"status": "success", "message": "OpenCode server already running", "url": _SERVER_URL}

    cli = _find_cli()
    if not cli:
        return {"status": "error", "error": f"OpenCode CLI not found at {_OPENCODE_CLI} or in PATH"}

    with _SERVER_LOCK:
        # Double-check after acquiring lock
        if _server_is_running():
            return {"status": "success", "message": "OpenCode server already running", "url": _SERVER_URL}

        cwd = working_dir or str(Path(__file__).parent.parent.parent)  # Substrate root
        cmd = [
            cli, "serve",
            "--port", str(_DEFAULT_PORT),
            "--hostname", "127.0.0.1",
        ]

        try:
            _SERVER_PROCESS = subprocess.Popen(
                cmd,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            logger.info(f"Starting OpenCode server: {' '.join(cmd)} (pid={_SERVER_PROCESS.pid})")
        except Exception as e:
            return {"status": "error", "error": f"Failed to start OpenCode server: {e}"}

        # Wait for it to become ready
        for i in range(30):  # 15 seconds max
            time.sleep(0.5)
            if _server_is_running():
                logger.info(f"OpenCode server ready on {_SERVER_URL}")
                return {"status": "success", "message": "OpenCode server started", "url": _SERVER_URL, "pid": _SERVER_PROCESS.pid}
            # Check if process died
            if _SERVER_PROCESS.poll() is not None:
                stderr = _SERVER_PROCESS.stderr.read().decode() if _SERVER_PROCESS.stderr else ""
                return {"status": "error", "error": f"OpenCode server exited immediately: {stderr[:500]}"}

        return {"status": "error", "error": "OpenCode server failed to start within 15 seconds"}


def _stop_server() -> Dict[str, Any]:
    """Stop the managed OpenCode server."""
    global _SERVER_PROCESS

    if _SERVER_PROCESS and _SERVER_PROCESS.poll() is None:
        _SERVER_PROCESS.terminate()
        try:
            _SERVER_PROCESS.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _SERVER_PROCESS.kill()
        _SERVER_PROCESS = None
        return {"status": "success", "message": "OpenCode server stopped"}

    _SERVER_PROCESS = None
    return {"status": "success", "message": "OpenCode server was not running"}


# ── Headless run (opencode run) ───────────────────────────────────────────

def _run_headless(
    prompt: str,
    working_dir: Optional[str] = None,
    model: Optional[str] = None,
    agent: Optional[str] = None,
    files: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    continue_session: bool = False,
    timeout_sec: int = 300,
) -> Dict[str, Any]:
    """
    Run a single coding task headlessly via `opencode run`.
    Returns structured JSON output.
    """
    cli = _find_cli()
    if not cli:
        return {"status": "error", "error": f"OpenCode CLI not found at {_OPENCODE_CLI} or in PATH"}

    cwd = working_dir or str(Path(__file__).parent.parent.parent)

    cmd = [cli, "run", "--format", "json"]

    if model:
        cmd.extend(["--model", model])
    if agent:
        cmd.extend(["--agent", agent])
    if session_id:
        cmd.extend(["--session", session_id])
    if continue_session:
        cmd.append("--continue")
    if files:
        for f in files:
            cmd.extend(["--file", f])

    # Add the prompt as positional args
    cmd.append(prompt)

    logger.info(f"OpenCode run: {' '.join(cmd[:6])}... (cwd={cwd})")

    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": f"OpenCode run timed out after {timeout_sec}s"}
    except Exception as e:
        return {"status": "error", "error": f"Failed to run OpenCode: {e}"}

    # Parse JSON output
    output = result.stdout.strip()
    stderr = result.stderr.strip()

    if result.returncode != 0 and not output:
        return {
            "status": "error",
            "error": f"OpenCode exited with code {result.returncode}",
            "stderr": stderr[:1000] if stderr else None,
        }

    # OpenCode --format json outputs newline-delimited JSON events
    # Try to extract the final assistant message
    events = []
    for line in output.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if not events:
        # Fallback: return raw output
        return {
            "status": "success",
            "output": output[:5000] if output else "(no output)",
            "stderr": stderr[:500] if stderr else None,
            "exit_code": result.returncode,
        }

    # Extract useful info from events
    assistant_text = ""
    tool_calls = []
    session_info = None

    for evt in events:
        evt_type = evt.get("type", "")
        if evt_type == "text" or "text" in evt:
            text_content = evt.get("text", evt.get("content", ""))
            if text_content:
                assistant_text += text_content
        elif evt_type == "tool_call" or "tool" in evt:
            tool_calls.append(evt)
        elif "session" in evt:
            session_info = evt.get("session")

    return {
        "status": "success",
        "output": assistant_text[:5000] if assistant_text else output[:5000],
        "tool_calls_count": len(tool_calls),
        "session_id": session_info,
        "exit_code": result.returncode,
        "events_count": len(events),
    }


# ── Server API interactions ───────────────────────────────────────────────

def _api_get(path: str, timeout: int = 10) -> Dict[str, Any]:
    """GET request to OpenCode server."""
    try:
        resp = requests.get(f"{_SERVER_URL}{path}", timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except requests.ConnectionError:
        return {"status": "error", "error": "OpenCode server not running. Use action='start_server' first."}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _api_post(path: str, data: Dict[str, Any], timeout: int = 120) -> Dict[str, Any]:
    """POST request to OpenCode server."""
    try:
        resp = requests.post(f"{_SERVER_URL}{path}", json=data, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except requests.ConnectionError:
        return {"status": "error", "error": "OpenCode server not running. Use action='start_server' first."}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _session_list() -> Dict[str, Any]:
    """List all OpenCode sessions."""
    return _api_get("/session")


def _session_create(title: Optional[str] = None) -> Dict[str, Any]:
    """Create a new session."""
    data = {}
    if title:
        data["title"] = title
    return _api_post("/session", data)


def _session_chat(session_id: str, message: str, timeout: int = 120) -> Dict[str, Any]:
    """Send a message to a session and wait for response."""
    return _api_post(f"/session/{session_id}/message", {"content": message}, timeout=timeout)


# ── Main dispatch ─────────────────────────────────────────────────────────

def opencode_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """
    Dispatch OpenCode tool actions.

    Actions:
    - run: Execute a coding task headlessly (single-shot, no server needed)
    - start_server: Start the OpenCode headless server for multi-turn sessions
    - stop_server: Stop the managed server
    - status: Check if OpenCode server is running
    - session_list: List sessions on the server
    - session_create: Create a new session
    - session_chat: Send message to an existing session
    """

    if action == "run":
        prompt = kwargs.get("prompt", "")
        if not prompt:
            return {"status": "error", "error": "prompt is required for run action"}
        return _run_headless(
            prompt=prompt,
            working_dir=kwargs.get("working_dir") or kwargs.get("dir"),
            model=kwargs.get("model"),
            agent=kwargs.get("agent"),
            files=kwargs.get("files"),
            session_id=kwargs.get("session_id"),
            continue_session=kwargs.get("continue_session", False),
            timeout_sec=kwargs.get("timeout_sec", 300),
        )

    elif action == "start_server":
        return _start_server(working_dir=kwargs.get("working_dir"))

    elif action == "stop_server":
        return _stop_server()

    elif action == "status":
        running = _server_is_running()
        cli = _find_cli()
        return {
            "status": "success",
            "server_running": running,
            "server_url": _SERVER_URL if running else None,
            "cli_found": cli is not None,
            "cli_path": cli,
        }

    elif action == "session_list":
        return _session_list()

    elif action == "session_create":
        return _session_create(title=kwargs.get("title"))

    elif action == "session_chat":
        session_id = kwargs.get("session_id", "")
        message = kwargs.get("message", "") or kwargs.get("prompt", "")
        if not session_id:
            return {"status": "error", "error": "session_id is required"}
        if not message:
            return {"status": "error", "error": "message is required"}
        return _session_chat(
            session_id=session_id,
            message=message,
            timeout=kwargs.get("timeout_sec", 120),
        )

    else:
        return {
            "status": "error",
            "error": f"Unknown opencode action: {action}. Available: run, start_server, stop_server, status, session_list, session_create, session_chat",
        }
