# Sol frontend implementation status

Date: 2026-10-08. Worktree: `feat/sol-web-ui` only. Target host: **Mac mini**, superseding older MacBook Air references. Source changes are limited to `apps/web/**` and this document. Nothing deployed, pushed, merged, or connected to a production terminal.

## Scope and boundaries

The standalone React/TypeScript/Vite frontend implements Overview, Terminal, Sessions, Projects, Monitor and Settings. Dashboard observations come only from authenticated same-origin API requests. There is no runtime demo mode, fake online fallback, client-side authentication bypass, external API base URL, or direct ttyd port. Tests inject synthetic example data separately from application source.

Ownership: the gateway remains authoritative for identity, JWT verification, CSRF, project allowlists, session lifetime and writer authorization. The frontend owns response validation, ephemeral UI state, confirmation dialogs and browser transport lifecycle. No shared types or backend files were changed.

## Implementation

- `apps/web/src/api/schema.ts`: local runtime schemas and inferred types; rejects invalid states and metrics, strips uncontracted fields, validates route-safe opaque IDs.
- `apps/web/src/api/client.ts`: same-origin fetch, cookies, no caching, blocked redirects, request timeout, sanitized errors, server-issued CSRF, session-create idempotency keys, typed mutation confirmations. Detail/stop/detach responses must match the requested session ID; creation must match the selected project and agent, preventing false confirmation from a structurally valid but unrelated response.
- `apps/web/src/hooks/useHub.ts`: independent resource loading/errors, last-observation timestamps, 15-second visible-page refresh, generation guards and identity revocation that discards cached observations.
- `apps/web/src/App.tsx`: responsive dashboard, agent/session selection, hash-based existing-session resume after refresh, project registration/chooser, search, native modal confirmations, stale/unknown/denied/offline views and read-only settings.
- `apps/web/src/components/TerminalPane.tsx`: lazy-loaded xterm.js, fit-on-resize, font sizing, 1,500-line in-memory scrollback, ephemeral four-terminal cache, one active browser socket, Ctrl/Esc/Tab/Alt/arrows, explicit Ctrl+C, selection copy and reviewed paste.
- `apps/web/src/terminal/connection.ts`: ttyd `tty` subprotocol, token bootstrap, binary UTF-8 input/output, resize, writer preferences, handshake timeout, generation-safe cancellation and bounded output/input queues. Output pause/resume uses ttyd flow control. Five retries at 1/2/4/8/15 seconds; budget resets only after a stable 30-second connection. Manual reconnect revalidates Access/session/token. No automatic POST retry or duplicate session creation.
- `apps/web/src/styles.css`: compact 220px desktop navigation, mobile topbar/menu and four-item bottom navigation, 44px controls, keyboard focus, responsive panels and terminal.

Closing or switching the browser terminal never calls Stop. Session metadata, transport state, tmux liveness, CLI process and task outcome remain distinct; task outcome is explicitly unknown. Host restart is not presented as resumable. Terminal streams, tokens, clipboard text, metrics and project data are not stored persistently or logged by the frontend. Preferences are in page memory only.

## Backend integration checklist for Luna

The current `docs/API-CONTRACT.md` defines routes and Project/HubSession fields, but does **not** define wire envelopes, metrics/health/agent schemas, mutation responses, CSRF bootstrap, ttyd frames or extended live-session fields. The following are isolated frontend expectations to agree with the backend before claiming end-to-end integration:

