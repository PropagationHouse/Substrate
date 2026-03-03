"""
Exec Tool - Execute shell commands with full control
=====================================================
Features:
- Execute shell commands (cmd/powershell)
- Background execution with output capture
- Timeout support
- PTY support for interactive commands
- Working directory control
- Environment variable injection
"""

import subprocess
import threading
import time
import os
import signal
import logging
import queue
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

# Default workspace directory for agent commands
WORKSPACE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'workspace')

# Try to import PTY support
HAS_PTY = False
try:
    if os.name == 'nt':
        # Windows: use winpty
        import winpty
        HAS_PTY = True
        PTY_TYPE = "winpty"
    else:
        # Unix: use pty module
        import pty
        import select
        HAS_PTY = True
        PTY_TYPE = "pty"
except ImportError:
    logger.debug("PTY support not available. Install winpty (Windows) or use Unix for PTY.")

# Security: Dangerous environment variables that should be blocked
DANGEROUS_ENV_VARS = {
    "PATH",  # Prevent PATH hijacking
    "PYTHONPATH",
    "PYTHONHOME",
    "NODE_PATH",
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
}


class ExecStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    KILLED = "killed"


@dataclass
class ExecSession:
    """Represents a running or completed command execution."""
    session_id: str
    command: str
    cwd: str
    status: ExecStatus
    pid: Optional[int] = None
    started_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None
    exit_code: Optional[int] = None
    output: str = ""
    error: str = ""
    tail: str = ""           # Always the last TAIL_CHARS of output
    background: bool = False
    truncated: bool = False  # True if output was capped
    total_output_chars: int = 0  # Total chars produced (even if truncated)
    
    @property
    def duration_ms(self) -> int:
        end = self.ended_at or time.time()
        return int((end - self.started_at) * 1000)
    
    def append_output(self, chunk: str):
        """Append to output with cap enforcement."""
        self.total_output_chars += len(chunk)
        self.output += chunk
        if len(self.output) > MAX_OUTPUT_CHARS:
            self.truncated = True
            self.output = self.output[-MAX_OUTPUT_CHARS:]
        self.tail = self.output[-TAIL_CHARS:] if len(self.output) > TAIL_CHARS else self.output
    
    def append_error(self, chunk: str):
        """Append to error with cap enforcement."""
        self.error += chunk
        if len(self.error) > MAX_ERROR_CHARS:
            self.truncated = True
            self.error = self.error[-MAX_ERROR_CHARS:]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "command": self.command,
            "cwd": self.cwd,
            "status": self.status.value,
            "pid": self.pid,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "exit_code": self.exit_code,
            "output": self.output[-5000:] if len(self.output) > 5000 else self.output,
            "tail": self.tail,
            "error": self.error[-1000:] if len(self.error) > 1000 else self.error,
            "duration_ms": self.duration_ms,
            "background": self.background,
            "truncated": self.truncated,
            "total_output_chars": self.total_output_chars,
        }


# Global session registry
_sessions: Dict[str, ExecSession] = {}
_session_lock = threading.Lock()
_session_counter = 0


_sweeper_started = False


def _generate_session_id() -> str:
    global _session_counter
    _session_counter += 1
    return f"exec_{int(time.time())}_{_session_counter}"


def _start_session_sweeper():
    """Start a background timer that prunes finished sessions older than TTL."""
    global _sweeper_started
    if _sweeper_started:
        return
    _sweeper_started = True
    
    def sweep():
        try:
            cutoff = time.time() - FINISHED_SESSION_TTL_SEC
            to_remove = []
            with _session_lock:
                for sid, session in _sessions.items():
                    if session.ended_at and session.ended_at < cutoff:
                        to_remove.append(sid)
                for sid in to_remove:
                    del _sessions[sid]
            if to_remove:
                logger.debug(f"[EXEC] Sweeper pruned {len(to_remove)} finished sessions")
        except Exception as e:
            logger.debug(f"[EXEC] Sweeper error: {e}")
        finally:
            # Reschedule
            t = threading.Timer(max(30, FINISHED_SESSION_TTL_SEC / 6), sweep)
            t.daemon = True
            t.start()
    
    t = threading.Timer(60, sweep)  # First sweep after 60s
    t.daemon = True
    t.start()
    logger.debug("[EXEC] Session sweeper started")


def _validate_env(env: Optional[Dict[str, str]]) -> Dict[str, str]:
    """Validate and sanitize environment variables."""
    if not env:
        return {}
    
    sanitized = {}
    for key, value in env.items():
        upper_key = key.upper()
        if upper_key in DANGEROUS_ENV_VARS:
            logger.warning(f"Blocked dangerous env var: {key}")
            continue
        sanitized[key] = value
    
    return sanitized


