# Eqova — NFC + QR doctor keychains

A physical keychain carries an NFC chip and a printed QR code. Both point at the
same permanent URL:

```
https://eqova.in/d/127
```

That URL identifies the **keychain**, not the doctor. The doctor's details live
in a data store behind an API, so a doctor changing hospital or phone number
never means reprinting a QR or re-encoding a chip.

```
NFC / QR  →  eqova.in/d/127  →  React app reads id=127  →  API  →  profile
```

## What is here

| Path | What it is |
| --- | --- |
| `web/` | React SPA — the public profile at `/d/:id` and the staff admin at `/admin` |
| `apps-script/` | The API: one Apps Script web app in front of a Google Sheet |
| `tools/` | Batch generator for QR images, NFC URL lists and a printable QA sheet |
| `deploy/` | Nginx config for Lightsail, deploy steps |
| `docs/` | Event runbook for desk staff, NFC encoding instructions |

## Getting it running

**1. Data layer** — follow [`apps-script/README.md`](apps-script/README.md).
Roughly: new Google Sheet → Apps Script → paste `Code.gs` →
run `setup()` → deploy as a web app → copy the `/exec` URL.

**2. Frontend**

```bash
cd web
cp .env.example .env     # paste the /exec URL into VITE_API_BASE
npm install
npm run dev
```

- Public profile: http://localhost:5173/d/1
- Admin: http://localhost:5173/admin

**3. Keychain artwork and encoding**

```bash
cd tools
npm install
node generate-batch.js --from 1 --to 500 --origin https://eqova.in
```

Writes QR PNGs and SVGs, `keychains.csv`, `nfc-urls.txt` and a printable contact
sheet into `tools/out/`. See [`docs/NFC-ENCODING.md`](docs/NFC-ENCODING.md).

**4. Deploy** — [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## How the pieces fit

```
                    PHYSICAL KEYCHAIN #127
                     NFC chip   QR code
                          │        │
                          └───┬────┘
                    https://eqova.in/d/127
                              │
                     Nginx on Lightsail
                  try_files → index.html
                              │
                  React Router  /d/:id  →  id = 127
                              │
                     Apps Script web app
                              │
                       Google Sheet row
                              │
                    public profile fields
```

Nothing in AWS is per-keychain. There is one route, `/d/:id`, and one Nginx
`try_files` line that sends `/d/anything` to the app. 500 keychains or 50,000
makes no difference to the server config.

## The parts that matter

**The URL is permanent.** Once a keychain is manufactured, `eqova.in/d/127` is
fixed forever. Everything else in this system is arranged around not breaking
that promise — which is also why the ID is a plain number the ops team can read
off a physical object and type into a search box.

**Doctors do not exist before the event.** Keychains are seeded as `AVAILABLE`
rows in advance. Staff claim one at the desk and fill in the details there.

**Two staff cannot claim the same keychain.** `assign` takes a lock, re-reads
the row, and refuses with `CONFLICT` if the status is no longer `AVAILABLE`.
The second staff member is told to take a different keychain, and nothing is
overwritten.

**The public API returns only public fields.** Internal notes and timestamps
never leave the API layer, and an unassigned or blocked keychain returns no
doctor details at all.

**Mobile first.** Nearly every scan is a phone held in one hand at a busy venue.

## Statuses

| Status | Meaning | Public profile shows |
| --- | --- | --- |
| `AVAILABLE` | manufactured, not yet handed out | "not active yet" |
| `ASSIGNED` | claimed, details incomplete | "not active yet" |
| `ACTIVE` | live | the doctor's profile |
| `BLOCKED` | lost, withdrawn, or disputed | "currently unavailable" |

## Moving off Google Sheets later

`web/src/lib/api.js` is the only file in the frontend that knows where data
comes from. Swapping Sheets for Node + Postgres means standing up a service that
answers the same shapes and changing `VITE_API_BASE`.

```
today:  eqova.in/d/127 → Apps Script → Google Sheet
later:  eqova.in/d/127 → Node/Express → Postgres
```

The public URL structure does not change, so no keychain in anyone's pocket is
affected.

## Known limits

- `/admin` has no sign-in — anyone with the URL can view and edit every
  keychain. Fine for a controlled device at one event; put real auth in front
  of it before this becomes a standing product.
- Apps Script quotas are generous for hundreds of registrations but are not a
  CDN. Public profile reads are cached for 60 seconds to absorb a spike.
