import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import WebSocket from 'ws';
import { accessConfigFromEnv, createAccessVerifier, type AccessVerifier } from './auth.js';
import { ProjectAllowlist } from './projects.js';
import { SessionManager, type Agent, type HubSession } from './sessions.js';
import { NativeTtydAdapter, type TerminalBridge } from './terminal-bridge.js';

export interface ServerOptions { env?: NodeJS.ProcessEnv; verifier?: AccessVerifier; projects?: ProjectAllowlist; sessions?: SessionManager; terminalBridge?: TerminalBridge; logger?: boolean }
const agents: Agent[] = ['codex', 'claude', 'pi'];

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? process.env;
  const config = accessConfigFromEnv(env);
  const verifier = options.verifier ?? (config ? createAccessVerifier(config) : undefined);
  const roots = (env.PROJECT_ROOTS ?? '').split(pathDelimiter()).filter(Boolean);
  const projects = options.projects ?? new ProjectAllowlist(roots);
  if (!options.projects && roots.length) await projects.initialize();
  const sessions = options.sessions ?? new SessionManager(env.TMUX_BIN, { codex: env.CODEX_BIN, claude: env.CLAUDE_BIN, pi: env.PI_BIN });
  const terminalBridge = options.terminalBridge ?? new NativeTtydAdapter(env.TTYD_BIN, env.TMUX_BIN);
  const idempotency = new Map<string, Promise<HubSession>>();
  const csrfTokens = new Map<string, { token: string; expiresAt: number }>();
  const terminalTokens = new Map<string, { sessionId: string; actor: string; expiresAt: number }>();
  const writers = new Map<string, symbol>();
  const app = Fastify({ logger: options.logger ?? true, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 16 * 1024 });
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('content-security-policy', "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    const requestHost = request.headers.host?.toLowerCase();
    const expectedHost = env.PUBLIC_ORIGIN ? safeHost(env.PUBLIC_ORIGIN) : undefined;
    if (env.PUBLIC_ORIGIN ? !expectedHost || requestHost !== expectedHost : !isLoopbackHost(requestHost)) {
      return reply.code(400).send({ error: 'host_denied' });
    }
    const terminalPath = request.url.startsWith('/t/');
    const isTerminalUpgrade = terminalPath && request.headers.upgrade?.toLowerCase() === 'websocket';
    if (isTerminalUpgrade && !sameOrigin(request.headers.origin, env.PUBLIC_ORIGIN)) return reply.code(403).send({ error: 'origin_denied' });
    if (isTerminalUpgrade && /^\/t\/[A-Za-z0-9_-]+\/ws(?:\?|$)/.test(request.url)) return;
    if (!verifier) return reply.code(503).send({ error: 'gateway_not_configured' });
    const token = request.headers['cf-access-jwt-assertion'];
    if (typeof token !== 'string') return reply.code(401).send({ error: 'unauthorized' });
    try { const identity = await verifier(token); (request as typeof request & { actor?: string }).actor = String(identity.email).toLowerCase(); }
    catch { request.log.warn({ event: 'auth_denied', result: 'denied' }); return reply.code(401).send({ error: 'unauthorized' }); }
  });
  app.get('/api/v1/health', async (request, reply) => {
    const actor = actorOf(request);
    let entry = csrfTokens.get(actor);
    if (!entry || entry.expiresAt <= Date.now()) {
      entry = { token: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 30 * 60 * 1000 };
      csrfTokens.set(actor, entry);
    }
    reply.header('x-csrf-token', entry.token);
    return { status: 'online', checkedAt: new Date().toISOString(), services: { gateway: 'online', cloudflared: 'unknown', tmux: env.TMUX_BIN ? 'unknown' : 'offline', ttyd: 'unknown' } };
  });
  app.get('/api/v1/system', async () => ({ state: 'unknown', observedAt: new Date().toISOString() }));
  app.get('/api/v1/agents', async () => Promise.all(agents.map(async (id) => {
    const binary = env[`${id.toUpperCase()}_BIN`];
    if (!binary) return { agent: id, installed: null, authenticated: null };
    if (!path.isAbsolute(binary)) return { agent: id, installed: false, authenticated: null };
    try {
      const info = await stat(binary);
      if (!info.isFile()) return { agent: id, installed: false, authenticated: null };
      await access(binary, fsConstants.X_OK);
      return { agent: id, installed: true, authenticated: null };
    }
    catch { return { agent: id, installed: false, authenticated: null }; }
  })));
  app.get('/api/v1/projects', async () => projects.list());
  app.post<{ Body: { name?: string; canonicalPath?: string } }>('/api/v1/projects', async (request, reply) => {
    if (!sameOrigin(request.headers.origin, env.PUBLIC_ORIGIN)) return reply.code(403).send({ error: 'origin_denied' });
    if (!validCsrf(request.headers['x-csrf-token'], csrfTokens.get(actorOf(request)))) return reply.code(403).send({ error: 'csrf_denied' });
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return reply.code(415).send({ error: 'content_type_required' });
    if (typeof request.body?.canonicalPath !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    try {
      const project = await projects.register(request.body.canonicalPath);
      request.log.info({ event: 'project_register', actor: 'allowlisted_owner', projectId: project.id, result: 'ok' });
      return reply.code(201).send(project);
    }
    catch (error) { return reply.code(400).send({ error: 'project_rejected', message: safeMessage(error) }); }
  });
  app.get('/api/v1/sessions', async () => sessions.inspectAll());
  app.post<{ Body: { projectId?: string; agent?: Agent; label?: string } }>('/api/v1/sessions', async (request, reply) => {
    if (!sameOrigin(request.headers.origin, env.PUBLIC_ORIGIN)) return reply.code(403).send({ error: 'origin_denied' });
    if (!validCsrf(request.headers['x-csrf-token'], csrfTokens.get(actorOf(request)))) return reply.code(403).send({ error: 'csrf_denied' });
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return reply.code(415).send({ error: 'content_type_required' });
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) return reply.code(400).send({ error: 'idempotency_key_required' });
    const actorKey = actorOf(request);
    const scopedKey = `${actorKey}:${key}`;
    const previous = idempotency.get(scopedKey);
    if (previous) {
      try { return reply.send(await previous); }
      catch { return reply.code(503).send({ error: 'session_unavailable' }); }
    }
    const project = typeof request.body?.projectId === 'string' ? projects.get(request.body.projectId) : undefined;
    if (!project || !agents.includes(request.body?.agent as Agent)) return reply.code(400).send({ error: 'invalid_request' });
    const creation = sessions.create(project, request.body.agent as Agent, request.body.label);
    idempotency.set(scopedKey, creation);
    if (idempotency.size > 1000) {
      const oldestKey = idempotency.keys().next().value;
      if (oldestKey) idempotency.delete(oldestKey);
    }
    try {
      const session = await creation;
      request.log.info({ event: 'session_create', actor: 'allowlisted_owner', sessionId: session.id, projectId: project.id, result: 'ok' });
      return reply.code(201).send(session);
    } catch (error) {
      idempotency.delete(scopedKey);
      request.log.warn({ event: 'session_create', actor: 'allowlisted_owner', projectId: project.id, result: 'error' });
      return reply.code(503).send({ error: 'session_unavailable', message: safeMessage(error) });
    }
  });
  app.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request, reply) => {
    if (!sessions.get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    return sessions.inspect(request.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/v1/sessions/:id/detach', async (request, reply) => {
    if (!sameOrigin(request.headers.origin, env.PUBLIC_ORIGIN)) return reply.code(403).send({ error: 'origin_denied' });
    if (!validCsrf(request.headers['x-csrf-token'], csrfTokens.get(actorOf(request)))) return reply.code(403).send({ error: 'csrf_denied' });
    try {
      const session = await sessions.detach(request.params.id);
      request.log.info({ event: 'session_detach', actor: 'allowlisted_owner', sessionId: session.id, result: 'ok' });
      return session;
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
  app.post<{ Params: { id: string } }>('/api/v1/sessions/:id/stop', async (request, reply) => {
    if (!sameOrigin(request.headers.origin, env.PUBLIC_ORIGIN)) return reply.code(403).send({ error: 'origin_denied' });
    if (!validCsrf(request.headers['x-csrf-token'], csrfTokens.get(actorOf(request)))) return reply.code(403).send({ error: 'csrf_denied' });
    try { const session = await sessions.stop(request.params.id); await terminalBridge.stop(request.params.id); writers.delete(request.params.id); request.log.info({ event: 'session_stop', actor: 'allowlisted_owner', sessionId: session.id, result: 'ok' }); return session; }
    catch (error) { request.log.warn({ event: 'session_stop', actor: 'allowlisted_owner', result: 'error' }); return reply.code(503).send({ error: 'session_stop_failed', message: safeMessage(error) }); }
  });
  app.get<{ Params: { id: string } }>('/t/:id/token', async (request, reply) => {
    if (!sameOriginOrFetchSite(request, env.PUBLIC_ORIGIN)) return reply.code(403).send({ error: 'origin_denied' });
    const session = sessions.get(request.params.id);
    if (!session || session.state === 'stopped') return reply.code(404).send({ error: 'not_found' });
    const token = randomBytes(32).toString('base64url');
    terminalTokens.set(token, { sessionId: session.id, actor: actorOf(request), expiresAt: Date.now() + 30_000 });
    for (const [value, item] of terminalTokens) if (item.expiresAt <= Date.now()) terminalTokens.delete(value);
    while (terminalTokens.size > 1000) terminalTokens.delete(terminalTokens.keys().next().value!);
    return { token };
  });
  app.get<{ Params: { id: string } }>('/t/:id/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      const id = request.params.id;
      const protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((part) => part.trim());
      const protocol = protocols.length === 2 && protocols.includes('tty') ? protocols.find((part) => part.startsWith('hub-')) : undefined;
      const token = protocol?.slice(4);
      const grant = token ? terminalTokens.get(token) : undefined;
      if (!grant || grant.sessionId !== id || !grant.actor || grant.expiresAt <= Date.now()) {
        if (token) terminalTokens.delete(token);
        return reply.code(401).send({ error: 'terminal_token_invalid' });
      }
      terminalTokens.delete(token!);
      const session = sessions.get(id);
      if (!session || session.state === 'stopped') {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (writers.has(id)) return reply.code(423).send({ error: 'terminal_writer_busy' });
      const lock = Symbol(id);
      writers.set(id, lock);
      (request as typeof request & { terminalLock?: symbol; terminalSession?: HubSession; terminalGrantToken?: string }).terminalLock = lock;
      (request as typeof request & { terminalSession?: HubSession }).terminalSession = session;
      (request as typeof request & { terminalGrantToken?: string }).terminalGrantToken = token!;
      try {
        const endpoint = await terminalBridge.start(session);
        if (!isLoopbackWebSocket(endpoint.url)) throw new Error('Terminal endpoint must be loopback');
        (request as typeof request & { terminalEndpoint?: { url: string; authToken: string } }).terminalEndpoint = endpoint;
      } catch {
        if (writers.get(id) === lock) writers.delete(id);
        return reply.code(503).send({ error: 'terminal_transport_unavailable' });
      }
    }
  }, async (socket, request) => {
    const id = request.params.id;
    const lock = (request as typeof request & { terminalLock?: symbol }).terminalLock;
    const session = (request as typeof request & { terminalSession?: HubSession }).terminalSession;
    const grantToken = (request as typeof request & { terminalGrantToken?: string }).terminalGrantToken;
    const endpoint = (request as typeof request & { terminalEndpoint?: { url: string; authToken: string } }).terminalEndpoint;
    if (!lock || !session) { socket.close(1011); return; }
    let upstream: WebSocket | undefined;
    let released = false;
    let upstreamAuthSent = false;
    const MAX_CONNECTING_BYTES = 64 * 1024;
    const MAX_FRAME_BYTES = 64 * 1024;
    const pendingFrames: Array<{ data: Buffer; isBinary: boolean }> = [];
    let pendingBytes = 0;
    const authTimer = setTimeout(() => close(1008), 5000);
    const release = () => { if (!released) { released = true; if (writers.get(id) === lock) writers.delete(id); } };
    const close = (code = 1011) => { clearTimeout(authTimer); release(); if (upstream?.readyState === WebSocket.OPEN) upstream.close(); else if (upstream?.readyState === 0) upstream.terminate(); if (socket.readyState === WebSocket.OPEN) socket.close(code); };
    socket.once('close', () => close()); socket.once('error', () => close());
    try {
      if (!endpoint || !grantToken || socket.readyState !== WebSocket.OPEN) { release(); return; }
      // Install downstream handlers before the asynchronous upstream handshake.
      // Keep at most 64 KiB (including the browser hello) while connecting.
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (data.byteLength > MAX_FRAME_BYTES || pendingBytes + data.byteLength > MAX_CONNECTING_BYTES) { close(1009); return; }
        if (!upstream || upstream.readyState !== WebSocket.OPEN) {
          pendingFrames.push({ data: Buffer.from(data), isBinary });
          pendingBytes += data.byteLength;
          return;
        }
        forwardDownstream(data, isBinary);
      });
      const forwardDownstream = (data: Buffer, isBinary: boolean) => {
        if (!upstream || upstream.readyState !== WebSocket.OPEN || socket.readyState !== WebSocket.OPEN) return;
        if (!upstreamAuthSent) {
          try {
            const hello = parseTerminalHello(data, isBinary, grantToken);
            hello.AuthToken = endpoint.authToken;
            upstream.send(JSON.stringify(hello));
            upstreamAuthSent = true;
            clearTimeout(authTimer);
          } catch { close(1008); }
          return;
        }
        if (looksLikeDuplicateHello(data)) { close(1008); return; }
        if (upstream.bufferedAmount + data.byteLength > 512 * 1024) { close(1013); return; }
        upstream.send(data, { binary: isBinary });
      };
      upstream = new WebSocket(endpoint.url, ['tty'], { headers: { origin: new URL(endpoint.url).origin } });
      upstream.once('open', () => {
        if (!upstream || socket.readyState !== WebSocket.OPEN) { close(); return; }
        upstream.on('message', (data: Buffer, isBinary: boolean) => { if (socket.readyState !== WebSocket.OPEN) return; if (socket.bufferedAmount + data.byteLength > 512 * 1024) { close(1013); return; } socket.send(data, { binary: isBinary }); });
        upstream.on('close', () => close()); upstream.on('error', () => close());
        for (const frame of pendingFrames) {
          pendingBytes -= frame.data.byteLength;
          forwardDownstream(frame.data, frame.isBinary);
          if (socket.readyState !== WebSocket.OPEN) break;
        }
        pendingFrames.length = 0;
      });
      upstream.once('error', () => close());
    } catch { close(); }
  });
  app.addHook('onClose', async () => { await terminalBridge.close(); writers.clear(); terminalTokens.clear(); });
  const webRoot = env.HUB_WEB_ROOT;
  app.get('/', async (_request, reply) => {
    if (!webRoot) return reply.code(404).send({ error: 'not_found' });
    return sendWebFile(reply, webRoot, 'index.html');
  });
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => {
    if (!webRoot) return reply.code(404).send({ error: 'not_found' });
    return sendWebFile(reply, webRoot, path.join('assets', request.params['*']));
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));
  return app;
}

