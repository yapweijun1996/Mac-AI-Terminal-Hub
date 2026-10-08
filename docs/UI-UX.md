# UI/UX Specification

> Status: design proposal only; not deployed. Public repository / private runtime.

[Open the static HTML preview](../prototypes/Mac-AI-Terminal-Hub-UI-Prototype.html).
Demo metrics, projects, sessions and connected indicators are simulated. The preview is not a shell.

## 4. UI/UX product specification

### 4.1 Desktop (>= 1024 px)
- **Left navigation (220 px):** Overview, Terminal, Projects, Sessions, System, Settings.
- **Topbar (56 px):** project title, host connection indicator, lock icon, profile/sign out.
- **Main terminal workspace:** horizontal tabs for Codex / Claude / Pi or custom named sessions; terminal always largest panel; resizable sidebar optional.
- **Right inspector (280 px, collapsible):** active repo and branch, current agent name/CLI version, session attached/detached, process telemetry, last reconnection.
- **Footer:** source of system status and last updated timestamp; explicit reconnect button.
- Default to dark neutral terminal area, accessible light/dark dashboard. No avatars, marketing hero images, heavy animation, or wallpaper.

### 4.2 Mobile (< 768 px)
- Use a compact topbar and 4 navigation icons at the bottom: Home, Terminal, Projects, Monitor.
- The terminal has full usable width and a sticky software key row: `Esc`, `Tab`, `Ctrl`, `Alt`, arrow keys, Paste.
- Avoid browser zoom triggered by small input font; ensure no horizontal page overflow and comfortable touch targets >=44 CSS pixels.
- Collapse project navigator into an accessible drawer and inspector into a sheet.
- Preserve terminal scrollback, focus/keyboard behavior, and text selection when switching tabs.

### 4.3 Screens

**Overview**
- MacBook Air host state: `Online`, `Offline`, `Asleep/Unreachable`, or `Unknown` (use evidence; don't infer sleep solely from unreachable).
- CPU utilization, memory pressure / estimated used memory, disk free, uptime, battery/charging status when exposed safely.
- Three tool availability tiles: Codex, Claude, Pi with `Installed / Authenticated? / Unknown` (do not infer authentication from binary presence).
- Recent sessions with `Attach` and last observed activity.

**Terminal**
- Agent tabs with project path, tab title and status: `Attached`, `Detached`, `Stopped`, `Unknown`.
- Single explicit `New Session` flow: pick project, agent, optional label, confirmation.
- Safe actions: `Reconnect`, `Detach`, `Stop session` (requires confirmation). Do **not** show a fake `AI Finished` status.
- Copy selection, paste, optional font size and theme settings; `Ctrl+C` behavior must be tested with mobile controls.

**Projects**
- Admin adds canonical local Git repo path from an allowlisted directory (no browser-supplied path executed directly).
- Show repo name, branch, dirty/clean state, last checked at, available agent launch buttons.
- Git operations MVP are read-only metadata; no automatic `pull`, `push`, `reset`, `merge` or `delete`.

**Sessions**
- Searchable list: session ID, label, agent, project, start time, last attached time, tmux alive, browser clients.
- Separate statuses for transport, tmux shell, and inferred CLI process where possible; otherwise `Unknown`.
- `Detach` does not kill the process. `Stop` explicitly terminates it. `Delete history` only clears metadata (separate action).

**System**
- Gateway, `cloudflared` and tmux process health.
- Read-only CPU/RAM/disk and process count; timed refresh, no rapid polling in the background.
- Mac-MCP health is *integration placeholder* only; add a read-only health adapter later with independent credentials.

**Settings**
- Allowed local project root(s), default agent, theme, visible aliases, audit retention, read-only security posture checks.
- For authentication management, link out to Cloudflare Zero Trust; do not recreate login passwords in this app.

### 4.4 States and empty/error UX
- Login/session expired: Cloudflare Access re-authentication + `Reconnect` after successful auth.
- Host unreachable: explain last successful contact and that CLI work may or may not still be running.
- Browser disconnected: `Detached / Connection lost`, show reconnect; do not retry `POST /sessions` or accidentally create duplicates.
- Session terminated: `Stopped`; offer create a fresh session; don't claim recoverable.
- Already attached from another browser: show read-only/in-use banner; require explicit takeover in future phase.
- Agent missing or not logged in: show a precise local-setup message; don't leak tokens or raw environment.
- Origin/Access error: generic safe message; keep sensitive stack traces in local diagnostic logs only.
