# Handoff: Dishari Agomoni 2026 Survey

## Overview
A mobile-first feedback survey for Dishari's Agomoni 2026 event, with two sides:
- **Participants** each get a unique emailed link (`https://<subdomain>.dishari.org/<CODE>`). They read the survey purpose, then answer 5 Yes/No questions and 3 written questions, with optional comments on the Yes/No ones. Each code allows **exactly one submission**. After submitting they see a thank-you and a randomly generated display name (e.g. `blacktiger12`).
- **Admins** use a **separate link** (`https://<subdomain>.dishari.org/admin`), which is never shown or linked on participant pages. There they sign in with email + password. They can see participation stats, per-question tallies, all comments and written answers, export a PDF report, and build new surveys.

Participants **never** see results, tallies or other people's comments.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes showing the intended look and behaviour, not production code to copy directly. Recreate them in a real app. **Chosen stack (minimal dependencies, self-hosted on the Dishari web server):**
- **Node.js 20+** with **Express** (or Fastify), rendering server-side HTML templates (EJS or plain template literals). No front-end framework is needed; a few lines of vanilla JS handle the in-page interactions.
- **SQLite** through **better-sqlite3**: a single `data/survey.db` file with no database server. SQLite handles concurrent submissions safely.
- **PDF**: `pdfkit` (light), or `puppeteer` if the server can run Chromium (easiest way to reuse the app's exact styling).
- **Sessions**: `express-session` with a SQLite session store; passwords hashed with `bcrypt`.
- Run under **pm2** or **systemd** on `127.0.0.1:3000`. The existing web server (nginx/Apache) reverse-proxies `survey.dishari.org` to it, with HTTPS from Let's Encrypt.

Open `Dishari Agomoni 2026 Survey.dc.html` for the participant flow and `Dishari Agomoni 2026 Admin.dc.html` for the admin flow (both need `support.js` and `agomoni-styles.css` next to them).

## Fidelity
**High-fidelity.** Match colours, type, radii, shadows, spacing and copy exactly. The PDF report should use the same visual language.

## Routes
| Route | Who | Purpose |
|---|---|---|
| `/[code]` | Participant | Validate code → Intro → Questions → Thank-you |
| `/` | Anyone | Short landing page: "Use the link from your email." |
| `/admin/login` | Admin | Email + password sign-in. Not linked from any participant page. |
| `/admin` | Admin | Dashboard: surveys list + "Start a new survey" |
| `/admin/surveys/new` | Admin | Survey builder |
| `/admin/surveys/[id]` | Admin | Results overview |
| `/admin/surveys/[id]/q/[n]` | Admin | Question detail (tally + all comments / written answers) |
| `/admin/surveys/[id]/report.pdf` | Admin | PDF export |
| `/admin/surveys/[id]/codes` | Admin | Generate / download participant codes (CSV) |
| `/admin/surveys/[id]/export.csv` | Admin | Raw responses for Excel |
| `/terms`, `/privacy` | Anyone | Legal pages (draft text in `LEGAL.md`) |

## Participant codes & one-submission rule
- Generate **1,000 codes** per survey: 8 characters from an unambiguous alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, so no 0/O/1/I/L), cryptographically random, unique per survey.
- Admins download them as CSV (`code,link`) for a mail merge. **Do not store email addresses in the app.** Emailing happens outside it (e.g. Gmail/Mailchimp mail merge), which keeps responses anonymous.
- When `/[code]` loads:
  - Code unknown → error screen: "This link isn't valid. Please check the link in your email."
  - Code already used → "You've already submitted this survey. Thank you!" plus the display name it was submitted under.
  - Survey closed → "This survey is now closed."
  - Valid and unused → Intro screen.
