#!/usr/bin/env bash
#
# Where is tap.eqova.in up to?
#
#   bash deploy/check-dreamhost.sh
#
# Read-only. Answers the three questions that matter during the switch, in the
# order they have to be true:
#
#   1. are the files on the server?
#   2. has Apache picked up the vhost?   (independent of DNS)
#   3. has DNS reached this machine?     (independent of the vhost)
#
# Checking the vhost through the server's own public IP with --resolve is what
# separates 2 from 3: it reaches the right Apache regardless of what DNS says,
# so a failure there is a hosting problem, not a DNS one.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f deploy/dreamhost.env ] && . deploy/dreamhost.env

DH_USER="${DH_USER:-medicone_keychain}"
DH_HOST="${DH_HOST:-vps40384.dreamhostps.com}"
DH_PATH="${DH_PATH:-tap.eqova.in}"
DH_KEY="${DH_KEY:-$HOME/.ssh/eqova-dreamhost}"
DOMAIN="${DOMAIN:-tap.eqova.in}"

SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[ -f "$DH_KEY" ] && SSH+=(-i "$DH_KEY")
TARGET="$DH_USER@$DH_HOST"

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
no()   { printf '  \033[31mNO\033[0m    %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }

# nslookup prints the resolver's own address first, then the answer after the
# "Name:" line. Taking the first Address: yields the local DNS server.
resolve_a() {
  nslookup -type=A "$1" 8.8.8.8 2>/dev/null |
    awk '/^Name:/{seen=1} seen && /^Address: */{print $2; exit}'
}

VPS_IP=$(resolve_a "$DH_HOST")

echo "Target: $TARGET  (${VPS_IP:-ip unknown})"
echo

echo "1. Files on the server"
if "${SSH[@]}" "$TARGET" "test -f '$DH_PATH/index.html' && test -f '$DH_PATH/.htaccess'" 2>/dev/null; then
  ok "index.html and .htaccess are in ~/$DH_PATH"
else
  no "build not found in ~/$DH_PATH — run deploy/upload-dreamhost.sh"
fi
echo

echo "2. Apache vhost (asked directly, bypassing DNS)"
if [ -z "$VPS_IP" ]; then
  no "could not resolve $DH_HOST, skipping"
else
  body=$(curl -s -m 20 -k --resolve "$DOMAIN:443:$VPS_IP" "https://$DOMAIN/" 2>/dev/null)
  if printf '%s' "$body" | grep -q 'Site not found'; then
    no "Apache still serves its catch-all — the vhost is not active yet"
    info "DreamHost allows up to 15 minutes after adding a site. Re-run this."
  elif printf '%s' "$body" | grep -q 'id="root"'; then
    ok "the app is being served"
    code=$(curl -s -o /dev/null -m 20 -k --resolve "$DOMAIN:443:$VPS_IP" \
      -w '%{http_code}' "https://$DOMAIN/zzzzzzzzzz" 2>/dev/null) || true
    if [ "${code:-000}" = "200" ]; then
      ok "SPA fallback works (/zzzzzzzzzz -> 200)"
    else
      no "SPA fallback not working (/zzzzzzzzzz -> ${code:-000}) — check .htaccess"
    fi
  else
    no "unexpected response from the vhost"
    info "$(printf '%s' "$body" | head -c 120)"
  fi
fi
echo

echo "3. DNS"
a=$(resolve_a "$DOMAIN")
aaaa=$(nslookup -type=AAAA "$DOMAIN" 8.8.8.8 2>/dev/null |
  awk '/^Name:/{seen=1} seen && /^Address: */{print $2; exit}' | grep ':' || true)

if [ -n "$a" ]; then
  if [ "$a" = "$VPS_IP" ]; then
    ok "A record -> $a (the VPS)"
  else
    no "A record -> $a, expected $VPS_IP"
  fi
else
  no "no A record yet — add: tap -> A -> ${VPS_IP:-<vps ip>} in Route 53"
fi

if [ -n "$aaaa" ]; then
  no "an AAAA record still answers: $aaaa"
  info "IPv6 clients would go there instead. Once the A record exists the"
  info "*.eqova.in wildcard should stop applying to this name."
else
  ok "no AAAA record (IPv6 clients will fall back to IPv4)"
fi
echo

echo "4. End to end, as a phone would see it"
for p in / /admin /zzzzzzzzzz; do
  code=$(curl -s -o /dev/null -L -m 20 -w '%{http_code}' "https://$DOMAIN$p" 2>/dev/null) || true
  printf '  %-14s -> %s\n' "$p" "${code:-000}"
done
