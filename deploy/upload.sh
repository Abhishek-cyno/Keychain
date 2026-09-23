#!/usr/bin/env bash
#
# Build and ship the frontend to the Lightsail instance.
#
# Usage, from the repo root in Git Bash:
#   bash deploy/upload.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
#
# Optional overrides:
#   EQOVA_HOST=1.2.3.4 EQOVA_USER=bitnami EQOVA_DOCROOT=/opt/bitnami/wordpress \
#     bash deploy/upload.sh <key.pem>
#
# It does not touch WordPress, Apache config, or anything outside the
# keychain-app folder. Routing is a separate, one-time step — see DEPLOY.md.

set -euo pipefail

KEY="${1:-}"
# Deliberately not named USER: interactive shells already export USER as the
# local account name, which would silently override this default.
HOST="${EQOVA_HOST:-13.202.18.203}"
REMOTE_USER="${EQOVA_USER:-bitnami}"
DOCROOT="${EQOVA_DOCROOT:-/opt/bitnami/wordpress}"
APPDIR="$DOCROOT/keychain-app"

if [ -z "$KEY" ]; then
  echo "Usage: bash deploy/upload.sh <path-to-key.pem>" >&2
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "Key not found: $KEY" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$HOST")

echo "==> Building"
( cd web && npm run build )

if [ ! -f web/dist/index.html ]; then
  echo "Build produced no web/dist/index.html — aborting." >&2
  exit 1
fi

# The bundle references /keychain-app/assets/... . If that is missing, the
# production base path is wrong and every phone would get a blank page.
if ! grep -q '/keychain-app/assets/' web/dist/index.html; then
  echo "web/dist/index.html does not reference /keychain-app/ — check vite.config.js base." >&2
  exit 1
fi

echo "==> Uploading to $REMOTE_USER@$HOST"
"${SSH[@]}" "rm -rf /tmp/keychain-app && mkdir -p /tmp/keychain-app"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new -q -r web/dist/* "$REMOTE_USER@$HOST:/tmp/keychain-app/"

echo "==> Installing into $APPDIR"
# Wiping first matters: Vite fingerprints filenames, so old builds would
# otherwise leave orphaned assets behind forever.
"${SSH[@]}" "sudo mkdir -p '$APPDIR' \
  && sudo rm -rf '$APPDIR'/* \
  && sudo cp -r /tmp/keychain-app/* '$APPDIR'/ \
  && sudo chown -R daemon:daemon '$APPDIR' \
  && rm -rf /tmp/keychain-app"

echo "==> Deployed. Verifying"
"${SSH[@]}" "ls -1 '$APPDIR' && echo '---' && ls -1 '$APPDIR/assets'"

cat <<'DONE'

Files are in place.

If this is the first deploy, routing still needs setting up once —
see deploy/DEPLOY.md step 4. Until then /d/1 will still hit WordPress.

Check it:
  curl -sIL https://eqova.in/d/1 | grep -E "^(HTTP|Location)"
DONE
