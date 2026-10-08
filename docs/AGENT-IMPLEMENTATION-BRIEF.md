# Implementation Brief for Codex / Claude / Pi

You are implementing a public-source, private-runtime terminal management application.
Read [MVP Specification](MVP-SPEC.md), [Security](SECURITY.md), [Architecture](ARCHITECTURE.md),
[Test Plan](TEST-PLAN.md), [Public Repo Policy](PUBLIC-REPO-POLICY.md) before changing code.

- Use feature branches and small reviewable commits. Do not merge on behalf of the owner.
- Start with read-only P0 preflight ON THE ACTUAL MACBOOK AIR. Never assume Mac mini and MacBook Air are interchangeable.
- Implement P1 security protections before enabling any externally accessible terminal.
- Do not use shell interpolation of browser-controlled strings, auto-approve CLI prompts, or start as root.
- Require real HTTP, WS, reconnection, path traversal, single-writer, mobile, crash-recovery and rollback evidence.
- Store tokens and personal configurations outside Git. Public branches and PRs expose their content.
- A UI mockup is NOT a functioning terminal; metrics and task status must be truthful.
- Stop after preparing PR; do not merge or deploy without explicit owner instruction.

Acceptance: all P0–P4 gates evidenced; otherwise clearly mark pending.
