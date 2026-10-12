import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { Project } from './projects.js';

export type Agent = 'codex' | 'claude' | 'pi';
export type SessionState = 'created' | 'attached' | 'detached' | 'stopped' | 'unknown';
export interface HubSession { id: string; label: string; agent: Agent; projectId: string; tmuxName: string; state: SessionState; createdAt: string; lastAttachedAt?: string; stoppedAt?: string }
export type SpawnFn = typeof spawn;

export class SessionManager {
  private readonly sessions = new Map<string, HubSession>();
  private pendingCreates = 0;
  constructor(private readonly tmuxBin: string | undefined, private readonly binaries: Partial<Record<Agent, string>>, private readonly spawnFn: SpawnFn = spawn, private readonly perUserLimit = 3) {}

  list(): HubSession[] { return [...this.sessions.values()]; }
  get(id: string): HubSession | undefined { return this.sessions.get(id); }

  async create(project: Project, agent: Agent, label?: string): Promise<HubSession> {
    const active = [...this.sessions.values()].filter((s) => s.state !== 'stopped').length;
    if (active + this.pendingCreates >= this.perUserLimit) throw new Error('Session limit reached');
    if (!this.tmuxBin) throw new Error('tmux is unavailable; install tmux before creating terminal sessions');
    if (!path.isAbsolute(this.tmuxBin)) throw new Error('Configured absolute binary path is unavailable for tmux');
    const binary = this.binaries[agent];
    if (!binary || !path.isAbsolute(binary)) throw new Error(`Configured absolute binary path is unavailable for ${agent}`);
    try {
      if (!(await stat(binary)).isFile()) throw new Error('not a file');
      await access(binary, fsConstants.X_OK);
    } catch {
      throw new Error(`Configured absolute binary path is unavailable for ${agent}`);
    }
    const id = randomUUID();
    const tmuxName = `terminal-hub-${id}`;
    this.pendingCreates += 1;
    try {
      // tmux passes its command string through the account's shell. Only the
      // configured trusted executable path enters that string; quote it so
      // spaces and shell metacharacters cannot change its meaning.
      const child = this.spawnFn(this.tmuxBin, ['new-session', '-d', '-s', tmuxName, '-c', project.canonicalPath, shellQuote(binary)], { shell: false, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
      await waitForExit(child, 'tmux session creation');
      const session: HubSession = { id, label: label?.slice(0, 80) || `${agent} session`, agent, projectId: project.id, tmuxName, state: 'created', createdAt: new Date().toISOString() };
      this.sessions.set(id, session);
      return session;
    } finally {
      this.pendingCreates -= 1;
    }
  }

  async inspect(id: string): Promise<HubSession> {
    const session = this.require(id);
    if (session.state === 'stopped') return session;
    if (!this.tmuxBin || !path.isAbsolute(this.tmuxBin)) {
      session.state = 'unknown';
      return session;
    }
    try {
      const child = this.spawnFn(this.tmuxBin, ['has-session', '-t', session.tmuxName], { shell: false, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
      await waitForExit(child, 'tmux session inspection');
      if (session.state === 'unknown') session.state = 'detached';
    } catch (error) {
      if (error instanceof Error && error.message.includes('exited with status 1')) {
        session.state = 'stopped';
        session.stoppedAt ??= new Date().toISOString();
      } else {
        session.state = 'unknown';
      }
    }
    return session;
  }

  async inspectAll(): Promise<HubSession[]> {
    return Promise.all([...this.sessions.keys()].map((id) => this.inspect(id)));
  }

  async detach(id: string): Promise<HubSession> {
    const session = this.require(id);
    if (session.state !== 'stopped') session.state = 'detached';
    return session;
  }

  async stop(id: string): Promise<HubSession> {
    const session = await this.inspect(id);
    if (session.state !== 'stopped') {
      if (!this.tmuxBin) throw new Error('tmux is unavailable; session state cannot be verified');
      if (!path.isAbsolute(this.tmuxBin)) throw new Error('Configured absolute binary path is unavailable for tmux');
      const child = this.spawnFn(this.tmuxBin, ['kill-session', '-t', session.tmuxName], { shell: false, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
      await waitForExit(child, 'tmux session stop');
      session.state = 'stopped';
      session.stoppedAt = new Date().toISOString();
    }
    return session;
  }

  private require(id: string): HubSession { const session = this.sessions.get(id); if (!session) throw new Error('Session not found'); return session; }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function waitForExit(child: ChildProcess, operation: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      error ? reject(error) : resolve();
    };
    const onError = (error: Error) => finish(new Error(`${operation} failed: ${error.message}`));
    const onExit = (code: number | null) => code === 0 ? finish() : finish(new Error(`${operation} exited with status ${code ?? 'unknown'}`));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`${operation} timed out`));
    }, timeoutMs);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}
