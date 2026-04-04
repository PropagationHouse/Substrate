# Substrate Infrastructure Changes

> Reference for testing and verifying all recent infrastructure additions.  
> Created: 2026-04-03

---

## Summary Table

| # | Feature | File(s) | Type | How to Verify |
|---|---------|---------|------|---------------|
| 1 | **Event Bus** | `src/infra/event_bus.py` | New module | `from src.infra.event_bus import bus; bus.emit('test', {'hello': 1}); print(bus.stats())` |
| 2 | **Cost Tracker** | `src/infra/cost_tracker.py` | New module | After any chat, check `GET /api/cost` or `from src.infra.cost_tracker import get_cost_tracker; print(get_cost_tracker().get_session_stats())` |
| 3 | **Message Queue** | `src/infra/message_queue.py` + `gateway_ws.py` | New module + wired | Send 2+ rapid messages via WS `chat.send` — second should queue (position > 0) instead of error |
| 4 | **Event Logger** | `src/infra/event_logger.py` | New module | After any activity, check `data/events/` for `.jsonl` files with timestamped entries |
| 5 | **Cost Tracking Wired** | `proxy_server.py` (`_post_stream_actions`) | Wired | Send a chat message, then check `GET /api/cost` — should show token counts and estimated USD |
| 6 | **Event Logger Init** | `proxy_server.py` (startup) | Wired | Start server → `data/events/YYYY-MM-DD.jsonl` should appear after first event |
| 7 | **Subagent as Core Tool** | `src/tools/tool_registry.py` | Modified | Ask the agent to "spawn a subagent to check the weather" — the `agent` tool should be available without on-demand loading |
| 8 | **Subagent Event Bus** | `src/infra/subagents.py` | Modified | After a subagent runs, check event bus history: `bus.get_history('subagent_completed')` |
| 9 | **Skill Watcher** | `src/infra/skill_watcher.py` | New module | Edit/create any `.md` in `skills/` → logs should show "Skill file changed" and cache invalidates |
| 10 | **Tool Input Validation** | `src/tools/tool_validator.py` | New module | Call any tool with wrong arg types → should get validation error instead of crash |
| 11 | **Settings Validation** | `src/infra/settings_validator.py` | New module | `from src.infra.settings_validator import validate_settings; print(validate_settings({"model": 123}))` — returns errors for wrong types |
| 12 | **Session Resume** | `src/infra/gateway_ws.py` (3 RPC handlers) | New handlers | See "Session Resume Testing" section below |
| 13 | **Stall Detection** | `src/infra/circuits.py` | Modified | See "Stall Detection Testing" section below |
| 14 | **Verification Skill** | `skills/verify-task.md` | New skill | Ask the agent to "verify" something — skill should auto-load and guide post-task checks |

---

## Detailed Testing Guide

### Session Resume (Item #12)

Three new WebSocket RPC methods were added to `gateway_ws.py`:

| Method | Params | What it does |
|--------|--------|--------------|
| `sessions.save` | `sessionKey` (default "main"), `summary` (optional), `clear` (bool) | Snapshots current conversation to `data/session_memories/` as JSON |
| `sessions.memories` | `sessionId` (optional filter), `query` (optional search), `limit` (default 20) | Lists all saved session snapshots |
| `sessions.resume` | `filepath` (required, from memories response), `sessionKey`, `append` (bool) | Loads saved snapshot messages back into session manager |

**Test flow:**
1. Have a conversation with the agent (at least a few messages)
2. Call `sessions.save` → should return `{saved: true, messageCount: N, filepath: "..."}`
3. Call `sessions.memories` → should list the snapshot you just saved
4. Call `sessions.reset` to clear the session
5. Call `sessions.resume` with the filepath → should return `{resumed: true, messageCount: N}`
6. Call `chat.history` → should show the restored messages

**WebSocket example:**
```json
{"type": "req", "id": "1", "method": "sessions.save", "params": {"sessionKey": "main", "summary": "Testing session save"}}
{"type": "req", "id": "2", "method": "sessions.memories", "params": {}}
{"type": "req", "id": "3", "method": "sessions.resume", "params": {"filepath": "<from step 2>", "sessionKey": "main"}}
```

---

### Stall Detection (Item #13)

Added to `CircuitsRunner` in `src/infra/circuits.py`:

| Config Field | Default | What it does |
|-------------|---------|--------------|
| `max_run_seconds` | 300 (5 min) | Timeout for a single circuits run |
| `max_consecutive_stalls` | 3 | After this many stalls in a row, doubles the interval |

| Status Field | Type | What it shows |
|-------------|------|---------------|
| `consecutiveStalls` | int | Current streak of timed-out runs |
| `totalStalls` | int | Lifetime stall count |
| `stallBackoff` | bool | True if interval is currently doubled |

**Behavior:**
- Each circuits run now executes in a worker thread with a timeout
- If the run exceeds `max_run_seconds`, it's logged as a stall
- After `max_consecutive_stalls` stalls in a row, the interval doubles (capped at 1 hour)
- A successful run resets the stall counter and disables backoff
- Stall events are emitted on the event bus as `circuits_stall`

**How to check:**
- `GET /api/circuits-config` → status should now include `consecutiveStalls`, `totalStalls`, `stallBackoff`
- Event logger (`data/events/`) will record any `circuits_stall` events
- Server logs will show warnings like `"Circuits stall detected: run #N exceeded 300s"`

---

### Event Bus Quick Reference (Item #1)

All infrastructure components emit events on the bus. Key event names:

| Event | Emitted by | Data |
|-------|-----------|------|
| `cost_update` | cost_tracker | `{session_id, model, input_tokens, output_tokens, cost_usd}` |
| `subagent_completed` | subagents | `{task_id, task_name, success, duration_ms}` |
| `skill_changed` | skill_watcher | `{file, action, skill_name}` |
| `session_saved` | gateway_ws | `{session_key, message_count, filepath}` |
| `session_resumed` | gateway_ws | `{session_key, filepath, message_count, summary}` |
| `circuits_stall` | circuits | `{run_count, timeout_seconds, elapsed_seconds, consecutive_stalls}` |

**Listen to any event:**
```python
from src.infra.event_bus import bus
bus.on('circuits_stall', lambda data: print(f"STALL! {data}"))
```

---

### Files Created/Modified

**New files:**
- `src/infra/event_bus.py`
- `src/infra/cost_tracker.py`
- `src/infra/message_queue.py`
- `src/infra/event_logger.py`
- `src/infra/skill_watcher.py`
- `src/tools/tool_validator.py`
- `src/infra/settings_validator.py`
- `skills/verify-task.md`

**Modified files:**
- `src/infra/gateway_ws.py` — message queue in chat.send + 3 session resume handlers
- `src/infra/circuits.py` — stall detection wrapper
- `src/infra/__init__.py` — exports for new modules
- `src/tools/tool_registry.py` — agent tool promoted to core + event bus
- `src/infra/subagents.py` — event bus emission on completion
