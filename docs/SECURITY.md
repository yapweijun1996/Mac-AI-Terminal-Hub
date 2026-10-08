# Security Requirements

> Status: design proposal only; not deployed. Public repository / private runtime.

**Critical public-repository rule:** deployment tokens, Access credentials, tunnel JSON,
CLI auth stores, developer machine data, personal emails, real environment files and agent transcript data
must remain out of Git history and PRs. The live terminal UI must never be anonymously accessible.
See [Public Repository Policy](PUBLIC-REPO-POLICY.md).

## 6. Security requirements — MUST ship before public exposure

### 6.1 Identity and network
1. Cloudflare **self-hosted HTTP** Access application covers the exact entire hostname, including `/api/*`, `/t/*`, static assets and WebSocket upgrades; no Bypass rules.
2. Allow rule uses the owner's **exact email address**, not an entire domain. Prefer a Google/other compatible IdP with real MFA. Email OTP can be a fallback but should not be presented as phishing-resistant MFA.
3. Keep Access session duration short (proposal: 4–8 hours) and require reauthentication for sensitive workflows as needed. Expiry of Access session does not inherently kill a previously established tmux process.
4. Run `cloudflared` locally on the MacBook Air with a **dedicated Tunnel**, egress-only; no inbound router port forwarding.
5. App binds `127.0.0.1:4782` only. `ttyd` binds a loopback address or restricted UNIX socket; never `0.0.0.0` or raw public port.
6. Reject unexpected `Host` values and ensure only the trusted reverse proxy can reach ttyd. Do not publish ttyd ports as additional Cloudflare routes.

### 6.2 Origin defense-in-depth
7. Gateway validates `Cf-Access-Jwt-Assertion` signature against Cloudflare JWKS, expected issuer and app audience, expiration, token type, and exact email; use `jose` or equivalent mature library, not decode-only validation. Fail closed if keys unavailable with no valid cache.
8. Validate on **every HTTP route and WebSocket upgrade**, not only page loads. Do not use a client-controlled `email` HTTP header as proof of identity.
9. For state-changing HTTP: Origin/Referer checks, CSRF token, content-type enforcement, body-size limits, per-user rate limits, and idempotency for `POST /sessions`. No `GET` side effects.
10. For WebSocket: enforce exact expected `Origin`, validate Access token at upgrade, reject non-allowlisted session IDs, set 1 writer/session, heartbeat and bounded buffers/scrollback. Recheck authorizations at reconnection. Enforce a bounded WebSocket connection lifetime aligned with security policy (on expiry, disconnect the *browser socket* but never silently kill the tmux process). Close live sockets promptly on explicit owner revocation where practical.
11. Security headers: CSP, HSTS at Cloudflare edge, `X-Content-Type-Options: nosniff`, restrictive `Permissions-Policy`; main dashboard `frame-ancestors 'none'`; same-origin embedded ttyd path can use `frame-ancestors 'self'` where needed. Never use permissive global `*` CSP to make terminal work.

### 6.3 Host command and file safety
12. Never run Gateway, ttyd, agents as `root` or administrator unless explicitly justified; prefer a dedicated **standard macOS user** and narrow project directory permissions.
13. Registered project directories are allowlisted. Resolve `realpath`/symlinks and verify path containment before launching. Refuse paths outside approved roots and symlink escapes.
14. Select CLI by fixed enum (`codex`, `claude`, `pi`), resolve trusted absolute binary paths, spawn without `sh -c` or concatenated untrusted arguments. Disable ttyd `--url-arg`.
15. Web terminal shell still grants the underlying local user's permissions! An allowlisted **launcher is not a filesystem sandbox**. If strict isolation is required, use a separate macOS user/account and permissions, or a suitably controlled VM/container strategy.
16. Default to interactive approval modes supported by each CLI. Never auto-approve destructive operations, full-access/sandbox bypass, `sudo`, credentials export, or production deployment.
17. Pin and audit npm/brew dependencies. Treat untrusted repositories/agent instructions and Pi extensions as executable attack surfaces; do not blindly install packages or auto-run post-install hooks.

### 6.4 Confidentiality, audit, operations
18. CLI credentials remain in the local CLI provider/OS-managed locations. No credential syncing to browser JS, logs, environment inspection API, or the Hub Git repo.
19. Audit **metadata only**: sign-in policy failures if available, session create/attach/detach/stop, project registration, admin actions. No keystroke or output recording by default. Suggested local retention 30 days.
20. Protect local files and tunnel credentials with file permissions; exclude `.env`, credential caches, data/ and logs/ from Git. Restrict local network users as appropriate.
21. This **source repository is public**. Never commit credentials, real `.env` values, tokens, local inventories, CLI login stores or logs. Review public PRs for sensitive data and require tests and human approval.
22. Build a one-command `stop`/rollback path; back up project registry/configuration but never copy authentication tokens into backups.
