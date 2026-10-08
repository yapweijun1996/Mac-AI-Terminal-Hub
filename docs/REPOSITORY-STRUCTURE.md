# Planned Repository Structure

> Status: design proposal only; not deployed. Public repository / private runtime.

The folder tree below is a target architecture, not a claim that applications or deployment scripts are implemented.
No production server exists in this documentation PR.

## 7. Repository structure

```text
Mac-AI-Terminal-Hub/
├── README.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── DEPLOY-MACOS.md
│   ├── OPERATIONS.md
│   └── TEST-PLAN.md
├── apps/
│   ├── web/                         # React + Vite + TypeScript
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/{layout,terminal,metrics,projects,sessions}/
│   │   │   ├── pages/{Overview,Terminal,Projects,Sessions,System,Settings}/
│   │   │   ├── api/
│   │   │   └── styles/
│   │   ├── index.html
│   │   └── package.json
│   └── gateway/                     # Fastify server (loopback only)
│       ├── src/
│       │   ├── server.ts
│       │   ├── auth/{access-jwt,csrf,origin}.ts
│       │   ├── routes/{system,agents,projects,sessions}.ts
│       │   ├── sessions/{manager,tmux,ttyd,registry}.ts
│       │   ├── projects/{allowlist,git-inspect}.ts
│       │   ├── system/{metrics,health}.ts
│       │   ├── audit/{events,redaction}.ts
│       │   └── config/
│       └── package.json
├── packages/
│   └── shared/                      # API types + runtime schemas
├── config/
│   ├── projects.example.json
│   └── terminalhub.example.env     # no real secrets
├── deploy/
│   ├── macos/
│   │   ├── com.yapweijun.terminalhub.plist.template
│   │   ├── com.yapweijun.terminalhub-tunnel.plist.template
│   │   ├── install.sh
│   │   ├── uninstall.sh
│   │   └── diagnostics.sh
│   └── cloudflare/
│       └── README.md               # route + Access policy manual checklist
├── scripts/
│   ├── preflight.sh
│   ├── dev.sh
│   ├── build.sh
│   ├── rollback.sh
│   └── validate-origin.sh
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── .github/workflows/{ci.yml,dependency-audit.yml}
├── .gitignore
├── package.json
└── pnpm-workspace.yaml
```

### Recommended environment template

```dotenv
HUB_HOST=127.0.0.1
HUB_PORT=4782
PUBLIC_HOSTNAME=terminal.yapweijun1996.com
CF_ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com
CF_ACCESS_AUD=REPLACE_WITH_APP_AUDIENCE
CF_ACCESS_ALLOWED_EMAIL=REPLACE_WITH_OWNER_EMAIL
PROJECT_ROOTS=/Users/YOUR_LOCAL_USER/Projects
AUDIT_RETENTION_DAYS=30
TTYD_BIN=/opt/homebrew/bin/ttyd
TMUX_BIN=/opt/homebrew/bin/tmux
CODEX_BIN=REPLACE_WITH_VERIFIED_ABSOLUTE_PATH
CLAUDE_BIN=REPLACE_WITH_VERIFIED_ABSOLUTE_PATH
PI_BIN=REPLACE_WITH_VERIFIED_ABSOLUTE_PATH
```

Never commit a populated `.env`, credential file, Cloudflare Tunnel token, or CLI auth store.
