# CI/CD with GitHub Actions

Push to `main` → build → deploy to Lightsail → verify the live URLs.
Pull requests build only, and never touch the server.

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

## One-time setup

### 1. Create the CI key

Do not put your personal Lightsail key into GitHub. It is the key you log in
with, so revoking it later would lock you out too.

```bash
bash deploy/setup-ci-key.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
```

This generates a dedicated `ed25519` key, installs the public half in the
server's `authorized_keys`, tests it, and prints exactly what to paste into
GitHub. That output contains a private key — do not paste the terminal log
anywhere.

To revoke CI later, on the server:

```
sed -i '/github-actions-eqova/d' ~/.ssh/authorized_keys
```

### 2. Push to GitHub

```bash
git remote add origin https://github.com/<you>/eqova-keychain.git
git push -u origin main
```

### 3. Add variables and secrets

**Settings → Secrets and variables → Actions**

Variables tab — these are not secret, they end up in the shipped JS anyway:

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | `13.202.18.203` |
| `DEPLOY_USER` | `bitnami` |
| `DEPLOY_DOCROOT` | `/opt/bitnami/wordpress` |
| `VITE_API_BASE` | the Apps Script `/exec` URL |
| `VITE_PUBLIC_ORIGIN` | `https://eqova.in` |

Secrets tab:

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the private key printed by the setup script |
| `DEPLOY_HOST_KEY` | the `ssh-keyscan` output it printed |

`DEPLOY_HOST_KEY` is optional but worth setting. Without it the runner trusts
whatever answers on first connect; with it, the host is pinned.

### 4. Optional: require approval

**Settings → Environments → `production` → Required reviewers.**

Deploys then pause until someone approves. Worth turning on before the event,
when an accidental merge should not reach the live site unattended.

## What the pipeline does

**Build job** (every push and PR)

1. `npm ci` and `npm run build` in `web/`, Node 20, npm cache enabled.
2. Two guards, because both failures ship a broken site that still returns 200:
   - `dist/index.html` must reference `/keychain-app/` — a wrong Vite base means
     the assets 404 under WordPress and every phone gets a blank page.
   - the bundle must contain the Apps Script URL — if `VITE_API_BASE` is unset,
     `USING_MOCK` stays true and the live site would serve **seeded demo
     doctors out of localStorage**. This is the one worth having.
3. Uploads `dist/` as an artifact.

**Deploy job** (`main` only)

4. Writes the CI key, pins the host key.
5. `scp` to `/tmp`, then wipes `keychain-app/` and copies in. Wiping matters:
   Vite fingerprints filenames, so old builds accumulate forever otherwise.
6. `chown daemon:daemon`.
7. Verifies `https://eqova.in/d/1`, `/admin`, `https://www.eqova.in/`, **and**
   the actual JS asset the served HTML references — which catches a
   half-copied bundle that the HTML check alone would miss.

`concurrency` queues deploys rather than cancelling them; a half-finished copy
into a live docroot is worse than waiting.

## What it deliberately does not do

**Apache config.** [`deploy/install-routing.sh`](../deploy/install-routing.sh)
stays manual. It edits the vhost of a live WordPress site, and that is not
something to run automatically on every merge.

**Apps Script.** `Code.gs` still has to be published by hand: Apps Script →
Deploy → Manage deployments → edit → **New version**. Saving alone leaves the
old code serving. Automating this needs `clasp` and a Google service account —
worth it only if `Code.gs` starts changing often.

**Rollback.** There is none yet. The fastest recovery is to revert the commit
and push, which redeploys the previous bundle. Build artifacts are kept 7 days,
so a previous run's artifact can also be re-downloaded and shipped by hand.

## Local deploys still work

The pipeline and `deploy/upload.sh` do the same thing. Keep the script for
urgent fixes when you do not want to wait for a runner — but expect the next
push to `main` to overwrite whatever you pushed by hand.

## Security note

The CI key can `sudo` on a box that also runs your production WordPress site.
Anyone who can push to `main`, or merge a PR, can therefore run commands there.

Reasonable hardening, in rough order of value:

1. Protect `main` — require a PR and a review.
2. Turn on the `production` environment reviewer above.
3. Give CI a dedicated user with a sudoers rule limited to the copy commands,
   instead of the general-purpose `bitnami` account.

Note that none of this protects the data. The Apps Script `/exec` URL is baked
into the public JS bundle and `doPost` has no authentication, so anyone who
reads the bundle can call `assign`, `update`, `setStatus` or `seed` directly.
Securing the pipeline does not address that; see the note in the README.
