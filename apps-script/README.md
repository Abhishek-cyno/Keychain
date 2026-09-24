# Apps Script API

`Code.gs` is the whole backend. It sits between the React app and the Google
Sheet so the sheet is never exposed to a browser.

## Setup

1. Create a Google Sheet named **Eqova Keychains**.
2. **Extensions → Apps Script**, delete the placeholder, paste in `Code.gs`.
3. **Project Settings → Script Properties**:

   | Property | Required | Value |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | yes | a long random string; gates every staff action |

4. Run `setup()` once from the editor. Authorise it when prompted. It is
   idempotent — it adds the `Slug` column if missing, gives a code to every row
   that lacks one, and seeds rows up to 500.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the `/exec` URL into `web/.env` as `VITE_API_BASE`.

> After **every** edit to `Code.gs`: Deploy → Manage deployments → edit → New
> version → Deploy. Saving alone does not update the live `/exec` URL. This is
> the single most common reason a change "did not work".

## Sheet columns

`ID · Name · ~~Specialization~~ · Organization · Designation · Phone · Email ·
~~Bio~~ · ~~LinkedIn~~ · Website · ~~Links~~ · Status · Notes · CreatedAt ·
UpdatedAt · Slug · Title · Mobile · Address · Remarks`

Column order is positional, so entries are only ever appended. The struck-out
columns are retired — no longer written or returned — but stay in place so the
columns after them do not move, and so previously captured data is not
destroyed. Delete them by hand whenever you decide the old values are not
wanted. `Organization` is the column previously headed `Hospital`; only the
label changed, so existing values carried over untouched.

A card is made of ten fields: **Title, Name, Designation, Organization, Email,
Mobile, Phone, Website, Address, Remarks**. Only Name is required.

`ID` is the number printed on the keychain. `Slug` is the code in its URL and
the only way to reach it. `Notes` is staff-only: a public claim can never write
it, and it is never returned by the profile endpoint.

Do not renumber `ID`s or rewrite `Slug`s by hand — both are printed on physical
objects.

## Endpoints

All responses are `{ "ok": true, "data": … }` or
`{ "ok": false, "error": "…", "code": "…" }`.

### Public

```
GET  ?action=profile&slug=k7mq2xdv9p
POST { "action": "claim", "slug": "k7mq2xdv9p", "doctor": {…} }
```

`profile` returns one of three shapes: a card, `claimable: true` (the set-up
form), or a blocked/unknown state. There is **no numeric lookup** — `/d/1` must
not work, or the random code buys nothing.

`claim` needs no password: holding the keychain is the authority. It takes a
lock, re-reads the row, and refuses with `ALREADY_CLAIMED` if it is taken.
Field lengths are capped so a claim cannot stuff the sheet.

### Staff read, open

```
GET  ?action=stats
GET  ?action=list&q=&status=&limit=50&offset=0
```

`list` returns only id, code, status, title, name, designation and organisation.
Email, mobile, phone, address, remarks and notes are deliberately left out: the
dashboard is not password-gated, so it must not be a directory of everyone's
contact details.

### Staff, password required

```
GET  ?action=verifyPassword&password=…
GET  ?action=keychain&id=127&password=…

POST { "action": "update",    "id": 127, "doctor": {…}, "password": "…" }
POST { "action": "setStatus", "id": 127, "status": "BLOCKED", "password": "…" }
POST { "action": "release",   "id": 127, "password": "…" }
POST { "action": "seed",      "count": 500, "password": "…" }
```

`release` erases a card **and issues a new code**, retiring the printed link. It
is the escape hatch for a claim made in error, not a routine action.

POSTs are sent as `text/plain` on purpose. Apps Script web apps do not answer
CORS preflights, so an `application/json` body would fail in the browser.

## Codes

10 characters from `23456789abcdefghjkmnpqrstuvwxyz` — no `0/o`, `1/l/i`, since
these get read off a screen during support. About 8×10¹⁴ combinations.

Generated from `Utilities.getUuid()`, not `Math.random()`. `Math.random()` in V8
is a seeded PRNG whose future output can be derived from past values, so someone
holding a handful of keychains could predict the codes on others.

## Limits to know

- Apps Script allows roughly 20,000 URL fetches and 90 minutes of runtime per
  day on a consumer account. Hundreds of claims is far inside that; a card
  going viral is the case to watch, which is what the cache is for.
- Public profile reads are cached 60s, but only 5s while unclaimed — so a claim
  shows up on the next tap rather than a minute later.
- There is no rate limit on `claim`. The code's unguessability is the only
  protection, which is adequate as long as unclaimed links are never published.
