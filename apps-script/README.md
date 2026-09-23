# Apps Script API

`Code.gs` is the whole backend. It sits between the React app and the Google
Sheet so the sheet is never exposed to a browser.

## Setup

1. Create a Google Sheet named **Eqova Keychains**.
2. **Extensions → Apps Script**, delete the placeholder, paste in `Code.gs`.
3. Run `setup()` once from the editor. It creates the `Keychains` sheet, writes
   the header row and seeds IDs 1–500. Authorise the script when prompted.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` URL into `web/.env` as `VITE_API_BASE`.

> After **every** edit to `Code.gs`: Deploy → Manage deployments → edit → New
> version → Deploy. Saving alone does not update the live `/exec` URL. This is
> the single most common reason a change "did not work".

## Sheet columns

`ID · Name · Specialization · Hospital · Designation · Phone · Email ·
Bio · LinkedIn · Website · Links · Status · Notes · CreatedAt · UpdatedAt`

`ID` is the physical keychain number and must stay unique. `Links` holds JSON
(`[{"label":"X","url":"…"}]`). `Notes` is internal and never leaves the API.

Rows may be sorted or edited by hand — lookups fall back to a scan when a row is
not where it is expected. Do not renumber `ID`s: those numbers are printed on
physical objects.

## Endpoints

All responses are `{ "ok": true, "data": … }` or
`{ "ok": false, "error": "…", "code": "…" }`.

### Public

```
GET  ?action=profile&id=127
```

Returns only publishable fields, and only when the keychain is assigned and not
blocked. `Notes`, `CreatedAt` and `UpdatedAt` are never included. Cached for 60
seconds; any write to that ID clears the entry immediately.

### Admin — no auth, open to anyone with the URL

```
GET  ?action=stats
GET  ?action=list&q=&status=&limit=50&offset=0
GET  ?action=keychain&id=127
```

```
POST { "action": "assign",    "id": 127, "doctor": {…}, "expectedStatus": "AVAILABLE" }
POST { "action": "update",    "id": 127, "doctor": {…} }
POST { "action": "setStatus", "id": 127, "status": "BLOCKED" }
POST { "action": "seed",      "count": 500 }
```

POSTs are sent as `text/plain` on purpose. Apps Script web apps do not answer
CORS preflights, so an `application/json` body would fail in the browser.

## Duplicate assignment

`assign` takes a script lock, re-reads the row, and refuses with code `CONFLICT`
unless the status is still `AVAILABLE` and no name is set. Two staff members
racing on keychain 127 means the second one is told the keychain was just taken
and nothing is overwritten — the reason the check lives here and not in the UI.

## Limits to know

- Apps Script allows roughly 20,000 URL fetches and 90 minutes of runtime per
  day on a consumer account. An event registering a few hundred doctors is far
  inside that; a public profile going viral is the case to watch, which is what
  the 60-second cache is for.
- There is no authentication on the admin endpoints. Anyone who has the
  `/exec` URL can read and edit every keychain. Acceptable only because the
  URL itself is not published; do not link to it from anything public.
