# Dishari Surveys

The feedback survey app for **Dishari Agomoni 2026**. Each participant gets a personal one-time link (`https://www.survey.dishariboston.org/<CODE>`), and admins sign in at `/admin` (with Google on the live site) to see the results, export CSV and PDF reports, and build new surveys.

Built from the spec in [`design/README.md`](design/README.md) with Node.js 20+, Express, better-sqlite3 and EJS templates. There is no build step and no front-end framework.

## Run it locally

You need **Node.js 20 or newer** (`node -v`).

```sh
npm install
node scripts/seed.js                                   # creates the Agomoni 2026 survey (id 1)
node scripts/create-admin.js you@dishari.org           # local password login (min 10 characters)
npm start                                              # http://localhost:3000
```

Then:

1. Open **http://localhost:3000/admin**, sign in, open the survey and choose **Participant codes & links** → generate 5 codes.
2. Open **http://localhost:3000/&lt;one of those codes&gt;** and complete the survey.
3. Open the same link again. It should say *"You've already submitted this survey."*
4. Back in admin, check the results, the question pages, **Raw responses (CSV)** and **Download full report (PDF)**.

Run the tests with `npm test`.

### Scripts

| Command | What it does |
|---|---|
| `node scripts/seed.js` | Creates the Agomoni 2026 survey with its 7 questions. Safe to run twice. |
| `node scripts/create-admin.js <email>` | Creates an admin, or resets an existing admin's password. Only used in password mode (local testing); the live site uses Google sign-in. |
| `node scripts/gen-codes.js --survey 1 --count 1000 > codes.csv` | Adds codes and prints them as `code,link` CSV. This is a backup for the admin Codes screen and uses the same generator. |
| `scripts/backup.sh` | Takes a SQLite backup into `backups/survey-YYYY-MM-DD.db` and keeps 30 days. |