- **Draft progress** is saved to `localStorage` keyed by code, so a refresh doesn't lose answers. Nothing is written to the server until Submit.
- **Submit** is one POST, run as a single SQLite transaction (`db.transaction(...)` in better-sqlite3): check the code is unused → insert the response, answers and comments → mark the code used (`used_at`, `response_id`). Also add a unique constraint on `responses.code_id`, so a double-click can't produce two submissions.
- The **display name** is generated server-side at submit time: `<adjective><animal><1–99>`, unique per survey. Adjectives: black, blue, red, golden, silver, green, amber, scarlet, misty, jade. Animals: tiger, peacock, lotus, falcon, dolphin, panther, sparrow, elephant, koel, heron. Extend the lists if names collide.

## Data model (SQLite — `data/survey.db`)
Enable `PRAGMA journal_mode=WAL;` and `PRAGMA foreign_keys=ON;` on startup. IDs are INTEGER primary keys; times are ISO-8601 text.
```sql
CREATE TABLE surveys   (id INTEGER PRIMARY KEY, name TEXT NOT NULL, purpose TEXT,
                        status TEXT NOT NULL CHECK(status IN ('draft','live','closed')), created_at TEXT NOT NULL);
CREATE TABLE questions (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
                        position INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('yesno','text')),
                        title TEXT NOT NULL, context TEXT);
CREATE TABLE codes     (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
                        code TEXT NOT NULL, used_at TEXT, UNIQUE(survey_id, code));
CREATE TABLE responses (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
                        code_id INTEGER NOT NULL UNIQUE REFERENCES codes(id),
                        display_name TEXT NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(survey_id, display_name));
CREATE TABLE votes     (response_id INTEGER NOT NULL REFERENCES responses(id), question_id INTEGER NOT NULL REFERENCES questions(id),
                        vote TEXT NOT NULL CHECK(vote IN ('yes','no')), PRIMARY KEY(response_id, question_id));
CREATE TABLE comments  (id INTEGER PRIMARY KEY, response_id INTEGER NOT NULL REFERENCES responses(id),
                        question_id INTEGER NOT NULL REFERENCES questions(id), body TEXT NOT NULL,
                        created_at TEXT NOT NULL, flagged INTEGER NOT NULL DEFAULT 0);
                        -- used for BOTH Yes/No comments and written answers (Q6–8); several per question allowed
CREATE TABLE admins    (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
```
- Create the first admin with a CLI script: `node scripts/create-admin.js you@dishari.org` (prompts for a password).
- Seed the Agomoni survey and generate codes with `node scripts/seed.js` and `node scripts/gen-codes.js --survey 1 --count 1000 > codes.csv`.
- Store `data/` **outside the public web root**, owned by the app user, with mode 600.
- **Backups**: run a nightly cron job `sqlite3 data/survey.db ".backup 'backups/survey-$(date +%F).db'"` and copy the backups off the server.

## Survey content (seed)
**Name:** Dishari Agomoni 2026 Survey
**Purpose:** "The purpose of this survey is to understand your experience at the Agomoni event. We would like to learn about our shortcomings and improve on them in future events. Your feedback will be greatly helpful for Dishari's growth and sustainability in the coming years."

| # | Type | Question |
|---|---|---|
| 1 | yesno | Overall, have you enjoyed Agomoni 2026? |
| 2 | yesno | Do you like the artists at Agomoni 2026? |
| 3 | yesno | Do you like the food in Agomoni 2026? |
| 4 | yesno | Do you want Dishari to continue with Agomoni in 2027? |
| 5 | yesno | Do you like Dishari to start organizing religious festivals (like Kali Puja) in coming years? |
| 6 | text | Please briefly describe how you would like to see Dishari in 2027? |
| 7 | text | Please briefly mention what kind of events you would like to see in Dishari in coming years? |
| 8 | text | Please provide any feedback on Dishari or its event that will be helpful for our organizational growth & sustainability |

## Screens

### Shared frame
- Max content width **412px**, centred. On desktop, show it as a card over `#f6eded`: 22px radius, 1px `#f0dcdc` border, shadow `0 14px 44px rgba(150,40,60,.16)`. On mobile it fills the screen.
- Ground: `linear-gradient(135deg, #fce9ea 0%, #fdf0ed 55%, #fef6ee 100%)`.
- Header bar (`.nav`): padding 12px 16px, 1px `#f0dcdc` bottom border. Brand "DISHARI" in Tahoma 700 18px, with a right-aligned label in 11px uppercase, letter-spacing .12em, `#6c6260`.
- Kicker labels: 11px, uppercase, letter-spacing .06em, 700, `#a52a3d`.

