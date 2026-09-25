#!/usr/bin/env bash
#
# Build and ship the frontend to the DreamHost VPS.
#
#   bash deploy/upload-dreamhost.sh
#
# Target comes from deploy/dreamhost.env (gitignored), or per-run overrides:
#
#   DH_USER=medicone_keychain DH_HOST=vps40384.dreamhostps.com \
#     bash deploy/upload-dreamhost.sh
#
# Key-based SSH is expected:
#   ssh-keygen -t ed25519 -f ~/.ssh/eqova-dreamhost -N ""
#   ssh-copy-id -i ~/.ssh/eqova-dreamhost.pub <user>@<host>
#
# Transfer is tar over ssh rather than rsync. Git Bash on Windows ships no
# rsync, and installing one is a machine-specific detour on the very machine
# that has to be able to deploy. tar and ssh are already there on both ends.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f deploy/dreamhost.env ] && . deploy/dreamhost.env

DH_USER="${DH_USER:-}"
DH_HOST="${DH_HOST:-}"
DH_PATH="${DH_PATH:-}"
DH_KEY="${DH_KEY:-$HOME/.ssh/eqova-dreamhost}"

if [ -z "$DH_USER" ] || [ -z "$DH_HOST" ] || [ -z "$DH_PATH" ]; then
  cat >&2 <<'MISSING'
DH_USER, DH_HOST and DH_PATH must all be set.

Create deploy/dreamhost.env with:

  DH_USER=medicone_keychain
  DH_HOST=vps40384.dreamhostps.com
  DH_PATH=tap.eqova.in

DH_PATH is relative to the remote home directory.
MISSING
  exit 1
fi

# The remote step deletes everything under DH_PATH. Refuse anything that could
# mean "the whole home directory".
case "$DH_PATH" in
  ""|"."|"/"|"~"|"~/"|/*|*..*)
    echo "Refusing to deploy to DH_PATH='$DH_PATH' — it must be a simple path relative to the remote home." >&2
    exit 1
    ;;
esac

SSH=(ssh -o StrictHostKeyChecking=accept-new)
[ -f "$DH_KEY" ] && SSH+=(-i "$DH_KEY")
TARGET="$DH_USER@$DH_HOST"

echo "==> Building"
( cd web && npm run build )

# Four things that are each silently fatal in production, and each of which has
# already bitten this project once.
if [ ! -f web/dist/index.html ]; then
  echo "Build produced no web/dist/index.html — aborting." >&2
  exit 1
fi
if [ ! -f web/dist/.htaccess ]; then
  echo "web/dist/.htaccess is missing. Without it every /<code> URL 404s." >&2
  exit 1
fi
if ! grep -q 'src="/assets/' web/dist/index.html; then
  echo "index.html does not reference /assets/ — check the Vite base." >&2
  exit 1
fi
if ! grep -rq 'script.google.com' web/dist/assets/; then
  echo "No Apps Script URL in the bundle. Set VITE_API_BASE in web/.env, or" >&2
  echo "this deploys in mock mode and serves demo data to real people." >&2
  exit 1
fi

echo "==> Checking the remote"
"${SSH[@]}" "$TARGET" "test -d '$DH_PATH'" || {
  echo "Remote directory '$DH_PATH' does not exist under the home directory." >&2
  echo "Is the site created in the panel, and is SSH (not SFTP-only) enabled?" >&2
  exit 1
}

echo "==> Shipping to $TARGET:~/$DH_PATH"
# "." rather than "*" so dotfiles — .htaccess above all — are included.
# The remote clears the directory first: Vite fingerprints filenames, so old
# builds would otherwise pile up indefinitely.
tar -czf - -C web/dist . | "${SSH[@]}" "$TARGET" "
  set -eu
  cd '$DH_PATH'
  find . -mindepth 1 -delete
  tar -xzf -
  echo '--- deployed ---'
  ls -a
"

echo
echo "==> Verifying"
# curl prints 000 itself on a failed connection AND exits non-zero, so a
# `|| echo 000` fallback would print it twice.
ORIGIN="${VITE_PUBLIC_ORIGIN:-https://tap.eqova.in}"
for path in / /admin /zzzzzzzzzz; do
  code=$(curl -s -o /dev/null -L -m 30 -w '%{http_code}' "$ORIGIN$path" 2>/dev/null) || true
  printf '  %-14s -> %s\n' "$path" "${code:-000}"
done

cat <<'DONE'

A 200 on /zzzzzzzzzz is correct — it proves the SPA fallback works. The app
itself will say "Keychain not recognised", which is the right answer for a
code that does not exist.

000 everywhere means DNS has not reached this machine yet, not that the deploy
failed. Run deploy/check-dreamhost.sh to see which piece is still missing.
DONE
