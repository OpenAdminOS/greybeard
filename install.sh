#!/usr/bin/env sh
# Download the same executable used by the graphical setup. No Node/Git/npm needed.
set -eu
release="${GREYBEARD_RELEASE_TAG:-}"
expected="${GREYBEARD_RELEASE_SHA256:-}"
if [ -z "$release" ] || [ -z "$expected" ]; then
  printf '%s\n' 'Greybeard executable releases are not configured yet. Set GREYBEARD_RELEASE_TAG and GREYBEARD_RELEASE_SHA256 from the authenticated release announcement.' >&2
  exit 1
fi
case "$release" in *[!a-zA-Z0-9._-]*) printf '%s\n' 'Invalid release tag' >&2; exit 1;; esac
case "$expected" in *[!a-fA-F0-9]*) printf '%s\n' 'Invalid SHA-256' >&2; exit 1;; esac
[ "${#expected}" -eq 64 ] || exit 1
case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) printf '%s\n' 'Unsupported operating system' >&2; exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) printf '%s\n' 'Unsupported architecture' >&2; exit 1;; esac
bin_dir="${GREYBEARD_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin_dir"
umask 077
tmp_dir=$(mktemp -d "$bin_dir/.greybeard-install.XXXXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 \
  "https://github.com/ugurkocde/greybeard/releases/download/$release/greybeard-$os-$arch" -o "$tmp_dir/greybeard"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp_dir/greybeard" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$tmp_dir/greybeard" | cut -d ' ' -f 1)
fi
[ "$actual" = "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ] || { printf '%s\n' 'Release integrity verification failed' >&2; exit 1; }
chmod 700 "$tmp_dir/greybeard"
"$tmp_dir/greybeard" --help >/dev/null
if [ -e "$bin_dir/greybeard" ] || [ -L "$bin_dir/greybeard" ]; then
  printf '%s\n' 'An installation already exists. Keep it until the executable update activation flow is available.' >&2
  exit 1
fi
mv "$tmp_dir/greybeard" "$bin_dir/greybeard"
printf '%s\n' "Installed $bin_dir/greybeard. Add $bin_dir to PATH if needed."
"$bin_dir/greybeard" setup
