# Test & Acceptance Plan

> Status: partial local verification recorded in [Integration Status](IMPLEMENTATION-STATUS-INTEGRATION.md). No deployment or remote exposure has been tested.

### Current integration gate (2026-10-09)

Owner host readback entry point: from the canonical worktree root run `scripts/verify-local-integration.sh <private-output-directory>` using Node.js 24+ and already installed project dependencies. It runs gateway test/build/audit; frontend test/build/Playwright fixture/audit; then `git diff --check`. It writes `host-results.json` before starting checks and updates atomically after each check; check logs and receipt are private. Python is not used. Host result is not available until the owner runner executes. The receipt explicitly identifies synthetic WebSocket upstream and mocked browser fixture coverage; neither proves native ttyd or browser-to-live-Fastify UI behavior.

- Gateway is pinned to Fastify 5.12.5. The bridge uses direct `ws` dependency 8.22.0.
- Gateway TypeScript build: PASS. Standard `npm test`: blocked before tests because sandbox denies tsx temporary IPC socket (`EPERM`). Direct single-concurrency Node runner: 10 passed, 2 loopback-listener tests failed at bind with `EPERM`; a filtered rerun of all non-listener gateway tests passed 10/10. `npm audit --omit=dev --audit-level=high`: unverified because registry DNS returned `ENOTFOUND`.
- Frontend `npm test`: PASS, 20/20. `npm run build`: PASS. `npm run test:e2e`: blocked because Playwright's Vite fixture cannot bind `127.0.0.1:5173` (`EPERM`). The 8 existing Playwright tests are fixture/mocked browser coverage, not live terminal proof.
- `test/live-integration.test.ts` uses the actual frontend `HubApi` and `TerminalConnection` against real local Fastify HTTP/WebSocket and a synthetic ttyd-compatible WebSocket server. It derives `PUBLIC_ORIGIN` from the actual ephemeral gateway URL and uses native localhost Host/Origin values without forging Host. Assertions cover binary hello, auth rewrite, preferences/title frames, input echo, resize, 423 writer exclusion, disconnect/reconnect, upstream crash, and Stop cleanup/rejection. It is authored but NOT EXECUTED successfully in this sandbox due denied loopback binds. Synthetic adapter coverage is distinct from native ttyd E2E.
- Native `ttyd`/`tmux` binaries are absent. Native adapter now fails closed because ttyd's documented Basic credential is argv-backed and its auth-header mode does not authenticate the local caller. No native process, echo, resize, or process cleanup has been verified.
- Run on the Mac-MCP host runner with loopback allowed: `cd apps/gateway && node --import tsx --test --test-concurrency=1 test/*.test.ts && npm run build && npm audit --omit=dev --audit-level=high`; then `cd apps/web && npm test && npm run build && npm run test:e2e`. Confirm test teardown leaves no listener. Native E2E remains pending a separately approved secure auth design and binaries.

### Acceptance suite: minimum
- [ ] `https://terminal.yapweijun1996.com` shows Access sign-in to an unauthenticated browser; no SPA data leaks.
- [ ] Unauthenticated `/api/v1/system`, `/api/v1/sessions`, `/t/...` requests fail closed.
- [ ] WebSocket upgrade without a valid one-time session grant / expected Origin fails closed before ttyd receives a connection.
- [ ] A concurrent second writer is rejected with HTTP 423; disconnect permits a new grant and reconnect without killing tmux. Synthetic-upstream live test is authored, host execution pending.
- [ ] Owner authenticates via MFA-capable IdP; another email is denied even if email domain is shared.
- [ ] Gateway/ttyd are not accessible on any LAN/public interface.
- [ ] Codex/Claude/Pi are verified locally; missing agent yields an explicit error, not success.
- [ ] Creating a session with path traversal, symlink escape, or unknown binary is rejected.
- [ ] One project+agent creates one named tmux session; browser refresh reattaches to same ID.
- [ ] Network disconnect does not kill tmux; manual Stop does and creates an audit event.
- [ ] Race: double-click or retried create request does not duplicate a session (idempotency key).
- [ ] Terminal handles Mandarin IME, UTF-8, paste, resize, mobile key input and basic copy. Native ttyd E2E pending.
- [ ] Mobile 390x844 / 430x932 visual QA; desktop 1440px; no horizontal document overflow.
- [ ] System fields are genuine host observations; unavailable metrics show `Unknown`.
- [ ] App and tunnel recover after process crash; on macOS login they restart via launchd.
- [ ] Laptop lid-close, wake, logout, reboot, power loss tests document expected outages; no guarantee of 24/7 access.
- [ ] Git ignores secrets, tunnel tokens, local user configuration, runtime data, logs.
- [ ] Security headers, CSRF, Access JWT validation, Origin validation, dependency audit and no root process are verified.
- [ ] Rollback command stops tunnel and Hub without losing registered project information.


## Test evidence required

- Record date, host name class (Mac mini), tool versions, test steps and observed outcome without credentials.
- HTTP and WebSocket unauthorized checks must fail closed before DNS/public rollout.
- Include screen captures for 1440px desktop, 390x844 and 430x932 mobile, redacting private data.
- Verify false-success prevention: browser disconnect must not become "task complete".
- Confirm README and UI preview always disclose simulated data until actual metrics are wired.
