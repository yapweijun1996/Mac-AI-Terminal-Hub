#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(pwd -P)" != "$(cd "$repo_root" && pwd -P)" ]]; then
  echo "Run from the canonical repository root: $repo_root" >&2
  exit 2
fi
if [[ -z "${1:-}" ]]; then
  echo "Usage: scripts/verify-local-integration.sh PRIVATE_OUTPUT_DIRECTORY" >&2
  exit 2
fi
output_dir="$1"
receipt="$output_dir/host-results.json"
mkdir -p "$output_dir"
chmod 700 "$output_dir"
umask 077

if ! command -v node >/dev/null 2>&1; then
  printf '{"schemaVersion":1,"overall":"failed","runnerStatus":"runner_error","reason":"Node.js is unavailable","checks":[]}' > "$receipt"
  chmod 600 "$receipt"
  echo "Host readback failed closed: Node.js unavailable; receipt at $receipt" >&2
  exit 2
fi

set +e
node "$repo_root/scripts/verify-host-readback.mjs" "$output_dir"
result=$?
set -e
if [[ ! -f "$receipt" ]]; then
  temporary="$receipt.$$.tmp"
  printf '{"schemaVersion":1,"overall":"failed","runnerStatus":"runner_error","reason":"Node runner exited before writing its initial receipt","checks":[]}' > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$receipt"
  chmod 600 "$receipt"
fi
exit "$result"
