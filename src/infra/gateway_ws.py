"""
Substrate Gateway WebSocket — Bidirectional JSON-RPC gateway.
=============================================================
Provides a real-time WebSocket endpoint at /ws with:
- Challenge-based connection handshake
- JSON-RPC request/response pattern
- Server-push events (chat deltas, agent state, tool use)
- Session-scoped communication

Protocol:
  Server → Client: {type:'event', event:'gateway.challenge', payload:{nonce}}
  Client → Server: {type:'req', id, method:'connect', params:{auth:{token}, client:{id,version,platform}}}
  Server → Client: {type:'res', id, ok:true, payload:{protocol:3, agent:'substrate'}}
  Client → Server: {type:'req', id, method, params}
  Server → Client: {type:'res', id, ok, payload/error}
  Server → Client: {type:'event', event, payload}
"""

import json
import time
import uuid
import logging
import threading
from typing import Dict, Any, Optional, Set, Callable

logger = logging.getLogger(__name__)

# Protocol version
PROTOCOL_VERSION = 3

# ── Agent state tracking ──────────────────────────────────────────────
# Tracks real-time state of the main agent session for sessions.list
_agent_state = 'idle'  # 'idle' | 'thinking' | 'running' | 'streaming' | 'error'
_agent_state_lock = threading.Lock()
_agent_state_since = 0.0

# ── Streaming accumulator ────────────────────────────────────────────
# The proxy sends incremental deltas (new text only). We accumulate here
# so the dashboard receives cumulative text (full response so far).
_stream_buffer = ''  # current cumulative response text
_stream_buffer_lock = threading.Lock()
_chat_seq = 0  # monotonic sequence counter for chat events
_chat_seq_lock = threading.Lock()
_current_run_id = None  # set when a run starts, cleared on final

def _next_chat_seq() -> int:
    global _chat_seq
    with _chat_seq_lock:
        _chat_seq += 1
        return _chat_seq

def _get_current_run_id() -> Optional[str]:
    return _current_run_id

def _set_current_run_id(rid: Optional[str]):
    global _current_run_id
    _current_run_id = rid

def set_agent_state(state: str):
    """Update tracked agent state (called from translate_and_broadcast)."""
    global _agent_state, _agent_state_since
    with _agent_state_lock:
        _agent_state = state
        _agent_state_since = time.time()

def get_agent_state() -> str:
    with _agent_state_lock:
        return _agent_state

# ── Connected client tracking ─────────────────────────────────────────

class GatewayClient:
    """A connected WebSocket client."""
    __slots__ = ('ws', 'client_id', 'client_version', 'platform', 'mode',
                 'instance_id', 'authenticated', 'connected_at', 'session_key')

    def __init__(self, ws):
        self.ws = ws
        self.client_id: str = ''
        self.client_version: str = ''
        self.platform: str = ''
        self.mode: str = ''
        self.instance_id: str = ''
        self.authenticated: bool = False
        self.connected_at: float = time.time()
        self.session_key: str = 'main'

    def send_json(self, data: Dict[str, Any]) -> bool:
        """Send JSON to client. Returns False if send fails."""
        try:
            self.ws.send(json.dumps(data))
            return True
        except Exception:
            return False


_clients: Set[GatewayClient] = set()
_clients_lock = threading.Lock()


def _add_client(client: GatewayClient):
    with _clients_lock:
        _clients.add(client)


def _remove_client(client: GatewayClient):
    with _clients_lock:
        _clients.discard(client)


def get_connected_count() -> int:
    with _clients_lock:
        return len(_clients)


# ── Event broadcasting ────────────────────────────────────────────────

def broadcast_event(event: str, payload: Dict[str, Any],
                    session_key: Optional[str] = None):
    """
    Broadcast a gateway event to all connected (authenticated) clients.
    If session_key is provided, only send to clients subscribed to that session.
    """
    msg = {"type": "event", "event": event, "payload": payload}
    dead: list = []

    with _clients_lock:
        for client in _clients:
            if not client.authenticated:
                continue
            if session_key and client.session_key != session_key:
                # For now, send to all — session filtering comes in Phase 2
                pass
            if not client.send_json(msg):
                dead.append(client)
        for c in dead:
            _clients.discard(c)


