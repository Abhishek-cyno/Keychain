# Postgres: a fast read copy of the sheet

## The rule

**Nothing ever writes to the Google Sheet except Code.gs, exactly as it always
has.** The sync is one way: sheet → database. There is no code path from
Postgres back to the sheet.

That is not a stylistic preference. 500 keychains are in people's hands and 97
doctors have set up cards. The sheet is the record of that. A two-way sync means
a database that is ever wrong — truncated, half-imported, or broken by some
future change — copies itself over real rows on the next pass. One-way removes
that entire class of accident: there is nothing to get right under pressure,
because there is nothing there at all.

Verified rather than asserted: with the database deliberately corrupted (a name
overwritten, a row deleted), a sync pass left the sheet **byte-identical** and
*repaired the database from it*.

## Why there is a database

A tap used to take **1.25–2.5 seconds**. Measured against the live endpoint:

```
total=2.491402s  total=1.644661s  total=1.521608s  total=1.478102s  total=1.250756s
```

That is not slow code, it is the shape of the thing: an Apps Script web app
answers `/exec` with a 302 to a single-use `googleusercontent.com` URL, so every
read pays two connections plus a container cold start. It cannot be cached
either — replaying that redirect returns 404.

Measured through Postgres from a browser: **55–72 ms.**

## What goes where

| | |
| --- | --- |
| **Reads** — resolving a tapped keychain | Postgres |
| **Everything else** | Apps Script → Google Sheet |

Claims, staff edits, blocking, resets and seeding all go where they have always
gone. Only one call was moved, because it is the only one a person stands there
waiting for.

The staff dashboard still reads the sheet. It is a handful of requests a day by
people at a desk, so the latency does not matter — and keeping every write on
one path means one source of truth and one staff password instead of two of each
drifting apart.

### The freshly-claimed card

A doctor fills in the form, taps their keychain, and must see their card — not
the form again. So `Code.gs` calls `syncRowsToDatabase()` in the same request
that writes the row. The mirror is current before the response is returned.

If that call fails it is logged and ignored: a claim that succeeded in the sheet
*has* succeeded, and the scheduled pass catches the mirror up. The worst case is
a card that looks unclaimed for a few minutes, never lost data.

## Why Supabase and not the VPS

The DreamHost VPS has no `sudo`:

```
$ ssh medicone_keychain@vps40384.dreamhostps.com 'sudo -n true; which postgres psql'
sudo: a password is required
/usr/bin/psql
```

`psql` there is only the client. No Postgres *server*, no persistent Node
process, and the frontend is static files on Apache — so the database has to be
managed, with an HTTP API the browser can call.

Supabase **is** ordinary PostgreSQL. `db/schema.sql` was developed and tested
against plain `postgres:15-alpine` in Docker and has no Supabase-specific SQL in
it. Moving elsewhere means `pg_dump`, running PostgREST, and changing two
environment variables. There is no SDK — `web/src/lib/db.js` is plain `fetch`.

## Setting it up

### 1. Create the project

