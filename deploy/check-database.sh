#!/usr/bin/env bash
#
# Is the database healthy, in sync, and not leaking?
#
#   bash deploy/check-database.sh
#
# Read-only. Run it after setup, after any schema change, and whenever a card
# shows the wrong details.
#
# The security section is the reason this exists rather than a curl one-liner.
# The anon key ships in the browser bundle, so "can anon call sync_pull?" is a
# question about production, not about a local test — and the answer changed
# once already during development, silently, because Postgres grants EXECUTE to
# PUBLIC by default and revoking from anon alone does not take it away.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
no()   { printf '  \033[31mNO\033[0m    %s\n' "$1"; FAILED=1; }
warn() { printf '  \033[33m??\033[0m    %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }
FAILED=0

envval() { grep -E "^$1=" web/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | xargs; }

# Environment wins over web/.env, so this can be pointed at a staging project
# or a local stack without touching the file the deploy reads.
URL="${VITE_SUPABASE_URL:-$(envval VITE_SUPABASE_URL)}"
KEY="${VITE_SUPABASE_ANON_KEY:-$(envval VITE_SUPABASE_ANON_KEY)}"
API="${VITE_API_BASE:-$(envval VITE_API_BASE)}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set in web/.env."
  echo "The app still works — it falls back to Apps Script — but every tap"
  echo "costs 1.25-2.5s. See docs/DATABASE.md."
  exit 1
fi

RPC="$URL/rest/v1/rpc"
AUTH=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")

echo "Database: $URL"
echo

# ---------------------------------------------------------------- 1. reachable
echo "1. Reachable"
# get_card, because it is the only thing the browser key may call now. An
# unknown code answering NOT_FOUND proves the function, the table and the
# permissions are all working, without needing a real slug.
probe=$(curl -s -m 25 "${AUTH[@]}" "$RPC/get_card" -X POST   -H 'Content-Type: application/json' -d '{"p_slug":"zzzzzzzzzz"}' 2>/dev/null)
case "$probe" in
  *NOT_FOUND*)
    ok "answering"
    ;;
  *)
    no "no usable answer from get_card"
    info "got: $(printf '%s' "${probe:-<empty>}" | head -c 160)"
    echo; echo "Has db/schema.sql been run in the SQL editor?"; exit 1
    ;;
esac

# --------------------------------------------------------------- 2. the anon key
echo
echo "2. The key in the bundle is the anon key"
role=$(printf '%s' "$KEY" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | sed -n 's/.*"role"[ :]*"\([^"]*\)".*/\1/p')
if [ "$role" = "anon" ]; then
  ok "role=anon"
elif [ -n "$role" ]; then
  no "role=$role — THIS IS A PRIVILEGED KEY AND IT IS IN THE BUNDLE"
  info "Replace it with the anon/public key and rotate the leaked one now."
else
  warn "could not decode the key's role claim (newer non-JWT format?)"
fi

# ------------------------------------------------------- 3. the security boundary
echo
echo "3. What the anon key can reach"

# Status is read out of the response headers rather than curl's --write-out.
# On Git Bash's curl 8.8.0 (Schannel), -w returns 000 with exit 43 against this
# host while the request itself succeeds perfectly — so -w would report every
# check as a failure and hide the real answer. Headers are parsed the same way
# everywhere and do not have that problem.
status_and_body() {
  curl -s -i --max-time 25 "$@" 2>/dev/null
}

http_status() {
  printf '%s' "$1" | head -1 | awk '{print $2}' | tr -d '\r'
}

http_body() {
  # Everything after the first blank line.
  printf '%s' "$1" | awk 'BEGIN{b=0} b{print} /^\r?$/{b=1}'
}

denied() {
  local fn="$1" body="$2" resp code
  resp=$(status_and_body -X POST "$RPC/$fn" "${AUTH[@]}" \
    -H 'Content-Type: application/json' -d "$body")
  code=$(http_status "$resp")

  case "$code" in
    401|403|404)
      ok "$fn is denied ($code)"
      ;;
    "")
      warn "$fn — no response, could not check"
      ;;
    *)
      # A 200 here is the thing that matters. Show what leaked, because
      # "sync_pull answered" is abstract until you see the contact details.
      no "$fn ANSWERED $code — it must not be callable with the anon key"
      info "returned: $(http_body "$resp" | head -c 120)"
      info "Re-run the permissions block at the end of db/schema.sql."
      ;;
  esac
}

# The browser key may reach exactly one function. Everything else — including
# anything that could WRITE to the mirror and change what a tap shows — must be
# refused. Claims and edits go through Apps Script into the sheet.
denied sync_pull          '{"p_known":{}}'
denied sync_push          '{"p_rows":[]}'
denied sync_hashes        '{}'
denied set_admin_password '{"p_password":"placeholder"}'
denied claim_card         '{"p_slug":"zzzzzzzzzz","p_card":{"name":"x"}}'
denied admin_update       '{"p_id":1,"p_card":{},"p_password":"x"}'
denied admin_release      '{"p_id":1,"p_password":"x"}'
denied admin_set_status   '{"p_id":1,"p_status":"BLOCKED","p_password":"x"}'
denied admin_get          '{"p_id":1,"p_password":"x"}'
denied admin_list         '{"p_q":"","p_status":"","p_limit":1,"p_offset":0}'
denied admin_stats        '{}'

