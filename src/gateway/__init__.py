"""
Substrate Gateway Module
========================

Background service for persistent agent operation.

Components:
- tray_service: System tray app with circuits/cron scheduling
- autonomous_runner: Full tool loop for autonomous execution
"""

from .tray_service import (
    SubstrateGateway,
    GatewayConfig,
    GatewayState,
    NotificationManager,
    CircuitsScheduler,
    HeartbeatScheduler,  # Backward compat alias
    CronScheduler,
    install_autostart,
    uninstall_autostart,
)

from .autonomous_runner import (
    AutonomousRunner,
    AutonomousConfig,
    RunResult,
    get_autonomous_runner,
    run_autonomous_circuits,
    run_autonomous_heartbeat,  # Backward compat alias
    enqueue_followup,
    get_followup_queue_depth,
)

from .circuits import (
    CIRCUITS_TOKEN,
    CIRCUITS_PROMPT,
    CircuitsConfig,
    read_circuits_file,
    is_circuits_content_effectively_empty,
    strip_circuits_token,
    StripResult,
    build_circuits_prompt,
    should_skip_circuits,
    # Backward compat
    HEARTBEAT_TOKEN,
    HEARTBEAT_PROMPT,
    HeartbeatConfig,
    read_heartbeat_file,
    strip_heartbeat_token,
    build_heartbeat_prompt,
    should_skip_heartbeat,
)

from .followup_queue import (
    FollowupRun,
    QueueSettings,
    QueueMode,
    QueueDropPolicy,
    QueueDedupeMode,
    enqueue_followup as queue_enqueue,
    get_queue_depth,
    schedule_followup_drain,
    drain_queue,
    clear_queue,
    list_queues,
    create_followup_runner,
)

from .substrate_prime import (
    read_substrate_file,
    read_prime_file,
    build_system_prompt_with_substrate,
    should_run_prime,
    PrimeResult,
    mark_prime_complete,
    has_prime_run,
    # Backward compat
    read_soul_file,
    read_boot_file,
    build_system_prompt_with_soul,
    should_run_boot,
    BootResult,
    mark_boot_complete,
    has_boot_run,
)

from .webhooks import (
    WebhookConfig,
    WebhookRegistry,
    get_webhook_registry,
    process_webhook,
    create_webhook,
    verify_webhook_signature,
)

from .session_memory import (
    save_session_memory,
    load_session_memory,
    list_session_memories,
    search_session_memories,
    get_recent_context,
    cleanup_old_memories,
)

from .canvas import (
    create_canvas_page,
    get_canvas_page,
    list_canvas_pages,
    delete_canvas_page,
    start_canvas_server,
    stop_canvas_server,
    is_canvas_server_running,
    DEFAULT_CANVAS_PORT,
)

__all__ = [
    # Tray service
    "SubstrateGateway",
    "GatewayConfig",
    "GatewayState",
    "NotificationManager",
    "CircuitsScheduler",
    "CronScheduler",
    "install_autostart",
    "uninstall_autostart",
    # Autonomous runner
    "AutonomousRunner",
    "AutonomousConfig",
    "RunResult",
    "get_autonomous_runner",
    "run_autonomous_circuits",
    "enqueue_followup",
    "get_followup_queue_depth",
    # Followup queue
    "FollowupRun",
    "QueueSettings",
    "QueueMode",
    "QueueDropPolicy",
    "QueueDedupeMode",
    "queue_enqueue",
    "get_queue_depth",
    "schedule_followup_drain",
    "drain_queue",
    "clear_queue",
    "list_queues",
    "create_followup_runner",
]