### P1 · Intro (`/[code]`)
- Header: DISHARI · SURVEY
- **Banner**: crimson gradient `linear-gradient(120deg,#d44a5f,#c3354a)`, white text, 18px radius, padding 24px 16px, shadow `0 6px 20px rgba(201,58,80,.14)`. Top line "8 QUESTIONS · ABOUT 3 MINUTES" (11px uppercase 700). Title = survey name, Tahoma 700 30px.
- **Card "WHY WE'RE ASKING"**: white, 16px radius, 1px `#f0dcdc` border, soft shadow, padding 16px. Body = purpose text, 15px / 1.6, `#333`.
- Muted note, 12px: "Your answers are anonymous and seen only by Dishari admins."
- Spacer, then a full-width primary pill button **"Begin →"** (min-height 52px, 16px, label left and arrow right).
- Under it, 11px `#6c6260`: "By continuing you agree to Dishari's **Terms of Service** and **Privacy Policy**." Both are links in `#a52a3d` to `/terms` and `/privacy`.

### P2 · Question screen
- **Top bar**: "← Exit" (icon button, returns to Intro) on the left; "N OF 8" (Tahoma 700 12px, .04em) on the right. Below it, a 6px pill progress track (`#f3e9e7`) with a crimson-gradient fill sized to `N/8`.
- Kicker = survey name; question title Tahoma 700 25px, `text-wrap: pretty`.
- **Yes/No questions (1–5)**:
  - Two equal pill buttons, min-height 58px, 16px text, with thumbs-up/down icons (Lucide `thumbs-up`, `thumbs-down`). Unselected: white, 1.5px `#f0dcdc` border, dark text. Selected **Yes**: crimson gradient, white text. Selected **No**: `#4d4646` fill, white text. Tapping the other option switches the vote.
  - 1px divider.
  - **Comment composer**: label "Comment (optional)", textarea min-height 72px, placeholder "Anything you'd like to add?", and a secondary pill button "➤ Post comment" (disabled while empty).
- **Written questions (6–8)**: the same composer, labelled "Your answer", placeholder "Share your thoughts…", min-height 120px, button "Post answer". **Don't mark it optional and don't add a "Skip" button**, but Next must stay enabled.
- Below the composer, muted 12px: "Only Dishari admins can read this."
- **Posted items** list underneath: each row has a 1px top border, a 30px gradient avatar circle with "Y", **You** (bold 13px), "just now" (11px muted), and a right-aligned "Remove" text button. The text below is indented 38px, 14px. Posting clears the textarea, and several posts per question are allowed. **Never show other participants' comments.**
- **Sticky footer**: white, 1px top border, padding 12px 16px. "‹ Back" secondary pill (flex 1, disabled on Q1) and a primary pill (flex 2), "Next question ›" or, on Q8, "Submit survey ✓".
- **Validation**: on Yes/No questions, Next/Submit is disabled until a vote is chosen. Comments and written answers are never required. Text typed but not posted when the user hits Next should be **auto-posted** (recommended, so nothing is lost silently).

### P3 · Thank-you
- 68px gradient circle with a white filled heart.
- Kicker "SUBMITTED", "Thank you!" (Tahoma 700 34px), then "Your feedback on **Dishari Agomoni 2026 Survey** helps Dishari grow. See you at the next event."
- Stat card: label "YOU RESPONDED AS", value = display name in monospace 24px, `#a52a3d`.
- Primary pill "Done →". In production this can just say "You can close this page now"; revisiting the link shows the "already submitted" state.

### Error states (new, same styling as Intro)
Invalid link · Already submitted (show display name) · Survey closed. Each one has a kicker, a 30px title and one sentence. No buttons are needed.

