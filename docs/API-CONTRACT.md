# HTTP and WebSocket API Contract

> Status: HTTP shapes, one-use grants, loopback gateway bridge, and server-side writer lease are implemented in source. The real gateway-to-synthetic-upstream test derives Host and Origin from the actual ephemeral localhost listener; sandbox policy blocks its loopback bind, so runtime assertions remain unverified here. Native ttyd mode is deliberately fail-closed: UDS support depends on the target libwebsockets build and a verified client transport; same-UID local programs remain able to access an owner-only socket. Not deployed.

All HTTP routes including static UI require Access identity and JWT verification at the gateway. Because browser WebSocket cannot send the Access header, the terminal upgrade uses the one-time scoped grant described below and must fail before ttyd receives a connection when that grant or Origin is invalid.

## 5. Public and private interfaces

### Routes (all require validated Access identity unless explicitly noted)

| Verb / transport | Path | Purpose | Notes |
|---|---|---|---|
| `GET` | `/` and `/assets/*` | Authenticated dashboard | Never make public fallback |
| `GET` | `/api/v1/health` | Human-readable service health and CSRF bootstrap | Authenticated; avoids hostname/system secrets; returns `X-CSRF-Token` |
| `GET` | `/api/v1/system` | macOS status snapshot | Cache 5–10 seconds, safe fields only |
| `GET` | `/api/v1/agents` | Installed binary/version probe | Never expose API keys |
| `GET` | `/api/v1/projects` | Registered projects | Canonical paths only to owner |
| `POST` | `/api/v1/projects` | Register allowlisted project | CSRF + path canonicalization |
| `GET` | `/api/v1/sessions` | Query persisted metadata + live tmux state | Explicit status semantics |
| `POST` | `/api/v1/sessions` | Start project-agent session | Idempotency key; spawn without shell interpolations |
| `GET` | `/api/v1/sessions/:id` | Session detail | Opaque ID from registry, no arbitrary path |
| `POST` | `/api/v1/sessions/:id/detach` | Disconnect browser transport | Never kill tmux |
| `POST` | `/api/v1/sessions/:id/stop` | Explicitly terminate session | Confirm UI action + audit; optional graceful shutdown |
| `GET` | `/t/:id/token` | Mint one-time browser WS grant | Requires Access JWT; same-origin; 30-second expiry; scoped to one live session |
| `WS + GET` | `/t/:id/ws` | Browser terminal transport | Exact Origin plus one-time `hub-<token>` subprotocol; actor/session/expiry-bound grant is consumed before writer acquisition; returns 503 before upgrade when adapter startup is unavailable |

## Wire shapes

- `GET /api/v1/projects`, `/sessions`, and `/agents` return bare arrays. Object routes return bare objects, not `{ project }` or `{ session }` envelopes.
- Project registration accepts `{ name, canonicalPath }`; the server derives the canonical name from the verified path. Session creation accepts `{ projectId, agent, label? }` and requires `Idempotency-Key`.
- `GET /api/v1/health` returns `{ status, checkedAt, services? }` and sets `X-CSRF-Token`. The token is actor-bound, expires after 30 minutes, and is required on every mutation.
- System returns `{ state, observedAt }` with unknown metrics omitted. Agent rows use `{ agent, installed, authenticated }`; installation never implies CLI authentication.
- Session detail and mutation responses are the session object itself. Stop returns `state: "stopped"`; detach returns `state: "detached"`.
- The terminal-token endpoint is an authenticated same-origin GET. Its random bearer grant is short-lived, session-bound, one-time, and may only be offered as the `hub-<token>` WS subprotocol alongside `tty`. It is not a Cloudflare JWT. Reconnection obtains a fresh grant.

The browser cannot set Cloudflare Access headers on a WebSocket. An authenticated same-origin GET mints a 256-bit, 30-second grant bound to the verified Access actor and session. Upgrade checks exact Host and Origin, the one-time grant, session state, and a per-session writer lease before accepting bytes. A second writer receives HTTP 423. The proxy negotiates `tty`, buffers at most 64 KiB during upstream connection, validates the first UTF-8 JSON hello, requires exactly one each of `AuthToken`, `columns`, and `rows`, and replaces the browser grant with an adapter-scoped token. It preserves ttyd protocol frames and bounds queued bytes. Upstream ttyd itself is not started by the current native adapter: its documented Basic credential is argv-backed, while `--auth-header` trusts an arbitrary caller header and is not authentication. The adapter returns 503 until a permissioned per-session authentication transport is implemented. No unauthenticated ttyd fallback exists.

The frontend sends JSON `{ AuthToken, columns, rows }` as a binary WebSocket frame; text hello remains accepted for compatible ttyd clients. ttyd command bytes are ASCII `'0'` input, `'1'` resize, `'2'` pause and `'3'` resume; responses use `'0'` output, `'1'` title and `'2'` preferences. No browser Access grant or native secret is logged. The live test additionally checks dynamic localhost origin mapping, token replay/session/expiry rejection (security suite), echo/resize/reconnect/writer contention and Stop teardown. Gateway/Web builds pass; live localhost assertions are authored but unverified here because sandbox loopback bind returns EPERM. Native ttyd/tmux E2E is NOT VERIFIED.

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
