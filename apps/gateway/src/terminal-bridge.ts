import type { HubSession } from './sessions.js';

export interface TerminalEndpoint { url: string; authToken: string }
export interface TerminalBridge { start(session: HubSession): Promise<TerminalEndpoint>; stop(sessionId: string): Promise<void>; close(): Promise<void> }
export type ProcessLauncher = (command: string, args: string[]) => import('node:child_process').ChildProcess;

export class NativeTtydAdapter implements TerminalBridge {
  constructor(private readonly ttydBin: string | undefined, private readonly tmuxBin: string | undefined, _launch?: ProcessLauncher) {}

  async start(session: HubSession): Promise<TerminalEndpoint> {
    void session;
    if (!this.ttydBin || !this.tmuxBin || !this.ttydBin.startsWith('/') || !this.tmuxBin.startsWith('/')) throw new Error('Terminal binaries are unavailable');
    // ttyd's supported Basic credential is argv-backed. --auth-header trusts
    // any caller-supplied header and is not an authentication mechanism. Until
    // a permissioned Unix-socket transport is implemented, fail closed.
    throw new Error('Native ttyd transport is blocked: no safe per-session authentication channel is configured');
  }

  async stop(_sessionId: string): Promise<void> {}
  async close(): Promise<void> {}
}