1. JSON responses: projects/sessions/agents are bare arrays. Project/session detail and create/register/detach/stop return a bare object matching the documented metadata schema. Stop must return `state: "stopped"`; detach must return `state: "detached"`. IDs use `[A-Za-z0-9_-]`, 1–160 characters; timestamps are ISO-8601 with timezone. Session-create POST body is `{ projectId, agent, label? }`; project-register body is `{ name, canonicalPath }`. Gateway must canonicalize and allowlist paths, select fixed CLI binaries, validate all bodies, enforce idempotency and audit metadata only.
2. CSRF bootstrap proposal: authenticated `GET /api/v1/health` returns the `X-CSRF-Token` response header. UI keeps it only in memory and returns it as `X-CSRF-Token` on POST. Missing CSRF disables all mutations; malformed health does not bootstrap a token. Origin/Referer and Access validation remain server requirements. Confirm/replace this mechanism in `api/client.ts` if Luna chooses another secure bootstrap.
3. Health proposal: `{ status: "online" | "offline" | "unknown", checkedAt, services?: { gateway?, cloudflared?, tmux?, ttyd? } }`; each service uses the same state enum. System proposal: `{ state, observedAt, cpuPercent?, memoryUsedBytes?, memoryTotalBytes?, diskFreeBytes?, uptimeSeconds?, memoryPressure? }`. Missing/null metrics display Unknown. Pressure: normal/warning/critical/unknown. Numbers are finite, nonnegative; CPU range is 0–100. Agent proposal: `{ agent, installed: boolean | null, version?, authenticated?: boolean | null }[]`. Binary presence never implies authentication.
4. Optional metadata extensions: project `branch?: string | null`, `dirty?: boolean | null`; session `tmuxAlive?: boolean | null`, `browserClients?: nonnegative integer`, `cliState?: "running" | "exited" | "unknown"`. Missing extensions display Unknown. Another attached client blocks UI attach; server must still enforce the one-writer limit against races.
5. Proxy `/t/:id/token` and `/t/:id/ws` beneath the documented `/t/:id/*` boundary. Token response is `{ token: string }`, fetched again per connection and held only in that attempt. WS protocol is native ttyd `tty`, binary handshake JSON `{ AuthToken, columns, rows }`, input prefix `0`, resize prefix `1`, output prefix `0`, title prefix `1` (ignored), preferences prefix `2`, pause `2`, resume `3`. Preferences must announce `disableStdin` for read-only mode. No preferences means input stays disabled. Arbitrary remote preferences, links, file transfers and terminal titles are not applied.
6. Enforce JWT and exact Origin on every HTTP/WS route, including ttyd token bootstrap. HTTP 401/403 triggers reauthentication; 409/423 indicates conflict. WS 1008/4401/4403 is treated as auth denial, 1013 as busy, 1000 as a normal transport close with unknown task outcome. Unexpected drops use bounded retry. Browsers obscure failed upgrade HTTP status, so preflight alone cannot prove upgrade authorization. Confirm server close-code behavior, writer release on disconnect, tmux reattachment, binary frames, resize, UTF-8 and IME against real ttyd.
7. Serve `apps/web/dist` on the authenticated same origin; protect static assets as well as API/terminal paths. Vite has no backend proxy and is loopback-only for local development. Development tests use an isolated browser and synthetic API/WS routes; they do not validate production Access, host startup, tmux/CLI process behavior or security headers. Gateway CSP must support bundled scripts/styles, xterm sizing, and same-origin `connect-src` WebSocket; do not weaken Access or use a public fallback.

