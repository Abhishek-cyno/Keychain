#!/usr/bin/env bash
#
# Build and ship the frontend to DreamHost shared hosting.
#
#   bash deploy/upload-dreamhost.sh
#
# Configure once in deploy/dreamhost.env (gitignored — it holds your SSH user
# and server), or override per run:
#
#   DH_USER=eqova DH_HOST=iad1-shared-e1-05.dreamhost.com \
#     bash deploy/upload-dreamhost.sh
#
# Key-based SSH is expected. Set it up once with:
#   ssh-keygen -t ed25519 -f ~/.ssh/eqova-dreamhost -N ""
#   ssh-copy-id -i ~/.ssh/eqova-dreamhost.pub <user>@<server>.dreamhost.com

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f deploy/dreamhost.env ] && . deploy/dreamhost.env

DH_USER="${DH_USER:-}"
DH_HOST="${DH_HOST:-}"
DH_PATH="${DH_PATH:-tap.eqova.in}"
DH_KEY="${DH_KEY:-$HOME/.ssh/eqova-dreamhost}"

if [ -z "$DH_USER" ] || [ -z "$DH_HOST" ]; then
  cat >&2 <<'MISSING'
DH_USER and DH_HOST are not set.

Create deploy/dreamhost.env with:

  DH_USER=your-shell-user
  DH_HOST=iad1-shared-e1-05.dreamhost.com
  DH_PATH=tap.eqova.in

Both come from the DreamHost panel: Websites -> Manage Websites -> the site's
"Manage" page shows the web directory, and Servers -> the server's hostname.
MISSING
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -f "$DH_KEY" ] && SSH_OPTS+=(-i "$DH_KEY")

echo "==> Building"
( cd web && npm run build )

# Three things that are each silently fatal in production, and each of which
# has already bitten this project once.
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

echo "==> Uploading to $DH_USER@$DH_HOST:$DH_PATH"

# --delete removes the previous build's fingerprinted assets, which otherwise
# accumulate forever. Safe here because this directory holds nothing but the
# build — DreamHost keeps logs outside the web root.
rsync -az --delete --itemize-changes \
  -e "ssh ${SSH_OPTS[*]}" \
  web/dist/ "$DH_USER@$DH_HOST:$DH_PATH/"

echo
echo "==> Deployed. Verifying"
ORIGIN="${VITE_PUBLIC_ORIGIN:-https://tap.eqova.in}"
for path in / /admin /zzzzzzzzzz; do
  code=$(curl -s -o /dev/null -L -m 30 -w '%{http_code}' "$ORIGIN$path" || echo 000)
  printf '  %-14s -> %s\n' "$path" "$code"
done

cat <<DONE

A 200 on /zzzzzzzzzz is correct — it proves the SPA fallback works. The app
itself will say "Keychain not recognised", which is the right answer for a
code that does not exist.
DONE
