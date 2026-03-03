"""
Plugin Hook Runner - Execute plugin lifecycle hooks.
"""

import logging
import asyncio
from typing import Dict, Any, Optional, List, TypeVar, Callable

from .registry import PluginRegistry
from .types import (
    PluginHookName,
    PluginHookRegistration,
    AgentContext,
    MessageContext,
    ToolContext,
    BeforeAgentStartEvent,
    BeforeAgentStartResult,
    AgentEndEvent,
    MessageReceivedEvent,
    MessageSendingEvent,
    MessageSendingResult,
    BeforeToolCallEvent,
    BeforeToolCallResult,
    AfterToolCallEvent,
)

logger = logging.getLogger(__name__)

T = TypeVar('T')


class HookRunner:
    """
    Executes plugin hooks with proper error handling and priority ordering.
    """
    
    def __init__(self, registry: PluginRegistry, catch_errors: bool = True):
        self.registry = registry
        self.catch_errors = catch_errors
    
    async def _run_void_hook(
        self,
        hook_name: PluginHookName,
        event: Any,
        ctx: Any,
    ) -> None:
        """
        Run a hook that doesn't return a value (fire-and-forget).
        All handlers are executed in parallel.
        """
        hooks = self.registry.get_hooks(hook_name)
        if not hooks:
            return
        
        logger.debug(f"Running {hook_name.value} ({len(hooks)} handlers)")
        
        async def run_handler(hook: PluginHookRegistration):
            try:
                result = hook.handler(event, ctx)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                msg = f"Hook {hook_name.value} from {hook.plugin_id} failed: {e}"
                if self.catch_errors:
                    logger.error(msg)
                else:
                    raise RuntimeError(msg) from e
        
        await asyncio.gather(*[run_handler(h) for h in hooks])
    
    async def _run_modifying_hook(
        self,
        hook_name: PluginHookName,
        event: Any,
        ctx: Any,
        merge_fn: Optional[Callable[[T, T], T]] = None,
    ) -> Optional[T]:
        """
        Run a hook that can return a modifying result.
        Handlers are executed sequentially in priority order.
        """
        hooks = self.registry.get_hooks(hook_name)
        if not hooks:
            return None
        
        logger.debug(f"Running {hook_name.value} ({len(hooks)} handlers, sequential)")
        
        result: Optional[T] = None
        
        for hook in hooks:
            try:
                handler_result = hook.handler(event, ctx)
                if asyncio.iscoroutine(handler_result):
                    handler_result = await handler_result
                
                if handler_result is not None:
                    if merge_fn and result is not None:
                        result = merge_fn(result, handler_result)
                    else:
                        result = handler_result
            except Exception as e:
                msg = f"Hook {hook_name.value} from {hook.plugin_id} failed: {e}"
                if self.catch_errors:
                    logger.error(msg)
                else:
                    raise RuntimeError(msg) from e
        
        return result
    
    # Agent hooks
    
    async def run_before_agent_start(
        self,
        event: BeforeAgentStartEvent,
        ctx: AgentContext,
    ) -> Optional[BeforeAgentStartResult]:
        """Run before_agent_start hook."""
        def merge(acc: BeforeAgentStartResult, next: BeforeAgentStartResult) -> BeforeAgentStartResult:
            return BeforeAgentStartResult(
                system_prompt=next.system_prompt or acc.system_prompt,
                prepend_context=(
                    f"{acc.prepend_context}\n\n{next.prepend_context}"
                    if acc.prepend_context and next.prepend_context
                    else next.prepend_context or acc.prepend_context
                ),
            )
        
        return await self._run_modifying_hook(
            PluginHookName.BEFORE_AGENT_START,
            event,
            ctx,
            merge,
        )
    
    async def run_agent_end(
        self,
        event: AgentEndEvent,
        ctx: AgentContext,
    ) -> None:
        """Run agent_end hook."""
        await self._run_void_hook(PluginHookName.AGENT_END, event, ctx)
    
    # Message hooks
    
    async def run_message_received(
        self,
        event: MessageReceivedEvent,
        ctx: MessageContext,
    ) -> None:
        """Run message_received hook."""
        await self._run_void_hook(PluginHookName.MESSAGE_RECEIVED, event, ctx)
    
    async def run_message_sending(
        self,
        event: MessageSendingEvent,
        ctx: MessageContext,
    ) -> Optional[MessageSendingResult]:
        """Run message_sending hook."""
        def merge(acc: MessageSendingResult, next: MessageSendingResult) -> MessageSendingResult:
            return MessageSendingResult(
                content=next.content or acc.content,
                cancel=next.cancel or acc.cancel,
            )
        
        return await self._run_modifying_hook(
            PluginHookName.MESSAGE_SENDING,
            event,
            ctx,
            merge,
        )
    
    async def run_message_sent(
        self,
        event: MessageReceivedEvent,
        ctx: MessageContext,
    ) -> None:
        """Run message_sent hook."""
        await self._run_void_hook(PluginHookName.MESSAGE_SENT, event, ctx)
    
    # Tool hooks
    
    async def run_before_tool_call(
        self,
        event: BeforeToolCallEvent,
        ctx: ToolContext,
    ) -> Optional[BeforeToolCallResult]:
        """Run before_tool_call hook."""
        def merge(acc: BeforeToolCallResult, next: BeforeToolCallResult) -> BeforeToolCallResult:
            return BeforeToolCallResult(
                params=next.params or acc.params,
                block=next.block or acc.block,
                block_reason=next.block_reason or acc.block_reason,
            )
        
        return await self._run_modifying_hook(
            PluginHookName.BEFORE_TOOL_CALL,
            event,
            ctx,
            merge,
        )
    
    async def run_after_tool_call(
        self,
        event: AfterToolCallEvent,
        ctx: ToolContext,
    ) -> None:
        """Run after_tool_call hook."""
        await self._run_void_hook(PluginHookName.AFTER_TOOL_CALL, event, ctx)
    
    # Session hooks
    
    async def run_session_start(self, event: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        """Run session_start hook."""
        await self._run_void_hook(PluginHookName.SESSION_START, event, ctx)
    
    async def run_session_end(self, event: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        """Run session_end hook."""
        await self._run_void_hook(PluginHookName.SESSION_END, event, ctx)
    
    # Compaction hooks
    
    async def run_before_compaction(self, event: Dict[str, Any], ctx: AgentContext) -> None:
        """Run before_compaction hook."""
        await self._run_void_hook(PluginHookName.BEFORE_COMPACTION, event, ctx)
    
    async def run_after_compaction(self, event: Dict[str, Any], ctx: AgentContext) -> None:
        """Run after_compaction hook."""
        await self._run_void_hook(PluginHookName.AFTER_COMPACTION, event, ctx)
    
    # Server hooks
    
    async def run_server_start(self, event: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        """Run server_start hook."""
        await self._run_void_hook(PluginHookName.SERVER_START, event, ctx)
    
    async def run_server_stop(self, event: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        """Run server_stop hook."""
        await self._run_void_hook(PluginHookName.SERVER_STOP, event, ctx)
    
    # Utility methods
    
    def has_hooks(self, hook_name: PluginHookName) -> bool:
        """Check if any hooks are registered for a hook name."""
        return self.registry.has_hooks(hook_name)
    
    def get_hook_count(self, hook_name: PluginHookName) -> int:
        """Get count of hooks for a hook name."""
        return self.registry.get_hook_count(hook_name)


def create_hook_runner(registry: PluginRegistry, catch_errors: bool = True) -> HookRunner:
    """Create a hook runner for a registry."""
    return HookRunner(registry, catch_errors)


# Synchronous wrappers for non-async contexts

def run_hook_sync(runner: HookRunner, hook_name: str, event: Any, ctx: Any) -> Any:
    """Run a hook synchronously."""
    import asyncio
    
    hook = getattr(runner, f"run_{hook_name}", None)
    if not hook:
        logger.warning(f"Unknown hook: {hook_name}")
        return None
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    if loop.is_running():
        # We're in an async context, create a task
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(asyncio.run, hook(event, ctx))
            return future.result()
    else:
        return loop.run_until_complete(hook(event, ctx))
