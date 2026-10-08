# Public Repository and Secret Hygiene

This GitHub repository is PUBLIC. All branches and pull requests are publicly visible.

## Public-safe content
- Product requirements, architecture diagrams, abstract API contracts, screenshots with dummy data.
- Local setup commands using placeholders and non-secret configuration templates.
- Static UI prototype with clearly labelled demonstration metrics.

## Never publish
- Cloudflare API tokens, Tunnel credentials, Access audience values tied to a live account, JWTs, signing keys.
- CLI session tokens, shell history, real terminal output, Git credentials, SSH private keys, macOS Keychain data.
- Real login email addresses, host inventories, internal IPs beyond documented loopback examples.
- Real environment files, project contents, logs, process outputs, session transcripts, internal customer data.

## Pull-request gate
1. Review every added file and Git diff before push.
2. Inspect for secrets, binary dumps and personal metadata; prefer placeholders.
3. No auto-deploy from public PR branches or GitHub Actions into the home computer.
4. No production terminal exposure until Access policy, origin JWT/WS authentication and rollback pass.
5. Keep the project source public while the deployed terminal stays restricted to the owner.
6. Human merges PRs; do not merge automatically.

If a secret is leaked, revoke/rotate it; deleting a Git commit alone is insufficient.