[supabase.com](https://supabase.com) → new project. **Region: Mumbai
(ap-south-1)** — the keychains are used in India and this is most of what a tap
costs.

### 2. Run the schema

SQL Editor → paste the whole of `db/schema.sql` → Run. Idempotent; running it
again is safe.

### 3. Point the app at it

Project Settings → API. Copy **Project URL** and the **anon / public** key into
`web/.env`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> The URL must be the **bare origin**. `db.js` and `Sync.gs` each append
> `/rest/v1/rpc` themselves, so a trailing `/rest/v1/` produces
> `/rest/v1//rest/v1/rpc` and every call 404s.

> The anon key is *meant* to be public and ships in the bundle. It can call
> exactly one function, `get_card`, and nothing else — not even a read of the
> table. The **service_role** key is a different thing and must never appear
> here; `deploy/check-bundle-keys.js` decodes every JWT in the build and refuses
> to deploy if it finds a privileged one.

### 4. Connect Apps Script

`Sync.gs` is a **second file alongside `Code.gs`**, not a replacement for it.
`Code.gs` is the API the site runs on; `Sync.gs` only mirrors the sheet.

Open the sheet → **Extensions → Apps Script** → **+ → Script** → name it `Sync`
→ paste `apps-script/Sync.gs`. You should end up with two files in the left
panel.

A standalone project works too — add `SPREADSHEET_ID` from the sheet's URL:
`docs.google.com/spreadsheets/d/`**`<this part>`**`/edit`.

Project Settings → Script Properties:

| Property | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` — origin only |
| `SUPABASE_SERVICE_KEY` | the **service_role** key |
| `SYNC_MINUTES` | optional, default `5`; one of 1, 5, 10, 15, 30 |
| `SPREADSHEET_ID` | only for a standalone project |
| `SHEET_NAME` | only if the tab is not `Keychains` |

`Code.gs` also needs re-pasting once, since it now mirrors each write.

### 5. Load and start

Run **`syncNow()`**. It reports:

```
{ "sheetRows": 500, "alreadyInStep": 0, "inserted": 500, "updated": 0 }
```

Run it a second time — `alreadyInStep` should be 500 and `inserted`/`updated`
both 0. If it keeps pushing every row on every pass, the two hash functions
disagree; see below.

Then **`installSync()`**, then:

```bash
bash deploy/check-database.sh
bash deploy/upload-dreamhost.sh
```

## How a change is noticed

Each row's card fields are hashed, and Postgres keeps the same digest in its
`card_hash` generated column. Rows whose hashes differ get pushed. **Nothing is
stored in the sheet to track this** — no bookkeeping column, no extra state,
because the database can simply be asked what it already has (`sync_hashes`).

`HASH_FIELDS` in `Sync.gs` and the `card_hash` expression in `db/schema.sql`
cover the same 13 fields, in the same order, joined by `\x1f` (ASCII unit
separator — it cannot appear in a pasted address, so `"ab"+"c"` can never hash
the same as `"a"+"bc"`). Both sides trim every value, and Postgres enforces that
with a BEFORE trigger.

**If you add a field to the card, add it to both, in the same position.**
Otherwise every row looks permanently changed and the sync pushes the whole
sheet on every pass.

This was checked by running the real `cardHash()` from `Sync.gs` against
Postgres on identical records, including Unicode, emoji, adjacent-field
ambiguity and padded whitespace — all six matched exactly.

## The interval, and Google's quota

Default is **5 minutes**, set by `SYNC_MINUTES`.

Not 1 minute, because Apps Script caps **trigger runtime at 90 minutes/day** on
a consumer account. 1,440 passes/day at a couple of seconds each gets close to
that ceiling and grows with the sheet; at a few thousand keychains the sync
would quietly stop.

Five minutes costs about a tenth of the quota, and responsiveness barely
changes: claims and staff edits mirror *immediately* via `Code.gs`, and a
correction typed straight into a cell is picked up by the `onEdit` trigger in
seconds. The scheduled pass is a safety net, not the main mechanism.

## Day to day

| I want to… | Do this |
| --- | --- |
| check the two agree | `syncStatus()` in Apps Script — read-only |
| force a pass now | `syncNow()` |
| check health, security and latency | `bash deploy/check-database.sh` |
| change the interval | set `SYNC_MINUTES`, re-run `installSync()` |
| add keychains | "Generate keychains" in `/admin` — mirrored immediately |
| fix a card | edit the sheet, or use `/admin` — both end up in both places |

## If something looks wrong

**A card shows old details.** Run `syncStatus()`. `databaseBehind` lists rows the
mirror has not caught up on; `syncNow()` fixes them. The sheet is always right by
definition — if the sheet is wrong, fix it there.

**Every row pushes on every pass.** The two hash functions disagree. Compare
`HASH_FIELDS` in `Sync.gs` against the `card_hash` expression in
`db/schema.sql`.

**Taps got slow again.** The database is unreachable and the app is falling back
to Apps Script — the system working as designed, just slowly. The browser console
says `[eqova] database unreachable, falling back to the sheet`. Check whether the
Supabase project has been paused for inactivity.

**The sync says "permission denied for function sync_push".** Re-run
`db/schema.sql`. Postgres grants EXECUTE to `PUBLIC` by default and
`service_role` inherited it from there, so revoking from `PUBLIC` to lock out the
anon key took it away from the sync too. The grants are explicit now.

**`syncStatus()` reports `inDatabaseOnly`.** The mirror has rows the sheet does
not. Nothing is deleted automatically — this file does not delete — so a surprise
here is worth a human look before anything is removed.

## What the anon key can reach

One function:

```
get_card
```

Not the table, in either direction. Not `claim_card`, not any `admin_*`, not the
sync functions. `deploy/check-database.sh` verifies each of those is refused
against the **live** project, because "can the browser key write to the mirror?"
is a question about production, not about a local test — and the answer changed
once during development, silently, when a `PUBLIC` grant was left in place.

`get_card` never returns `notes`, and returns no card fields at all unless the
keychain is claimed and unblocked.
