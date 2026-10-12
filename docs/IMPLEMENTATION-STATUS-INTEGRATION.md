# Integration implementation status

Date: 2026-10-09. Branch: `feat/luna-hub-integration-20261008`. Worktree only. No push, merge, PR, deployment, hostname access, tunnel/DNS change, global install, or system service operation occurred.

## Implemented in this iteration

- `apps/gateway/src/server.ts` accepts a browser-compatible binary JSON hello and supported text JSON hello. It validates strict UTF-8, an exact three-field schema (`AuthToken`, `columns`, `rows`), unique required keys, bounded dimensions and grant equality. It rejects a second JSON handshake with close 1008 and replaces the browser grant with the adapter token before upstream forwarding.
- Downstream WS listeners are attached before the asynchronous upstream handshake. Connecting frames are ordered and limited to 64 KiB total and 64 KiB per frame. The bridge enforces upstream/downstream backpressure limits, five-second handshake timeout, close/error cleanup, and writer lease release.
- The one-use grant remains bound to verified actor/session with 30-second expiry, and the per-session writer lock is claimed before upgrade. A second writer receives HTTP 423.
- `apps/gateway/src/terminal-bridge.ts` no longer places a ttyd credential in process argv. Native mode fails closed with HTTP 503 because ttyd's supported Basic credential is argv-backed, and `--auth-header` is only a proxy trust signal, not local per-user authentication. No raw unauthenticated ttyd fallback is used.
- `apps/gateway/test/live-integration.test.ts` uses a real ephemeral `127.0.0.1` listener URL as `PUBLIC_ORIGIN`, fetch target, WebSocket target, Host, and Origin; it does not forge Host or use a placeholder hostname. It uses actual frontend `HubApi` and `TerminalConnection` classes with a synthetic ttyd WebSocket upstream. Each accepted upstream has its own hello/frame record. Reconnect and post-crash recovery wait for the accepted upstream and rewritten fresh hello, then assert exactly one attachment and no browser-grant leakage. Assertions cover binary hello, preferences/title frames, ordered echo/resize, 423 writer contention, disconnect/reconnect, upstream crash lease release, Stop cleanup and rejection of a pre-Stop grant. Wait helpers clear timers and settle once; fixture sockets, servers and global WebSocket shim have test cleanup hooks.
- Official ttyd upstream docs/source confirm that `-i` accepts a UNIX socket path and `-U` sets socket ownership, conditional on libwebsockets being built with UNIX socket support. ttyd's `server.c` checks `LWS_USE_UNIX_SOCK`/`LWS_WITH_UNIX_SOCK` and fails otherwise. macOS path constraints and build configuration therefore need target-binary verification. Owner-only socket permissions do not isolate hostile processes running under the same macOS UID; native mode remains fail-closed. Sources: [ttyd README options](https://github.com/tsl0922/ttyd#command-line-options), [ttyd server setup](https://github.com/tsl0922/ttyd/blob/main/src/server.c), [ttyd server socket path](https://github.com/tsl0922/ttyd/blob/main/src/server.h), [Apple socket path discussion](https://developer.apple.com/forums/thread/817602).

## Verification actually performed here

### v10 initial WebSocket readiness iteration (2026-10-09)

- The intermittent initial `connecting` assertion was ordered before the test's first-handshake wait. The test could fail while the app was still completing its session and terminal-token HTTP preflight, before Playwright had routed a WebSocket or observed a client hello. This was a test synchronization defect; the existing client installs `onmessage` before the browser's asynchronous `open` event, sends hello on `open`, and only marks itself connected after binary command 50 writer preferences arrive.
- The browser fixture now waits, with finite polling and a 10-second hello deadline, for the first routed socket and its verified client hello before asserting `connected`. It records relative-time HTTP/socket/hello/preference/output milestones and a short badge state trace for failure diagnostics. The mock sends binary preference command 50 and output command 48 only after parsing and validating the initial hello, then resolves that connection's handshake. Reconnect uses the same bounded sequence; existing assertions still cover same hash, no additional session POST, and auth-revocation removal.
- Added frontend unit regressions for an immediate preference response to the first hello and for remaining read-only/connecting until delayed preferences arrive. `apps/web npm test`: **PASS, 22/22**. `apps/web npm run build` (includes typecheck): **PASS**.
- Playwright `--list`: **PASS, 8 tests discovered**. `apps/web npm run test:e2e`: **BLOCKED before browser tests** because the Vite fixture listener on `127.0.0.1:5173` returned `EPERM`. `apps/gateway npm test`: **BLOCKED before test discovery** because tsx could not bind its temporary IPC socket (`EPERM`). No local Playwright execution or gateway test result is claimed. The owner host's three consecutive full Playwright runs remain unverified and are not inferred from these changes.
- Coverage categories remain distinct: gateway tests exercise real ephemeral localhost with a synthetic ttyd-compatible upstream; Playwright uses browser plus mocked HTTP/WebSocket; neither is browser-to-live-Fastify integration. Native ttyd/tmux are unavailable and `NativeTtydAdapter` remains fail-closed.

