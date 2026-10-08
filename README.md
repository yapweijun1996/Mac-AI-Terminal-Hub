# Mac AI Terminal Hub

**Browser-based, lightweight AI CLI workspace for macOS.** / 个人 AI 远程终端控制中心

> **Current status: MVP design and static UI prototype only.** No working remote shell,
> authentication service, Cloudflare Tunnel route or live macOS integration is included in this documentation PR.

- Proposed URL: `https://terminal.yapweijun1996.com` (**not claimed live**)
- Target host: MacBook Air (macOS)
- Repository: **PUBLIC source code and planning**; deployed terminal: **PRIVATE owner-only access**
- Planned agents: Codex CLI / Claude Code / Pi CLI
- Planned stack: React + Vite / Fastify / ttyd / tmux / dedicated Cloudflare Tunnel + Access

## Preview

Open [the self-contained HTML mockup](prototypes/Mac-AI-Terminal-Hub-UI-Prototype.html)
locally in a browser. It intentionally uses **simulated** metrics, sessions and project data.
It does not open a real shell or communicate with a Mac.

## Documentation

| Document | Scope |
|---|---|
| [Complete MVP Spec](docs/MVP-SPEC.md) | Full original product, architecture, security, implementation specification |
| [Product Requirements](docs/PRD.md) | Objectives, boundaries, non-goals |
| [System Architecture](docs/ARCHITECTURE.md) | Components, data flow, trust boundaries |
| [UI/UX](docs/UI-UX.md) | Desktop / mobile design, empty and error states |
| [API Contract](docs/API-CONTRACT.md) | HTTP & WebSocket endpoints and session data |
| [Security](docs/SECURITY.md) | Authentication, authorization, host and CLI hardening |
| [Public Repository Policy](docs/PUBLIC-REPO-POLICY.md) | Secret hygiene, review gates |
| [Planned Repository Structure](docs/REPOSITORY-STRUCTURE.md) | Proposed future app/server layout |
| [Implementation Plan](docs/IMPLEMENTATION-PLAN.md) | P0–P4 phases and acceptance |
| [Test Plan](docs/TEST-PLAN.md) | Security, E2E, reconnect and mobile checks |
| [Mac Deployment Readiness](docs/DEPLOY-MACOS.md) | MacBook Air preflight and protected rollout |
| [Operations](docs/OPERATIONS.md) | Failure modes, availability, rollback |
| [Agent Implementation Brief](docs/AGENT-IMPLEMENTATION-BRIEF.md) | Delegation instructions for Codex / Claude / Pi |
| [References](docs/REFERENCES.md) | Official source links |

## Proposed flow

```text
Browser -> Cloudflare Access -> dedicated MacBook Air Tunnel
        -> 127.0.0.1:4782 (Fastify + JWT/WS security)
        -> local ttyd -> tmux -> Codex / Claude / Pi
```

**Security boundary:** a terminal executes commands with its macOS user's permissions.
Cloudflare Access prevents anonymous entry; it does NOT sandbox the CLI.
Even with a public repository, terminal sessions, credentials and logs must stay private.

## Roadmap

- **P0**: MacBook Air environment and permission verification
- **P1**: Authenticated gateway, Access JWT and WS checks
- **P2**: tmux/ttyd sessions, agent launcher, reconnect/stop
- **P3**: Responsive dashboard, projects and real metrics
- **P4**: Security QA, audit, launchd and rollback

The owner will review and merge pull requests. No auto-merge or automatic production deployment.
