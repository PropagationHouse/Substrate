"""
Infrastructure modules for autonomous agent operation.
Modules:
- system_events: Lightweight event queue for agent processing
- circuits: Background periodic agent execution
- compaction: Smart context window management
- sessions: Isolated session contexts
- subagents: Spawn child agents for tasks
- exec_approvals: Granular command permissions
- event_watcher: File-based self-scheduling event system
- circuits_tasks: Agent-managed CIRCUITS.md task list
"""

from .system_events import (
    enqueue_system_event,
    drain_system_events,
    peek_system_events,
    has_system_events,
    clear_system_events,
    get_event_stats,
)

from .circuits import (
    CircuitsRunner,
    CircuitsConfig,
    CircuitsResult,
    start_circuits,
    stop_circuits,
    request_circuits_now,
    get_circuits_status,
    # Backward compat
    HeartbeatRunner,
    HeartbeatConfig,
    HeartbeatResult,
    start_heartbeat,
    stop_heartbeat,
    request_heartbeat_now,
    get_heartbeat_status,
)

from .compaction import (
    estimate_tokens,
    estimate_messages_tokens,
    compact_messages,
    prune_history_for_context,
    PruneResult,
)

from .sessions import (
    Session,
    SessionManager,
    get_session_manager,
    create_isolated_session,
    get_main_session,
)

from .subagents import (
    SubagentTask,
    SubagentResult,
    SubagentStatus,
    SubagentRegistry,
    get_subagent_registry,
    init_subagent_registry,
    spawn_subagent,
    get_subagent_task,
    list_subagent_tasks,
)

from .exec_approvals import (
    ApprovalPolicy,
    ApprovalResult,
    ApprovalConfig,
    ExecRequest,
    ExecApprovalManager,
    get_approval_manager,
    init_approval_manager,
    check_exec_approval,
    is_command_approved,
)

from .model_fallback import (
    FailureType,
    ModelAttempt,
    FallbackResult,
    classify_error,
    should_retry,
    run_with_fallback_sync,
    ModelFallbackManager,
    get_fallback_manager,
)

from .event_watcher import (
    EventWatcher,
    start_event_watcher,
    stop_event_watcher,
    get_event_watcher,
    get_event_watcher_status,
    create_event_file,
    delete_event_file,
    list_event_files,
)

from .circuits_tasks import (
    circuits_tasks_dispatch,
    circuits_list,
    circuits_add,
    circuits_remove,
    circuits_complete,
    circuits_clear_completed,
    # Backward compat
    heartbeat_tasks_dispatch,
    heartbeat_list,
    heartbeat_add,
    heartbeat_remove,
    heartbeat_complete,
    heartbeat_clear_completed,
)

from .mcp_client import (
    MCPClientManager,
    MCPServerConfig,
    MCPToolInfo,
    get_mcp_manager,
    init_mcp_client,
    shutdown_mcp_client,
)

from .prompt_builder import (
    build_system_prompt,
    SILENT_TOKEN,
    HEARTBEAT_OK_TOKEN,  # Will be renamed to CIRCUITS_OK_TOKEN
)

__all__ = [
    # System events
    'enqueue_system_event',
    'drain_system_events', 
    'peek_system_events',
    'has_system_events',
    'clear_system_events',
    'get_event_stats',
    # Circuits
    'CircuitsRunner',
    'CircuitsConfig',
    'CircuitsResult',
    'start_circuits',
    'stop_circuits',
    'request_circuits_now',
    'get_circuits_status',
    # Compaction
    'estimate_tokens',
    'estimate_messages_tokens',
    'compact_messages',
    'prune_history_for_context',
    'PruneResult',
    # Sessions
    'Session',
    'SessionManager',
    'get_session_manager',
    'create_isolated_session',
    'get_main_session',
    # Subagents
    'SubagentTask',
    'SubagentResult',
    'SubagentStatus',
    'SubagentRegistry',
    'get_subagent_registry',
    'init_subagent_registry',
    'spawn_subagent',
    'get_subagent_task',
    'list_subagent_tasks',
    # Exec approvals
    'ApprovalPolicy',
    'ApprovalResult',
    'ApprovalConfig',
    'ExecRequest',
    'ExecApprovalManager',
    'get_approval_manager',
    'init_approval_manager',
    'check_exec_approval',
    'is_command_approved',
    # Model fallback
    'FailureType',
    'ModelAttempt',
    'FallbackResult',
    'classify_error',
    'should_retry',
    'run_with_fallback_sync',
    'ModelFallbackManager',
    'get_fallback_manager',
    # Event watcher
    'EventWatcher',
    'start_event_watcher',
    'stop_event_watcher',
    'get_event_watcher',
    'get_event_watcher_status',
    'create_event_file',
    'delete_event_file',
    'list_event_files',
    # Heartbeat tasks
    'heartbeat_tasks_dispatch',
    'heartbeat_list',
    'heartbeat_add',
    'heartbeat_remove',
    'heartbeat_complete',
    'heartbeat_clear_completed',
    # MCP client
    'MCPClientManager',
    'MCPServerConfig',
    'MCPToolInfo',
    'get_mcp_manager',
    'init_mcp_client',
    'shutdown_mcp_client',
    # Prompt builder
    'build_system_prompt',
    'SILENT_TOKEN',
    'HEARTBEAT_OK_TOKEN',
]
