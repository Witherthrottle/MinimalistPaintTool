# Deploying to Hostinger

The app is static files, so any web host can serve it. Uploading logs needs one PHP endpoint, which
Hostinger's regular plans run with no extra setup. You don't need Docker or a database.

```
public_html/                 ← your domain (or a subdomain / subfolder)
  index.html, css/, js/      ← the app
  api/
    collect.php              ← receives logs from participants' browsers
    admin.php                ← researcher page for downloading data
    config.php               ← your secrets (made from config.sample.php)
    .htaccess                ← blocks direct access to config files
study-data/                  ← created automatically, OUTSIDE public_html
  <sessionId>/meta.json, events.ndjson, questionnaires.json, artifact_*.json
```

## Quick path: deploy with git over SSH

The repo can be served directly from `public_html`. The root `.htaccess` hides `.git`, `tools/` and the
docs, and the PHP endpoint lives at `/server/collect.php`. Two files exist only on the server and are
git-ignored, so `git pull` never touches them: `server/config.php` and `js/config.local.js`.

```bash
cd ~/domains/<domain>/public_html
git init -b main && git remote add origin https://github.com/<you>/MinimalistPaintTool.git
git fetch origin && git checkout -f -B main origin/main     # first time (folder isn't empty)
cp server/config.sample.php server/config.php && nano server/config.php
cat > js/config.local.js <<'EOF'
Object.assign(window.MP.CONFIG, { uploadUrl: 'https://<domain>/server/collect.php', uploadToken: '<upload token>' });
EOF
```

Later updates: `git pull`.

**Participant accounts.** When an upload URL is set, the app opens with a sign-in screen. New participants
register with a code (e.g. P07), a PIN and their profile. All 12 Phase 1 tasks then appear as blocks
under the menu bar; each task's canvas and active time are saved by `server/api.php` (autosave every 30 s,
plus on Done, switching tasks and logging out), so people can stop and continue later on any computer.
Accounts live in `study-data/participants/<code>/`. The admin page lists every participant's progress and
can reset a forgotten PIN. With no upload URL, accounts are kept in the browser instead (single lab
machine). Set `accounts: false` in `js/config.js` to go back to the old one-session setup screen. Bump the `?v=` numbers in `index.html` before you push, so browsers reload.
Admin page: `https://<domain>/server/admin.php`.

The manual route below does the same thing, with the endpoint under `api/` instead.

## 1. Make two random strings

You need an **upload token** (the app sends it with every upload) and an **admin password** (to download
data). Generate them locally, for example:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24)); print(secrets.token_urlsafe(24))"
```

The upload token ends up in the browser's JavaScript, so anyone determined can read it. It only keeps out
random junk. The admin password must stay private.

## 2. Configure the server files

1. Copy `server/config.sample.php` to `server/config.php`.
2. Set `upload_token` and `admin_password` to the strings from step 1.
3. Leave `data_dir` as is if you'll put the files at `public_html/api/`. It then resolves to
   `/home/<user>/domains/<domain>/study-data`, outside the public web root.
4. Leave `allowed_origins` empty if the app and the API are on the same domain. If the app is
   hosted elsewhere (e.g. GitHub Pages), list that origin: `['https://you.github.io']`.

## 3. Point the app at the endpoint

Edit `js/config.js`:

```js
window.MP.CONFIG = {
  uploadUrl: 'https://yourdomain.com/api/collect.php',
  uploadToken: '<same upload token as config.php>',
  uploadIntervalMs: 10000,
};
```

Then bump the version tag in `index.html` (`?v=7` → `?v=8` on every script and stylesheet line), so
returning browsers fetch the new files instead of cached ones. Do this every time you deploy changes.

## 4. Upload

In hPanel → **Files → File Manager** (or over FTP/SFTP):

1. Upload `index.html`, `css/` and `js/` into `public_html/`.
2. Create `public_html/api/` and upload `server/collect.php`, `server/admin.php`, your `server/config.php`
   and `server/.htaccess` into it.
3. Don't upload `tools/`, `server/config.sample.php` or `DEPLOY.md`. They aren't needed on the server.

Make sure the site uses HTTPS (hPanel → Security → SSL). Browsers block uploads from an HTTPS page to an
HTTP endpoint.

## 5. Check it works

1. Open `https://yourdomain.com/`, then go to **Study → Researcher settings → Test connection**. You should
   see "Connected — server can write data."
   - **"bad token"**: the tokens in `js/config.js` and `config.php` don't match.
   - **"data_dir is not writable" / "cannot create data_dir"**: create the `study-data` folder yourself next to
     `public_html` in File Manager (permissions 750 or 755). If the host won't allow folders outside
     `public_html`, set `data_dir` to `__DIR__ . '/../study-data'`, create that folder inside
     `public_html`, and copy `server/data-dir.htaccess` into it renamed to `.htaccess`, so nobody can browse
     the data.
   - **"Failed: Failed to fetch"**: wrong URL, mixed HTTP/HTTPS, or (cross-origin) the app's origin is
     missing from `allowed_origins`.
2. Run a short practice session, then open `https://yourdomain.com/api/admin.php`, sign in, and confirm the
   session appears with its events count.

## How uploading behaves

- Events are batched: every 10 s the browser sends only what the server doesn't have yet, plus an
  immediate upload after each task, each questionnaire and at session end. When the tab is hidden or
  closed, a small `sendBeacon` sends the remainder.
- Each request says which event index it starts at, and the server replies with how many it holds. So
  retries, dropped connections and reloads never duplicate or lose events.
- The browser's own copy (IndexedDB) remains the backup. If a participant was offline, open
  **File → Stored sessions** on that machine and press **Upload** (or **Upload all**).
- The status bar shows `uploaded`, `N to upload`, or `upload failed, retrying` (hover for the error).

## Getting the data

`admin.php` → **Download all (JSON)** gives one file in the app's export format. Use it:

- in the app: Researcher settings → *Import pooled sessions* (fits the generic Markov counts and trains the
  GRU), or
- offline: `node tools/train-gru.js gru.json all_sessions_*.json`, then *Load GRU weights…*.

"incl. canvas images" adds the end-of-task PNG snapshots (larger file).

For a backup, download the `study-data/` folder from File Manager. Each session is a plain folder
of JSON files.

## Alternatives

- **GitHub Pages for the app:** works. Push `index.html`, `css/`, `js/`, keep the `api/` part on Hostinger,
  and add `https://<you>.github.io` to `allowed_origins`.
- **Hetzner + Docker:** not needed. Any PHP-capable web server works the same way. The endpoint uses
  no extensions beyond core PHP 7.4+.