- `cd apps/gateway && npm run build`: **PASS** (TypeScript build).
- `cd apps/gateway && npm test`: **BLOCKED before test discovery**; tsx temporary IPC socket bind returned `EPERM`.
- `cd apps/gateway && node --import tsx --test --test-concurrency=1 test/*.test.ts`: **10 passed, 2 failed**. Both failures are tests requiring a loopback listener and stopped at bind with `EPERM`; the live terminal proxy assertions did not run. Passing cases include JWT/CSRF/session/project checks and all native fail-closed/argv tests.
- `cd apps/gateway && npm audit --omit=dev --audit-level=high`: **UNVERIFIED**; registry DNS returned `ENOTFOUND registry.npmjs.org`.
- `cd apps/web && npm test`: **PASS, 20/20**.
- `cd apps/web && npm run build`: **PASS** (typecheck and Vite production build).
- `cd apps/web && npm run test:e2e`: **BLOCKED before tests**; Playwright Vite server bind to `127.0.0.1:5173` returned `EPERM`.
- Existing 8 Playwright tests are synthetic fixture coverage, separate from the new live gateway harness. No live browser-to-gateway result is claimed.
- After the reconnect assertions were changed, gateway build passed and `git diff --check` passed. The suite was rerun with `node --import tsx --test --test-concurrency=1 test/*.test.ts`: 10 passed and the same 2 loopback tests failed at listener bind with `EPERM`, before their assertions. `npm test` also failed before test discovery because tsx could not bind its temporary IPC socket (`EPERM`). The live localhost result remains unverified; no green result is claimed here.

## Remaining gates

- **Synthetic live integration:** implemented with bounded async upstream waits and per-connection protocol checks, but not verified here because loopback binds return `EPERM`. Run it on the owner Mac-MCP host with loopback permitted.
- **Native ttyd E2E:** NOT VERIFIED. ttyd/tmux are absent per supplied host inventory, and native mode now deliberately fails closed until a safe per-session auth channel is implemented. Separate owner approval is required before installing/using tmux or ttyd. No native echo, resize, or process cleanup evidence exists.
- **Audit:** rerun on a host with npm registry DNS access.
- **Browser UI live integration:** pending. The harness runs the actual frontend connector and API client over real local HTTP/WebSockets but does not mount React in a browser; the Playwright fixture tests remain separate.
- Deployment remains out of scope. Do not deploy or expose a terminal based on this source-only iteration.

## Owner host commands

Run from the repository root on the Mac-MCP host with loopback enabled (these commands were not completed in the restricted sandbox):

```bash
cd apps/gateway
npm test
npm run build
npm audit --omit=dev --audit-level=high

cd ../web
npm test
npm run build
npm run test:e2e
```

The gateway live integration test uses only ephemeral loopback ports, synthetic JWT keys, and synthetic upstream WebSockets; it does not contact external services or invoke terminal commands. Confirm it exits cleanly with no listener left behind. Native ttyd/tmux tests remain unavailable until a safe auth transport exists and the owner separately approves those binaries. No UDS adapter is implemented: actual target libwebsockets UDS support, conservative macOS pathname interoperability, socket identity/cleanup behavior, and a supported Node WebSocket client have not been verified. The adapter intentionally remains fail-closed.

## Host test readback (source implementation)

`scripts/verify-local-integration.sh <private-output-directory>` is the owner Mac-MCP entry point. Run it from the canonical worktree root with Node.js 24+ and existing dependencies available. It invokes `scripts/verify-host-readback.mjs`; it does not accept a project path or arbitrary command strings. Fixed checks are gateway test/build/production audit, web unit/build/Playwright fixture/production audit, and `git diff --check`. Each check has a ten-minute timeout, bounded captured output, no shell invocation, and process-group termination on timeout where supported. Per-check logs and the JSON receipt are mode 0600 inside an owner-owned 0700 output directory.

`host-results.json` is created atomically before checks begin, then atomically refreshed before and after each check. Each record carries fixed executable/argv/profile, `running`/`passed`/`failed`/`timed_out`/`runner_error`/`not_run`, exit code, timestamps, duration, bounded-output truncation flag, and parsed counts when recognized. Node TAP summaries (`ℹ` and `#` forms), Vitest, and Playwright counts are recognized; bounded command capture retains the output tail so end-of-run TAP summaries remain available. A crash can leave explicit `running` records; corrupt readback returns `corrupt_or_unreadable`, never a pass. Overall `passed` requires every fixed check to pass, the `main` ref to remain at the supplied clean baseline commit `a108d9e733d385b695af7fcedd3937202d87f9d6`, and branch/HEAD/worktree status to remain stable. The intentionally dirty integration worktree is separately recorded. Gateway integration is labeled synthetic ttyd-compatible upstream; Playwright is labeled mock fixture; native ttyd and browser-to-live-Fastify UI are not covered. The shell launcher writes a minimal failed receipt if Node is absent or exits before creating one. This removes Python/importlib from host validation; it does not establish the uninvestigated cause of v7 macOS `EPERM`.

Local receipt unit tests: `node --test scripts/verify-host-readback.test.mjs`. The host validator itself must be run after this Codex process exits; no future host result is implied by this source change.
