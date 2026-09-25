# Deploying to tap.eqova.in on DreamHost

The app moves to its own subdomain and its own host. Keychain URLs get shorter:

```
before   https://eqova.in/d/k7mq2xdv9p     (Lightsail, sharing with WordPress)
after    https://tap.eqova.in/k7mq2xdv9p   (DreamHost, own domain)
```

Nothing but the frontend moves. The data layer is still the Apps Script web
app, hosted by Google — there is no backend to deploy.

## 1. Create the site in DreamHost

**Panel → Websites → Manage Websites → Add Website.**

- Domain: `tap.eqova.in`
- Hosting: the shared plan on your account
- Web directory: accept the default, `/home/<user>/tap.eqova.in`
- Leave "Remove WWW" / "Add WWW" alone — a subdomain needs neither
- PHP: irrelevant here, the site is static

Note two things from the panel, you need both later:

| | Where |
| --- | --- |
| **Shell user** | Panel → Websites → Manage Websites, or Users → SFTP Users |
| **Server hostname** | e.g. `iad1-shared-e1-05.dreamhost.com`, on the same page |

Make sure the user is a **Shell user**, not SFTP-only — rsync needs SSH.

## 2. Point DNS at DreamHost

`eqova.in` runs on AWS nameservers, so the record goes in **AWS**, not
DreamHost. Find the hosting IP in the DreamHost panel (Manage Websites shows
it), then in your Route 53 / Lightsail DNS zone for `eqova.in`:

| Type | Name | Value |
| --- | --- | --- |
| A | `tap` | the DreamHost IPv4 address |

### The wildcard, and why one A record is enough

`eqova.in` currently has a **wildcard AAAA record**. You can verify it:
`zzrandom9xq.eqova.in` resolves to the same IPv6 as `tap.eqova.in` does today.
Nothing specific to `tap` exists yet.

That looks like a problem — IPv6-capable phones, which is most Indian mobile
networks, would still be sent to AWS. It is not, and the reason is worth
knowing: **a wildcard only applies to a name that has no records at all.** The
moment `tap.eqova.in` has an A record, the name exists, and an AAAA query for
it returns "no data" rather than the wildcard. IPv6 clients then fall back to
IPv4 and reach DreamHost.

So a single A record is sufficient — but verify it rather than assuming:

```bash
nslookup -type=AAAA tap.eqova.in 8.8.8.8
```

You want **no address** back. If it still returns the AWS IPv6, the wildcard is
still winning and you need an explicit AAAA for `tap` pointing at DreamHost's
IPv6 instead.

DNS takes a few minutes to an hour to propagate.

## 3. Turn on HTTPS

**Panel → Websites → Secure Hosting → Add**, pick the free Let's Encrypt
certificate for `tap.eqova.in`.

It will not issue until DNS resolves to DreamHost, so do step 2 first. NFC taps
open in the phone's browser, and plain HTTP shows a "Not secure" warning to
whoever is holding the keychain.

## 4. Set up SSH keys

On your machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/eqova-dreamhost -N ""
```

```bash
ssh-copy-id -i ~/.ssh/eqova-dreamhost.pub <shell-user>@<server>.dreamhost.com
```

Check it works:

```bash
ssh -i ~/.ssh/eqova-dreamhost <shell-user>@<server>.dreamhost.com "pwd && ls -d tap.eqova.in"
```

## 5. Deploy

Create `deploy/dreamhost.env` (gitignored):

```
DH_USER=your-shell-user
DH_HOST=iad1-shared-e1-05.dreamhost.com
DH_PATH=tap.eqova.in
```

Then, from Git Bash:

```bash
bash deploy/upload-dreamhost.sh
```

It builds, refuses to ship a broken bundle, rsyncs, and verifies the live URLs.

The four checks it refuses on, each of which ships a site that still returns
HTTP 200:

- `dist/.htaccess` missing → every `/<code>` URL 404s
- `index.html` not referencing `/assets/` → blank white page
- no Apps Script URL in the bundle → **demo data served to real people**
- no `dist/index.html` → nothing to serve

`--delete` clears the previous build's fingerprinted assets, which would
otherwise accumulate forever. Safe here: the web root holds only the build,
and DreamHost keeps logs outside it.

## 6. How `/<code>` works without a server

`web/public/.htaccess` ships inside every build. Its core is:

```apache
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [L]
```

Keychain codes are paths at the domain root and none of them exist on disk, so
without this Apache 404s before React loads. Real files and directories are
served normally, which is what keeps `/assets/...` working.

It lives in `public/` rather than on the server on purpose: `rsync --delete`
would wipe a server-only `.htaccess` on the first deploy that ran without it.

## 7. CI/CD

Update the repository variables — **Settings → Secrets and variables → Actions**:

| Variable | Value |
| --- | --- |
| `DEPLOY_HOST` | `<server>.dreamhost.com` |
| `DEPLOY_USER` | your shell user |
| `DEPLOY_PATH` | `tap.eqova.in` |
| `VITE_PUBLIC_ORIGIN` | `https://tap.eqova.in` |
| `VITE_API_BASE` | unchanged |

`DEPLOY_DOCROOT` is gone — rename it to `DEPLOY_PATH` or add the new one and
delete the old.

Secret `DEPLOY_SSH_KEY` becomes the **DreamHost** key:

```powershell
Get-Content "$env:USERPROFILE\.ssh\eqova-dreamhost" -Raw | Set-Clipboard
```

And `DEPLOY_HOST_KEY`:

```bash
ssh-keyscan -H <server>.dreamhost.com
```

## 8. Regenerate the QR codes

**The existing batch encodes `eqova.in/d/<code>` and is now wrong.** Nothing has
been printed, so this costs nothing today — it would be expensive later.

```bash
cd tools && node generate-batch.js
```

The origin comes from `web/.env`, so it picks up `tap.eqova.in` automatically.
Check a sample decodes to the short URL before sending anything to a printer.

## 9. Retire the Lightsail deployment

Once `tap.eqova.in` is confirmed working on a real phone:

```bash
bash deploy/install-routing.sh ~/Downloads/LightsailDefaultKey-ap-south-1.pem --uninstall
```

That removes the `/d/` and `/admin` rules from the WordPress vhost, leaving
`eqova.in` purely as the WordPress site. It backs the vhost up first and rolls
back automatically if `configtest` fails.

Then delete the old app directory:

```
rm -rf /opt/bitnami/wordpress/keychain-app
```

Do this **last**. While it is still there, you have a working fallback.

## Verify before printing

From a real phone, on mobile data:

- `https://tap.eqova.in/<a real unclaimed code>` → the setup form
- `https://tap.eqova.in/<a claimed code>` → that card
- `https://tap.eqova.in/admin` → the dashboard
- `https://tap.eqova.in/zzzzzzzzzz` → "Keychain not recognised", **not** a 404

That last one is the important one: a 404 there means `.htaccess` is not being
applied, and every keychain would fail the same way.
