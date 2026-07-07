#!/usr/bin/env sh
set -eu

repo_url="${GREYBEARD_REPO_URL:-https://github.com/ugurkocde/greybeard.git}"
install_dir="${GREYBEARD_INSTALL_DIR:-$HOME/.greybeard}"
bin_dir="${GREYBEARD_BIN_DIR:-$HOME/.local/bin}"

printf '%s\n' "Installing Greybeard..."

if [ -d "$install_dir/.git" ]; then
  git -C "$install_dir" fetch --prune
  git -C "$install_dir" pull --ff-only
elif [ -e "$install_dir" ]; then
  printf '%s\n' "Install directory exists and is not a git checkout: $install_dir" >&2
  exit 1
else
  git clone "$repo_url" "$install_dir"
fi

cd "$install_dir"
npm ci
npm run build --workspaces

mkdir -p "$bin_dir"
chmod +x "$install_dir/cli/dist/index.js"
ln -sfn "$install_dir/cli/dist/index.js" "$bin_dir/greybeard"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf '%s\n' "WARN $bin_dir is not on PATH." >&2 ;;
esac

"$bin_dir/greybeard" setup
