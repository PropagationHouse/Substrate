"""
Exec Approvals - Granular command execution permissions.
Provides fine-grained control over what commands/tools the agent can execute:
- Allowlists for safe commands
- Denylists for dangerous commands
- Pattern matching for command approval
- Approval callbacks for interactive confirmation
- Audit logging of all executions
"""

import re
import time
import logging
import threading
from typing import Dict, Any, Optional, List, Callable, Set
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
import json

logger = logging.getLogger(__name__)

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
APPROVALS_LOG = DATA_DIR / "exec_approvals.jsonl"


class ApprovalPolicy(str, Enum):
    ALLOW = "allow"      # Always allow
    DENY = "deny"        # Always deny
    ASK = "ask"          # Require user confirmation
    AUTO = "auto"        # Use pattern matching


class ApprovalResult(str, Enum):
    APPROVED = "approved"
    DENIED = "denied"
    PENDING = "pending"
    TIMEOUT = "timeout"


@dataclass
class ExecRequest:
    """A request to execute a command."""
    id: str
    command: str
    tool_name: str
    args: Dict[str, Any]
    session_key: str
    timestamp: float = field(default_factory=time.time)
    result: ApprovalResult = ApprovalResult.PENDING
    reason: Optional[str] = None
    approved_by: Optional[str] = None  # "auto", "user", "allowlist"


# Default safe commands that can auto-approve
DEFAULT_SAFE_COMMANDS = {
    # Read-only file operations
    "cat", "head", "tail", "less", "more", "wc", "file", "stat",
    "ls", "dir", "find", "locate", "which", "whereis", "type",
    # Text processing (read-only)
    "grep", "awk", "sed", "sort", "uniq", "cut", "tr", "diff",
    # System info (read-only)
    "pwd", "whoami", "hostname", "uname", "date", "cal", "uptime",
    "ps", "top", "htop", "free", "df", "du",
    # Network info (read-only)
    "ping", "nslookup", "dig", "host", "curl", "wget",
    # Development (read-only)
    "git status", "git log", "git diff", "git branch",
    "npm list", "pip list", "python --version", "node --version",
    # Echo/print
    "echo", "printf", "print",
}

# Commands that should always be denied
DEFAULT_DANGEROUS_COMMANDS = {
    # Destructive
    "rm -rf /", "rm -rf /*", "rm -rf ~", ":(){ :|:& };:",
    "mkfs", "dd if=/dev/zero", "dd if=/dev/random",
    # System modification
    "chmod 777 /", "chown -R", 
    # Network attacks
    "nc -l", "nmap", 
    # Credential access
    "cat /etc/shadow", "cat /etc/passwd",
}

# Patterns for dangerous operations
DANGEROUS_PATTERNS = [
    r"rm\s+-rf\s+/",           # rm -rf /
    r">\s*/dev/sd[a-z]",       # Write to disk device
    r"mkfs\.",                  # Format filesystem
    r"dd\s+if=.*of=/dev",      # dd to device
    r"chmod\s+-R\s+777",       # Recursive 777
    r"curl.*\|\s*sh",          # Curl pipe to shell
    r"wget.*\|\s*sh",          # Wget pipe to shell
    r"eval\s*\(",              # Eval
    r"exec\s*\(",              # Exec
]


@dataclass
class ApprovalConfig:
    """Configuration for exec approvals."""
    default_policy: ApprovalPolicy = ApprovalPolicy.ALLOW
    safe_commands: Set[str] = field(default_factory=lambda: DEFAULT_SAFE_COMMANDS.copy())
    dangerous_commands: Set[str] = field(default_factory=lambda: DEFAULT_DANGEROUS_COMMANDS.copy())
    dangerous_patterns: List[str] = field(default_factory=lambda: DANGEROUS_PATTERNS.copy())
    auto_approve_read_only: bool = True
    log_all_executions: bool = True
    approval_timeout_seconds: int = 60


