# Deploying to eqova.in

Status: **live**. `https://eqova.in/d/<code>` and `/admin` serve the React app;
the WordPress site at `www.eqova.in` is untouched.

## What actually needs deploying

Only the frontend. There is no backend to deploy — the data layer is a Google
Apps Script web app and Google hosts it.

```
eqova.in/d/<code>  →  static React bundle (this repo)  →  Apps Script  →  Google Sheet
   you deploy this ↑                    already deployed, hosted by Google ↑
```

## The server, as confirmed

| | |
| --- | --- |
| Host | `13.202.18.203`, Lightsail, ap-south-1 |
| OS | Debian 12, SSH user `bitnami`, **public-key auth only** |
| Stack | **Bitnami WordPress**, Apache 2.4 |
| Docroot | `/opt/bitnami/wordpress` |
| App dir | `/opt/bitnami/wordpress/keychain-app` |
| Vhost | `/opt/bitnami/apache/conf/vhosts/wordpress-https-vhost.conf` |
| `AllowOverride` | **None** — `.htaccess` is ignored, rules must live in the vhost |
| Other sites | `medicon.eqova.in` → `/var/www/medicon` (separate vhost, untouched) |
| DNS / TLS | already done — AWS nameservers, Let's Encrypt cert in place |

`nginx-eqova.conf` and `htaccess-keychain.txt` in this folder do **not** apply
to this server. They are kept for a future dedicated host or a server where
`.htaccess` is enabled.

## Run everything from Git Bash

Not PowerShell, not WSL. Git Bash maps `D:\` to `/d/`, ships the `ssh`/`scp`
the scripts need, and presents the `.pem` with permissions OpenSSH accepts.

Start menu → **Git Bash**, or right-click in `D:\eqova-keychain` → *Open Git
Bash here*.

| Git Bash | PowerShell |
| --- | --- |
| `a && b` | `a; b` |
| `/d/eqova-keychain` | `D:\eqova-keychain` |
| `~/Downloads/k.pem` | `$env:USERPROFILE\Downloads\k.pem` |

## 1. Build and upload

`web/.env` must hold both values before building — Vite bakes them in, so a
wrong value means a rebuild, not a config edit:

```
VITE_API_BASE=https://script.google.com/macros/s/AKfy.../exec
VITE_PUBLIC_ORIGIN=https://eqova.in
```

`VITE_PUBLIC_ORIGIN` matters because the app is served from `www.eqova.in`.
Without it the admin's "Copy link" would hand staff `www.eqova.in/d/<code>` while
the keychains read `eqova.in/d/<code>`.

```bash
bash deploy/upload.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
```

Builds, ships, installs to `keychain-app/`, sets `daemon:daemon`, and wipes the
previous bundle first so Vite's fingerprinted assets cannot accumulate. It
refuses to upload a build that does not reference `/keychain-app/`.

**This is the only command needed for every future frontend change.**

## 2. Routing — one time only, already done

```bash
bash deploy/install-routing.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem
```

Inserts [`vhost-block.conf`](vhost-block.conf) into the live vhost, directly
after the non-www redirect and before WordPress's `<Directory>` block. Vhost
rules run during URL translation, ahead of the per-directory WordPress rules,
so `/d/<code>` is claimed before WordPress's catch-all can guess it into a
permalink.

Safety, in order: refuses if already installed; refuses unless the anchor line
appears exactly once; timestamped backup to `/home/bitnami/`; `apachectl
configtest`; **automatic rollback and no restart if configtest fails**; waits
for Apache to accept connections; then verifies.

To undo:

```bash
bash deploy/install-routing.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem --uninstall
```

## 3. Verify

`curl` from a sandboxed shell may not reach `eqova.in`. Check from the machine
or phone that matters:

```bash
curl -sIL https://eqova.in/d/zzzzzzzzzz
```

A well-formed but fake code is fine here: a 200 proves Apache hands /d/<code>
to the app. Expect `301` → `www.eqova.in/...` → `200 text/html` — **not**
`/demo-page/`. Then confirm `https://www.eqova.in/` still serves WordPress.

Note the page title is `Eqova` in a raw `curl`: the doctor's name is set by
JavaScript after the profile loads, so only a real browser shows it.

## 4. Keychain artwork

Only once step 3 passes — printing is irreversible:

```bash
cd tools && npm install && node generate-batch.js --api "<your /exec URL>" --origin https://eqova.in
```

## Redeploying

| Changed | Do this |
| --- | --- |
| Anything in `web/` | `bash deploy/upload.sh <key.pem>` |
| `web/.env` | same — env values are baked in at build time |
| `apps-script/Code.gs` | Apps Script → Deploy → Manage deployments → edit → **New version** |

Saving `Code.gs` without publishing a new version leaves the old code serving
the `/exec` URL. It is the usual reason a change appears to do nothing.

## Known issues on this server

Pre-existing in the WordPress install, unrelated to the keychain app, but
visible in `/opt/bitnami/apache/logs/error_log`:

- `WP_Error::set_url_params()` fatal in the REST API — a plugin/core version
  mismatch, firing on REST batch requests.
- Wordfence cannot write `wp-content/wflogs/geoip.mmdb`.

Worth fixing separately; neither affects `/d/<code>` or `/admin`, which never
touch PHP.

## Staff access

Editing, blocking, resetting and seeding all require `ADMIN_PASSWORD`, set in
the Apps Script **Script Properties**. The API enforces it, so it cannot be
bypassed by calling the endpoint directly.

Viewing the dashboard does not need the password. It lists numbers, codes,
names and organisations — but no phone, email, address or notes; those come from a
password-gated endpoint. If you want the whole panel behind the password too,
that is a small change.

Rotate the password after an event by editing the Script Property. No redeploy
is needed.

## Codes are secrets

An unclaimed keychain's URL is a claim link: whoever opens it can set the card
up. Do not paste unclaimed links into email, chat or screenshots, and keep
`tools/out/keychains.csv` with the same care as the keychains themselves.