### A1 · Admin sign-in (separate link: `/admin`)
Header: DISHARI + "Admin" tag. Kicker "ADMIN ACCESS", title "Sign in", subtext "For Dishari survey organisers only." Email and Password fields (min-height 46px), then a "Sign in →" primary pill. Error message: "Check your email and password." Rate-limit to 5 attempts per 15 min per IP. The sign-out icon on the dashboard returns here.

### A2 · Admin dashboard
- Header: DISHARI + "Admin" tag (pill, `#fdecee` bg / `#a52a3d` text) + a sign-out icon.
- Kicker "DASHBOARD", greeting "Good afternoon." (time-based).
- Large gradient tile "＋ Start a new survey", subtext "Add Yes/No or written-answer questions, then publish."
- "EXISTING SURVEYS" cards: status tag (Live/Closed/Draft), "N questions", name, and "X of Y responded · tap for results" with a bar-chart icon.

### A3 · Survey builder
Fields: Survey name; Purpose (optional, textarea). A list of added questions, each a card with Q#, a type tag ("Yes / No" or "Written"), the title, and edit/delete icon buttons. An **Add a question** card containing:
- An "Answer type" pill toggle: **Yes / No** | **Written answer**. Selected = gradient + white; unselected = white + border.
- Question (input), Context (optional textarea), and an "Add question" / "Save changes" primary pill (disabled while the question is empty).
- A "Publish survey ➤" secondary pill, enabled once there's a name and at least 1 question. Publishing sets the status to `live` and shows a preview screen: a gradient "NOW LIVE" banner and every question rendered as participants see it, with "Dashboard" and "View results" buttons. After publishing, prompt the admin to **generate codes**.

### A4 · Results overview
- Kicker "ADMIN ONLY", then the survey name at 26px.
- Two stat cards: **Responded** `X/Y` (Y = codes issued, X = codes used) and **Response rate** `%`.
- One card per question, tappable, with a chevron:
  - Yes/No: two bar rows with a 20px pill track (`#f3e9e7`); Yes = gradient fill, No = `#aa9c99`; right label "count · %". Footer: "View discussion" (`#a52a3d`) and "N comments".
  - Written: the newest answer in italics with quotes, then "Read all responses" and "N written".
  - Bar widths animate with `width .6s cubic-bezier(.2,.7,.2,1)`.
- Full-width primary pill "Download full report (PDF)", with a download icon.

### A6 · Participant codes (`/admin/surveys/[id]/codes`)
Reached from "Participant codes & links" on Results, or "Next: generate participant codes" after publishing.
- Kicker = survey name, title "One link per participant", subtext "Each code works for a single submission. Download the list and use it in your email mail-merge."
- Three stat cards: **Issued**, **Used**, **Unused**.
- "GENERATE MORE CODES" card: a "How many" number input (default 1000, max 5000) and a primary pill "+ Generate N codes". On success: "N new codes generated." Generating always **adds** codes and never replaces or invalidates existing ones.
- "LATEST CODES" list (the 5 newest, monospace, with the link suffix) and a primary pill "Download codes (CSV)" with columns `code,link,used_at`.
- The CLI script `gen-codes.js` stays available as a backup, using the same function.

### A5 · Question detail
- Tag in the header: "N comments" / "N responses".
- Yes/No: a tally card ("TALLY · N VOTES" plus both bars), then "FULL DISCUSSION". Each comment shows avatar initial, display name, relative time, body, and a "Flagged" outline tag if flagged. The like/dislike/reply counters in the prototype can be dropped, since participants can't see each other's comments.
- Written: "WRITTEN RESPONSES". Each answer is a white card with avatar, display name, time and body.
- Admins can **flag/hide** a comment (moderation). Flagged comments stay in the DB, but there's a toggle to leave them out of the PDF.

## PDF report
Generate it server-side. If the server can run Chromium, render an HTML report page with `puppeteer` (`page.pdf()`, A4, print backgrounds on). Otherwise use `pdfkit` and draw the same cards and bars. **Use the same visual design as the app**: blush ground (or white for printing), crimson gradient banner, white rounded cards, the same pill bar charts and type.