### Settings (environment variables)

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | The app only listens on localhost; nginx faces the internet. |
| `BASE_URL` | `http://localhost:3000` | Used for the links in the codes CSV. In production: `https://www.survey.dishariboston.org`. |
| `NODE_ENV` | — | Set to `production` on the server (turns on secure cookies). |
| `DB_PATH` | `data/survey.db` | SQLite file. `data/` is created with mode 700 and the DB with mode 600. |
| `SESSION_SECRET` | auto | If unset, a random secret is generated once and kept in `data/session-secret`. |
| `LEGAL_PATH` | `design/LEGAL.md` | Source for `/terms` and `/privacy`. Restart the app after editing it. |
| `PDF_FONT_REGULAR` / `PDF_FONT_BOLD` | — | Optional `.ttf` files for the PDF (see below). |
| `TZ` | system | The time zone used for times shown in admin and the PDF. |
| `COOKIE_SECURE` | `true` in production | Override only for testing over plain HTTP. |
| `ADMIN_AUTH` | `password` | `password`: built-in email + password sign-in (local testing). `proxy`: Google OAuth in front of `/admin` (live site); see below. |
| `ADMIN_EMAILS` | — | Proxy mode: comma-separated emails allowed into `/admin`, as a second check on top of Google sign-in. |
| `ADMIN_EMAIL_HEADER` | `X-Auth-Request-Email` | Proxy mode: header carrying the signed-in email (oauth2-proxy's default). |
| `ADMIN_LOGOUT_URL` | `/oauth2/sign_out?rd=/` | Proxy mode: where the dashboard's sign-out icon goes. |

## How it works

- **The Agomoni 2026 survey** (version 3) has 5 multiple-choice questions, 1 question with four labelled text boxes (Artist Selection, Food, Venue Location, Other), and 1 open text question; see `scripts/seed.js`. It replaces the 8 Yes/No and written questions in the original spec (`design/README.md`), which the app still supports for other surveys.
- **Question types**:
  - **Multiple choice:** pick one option; an answer is required.
  - **Yes / No:** an answer is required, with optional posted comments.
  - **Written:** a single optional text box, or several optional labelled boxes. Answers are stored per box, and results, the CSV and the PDF group them by box.

  Admins can use all three in the survey builder.

- **Codes**: 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, generated with `crypto.randomInt` and unique across all surveys. Generating codes always adds to the existing ones; it never replaces them. The app stores **no email addresses**: do the mail merge outside it with the CSV.
- **Upgrading from earlier versions**: databases created by version 1 or 2 are migrated automatically on startup (multiple-choice type; per-box written answers). Existing data is kept, but the survey questions themselves aren't replaced; see `handoff.md` if an earlier version was set up.
- **One submission per code**: answers are kept in the browser (`localStorage`) until Submit. Submit is a single SQLite transaction (check the code is unused → insert the response, answers and comments → mark the code used), and `responses.code_id` is `UNIQUE` as a second guard. The tests fire four submits at once and check that exactly one succeeds.
- **Display names** such as `blacktiger12` are generated on the server at submit time and are unique per survey.
- **Moderation**: on a question page, admins can **Flag** a comment. Flagged comments stay in the database and the CSV (marked `[flagged]`), and they're left out of the PDF unless you tick *Include flagged comments*.
- **Closing a survey**: use **Close survey** at the bottom of the Results page. Participants then see *"This survey is now closed."*
- **PDF report** (pdfkit, no Chromium needed): the cover with the Responded/Rate stats, then charts for the multiple-choice (and any Yes/No) questions, then every question that collects text, with all its comments or written answers, and *"Dishari · … · page X of Y"* on every page.
  - The built-in PDF font is Latin-only, so Bengali text or emoji would show as `?`, and the cover page then says so. To fix that, download a font that covers both Latin and Bengali, e.g. **Hind Siliguri** from Google Fonts, and set `PDF_FONT_REGULAR` and `PDF_FONT_BOLD` to its `.ttf` files. The web pages and the CSV are unaffected.

### Security notes

- **Admin sign-in on the live site is Google OAuth** (`ADMIN_AUTH=proxy`): nginx sends `/admin` through oauth2-proxy, which signs the visitor in with Google and passes their email in `X-Auth-Request-Email`; nginx overwrites that header, so browsers can't forge it. The app rejects `/admin` requests without it, only accepts it from a loopback peer, optionally checks it against `ADMIN_EMAILS`, and refuses to start in this mode unless `HOST` is loopback. There is no password fallback.
- Every `/admin/*` route checks access on the server. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production and scoped to `/admin`. Sessions are stored in SQLite, and every admin form carries a CSRF token.
- In password mode (local testing), sign-in is limited to 5 failed attempts per IP per 15 minutes, and passwords are hashed with bcrypt (cost 12).
- `/<code>` lookups are rate-limited per IP: 20 unknown codes or 120 lookups per 15 minutes. These limits live in memory, so run the app as **one process**.
- Comments are capped at 2,000 characters and 20 per question, and are always rendered as plain text. The CSV export guards against spreadsheet formula injection.
- The headers set a strict Content-Security-Policy (no inline scripts), `Referrer-Policy: no-referrer` (so codes never leak in referrers) and `X-Frame-Options: DENY`. Participant pages never link to `/admin`, and `robots.txt` disallows everything.
- **Anonymity depends on process.** The database links each response to the code it used (needed for one-submission), and whoever holds the mail-merge sheet knows which email got which code. Keep that sheet outside the app and delete it when the survey closes, as the Privacy Policy says.

## Deploy behind nginx on a subdomain

These steps assume a Linux server with nginx, and `www.survey.dishariboston.org` as the subdomain. Adjust names and paths to suit.

**1. DNS.** Add an `A` (and `AAAA` if you use IPv6) record for `www.survey.dishariboston.org` pointing at the server.

**2. Install Node.js 20+** (e.g. from NodeSource or your distro), plus `sqlite3` for backups and build tools for the native modules:
```sh
sudo apt install -y build-essential python3 sqlite3
```

**3. Create an app user and copy the app** (from git or a zip, without `node_modules` and `data`):
```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin dishari
sudo mkdir -p /srv/dishari-survey && sudo chown dishari:dishari /srv/dishari-survey
# copy the files into /srv/dishari-survey, then:
cd /srv/dishari-survey
sudo -u dishari npm ci --omit=dev
sudo -u dishari mkdir -p data backups && sudo chmod 700 data backups
```
`/srv/dishari-survey` is outside nginx's web root, so nothing in `data/` can be served directly.

**4. Seed the survey and set up Google sign-in:**
```sh
sudo -u dishari node scripts/seed.js
```
Create a Google OAuth client (redirect URI `https://www.survey.dishariboston.org/oauth2/callback`), then install and configure oauth2-proxy from `deploy/oauth2-proxy.cfg.example`, listening on `127.0.0.1:4180`. List the organisers' Google addresses in its `authenticated_emails_file` and in `ADMIN_EMAILS` in the service file. [`handoff.md`](handoff.md) step 4 walks through it.

**5. Run it as a service** (systemd):
```sh
sudo cp deploy/dishari-survey.service /etc/systemd/system/
sudo nano /etc/systemd/system/dishari-survey.service   # check BASE_URL, TZ, ADMIN_EMAILS, paths
sudo systemctl daemon-reload
sudo systemctl enable --now dishari-survey
sudo systemctl status dishari-survey                   # should say "active (running)"
curl -I http://127.0.0.1:3000/                         # should be 200
```
If you'd rather use **pm2**:
```sh
NODE_ENV=production BASE_URL=https://www.survey.dishariboston.org TZ=America/New_York ADMIN_AUTH=proxy ADMIN_EMAILS=a@x.org,b@y.org pm2 start server.js --name dishari-survey
pm2 save && pm2 startup
```

**6. nginx + HTTPS:**
```sh
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/www.survey.dishariboston.org
sudo ln -s /etc/nginx/sites-available/www.survey.dishariboston.org /etc/nginx/sites-enabled/
sudo certbot --nginx -d www.survey.dishariboston.org      # Let's Encrypt certificate
sudo nginx -t && sudo systemctl reload nginx
```
The example config protects `/admin` with `auth_request` to oauth2-proxy and clears `X-Auth-Request-Email` on every other path. Each `location` repeats its `proxy_set_header` lines because nginx doesn't inherit them into a location that sets its own. It also turns off the access log so participant codes (which are in the URL) aren't written to disk. Remove `access_log off;` if you need those logs.

If you use **Apache** instead, the equivalent is `ProxyPass / http://127.0.0.1:3000/`, `ProxyPassReverse / http://127.0.0.1:3000/` and `RequestHeader set X-Forwarded-Proto "https"` inside the HTTPS virtual host. You'd also need a Google OAuth gate on `/admin` (e.g. oauth2-proxy in front of Apache, or `mod_auth_openidc`) that sets the email header and strips it from client requests.

**7. Nightly backups** (`sudo crontab -u dishari -e`):
```
15 2 * * * /srv/dishari-survey/scripts/backup.sh
```
Then copy `/srv/dishari-survey/backups/` off the server regularly (rsync, rclone, etc.).

**8. Updating the app:** copy the new files, run `sudo -u dishari npm ci --omit=dev`, then `sudo systemctl restart dishari-survey`. The database schema is created automatically on startup.

## Before going live

- Fill in the `[bracketed]` items in `design/LEGAL.md` (organisation name, contact email, hosting provider and country, retention period), then restart the app. `/terms` and `/privacy` are rendered from that file.
- Generate the codes on the live server (Admin → survey → Participant codes), download the CSV and use the `link` column in the mail merge.

## Project layout

```
server.js              entry point (reads env, opens DB, starts Express)
src/
  app.js               Express app: static files, headers, routers, error pages
  config.js            environment settings
  db.js                SQLite connection, pragmas, schema
  surveys.js           queries, results, the submit transaction
  codes.js             code generator (used by the admin screen and the CLI)
  names.js             display-name generator
  pdf-report.js        PDF report (pdfkit)
  csv.js  legal.js  icons.js  format.js  security.js  session-store.js
  routes/              public.js (/, /terms, /privacy) · participant.js (/:code) · admin.js (/admin/*)
views/                 EJS templates (participant/, admin/, partials/)
public/                css/ (prototype theme + app layer), js/ (survey, builder, admin)
scripts/               seed, create-admin, gen-codes, backup
deploy/                systemd unit, nginx example, oauth2-proxy example
test/                  node:test suites (npm test)
design/                README.md (original spec) and LEGAL.md (source for /terms and /privacy)
```
