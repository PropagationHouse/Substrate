/**
 * Mock Substrate gateway WebSocket server for testing.
 *
 * Simulates the gateway WS protocol: challenge/response handshake,
 * chat message streaming, session CRUD, and error injection.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';

export interface MockGatewayOptions {
  /** Port to listen on (0 = random) */
  port?: number;
  /** Reject connections with invalid tokens */
  requireToken?: string;
  /** Nonce sent in connect.challenge */
  challengeNonce?: string;
}

export interface ReceivedMessage {
  data: unknown;
  raw: string;
  timestamp: number;
}

/**
 * A mock WebSocket server that mimics the Substrate gateway protocol.
 */
export class MockGateway {
  private httpServer: Server;
  private wss: WebSocketServer;
  private connections: Set<WebSocket> = new Set();
  private _received: ReceivedMessage[] = [];
  private _port = 0;
  private _options: MockGatewayOptions;

  constructor(options: MockGatewayOptions = {}) {
    this._options = {
      challengeNonce: 'test-nonce-123',
      ...options,
    };
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      this.connections.add(ws);

      // Send connect.challenge immediately
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: this._options.challengeNonce },
      }));

      ws.on('message', (data: Buffer | string) => {
        const raw = data.toString();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        this._received.push({ data: parsed, raw, timestamp: Date.now() });

        // Handle connect request
        if (typeof parsed === 'object' && parsed !== null) {
          const msg = parsed as Record<string, unknown>;
          if (msg.type === 'req' && msg.method === 'connect') {
            this.handleConnect(ws, msg);
            return;
          }
        }
      });

      ws.on('close', () => {
        this.connections.delete(ws);
      });
    });
  }

  private handleConnect(ws: WebSocket, msg: Record<string, unknown>): void {
    const params = (msg.params || {}) as Record<string, unknown>;
    const auth = (params.auth || {}) as Record<string, unknown>;
    const token = auth.token as string | undefined;

    // Token validation
    if (this._options.requireToken && token !== this._options.requireToken) {
      ws.send(JSON.stringify({
        type: 'res',
        id: msg.id,
        ok: false,
        error: { code: 4001, message: 'Invalid token' },
      }));
      ws.close(1008, 'authentication failed');
      return;
    }

    // Successful connect
    ws.send(JSON.stringify({
      type: 'res',
      id: msg.id,
      ok: true,
      payload: {
        session: { id: 'test-session-1' },
        scopes: ['operator.read', 'operator.write'],
      },
    }));
  }

  /** Start listening. Returns the assigned port. */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this._options.port || 0, '127.0.0.1', () => {
        const addr = this.httpServer.address();
        if (typeof addr === 'object' && addr) {
          this._port = addr.port;
          resolve(this._port);
        } else {
          reject(new Error('Failed to get address'));
        }
      });
      this.httpServer.on('error', reject);
    });
  }

  /** Get the WS URL of this mock gateway. */
  get url(): string {
    return `ws://127.0.0.1:${this._port}`;
  }

  /** Get the HTTP URL of this mock gateway. */
  get httpUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  /** Port the server is listening on. */
  get port(): number {
    return this._port;
  }

  /** All received messages. */
  get received(): ReceivedMessage[] {
    return this._received;
  }

  /** Clear received messages. */
  clearReceived(): void {
    this._received = [];
  }

  /** Wait until at least `count` messages are received, with a timeout. */
  async expectMessages(count: number, timeoutMs = 3000): Promise<ReceivedMessage[]> {
    const start = Date.now();
    while (this._received.length < count) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${count} messages (got ${this._received.length})`,
        );
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return this._received.slice(0, count);
  }

  /** Send a streaming chunk to all connected clients. */
  sendChunk(requestId: string, text: string): void {
    const msg = JSON.stringify({
      type: 'event',
      event: 'chat.chunk',
      payload: { requestId, text },
    });
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  /** Send a completion event to all connected clients. */
  sendComplete(requestId: string): void {
    const msg = JSON.stringify({
      type: 'event',
      event: 'chat.complete',
      payload: { requestId },
    });
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  /** Send an error to all connected clients. */
  sendError(code: number, message: string): void {
    const msg = JSON.stringify({
      type: 'event',
      event: 'error',
      payload: { code, message },
    });
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  /** Disconnect all clients with an optional code/reason. */
  disconnectAll(code = 1000, reason = 'mock disconnect'): void {
    for (const ws of this.connections) {
      ws.close(code, reason);
    }
  }

  /** Send a raw message to all connected clients. */
  broadcast(data: string | Buffer): void {
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  /** Number of currently connected clients. */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** Gracefully shut down the mock server. */
  async close(): Promise<void> {
    for (const ws of this.connections) {
      ws.close(1001, 'server closing');
    }
    this.connections.clear();
    this.wss.close();
    return new Promise((resolve) => {
      this.httpServer.close(() => resolve());
    });
  }
}

/**
 * Create, start, and return a MockGateway. Convenience for tests.
 */
export async function createMockGateway(
  options?: MockGatewayOptions,
): Promise<MockGateway> {
  const gw = new MockGateway(options);
  await gw.start();
  return gw;
}
