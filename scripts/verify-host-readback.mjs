#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXPECTED_BRANCH = 'feat/luna-hub-integration-20261008';
export const EXPECTED_MAIN_HEAD = 'a108d9e733d385b695af7fcedd3937202d87f9d6';
export const CHECKS = [
  ['gateway_test', 'npm', ['test'], 'apps/gateway', 'Gateway unit and synthetic localhost integration tests'],
  ['gateway_build', 'npm', ['run', 'build'], 'apps/gateway', 'Gateway TypeScript build'],
  ['gateway_audit', 'npm', ['audit', '--omit=dev', '--audit-level=high'], 'apps/gateway', 'Gateway production dependency audit'],
  ['web_test', 'npm', ['test'], 'apps/web', 'Frontend unit tests'],
  ['web_build', 'npm', ['run', 'build'], 'apps/web', 'Frontend typecheck and production build'],
  ['web_playwright_fixture', 'npm', ['run', 'test:e2e'], 'apps/web', 'Playwright synthetic fixture tests'],
  ['web_audit', 'npm', ['audit', '--omit=dev', '--audit-level=high'], 'apps/web', 'Frontend production dependency audit'],
  ['diff_check', 'git', ['diff', '--check'], '.', 'Whitespace and conflict marker check'],
];
const MAX_OUTPUT = 128 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;

function clip(buffer, limit = MAX_OUTPUT) {
  const bytes = Buffer.from(buffer);
  return { text: bytes.subarray(0, limit).toString('utf8'), truncated: bytes.length > limit };
}

export function redactLog(text) {
  return String(text)
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/("?(?:AuthToken|access_token|refresh_token|password|credential)"?\s*[:=]\s*)"?[^\s,}"']+/gi, '$1[REDACTED]');
}

export function parseCounts(output) {
  const text = String(output).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const tap = { total: null, passed: null, failed: null, skipped: null, cancelled: null };
  const fields = { tests: 'total', pass: 'passed', fail: 'failed', skipped: 'skipped', cancelled: 'cancelled' };
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:ℹ\s*|#\s*)?(tests|pass|fail|skipped|cancelled)\s+(\d+)\s*$/i);
    if (!match) continue;
    const key = fields[match[1].toLowerCase()];
    const value = Number(match[2]);
    if (tap[key] !== null && tap[key] !== value) tap[key] = undefined;
    else if (tap[key] !== undefined) tap[key] = value;
  }
  for (const key of Object.keys(tap)) if (tap[key] === undefined) tap[key] = null;
  if (Object.values(tap).some((value) => value !== null)) return tap;
  const count = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  };
  return {
    total: count([/\bTests?\s+(\d+)\s+(?:passed|total)\b/i]),
    passed: count([/\b(\d+)\s+passing\b/i, /\bTests?\s+(\d+)\s+passed\b/i, /\b(\d+)\s+passed\b/i]),
    failed: count([/\b(\d+)\s+failing\b/i, /\bTests?\s+\d+\s+passed,\s*(\d+)\s+failed\b/i, /\b(\d+)\s+failed\b/i]),
    skipped: count([/\b(\d+)\s+skipped\b/i, /\b(\d+)\s+pending\b/i]),
    cancelled: null,
  };
}

