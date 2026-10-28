# Future Plans

## GitHub repo + deployment pipeline for DishariSurvey

**Status:** Not started — deferred for future implementation.

### Current state (as of 2026-10-16)
- `DishariSurvey` has **no git repo at all** locally (no `.git`, no remote, no version history).
- Deployment to the VPS (`2.24.84.5`, `/srv/dishari-survey`) was done entirely manually:
  1. Staged a filtered copy locally via `robocopy` (excluding `node_modules`, `data`, `backups`, `.git`).
  2. `scp -r` the staged copy to the server, moved into place.
  3. `npm ci --omit=dev` run directly on the server (Node 22.23.3).
  4. Config/service files (`deploy/*.service`, `deploy/*.cfg.example`, `deploy/nginx.conf.example`) copied up individually via `scp` as they were edited.
- No CI, no automated tests on push, no rollback mechanism beyond re-copying files by hand.

### Goal
1. Create a GitHub repo for DishariSurvey (private, since it contains deployment configs — though no real secrets are committed, only `.example` templates).
2. Set up a basic CI workflow (GitHub Actions) that at minimum runs `npm ci` + existing tests (`test/` folder) on every push/PR.
3. Set up a deployment pipeline so pushing to `main` (or tagging a release) automatically deploys to the VPS, replacing the current manual `robocopy`/`scp` process.

### Deployment pipeline — options to evaluate later
- **GitHub Actions + SSH deploy action** (e.g. `appleboy/ssh-action` or a custom `scp`/`rsync` step): on push to `main`, SSH into `2.24.84.5`, `git pull` (or rsync built artifacts) into `/srv/dishari-survey`, run `npm ci --omit=dev`, then `systemctl restart dishari-survey`. Requires adding a deploy key or GitHub secret for VPS SSH access.
- **Git-based deploy on the server**: turn `/srv/dishari-survey` into an actual git checkout (`git clone` the repo there once), so future deploys are just `git pull` + `npm ci` + `systemctl restart`, triggered manually or via a webhook/Action.
- **Zero-downtime consideration**: current systemd service has a brief restart gap on deploy; could add a healthcheck-gated restart or blue/green with two ports behind nginx if that becomes a requirement later. Not needed yet given current traffic (survey participants, not 24/7 critical service).
- **Secrets handling**: `/etc/oauth2-proxy/dishari.cfg` (client secret, cookie secret) and any `.env` on the server must **never** be committed to the repo — only `.example` templates belong in git, consistent with current practice.

### Decision
Not yet decided. Lower priority than the SSO item below — current manual deployment process works, just doesn't scale well for frequent changes.

## Single Sign-On (SSO) between main site admin and survey admin

**Status:** Not started — deferred for future implementation.

### Goal
Currently, admins must authenticate twice:
1. Once on the main dishariboston.org site's admin/dashboard (client-side Google Identity Services).
2. Again on the survey app's `/admin` (server-side oauth2-proxy + Google OAuth).

Desired flow:
1. Single login.
2. Unauthenticated user visiting `https://www.survey.dishariboston.org/admin` is redirected to the main dishariboston.org admin login page.
3. User completes Google OAuth on the main dishariboston.org admin site.
4. Main site's admin dashboard shows a card/link for "Event Surveys" (survey admin).
5. Clicking the card takes them to the survey admin page — **no second authentication prompt.**

### Current auth architecture (as of 2026-10-16)
- **Main site** (`src/context/AuthContext.jsx` in DishariWebsite): pure client-side Google Identity Services (GIS). Decodes the JWT in-browser, checks the `hd` (hosted domain) claim against `dishariboston.org`, stores the user in `sessionStorage`. No backend session, no cookie, no server-side verification.
- **Survey app** (DishariSurvey, deployed on VPS `2.24.84.5` as `www.survey.dishariboston.org`): real server-side gate via `oauth2-proxy` v7.15.5, sitting behind nginx with `auth_request` on `/admin`. Sets a secure, httponly session cookie after Google OAuth. Also enforces an explicit `ADMIN_EMAILS` allowlist at the app level (defense-in-depth on top of `email_domains = ["dishariboston.org"]`).

Because the two admin areas use completely different auth mechanisms (client-only JWT decode vs. server-side oauth2-proxy session), there's currently no shared session — hence the double login.

### Option 1 — Shared-cookie SSO (recommended, more infra work)
Put the main site's admin area behind `oauth2-proxy` as well, sharing the same `cookie_secret` and setting:
```
cookie_domain = ".dishariboston.org"
```
so the session cookie set by oauth2-proxy is valid across both `dishariboston.org` and `www.survey.dishariboston.org`. Signing in on either app's `/admin` authenticates both.

Requirements:
- Main site would need to be reverse-proxied through nginx (likely the same VPS/nginx instance already running for the survey app, or at least behind its own oauth2-proxy with a shared cookie domain and signing key).
- Migrate the main site off its current client-only GIS flow to the oauth2-proxy `auth_request` pattern (mirrors what's already working for the survey app).
- One real, consistent auth system instead of two divergent ones — more secure and easier to maintain long-term.

### Option 2 — Token handoff (less infra work, more custom code)
Keep both auth systems as they are today. When a signed-in main-site admin clicks the "Event Surveys" card:
1. Main site mints a short-lived signed token (e.g., JWT signed with a shared secret known to both apps) containing the admin's verified email.
2. Redirects to a new survey-app endpoint (e.g., `/sso/handoff?token=...`).
3. Survey app verifies the token's signature + expiry + that the email is in `ADMIN_EMAILS`, then establishes a session equivalent to what oauth2-proxy would normally set (or bypasses oauth2-proxy via a signed internal header, trusted only from localhost like the existing `X-Auth-Request-Email` pattern).

Requirements:
- New minimal endpoint/logic on the survey app side (`src/security.js` already has the `proxyAdminGate` concept to extend).
- Shared secret between main site and survey app for signing/verifying tokens.
- No infra migration needed — main site keeps its current GIS-based flow.

### Decision
Not yet decided. Option 1 is architecturally cleaner (single real auth system); Option 2 is faster to implement without touching the main site's hosting/auth setup.
