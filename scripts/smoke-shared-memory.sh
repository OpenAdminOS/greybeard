#!/usr/bin/env bash
set -euo pipefail
# Separate session bus and keyring: never use the operator's personal secrets.
dbus-run-session -- bash <<'INNER'
set -euo pipefail
native_data=$(mktemp -d)
trap 'rm -rf "$native_data"' EXIT
export XDG_DATA_HOME="$native_data"
printf '%s' 'isolated-synthetic-test-password' | gnome-keyring-daemon --unlock --components=secrets
node scripts/smoke-shared-memory.mjs
INNER
