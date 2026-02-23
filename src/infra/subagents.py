"""
Subagents - Spawn child agents for delegated tasks.
Allows the main agent to spawn isolated child agents for:
- Parallel task execution
- Specialized subtasks
- Background work
- Task delegation

Features:
- Isolated session per subagent
- Parent-child relationship tracking
- Result aggregation
- Lifecycle management
"""

import time
import logging
import threading
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field
from enum import Enum
import uuid

from .sessions import get_session_manager, Session

logger = logging.getLogger(__name__)


class SubagentStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class SubagentTask:
    """A task assigned to a subagent."""
    id: str
    name: str
    message: str  # The task/prompt for the subagent
    parent_session: str
    status: SubagentStatus = SubagentStatus.PENDING
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Optional[str] = None
    error: Optional[str] = None
    model_override: Optional[str] = None
    timeout_seconds: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "message": self.message,
            "parentSession": self.parent_session,
            "status": self.status.value,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
            "result": self.result,
            "error": self.error,
            "modelOverride": self.model_override,
            "timeoutSeconds": self.timeout_seconds,
            "metadata": self.metadata,
        }


@dataclass 
class SubagentResult:
    """Result from a subagent execution."""
    task_id: str
    success: bool
    output: Optional[str] = None
    error: Optional[str] = None
    duration_ms: int = 0
    session_key: str = ""