Order:
1. **Cover / summary**: gradient banner with the survey name, generated date, and the Responded X/Y and Response-rate stat cards.
2. **Yes/No statistics**: all 5 Yes/No questions one after another, each a card with the title and two bars showing count and %. Ideally they fit on one page.
3. **Responses by question**, in order Q1 → Q8. For each question:
   - Heading "Question N" plus the title. Yes/No questions repeat a compact tally line ("Yes 71 · 89% / No 9 · 11%").
   - Every comment (Q1–5) or written answer (Q6–8): display name, timestamp, body. Use `page-break-inside: avoid` per comment, and start each question on a new page if it's long.
   - If there are none, show "No comments."
4. Footer on every page: "Dishari · Agomoni 2026 Survey · page X of Y".

## Design tokens
```
Ground gradient   linear-gradient(135deg,#fce9ea 0%,#fdf0ed 55%,#fef6ee 100%)
Brand gradient    linear-gradient(120deg,#d44a5f 0%,#c3354a 100%)
Surface           #ffffff      Card/bg alt  #fffaf8
Text              #333333
Divider           #f0dcdc
Accent ramp       100 #fdecee 200 #f9d3d8 300 #f0aab4 400 #e17686 500 #d14b5f
                  600 #c3354a 700 #a52a3d 800 #7c1f2e 900 #4f141d   (base #c93a50)
Neutral ramp      100 #faf4f2 200 #f3e9e7 300 #e7dad7 400 #cebfbc 500 #aa9c99
                  600 #8b7f7c 700 #6c6260 800 #4d4644 900 #333333
Fonts             Headings: Tahoma, Verdana, "Segoe UI", sans-serif, 700
                  Body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Helvetica, Arial
Type scale        h1 30–38 · h2 24–26 · h4 16–17 · body 15 · small 13 · meta 11–12
Spacing           4 · 8 · 12 · 16 · 24 · 32
Radius            buttons/tags/tracks 999px (pill) · cards 16px · banner/tiles 18px · inputs 12px · frame 22px
Shadows           sm 0 2px 8px rgba(201,58,80,.08)
                  md 0 6px 20px rgba(201,58,80,.14)
                  primary button 0 6px 18px rgba(201,58,80,.28)
                  lg 0 14px 44px rgba(150,40,60,.16)
Primary button    brand gradient, white 700 14px, hover #c3354a, active #a52a3d, disabled 45% opacity
Secondary button  white, 1px #f0dcdc border, hover 7% ink tint
Focus             2px solid #c93a50 outline, 2px offset
```

## Assets
No images. Icons are **Lucide** (lucide.dev): arrow-right, arrow-left, chevron-left/right, thumbs-up, thumbs-down, send, check, heart, plus, pencil, trash-2, bar-chart-3, download, rotate-ccw, shield-check, users, flag. Inline the SVGs (or use the `lucide-static` package) with stroke width 1.8.

## Security & privacy checklist
- Codes are unguessable (8 chars from a 31-char alphabet ≈ 8.5×10¹¹ combinations). Rate-limit `/[code]` lookups per IP.
- No emails, names or IPs are stored alongside responses. Keep the email-to-code mapping outside the app, or delete it after the survey closes.
- Admin pages are protected server-side (session check middleware on every `/admin/*` route), not just hidden in the UI. Use secure, httpOnly, sameSite=lax cookies and add CSRF tokens to admin forms.
- Participant pages never link to `/admin`.
- Sanitise comment text (render as plain text) and cap it at 2,000 characters.

## Files
- `Dishari Agomoni 2026 Survey.dc.html`: the interactive prototype (participant flow; also contains the admin screens)
- `Dishari Agomoni 2026 Admin.dc.html`: opens the same prototype at the admin sign-in
- `agomoni-styles.css`: the theme tokens and component classes the prototype uses
- `support.js`: the prototype runtime (needed only to open the HTML; not for production)
- `LEGAL.md`: draft Terms of Service and Privacy Policy text
