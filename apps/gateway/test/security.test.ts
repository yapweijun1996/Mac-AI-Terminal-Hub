import assert from 'node:assert/strict';
import net from 'node:net';
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { buildServer } from '../src/server.js';
import { createAccessVerifier } from '../src/auth.js';
import { ProjectAllowlist } from '../src/projects.js';
import { SessionManager } from '../src/sessions.js';
import { EventEmitter } from 'node:events';

const env = { CF_ACCESS_TEAM_DOMAIN: 'https://team.example', CF_ACCESS_AUD: 'test-aud', CF_ACCESS_ALLOWED_EMAIL: 'owner@example.test', PUBLIC_ORIGIN: 'https://hub.example' };

async function signedVerifier() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'test-key', alg: 'RS256', use: 'sig' });
  const verifier = createAccessVerifier({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN, audience: env.CF_ACCESS_AUD, allowedEmail: env.CF_ACCESS_ALLOWED_EMAIL }, createLocalJWKSet({ keys: [jwk] }));
  const issue = (email = env.CF_ACCESS_ALLOWED_EMAIL, exp: number | undefined = Math.floor(Date.now() / 1000) + 60) => {
    const jwt = new SignJWT({ email, type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }).setIssuer(env.CF_ACCESS_TEAM_DOMAIN).setAudience(env.CF_ACCESS_AUD);
    if (exp !== undefined) jwt.setExpirationTime(exp);
    return jwt.setIssuedAt().sign(privateKey);
  };
  const issueWithoutExpiry = (email = env.CF_ACCESS_ALLOWED_EMAIL) => new SignJWT({ email, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }).setIssuer(env.CF_ACCESS_TEAM_DOMAIN)
    .setAudience(env.CF_ACCESS_AUD).setIssuedAt().sign(privateKey);
  return { verifier, issue, issueWithoutExpiry };
}

test('deny by default and reject invalid, expired, and wrong identity JWTs', async () => {
  const app = await buildServer({ env: {}, logger: false });
  assert.equal((await app.inject({ url: '/api/v1/health' })).statusCode, 503);
  await app.close();
  const { verifier, issue, issueWithoutExpiry } = await signedVerifier();
  const secure = await buildServer({ env, verifier, logger: false });
  const host = { host: 'hub.example' };
  assert.equal((await secure.inject({ url: '/api/v1/health', headers: host })).statusCode, 401);
  assert.equal((await secure.inject({ url: '/api/v1/health', headers: { ...host, 'cf-access-jwt-assertion': 'bad' } })).statusCode, 401);
  assert.equal((await secure.inject({ url: '/api/v1/health', headers: { ...host, 'cf-access-jwt-assertion': await issue(env.CF_ACCESS_ALLOWED_EMAIL, 1) } })).statusCode, 401);
  assert.equal((await secure.inject({ url: '/api/v1/health', headers: { ...host, 'cf-access-jwt-assertion': await issueWithoutExpiry() } })).statusCode, 401);
  assert.equal((await secure.inject({ url: '/api/v1/health', headers: { ...host, 'cf-access-jwt-assertion': await issue('other@example.test') } })).statusCode, 401);
  const health = await secure.inject({ url: '/api/v1/health', headers: { ...host, 'cf-access-jwt-assertion': await issue() } });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'online');
  assert.ok(health.headers['x-csrf-token']);
  await secure.close();

  const loopbackOnly = await buildServer({ env: { ...env, PUBLIC_ORIGIN: '' }, verifier, logger: false });
  assert.equal((await loopbackOnly.inject({ url: '/api/v1/health', headers: { host: 'localhost' } })).statusCode, 401);
  assert.equal((await loopbackOnly.inject({ url: '/api/v1/health', headers: { host: '192.168.1.20', 'cf-access-jwt-assertion': await issue() } })).statusCode, 400);
  await loopbackOnly.close();
});

test('project allowlist rejects traversal and symlink escape after canonicalization', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'hub-project-test-'));
  const root = path.join(base, 'allowed'); const outside = path.join(base, 'outside');
  await mkdir(root); await mkdir(outside); await mkdir(path.join(root, 'repo'));
  await symlink(outside, path.join(root, 'escape'));
  const list = new ProjectAllowlist([root]); await list.initialize();
  assert.equal((await list.register(path.join(root, 'repo'))).canonicalPath, await realpath(path.join(root, 'repo')));
  await assert.rejects(list.register(path.join(root, '..', 'outside')));
  await assert.rejects(list.register(path.join(root, 'escape')));
  await rm(base, { recursive: true, force: true });
});

test('state-changing requests require a short-lived CSRF token in addition to Access identity', async () => {
  const { verifier, issue } = await signedVerifier();
  const app = await buildServer({ env, verifier, logger: false });
  const headers = { host: 'hub.example', origin: env.PUBLIC_ORIGIN, 'cf-access-jwt-assertion': await issue(), 'content-type': 'application/json' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sessions', headers, payload: {} })).statusCode, 403);
  const csrfResponse = await app.inject({ url: '/api/v1/health', headers });
  assert.equal(csrfResponse.statusCode, 200);
  const token = csrfResponse.headers['x-csrf-token'];
  const protectedResponse = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { ...headers, 'x-csrf-token': token }, payload: {} });
  assert.equal(protectedResponse.statusCode, 400);
  assert.equal(protectedResponse.json().error, 'idempotency_key_required');
  await app.close();
});

