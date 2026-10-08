# Test & Acceptance Plan

> Status: all tests pending. This PR adds documentation and a static UI preview only.

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


## Test evidence required

- Record date, host name class (MacBook Air), tool versions, test steps and observed outcome without credentials.
- HTTP and WebSocket unauthorized checks must fail closed before DNS/public rollout.
- Include screen captures for 1440px desktop, 390x844 and 430x932 mobile, redacting private data.
- Verify false-success prevention: browser disconnect must not become "task complete".
- Confirm README and UI preview always disclose simulated data until actual metrics are wired.