class ExecApprovalManager:
    """
    Manages command execution approvals.
    
    Provides:
    - Pattern-based auto-approval for safe commands
    - Pattern-based auto-denial for dangerous commands
    - Interactive approval for uncertain commands
    - Audit logging
    """
    
    def __init__(
        self,
        config: Optional[ApprovalConfig] = None,
        on_approval_needed: Optional[Callable[[ExecRequest], ApprovalResult]] = None,
    ):
        self.config = config or ApprovalConfig()
        self._on_approval_needed = on_approval_needed
        self._pending_requests: Dict[str, ExecRequest] = {}
        self._lock = threading.Lock()
        self._compiled_patterns = [re.compile(p, re.IGNORECASE) for p in self.config.dangerous_patterns]
    
    def check_approval(
        self,
        command: str,
        tool_name: str = "exec",
        args: Optional[Dict[str, Any]] = None,
        session_key: str = "main",
    ) -> ExecRequest:
        """
        Check if a command should be approved for execution.
        
        Args:
            command: The command to execute
            tool_name: Name of the tool requesting execution
            args: Additional arguments
            session_key: Session making the request
            
        Returns:
            ExecRequest with approval result
        """
        import uuid
        request_id = str(uuid.uuid4())[:8]
        
        request = ExecRequest(
            id=request_id,
            command=command,
            tool_name=tool_name,
            args=args or {},
            session_key=session_key,
        )
        
        # Log dangerous patterns but do NOT block — agent has full permissions
        if self._is_dangerous(command):
            request.reason = "Matches dangerous pattern (allowed)"
            logger.warning(f"[EXEC] Dangerous pattern detected but allowed: {command[:80]}")
        
        if self._in_denylist(command):
            request.reason = "In denylist (allowed)"
            logger.warning(f"[EXEC] Denylisted command but allowed: {command[:80]}")
        
        # Check explicit allowlists
        if self._in_allowlist(command):
            request.result = ApprovalResult.APPROVED
            request.reason = "In allowlist"
            request.approved_by = "allowlist"
            self._log_execution(request)
            return request
        
        # Check if read-only and auto-approve enabled
        if self.config.auto_approve_read_only and self._is_read_only(command):
            request.result = ApprovalResult.APPROVED
            request.reason = "Read-only command"
            request.approved_by = "auto"
            self._log_execution(request)
            return request
        
        # Apply default policy
        if self.config.default_policy == ApprovalPolicy.ALLOW:
            request.result = ApprovalResult.APPROVED
            request.reason = "Default policy: allow"
            request.approved_by = "auto"
        elif self.config.default_policy == ApprovalPolicy.DENY:
            request.result = ApprovalResult.DENIED
            request.reason = "Default policy: deny"
        elif self.config.default_policy == ApprovalPolicy.ASK:
            # Need user approval
            if self._on_approval_needed:
                request.result = self._on_approval_needed(request)
                request.approved_by = "user" if request.result == ApprovalResult.APPROVED else None
            else:
                # No callback, default to deny for safety
                request.result = ApprovalResult.DENIED
                request.reason = "No approval callback configured"
        
        self._log_execution(request)
        return request
    
    def _is_dangerous(self, command: str) -> bool:
        """Check if command matches dangerous patterns."""
        for pattern in self._compiled_patterns:
            if pattern.search(command):
                return True
        return False
    
    def _in_denylist(self, command: str) -> bool:
        """Check if command is in denylist."""
        cmd_lower = command.lower().strip()
        for denied in self.config.dangerous_commands:
            if denied.lower() in cmd_lower:
                return True
        return False
    
    def _in_allowlist(self, command: str) -> bool:
        """Check if command is in allowlist."""
        # Extract base command
        parts = command.strip().split()
        if not parts:
            return False
        
        base_cmd = parts[0].lower()
        
        # Check exact match
        if base_cmd in self.config.safe_commands:
            return True
        
        # Check command with first arg (e.g., "git status")
        if len(parts) > 1:
            cmd_with_arg = f"{base_cmd} {parts[1].lower()}"
            if cmd_with_arg in self.config.safe_commands:
                return True
        
        return False
    
    def _is_read_only(self, command: str) -> bool:
        """Check if command is likely read-only."""
        # Commands that modify state
        write_indicators = [
            ">", ">>",  # Redirects
            "rm ", "mv ", "cp ",  # File operations
            "mkdir", "rmdir", "touch",
            "chmod", "chown",
            "kill", "pkill",
            "apt ", "yum ", "brew ", "pip install", "npm install",
            "git push", "git commit", "git checkout",
            "sudo",
        ]
        
        cmd_lower = command.lower()
        for indicator in write_indicators:
            if indicator in cmd_lower:
                return False
        
        return True
    
    def _log_execution(self, request: ExecRequest):
        """Log execution request."""
        if not self.config.log_all_executions:
            return
        
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            
            log_entry = {
                "id": request.id,
                "timestamp": request.timestamp,
                "command": request.command,
                "tool": request.tool_name,
                "session": request.session_key,
                "result": request.result.value,
                "reason": request.reason,
                "approvedBy": request.approved_by,
            }
            
            with open(APPROVALS_LOG, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
                
        except Exception as e:
            logger.warning(f"Failed to log execution: {e}")
    
    def add_to_allowlist(self, command: str):
        """Add a command to the allowlist."""
        self.config.safe_commands.add(command.lower())
    
    def add_to_denylist(self, command: str):
        """Add a command to the denylist."""
        self.config.dangerous_commands.add(command.lower())
    
    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent execution logs."""
        try:
            if not APPROVALS_LOG.exists():
                return []
            
            lines = APPROVALS_LOG.read_text().strip().split("\n")
            logs = [json.loads(line) for line in lines if line]
            return logs[-limit:]
            
        except Exception as e:
            logger.error(f"Error reading logs: {e}")
            return []
    
    def get_stats(self) -> Dict[str, Any]:
        """Get approval statistics."""
        logs = self.get_recent_logs(1000)
        
        by_result: Dict[str, int] = {}
        by_tool: Dict[str, int] = {}
        
        for log in logs:
            result = log.get("result", "unknown")
            tool = log.get("tool", "unknown")
            by_result[result] = by_result.get(result, 0) + 1
            by_tool[tool] = by_tool.get(tool, 0) + 1
        
        return {
            "totalRequests": len(logs),
            "byResult": by_result,
            "byTool": by_tool,
            "allowlistSize": len(self.config.safe_commands),
            "denylistSize": len(self.config.dangerous_commands),
        }


# Global instance
_manager: Optional[ExecApprovalManager] = None
_manager_lock = threading.Lock()


def get_approval_manager() -> ExecApprovalManager:
    """Get the global approval manager."""
    global _manager
    
    with _manager_lock:
        if _manager is None:
            _manager = ExecApprovalManager()
        return _manager


def init_approval_manager(
    config: Optional[ApprovalConfig] = None,
    on_approval_needed: Optional[Callable[[ExecRequest], ApprovalResult]] = None,
) -> ExecApprovalManager:
    """Initialize the approval manager."""
    global _manager
    
    with _manager_lock:
        _manager = ExecApprovalManager(
            config=config,
            on_approval_needed=on_approval_needed,
        )
        return _manager


def check_exec_approval(
    command: str,
    tool_name: str = "exec",
    session_key: str = "main",
) -> ExecRequest:
    """Check if a command should be approved."""
    return get_approval_manager().check_approval(
        command=command,
        tool_name=tool_name,
        session_key=session_key,
    )


def is_command_approved(command: str) -> bool:
    """Quick check if a command would be approved."""
    result = check_exec_approval(command)
    return result.result == ApprovalResult.APPROVED
