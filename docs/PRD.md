# Product Requirements (PRD)

> Status: design proposal only; not deployed. Public repository / private runtime.

User: one owner connecting from Windows, macOS, or mobile.
The service runs on MacBook Air; this public repository hosts source only.
See [UI/UX](UI-UX.md) for detailed screens and states.

## 1. Objective / 目标

Deliver a secure, low-idle-resource, browser-first control panel that connects to actual interactive Codex CLI, Claude Code CLI, and Pi CLI processes running on the MacBook Air, without requiring Codex Desktop, open inbound ports, or an always-connected browser.

### Outcomes
- Access from a standard browser at the exact hostname through Cloudflare Access.
- Launch, attach to, detach from, and terminate **named** agent sessions with a repository working directory.
- Restore live tmux sessions after browser refresh or network loss; never imply sessions survive macOS reboot.
- Show truthfully labeled Mac status, service health, and *session* status.
- Never report an agent task as *Completed* solely because a CLI window closed; reliable completion requires explicit structured evidence.
- All mutable operations are restricted to the authenticated owner and recorded as metadata-only audit events.

### Out of scope for MVP
- Exposing Mac-MCP administrative functions or privileged host operations to external callers.
- Full desktop remote control, file explorer/editor, Docker/Kubernetes management, or auto-deploying Git commits.
- Multi-user collaboration, shared terminal typing, public guest access, and agent cross-machine orchestration.
- Auto-answering CLI approval prompts, background scheduled job runners, unsandboxed automatic elevated permissions.
- Guaranteed access when MacBook Air is asleep, logged out, offline, or battery depleted.
