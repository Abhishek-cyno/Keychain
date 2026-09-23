#!/usr/bin/env bash
#
# Create a dedicated SSH key for GitHub Actions and install it on the server.
#
#   bash deploy/setup-ci-key.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
#
# Why not just paste the Lightsail key into GitHub? Because that key is also
# yours: it is the one you log in with, it is reused by other tooling, and
# revoking it would lock you out too. A separate key means CI can be cut off in
# one line without touching your own access.
#
# It prints the private key at the end so you can paste it into a GitHub
# secret. That output is sensitive - do not paste the terminal log anywhere.

set -euo pipefail

ADMIN_KEY="${1:-}"
HOST="${EQOVA_HOST:-13.202.18.203}"
REMOTE_USER="${EQOVA_USER:-bitnami}"
CI_KEY="$HOME/.ssh/eqova-ci-deploy"

if [ -z "$ADMIN_KEY" ] || [ ! -f "$ADMIN_KEY" ]; then
  echo "Usage: bash deploy/setup-ci-key.sh <your-lightsail-key.pem>" >&2
  exit 1
fi

if [ -f "$CI_KEY" ]; then
  echo "A CI key already exists at $CI_KEY"
  echo "Delete it first if you want to rotate: rm $CI_KEY $CI_KEY.pub"
  exit 1
fi

echo "==> Generating a dedicated CI keypair"
mkdir -p "$HOME/.ssh"
ssh-keygen -t ed25519 -f "$CI_KEY" -N "" -C "github-actions-eqova" -q
chmod 600 "$CI_KEY"

echo "==> Installing the public key on $REMOTE_USER@$HOST"
PUB="$(cat "$CI_KEY.pub")"
ssh -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$HOST" \
  "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys \
   && grep -qF 'github-actions-eqova' ~/.ssh/authorized_keys \
   || echo '$PUB' >> ~/.ssh/authorized_keys"

echo "==> Testing the new key (read-only)"
ssh -i "$CI_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$HOST" \
  'echo "  CI key works, connected as $(whoami)"'

echo
echo "================ GitHub repository VARIABLES ================"
echo "Settings -> Secrets and variables -> Actions -> Variables tab"
echo
echo "  DEPLOY_HOST         $HOST"
echo "  DEPLOY_USER         $REMOTE_USER"
echo "  DEPLOY_DOCROOT      /opt/bitnami/wordpress"
echo "  VITE_API_BASE       (the Apps Script /exec URL from web/.env)"
echo "  VITE_PUBLIC_ORIGIN  https://eqova.in"
echo
echo "================ GitHub repository SECRETS ================="
echo "Same page, Secrets tab"
echo
echo "  DEPLOY_HOST_KEY"
echo "----------------------------------------------------------------"
ssh-keyscan -H "$HOST" 2>/dev/null
echo "----------------------------------------------------------------"
echo
echo "  DEPLOY_SSH_KEY   (everything between the BEGIN and END lines)"
echo "----------------------------------------------------------------"
cat "$CI_KEY"
echo "----------------------------------------------------------------"
echo
echo "To revoke CI access later, on the server:"
echo "  sed -i '/github-actions-eqova/d' ~/.ssh/authorized_keys"
