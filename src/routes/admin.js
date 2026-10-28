'use strict';
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const config = require('../config');
const SqliteStore = require('../session-store');
const surveys = require('../surveys');
const { generateCodes, codeLink } = require('../codes');
const { toCsv, BOM } = require('../csv');
const { buildReport } = require('../pdf-report');
const { createLimiter, noStore, csrfToken, verifyCsrf, requireAdmin, proxyAdminGate } = require('../security');

// Compared against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const slug = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'survey';

module.exports = function adminRoutes({ db, sessionSecret, auth = {} }) {
  const router = express.Router();
  const mode = auth.mode || config.adminAuth;
  const logoutUrl = auth.logoutUrl || config.adminLogoutUrl;
  const loginFailures = createLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

  router.use(
    session({
      name: 'dishari.sid',
      secret: sessionSecret,
      store: new SqliteStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: 8 * 60 * 60 * 1000,
        path: '/admin',
      },
    })
  );
  router.use(noStore);
  router.use(express.urlencoded({ extended: false, limit: '200kb' }));
  if (mode === 'proxy') {
    router.use(proxyAdminGate({
      header: auth.emailHeader || config.adminEmailHeader,
      allowedEmails: auth.allowedEmails || config.adminEmails,
    }));
  }
  router.use((req, res, next) => {
    res.locals.csrf = () => csrfToken(req);
    res.locals.adminEmail = req.proxyAdmin || req.session.adminEmail || null;
    next();
  });
  router.use(verifyCsrf);

  // ---------- Sign in / out ----------

  if (mode === 'proxy') {
    // Google sign-in happens before requests reach the app.
    router.get('/login', (req, res) => res.redirect('/admin'));
    router.post('/login', (req, res) => res.redirect('/admin'));
    router.post('/logout', (req, res, next) => {
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie('dishari.sid', { path: '/admin' });
        res.redirect(logoutUrl);
      });
    });
  }

  router.get('/login', (req, res) => {
    if (req.session.adminId) return res.redirect('/admin');
    res.render('admin/login', { title: 'Admin sign in', error: null, email: '' });
  });

  router.post('/login', async (req, res, next) => {
    const ip = req.ip;
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const fail = (error, status = 401) => res.status(status).render('admin/login', { title: 'Admin sign in', error, email });

    if (loginFailures.isLimited(ip)) return fail('Too many attempts. Please try again in 15 minutes.', 429);
    try {
      const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
      const ok = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_HASH);
      if (!admin || !ok) {
        loginFailures.hit(ip);
        return fail('Check your email and password.');
      }
      loginFailures.reset(ip);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        req.session.save((err2) => (err2 ? next(err2) : res.redirect('/admin')));
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('dishari.sid', { path: '/admin' });
      res.redirect('/admin/login');
    });
  });

  // Everything below needs a signed-in admin.
  router.use(requireAdmin);

  function loadSurvey(req, res, next) {
    const survey = surveys.getSurvey(db, Number(req.params.id));
    if (!survey) return res.status(404).render('message', {
      title: 'Not found', kicker: 'Admin', heading: 'Survey not found.', body: 'It may have been removed.', navLabel: 'Admin',
    });
    req.survey = survey;
    next();
  }

  // ---------- Dashboard & builder ----------

  router.get('/', (req, res) => {
    res.render('admin/dashboard', { title: 'Dashboard', surveys: surveys.listSurveys(db) });
  });

  router.get('/surveys/new', (req, res) => {
    res.render('admin/builder', { title: 'New survey', error: null, form: null });
  });

  router.post('/surveys', (req, res) => {
    const parsed = surveys.parseSurveyInput(req.body);
    if (parsed.error) {
      return res.status(400).render('admin/builder', {
        title: 'New survey',
        error: parsed.error,
        form: { name: req.body.name || '', purpose: req.body.purpose || '', questions: req.body.questions || '[]' },
      });
    }
    const id = surveys.createSurvey(db, { ...parsed.value, status: 'live' });
    res.redirect(`/admin/surveys/${id}/published`);
  });

  router.get('/surveys/:id/published', loadSurvey, (req, res) => {
    res.render('admin/preview', {
      title: 'Preview',
      survey: req.survey,
      questions: surveys.getQuestions(db, req.survey.id),
    });
  });

  // ---------- Results ----------

  router.get('/surveys/:id', loadSurvey, (req, res) => {
    const results = surveys.getResults(db, req.survey.id);
    res.render('admin/results', { title: 'Results', ...results });
  });

  router.post('/surveys/:id/status', loadSurvey, (req, res) => {
    const status = req.body.status === 'closed' ? 'closed' : 'live';
    surveys.setStatus(db, req.survey.id, status);
    res.redirect(`/admin/surveys/${req.survey.id}`);
  });

  router.post('/surveys/:id/delete', loadSurvey, (req, res, next) => {
    try {
      surveys.deleteSurvey(db, req.survey.id);
      res.redirect('/admin');
    } catch (err) {
      next(err);
    }
  });

  router.get('/surveys/:id/q/:n', loadSurvey, (req, res) => {
    const question = surveys.getQuestionByPosition(db, req.survey.id, Number(req.params.n));
    if (!question) return res.redirect(`/admin/surveys/${req.survey.id}`);
    res.render('admin/question', {
      title: `Question ${question.position}`,
      survey: req.survey,
      question,
      tally: surveys.questionTally(db, question),
      comments: surveys.getComments(db, question.id),
    });
  });

  router.post('/surveys/:id/comments/:cid/flag', loadSurvey, (req, res) => {
    surveys.setCommentFlag(db, req.survey.id, Number(req.params.cid), req.body.flagged === '1');
    const n = Number(req.body.n) || 1;
    res.redirect(`/admin/surveys/${req.survey.id}/q/${n}#c${Number(req.params.cid)}`);
  });

  // ---------- Codes ----------

  router.get('/surveys/:id/codes', loadSurvey, (req, res) => {
    res.render('admin/codes', {
      title: 'Participant codes',
      survey: req.survey,
      stats: surveys.codeStats(db, req.survey.id),
      latest: surveys.latestCodes(db, req.survey.id, 5),
      generated: Number(req.query.generated) || 0,
      error: null,
      count: 1000,
      linkPrefix: linkPrefix(),
    });
  });

  router.post('/surveys/:id/codes', loadSurvey, (req, res) => {
    const count = Number(req.body.count);
    if (!Number.isInteger(count) || count < 1 || count > config.maxCodesPerBatch) {
      return res.status(400).render('admin/codes', {
        title: 'Participant codes',
        survey: req.survey,
        stats: surveys.codeStats(db, req.survey.id),
        latest: surveys.latestCodes(db, req.survey.id, 5),
        generated: 0,
        error: `Enter a number from 1 to ${config.maxCodesPerBatch}.`,
        count: req.body.count,
        linkPrefix: linkPrefix(),
      });
    }
    const created = generateCodes(db, req.survey.id, count);
    res.redirect(`/admin/surveys/${req.survey.id}/codes?generated=${created.length}`);
  });

  router.get('/surveys/:id/codes.csv', loadSurvey, (req, res) => {
    const rows = surveys.allCodes(db, req.survey.id).map((c) => [c.code, codeLink(c.code), c.used_at || '']);
    res.attachment(`${slug(req.survey.name)}-codes.csv`);
    res.type('text/csv; charset=utf-8').send(toCsv([['code', 'link', 'used_at'], ...rows]));
  });

  // ---------- Exports ----------

  router.get('/surveys/:id/export.csv', loadSurvey, (req, res) => {
    const questions = surveys.getQuestions(db, req.survey.id);
    const header = ['response', 'display_name', 'submitted_at'];
    for (const q of questions) {
      if (q.type === 'yesno') header.push(`Q${q.position} vote: ${q.title}`, `Q${q.position} comments`);
      else if (q.type === 'choice') header.push(`Q${q.position}: ${q.title}`, `Q${q.position} comments`);
      else if (q.fields.length) q.fields.forEach((f) => header.push(`Q${q.position} ${f}: ${q.title}`));
      else header.push(`Q${q.position} answer: ${q.title}`);
    }
    const rows = surveys.getResponsesForExport(db, req.survey.id).map((r, i) => {
      const row = [i + 1, r.display_name, r.submitted_at];
      const textFor = (q, field) =>
        r.comments
          .filter((c) => c.question_id === q.id && (field === undefined || c.field_index === field))
          .map((c) => (c.flagged ? '[flagged] ' : '') + c.body)
          .join('\n---\n');
      for (const q of questions) {
        if (q.type === 'yesno') row.push(r.votes[q.id] || '', textFor(q));
        else if (q.type === 'choice') row.push(r.choices[q.id] !== undefined ? q.options[r.choices[q.id]] : '', textFor(q));
        else if (q.fields.length) q.fields.forEach((f, field) => row.push(textFor(q, field)));
        else row.push(textFor(q));
      }
      return row;
    });
    res.attachment(`${slug(req.survey.name)}-responses.csv`);
    res.type('text/csv; charset=utf-8').send(BOM + toCsv([header, ...rows]));
  });

  router.get('/surveys/:id/report.pdf', loadSurvey, (req, res, next) => {
    const excludeFlagged = req.query.flagged !== 'include';
    const results = surveys.getResults(db, req.survey.id);
    const comments = Object.fromEntries(
      results.questions.map((q) => [q.id, surveys.getComments(db, q.id, { excludeFlagged })])
    );
    try {
      const doc = buildReport({ ...results, comments, excludeFlagged });
      res.type('application/pdf');
      res.set('Content-Disposition', `attachment; filename="${slug(req.survey.name)}-report.pdf"`);
      doc.pipe(res);
      doc.end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

function linkPrefix() {
  try {
    const host = new URL(config.baseUrl).host;
    return '…' + host.split('.').slice(-2).join('.') + '/';
  } catch {
    return '/';
  }
}
