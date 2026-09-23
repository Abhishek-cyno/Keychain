#!/usr/bin/env bash
#
# One-time: teach Apache to hand /d/<id> and /admin to the React app.
#
#   bash deploy/install-routing.sh <key.pem>
#
# This edits the vhost that serves the LIVE WordPress site, so it is written to
# be reversible at every step:
#   * refuses to run twice (idempotent)
#   * refuses unless the anchor line appears exactly once
#   * takes a timestamped backup first
#   * runs `apachectl configtest` and ROLLS BACK automatically if it fails
#   * only restarts Apache once the config is known good
#
# To undo later:
#   bash deploy/install-routing.sh <key.pem> --uninstall

set -euo pipefail

KEY="${1:-}"
MODE="${2:-install}"
HOST="${EQOVA_HOST:-13.202.18.203}"
REMOTE_USER="${EQOVA_USER:-bitnami}"

if [ -z "$KEY" ] || [ ! -f "$KEY" ]; then
  echo "Usage: bash deploy/install-routing.sh <path-to-key.pem> [--uninstall]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$HOST")

VHOST=/opt/bitnami/apache/conf/vhosts/wordpress-https-vhost.conf
ANCHOR='# END: Enable non-www to www redirection'

if [ "$MODE" = "--uninstall" ]; then
  echo "==> Removing the keychain block"
  "${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
VHOST="$VHOST"
BACKUP="/home/$REMOTE_USER/vhost-backup-\$(date +%Y%m%d-%H%M%S).conf"
sudo cp "\$VHOST" "\$BACKUP"
echo "backup: \$BACKUP"
sudo sed -i '/Eqova keychain app BEGIN/,/Eqova keychain app END/d' "\$VHOST"
if sudo apachectl configtest 2>&1 | tail -2; then
  sudo /opt/bitnami/ctlscript.sh restart apache
  echo "removed and restarted"
else
  sudo cp "\$BACKUP" "\$VHOST"
  echo "configtest failed - rolled back" >&2
  exit 1
fi
REMOTE
  exit 0
fi

echo "==> Sending the config block"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new -q \
  "$ROOT/deploy/vhost-block.conf" "$REMOTE_USER@$HOST:/tmp/eqova-block.conf"

echo "==> Installing routing (with automatic rollback)"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail

VHOST="$VHOST"
ANCHOR='$ANCHOR'
BLOCK=/tmp/eqova-block.conf

if grep -q 'Eqova keychain app BEGIN' "\$VHOST"; then
  echo "Already installed - nothing to do."
  exit 0
fi

COUNT=\$(grep -cF "\$ANCHOR" "\$VHOST" || true)
if [ "\$COUNT" != "1" ]; then
  echo "Expected the anchor line exactly once, found \$COUNT. Aborting untouched." >&2
  exit 1
fi

BACKUP="/home/$REMOTE_USER/vhost-backup-\$(date +%Y%m%d-%H%M%S).conf"
sudo cp "\$VHOST" "\$BACKUP"
echo "backup: \$BACKUP"

# sed 'r' appends the file's contents directly after the anchor line, which
# puts the rules inside the VirtualHost and ahead of the <Directory> block.
sudo sed -i "/\$ANCHOR/r \$BLOCK" "\$VHOST"

echo "--- configtest ---"
if sudo apachectl configtest 2>&1 | tail -3; then
  sudo /opt/bitnami/ctlscript.sh restart apache >/dev/null
  echo "--- apache restarted ---"
else
  sudo cp "\$BACKUP" "\$VHOST"
  echo "configtest FAILED - vhost rolled back, apache untouched" >&2
  exit 1
fi

rm -f "\$BLOCK"

# ctlscript returns before Apache is accepting connections again, so poll
# until it answers rather than curling straight into a refused socket.
printf "%s" "--- waiting for apache "
for i in \$(seq 1 30); do
  if curl -s -o /dev/null -k -m 2 https://127.0.0.1/ 2>/dev/null; then
    echo "(up after \${i}s) ---"
    break
  fi
  printf "."
  sleep 1
done
echo

echo "--- local verification ---"
# A failing curl must not abort the script: a non-200 here is information,
# not a reason to leave the operator without the rest of the results.
for p in / /keychain-app/index.html /d/1 /admin; do
  code=\$(curl -s -o /dev/null -k -m 10 -w "%{http_code}" -H "Host: www.eqova.in" "https://127.0.0.1\$p" 2>/dev/null || echo "000")
  printf "  %-28s -> %s\n" "\$p" "\$code"
done
REMOTE

echo
echo "Done. Check from a browser:  https://eqova.in/d/1"