DEFAULT_TIMEOUT_SEC = 300  # 5 minutes default timeout for all commands

# Output buffering caps (prevents memory blowup on verbose commands)
MAX_OUTPUT_CHARS = 100_000    # Cap total output at 100K chars
MAX_ERROR_CHARS = 20_000      # Cap stderr at 20K chars
TAIL_CHARS = 2000             # Always keep last 2K chars regardless of truncation
FINISHED_SESSION_TTL_SEC = 1800  # Auto-prune finished sessions after 30 minutes


def exec_command(
    command: str,
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    timeout_sec: Optional[int] = None,
    background: bool = False,
    yield_ms: int = 10000,
    shell: str = "powershell",
    on_output: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """
    Execute a shell command.
    
    Args:
        command: The command to execute
        cwd: Working directory (defaults to current)
        env: Additional environment variables
        timeout_sec: Timeout in seconds (None = default 300s, 0 = no timeout)
        background: If True, return immediately and run in background
        yield_ms: Milliseconds to wait before backgrounding (if not explicit background)
        shell: Shell to use ("powershell", "cmd", "bash")
        on_output: Callback for streaming output
        
    Returns:
        Dict with session info and output
    """
    # Start sweeper on first call
    _start_session_sweeper()
    
    # Enforce default timeout unless explicitly disabled (0) or background
    if timeout_sec is None and not background:
        timeout_sec = DEFAULT_TIMEOUT_SEC
    session_id = _generate_session_id()
    
    # Resolve working directory (with workspace nesting guard)
    if cwd:
        cwd = os.path.abspath(os.path.expanduser(cwd))
        # Collapse workspace/workspace nesting
        ws_abs = os.path.abspath(WORKSPACE_DIR)
        ws_name = os.path.basename(os.path.normpath(ws_abs))
        doubled = os.path.join(ws_abs, ws_name)
        if cwd.startswith(doubled):
            cwd = cwd.replace(doubled, ws_abs, 1)
        if not os.path.isdir(cwd):
            return {
                "status": "error",
                "error": f"Working directory does not exist: {cwd}",
                "session_id": session_id,
            }
    else:
        # Default to workspace directory so agent doesn't pollute project root
        if os.path.isdir(WORKSPACE_DIR):
            cwd = os.path.abspath(WORKSPACE_DIR)
        else:
            cwd = os.getcwd()
    
    # Validate environment
    safe_env = _validate_env(env)
    
    # Build full environment
    full_env = os.environ.copy()
    full_env.update(safe_env)
    
    # Create session
    session = ExecSession(
        session_id=session_id,
        command=command,
        cwd=cwd,
        status=ExecStatus.RUNNING,
        background=background,
    )
    
    with _session_lock:
        _sessions[session_id] = session
    
    # Build shell command
    if shell == "powershell":
        shell_cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
    elif shell == "cmd":
        shell_cmd = ["cmd", "/c", command]
    elif shell == "bash":
        shell_cmd = ["bash", "-c", command]
    else:
        shell_cmd = command if isinstance(command, list) else command.split()
    
    def run_process():
        nonlocal session
        try:
            process = subprocess.Popen(
                shell_cmd,
                cwd=cwd,
                env=full_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='replace',
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            )
            
            session.pid = process.pid
            logger.info(f"[EXEC] Started process {process.pid}: {command[:50]}...")
            
            # Collect output with capped buffers
            def read_stdout():
                try:
                    for line in iter(process.stdout.readline, ''):
                        if not line:
                            break
                        session.append_output(line)
                        if on_output:
                            on_output(line)
                except Exception as e:
                    logger.error(f"Error reading stdout: {e}")
            
            def read_stderr():
                try:
                    for line in iter(process.stderr.readline, ''):
                        if not line:
                            break
                        session.append_error(line)
                except Exception as e:
                    logger.error(f"Error reading stderr: {e}")
            
            stdout_thread = threading.Thread(target=read_stdout, daemon=True)
            stderr_thread = threading.Thread(target=read_stderr, daemon=True)
            stdout_thread.start()
            stderr_thread.start()
            
            # Wait for process
            try:
                exit_code = process.wait(timeout=timeout_sec)
                session.exit_code = exit_code
                session.status = ExecStatus.COMPLETED if exit_code == 0 else ExecStatus.FAILED
            except subprocess.TimeoutExpired:
                logger.warning(f"[EXEC] Process {process.pid} timed out after {timeout_sec}s")
                process.kill()
                session.status = ExecStatus.TIMEOUT
                session.exit_code = -1
            
            # Wait for output threads
            stdout_thread.join(timeout=1)
            stderr_thread.join(timeout=1)
            
            # Final tail update
            session.tail = session.output[-TAIL_CHARS:] if len(session.output) > TAIL_CHARS else session.output
            session.ended_at = time.time()
            
            if session.truncated:
                logger.info(f"[EXEC] Output was truncated ({session.total_output_chars} chars produced, {len(session.output)} kept)")
            
            logger.info(f"[EXEC] Process {process.pid} finished with code {session.exit_code}")
            
            # Notify system events if this was a background command
            if session.background:
                try:
                    from ..infra.system_events import enqueue_system_event
                    exit_label = f"code {session.exit_code}" if session.exit_code is not None else "unknown"
                    tail_output = session.tail[-400:].strip() if session.tail else ""
                    summary = f"Background exec {session.status.value} ({session.session_id}, {exit_label})"
                    if tail_output:
                        summary += f": {tail_output}"
                    enqueue_system_event(summary, session_key="main", source="exec")
                    
                    # Wake circuits so agent processes the result promptly
                    try:
                        from ..infra.circuits import _circuits
                        if _circuits:
                            _circuits.wake_now(reason=f"exec:{session.session_id}:exit")
                    except Exception:
                        pass
                except Exception as notify_err:
                    logger.debug(f"[EXEC] Failed to notify background completion: {notify_err}")
            
        except Exception as e:
            logger.error(f"[EXEC] Error running command: {e}")
            session.status = ExecStatus.FAILED
            session.error = str(e)
            session.ended_at = time.time()
    
    if background:
        # Run in background thread
        thread = threading.Thread(target=run_process, daemon=True)
        thread.start()
        
        return {
            "status": "running",
            "session_id": session_id,
            "pid": None,  # Will be set when process starts
            "message": f"Command started in background: {command[:50]}...",
        }
    else:
        # Run and wait (with optional yield to background)
        thread = threading.Thread(target=run_process, daemon=True)
        thread.start()
        
        # Wait for completion or yield time
        thread.join(timeout=yield_ms / 1000 if yield_ms else None)
        
        if thread.is_alive():
            # Process still running, return as background
            session.background = True
            return {
                "status": "running",
                "session_id": session_id,
                "pid": session.pid,
                "message": f"Command running in background (yielded after {yield_ms}ms)",
                "tail": session.output[-500:] if session.output else "",
            }
        else:
            # Process completed
            return session.to_dict()


def exec_pty(
    command: str,
    cwd: Optional[str] = None,
    timeout_sec: Optional[int] = None,
    cols: int = 120,
    rows: int = 30,
) -> Dict[str, Any]:
    """
    Execute a command in a pseudo-terminal (PTY).
    
    Useful for interactive commands that require TTY (vim, htop, coding agents, etc.)
    
    Args:
        command: The command to execute
        cwd: Working directory
        timeout_sec: Timeout in seconds
        cols: Terminal columns (default 120)
        rows: Terminal rows (default 30)
        
    Returns:
        Dict with session info and output
    """
    if not HAS_PTY:
        return {
            "status": "error",
            "error": "PTY not available. Install winpty on Windows: pip install pywinpty",
        }
    
    session_id = _generate_session_id()
    
    # Resolve working directory
    if cwd:
        cwd = os.path.abspath(os.path.expanduser(cwd))
        if not os.path.isdir(cwd):
            return {
                "status": "error",
                "error": f"Working directory does not exist: {cwd}",
            }
    else:
        # Default to workspace directory so agent doesn't pollute project root
        if os.path.isdir(WORKSPACE_DIR):
            cwd = os.path.abspath(WORKSPACE_DIR)
        else:
            cwd = os.getcwd()
    
    session = ExecSession(
        session_id=session_id,
        command=command,
        cwd=cwd,
        status=ExecStatus.RUNNING,
        background=False,
    )
    
    with _session_lock:
        _sessions[session_id] = session
    
    try:
        if os.name == 'nt':
            # Windows PTY using winpty
            import winpty
            
            # Create PTY process
            pty_process = winpty.PtyProcess.spawn(
                f'powershell -NoProfile -Command "{command}"',
                cwd=cwd,
                dimensions=(rows, cols),
            )
            
            session.pid = pty_process.pid
            output_lines = []
            start_time = time.time()
            
            try:
                while pty_process.isalive():
                    # Check timeout
                    if timeout_sec and (time.time() - start_time) > timeout_sec:
                        pty_process.terminate()
                        session.status = ExecStatus.TIMEOUT
                        session.exit_code = -1
                        break
                    
                    # Read output
                    try:
                        data = pty_process.read(1024, timeout=0.1)
                        if data:
                            output_lines.append(data)
                            session.output = ''.join(output_lines)
                    except Exception:
                        pass
                
                # Get exit code
                if session.status != ExecStatus.TIMEOUT:
                    session.exit_code = pty_process.exitstatus() if hasattr(pty_process, 'exitstatus') else 0
                    session.status = ExecStatus.COMPLETED if session.exit_code == 0 else ExecStatus.FAILED
                    
            finally:
                try:
                    pty_process.close()
                except Exception:
                    pass
                    
        else:
            # Unix PTY
            import pty as unix_pty
            import select
            
            master_fd, slave_fd = unix_pty.openpty()
            
            process = subprocess.Popen(
                command,
                shell=True,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=cwd,
                close_fds=True,
            )
            
            os.close(slave_fd)
            session.pid = process.pid
            
            output_lines = []
            start_time = time.time()
            
            try:
                while process.poll() is None:
                    # Check timeout
                    if timeout_sec and (time.time() - start_time) > timeout_sec:
                        process.kill()
                        session.status = ExecStatus.TIMEOUT
                        session.exit_code = -1
                        break
                    
                    # Read output
                    r, _, _ = select.select([master_fd], [], [], 0.1)
                    if r:
                        try:
                            data = os.read(master_fd, 1024).decode('utf-8', errors='replace')
                            if data:
                                output_lines.append(data)
                                session.output = ''.join(output_lines)
                        except OSError:
                            break
                
                if session.status != ExecStatus.TIMEOUT:
                    session.exit_code = process.returncode
                    session.status = ExecStatus.COMPLETED if session.exit_code == 0 else ExecStatus.FAILED
                    
            finally:
                os.close(master_fd)
        
        session.ended_at = time.time()
        return session.to_dict()
        
    except Exception as e:
        logger.error(f"[EXEC PTY] Error: {e}")
        session.status = ExecStatus.FAILED
        session.error = str(e)
        session.ended_at = time.time()
        return session.to_dict()


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Get the status of a running or completed session."""
    with _session_lock:
        session = _sessions.get(session_id)
        if session:
            return session.to_dict()
    return None


def kill_session(session_id: str) -> Dict[str, Any]:
    """Kill a running session."""
    with _session_lock:
        session = _sessions.get(session_id)
        if not session:
            return {"status": "error", "error": f"Session not found: {session_id}"}
        
        if session.status != ExecStatus.RUNNING:
            return {"status": "error", "error": f"Session not running: {session.status.value}"}
        
        if session.pid:
            try:
                os.kill(session.pid, signal.SIGTERM)
                session.status = ExecStatus.KILLED
                session.ended_at = time.time()
                return {"status": "success", "message": f"Killed process {session.pid}"}
            except Exception as e:
                return {"status": "error", "error": f"Failed to kill process: {e}"}
        
        return {"status": "error", "error": "No PID available"}


def list_sessions(active_only: bool = False) -> List[Dict[str, Any]]:
    """List all sessions."""
    with _session_lock:
        sessions = list(_sessions.values())
    
    if active_only:
        sessions = [s for s in sessions if s.status == ExecStatus.RUNNING]
    
    return [s.to_dict() for s in sessions]


class ExecTool:
    """
    Exec tool for LLM function calling.
    
    Provides a structured interface for command execution.
    """
    
    name = "exec"
    description = "Execute shell commands on the system"
    
    schema = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The shell command to execute"
            },
            "workdir": {
                "type": "string",
                "description": "Working directory (optional)"
            },
            "timeout": {
                "type": "integer",
                "description": "Timeout in seconds (optional)"
            },
            "background": {
                "type": "boolean",
                "description": "Run in background (default: false)"
            },
            "shell": {
                "type": "string",
                "enum": ["powershell", "cmd", "bash"],
                "description": "Shell to use (default: powershell)"
            }
        },
        "required": ["command"]
    }
    
    @staticmethod
    def execute(
        command: str,
        workdir: Optional[str] = None,
        timeout: Optional[int] = None,
        background: bool = False,
        shell: str = "powershell",
        **kwargs
    ) -> Dict[str, Any]:
        """Execute the tool."""
        return exec_command(
            command=command,
            cwd=workdir,
            timeout_sec=timeout,
            background=background,
            shell=shell,
        )
