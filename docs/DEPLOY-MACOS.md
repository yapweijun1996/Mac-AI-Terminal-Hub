# macOS Deployment Readiness (Not Yet Deployed)

**Target machine:** MacBook Air running macOS. Do not treat the Mac mini as the application host.

## P0: Local verification (read-only)
1. Identify actual macOS version, current non-root user, available resources, sleep/wake policy.
2. Locate trusted absolute binaries and versions for `node`, `git`, `tmux`, `ttyd`, `codex`, `claude`, `pi`.
3. Validate CLI login states locally without exporting keys or token content.
4. Define an explicit list of allowed repository roots; confirm ownership and symlink behavior.
5. Determine whether a dedicated unprivileged macOS account is practical.
6. Report unknowns; do not modify existing Mac mini cloudflared/PM2 routes.

## P1: Protected connectivity
1. Build gateway bound to `127.0.0.1:4782`.
2. Create exact-hostname Cloudflare Access self-hosted application; exact user allowlist and MFA-capable IdP.
3. Verify JWT issuer, audience, signature, expiry, authorized email at the origin.
4. Authorize all API calls and WebSocket upgrade routes; enforce Origin and CSRF on writes.
5. Only then create a dedicated MacBook Air Cloudflare Tunnel to the gateway loopback port.
6. Confirm unauthenticated HTTP and WebSocket denial using a fresh remote browser.
7. Disable the tunnel route or stop the launchd service for emergency shutdown.

## P2–P4: Application operation
Implement sessions + agent launcher, responsive dashboard, metadata audit, restart recovery.
See [Implementation](IMPLEMENTATION-PLAN.md), [Test Plan](TEST-PLAN.md) and [Operations](OPERATIONS.md).
No live tokens, LaunchAgent plists, or per-host settings should be committed.
