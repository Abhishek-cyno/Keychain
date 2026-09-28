# Eqova — NFC + QR self-service cards

A physical keychain carries an NFC chip and a printed QR code. Both point at one
permanent URL containing that keychain's own random code:

```
https://tap.eqova.in/k7mq2xdv9p
```

Tap it while it is unclaimed and you get a form. Fill it in and the keychain is
yours. Tap it afterwards and you get your card.

```
tap unclaimed  →  set-up form  →  submit  →  card, from then on
```

Nobody assigns anything. Possession of the keychain is the authority, which is
why the code in the URL is random rather than sequential: a countable URL would
let anyone claim or read any keychain in the batch.

The sequential number still exists — it is printed on the keychain and is what
the ops team searches by — but it is not a URL.

## What is here

| Path | What it is |
| --- | --- |
| `web/` | React SPA — the card, the claim form, and the staff admin |
| `db/` | Postgres schema — the read path; the app may call exactly one function |
| `apps-script/` | The Google Sheet API, and the one-way mirror into Postgres |
| `tools/` | Batch generator for QR images, NFC URL lists and a printable QA sheet |
| `deploy/` | DreamHost hosting config and deploy scripts |
| `docs/` | Database + sync, migration guide, event runbook, NFC encoding, CI/CD |

## Getting it running

**1. Data layer** — [`apps-script/README.md`](apps-script/README.md). New Google
Sheet → Apps Script → paste `Code.gs` → set `ADMIN_PASSWORD` → run `setup()` →
deploy as a web app → copy the `/exec` URL.

**2. Frontend**

```bash
cd web
cp .env.example .env     # paste the /exec URL into VITE_API_BASE
npm install
npm run dev
```

Leave `VITE_API_BASE` blank to run against the in-browser mock, where the staff
password is `demo`. Open `/admin` to find a code to try.

**3. Keychain artwork** — only after the codes exist:

```bash
cd tools
npm install
node generate-batch.js
```

**4. Deploy** — [`deploy/DEPLOY-DREAMHOST.md`](deploy/DEPLOY-DREAMHOST.md).

Already running an older build? [`docs/MIGRATION-SELF-SERVICE.md`](docs/MIGRATION-SELF-SERVICE.md).

## How the pieces fit

```
                    PHYSICAL KEYCHAIN
                 NFC chip      QR code
                      └────┬────┘
              https://tap.eqova.in/k7mq2xdv9p
                           │
                Apache on DreamHost
          .htaccess falls back to index.html
                           │
              React Router  /:slug
                           │
                    Postgres  ~65ms
              (Supabase, Mumbai region)
                           │
        ┌──────────────────┴──────────────────┐
   unclaimed → claim form            claimed → card


   claims and staff edits              one way, never back
   ──────────────────────>  Google Sheet  ──────────>  Postgres
        (Apps Script)        the record          the fast read copy
```

Reads come from Postgres because Apps Script cannot be fast: `/exec` answers
with a 302 to a single-use `googleusercontent.com` URL, so each read costs two
connections plus a cold start — measured at 1.25–2.5s — and cannot be cached,
because replaying that redirect 404s. Through Postgres the same read is 55–72ms.

**Every write still goes through Apps Script into the Google Sheet**, which is
the record for 500 keychains already in circulation. `apps-script/Sync.gs`
copies the sheet into Postgres one way and never writes to the sheet, so a wrong
database cannot damage the record — it gets repaired from it instead. If
Postgres is ever unreachable the app falls back to Apps Script automatically:
slower, but a keychain somebody is holding still works. See
[docs/DATABASE.md](docs/DATABASE.md).

Nothing on the server is per-keychain. One route, one `.htaccess` fallback; 500
keychains or 50,000 makes no difference.

## The parts that matter

**The code is the credential.** Anyone holding the link can claim an unclaimed
keychain. Codes are 10 characters from a 31-character alphabet and come from
`Utilities.getUuid()`, not `Math.random()` — the latter's output is derivable
from earlier values, which would let someone with a few keychains predict
others. Never publish an unclaimed link.

**The URL is permanent.** Once a keychain is manufactured its code is fixed.
Details behind it change freely; the chip is never re-encoded.

**Claiming is once.** The form says so before submitting. Corrections go
through staff, which is why Edit is password-gated rather than removed.

**Two people cannot claim the same keychain.** The claim takes a lock, re-reads
the row, and refuses with `ALREADY_CLAIMED` if it is no longer free.

**The public API returns only public fields.** Internal notes and timestamps
never leave the API, and an unclaimed or blocked keychain returns no details.

**The admin list carries no contact details.** Names and organisations yes, phone
and email no — those need the password.

**Mobile first.** Nearly every tap is a phone held in one hand.

## Statuses

| Status | Meaning | The URL shows |
| --- | --- | --- |
| `AVAILABLE` | manufactured, unclaimed | the set-up form |
| `ASSIGNED` | reserved by staff, no card yet | "not active yet" |
| `ACTIVE` | claimed | the card |
| `BLOCKED` | lost, withdrawn, or disputed | "currently unavailable" |

## Where the data lives

`web/src/lib/api.js` is the only file in the frontend that knows where data
comes from. It reads from Postgres (`web/src/lib/db.js`) and falls back to Apps
Script, so either backend can be replaced without touching a page component. The
public URL structure does not change either way, so no keychain in anyone's
pocket is affected.

## Known limits

- `/admin` needs no password to **view**. It shows no contact details, but it
  does list names, organisations and codes. Putting the whole panel behind the
  password is a small change if you want it.
- A correction typed straight into the Sheet reaches the cards in seconds (an
  onEdit trigger), or within 5 minutes worst case. Claims and `/admin` edits are
  mirrored immediately, in the same request that writes them.
- `apps-script/Sync.gs` never writes to the Sheet. If the database and the Sheet
  disagree, the Sheet wins and the database is repaired from it.
- There is no rate limit on claiming. The code's unguessability is the only
  thing stopping automated claiming, which is adequate for codes that are never
  published.
