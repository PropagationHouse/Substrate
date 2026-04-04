"""Simulate exact dashboard flow: auth/status -> login -> WS connect -> status RPC."""
import json, urllib.request, sys

print("=== Dashboard Flow Simulation ===\n")

# Step 1: /api/auth/status (through Vite proxy, like the browser does)
print("1. GET /api/auth/status (via Vite proxy :3000)")
try:
    r = urllib.request.urlopen('http://127.0.0.1:3000/api/auth/status', timeout=5)
    status_data = json.loads(r.read())
    print(f"   -> {json.dumps(status_data)}")
    username = status_data.get('username', '')
    configured = status_data.get('configured', False)
    authenticated = status_data.get('authenticated', False)
    print(f"   configured={configured}, authenticated={authenticated}, username={username!r}")
except Exception as e:
    print(f"   FAIL: {e}")
    sys.exit(1)

# Step 2: Login via electron-login (simulates having the right password)
print("\n2. POST /api/auth/electron-login (via Vite proxy :3000)")
try:
    req = urllib.request.Request('http://127.0.0.1:3000/api/auth/electron-login',
        data=b'{}', headers={'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=5)
    login_data = json.loads(r.read())
    token = login_data.get('token', '')
    print(f"   -> status={login_data.get('status')}, token={token[:16]}... (len={len(token)})")
except Exception as e:
    print(f"   FAIL: {e}")
    sys.exit(1)

# Step 3: WS connect through Vite proxy (exactly like useWebSocket.ts does)
print("\n3. WS connect ws://127.0.0.1:3000/ws")
import websocket
try:
    ws = websocket.create_connection('ws://127.0.0.1:3000/ws', timeout=10)
    challenge = json.loads(ws.recv())
    print(f"   -> Challenge: event={challenge.get('event')}")
except Exception as e:
    print(f"   FAIL: {e}")
    sys.exit(1)

# Step 4: Send connect handshake with token (exactly like useWebSocket.ts line 156-172)
print(f"\n4. Send 'connect' RPC with token (len={len(token)})")
try:
    ws.send(json.dumps({
        'type': 'req', 'id': '1', 'method': 'connect',
        'params': {
            'minProtocol': 3, 'maxProtocol': 3,
            'client': {
                'id': 'substrate-dashboard',
                'version': '0.1.0',
                'platform': 'web',
                'mode': 'webchat',
                'instanceId': 'diag-sim-1',
            },
            'role': 'operator',
            'scopes': ['operator.admin', 'operator.read', 'operator.write',
                       'operator.approvals', 'operator.pairing'],
            'auth': {'token': token},
            'caps': ['tool-events']
        }
    }))
    handshake = json.loads(ws.recv())
    print(f"   -> ok={handshake.get('ok')}, payload={json.dumps(handshake.get('payload', {}))}")
    if not handshake.get('ok'):
        print(f"   ERROR: {json.dumps(handshake.get('error', {}))}")
        ws.close()
        sys.exit(1)
except Exception as e:
    print(f"   FAIL: {e}")
    sys.exit(1)

# Step 5: Send 'status' RPC (like GatewayContext.tsx updateStatus)
print("\n5. Send 'status' RPC")
try:
    ws.send(json.dumps({'type': 'req', 'id': '2', 'method': 'status', 'params': {}}))
    status_resp = json.loads(ws.recv())
    print(f"   -> ok={status_resp.get('ok')}, payload={json.dumps(status_resp.get('payload', {}))[:150]}")
except Exception as e:
    print(f"   FAIL: {e}")

# Step 6: Send 'sessions.list' RPC (like GatewayContext.tsx)
print("\n6. Send 'sessions.list' RPC")
try:
    ws.send(json.dumps({'type': 'req', 'id': '3', 'method': 'sessions.list',
                        'params': {'activeMinutes': 1440, 'limit': 200}}))
    ws.settimeout(5)
    sessions_resp = json.loads(ws.recv())
    ok = sessions_resp.get('ok', False)
    payload = sessions_resp.get('payload', {})
    sessions = payload.get('sessions', []) if isinstance(payload, dict) else []
    print(f"   -> ok={ok}, sessions_count={len(sessions)}")
    if sessions:
        for s in sessions[:3]:
            print(f"      - {s.get('sessionKey', s.get('key', '?'))}: {s.get('label', '?')}")
except Exception as e:
    print(f"   FAIL: {e}")

# Step 7: Test some REST with Bearer token (like fetch interceptor does)
print("\n7. GET /api/server-info with Bearer token (via Vite proxy)")
try:
    req = urllib.request.Request('http://127.0.0.1:3000/api/server-info',
        headers={'Authorization': f'Bearer {token}'})
    r = urllib.request.urlopen(req, timeout=5)
    info = json.loads(r.read())
    print(f"   -> agentName={info.get('agentName')}")
except Exception as e:
    print(f"   FAIL: {e}")

print("\n8. GET /api/memories with Bearer token (via Vite proxy)")
try:
    req = urllib.request.Request('http://127.0.0.1:3000/api/memories',
        headers={'Authorization': f'Bearer {token}'})
    r = urllib.request.urlopen(req, timeout=5)
    mem = json.loads(r.read())
    print(f"   -> type={type(mem).__name__}, len={len(mem) if isinstance(mem, list) else 'n/a'}")
except Exception as e:
    print(f"   FAIL: {e}")

ws.close()
print("\n=== ALL STEPS PASSED ===")
