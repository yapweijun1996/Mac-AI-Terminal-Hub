# Luna Gateway Implementation Status

**Date:** 2026-10-08
**Branch:** `feat/luna-gateway-security`
**Target host:** Mac mini
**Deployment:** Not deployed. No tunnel, Cloudflare service, system package, or running service was changed.

## Implemented in source

- Fastify gateway defaults to `127.0.0.1:4782`; startup rejects any configured host other than `127.0.0.1`.
- Cloudflare Access verification uses `jose` and configured JWKS with RS256, issuer, audience, mandatory expiration, Access app token type, and exact allowlisted email checks. Missing configuration returns `503`; invalid identity returns `401`. There is no local authentication bypass.
- Host and WebSocket Origin checks, authenticated static UI serving, security headers, request body limit, global rate limiting, and a 30-minute in-memory CSRF token for writes are wired. `HUB_WEB_ROOT` is optional; absent UI assets return `404`.
- Project registration resolves configured roots and requested directories with `realpath`, then enforces canonical containment to reject traversal and symlink escapes.
- Session creation uses configured absolute binary paths and tmux argv with `shell: false`; concurrent pending sessions count toward the limit of three. `Idempotency-Key` requests share in-flight creation results. Detail/list inspect tmux using argv; an unavailable/ambiguous inspection reports `unknown`. Detach leaves tmux running and explicit stop invokes `tmux kill-session`.
- Agent launch paths are checked as absolute executable files. Since tmux executes its launch command through the user's shell, the configured trusted binary path is POSIX-quoted; no browser-controlled value is used as shell command text.
- HTTP routes cover health, an explicit unknown system placeholder, executable agent probes, projects, and in-memory session metadata. Metadata audit events omit email values, JWTs, request URLs, shell input, and terminal output; Fastify request logging is disabled.
- WS authentication, exact Origin, and session existence checks run before upgrade. A valid session currently receives HTTP `503 terminal_transport_unavailable` before the WebSocket handshake because no ttyd proxy exists; no shell is exposed.
- Test source uses generated in-memory JWT keys and temporary project/UI/binary fixtures. It covers deny-by-default, invalid/expired/missing-expiry/wrong-email JWTs, WS auth and Origin rejection, traversal/symlink escapes, mocked session create/detach/stop and concurrency, CSRF, and authenticated static assets. The tests have not executed because dependencies are unavailable.
- Added an unpopulated `.env.example`; local scripts load a private `.env`. README and deployment guidance identify Mac mini as the target and require a separate Access/tunnel integration gate.
- Updated older host references in MVP, PRD, security, UI, operations, implementation, and agent guidance to identify the Mac mini as the target. Existing tunnel services remain out of scope.
- Fixed the production start script to use `dist/src/server.js`, the output path produced by the current TypeScript configuration.

## Verification evidence and blockers

- `npm install --ignore-scripts --no-audit --no-fund --cache /private/tmp/luna-npm-cache --logs-dir /private/tmp/luna-npm-logs --fetch-retries=0 --fetch-timeout=8000` failed with `ENOTFOUND registry.npmjs.org` while resolving `@fastify/rate-limit`; registry DNS/network access is unavailable in this environment. A second direct install attempt also failed with the same DNS error. No dependencies or lockfile were created.
- `npm test` exited 127: `tsx: command not found` because dependencies are unavailable.
- `npm run build` exited 127: `tsc: command not found` because dependencies are unavailable.
- A further install attempt on 2026-10-08 returned the same `ENOTFOUND registry.npmjs.org` error; the package lockfile is still absent.
- `node --experimental-strip-types --check` passed for all gateway source and test TypeScript files (syntax only; it does not type-check or execute tests).
- `git diff --check` passed. Automated runtime tests and TypeScript compilation remain unverified; this is a dependency-access blocker, not a passing test result.
- Environment readout: Node `v25.5.0`, npm `11.8.0`; `tmux` and `ttyd` were not found on PATH. No session runtime was started.
- Because dependencies could not be installed, automated tests and TypeScript build are **not verified**. These source-level checks are not evidence that runtime behavior passes. There is no claim that the gateway is production-ready.

## Incomplete before any external exposure

- Implement and validate an authenticated ttyd WebSocket proxy, one-writer enforcement, heartbeat, bounded connection lifetime, and reconnect flow. Until then, the authenticated terminal route returns 503 before upgrade.
- Persist project/session metadata across gateway restarts; current registries and idempotency state are in memory only. Live tmux inspection works only for sessions created in the current process.
- Implement real macOS metrics and durable audit storage. `/api/v1/system` currently reports an unknown placeholder.
- Validate the CSRF token flow in the final browser integration; tokens currently live in memory and are shared for the one allowlisted owner.
- Build and integrate the web UI; static serving is gated and ready for a configured output directory, but no UI build is supplied by this worktree.
- Run the tests/build in a network-enabled environment, then perform local loopback and security review. Independently provision Cloudflare Access and a dedicated tunnel only in a separately approved integration phase after all gates pass.

## Next steps

1. In a network-enabled development environment, install dependencies in `apps/gateway`, then run `npm test` and `npm run build`; fix and record any failures.
2. Complete and validate authenticated ttyd transport and persistent session recovery before evaluating deployment readiness.
3. In a separate integration phase, review the Mac mini and its critical services, validate Access policy and loopback behavior, then consider provisioning an independent tunnel. Do not modify existing tunnel services.