test('dashboard routes return the frontend wire shapes and terminal bootstrap is session-scoped', async () => {
  const { verifier, issue } = await signedVerifier();
  const known = { id: 'session_123', state: 'created' };
  const sessions = {
    get: (id: string) => id === known.id ? known : undefined,
    inspectAll: async () => [],
  } as never;
  const app = await buildServer({ env, verifier, sessions, logger: false });
  const headers = { host: 'hub.example', 'cf-access-jwt-assertion': await issue(), 'sec-fetch-site': 'same-origin' };
  const health = await app.inject({ url: '/api/v1/health', headers });
  const system = await app.inject({ url: '/api/v1/system', headers });
  const agents = await app.inject({ url: '/api/v1/agents', headers });
  const projects = await app.inject({ url: '/api/v1/projects', headers });
  const sessionList = await app.inject({ url: '/api/v1/sessions', headers });
  assert.equal(health.json().status, 'online');
  assert.ok(health.headers['x-csrf-token']);
  assert.equal(system.json().state, 'unknown');
  assert.ok(Array.isArray(agents.json()));
  assert.ok(Array.isArray(projects.json()));
  assert.ok(Array.isArray(sessionList.json()));
  const bootstrap = await app.inject({ url: `/t/${known.id}/token`, headers });
  assert.equal(bootstrap.statusCode, 200);
  assert.match(bootstrap.json().token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await app.inject({ url: '/t/unknown/token', headers })).statusCode, 404);
  await app.close();
});

test('session lifecycle uses argv spawning, enforces concurrent limits, inspects, detaches, and stops', async () => {
  const binaryRoot = await mkdtemp(path.join(tmpdir(), 'hub-binary-test-'));
  const trustedBinary = path.join(binaryRoot, "trusted agent's cli");
  await writeFile(trustedBinary, '#!/bin/sh\nexit 0\n');
  await chmod(trustedBinary, 0o700);
  const calls: Array<{ command: string; args: readonly string[]; options: unknown }> = [];
  const fakeSpawn = ((command: string, args: readonly string[], options: unknown) => {
    calls.push({ command, args, options }); const child = new EventEmitter();
    Object.assign(child, { kill: () => true });
    queueMicrotask(() => child.emit('exit', 0, null)); return child;
  }) as never;
  const manager = new SessionManager('/trusted/tmux', { codex: trustedBinary }, fakeSpawn, 1);
  const project = { id: 'p', name: 'repo', canonicalPath: '/allowed/repo', createdAt: new Date().toISOString() };
  const created = await manager.create(project, 'codex');
  assert.equal(calls[0].command, '/trusted/tmux');
  assert.deepEqual(calls[0].args.slice(0, 6), ['new-session', '-d', '-s', created.tmuxName, '-c', project.canonicalPath]);
  assert.equal((calls[0].options as { shell: boolean }).shell, false);
  assert.equal(calls[0].args.at(-1), `'${trustedBinary.replaceAll("'", "'\\''")}'`);
  assert.equal((await manager.inspect(created.id)).state, 'created');
  await assert.rejects(manager.create(project, 'codex'), /Session limit reached/);
  assert.equal((await manager.detach(created.id)).state, 'detached');
  assert.equal((await manager.stop(created.id)).state, 'stopped');
  const unavailable = new SessionManager(undefined, { codex: trustedBinary }, fakeSpawn);
  await assert.rejects(unavailable.create(project, 'codex'), /tmux is unavailable/);
  const missingAgent = new SessionManager('/trusted/tmux', { codex: trustedBinary }, fakeSpawn);
  await assert.rejects(missingAgent.create(project, 'claude'), /absolute binary path is unavailable for claude/);

  let releaseCreation: (() => void) | undefined;
  let spawned!: () => void;
  const spawnStarted = new Promise<void>((resolve) => { spawned = resolve; });
  const delayedSpawn = (() => {
    const child = new EventEmitter();
    Object.assign(child, { kill: () => true });
    spawned();
    releaseCreation = () => child.emit('exit', 0, null);
    return child;
  }) as never;
  const concurrent = new SessionManager('/trusted/tmux', { codex: trustedBinary }, delayedSpawn, 1);
  const first = concurrent.create(project, 'codex');
  await spawnStarted;
  await assert.rejects(concurrent.create(project, 'codex'), /Session limit reached/);
  releaseCreation?.();
  assert.equal((await first).state, 'created');
  await rm(binaryRoot, { recursive: true, force: true });
});

