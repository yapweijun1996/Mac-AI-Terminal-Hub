# macOS Deployment Readiness (Not Yet Deployed)

**Target machine:** Mac mini running macOS. Older MacBook Air references describe an obsolete target.

This document is setup guidance only. The Mac mini runs other critical apps; do not attach this app to an existing tunnel or modify a running Cloudflare service. No tunnel, system package, or service is changed during implementation.

## P0: Local verification (read-only)

1. Identify macOS version, non-root account, resources, and sleep/wake policy.
2. Locate trusted absolute binaries and versions for Node, Git, tmux, ttyd, Codex, Claude, and Pi.
3. Validate CLI login status locally without reading or exporting credentials.
4. Define explicit allowed project roots and inspect symlink behavior.
5. Determine whether a dedicated unprivileged macOS account is practical.

## P1: Protected connectivity gates

1. Build and test the gateway on `127.0.0.1:4782` only.
2. Create a dedicated self-hosted Cloudflare Access application for the exact hostname, with exact identity allowlisting and MFA-capable IdP. Configure no bypass rules.
3. Configure issuer, audience, and allowlisted identity privately; verify signature, issuer, audience, expiry, token type, and email at the origin.
4. Verify every HTTP route and WebSocket upgrade denies invalid identity and wrong Origin.
5. Confirm project path containment, session lifecycle, and loopback-only binding.
6. Only after gates 1–5 pass, provision an independent Cloudflare Tunnel for this app and route it to `http://127.0.0.1:4782`. Never modify or reuse another service's tunnel configuration.
7. Validate from an external browser and maintain an app-specific rollback procedure.

These are future integration steps, not authorization to alter currently running Cloudflare services.

## Local gateway development

From `apps/gateway`, copy `.env.example` to the ignored `.env`, replace placeholders privately, then run `npm install`, `npm test`, and `npm run build`. The `dev` and `start` scripts load `.env`; tests use generated credentials and the build needs no runtime configuration. Required runtime values are `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `CF_ACCESS_ALLOWED_EMAIL`. Write operations also require `PUBLIC_ORIGIN`; configure explicit `PROJECT_ROOTS`, `TMUX_BIN`, and absolute agent binary paths before use. Any `HUB_HOST` other than `127.0.0.1` fails startup. Local development has no authentication bypass: use test-generated credentials for automated tests and valid Access configuration for the running service.

For local-only work, set `PUBLIC_ORIGIN=http://127.0.0.1:4782` and access the gateway with that exact origin; Access issuer, audience, and allowlisted identity remain mandatory. There is no local auth bypass, and the listener remains loopback-only. Do not configure Cloudflare Tunnel to reach the gateway during implementation.

If the owner separately approves the package change after reviewing [the read-only native prerequisites assessment](NATIVE-TERMINAL-PREREQUISITES.md), install only the required dependencies manually. This task did not authorize installation:

```sh
brew install tmux ttyd
command -v tmux
command -v ttyd
tmux -V
ttyd --version
```

Set `TMUX_BIN` to the verified absolute tmux path. The gateway does not install software or expose a remote shell automatically. The source includes a per-session loopback ttyd adapter, same-origin proxy, one-time grant checks, a server-side writer lease and process cleanup. It returns 503 before upgrade if native transport cannot start. The workspace sandbox denies local socket binds, so the HTTP/WebSocket integration suite must run on the Mac-MCP host runner. Native ttyd/tmux and real browser-to-gateway terminal E2E remain unverified; do not deploy until they pass.

See [Test Plan](TEST-PLAN.md), [Security](SECURITY.md), and [Operations](OPERATIONS.md). Never commit populated `.env` files, Access tokens, tunnel credentials, launch-agent host values, or local inventories.
