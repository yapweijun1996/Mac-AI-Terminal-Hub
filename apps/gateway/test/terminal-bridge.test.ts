import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeTtydAdapter } from '../src/terminal-bridge.js';

test('native adapter fails closed when ttyd or tmux is not configured', async () => {
  const adapter = new NativeTtydAdapter(undefined, undefined);
  await assert.rejects(adapter.start({ id: 'session', tmuxName: 'terminal-hub-session' } as never), /Terminal binaries are unavailable/);
  await adapter.close();
});

test('native adapter rejects non-absolute executable configuration', async () => {
  const adapter = new NativeTtydAdapter('ttyd', '/usr/bin/tmux');
  await assert.rejects(adapter.start({ id: 'session', tmuxName: 'terminal-hub-session' } as never), /Terminal binaries are unavailable/);
});

test('native adapter stays disabled when its only upstream authentication exposes or omits credentials', async () => {
  const calls: string[][] = [];
  const adapter = new NativeTtydAdapter('/trusted/ttyd', '/trusted/tmux', ((_command: string, args: string[]) => { calls.push(args); throw new Error('must not launch'); }) as never);
  await assert.rejects(adapter.start({ id: 'session', tmuxName: 'terminal-hub-session' } as never), /safe per-session authentication channel/);
  assert.deepEqual(calls, []);
  await adapter.close();
});