def broadcast_raw(substrate_message: Dict[str, Any]):
    """
    Broadcast the raw send_message_to_frontend payload to all connected WS clients
    as a 'substrate_raw' event. The frontend can process these directly — same
    format the original WebUI uses.
    """
    msg = {"type": "event", "event": "substrate_raw", "payload": substrate_message}
    dead: list = []
    with _clients_lock:
        for client in _clients:
            if not client.authenticated:
                continue
            if not client.send_json(msg):
                dead.append(client)
        for c in dead:
            _clients.discard(c)


def translate_and_broadcast(substrate_message: Dict[str, Any]):
    """
    Translate a Substrate internal message (flat dict) into gateway events
    and broadcast to all connected WS clients.

    Substrate format:  {status:'streaming'|'done'|'thinking', result:str, ...}
    Gateway format:    {type:'event', event:'chat'|'agent', payload:{state, content, ...}}

    All events include sessionKey:'agent:main:main' so the dashboard can
    track per-session state in real time.
    """
    global _stream_buffer

    if not isinstance(substrate_message, dict):
        return

    status = substrate_message.get('status', '')
    result = substrate_message.get('result', '')
    msg_type = substrate_message.get('type', '')
    sk = 'agent:main:main'  # Substrate's primary session key

    # Skip non-chat noise (config, avatar, avatar_emotions, thinking_delta, thinking_end)
    if msg_type in ('config', 'config_update', 'avatar', 'avatar_emotions',
                     'thinking_delta', 'thinking_end', 'thinking_start'):
        return

    # Thinking state — emit chat_started + lifecycle start
    if status == 'thinking' or msg_type == 'thinking':
        set_agent_state('thinking')
        # Reset stream buffer for new run
        with _stream_buffer_lock:
            _stream_buffer = ''
        # Generate a run ID if we don't have one
        run_id = _get_current_run_id()
        if not run_id:
            run_id = str(uuid.uuid4())[:8]
            _set_current_run_id(run_id)
        # Emit chat_started so the frontend can track this run
        broadcast_event('chat', {
            'sessionKey': sk,
            'state': 'started',
            'runId': run_id,
            'seq': _next_chat_seq(),
        })
        broadcast_event('agent', {
            'sessionKey': sk,
            'stream': 'lifecycle',
            'data': {'phase': 'start'},
            'state': 'thinking',
            'runId': run_id,
        })
        return

    # Streaming delta — accumulate into cumulative buffer
    if status == 'streaming' and isinstance(result, str) and result:
        set_agent_state('streaming')
        with _stream_buffer_lock:
            _stream_buffer += result
            cumulative = _stream_buffer
        run_id = _get_current_run_id()
        broadcast_event('chat', {
            'sessionKey': sk,
            'state': 'delta',
            'runId': run_id,
            'seq': _next_chat_seq(),
            'message': {
                'role': 'assistant',
                'content': [{'type': 'text', 'text': cumulative}],
            },
        })
        return

    # Done / success — final response + lifecycle end
    if status in ('done', 'success'):
        set_agent_state('idle')
        run_id = _get_current_run_id()
        _set_current_run_id(None)
        final_text = result if isinstance(result, str) else ''
        # Reset stream buffer
        with _stream_buffer_lock:
            _stream_buffer = ''
        if final_text:
            final_msg = {
                'role': 'assistant',
                'content': [{'type': 'text', 'text': final_text}],
                'timestamp': int(time.time() * 1000),
            }
            broadcast_event('chat', {
                'sessionKey': sk,
                'state': 'final',
                'runId': run_id,
                'seq': _next_chat_seq(),
                'message': final_msg,
                'messages': [final_msg],
            })
        else:
            # Empty result — still send final so frontend clears generating state
            broadcast_event('chat', {
                'sessionKey': sk,
                'state': 'final',
                'runId': run_id,
                'seq': _next_chat_seq(),
            })
        broadcast_event('agent', {
            'sessionKey': sk,
            'stream': 'lifecycle',
            'data': {'phase': 'end'},
            'state': 'idle',
            'runId': run_id,
        })
        return

    # Error
    if status == 'error':
        set_agent_state('idle')
        run_id = _get_current_run_id()
        _set_current_run_id(None)
        with _stream_buffer_lock:
            _stream_buffer = ''
        broadcast_event('chat', {
            'sessionKey': sk,
            'state': 'error',
            'runId': run_id,
            'seq': _next_chat_seq(),
            'error': str(result) if result else 'Unknown error',
        })
        broadcast_event('agent', {
            'sessionKey': sk,
            'stream': 'lifecycle',
            'data': {'phase': 'error'},
            'state': 'error',
            'runId': run_id,
        })
        return

    # Tool use events
    if msg_type == 'tool_use':
        set_agent_state('running')
        broadcast_event('agent', {
            'sessionKey': sk,
            'stream': 'tool',
            'data': {
                'phase': 'start',
                'name': substrate_message.get('tool', ''),
                'args': substrate_message.get('input', {}),
            },
            'state': 'tool_use',
        })
        return

    if msg_type == 'tool_result':
        broadcast_event('agent', {
            'sessionKey': sk,
            'stream': 'tool',
            'data': {
                'phase': 'result',
                'name': substrate_message.get('tool', ''),
            },
            'state': 'tool_result',
        })
        return


