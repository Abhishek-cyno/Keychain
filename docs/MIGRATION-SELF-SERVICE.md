# Migrating to self-service claiming

What changed, and the order to apply it in. Every step is needed — doing the
frontend before the backend leaves `/d/<code>` resolving to nothing.

## What changed

| Before | Now |
| --- | --- |
| `eqova.in/d/127` | `eqova.in/d/k7mq2xdv9p` — a random code |
| Staff assign a keychain at the desk | The holder taps it and fills the form themselves |
| Admin has an **Assign** button | Removed. Cards are only created by tapping |
| Admin edits freely | **Edit, block, reset and seed need a password** |
| Admin list shows phone and email | List shows no contact details at all |

The sequential number still exists. It is printed on the keychain and is what
the ops team searches by — but it is no longer a URL. `/d/1` resolves to
nothing, deliberately: if it worked, the random code would buy nothing.

## Order of operations

### 1. Set the password

Apps Script → **Project Settings → Script Properties**:

| Property | Value |
| --- | --- |
| `ADMIN_PASSWORD` | a long random string |

Without it, every staff action fails with `NOT_CONFIGURED`.

### 2. Update and re-deploy the backend

Paste the new `apps-script/Code.gs`, then **Deploy → Manage deployments → edit
→ New version**. Saving alone leaves the old code serving.

### 3. Run `setup()` once

From the Apps Script editor. It is idempotent and is also the migration:

- appends the **Slug** column if the sheet does not have one
- generates a code for every row that lacks one, leaving existing codes alone
- seeds any missing rows up to 500

Existing cards keep their data; they simply gain a code.

`Slug` is appended as the **last** column on purpose. Inserting it next to `ID`
would shift every existing value one column sideways.

### 4. Update the Apache rewrite

The live rule only matches digits, so `/d/k7mq2xdv9p` would fall through to
WordPress:

```bash
bash deploy/install-routing.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem --uninstall
bash deploy/install-routing.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
```

The new rule is `^/d/[A-Za-z0-9]{4,32}/?$`. Both commands take a backup and roll
back automatically if `configtest` fails.

### 5. Deploy the frontend

```bash
bash deploy/upload.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
```

Or just push to `main` and let CI do it.

### 6. Re-generate the QR codes

**The codes did not exist when the earlier batch was generated**, so anything
already produced points at dead `/d/1` URLs. Nothing has been printed yet, so
this costs nothing now — it would be expensive later.

```bash
cd tools
node generate-batch.js --api "<your /exec URL>" --origin https://eqova.in
```

The tool now reads codes from the API rather than inventing them. Inventing
them locally would produce QR codes that resolve to nothing.

### 7. Check before printing

```bash
curl -sL "<exec-url>?action=list&limit=3"
```

Every row must have a non-empty `slug`. Then open one real code on a phone: an
unclaimed one should show the setup form, and a claimed one the card.

## Field set change

The card is now ten fields: **Title, Name, Designation, Organization, Email,
Mobile, Phone, Website, Address, Remarks**. Only Name is required.

Specialization, Bio, LinkedIn and Other-links are gone. Their columns stay in
the sheet so the columns after them do not shift and the values already
captured are not destroyed — the API simply no longer writes or returns them.
Delete them by hand whenever you want the old values gone. `Organization` is
the column previously headed `Hospital`; only the label changed.

Applying it is the same two steps as any backend change:

1. Paste the new `Code.gs` and **Deploy → Manage deployments → edit → New
   version**.
2. Run **`setup()`** once. It rewrites the header row, which is what adds
   `Title`, `Mobile`, `Address` and `Remarks` and relabels `Hospital`.

Skipping step 2 leaves the sheet four columns short, and every claim silently
drops those four values.

## What the holder sees

```
tap unclaimed keychain  →  "Set up your digital card" form
       ↓ submit
       "Your card is live"
       ↓
tap the same keychain   →  their card, from then on
```

They cannot edit it afterwards; the form says so before they submit. Corrections
go through staff, which is why Edit is password-gated rather than removed.

## Mistakes and how to undo them

**Someone claimed the wrong keychain.** Admin → find it → **Reset**. This erases
the card *and issues a new code*, so the printed link stops working. Only do it
for a keychain you can re-label or scrap — the warning dialog says the same.

**Someone wants a detail changed.** Admin → **Edit** (password) → save.

**A keychain is lost.** Admin → **Block**. The URL then shows "currently
unavailable" rather than that person's contact details.

## Things worth knowing

**The code is the credential.** Anyone holding the link can claim an unclaimed
keychain — that is the design. Codes are 10 characters from a 31-character
alphabet (~8×10¹⁴ combinations) and come from `Utilities.getUuid()`, not
`Math.random()`, whose output is predictable from earlier values.

**Don't publish unclaimed links.** A code in a public spreadsheet, email thread
or screenshot is a keychain anyone can claim.

**The dashboard is still open.** `/admin` needs no password to *view*. It no
longer shows contact details, but it does list names, organisations and codes. If
you want the whole panel behind the password, say so — it is a small change.
