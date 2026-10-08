# Operations, Failure Modes, Rollback

> Status: design proposal only; not deployed. Public repository / private runtime.

Browser reconnect can reattach to an extant tmux session while the Mac is awake.
Sleep, logout and restart have different failure modes; never promise uninterrupted availability.

## 9. Failure modes & mitigations

| Event | User impact | Expected behavior |
|---|---|---|
| Browser refresh / transient Wi-Fi break | Terminal disconnect | Reconnect to same tmux ID after auth; no new session |
| Cloudflare Access expired | HTTP/WS unauthorized | Login again; tmux stays alive if Mac awake |
| Mac lid closed/sleep | Tunnel often unreachable | Show `Unreachable`; do not claim work still running; user wakes Mac |
| `cloudflared` crashes | Host unreachable | LaunchAgent restarts tunnel, check actual public URL, not stale tunnel-list signal |
| Gateway crashes | Dashboard unavailable | LaunchAgent restarts gateway; tmux typically survives |
| `ttyd` crashes | Terminal iframe disconnect | Recreate ttyd bridge, reattach tmux |
| `tmux` server exits | CLI session lost | Mark stopped/unknown; don't claim recoverable |
| Mac logs out/reboots | User processes or tmux die | Relaunch services upon next user login; tmux sessions not restored automatically |
| Unauthorized Access email | No application access | Deny; audit at Cloudflare, no origin access |
| WebSocket cross-origin attempted | Potential drive-by command injection | Deny before upgrade |
| Untrusted repo instruction requests credential access | Host data theft risk | Require user approval; restrict CLI OS account and project permissions |

## 10. Rollout and rollback

- Develop locally at `http://127.0.0.1:4782`; do not map the domain until Access and origin verification are in place.
- Create the Access self-hosted application with exact hostname + policy **before** publishing the final route; test from a separate unauthenticated browser.
- Install distinct tunnel from MacBook Air to Gateway. Use `launchd` for login-time startup and crash restart; report that logout/host sleep still interrupt service.
- Release `v0.1.0` only after P1–P4 gates. Keep a previous tagged build and current LaunchAgent template for rollback.
- To roll back, stop the gateway/tunnel LaunchAgents and/or disable Cloudflare hostname route; existing files remain. Preserve agent sessions only where safe and possible.