test('WebSocket upgrade enforces Origin and one-use session grants before transport', async () => {
  const { verifier, issue } = await signedVerifier();
  const knownSession = { id: 'known', state: 'created' };
  const sessions = { get: (id: string) => id === knownSession.id ? knownSession : undefined } as never;
  const app = await buildServer({ env, verifier, sessions, logger: false });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = new URL(address);
  const validAccessToken = await issue();
  const request = async (route: string, origin = env.PUBLIC_ORIGIN, protocol?: string, host = 'hub.example', accessToken = validAccessToken) => {
    const client = net.connect(Number(url.port), '127.0.0.1');
    client.setTimeout(2_000);
    try {
      const response = new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        client.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          const received = Buffer.concat(chunks);
          if (received.includes(Buffer.from('\r\n\r\n'))) resolve(received);
        });
        client.once('timeout', () => reject(new Error('WebSocket test request timed out')));
        client.once('error', reject);
      });
      client.write(`GET ${route} HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: ${origin}\r\nCf-Access-Jwt-Assertion: ${accessToken}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}\r\n`);
      return (await response).toString();
    } finally { client.destroy(); }
  };
  try {
    assert.match(await request('/t/not-a-session/ws'), /^HTTP\/1\.1 401/);
    assert.match(await request('/t/known/ws', env.PUBLIC_ORIGIN, 'tty, hub-malformed', 'hub.example', 'invalid-jwt'), /^HTTP\/1\.1 401/);
    assert.match(await request('/t/known/ws', 'https://attacker.example'), /^HTTP\/1\.1 403/);
    assert.match(await request('/t/known/ws', env.PUBLIC_ORIGIN, undefined, 'attacker.example'), /^HTTP\/1\.1 400/);
    assert.match(await request('/t/known/ws', env.PUBLIC_ORIGIN, 'tty, hub-malformed'), /^HTTP\/1\.1 401/);

    const accessToken = await issue();
    assert.equal((await app.inject({ url: '/t/known/token', headers: { host: 'hub.example', origin: env.PUBLIC_ORIGIN } })).statusCode, 401);
    assert.equal((await app.inject({ url: '/t/known/token', headers: { host: 'hub.example', 'cf-access-jwt-assertion': accessToken } })).statusCode, 403);
    const bootstrap = await app.inject({ url: '/t/known/token', headers: { host: 'hub.example', 'cf-access-jwt-assertion': accessToken, origin: env.PUBLIC_ORIGIN } });
    assert.equal(bootstrap.statusCode, 200);
    const grant = bootstrap.json().token as string;
    assert.match(await request('/t/other-session/ws', env.PUBLIC_ORIGIN, `tty, hub-${grant}`), /^HTTP\/1\.1 401/);
    const freshBootstrap = await app.inject({ url: '/t/known/token', headers: { host: 'hub.example', 'cf-access-jwt-assertion': accessToken, origin: env.PUBLIC_ORIGIN } });
    const freshGrant = freshBootstrap.json().token as string;
    const validGrant = await request('/t/known/ws', env.PUBLIC_ORIGIN, `tty, hub-${freshGrant}`);
    assert.match(validGrant, /^HTTP\/1\.1 503/);
    assert.match(validGrant, /terminal_transport_unavailable/);
    assert.match(await request('/t/known/ws', env.PUBLIC_ORIGIN, `tty, hub-${freshGrant}`), /^HTTP\/1\.1 401/);
    const expiryBootstrap = await app.inject({ url: '/t/known/token', headers: { host: 'hub.example', 'cf-access-jwt-assertion': accessToken, origin: env.PUBLIC_ORIGIN } });
    const expiryGrant = expiryBootstrap.json().token as string;
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 31_000;
      assert.match(await request('/t/known/ws', env.PUBLIC_ORIGIN, `tty, hub-${expiryGrant}`), /^HTTP\/1\.1 401/);
    } finally { Date.now = originalNow; }
  } finally { await app.close(); }
});

test('static UI is authenticated and serves only files beneath the configured build root', async () => {
  const webRoot = await mkdtemp(path.join(tmpdir(), 'hub-web-test-'));
  await mkdir(path.join(webRoot, 'assets'));
  await writeFile(path.join(webRoot, 'index.html'), '<main>private</main>');
  await writeFile(path.join(webRoot, 'assets', 'app.js'), 'const app = true;');
  const { verifier, issue } = await signedVerifier();
  const app = await buildServer({ env: { ...env, HUB_WEB_ROOT: webRoot }, verifier, logger: false });
  assert.equal((await app.inject({ url: '/', headers: { host: 'hub.example' } })).statusCode, 401);
  const headers = { host: 'hub.example', 'cf-access-jwt-assertion': await issue() };
  assert.equal((await app.inject({ url: '/', headers })).body, '<main>private</main>');
  assert.equal((await app.inject({ url: '/assets/app.js', headers })).body, 'const app = true;');
  assert.equal((await app.inject({ url: '/assets/%2e%2e/%2e%2e/etc/passwd', headers })).statusCode, 404);
  await app.close();
  await rm(webRoot, { recursive: true, force: true });
});
