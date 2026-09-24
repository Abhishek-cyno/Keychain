# Eqova — NFC + QR self-service cards

A physical keychain carries an NFC chip and a printed QR code. Both point at one
permanent URL containing that keychain's own random code:

```
https://eqova.in/d/k7mq2xdv9p
```

Tap it while it is unclaimed and you get a form. Fill it in and the keychain is
yours. Tap it afterwards and you get your card.

```
tap unclaimed  →  set-up form  →  submit  →  card, from then on
```

Nobody assigns anything. Possession of the keychain is the authority, which is
why the code in the URL is random rather than sequential: `/d/1` resolving would
let anyone claim or read any keychain by counting.

The sequential number still exists — it is printed on the keychain and is what
the ops team searches by — but it is not a URL.

## What is here

| Path | What it is |
| --- | --- |
| `web/` | React SPA — the card, the claim form, and the staff admin |
| `apps-script/` | The API: one Apps Script web app in front of a Google Sheet |
| `tools/` | Batch generator for QR images, NFC URL lists and a printable QA sheet |
| `deploy/` | Apache coexistence with the live WordPress site, deploy scripts |
| `docs/` | Migration guide, event runbook, NFC encoding, CI/CD |

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
node generate-batch.js --api "<your /exec URL>" --origin https://eqova.in
```

**4. Deploy** — [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

Already running an older build? [`docs/MIGRATION-SELF-SERVICE.md`](docs/MIGRATION-SELF-SERVICE.md).

## How the pieces fit

```
                    PHYSICAL KEYCHAIN
                 NFC chip      QR code
                      └────┬────┘
              https://eqova.in/d/k7mq2xdv9p
                           │
                  Apache on Lightsail
             rewrite /d/<code> → the React app
                           │
              React Router  /d/:slug
                           │
                  Apps Script web app
                           │
                    Google Sheet row
                           │
        ┌──────────────────┴──────────────────┐
   unclaimed → claim form            claimed → card
```

Nothing on the server is per-keychain. One route, one rewrite rule; 500
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

## Moving off Google Sheets later

`web/src/lib/api.js` is the only file in the frontend that knows where data
comes from. Swapping Sheets for Node + Postgres means answering the same shapes
and changing `VITE_API_BASE`. The public URL structure does not change, so no
keychain in anyone's pocket is affected.

## Known limits

- `/admin` needs no password to **view**. It shows no contact details, but it
  does list names, organisations and codes. Putting the whole panel behind the
  password is a small change if you want it.
- Apps Script quotas are generous for hundreds of claims but are not a CDN.
  Public reads are cached 60s (5s while unclaimed, so a claim shows up at once).
- There is no rate limit on claiming. The code's unguessability is the only
  thing stopping automated claiming, which is adequate for codes that are never
  published.
