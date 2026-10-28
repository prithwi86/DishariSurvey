'use strict';
const express = require('express');
const { normaliseCode } = require('../codes');
const { lookupCode, getQuestions, submitResponse, SubmitError } = require('../surveys');
const { createLimiter, noStore } = require('../security');
const { jsonForScript } = require('../format');

const WINDOW = 15 * 60 * 1000;

const MESSAGES = {
  invalid: {
    status: 404,
    kicker: 'Link not recognised',
    heading: "This link isn't valid.",
    body: 'Please check the link in your email.',
  },
  used: {
    status: 200,
    kicker: 'Already submitted',
    heading: "You've already submitted this survey.",
    body: 'Thank you!',
  },
  closed: {
    status: 410,
    kicker: 'Survey closed',
    heading: 'This survey is now closed.',
    body: 'Thank you for your interest. We hope to see you at the next event.',
  },
  limited: {
    status: 429,
    kicker: 'Please wait',
    heading: 'Too many attempts.',
    body: 'Please wait a few minutes, then open the link from your email again.',
  },
};

module.exports = function participantRoutes({ db }) {
  const router = express.Router();
  // All lookups per IP (generous: households and offices share IPs) …
  const lookups = createLimiter({ windowMs: WINDOW, max: 120 });
  // … and a tighter cap on unknown codes, which is what guessing looks like.
  const misses = createLimiter({ windowMs: WINDOW, max: 20 });

  function renderMessage(res, kind, extra = {}) {
    const m = MESSAGES[kind];
    res.status(m.status).render('message', { title: 'Dishari Survey', navLabel: 'Survey', ...m, ...extra });
  }

  /** Shared guard: rate limits, then resolves the code. Returns null when a response was sent. */
  function resolve(req, res, onLimited) {
    const ip = req.ip;
    if (lookups.isLimited(ip) || misses.isLimited(ip)) {
      onLimited();
      return null;
    }
    lookups.hit(ip);
    const code = normaliseCode(req.params.code);
    if (!code) return { code: null, found: { state: 'invalid' } };
    const found = lookupCode(db, code);
    if (found.state === 'invalid') misses.hit(ip);
    return { code, found };
  }

  router.get('/:code', noStore, (req, res) => {
    const r = resolve(req, res, () => renderMessage(res, 'limited'));
    if (!r) return;
    const { code, found } = r;
    if (found.state === 'used') return renderMessage(res, 'used', { displayName: found.displayName });
    if (found.state !== 'open') return renderMessage(res, found.state);

    const questions = getQuestions(db, found.survey.id);
    res.render('participant/survey', {
      title: found.survey.name,
      survey: found.survey,
      questions,
      code,
      surveyJson: jsonForScript({
        code,
        total: questions.length,
        questions: questions.map((q) => ({ id: q.id, type: q.type, boxes: q.fields.length })),
      }),
    });
  });

  router.post('/:code', noStore, express.json({ limit: '200kb' }), (req, res) => {
    const r = resolve(req, res, () => res.status(429).json({ error: 'limited' }));
    if (!r) return;
    if (!r.code) return res.status(404).json({ error: 'invalid' });
    try {
      const { displayName } = submitResponse(db, r.code, req.body);
      res.json({ ok: true, displayName });
    } catch (err) {
      if (!(err instanceof SubmitError)) throw err;
      const status = { invalid: 404, used: 409, closed: 410, 'bad-request': 400 }[err.kind] || 400;
      res.status(status).json({ error: err.kind, displayName: err.displayName || undefined });
    }
  });

  return router;
};
