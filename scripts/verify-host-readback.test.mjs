import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { atomicWriteReceipt, invoke, parseCounts, readReceipt, redactLog, validatePrivateDirectory } from './verify-host-readback.mjs';

const node = process.execPath;

test('invoker records success and parsed test counts', async () => {
  const result = await invoke(node, ['-e', "console.log('Tests 4 passed, 0 failed')"], { timeoutMs: 2000 });
  assert.equal(result.status, 'passed');
  assert.deepEqual(parseCounts(result.stdout), { total: 4, passed: 4, failed: 0, skipped: null, cancelled: null });
});

test('parses Node TAP and common runner summaries without inventing missing values', () => {
  assert.deepEqual(parseCounts('ℹ tests 12\nℹ pass 12\nℹ fail 0\nℹ skipped 0\nℹ cancelled 0'), { total: 12, passed: 12, failed: 0, skipped: 0, cancelled: 0 });
  assert.deepEqual(parseCounts('# tests 12\n# pass 11\n# fail 1\n# skipped 0\n# cancelled 0'), { total: 12, passed: 11, failed: 1, skipped: 0, cancelled: 0 });
  assert.deepEqual(parseCounts('\u001b[32mℹ tests 0\u001b[0m\nℹ pass 0\nℹ fail 0'), { total: 0, passed: 0, failed: 0, skipped: null, cancelled: null });
  assert.deepEqual(parseCounts('Tests 20 passed, 0 failed'), { total: 20, passed: 20, failed: 0, skipped: null, cancelled: null });
  assert.deepEqual(parseCounts('8 passed (15.5s)'), { total: null, passed: 8, failed: null, skipped: null, cancelled: null });
  assert.deepEqual(parseCounts('no test summary here'), { total: null, passed: null, failed: null, skipped: null, cancelled: null });
  assert.deepEqual(parseCounts('ℹ tests 12\nℹ tests 11\nℹ pass 12'), { total: null, passed: 12, failed: null, skipped: null, cancelled: null });
  assert.deepEqual(parseCounts('ℹ tests twelve\n✔ test 1'), { total: null, passed: null, failed: null, skipped: null, cancelled: null });
});

test('invoker records nonzero exit and timeout', async () => {
  const failed = await invoke(node, ['-e', 'process.exit(7)'], { timeoutMs: 2000 });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 7);
  const timeout = await invoke(node, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 });
  assert.equal(timeout.status, 'timed_out');
});

test('invoker captures spawn errors and bounds output', async () => {
  const missing = await invoke(path.join(os.tmpdir(), 'terminal-hub-no-such-executable'), [], { timeoutMs: 1000 });
  assert.equal(missing.status, 'runner_error');
  const large = await invoke(node, ['-e', "process.stdout.write('x'.repeat(10000))"], { timeoutMs: 2000, outputLimit: 100 });
  assert.equal(large.status, 'passed');
  assert.equal(large.outputTruncated, true);
  assert.ok(large.stdout.length <= 100);
  const tail = await invoke(node, ['-e', "process.stdout.write('x'.repeat(10000)); console.log('\\nℹ tests 12\\nℹ pass 12\\nℹ fail 0')"], { timeoutMs: 2000, outputLimit: 100 });
  assert.equal(tail.outputTruncated, true);
  assert.deepEqual(parseCounts(`${tail.stdout}\n${tail.stderr}`), { total: 12, passed: 12, failed: 0, skipped: null, cancelled: null });
});

test('private check logs redact credential shaped output', () => {
  const safe = redactLog('Bearer secret-value AuthToken: abcdef password="p@ss"');
  assert.doesNotMatch(safe, /secret-value|abcdef|p@ss/);
  assert.match(safe, /\[REDACTED\]/);
});

test('receipt writes are atomic, private and readable; corrupt and interrupted states remain explicit', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hub-readback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await validatePrivateDirectory(directory), true);
  const { chmod } = await import('node:fs/promises');
  await chmod(directory, 0o755);
  await assert.rejects(validatePrivateDirectory(directory), /mode 0700/);
  await chmod(directory, 0o700);
  const receipt = { schemaVersion: 1, overall: 'running', checks: [{ id: 'build', status: 'running' }] };
  await atomicWriteReceipt(directory, receipt);
  const file = path.join(directory, 'host-results.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await readReceipt(file)).receipt, receipt);
  assert.deepEqual((await readdir(directory)).sort(), ['host-results.json']);
  const partial = (await readReceipt(file)).receipt;
  assert.equal(partial.overall, 'running');
  assert.equal(partial.checks[0].status, 'running');
  await (await import('node:fs/promises')).writeFile(file, '{broken');
  assert.equal((await readReceipt(file)).status, 'corrupt_or_unreadable');
});