function pathDelimiter(): string { return process.platform === 'win32' ? ';' : ':'; }
function sameOrigin(origin: string | undefined, expected: string | undefined): boolean {
  if (!origin || !expected) return false;
  try { return new URL(origin).origin === new URL(expected).origin; } catch { return false; }
}
function sameOriginOrFetchSite(request: FastifyRequest, expected: string | undefined): boolean {
  const origin = request.headers.origin;
  if (origin) return sameOrigin(origin, expected);
  return request.headers['sec-fetch-site'] === 'same-origin' && Boolean(expected);
}
function safeHost(origin: string): string | undefined { try { return new URL(origin).host.toLowerCase(); } catch { return undefined; } }
function isLoopbackWebSocket(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'ws:' && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
function parseTerminalHello(data: Buffer, isBinary: boolean, grantToken: string): Record<string, unknown> {
  if (data.byteLength < 2 || data.byteLength > 16 * 1024) throw new Error('invalid terminal hello size');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
  for (const key of ['AuthToken', 'columns', 'rows']) {
    if ([...text.matchAll(new RegExp(`\\"${key}\\"\\s*:`, 'g'))].length !== 1) throw new Error('duplicate or missing terminal hello field');
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid terminal hello');
  const hello = value as Record<string, unknown>;
  const keys = Object.keys(hello).sort();
  if (keys.length !== 3 || keys[0] !== 'AuthToken' || keys[1] !== 'columns' || keys[2] !== 'rows') throw new Error('unexpected terminal hello fields');
  if (typeof hello.AuthToken !== 'string' || !safeTokenEqual(hello.AuthToken, grantToken)) throw new Error('terminal grant mismatch');
  if (!Number.isInteger(hello.columns) || (hello.columns as number) < 1 || (hello.columns as number) > 1000 || !Number.isInteger(hello.rows) || (hello.rows as number) < 1 || (hello.rows as number) > 1000) throw new Error('invalid terminal dimensions');
  // Browser sends Uint8Array (a binary frame); text hello remains supported for ttyd clients.
  void isBinary;
  return hello;
}
function looksLikeDuplicateHello(data: Buffer): boolean {
  const first = data.find((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
  return first === 0x7b;
}
function safeTokenEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function isLoopbackHost(host: string | undefined): boolean {
  return Boolean(host && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host));
}
function validCsrf(value: string | string[] | undefined, entry: { token: string; expiresAt: number } | undefined): boolean {
  if (typeof value !== 'string' || !entry || entry.expiresAt <= Date.now()) return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(entry.token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Operation failed';
  if (error.message === 'Session limit reached' || error.message.startsWith('tmux is unavailable') || error.message.startsWith('Configured absolute binary path is unavailable')) return error.message;
  if (error.message.includes('timed out')) return 'The local session operation timed out';
  if (error.message.startsWith('tmux session')) return 'The local session operation failed';
  return 'Operation failed';
}
function actorOf(request: FastifyRequest): string {
  return (request as typeof request & { actor?: string }).actor ?? 'unknown';
}

async function sendWebFile(reply: FastifyReply, root: string, relativePath: string) {
  try {
    if (!path.isAbsolute(root)) return reply.code(404).send({ error: 'not_found' });
    const canonicalRoot = await realpath(root);
    const candidate = await realpath(path.resolve(canonicalRoot, relativePath));
    if (!candidate.startsWith(`${canonicalRoot}${path.sep}`)) return reply.code(404).send({ error: 'not_found' });
    await access(candidate);
    const body = await readFile(candidate);
    const extension = path.extname(candidate).toLowerCase();
    const contentType: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
    };
    return reply.type(contentType[extension] ?? 'application/octet-stream').send(body);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HUB_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('HUB_HOST must be 127.0.0.1');
  const port = Number(process.env.HUB_PORT ?? 4782);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HUB_PORT must be an integer from 1 to 65535');
  const app = await buildServer();
  await app.listen({ host, port });
}