export async function atomicWriteReceipt(directory, receipt) {
  const target = path.join(directory, 'host-results.json');
  const temporary = path.join(directory, `.host-results.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await chmod(target, 0o600);
  try {
    const dir = await open(directory, fsConstants.O_RDONLY);
    try { await dir.sync(); } finally { await dir.close(); }
  } catch { /* Directory fsync is not available on every supported filesystem. */ }
}

export async function readReceipt(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || !Array.isArray(value.checks)) throw new Error('Invalid receipt shape');
    return { status: 'readable', receipt: value };
  } catch (error) {
    return { status: 'corrupt_or_unreadable', error: error instanceof Error ? error.message : 'read failed' };
  }
}

export async function validatePrivateDirectory(directory) {
  const info = await stat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Receipt directory must be owned by the current user with mode 0700');
  return true;
}

export function invoke(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const cwd = options.cwd ?? ROOT;
  const outputLimit = options.outputLimit ?? MAX_OUTPUT;
  return new Promise((resolve) => {
    let child;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let killTimer;
    const start = Date.now();
    const append = (target, chunk) => {
      const buffer = Buffer.concat([target, chunk]);
      if (buffer.length > outputLimit) truncated = true;
      return buffer.subarray(Math.max(0, buffer.length - outputLimit));
    };
    try {
      child = spawn(executable, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', NO_COLOR: '1' }, detached: process.platform !== 'win32' });
    } catch (error) {
      resolve({ status: 'runner_error', exitCode: null, durationMs: Date.now() - start, outputTruncated: false, stdout: '', stderr: error.message });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 1500);
        killTimer.unref();
      } else child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ status: 'runner_error', exitCode: null, durationMs: Date.now() - start, outputTruncated: truncated, stdout: clip(stdout, outputLimit).text, stderr: clip(Buffer.concat([stderr, Buffer.from(error.message)]), outputLimit).text });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ status: timedOut ? 'timed_out' : code === 0 ? 'passed' : 'failed', exitCode: code, durationMs: Date.now() - start, outputTruncated: truncated, stdout: clip(stdout, outputLimit).text, stderr: clip(stderr, outputLimit).text });
    });
  });
}

async function git(args) {
  const result = await invoke('git', args, { timeoutMs: 15_000, outputLimit: 16 * 1024 });
  if (result.status !== 'passed') throw new Error(`git ${args.join(' ')} failed (${result.status})`);
  return result.stdout.trim();
}

async function snapshot() {
  const [branch, head, mainRef, status] = await Promise.all([
    git(['branch', '--show-current']), git(['rev-parse', 'HEAD']), git(['rev-parse', '--verify', 'main']), git(['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  return { branch, head, mainRef, mainClean: mainRef === EXPECTED_MAIN_HEAD, worktreeClean: status.length === 0, worktreeStatusSha256: await (async () => {
    const { createHash } = await import('node:crypto'); return createHash('sha256').update(status).digest('hex');
  })() };
}

async function run(outputDirectory) {
  if (process.versions.node.split('.')[0] < 24) throw new Error('Node.js 24 or newer is required');
  const root = await realpath(ROOT);
  if (root !== ROOT) throw new Error('Repository path is not canonical');
  if ((await realpath(process.cwd())) !== root) throw new Error('Run this verifier from the canonical worktree root');
  if (!outputDirectory) throw new Error('Pass an explicit private output directory');
  const out = path.resolve(outputDirectory);
  if (out === root || out.startsWith(`${root}${path.sep}`)) throw new Error('Receipt directory must be outside the repository');
  await mkdir(out, { recursive: true, mode: 0o700 });
  await chmod(out, 0o700);
  await validatePrivateDirectory(out);
  const initial = await snapshot();
  if (initial.branch !== EXPECTED_BRANCH) throw new Error(`Unexpected branch: ${initial.branch}`);
  const receipt = {
    schemaVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), overall: 'running',
    host: { platform: process.platform, node: process.version }, worktree: initial,
    testScope: { gatewayIntegration: 'synthetic local ttyd-compatible WebSocket upstream; real ephemeral Fastify origin', nativeTtyd: 'not exercised; adapter remains fail-closed', browserUi: 'Playwright mock fixture only' },
    checks: CHECKS.map(([id, executable, argv, cwd, profile]) => ({ id, executable, argv, cwd, profile, status: 'not_run', exitCode: null, timestamp: null, durationMs: null, outputTruncated: false, counts: { total: null, passed: null, failed: null, skipped: null, cancelled: null } })),
  };
  const logs = path.join(out, 'logs');
  await mkdir(logs, { recursive: true, mode: 0o700 }); await chmod(logs, 0o700);
  await atomicWriteReceipt(out, receipt);
  for (let index = 0; index < CHECKS.length; index += 1) {
    const [id, executable, argv, relativeCwd, profile] = CHECKS[index];
    const check = receipt.checks[index]; check.timestamp = new Date().toISOString(); check.startedAt = check.timestamp; check.status = 'running';
    await atomicWriteReceipt(out, receipt);
    const commandCwd = path.resolve(root, relativeCwd);
    const result = await invoke(executable, argv, { cwd: commandCwd });
    Object.assign(check, { status: result.status, exitCode: result.exitCode, durationMs: result.durationMs, outputTruncated: result.outputTruncated, counts: parseCounts(`${result.stdout}\n${result.stderr}`) });
    check.finishedAt = new Date().toISOString();
    await atomicWriteReceipt(out, receipt);
    const logFile = path.join(logs, `${id}.log`);
    const handle = await open(logFile, 'w', 0o600);
    try { await handle.writeFile(redactLog(`$ ${executable} ${argv.join(' ')}\nstatus=${result.status} exitCode=${result.exitCode}\n${result.stdout}\n${result.stderr}`)); await handle.sync(); } finally { await handle.close(); }
    if (result.status !== 'passed') {
      for (const remaining of receipt.checks.slice(index + 1)) remaining.status = 'not_run';
      break;
    }
  }
  try {
    receipt.worktreeAfter = await snapshot();
    receipt.worktreeUnchanged = receipt.worktree.worktreeStatusSha256 === receipt.worktreeAfter.worktreeStatusSha256 && receipt.worktree.head === receipt.worktreeAfter.head && receipt.worktree.branch === receipt.worktreeAfter.branch;
  } catch (error) { receipt.worktreeAfterError = error instanceof Error ? error.message : 'snapshot failed'; receipt.worktreeUnchanged = false; }
  receipt.updatedAt = new Date().toISOString();
  receipt.overall = receipt.checks.every((check) => check.status === 'passed') && receipt.worktreeUnchanged && receipt.worktree.mainClean && receipt.worktreeAfter?.mainClean ? 'passed' : 'failed';
  await atomicWriteReceipt(out, receipt);
  console.log(`Host readback ${receipt.overall}: ${path.join(out, 'host-results.json')}`);
  return receipt.overall === 'passed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2]).then((code) => { process.exitCode = code; }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Host readback failed';
    console.error(`Host readback failed closed: ${message}`);
    process.exitCode = 2;
  });
}