# And a positive control: the one public read must still work, or the checks
# above would pass simply because nothing works at all.
card=$(curl -s -m 25 "${AUTH[@]}" "$RPC/get_card" -X POST \
  -H 'Content-Type: application/json' -d '{"p_slug":"zzzzzzzzzz"}' 2>/dev/null)
case "$card" in
  *NOT_FOUND*) ok "get_card is reachable (unknown code correctly refused)" ;;
  *)           no "get_card did not behave as expected: $(printf '%s' "$card" | head -c 120)" ;;
esac

# ------------------------------------------------- 4. does the mirror match?
echo
echo "4. The mirror matches the sheet"
if [ -z "$API" ] || [ "$API" = "mock" ]; then
  warn "VITE_API_BASE is not set, so there is nothing to compare against"
else
  sheet=$(curl -sL -m 60 "$API?action=list&limit=500&_=$(date +%s)" 2>/dev/null)
  if [ -z "$sheet" ]; then
    warn "the Apps Script API did not answer; skipping"
  else
    # Compare actual card content for a sample, not just row counts. A count can
    # match while every name is wrong.
    report=$(SHEET="$sheet" RPCU="$RPC" AKEY="$KEY" node -e '
      const https = require("https");
      const sheet = JSON.parse(process.env.SHEET).data.items;
      const claimed = sheet.filter(r => r.name);
      const pick = [];
      for (let i = 0; i < claimed.length && pick.length < 8; i += Math.max(1, Math.floor(claimed.length / 8))) {
        pick.push(claimed[i]);
      }
      const get = (slug) => new Promise((res) => {
        const u = new URL(process.env.RPCU + "/get_card");
        u.searchParams.set("p_slug", slug);
        u.searchParams.set("apikey", process.env.AKEY);
        https.get(u, (r) => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)) } catch { res(null) } }); })
          .on("error", () => res(null));
      });
      (async () => {
        let same = 0; const bad = [];
        for (const row of pick) {
          const card = await get(row.slug);
          if (card && card.name === row.name) same++;
          else bad.push(`#${row.id} ${row.slug}: sheet "${row.name}" vs database "${card ? card.name : "no answer"}"`);
        }
        console.log(JSON.stringify({ sampled: pick.length, same, bad, claimed: claimed.length, total: sheet.length }));
      })();
    ' 2>/dev/null)

    sampled=$(printf '%s' "$report" | sed -n 's/.*"sampled":\([0-9]*\).*/\1/p')
    same=$(printf '%s' "$report" | sed -n 's/.*"same":\([0-9]*\).*/\1/p')
    claimed=$(printf '%s' "$report" | sed -n 's/.*"claimed":\([0-9]*\).*/\1/p')
    total=$(printf '%s' "$report" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')

    if [ -n "$sampled" ] && [ "$sampled" = "$same" ]; then
      ok "sampled $sampled of $claimed claimed cards — all identical to the sheet"
      info "Sheet holds $total keychains. syncStatus() in Apps Script checks all of them."
    else
      no "card content differs between the sheet and the database"
      printf '%s' "$report" | sed -n 's/.*"bad":\[\(.*\)\],"claimed".*/\1/p' | tr ',' '\n' | head -5 | sed 's/^/        /'
      info "Run syncNow() in the Apps Script editor."
    fi
  fi
fi

# --------------------------------------------------------------- 5. tap speed
echo
echo "5. Tap latency"
slug=$(printf '%s' "${sheet:-}" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$slug" ]; then
  slug=$(grep -oE '^[0-9]+,[^,]*,([a-z0-9]{10})' tools/out/keychains.csv 2>/dev/null | head -1 | cut -d, -f3)
fi

if [ -n "$slug" ]; then
  simple=$(http_status "$(status_and_body "$RPC/get_card?p_slug=$slug&apikey=$KEY")")
  if [ "$simple" = "200" ]; then
    ok "preflight-free reads work (one round trip per tap)"
  else
    warn "preflight-free read returned ${simple:-no response} — taps cost two round trips"
    info "Not a fault; db.js falls back to the header form automatically."
  fi

  start=$(date +%s%N)
  for _ in 1 2 3; do
    curl -s -o /dev/null --max-time 25 "${AUTH[@]}" "$RPC/get_card?p_slug=$slug" 2>/dev/null
  done
  avg=$(( ( $(date +%s%N) - start ) / 3000000 ))

  if [ "$avg" -lt 400 ]; then
    ok "${avg}ms average per tap (was 1250-2500ms on Apps Script)"
  else
    warn "${avg}ms average — slower than expected"
    info "Check the project's region; Mumbai is what this was sized for."
  fi
else
  warn "could not find a slug to time"
fi

echo
if [ "$FAILED" = "1" ]; then
  echo "Something above needs attention."
  exit 1
fi
echo "All good."