# ── RPC Handlers ──────────────────────────────────────────────────────

# Registry of RPC method handlers: method_name -> callable(client, params) -> payload
_rpc_handlers: Dict[str, Callable] = {}


def rpc_handler(method: str):
    """Decorator to register an RPC handler."""
    def decorator(fn):
        _rpc_handlers[method] = fn
        return fn
    return decorator


def _get_agent_ref():
    """Get reference to the global agent object (lazy import to avoid circular deps)."""
    import sys
    proxy_mod = sys.modules.get('proxy_server') or sys.modules.get('__main__')
    if proxy_mod and hasattr(proxy_mod, 'agent'):
        return getattr(proxy_mod, 'agent', None)
    return None


def _get_agent_config() -> Dict[str, Any]:
    """Get the agent's current config dict."""
    agent = _get_agent_ref()
    if agent and hasattr(agent, 'config'):
        return agent.config or {}
    return {}


def _validate_auth_token(token: str) -> bool:
    """Validate a session token using Substrate's auth system.
    
    When no credentials are configured (first-run), accepts any connection
    — matching the behaviour of proxy_server.py's before_request hook.
    """
    try:
        from src.auth import validate_session, has_credentials, get_auth_config
        # If no password has been set up yet, allow all connections
        agent = _get_agent_ref()
        if agent and hasattr(agent, 'config'):
            cfg = agent.config or {}
            if not has_credentials(cfg):
                return True
        # Token provided — validate it
        if token:
            return validate_session(token)
        return False
    except ImportError:
        # Auth module not available — accept any non-empty token
        return bool(token)
    except Exception:
        return False


# ── connect ───────────────────────────────────────────────────────────

