#!/usr/bin/env sh
# Install a verified private-release executable. No Node, Git, or npm required.
set -eu
umask 077
release="${GREYBEARD_RELEASE_TAG:-v0.1.0}"
expected="${GREYBEARD_RELEASE_SHA256:-}"
local_asset="${GREYBEARD_RELEASE_FILE:-}"
if [ -z "$expected" ]; then
  printf '%s\n' 'Set GREYBEARD_RELEASE_SHA256 to the asset hash from the authenticated Greybeard release. Optionally set GREYBEARD_RELEASE_FILE to an already downloaded archive.' >&2
  exit 1
fi
case "$release" in *[!a-zA-Z0-9._-]*) printf '%s\n' 'Invalid release tag' >&2; exit 1;; esac
case "$expected" in *[!a-fA-F0-9]*) printf '%s\n' 'Invalid SHA-256' >&2; exit 1;; esac
[ "${#expected}" -eq 64 ] || { printf '%s\n' 'SHA-256 must contain 64 hexadecimal characters' >&2; exit 1; }
case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) printf '%s\n' 'Use install.ps1 on Windows' >&2; exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) printf '%s\n' 'Unsupported architecture' >&2; exit 1;; esac
# A shell under Rosetta can report x86_64 on an Apple Silicon Mac.
if [ "$os" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
case "$os-$arch" in darwin-arm64|linux-x64) ;; *) printf '%s\n' 'This release provides Apple Silicon macOS and x64 Linux archives. No matching executable is published for this machine.' >&2; exit 1;; esac
asset="greybeard-$os-$arch.tar.gz"
bin_dir="${GREYBEARD_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin_dir"
if [ -e "$bin_dir/greybeard" ] || [ -L "$bin_dir/greybeard" ]; then
  printf '%s\n' 'An installation already exists. Close Greybeard and its AI clients, retain the old executable, and replace it manually after verifying the new release.' >&2
  exit 1
fi
tmp_dir=$(mktemp -d "$bin_dir/.greybeard-install.XXXXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
if [ -n "$local_asset" ]; then
  [ -f "$local_asset" ] || { printf '%s\n' 'GREYBEARD_RELEASE_FILE is not a readable release archive' >&2; exit 1; }
  cp "$local_asset" "$tmp_dir/$asset"
elif command -v gh >/dev/null 2>&1; then
  if ! gh release download "$release" --repo OpenAdminOS/greybeard --pattern "$asset" --dir "$tmp_dir"; then
    printf '%s\n' 'Private release download failed. Sign in with gh auth login using an account with repository access, or download the archive in GitHub and set GREYBEARD_RELEASE_FILE.' >&2
    exit 1
  fi
else
  printf '%s\n' 'Download the archive from the private GitHub release and set GREYBEARD_RELEASE_FILE, or use an authenticated GitHub CLI (gh). No public download endpoint is configured.' >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp_dir/$asset" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$tmp_dir/$asset" | cut -d ' ' -f 1)
fi
[ "$actual" = "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ] || { printf '%s\n' 'Release integrity verification failed; nothing was installed' >&2; exit 1; }
# Read only the one expected member, never unpack arbitrary archive paths.
[ "$(tar -tzf "$tmp_dir/$asset")" = greybeard ] || { printf '%s\n' 'Unexpected release archive contents' >&2; exit 1; }
tar -xOf "$tmp_dir/$asset" greybeard > "$tmp_dir/greybeard"
chmod 700 "$tmp_dir/greybeard"
"$tmp_dir/greybeard" --help >/dev/null
# Hard-linking in the same directory refuses an installation created concurrently.
ln "$tmp_dir/greybeard" "$bin_dir/greybeard"
printf '%s\n' "Installed $bin_dir/greybeard. Add $bin_dir to PATH if needed."
"$bin_dir/greybeard" setup
