"""Quick diagnostic: tests every connection point between dashboard and backend."""
import json, socket, urllib.request

results = []
token = ''

def test(name, fn):
    try:
        status, detail = fn()
        results.append((name, status, detail))
    except Exception as e:
        results.append((name, 'FAIL', str(e)[:80]))

# 1. Backend port
def t1():
    s = socket.create_connection(('127.0.0.1', 8765), timeout=3); s.close()
    return 'PASS', 'Listening'
test('Backend port 8765', t1)

# 2. Vite port
def t2():
    s = socket.create_connection(('127.0.0.1', 3000), timeout=3); s.close()
    return 'PASS', 'Listening'
test('Vite port 3000', t2)

# 3. Direct /api/auth/status
def t3():
    r = urllib.request.urlopen('http://127.0.0.1:8765/api/auth/status', timeout=5)
    d = json.loads(r.read())
    return 'PASS', json.dumps(d)
test('Direct /api/auth/status', t3)

# 4. Proxied /api/auth/status
def t4():
    r = urllib.request.urlopen('http://127.0.0.1:3000/api/auth/status', timeout=5)
    d = json.loads(r.read())
    return 'PASS', json.dumps(d)
test('Proxy /api/auth/status', t4)

# 5. Direct /api/server-info
def t5():
    r = urllib.request.urlopen('http://127.0.0.1:8765/api/server-info', timeout=5)
    d = json.loads(r.read())
    return 'PASS', 'agent=' + d.get('agentName', '?')
test('Direct /api/server-info', t5)

# 6. Proxied /api/server-info
def t6():
    r = urllib.request.urlopen('http://127.0.0.1:3000/api/server-info', timeout=5)
    d = json.loads(r.read())
    return 'PASS', 'agent=' + d.get('agentName', '?')
test('Proxy /api/server-info', t6)

# 7. Direct login
def t7():
    global token
    req = urllib.request.Request('http://127.0.0.1:8765/api/auth/login',
        data=json.dumps({'username': 'admin', 'password': 'admin'}).encode(),
        headers={'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=5)
    d = json.loads(r.read())
    token = d.get('token', '')
    has = bool(token)
    return ('PASS' if has else 'WARN'), 'status=' + d.get('status', '?') + ' token=' + str(has)
test('Direct /api/auth/login', t7)

# 8. Proxied login
def t8():
    global token
    req = urllib.request.Request('http://127.0.0.1:3000/api/auth/login',
        data=json.dumps({'username': 'admin', 'password': 'admin'}).encode(),
        headers={'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=5)
    d = json.loads(r.read())
    t = d.get('token', '')
    if t:
        token = t
    has = bool(t)
    return ('PASS' if has else 'WARN'), 'status=' + d.get('status', '?') + ' token=' + str(has)
test('Proxy /api/auth/login', t8)

# 9. Direct WS
def t9():
    import websocket
    ws = websocket.create_connection('ws://127.0.0.1:8765/ws', timeout=5)
    msg = json.loads(ws.recv())
    ws.close()
    return 'PASS', 'event=' + msg.get('event', '?')
test('Direct WS /ws', t9)

# 10. Proxied WS
def t10():
    import websocket
    ws = websocket.create_connection('ws://127.0.0.1:3000/ws', timeout=5)
    msg = json.loads(ws.recv())
    ev = msg.get('event', '?')
    # 11. Full handshake
    if token:
        ws.send(json.dumps({
            'type': 'req', 'id': '999', 'method': 'connect',
            'params': {
                'minProtocol': 3, 'maxProtocol': 3,
                'client': {'id': 'diag', 'version': '0.1', 'platform': 'test', 'mode': 'webchat', 'instanceId': 'diag1'},
                'role': 'operator',
                'scopes': ['operator.admin'],
                'auth': {'token': token},
                'caps': ['tool-events']
            }
        }))
        hs = json.loads(ws.recv())
        ok = hs.get('ok', False)
        results.append(('WS handshake+auth', 'PASS' if ok else 'FAIL', json.dumps(hs)[:80]))
    else:
        results.append(('WS handshake+auth', 'SKIP', 'No token'))
    ws.close()
    return 'PASS', 'event=' + ev
test('Proxy WS /ws (via Vite)', t10)

# 12. Auth-protected REST
def t12():
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request('http://127.0.0.1:3000/api/tokens', headers=headers)
    r = urllib.request.urlopen(req, timeout=5)
    d = json.loads(r.read())
    return 'PASS', json.dumps(d)[:60]
test('Proxy /api/tokens (Bearer)', t12)

# 13. Sessions endpoint
def t13():
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request('http://127.0.0.1:3000/api/sessions/hidden', headers=headers)
    r = urllib.request.urlopen(req, timeout=5)
    d = json.loads(r.read())
    return 'PASS', json.dumps(d)[:60]
test('Proxy /api/sessions/hidden', t13)

# 14. WS RPC: status (after handshake)
def t14():
    import websocket
    ws = websocket.create_connection('ws://127.0.0.1:3000/ws', timeout=5)
    ws.recv()  # challenge
    ws.send(json.dumps({
        'type': 'req', 'id': '1', 'method': 'connect',
        'params': {
            'minProtocol': 3, 'maxProtocol': 3,
            'client': {'id': 'diag2', 'version': '0.1', 'platform': 'test', 'mode': 'webchat', 'instanceId': 'diag2'},
            'role': 'operator', 'scopes': ['operator.admin'],
            'auth': {'token': token}, 'caps': ['tool-events']
        }
    }))
    hs = json.loads(ws.recv())
    if not hs.get('ok'):
        ws.close()
        return 'FAIL', 'Handshake failed: ' + json.dumps(hs)[:60]
    # Now send status RPC
    ws.send(json.dumps({'type': 'req', 'id': '2', 'method': 'status', 'params': {}}))
    ws.settimeout(5)
    resp = json.loads(ws.recv())
    ws.close()
    ok = resp.get('ok', False)
    model = resp.get('payload', {}).get('model', '?') if ok else '?'
    return ('PASS' if ok else 'FAIL'), 'model=' + str(model)
test('WS RPC: status', t14)

# Print
print()
print('{:<3} {:<32} {:<6} {}'.format('#', 'Test', 'Result', 'Detail'))
print('-' * 95)
for i, (name, status, detail) in enumerate(results, 1):
    d = detail[:55] if len(detail) > 55 else detail
    print('{:<3} {:<32} {:<6} {}'.format(i, name, status, d))
print()