class SubagentRegistry:
    """
    Registry and executor for subagents.
    
    Manages the lifecycle of spawned subagents and their tasks.
    """
    
    def __init__(
        self,
        on_execute: Optional[Callable[[SubagentTask, Session], SubagentResult]] = None,
        max_concurrent: int = 3,
    ):
        self._tasks: Dict[str, SubagentTask] = {}
        self._lock = threading.Lock()
        self._on_execute = on_execute
        self._max_concurrent = max_concurrent
        self._running_count = 0
        self._executor_pool: List[threading.Thread] = []
    
    def spawn(
        self,
        name: str,
        message: str,
        parent_session: str = "main",
        model_override: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        metadata: Optional[Dict] = None,
        wait: bool = False,
    ) -> SubagentTask:
        """
        Spawn a new subagent task.
        
        Args:
            name: Name/description of the task
            message: The prompt/task for the subagent
            parent_session: Parent session key
            model_override: Optional model to use
            timeout_seconds: Optional timeout
            metadata: Optional metadata
            wait: If True, wait for completion
            
        Returns:
            The created SubagentTask
        """
        task_id = str(uuid.uuid4())[:8]
        
        task = SubagentTask(
            id=task_id,
            name=name,
            message=message,
            parent_session=parent_session,
            model_override=model_override,
            timeout_seconds=timeout_seconds,
            metadata=metadata or {},
        )
        
        with self._lock:
            self._tasks[task_id] = task
        
        logger.info(f"Spawned subagent task: {name} ({task_id})")
        
        if wait:
            return self._execute_sync(task)
        else:
            self._execute_async(task)
            return task
    
    def _execute_sync(self, task: SubagentTask) -> SubagentTask:
        """Execute task synchronously."""
        self._run_task(task)
        return task
    
    def _execute_async(self, task: SubagentTask):
        """Execute task asynchronously."""
        thread = threading.Thread(
            target=self._run_task,
            args=(task,),
            daemon=True,
        )
        thread.start()
        self._executor_pool.append(thread)
    
    def _run_task(self, task: SubagentTask):
        """Run a subagent task."""
        with self._lock:
            if self._running_count >= self._max_concurrent:
                logger.warning(f"Max concurrent subagents reached, queuing {task.id}")
                # Simple wait - in production would use a proper queue
                while self._running_count >= self._max_concurrent:
                    self._lock.release()
                    time.sleep(0.5)
                    self._lock.acquire()
            
            self._running_count += 1
            task.status = SubagentStatus.RUNNING
            task.started_at = time.time()
        
        try:
            # Create isolated session for this subagent
            session_mgr = get_session_manager()
            session = session_mgr.create_isolated(
                prefix="subagent",
                parent_session=task.parent_session,
                metadata={"taskId": task.id, "taskName": task.name},
            )
            
            # Execute
            if self._on_execute:
                result = self._on_execute(task, session)
                task.result = result.output
                task.error = result.error
                task.status = SubagentStatus.COMPLETED if result.success else SubagentStatus.FAILED
            else:
                # No executor, just mark complete
                task.result = f"[No executor configured] Task: {task.message}"
                task.status = SubagentStatus.COMPLETED
            
            task.completed_at = time.time()
            
            logger.info(f"Subagent task completed: {task.name} ({task.id}) - {task.status.value}")
            
            # Notify system events so parent agent learns about completion
            try:
                from .system_events import enqueue_system_event
                duration = round(task.completed_at - task.started_at, 1) if task.started_at else 0
                tail = (task.result or "")[-300:].strip()
                summary = f"Subagent {task.status.value} ({task.id}, {task.name}, {duration}s)"
                if tail:
                    summary += f": {tail}"
                enqueue_system_event(summary, session_key=task.parent_session, source="subagent")
                
                # Wake circuits
                try:
                    from .circuits import _circuits
                    if _circuits:
                        _circuits.wake_now(reason=f"subagent:{task.id}:done")
                except Exception:
                    pass
            except Exception:
                pass
            
        except Exception as e:
            logger.error(f"Subagent task failed: {task.id} - {e}")
            task.status = SubagentStatus.FAILED
            task.error = str(e)
            task.completed_at = time.time()
        
        finally:
            with self._lock:
                self._running_count -= 1
    
    def get_task(self, task_id: str) -> Optional[SubagentTask]:
        """Get a task by ID."""
        with self._lock:
            return self._tasks.get(task_id)
    
    def wait_for_task(self, task_id: str, timeout: Optional[float] = None) -> Optional[SubagentTask]:
        """Wait for a task to complete."""
        start = time.time()
        while True:
            task = self.get_task(task_id)
            if not task:
                return None
            
            if task.status in (SubagentStatus.COMPLETED, SubagentStatus.FAILED, SubagentStatus.CANCELLED):
                return task
            
            if timeout and (time.time() - start) > timeout:
                return task
            
            time.sleep(0.1)
    
    def cancel_task(self, task_id: str) -> bool:
        """Cancel a pending task."""
        with self._lock:
            task = self._tasks.get(task_id)
            if task and task.status == SubagentStatus.PENDING:
                task.status = SubagentStatus.CANCELLED
                task.completed_at = time.time()
                return True
            return False
    
    def list_tasks(
        self,
        parent_session: Optional[str] = None,
        status: Optional[SubagentStatus] = None,
    ) -> List[Dict[str, Any]]:
        """List tasks with optional filters."""
        with self._lock:
            tasks = []
            for task in self._tasks.values():
                if parent_session and task.parent_session != parent_session:
                    continue
                if status and task.status != status:
                    continue
                tasks.append(task.to_dict())
            
            return sorted(tasks, key=lambda t: t["createdAt"], reverse=True)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get registry statistics."""
        with self._lock:
            by_status: Dict[str, int] = {}
            for task in self._tasks.values():
                by_status[task.status.value] = by_status.get(task.status.value, 0) + 1
            
            return {
                "totalTasks": len(self._tasks),
                "runningCount": self._running_count,
                "maxConcurrent": self._max_concurrent,
                "byStatus": by_status,
            }
    
    def cleanup_old_tasks(self, max_age_seconds: int = 3600):
        """Remove old completed tasks."""
        cutoff = time.time() - max_age_seconds
        with self._lock:
            to_remove = [
                task_id for task_id, task in self._tasks.items()
                if task.completed_at and task.completed_at < cutoff
            ]
            for task_id in to_remove:
                del self._tasks[task_id]
            
            if to_remove:
                logger.info(f"Cleaned up {len(to_remove)} old subagent tasks")


# Global instance
_registry: Optional[SubagentRegistry] = None
_registry_lock = threading.Lock()


def get_subagent_registry() -> SubagentRegistry:
    """Get the global subagent registry."""
    global _registry
    
    with _registry_lock:
        if _registry is None:
            _registry = SubagentRegistry()
        return _registry


def init_subagent_registry(
    on_execute: Optional[Callable[[SubagentTask, Session], SubagentResult]] = None,
    max_concurrent: int = 3,
) -> SubagentRegistry:
    """Initialize the subagent registry with an executor."""
    global _registry
    
    with _registry_lock:
        _registry = SubagentRegistry(
            on_execute=on_execute,
            max_concurrent=max_concurrent,
        )
        return _registry


def spawn_subagent(
    name: str,
    message: str,
    parent_session: str = "main",
    model_override: Optional[str] = None,
    wait: bool = False,
) -> SubagentTask:
    """Spawn a subagent task."""
    return get_subagent_registry().spawn(
        name=name,
        message=message,
        parent_session=parent_session,
        model_override=model_override,
        wait=wait,
    )


def get_subagent_task(task_id: str) -> Optional[SubagentTask]:
    """Get a subagent task by ID."""
    return get_subagent_registry().get_task(task_id)


def list_subagent_tasks(parent_session: Optional[str] = None) -> List[Dict[str, Any]]:
    """List subagent tasks."""
    return get_subagent_registry().list_tasks(parent_session=parent_session)
