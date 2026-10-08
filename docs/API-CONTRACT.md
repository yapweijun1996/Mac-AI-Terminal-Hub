# HTTP and WebSocket API Contract

> Status: design proposal only; not deployed. Public repository / private runtime.

All routes including static UI must require Access identity and JWT verification at the gateway.
Unauthorized WebSocket upgrades must fail before ttyd receives the connection.

## 5. Public and private interfaces

### Routes (all require validated Access identity unless explicitly noted)

| Verb / transport | Path | Purpose | Notes |
|---|---|---|---|
| `GET` | `/` and `/assets/*` | Authenticated dashboard | Never make public fallback |
| `GET` | `/api/v1/health` | Human-readable service health | Authenticated; avoid hostname/system secrets |
| `GET` | `/api/v1/system` | macOS status snapshot | Cache 5–10 seconds, safe fields only |
| `GET` | `/api/v1/agents` | Installed binary/version probe | Never expose API keys |
| `GET` | `/api/v1/projects` | Registered projects | Canonical paths only to owner |
| `POST` | `/api/v1/projects` | Register allowlisted project | CSRF + path canonicalization |
| `GET` | `/api/v1/sessions` | Query persisted metadata + live tmux state | Explicit status semantics |
| `POST` | `/api/v1/sessions` | Start project-agent session | Idempotency key; spawn without shell interpolations |
| `GET` | `/api/v1/sessions/:id` | Session detail | Opaque ID from registry, no arbitrary path |
| `POST` | `/api/v1/sessions/:id/detach` | Disconnect browser transport | Never kill tmux |
| `POST` | `/api/v1/sessions/:id/stop` | Explicitly terminate session | Confirm UI action + audit; optional graceful shutdown |
| `WS + GET` | `/t/:id/*` | Browser terminal HTTP/WS reverse proxy | Validate Access JWT and Origin at upgrade; never accept arbitrary upstream URL |

**Future, not MVP:** `/api/v1/tasks` backed by structured Codex/Pi event adapters to observe queued/running/completed/failed with proof of actual outcomes; Mac-MCP read-only health endpoint.

### Metadata schema

```ts
type Agent = 'codex' | 'claude' | 'pi';
type SessionState = 'created' | 'attached' | 'detached' | 'stopped' | 'unknown';

type Project = {
  id: string; name: string; canonicalPath: string;
  createdAt: string; lastInspectedAt?: string;
};
type HubSession = {
  id: string; label: string; agent: Agent; projectId: string;
  tmuxName: string; state: SessionState;
  createdAt: string; lastAttachedAt?: string; stoppedAt?: string;
};
type AuditEvent = {
  ts: string; action: string; actor: string;
  sessionId?: string; projectId?: string; result: 'ok' | 'denied' | 'error';
};
```

No shell keystrokes, terminal scrollback, API keys, access JWTs, or repo content in Hub audit storage by default.
