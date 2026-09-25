# CI/CD with GitHub Actions

Push to `main` → build → rsync to DreamHost → verify the live URLs.
Pull requests build only, and never touch the server.

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

## One-time setup

### 1. Create the CI key

Do not reuse the key you log in with — revoking it later would lock you out
too.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/eqova-dreamhost-ci -N "" -C "github-actions-eqova"
```

```bash
ssh-copy-id -i ~/.ssh/eqova-dreamhost-ci.pub <shell-user>@<server>.dreamhost.com
```

To revoke CI later, on the server:

```
sed -i '/github-actions-eqova/d' ~/.ssh/authorized_keys
```

### 2. Add variables and secrets

**Settings → Secrets and variables → Actions**

Variables tab — not secret; the `VITE_` ones end up in the shipped JS anyway:

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | `<server>.dreamhost.com` |
| `DEPLOY_USER` | your DreamHost shell user |
| `DEPLOY_PATH` | `tap.eqova.in` (relative to the remote home) |
| `VITE_API_BASE` | the Apps Script `/exec` URL |
| `VITE_PUBLIC_ORIGIN` | `https://tap.eqova.in` |

Secrets tab:

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the private half of the CI key |
| `DEPLOY_HOST_KEY` | `ssh-keyscan -H <server>.dreamhost.com` output |

`DEPLOY_HOST_KEY` is optional but worth setting. Without it the runner trusts
whatever answers on first connect; with it, the host is pinned.

Copy the key without mangling it:

```powershell
Get-Content "$env:USERPROFILE\.ssh\eqova-dreamhost-ci" -Raw | Set-Clipboard
```

`DEPLOY_DOCROOT` from the Lightsail setup is no longer read. Delete it.

### 3. Optional: require approval

**Settings → Environments → `production` → Required reviewers.**

Deploys then pause until someone approves — worth turning on before an event,
when an accidental merge should not reach the live site unattended.

## What the pipeline does

**Build job** (every push and PR)

1. `npm ci` and `npm run build` in `web/`, Node 20, npm cache enabled.
2. Three guards, because each failure ships a site that still returns 200:
   - `dist/.htaccess` must exist — without it every `/<code>` URL 404s, since
     none of them are files on disk.
   - `index.html` must reference `/assets/` — a wrong Vite base means the
     assets 404 and every phone gets a blank page.
   - the bundle must contain the Apps Script URL — if `VITE_API_BASE` is unset,
     `USING_MOCK` stays true and the live site serves **seeded demo data to
     real people**. This is the one worth having.
3. Uploads `dist/` as an artifact, with `include-hidden-files` so `.htaccess`
   survives the round trip.

**Deploy job** (`main` only)

4. Reports which secrets and variables actually arrived, by length. A missing
   one fails here with a readable message instead of a cryptic ssh error.
5. Writes the CI key, stripping CRs — a key pasted from Windows otherwise
   fails with only "error in libcrypto".
6. `rsync -az --delete` into the web root. `--delete` clears the previous
   build's fingerprinted assets, which would otherwise accumulate forever.
7. Verifies `/zzzzzzzzzz`, `/admin`, `/`, **and** the actual JS asset the
   served HTML references — which catches a half-copied bundle that an HTML
   check alone would miss.

The `/zzzzzzzzzz` probe is a deliberately fake code. Codes are random and
secret, so CI cannot hold a real one and does not need to: a 200 proves the
`.htaccess` fallback is serving the app, and "Keychain not recognised" is the
correct answer for a code that does not exist.

`concurrency` queues deploys rather than cancelling them; a half-finished rsync
into a live web root is worse than waiting.

## What it deliberately does not do

**Apps Script.** `Code.gs` is still published by hand: Apps Script → Deploy →
Manage deployments → edit → **New version**. Saving alone leaves the old code
serving. Automating it needs `clasp` and a Google service account — worth it
only if `Code.gs` starts changing often.

**Rollback.** There is none. The fastest recovery is to revert the commit and
push, which redeploys the previous bundle. Artifacts are kept 7 days, so a
previous run's can also be downloaded and shipped by hand.

## Local deploys still work

`deploy/upload-dreamhost.sh` does the same thing from your machine (via tar
over ssh, since Git Bash has no rsync). Keep it for
urgent fixes when you do not want to wait for a runner — but expect the next
push to `main` to overwrite whatever you pushed by hand.

## Security note

Anyone who can push to `main`, or merge a PR, can write to the web root. On
shared hosting the key has no `sudo`, so the blast radius is that directory
rather than a whole server — better than the Lightsail arrangement it replaced.

Reasonable hardening: protect `main` with a required review, and turn on the
`production` environment reviewer above.

None of this protects the data. The Apps Script `/exec` URL is baked into the
public JS bundle, and `claim` is unauthenticated by design — possession of a
keychain code is the authority. Staff actions are gated by `ADMIN_PASSWORD`.