@rpc_handler('connect')
def handle_connect(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle connection authentication."""
    auth = params.get('auth', {})
    token = auth.get('token', '')

    # Validate token
    if not _validate_auth_token(token):
        raise RPCError('Authentication failed', code=401)

    # Extract client info
    client_info = params.get('client', {})
    client.client_id = client_info.get('id', 'unknown')
    client.client_version = client_info.get('version', '0.0.0')
    client.platform = client_info.get('platform', 'unknown')
    client.mode = client_info.get('mode', 'webchat')
    client.instance_id = client_info.get('instanceId', '')
    client.authenticated = True

    logger.info(f"[GATEWAY] Client connected: {client.client_id} "
                f"v{client.client_version} ({client.platform})")

    return {
        'protocol': PROTOCOL_VERSION,
        'agent': 'substrate',
        'version': '1.0.0',
    }


# ── status ────────────────────────────────────────────────────────────

@rpc_handler('status')
def handle_status(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Return current agent status."""
    config = _get_agent_config()
    model = config.get('model', 'unknown')
    metadata = {}
    try:
        import sys
        proxy_mod = sys.modules.get('proxy_server') or sys.modules.get('__main__')
        if proxy_mod and hasattr(proxy_mod, '_resolve_model_metadata'):
            metadata = proxy_mod._resolve_model_metadata(model) or {}
    except Exception:
        pass

    return {
        'model': model,
        'displayName': metadata.get('display_name', model),
        'provider': metadata.get('provider', 'unknown'),
        'thinking': config.get('thinking_level', 'none'),
        'connectedClients': get_connected_count(),
    }


# ── chat.send ─────────────────────────────────────────────────────────

@rpc_handler('chat.send')
def handle_chat_send(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Send a chat message to the agent.
    
    If the agent is already processing, the message is queued and will be
    processed automatically when the current request completes.
    """
    message = params.get('message', '')
    session_key = params.get('sessionKey', 'main')

    if not message or not isinstance(message, str):
        raise RPCError('Message is required', code=400)

    run_id = str(uuid.uuid4())[:8]

    # Use the message queue — handles both immediate dispatch and queueing
    from src.infra.message_queue import get_message_queue
    mq = get_message_queue()

    # Set up the executor if not already set
    if not mq._executor:
        mq.set_executor(_chat_message_executor)

    result = mq.enqueue(
        text=message,
        run_id=run_id,
        session_key=session_key,
    )

    return {'runId': run_id, 'status': result.get('status', 'processing'),
            'position': result.get('position', 0)}


def _chat_message_executor(queued_msg):
    """Execute a chat message from the message queue.
    
    This is the same logic as the old chat.send handler, but structured
    as a message queue executor so consecutive requests get queued.
    """
    global _stream_buffer
    message = queued_msg.text
    run_id = queued_msg.run_id

    _set_current_run_id(run_id)

    try:
        import sys, traceback as _tb
        print(f"[GW-PROCESS] Starting chat.send processing for run={run_id} msg={message[:60]}...", file=sys.stderr, flush=True)
        proxy_mod = sys.modules.get('proxy_server') or sys.modules.get('__main__')
        if not proxy_mod:
            print("[GW-PROCESS] ERROR: proxy_mod not found!", file=sys.stderr, flush=True)
            return
        agent = getattr(proxy_mod, 'agent', None)
        send_fn = getattr(proxy_mod, 'send_message_to_frontend', None)
        print(f"[GW-PROCESS] agent={type(agent).__name__ if agent else None} send_fn={getattr(send_fn, '__name__', None)}", file=sys.stderr, flush=True)

        # Emit bus event for chat start
        try:
            from src.infra.event_bus import bus
            bus.emit('chat_started', {
                'user_message': message[:500],
                'session_key': queued_msg.session_key,
                'run_id': run_id,
            })
        except Exception:
            pass

        _start_time = __import__('time').time()

        if agent and send_fn:
            # Show thinking state
            send_fn({
                'status': 'thinking',
                'result': None,
                'messages': [{'role': 'user', 'content': message}],
                'new_message': True,
                'clear_thinking': False,
            })
            # Use process_message — same path as the main UI's /api/input.
            response = agent.process_message({'text': message, 'mode': 'code'})
            print(f"[GW-PROCESS] process_message returned type={type(response).__name__ if response else 'None'} handled={response.get('_handled') if isinstance(response, dict) else 'N/A'}", file=sys.stderr, flush=True)
            # If process_message didn't handle it (returned raw string or unhandled dict),
            # send the final message ourselves.
            if isinstance(response, str):
                send_fn({
                    'status': 'done',
                    'result': response,
                    'clear_thinking': True,
                    'new_message': True,
                })
            elif isinstance(response, dict) and not response.get('_handled'):
                result_text = response.get('result') or response.get('content') or ''
                if result_text and not response.get('suppress_chat'):
                    if 'clear_thinking' not in response:
                        response['clear_thinking'] = True
                    if 'new_message' not in response:
                        response['new_message'] = True
                    if 'messages' not in response:
                        response['messages'] = [
                            {'role': 'user', 'content': message},
                            {'role': 'assistant', 'content': result_text},
                        ]
                    send_fn(response)

            # Emit bus event for chat completion
            try:
                from src.infra.event_bus import bus
                _duration = int((__import__('time').time() - _start_time) * 1000)
                _resp_text = ''
                if isinstance(response, str):
                    _resp_text = response
                elif isinstance(response, dict):
                    _resp_text = response.get('result', '') or response.get('content', '') or ''
                bus.emit('chat_completed', {
                    'user_message': message[:200],
                    'response_preview': str(_resp_text)[:200],
                    'duration_ms': _duration,
                    'session_key': queued_msg.session_key,
                    'run_id': run_id,
                })
            except Exception:
                pass
        else:
            print(f"[GW-PROCESS] ERROR: agent={agent is not None} send_fn={send_fn is not None}", file=sys.stderr, flush=True)
    except Exception as e:
        import traceback as _tb
        print(f"[GW-PROCESS] EXCEPTION: {e}\n{_tb.format_exc()}", file=sys.stderr, flush=True)
        logger.error(f"[GATEWAY] chat.send processing error: {e}")
        set_agent_state('idle')
        _set_current_run_id(None)
        with _stream_buffer_lock:
            _stream_buffer = ''
        broadcast_event('chat', {
            'sessionKey': 'agent:main:main',
            'state': 'error',
            'runId': run_id,
            'seq': _next_chat_seq(),
            'error': str(e),
        })

        # Emit error event
        try:
            from src.infra.event_bus import bus
            bus.emit('error', {'source': 'chat.send', 'message': str(e)})
        except Exception:
            pass


# ── chat.abort ────────────────────────────────────────────────────────

@rpc_handler('chat.abort')
def handle_chat_abort(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Abort a running chat generation."""
    # TODO: Implement abort flag on agent — for now acknowledge
    logger.info("[GATEWAY] chat.abort requested")
    return {'ok': True}


# ── chat.history ──────────────────────────────────────────────────────

@rpc_handler('chat.history')
def handle_chat_history(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Return message history for a session."""
    session_key = params.get('sessionKey', 'main')
    limit = params.get('limit', 50)

    # Try session manager first
    try:
        from src.infra.sessions import get_session_manager
        mgr = get_session_manager()
        session = mgr.get(session_key)
        if session and hasattr(session, 'messages') and session.messages:
            messages = []
            for msg in session.messages:
                messages.append({
                    'role': msg.role,
                    'content': msg.content,
                    'timestamp': msg.timestamp,
                })
            return {'messages': messages, 'sessionKey': session_key}
    except Exception:
        pass

    # Fallback: read from unified_memory
    try:
        agent = _get_agent_ref()
        if agent and hasattr(agent, 'unified_memory'):
            conn = agent.unified_memory._get_connection()
            try:
                cursor = conn.execute(
                    """SELECT timestamp, user_message, assistant_response
                       FROM memories
                       WHERE type != 'foundational'
                       ORDER BY timestamp DESC LIMIT ?""",
                    (limit,)
                )
                messages = []
                for row in reversed(cursor.fetchall()):
                    ts = int(row['timestamp'] * 1000)
                    if row['user_message']:
                        messages.append({
                            'role': 'user',
                            'content': row['user_message'],
                            'timestamp': ts,
                        })
                    if row['assistant_response']:
                        messages.append({
                            'role': 'assistant',
                            'content': row['assistant_response'],
                            'timestamp': ts,
                        })
                return {'messages': messages, 'sessionKey': session_key}
            finally:
                conn.close()
    except Exception as e:
        logger.error(f"[GATEWAY] chat.history error: {e}")

    return {'messages': [], 'sessionKey': session_key}


# ── sessions.list ─────────────────────────────────────────────────────

@rpc_handler('sessions.list')
def handle_sessions_list(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """List all sessions. Always includes Substrate's main session."""
    sessions = []

    # Build the main session entry from agent config
    config = _get_agent_config()
    model = config.get('model', 'unknown') if config else 'unknown'
    thinking = config.get('thinking_level', 'none') if config else 'none'
    agent_name = config.get('agent_name', 'Substrate') if config else 'Substrate'

    main_session = {
        'sessionKey': 'agent:main:main',
        'key': 'agent:main:main',
        'label': agent_name,
        'state': get_agent_state(),
        'model': model,
        'thinking': thinking,
        'kind': 'root',
        'updatedAt': int(time.time() * 1000),
        'lastActivity': int(time.time() * 1000),
        'totalTokens': 0,
        'contextTokens': 0,
    }
    sessions.append(main_session)

    # Also include any sessions from the session manager
    try:
        from src.infra.sessions import get_session_manager
        mgr = get_session_manager()
        session_type = params.get('type')
        include_empty = params.get('includeEmpty', False)
        extra = mgr.list_sessions(
            session_type=session_type,
            include_empty=include_empty,
        )
        # Avoid duplicating main
        seen = {'agent:main:main'}
        for s in extra:
            sk = s.get('sessionKey') or s.get('key', '')
            if sk not in seen:
                sessions.append(s)
                seen.add(sk)
    except Exception as e:
        logger.debug(f"[GATEWAY] sessions.list manager error (non-fatal): {e}")

    return {'sessions': sessions}


# ── sessions.delete ───────────────────────────────────────────────────

@rpc_handler('sessions.delete')
def handle_sessions_delete(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a session."""
    session_key = params.get('sessionKey', '')
    if not session_key:
        raise RPCError('sessionKey is required', code=400)

    try:
        from src.infra.sessions import get_session_manager
        mgr = get_session_manager()
        deleted = mgr.delete(session_key)
        return {'deleted': deleted, 'sessionKey': session_key}
    except Exception as e:
        raise RPCError(f'Failed to delete session: {e}')


# ── sessions.reset ────────────────────────────────────────────────────

@rpc_handler('sessions.reset')
def handle_sessions_reset(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Clear messages from a session."""
    session_key = params.get('sessionKey', '')
    if not session_key:
        raise RPCError('sessionKey is required', code=400)

    try:
        from src.infra.sessions import get_session_manager
        mgr = get_session_manager()
        mgr.clear_session(session_key)
        return {'cleared': True, 'sessionKey': session_key}
    except Exception as e:
        raise RPCError(f'Failed to reset session: {e}')


# ── sessions.patch ────────────────────────────────────────────────────

@rpc_handler('sessions.patch')
def handle_sessions_patch(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Update session metadata (model, thinking level, label)."""
    session_key = params.get('sessionKey', '') or params.get('key', '')
    if not session_key:
        raise RPCError('sessionKey is required', code=400)

    model = params.get('model')
    thinking_level = params.get('thinkingLevel')

    result = {}

    # Switch model if requested
    if model:
        agent = _get_agent_ref()
        if agent and hasattr(agent, 'switch_model'):
            switch_result = agent.switch_model(model)
            result['model'] = model
            result['modelSwitchStatus'] = switch_result.get('status', 'unknown')
        else:
            # Direct config update
            config = _get_agent_config()
            config['model'] = model
            result['model'] = model

    # Update thinking level
    if thinking_level is not None:
        config = _get_agent_config()
        config['thinking_level'] = thinking_level
        result['thinkingLevel'] = thinking_level

    return result


# ── sessions.save ────────────────────────────────────────────────────

@rpc_handler('sessions.save')
def handle_sessions_save(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Save/snapshot the current conversation before clearing.

    Pulls messages from the session manager or unified memory,
    writes a timestamped JSON snapshot via session_memory, and
    optionally clears the session afterwards.

    Params:
        sessionKey (str): Session to snapshot (default 'main').
        summary   (str): Optional human-readable summary.
        clear     (bool): Clear messages after saving (default False).
    """
    session_key = params.get('sessionKey', 'main')
    summary = params.get('summary')
    clear = params.get('clear', False)

    # Collect messages — prefer session manager, fallback to unified memory
    messages: list = []
    try:
        from src.infra.sessions import get_session_manager
        mgr = get_session_manager()
        session = mgr.get(session_key)
        if session and session.messages:
            messages = [m.to_dict() for m in session.messages]
    except Exception:
        pass

    if not messages:
        try:
            agent = _get_agent_ref()
            if agent and hasattr(agent, 'unified_memory'):
                conn = agent.unified_memory._get_connection()
                try:
                    cursor = conn.execute(
                        """SELECT timestamp, user_message, assistant_response
                           FROM memories WHERE type != 'foundational'
                           ORDER BY timestamp DESC LIMIT 100""",
                    )
                    for row in reversed(cursor.fetchall()):
                        if row['user_message']:
                            messages.append({'role': 'user', 'content': row['user_message'],
                                             'timestamp': row['timestamp']})
                        if row['assistant_response']:
                            messages.append({'role': 'assistant', 'content': row['assistant_response'],
                                             'timestamp': row['timestamp']})
                finally:
                    conn.close()
        except Exception:
            pass

    if not messages:
        return {'saved': False, 'reason': 'No messages to save'}

    # Persist snapshot
    try:
        from src.gateway.session_memory import save_session_memory
        filepath = save_session_memory(
            session_id=session_key,
            messages=messages,
            metadata={'model': (_get_agent_config() or {}).get('model', 'unknown')},
            summary=summary,
        )
    except Exception as e:
        raise RPCError(f'Failed to save session: {e}')

    # Optionally clear after save
    if clear:
        try:
            from src.infra.sessions import get_session_manager
            get_session_manager().clear_session(session_key)
        except Exception:
            pass

    # Emit event
    try:
        from src.infra.event_bus import bus
        bus.emit('session_saved', {
            'session_key': session_key,
            'message_count': len(messages),
            'filepath': filepath,
        })
    except Exception:
        pass

    return {
        'saved': True,
        'sessionKey': session_key,
        'messageCount': len(messages),
        'filepath': filepath,
    }


# ── sessions.memories ────────────────────────────────────────────────

@rpc_handler('sessions.memories')
def handle_sessions_memories(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """List saved session snapshots.

    Params:
        sessionId (str): Filter by session ID (optional).
        query     (str): Search within saved memories (optional).
        limit     (int): Max results (default 20).
    """
    session_id = params.get('sessionId')
    query = params.get('query', '')
    limit = params.get('limit', 20)

    try:
        from src.gateway.session_memory import list_session_memories, search_session_memories

        if query:
            results = search_session_memories(query=query, limit=limit)
            return {'memories': results, 'query': query}
        else:
            results = list_session_memories(session_id=session_id, limit=limit)
            return {'memories': results}
    except Exception as e:
        raise RPCError(f'Failed to list session memories: {e}')


# ── sessions.resume ──────────────────────────────────────────────────

@rpc_handler('sessions.resume')
def handle_sessions_resume(client: GatewayClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Resume a previously saved conversation.

    Loads the snapshot file and injects its messages into the session
    manager so subsequent chat.history calls return them. The agent's
    unified memory is NOT modified — this is a UI-level restoration.

    Params:
        filepath   (str): Path to the snapshot JSON (from sessions.memories).
        sessionKey (str): Target session to load into (default 'main').
        append     (bool): Append to existing messages (default False = replace).
    """
    filepath = params.get('filepath', '')
    if not filepath:
        raise RPCError('filepath is required', code=400)

    session_key = params.get('sessionKey', 'main')
    append = params.get('append', False)

    # Load snapshot
    try:
        from src.gateway.session_memory import load_session_memory
        snapshot = load_session_memory(filepath)
        if not snapshot:
            raise RPCError(f'Could not load snapshot: {filepath}', code=404)
    except RPCError:
        raise
    except Exception as e:
        raise RPCError(f'Failed to load snapshot: {e}')

    # Inject messages into session manager
    try:
        from src.infra.sessions import get_session_manager
        mgr = get_session_manager()
        session = mgr.get_or_create(session_key, session_type='main')

        if not append:
            session.clear_messages()

        restored = 0
        for msg in snapshot.messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            if content:
                session.add_message(role, content, metadata=msg.get('metadata'))
                restored += 1

        mgr.update(session)
    except Exception as e:
        raise RPCError(f'Failed to resume session: {e}')

    # Emit event
    try:
        from src.infra.event_bus import bus
        bus.emit('session_resumed', {
            'session_key': session_key,
            'filepath': filepath,
            'message_count': restored,
            'summary': snapshot.summary,
        })
    except Exception:
        pass

    return {
        'resumed': True,
        'sessionKey': session_key,
        'messageCount': restored,
        'summary': snapshot.summary,
        'originalSessionId': snapshot.session_id,
    }


# ── RPCError ──────────────────────────────────────────────────────────

class RPCError(Exception):
    """Error raised by RPC handlers."""
    def __init__(self, message: str, code: int = 500):
        super().__init__(message)
        self.code = code


# ── Main WS handler ──────────────────────────────────────────────────

def handle_gateway_ws(ws):
    """
    Main WebSocket handler for the Substrate gateway.
    Called by @sock.route('/ws') in proxy_server.py.
    """
    client = GatewayClient(ws)
    _add_client(client)

    # Send challenge
    nonce = uuid.uuid4().hex
    try:
        client.send_json({
            'type': 'event',
            'event': 'gateway.challenge',
            'payload': {'nonce': nonce},
        })
    except Exception:
        _remove_client(client)
        return

    try:
        while True:
            raw = ws.receive(timeout=60)
            if raw is None:
                # Send keepalive
                try:
                    client.send_json({'type': 'event', 'event': 'ping', 'payload': {}})
                except Exception:
                    break
                continue

            # Parse message
            try:
                msg = json.loads(raw) if isinstance(raw, str) else json.loads(raw.decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                client.send_json({
                    'type': 'res',
                    'id': '?',
                    'ok': False,
                    'error': {'message': 'Invalid JSON'},
                })
                continue

            msg_type = msg.get('type', '')
            req_id = msg.get('id', '')
            method = msg.get('method', '')

            # Handle RPC requests
            if msg_type == 'req' and method:
                # Auth gate — only 'connect' allowed before auth
                if not client.authenticated and method != 'connect':
                    client.send_json({
                        'type': 'res',
                        'id': req_id,
                        'ok': False,
                        'error': {'message': 'Not authenticated. Call connect first.', 'code': 401},
                    })
                    continue

                handler = _rpc_handlers.get(method)
                if not handler:
                    client.send_json({
                        'type': 'res',
                        'id': req_id,
                        'ok': False,
                        'error': {'message': f'Unknown method: {method}', 'code': 404},
                    })
                    continue

                try:
                    params = msg.get('params', {})
                    payload = handler(client, params)
                    client.send_json({
                        'type': 'res',
                        'id': req_id,
                        'ok': True,
                        'payload': payload or {},
                    })
                except RPCError as e:
                    client.send_json({
                        'type': 'res',
                        'id': req_id,
                        'ok': False,
                        'error': {'message': str(e), 'code': e.code},
                    })
                except Exception as e:
                    logger.error(f"[GATEWAY] RPC error in {method}: {e}")
                    client.send_json({
                        'type': 'res',
                        'id': req_id,
                        'ok': False,
                        'error': {'message': f'Internal error: {e}', 'code': 500},
                    })

    except Exception as e:
        logger.debug(f"[GATEWAY] Client disconnected: {e}")
    finally:
        _remove_client(client)
        logger.info(f"[GATEWAY] Client disconnected: {client.client_id or 'unknown'}")