Native ttyd adapter checked against [the official client source](https://github.com/tsl0922/ttyd/blob/main/html/src/components/terminal/xterm/index.ts). This is an implementation choice under the wildcard route, not a claim that a deployed gateway supports it.

## Verification

Frontend implementation and local automated acceptance: **Done**. Production/backend integration: **not verified**; no deployment performed.

Verified on 2026-10-08 using Node 25.5.0, npm 11.8.0, TypeScript 5.9.3, Vite 7.3.7, Vitest 4.1.11 and Playwright 1.56.1 with isolated installed Chrome:

- `npm test`: **20/20 unit tests passed**. Coverage includes same-origin fetch, auth clearing and stale-CSRF race prevention, malformed/HTML responses, required CSRF, stable create idempotency keys, no automatic POST retries, traversal rejection, session identity and project/agent response matching, conflicting/offline requests, ttyd handshake/resize/UTF-8/control frames, writer exclusion, bounded reconnect, detach cancellation, denied/stopped sessions and bounded input/output flow control.
- `npm run build`: **passed**, including strict TypeScript checks. Main JS is 273.20 kB / 82.85 kB gzip; lazy terminal JS is 300.90 kB / 75.59 kB gzip. No terminal bundle is requested before a terminal is selected. These are bundle sizes, not measured runtime RAM claims.
- `npm run test:e2e`: **8/8 browser tests passed**. All six screens, terminal and dialogs checked at **390×844**, **430×932**, **1440×1000** with no horizontal document overflow. Covers real xterm rendering against synthetic WebSocket frames, Ctrl latch/Ctrl+C, reviewed paste UI, Escape dismissal, required Stop confirmation, double-click create exclusion, hash-based reload resume, offline/denied/missing-CSRF controls, reconnect to the same session without POST and Access expiry removing terminal data. Browser page-error assertions passed.
- Synthetic screenshots for Overview and Terminal at all three sizes saved in `/private/tmp/terminal-hub-{overview,terminal}-{390,430,1440}.png`; visible banners explicitly label synthetic fixtures. Visual review completed for mobile and desktop screenshots. Screenshots/results are not committed.
- Dependency install disabled lifecycle scripts; npm security audit reports **zero vulnerabilities** after patching initial Vite/Vitest advisories. `npm ci --ignore-scripts` is the documented reproducible install route.
- Final ownership/source review: only `apps/web/**` and this status document added; branch remains `feat/sol-web-ui`; no backend/shared/root package changes, production data, credentials, logs or transcripts added. No commit/push/merge/deploy performed.

The browser suite initially exposed an xterm 5.5 viewport timer surviving immediate React StrictMode disposal. Terminal opening now occurs in a cancellable animation frame after the StrictMode probe, and the original failing mobile case plus the full suite passed. This fixes the lifecycle cause rather than suppressing the page error. Initial sandbox restrictions blocked npm DNS and loopback server binding; reviewed execution permissions allowed the pinned dependency install and isolated loopback browser tests.

Revalidation in this continuation: preserved the existing uncommitted frontend, added three response-matching regression cases, and reran all 20 unit tests, typecheck/build, all 8 browser tests and the full npm audit successfully. The sandbox again blocked loopback binding and npm DNS; reviewed execution permissions allowed those isolated checks. Current mobile terminal and desktop overview screenshots were inspected; all screenshot data is synthetic. No production endpoint was contacted. KB recall confirmed the Mac mini correction and split ownership; no memory write was needed because durable host/scope facts already existed and the implementation handoff is recorded here.

Remaining integration acceptance: real Access/CSRF/JWT/Origin denial at the gateway and WS upgrade; real ttyd token/base-path/protocol compatibility; writer release and races; tmux persistence across browser disconnect and loss on host reboot; real Codex/Claude/Pi installation/auth and stop behavior; physical iOS/Android keyboards, Mandarin IME, clipboard permissions and orientation/keyboard viewport changes; production CSP/security headers; measured browser/host RAM. No production security or live-host success is claimed.

## Local commands

Latest acceptance recheck (2026-10-08, 10:09–10:11 Asia/Kuala_Lumpur): preserved and reviewed the existing uncommitted implementation on `feat/sol-web-ui`; no source rewrite was necessary. All 20 unit tests, strict typecheck/production build, and all 8 browser tests passed again. Browser cases verified 390×844, 430×932 and 1440×1000 document widths, existing-session reconnect without creation, stop confirmation and Access revocation. The freshly generated 390px terminal and 1440px overview screenshots were visually inspected and clearly label synthetic data. Full dependency audit returned zero vulnerabilities. Sandbox restrictions initially prevented loopback binding and registry DNS; approved isolated executions completed both checks. Only this status record changed during this recheck. Backend integration remains pending against the checklist above; no production connection, commit, push, merge or deployment occurred. KB recall added no new durable fact, so no duplicate memory was written.

Run inside `apps/web`:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run test:e2e
npm run dev
```

Browser tests use installed Chrome and put synthetic screenshots/results under `/private/tmp/terminal-hub-*`, outside public source. No test account/profile, real host data or transcript is used. Build artifacts and dependencies are ignored by the existing repository policy. No memory writeback outside the assigned files; the verified outcome and Mac mini correction are recorded here for handoff.
