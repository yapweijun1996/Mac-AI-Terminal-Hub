# Implementation Plan

> Status: design proposal only; not deployed. Public repository / private runtime.

Phases P0–P4 are design and acceptance gates. No phase is marked completed by this PR.
Deployment requires explicit owner approval and passing external Access tests.

## 8. Implementation plan and gate tests

| Phase | Work | Exit gate |
|---|---|---|
| **P0 — preflight** | Verify CLI binary paths + versions/login state, tmux/ttyd availability, host power/sleep behavior, Git repositories, user context and folder ownership; decide single-user vs dedicated macOS account | Report what is known/unknown; no changes to Mac mini routes |
| **P1 — protected connectivity** | Prepare public source repository, SPA/gateway, MacBook Air dedicated tunnel, exact hostname DNS, Cloudflare Access owner allowlist/MFA/JWT validation | Unauthenticated external HTTP + WS **denied**; signed valid browser access works; ports loopback only |
| **P2 — core terminal** | Build tmux registry, ttyd manager, same-origin path proxy, 3 agents, project launcher, reconnect | CLI commands really run; reconnect attaches same `tmux` session; second writer rejected; session stop requires confirmation |
| **P3 — dashboard** | Overview, Project list, Session list, system metrics, mobile controls, settings | 390x844 and 430x932 no horizontal scrolling; actual Mac metrics are labeled/accurate; no false agent-completion statuses |
| **P4 — hardening & ops** | Metadata audit, CSRF, rate limiting, WebSocket Origin checks, launchd login startup, runbooks, failure injection and dependency review | Security tests pass, unattended tunnel reconnection when host awake, graceful rollback tested |
| **P5 — optional integrations** | Mac-MCP read-only health, CLI event hooks, notifications, task outcomes, Git diff view | Separate change proposal + threat review; not needed for MVP production gate |

### Acceptance suite: minimum
- [ ] `https://terminal.yapweijun1996.com` shows Access sign-in to an unauthenticated browser; no SPA data leaks.
- [ ] Unauthenticated `/api/v1/system`, `/api/v1/sessions`, `/t/...` requests fail closed.
- [ ] WebSocket upgrade without valid Access token/expected Origin fails closed.
- [ ] Owner authenticates via MFA-capable IdP; another email is denied even if email domain is shared.
- [ ] Gateway/ttyd are not accessible on any LAN/public interface.
- [ ] Codex/Claude/Pi are verified locally; missing agent yields an explicit error, not success.
- [ ] Creating a session with path traversal, symlink escape, or unknown binary is rejected.
- [ ] One project+agent creates one named tmux session; browser refresh reattaches to same ID.
- [ ] Network disconnect does not kill tmux; manual Stop does and creates an audit event.
- [ ] Race: double-click or retried create request does not duplicate a session (idempotency key).
- [ ] Terminal handles Mandarin IME, UTF-8, paste, resize, mobile key input and basic copy.
- [ ] Mobile 390x844 / 430x932 visual QA; desktop 1440px; no horizontal document overflow.
- [ ] System fields are genuine host observations; unavailable metrics show `Unknown`.
- [ ] App and tunnel recover after process crash; on macOS login they restart via launchd.
- [ ] Laptop lid-close, wake, logout, reboot, power loss tests document expected outages; no guarantee of 24/7 access.
- [ ] Git ignores secrets, tunnel tokens, local user configuration, runtime data, logs.
- [ ] Security headers, CSRF, Access JWT validation, Origin validation, dependency audit and no root process are verified.
- [ ] Rollback command stops tunnel and Hub without losing registered project information.

## 11. Task delegation brief (copy to local Codex CLI when ready)

> Build Mac-AI-Terminal-Hub per this spec. First perform read-only P0 preflight, report host paths/versions/security gaps, and do not change the existing Mac mini tunnel. Implement P1–P4 on a feature branch with incremental commits (public repo branches are public). No credential copying, no public anonymous terminals, no root execution, no bypassing Cloudflare Access, no `sh -c` on user-controlled input. Require test evidence for HTTP & WS authorization, reconnect, one-writer sessions, path traversal, mobile QA, and rollback. Do not deploy to the public hostname without explicit owner approval after the security gate.
