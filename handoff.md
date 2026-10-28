# Handoff: Dishari survey app → web admin

Hello! This folder holds the finished survey app for **Dishari Agomoni 2026**. It has been built and tested on a laptop and now needs to go live on Dishari's web server. This file is your checklist. [`README.md`](README.md) has the full technical reference, and this file points to it where useful.

**Version 3 (October 2026).** The survey has 7 questions: 5 multiple choice, 1 with four labelled text boxes, and 1 open text box. If you received an earlier package, discard it and use this one. If you already set up an earlier version on the server, reset the database before going live (the reset steps are in step 7) so the new questions are seeded.

**What it is:** a small Node.js app (Express + SQLite). There's no database server and no build step. Participants open a personal one-time link such as `https://www.survey.dishariboston.org/K7M2QX9P`, and organisers sign in at `/admin` with their Google account. Everything lives in one SQLite file, `data/survey.db`.

**What the server needs:**
- Linux with **Node.js 20 or newer**, running the app as a background service (systemd or pm2).
- **nginx** (or Apache) to reverse-proxy a subdomain to `127.0.0.1:3000`, with HTTPS from Let's Encrypt.
- **Google sign-in in front of `/admin`**: the provided config uses [oauth2-proxy](https://oauth2-proxy.github.io) and a Google OAuth client (step 4).
- `sqlite3` (the command-line tool) for nightly backups.
- `build-essential` and `python3`, because two packages compile native code during `npm ci`.

---

## 1. Before you start: things to confirm

| Item | Who decides | Default in this package |
|---|---|---|
| Subdomain for the survey | Dishari + you | `www.survey.dishariboston.org` |
| Legal details for the Terms and Privacy pages (see step 5) | Dishari committee | Complete |
| Time zone for timestamps in reports | Dishari | `America/New_York` |
| Where backups are copied off the server | You | — |
| Which Google accounts may open `/admin` | Dishari (sent to you separately) | Placeholder addresses |

---

## 2. Copy the app to the server

Copy this folder to the server, e.g. `/srv/dishari-survey`, **without** these:

- `node_modules/` (reinstall on the server)
- `data/`: this is the organiser's **local test database**, with their test login and a test response. **Don't copy it.** The server starts with a fresh, empty database, so no test data or test logins carry over.
- `backups/`, if present

The folder must sit **outside nginx's web root**, so `data/` can never be downloaded.

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin dishari
sudo mkdir -p /srv/dishari-survey && sudo chown dishari:dishari /srv/dishari-survey
# …copy the files in, then:
cd /srv/dishari-survey
sudo apt install -y build-essential python3 sqlite3
sudo -u dishari npm ci --omit=dev
sudo -u dishari mkdir -p data backups && sudo chmod 700 data backups
```

---

## 3. The website name: `www.survey.dishariboston.org`

On the laptop the app ran at `http://localhost:3000`. On the server it must know its public address, because that address is written into **every participant link** in the codes CSV used for the mail merge (e.g. `https://www.survey.dishariboston.org/K7M2QX9P`).

**This is already set** to `https://www.survey.dishariboston.org` in the deploy files:
- `deploy/dishari-survey.service`: `Environment=BASE_URL=https://www.survey.dishariboston.org`
- `deploy/nginx.conf.example`: `server_name`, the certificate paths and the comments
- `deploy/oauth2-proxy.cfg.example`: `redirect_url`

If the address ever changes, replace it in all three files (use `https://`, no trailing slash in `BASE_URL`). While you're in the service file, also check `TZ=`, `User=` and the `/srv/dishari-survey` paths.

**Then:**
1. Add a **DNS** record for `www.survey.dishariboston.org` (an `A` record for the host `www.survey`, plus `AAAA` for IPv6), pointing at the server.
2. Set up Google sign-in (step 4), then install the service and nginx config and get the HTTPS certificate:
   ```sh
   sudo cp deploy/dishari-survey.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now dishari-survey
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/www.survey.dishariboston.org
   sudo ln -s /etc/nginx/sites-available/www.survey.dishariboston.org /etc/nginx/sites-enabled/
   sudo certbot --nginx -d www.survey.dishariboston.org
   sudo nginx -t && sudo systemctl reload nginx
   ```
   If you use pm2 instead of systemd, pass the same settings as environment variables:
   `NODE_ENV=production BASE_URL=https://www.survey.dishariboston.org TZ=America/New_York ADMIN_AUTH=proxy ADMIN_EMAILS=… pm2 start server.js --name dishari-survey`

**Why each setting matters:**
- **`BASE_URL`**: if it's missing, the codes CSV will contain `http://localhost:3000/…` links that won't work for anyone.
- **`NODE_ENV=production`**: turns on secure (HTTPS-only) cookies.
- **HTTPS**: required for the admin area in production mode, and for Google sign-in.

If you ever run the command-line code generator, it needs `BASE_URL` too:
`BASE_URL=https://www.survey.dishariboston.org node scripts/gen-codes.js --survey 1 --count 1000 > codes.csv`

---

## 4. Create the survey and set up Google sign-in for `/admin`

Create the survey:
```sh
cd /srv/dishari-survey
sudo -u dishari node scripts/seed.js        # creates the Agomoni 2026 survey (id 1)
```

**Admin access uses Google sign-in, not the app's own password form.** nginx sends every `/admin` request through [oauth2-proxy](https://oauth2-proxy.github.io), which makes the visitor sign in with Google and checks they're on the allowed list. It then passes their email to the app in the `X-Auth-Request-Email` header. The service file runs the app with `ADMIN_AUTH=proxy`, so:
- there is no password sign-in page on the live site (`/admin/login` just redirects to `/admin`);
- the app refuses any `/admin` request that doesn't arrive through nginx with a signed-in email ("Access denied");
- the app won't start in this mode unless it listens only on `127.0.0.1`.

**Organiser emails:** Dishari will send you the list of organiser Google accounts separately; it isn't included in this package. The service file has placeholder addresses (`organiser1@example.org`, …) that must be replaced.

**Set it up:**
1. **Google OAuth client.** In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials, create an **OAuth client ID** (type *Web application*) with the authorised redirect URI `https://www.survey.dishariboston.org/oauth2/callback`. If asked to configure the consent screen, an *Internal* (Workspace) or *External* app with just the email scope is enough.
2. **oauth2-proxy.** Install it (a single binary from its GitHub releases page), copy `deploy/oauth2-proxy.cfg.example` to `/etc/oauth2-proxy/dishari.cfg` (root-owned, mode 600), and fill in `client_id`, `client_secret` and `cookie_secret`. Run it as a service listening on `127.0.0.1:4180`.
3. **Who may sign in.** List the organisers' Google addresses, one per line, in `/etc/oauth2-proxy/dishari-admins.txt`. If all organisers use a Google Workspace domain, you can use `email_domains` instead (see the comment in the config).
4. **Second check in the app.** Put the same addresses, comma-separated, in `ADMIN_EMAILS` in `deploy/dishari-survey.service`. If it's left empty the app logs a warning at startup and trusts whoever oauth2-proxy lets through.
5. The nginx example already contains the `/oauth2/` locations and the `auth_request` on `/admin`. Keep the header lines in each `location` block: nginx doesn't inherit `proxy_set_header` into a location that sets its own.

**Adding or removing an organiser:** edit `dishari-admins.txt` (oauth2-proxy picks up changes automatically) **and** `ADMIN_EMAILS`, then `sudo systemctl daemon-reload && sudo systemctl restart dishari-survey`. The **sign-out** icon on the admin dashboard ends both the app session and the Google sign-in (`/oauth2/sign_out`).

You **don't** need `scripts/create-admin.js` on the server; it's only for the password mode used for local testing. If you ever need the app to run without Google sign-in, set `ADMIN_AUTH=password` and create logins with that script (see `README.md`).

---

## 5. Terms of Service and Privacy Policy

The `/terms` and `/privacy` pages are generated from **`design/LEGAL.md`**. Dishari has already filled in the organisation details (Dishari Inc., contact address and email, hosting provider, retention periods) and added a "Limits to anonymity" section (Terms item 6).

Both pages are complete (last updated Oct 3rd, 2026); nothing needs filling in. If Dishari changes the wording later:

1. Edit `design/LEGAL.md`.
2. Restart the app so it picks up the change: `sudo systemctl restart dishari-survey`.
3. Check `https://www.survey.dishariboston.org/terms` and `/privacy`. No square brackets should remain.

Quick check for leftovers: `grep -n "\[" design/LEGAL.md` should print nothing.

**Process note for Dishari:** the Privacy Policy says the list matching survey links to email addresses is held only by the Dishari executive committee and **deleted 60 days after the survey closes**, and Terms item 6 says reviews are recorded. Both are commitments the committee keeps outside this app.

---

## 6. Backups

Add a nightly cron job for the app user (`sudo crontab -u dishari -e`):
```
15 2 * * * /srv/dishari-survey/scripts/backup.sh
```
This writes `backups/survey-YYYY-MM-DD.db` each night and keeps 30 days on the server. **Copy `backups/` off the server regularly** (rsync, rclone, etc.).

To restore a backup: stop the service, delete `data/survey.db-wal` and `data/survey.db-shm` if they exist, copy the backup over `data/survey.db` (owned by the `dishari` user, mode 600), then start the service again.

---

## 7. Go-live checklist

Work through this on the live site before any emails are sent:

- [ ] `https://<subdomain>/` shows "Use the link from your email." and plain `http://` redirects to `https://`.
- [ ] `https://<subdomain>/terms` and `/privacy` show the final text, with no `[brackets]` (step 5).
- [ ] Open `https://<subdomain>/admin`. You're sent to Google sign-in, and after signing in with an allowed account the dashboard shows the survey as **Live** with 7 questions.
- [ ] In a private window, sign in with a Google account that is **not** on the list: you must not reach the dashboard.
- [ ] Click the sign-out icon on the dashboard; opening `/admin` again asks you to sign in with Google.
- [ ] On **Participant codes & links**, generate **3 test codes** and download the CSV. The `link` column must start with `https://<subdomain>/`, **not** `localhost` (step 3).
- [ ] Open one test link, complete the survey, and confirm the thank-you screen. Open it again and it should say "You've already submitted this survey."
- [ ] Results, a question page, **Raw responses (CSV)** and **Download full report (PDF)** all work.
- [ ] `sudo systemctl restart dishari-survey`, and everything is still there afterwards.
- [ ] The backup job has run at least once and the file has been copied off the server.

**About the test submission:** responses can't be deleted from the admin screens, and the one you just made will count in the results. When you've finished testing, reset to a clean database:
```sh
sudo systemctl stop dishari-survey
sudo -u dishari mv data/survey.db data/survey-test.db   # or delete it
sudo -u dishari rm -f data/survey.db-wal data/survey.db-shm   # SQLite side files, if any
sudo -u dishari node scripts/seed.js
sudo systemctl start dishari-survey
```
Do this **before** generating the real 1,000 codes.

---

## 8. Running the survey (for the organisers)

1. Sign in with Google at `https://<subdomain>/admin` → survey → **Participant codes & links** → generate **1000** codes → **Download codes (CSV)**.
2. Mail merge (Gmail, Mailchimp, etc.): one CSV row per recipient, with the `link` column in the email body. The app never stores email addresses.
3. Watch **Results** while answers come in. Comments can be **flagged**, which hides them from the PDF.
4. When the survey ends, click **Close survey** at the bottom of Results, then download the PDF report and the CSV.
5. As the Privacy Policy promises, delete the sheet that matches emails to codes once the survey closes. That sheet is the only thing that could connect a person to their answers.

---

## 9. Good to know

- **Run one copy of the app only.** The rate limits are kept in memory, so don't run it in pm2 cluster mode.
- **Bengali text in the PDF:** the default PDF font only covers Latin characters, so Bengali or emoji in comments print as `?` (the report says so on its cover). To fix it, download a font that covers both, e.g. **Hind Siliguri** from Google Fonts. Put the `.ttf` files on the server and uncomment the `PDF_FONT_REGULAR` / `PDF_FONT_BOLD` lines in the service file. The web pages and CSV show Bengali fine either way.
- **nginx access log:** the example config turns it off, because every participant URL contains their code. Remove `access_log off;` if your hosting rules require access logs.
- **Updating the app later:** copy the new files (still without `data/`), run `sudo -u dishari npm ci --omit=dev`, then `sudo systemctl restart dishari-survey`.
- **Tests:** `npm install && npm test` on any machine runs the automated checks, including the one-submission-per-code rule.
- **Logs:** `journalctl -u dishari-survey -f` (systemd) or `pm2 logs dishari-survey`.
- **Design and spec:** the original design brief is `design/README.md`; the legal text is `design/LEGAL.md`.
