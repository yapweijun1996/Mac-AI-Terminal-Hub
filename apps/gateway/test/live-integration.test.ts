import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import WebSocket, { WebSocketServer } from 'ws';
import { buildServer } from '../src/server.js';
import { createAccessVerifier } from '../src/auth.js';
import type { TerminalBridge } from '../src/terminal-bridge.js';
import { HubApi } from '../../web/src/api/client.js';
import { TerminalConnection } from '../../web/src/terminal/connection.js';

function waitFor(predicate: () => boolean, message: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearInterval(interval); clearTimeout(timeout); if (error) reject(error); else resolve(); };
    const interval = setInterval(() => { try { if (predicate()) finish(); } catch (error) { finish(error instanceof Error ? error : new Error(message)); } }, 10);
    const timeout = setTimeout(() => finish(new Error(message)), timeoutMs);
    if (predicate()) finish();
  });
}

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(message)); }, timeoutMs);
    const cleanup = () => clearTimeout(timeout);
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

test('real loopback gateway proxies browser binary hello, ttyd frames, echo, resize and releases writer lease', async (t) => {
  const env = { CF_ACCESS_TEAM_DOMAIN: 'https://team.example', CF_ACCESS_AUD: 'test-aud', CF_ACCESS_ALLOWED_EMAIL: 'owner@example.test' };
  const session: { id: string; label: string; agent: 'codex'; projectId: string; tmuxName: string; state: 'created' | 'stopped'; createdAt: string } = { id: 'session_live', label: 'integration', agent: 'codex', projectId: 'project_live', tmuxName: 'terminal-hub-session_live', state: 'created', createdAt: new Date().toISOString() };
  let origin = '';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'integration-key', alg: 'RS256', use: 'sig' });
  const verifier = createAccessVerifier({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN, audience: env.CF_ACCESS_AUD, allowedEmail: env.CF_ACCESS_ALLOWED_EMAIL }, createLocalJWKSet({ keys: [jwk] }));
  const jwt = await new SignJWT({ email: env.CF_ACCESS_ALLOWED_EMAIL, type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'integration-key', typ: 'JWT' }).setIssuer(env.CF_ACCESS_TEAM_DOMAIN).setAudience(env.CF_ACCESS_AUD).setIssuedAt().setExpirationTime('2m').sign(privateKey);
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => upstream.once('listening', resolve));
  t.after(async () => { for (const client of upstream.clients) client.terminate(); await new Promise<void>((resolve) => upstream.close(() => resolve())); });
  const received: Buffer[] = [];
  const frontendFrames: number[] = [];
  const browserSockets: WebSocket[] = [];
  let connection: TerminalConnection | undefined;
  const upstreamRecords: Array<{ index: number; hello?: Record<string, unknown>; frames: Buffer[] }> = [];
  let upstreamConnections = 0;
  upstream.on('connection', (socket) => {
    const record = { index: ++upstreamConnections, frames: [] as Buffer[] };
    upstreamRecords.push(record);
    socket.send(Buffer.from([50, ...Buffer.from('{"disableStdin":false}')]), { binary: true });
    socket.send(Buffer.from([49, ...Buffer.from('synthetic ttyd')]), { binary: true });
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      const bytes = Buffer.from(data);
      if (!record.hello) {
        record.hello = JSON.parse(bytes.toString()) as Record<string, unknown>;
        return;
      }
      record.frames.push(bytes);
      received.push(bytes);
      if (isBinary && bytes[0] === 48) socket.send(Buffer.concat([Buffer.from([48]), bytes.subarray(1)]), { binary: true });
    });
  });
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const bridge: TerminalBridge = {
    start: async () => ({ url: `ws://127.0.0.1:${address.port}`, authToken: 'adapter-scoped-secret' }),
    stop: async () => { stopCalls++; for (const client of upstream.clients) client.terminate(); }, close: async () => {},
  };
  let stopCalls = 0;
  const sessions = { get: (id: string) => id === session.id ? session : undefined, inspect: async () => session, inspectAll: async () => [session], stop: async () => { session.state = 'stopped'; return session; } } as never;
  const app = await buildServer({ env, verifier, sessions, terminalBridge: bridge, logger: false });
  t.after(async () => { connection?.stop(); browserSockets.forEach((socket) => socket.terminate()); await app.close(); });
  const listening = await app.listen({ host: '127.0.0.1', port: 0 });
  const host = new URL(listening);
  origin = listening.replace(/\/$/, '');
  env.PUBLIC_ORIGIN = origin;
  const headers = { host: host.host, origin, 'cf-access-jwt-assertion': jwt };
  const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  t.after(() => { if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket); else Reflect.deleteProperty(globalThis, 'WebSocket'); });
  let frontendGrant = '';
  const api = new HubApi(async (input, init) => {
    const requestHeaders = new Headers(init?.headers);
    requestHeaders.set('Origin', origin); requestHeaders.set('Cf-Access-Jwt-Assertion', jwt);
    const response = await fetch(new URL(String(input), listening), { ...init, headers: requestHeaders });
    if (String(input).endsWith('/token')) frontendGrant = (await response.clone().json() as { token: string }).token;
    return response;
  });
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: WebSocket });
  const socketFactory = (url: string, protocols: string[]) => {
    const socket = new WebSocket(url, protocols, { origin }); browserSockets.push(socket);
    const shim: { readyState: number; bufferedAmount: number; binaryType: BinaryType; onopen: ((event: Event) => void) | null; onmessage: ((event: MessageEvent) => void) | null; onclose: ((event: CloseEvent) => void) | null; onerror: ((event: Event) => void) | null; send(data: string | ArrayBuffer | Uint8Array): void; close(code?: number): void } = {
      get readyState() { return socket.readyState; }, get bufferedAmount() { return socket.bufferedAmount; }, binaryType: 'arraybuffer',
      onopen: null, onmessage: null, onclose: null, onerror: null,
      send: (data) => socket.send(data), close: (code) => socket.close(code),
    };
    socket.on('open', () => shim.onopen?.(new Event('open')));
    socket.on('message', (data: Buffer, isBinary: boolean) => { const bytes = Buffer.from(data); if (isBinary && bytes.length) frontendFrames.push(bytes[0]); const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); shim.onmessage?.({ data: isBinary ? array : bytes.toString() } as MessageEvent); });
    socket.on('close', (code: number, reason: Buffer) => shim.onclose?.({ code, reason, wasClean: true } as unknown as CloseEvent));
    socket.on('error', () => shim.onerror?.(new Event('error')));
    return shim as unknown as globalThis.WebSocket;
  };
  let terminalSize = { columns: 96, rows: 31 };
  let terminalOutput = '';
  let writerReady!: () => void;
  const ready = new Promise<void>((resolve) => { writerReady = resolve; });
  const sink = {
    size: () => terminalSize,
    output: (bytes: Uint8Array, drained: () => void) => { terminalOutput += new TextDecoder().decode(bytes); drained(); },
    state: (state: string) => { if (state === 'connected') writerReady(); }, readOnly: (_value: boolean) => {},
  };
  connection = new TerminalConnection(session.id, api, sink, socketFactory, origin);
  connection.start();
  await withTimeout(ready, 'frontend TerminalConnection did not become ready');
  await waitFor(() => upstreamRecords[0]?.hello !== undefined, 'synthetic ttyd did not receive frontend hello');
  assert.deepEqual(upstreamRecords[0]?.hello, { AuthToken: 'adapter-scoped-secret', columns: 96, rows: 31 });
  assert.deepEqual(frontendFrames.slice(0, 2), [50, 49]);
  assert.ok(frontendGrant);
  assert.notEqual(upstreamRecords[0]?.hello?.AuthToken, frontendGrant);
  const connect = (token: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}/t/${session.id}/ws`, ['tty', `hub-${token}`], { origin });
    browserSockets.push(socket);
    socket.once('open', () => socket.send(Buffer.from(JSON.stringify({ AuthToken: token, columns: 96, rows: 31 })), { binary: true }));
    return socket;
  };
  const secondToken = (await app.inject({ url: `/t/${session.id}/token`, headers })).json().token as string;
  const denied = connect(secondToken);
  const deniedStatus = await withTimeout(new Promise<number>((resolve, reject) => {
    denied.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    denied.once('error', reject);
  }), 'writer contention timed out');
  assert.equal(deniedStatus, 423);
  const beforeEcho = terminalOutput.length;
  connection.send('echo-test');
  await waitFor(() => terminalOutput.slice(beforeEcho).includes('echo-test'), 'terminal echo timed out');
  terminalSize = { columns: 120, rows: 40 };
  connection.resize();
  await waitFor(() => received.some((frame) => frame.toString() === '1{"columns":120,"rows":40}'), 'resize frame timed out');
  assert.ok(received.some((frame) => frame[0] === 48 && frame.subarray(1).toString() === 'echo-test'));
  const firstInputIndex = upstreamRecords[0]!.frames.findIndex((frame) => frame[0] === 48 && frame.subarray(1).toString() === 'echo-test');
  const firstResizeIndex = upstreamRecords[0]!.frames.findIndex((frame) => frame.toString() === '1{"columns":120,"rows":40}');
  assert.ok(firstInputIndex >= 0 && firstResizeIndex > firstInputIndex, 'input and resize frames must reach the same scoped upstream in order');
  const closed = new Promise<void>((resolve) => browserSockets[0].once('close', () => resolve()));
  connection.stop();
  await closed;
  const reconnectGrant = (await app.inject({ url: `/t/${session.id}/token`, headers })).json().token as string;
  const reconnect = connect(reconnectGrant);
  await withTimeout(new Promise<void>((resolve, reject) => { reconnect.once('open', resolve); reconnect.once('error', reject); }), 'writer lease was not released');
  await waitFor(() => upstreamConnections === 2, 'reconnected browser upgraded before ttyd accepted connection');
  await waitFor(() => upstreamRecords[1]?.hello !== undefined, 'reconnected upstream did not receive a fresh hello');
  assert.equal(upstreamConnections, 2, 'reconnect must attach exactly one upstream');
  assert.deepEqual(upstreamRecords[1]?.hello, { AuthToken: 'adapter-scoped-secret', columns: 96, rows: 31 });
  assert.notEqual(upstreamRecords[1]?.hello?.AuthToken, reconnectGrant);
  const crashClosed = new Promise<void>((resolve) => reconnect.once('close', () => resolve()));
  [...upstream.clients].at(-1)?.terminate();
  await crashClosed;
  const postCrashGrant = (await app.inject({ url: `/t/${session.id}/token`, headers })).json().token as string;
  const afterCrash = connect(postCrashGrant);
  await withTimeout(new Promise<void>((resolve, reject) => { afterCrash.once('open', resolve); afterCrash.once('error', reject); }), 'writer lease was not released after upstream crash');
  await waitFor(() => upstreamConnections === 3, 'recovery browser upgraded before ttyd accepted connection');
  await waitFor(() => upstreamRecords[2]?.hello !== undefined, 'recovery upstream did not receive a fresh hello');
  assert.equal(upstreamConnections, 3, 'upstream crash recovery must create exactly one upstream');
  assert.deepEqual(upstreamRecords[2]?.hello, { AuthToken: 'adapter-scoped-secret', columns: 96, rows: 31 });
  assert.notEqual(upstreamRecords[2]?.hello?.AuthToken, postCrashGrant);
  const csrf = (await app.inject({ url: '/api/v1/health', headers })).headers['x-csrf-token'] as string;
  const stoppedGrant = (await app.inject({ url: `/t/${session.id}/token`, headers })).json().token as string;
  const stoppedSocketClosed = withTimeout(new Promise<void>((resolve) => afterCrash.once('close', () => resolve())), 'Stop did not close the terminal transport');
  const stopped = await app.inject({ method: 'POST', url: `/api/v1/sessions/${session.id}/stop`, headers: { ...headers, 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrf } });
  assert.equal(stopped.statusCode, 200);
  assert.equal(stopCalls, 1);
  await stoppedSocketClosed;
  const stoppedUpgrade = connect(stoppedGrant);
  const stoppedStatus = await withTimeout(new Promise<number>((resolve, reject) => { stoppedUpgrade.once('unexpected-response', (_request, response) => resolve(response.statusCode)); stoppedUpgrade.once('error', reject); }), 'stopped-session grant was not rejected');
  assert.equal(stoppedStatus, 404);
  assert.equal((await app.inject({ url: `/t/${session.id}/token`, headers })).statusCode, 404);
});

test('native ttyd fails closed without placing credentials in process argv', async () => {
  const { NativeTtydAdapter } = await import('../src/terminal-bridge.js');
  const argsObserved: string[][] = [];
  const adapter = new NativeTtydAdapter('/trusted/ttyd', '/trusted/tmux', ((_command: string, args: string[]) => { argsObserved.push(args); throw new Error('must not launch'); }) as never);
  await assert.rejects(adapter.start({ id: 'session', tmuxName: 'terminal-hub-session' } as never), /safe per-session authentication channel/);
  assert.deepEqual(argsObserved, []);
  await adapter.close();
});
