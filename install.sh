#!/usr/bin/env sh
# Install a verified private release. No Node, Git, npm, or developer tools required.
set -eu
umask 077
release="${GREYBEARD_RELEASE_TAG:-v0.1.0}"
expected="${GREYBEARD_RELEASE_SHA256:-}"
local_asset="${GREYBEARD_RELEASE_FILE:-}"
if [ -z "$expected" ]; then
  printf '%s\n' 'Set GREYBEARD_RELEASE_SHA256 to the asset hash from the authenticated Greybeard release. Optionally set GREYBEARD_RELEASE_FILE to an already downloaded DMG or Linux archive.' >&2
  exit 1
fi
case "$release" in *[!a-zA-Z0-9._-]*) printf '%s\n' 'Invalid release tag' >&2; exit 1;; esac
case "$expected" in *[!a-fA-F0-9]*) printf '%s\n' 'Invalid SHA-256' >&2; exit 1;; esac
[ "${#expected}" -eq 64 ] || { printf '%s\n' 'SHA-256 must contain 64 hexadecimal characters' >&2; exit 1; }
case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) printf '%s\n' 'Use install.ps1 on Windows' >&2; exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) printf '%s\n' 'Unsupported architecture' >&2; exit 1;; esac
# A shell under Rosetta can report x86_64 on an Apple Silicon Mac.
if [ "$os" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
case "$os-$arch" in darwin-arm64|linux-x64) ;; *) printf '%s\n' 'This release provides an Apple Silicon Mac DMG and an x64 Linux archive. No matching executable is published for this machine.' >&2; exit 1;; esac
if [ "$os" = darwin ]; then
  asset="Greybeard-${release#v}-mac-arm64.dmg"
  install_dir="${GREYBEARD_APP_DIR:-$HOME/Applications}"
  destination="$install_dir/Greybeard.app"
else
  asset="greybeard-linux-x64.tar.gz"
  install_dir="${GREYBEARD_BIN_DIR:-$HOME/.local/bin}"
  destination="$install_dir/greybeard"
fi
mkdir -p "$install_dir"
if [ -e "$destination" ] || [ -L "$destination" ]; then
  printf '%s\n' 'An installation already exists. Close Greybeard and its AI clients, retain the old installation, and replace it manually after verifying the new release.' >&2
  exit 1
fi
tmp_dir=$(mktemp -d "$install_dir/.greybeard-install.XXXXXXXX")
mounted=false
mount_dir="$tmp_dir/mount"
cleanup() {
  if [ "$mounted" = true ]; then
    if ! /usr/bin/hdiutil detach "$mount_dir" >/dev/null 2>&1; then
      printf '%s\n' "Could not eject the Greybeard disk image. Temporary files retained at $tmp_dir." >&2
      return
    fi
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
if [ -n "$local_asset" ]; then
  [ -f "$local_asset" ] || { printf '%s\n' 'GREYBEARD_RELEASE_FILE is not a readable release file' >&2; exit 1; }
  cp "$local_asset" "$tmp_dir/$asset"
elif command -v gh >/dev/null 2>&1; then
  if ! gh release download "$release" --repo OpenAdminOS/greybeard --pattern "$asset" --dir "$tmp_dir"; then
    printf '%s\n' 'Private release download failed. Sign in with gh auth login using an account with repository access, or download the asset in GitHub and set GREYBEARD_RELEASE_FILE.' >&2
    exit 1
  fi
else
  printf '%s\n' 'Download the asset from the private GitHub release and set GREYBEARD_RELEASE_FILE, or use an authenticated GitHub CLI (gh). No public download endpoint is configured.' >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp_dir/$asset" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$tmp_dir/$asset" | cut -d ' ' -f 1)
fi
[ "$actual" = "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ] || { printf '%s\n' 'Release integrity verification failed; nothing was installed' >&2; exit 1; }
if [ "$os" = darwin ]; then
  /usr/bin/codesign --verify --strict "$tmp_dir/$asset"
  /usr/bin/codesign --display --verbose=4 "$tmp_dir/$asset" 2>&1 | /usr/bin/grep -Fxq 'TeamIdentifier=D259ULY2B4'
  /usr/sbin/spctl --assess --type open --context context:primary-signature "$tmp_dir/$asset"
  mkdir "$mount_dir"
  /usr/bin/hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mount_dir" "$tmp_dir/$asset" >/dev/null
  mounted=true
  app="$mount_dir/Greybeard.app"
  [ -d "$app" ] && [ ! -L "$app" ] || { printf '%s\n' 'The disk image does not contain Greybeard.app' >&2; exit 1; }
  /usr/bin/codesign --verify --deep --strict "$app"
  /usr/bin/codesign --display --verbose=4 "$app" 2>&1 | /usr/bin/grep -Fxq 'TeamIdentifier=D259ULY2B4'
  /usr/sbin/spctl --assess --type execute "$app"
  /usr/bin/ditto "$app" "$tmp_dir/Greybeard.app"
  /usr/bin/codesign --verify --deep --strict "$tmp_dir/Greybeard.app"
  /usr/bin/hdiutil detach "$mount_dir" >/dev/null
  mounted=false
  # BSD mv -n preserves an installation created concurrently at this name.
  mv -n "$tmp_dir/Greybeard.app" "$install_dir/"
  [ ! -e "$tmp_dir/Greybeard.app" ] || { printf '%s\n' 'Another installation appeared; it was preserved.' >&2; exit 1; }
  printf '%s\n' "Installed $destination. Open Greybeard from Applications for graphical setup."
  "$destination/Contents/MacOS/greybeard" setup
else
  # Read only the one expected member, never unpack arbitrary archive paths.
  [ "$(tar -tzf "$tmp_dir/$asset")" = greybeard ] || { printf '%s\n' 'Unexpected release archive contents' >&2; exit 1; }
  tar -xOf "$tmp_dir/$asset" greybeard > "$tmp_dir/greybeard"
  chmod 700 "$tmp_dir/greybeard"
  "$tmp_dir/greybeard" --help >/dev/null
  # Hard-linking in the same directory refuses an installation created concurrently.
  ln "$tmp_dir/greybeard" "$destination"
  printf '%s\n' "Installed $destination. Add $install_dir to PATH if needed."
  "$destination" setup
fi
