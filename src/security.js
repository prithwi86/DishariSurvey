'use strict';
const crypto = require('crypto');

/**
 * Fixed-window in-memory rate limiter keyed by IP. Fine for a single Node process.
 * hit(key) counts an attempt; isLimited(key) checks without counting.
 */
function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }, windowMs);
  timer.unref();

  function entry(key) {
    const t = Date.now();
    let e = hits.get(key);
    if (!e || e.reset <= t) {
      e = { count: 0, reset: t + windowMs };
      hits.set(key, e);
    }
    return e;
  }

  return {
    hit(key) {
      entry(key).count++;
    },
    isLimited(key) {
      return entry(key).count >= max;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Participant URLs contain the code, so never send them as a referrer.
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
}

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

// ---------- CSRF (synchroniser token stored in the session) ----------

function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

function verifyCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session && req.session.csrf;
  const ok =
    expected &&
    typeof sent === 'string' &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return res.status(403).render('message', {
    title: 'Session expired',
    kicker: 'Admin',
    heading: 'Please try again.',
    body: 'Your session expired or the form was out of date. Go back, reload the page and try again.',
    navLabel: 'Admin',
  });
  next();
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Proxy mode: trust the email header set by the Google OAuth gate (nginx + oauth2-proxy).
 * Only accepted from a loopback peer (nginx on the same machine), never as a fallback.
 */
function proxyAdminGate({ header, allowedEmails }) {
  return (req, res, next) => {
    const email = String(req.get(header) || '').trim().toLowerCase();
    const fromProxy = LOOPBACK.has(req.socket.remoteAddress);
    const allowed = !allowedEmails.length || allowedEmails.includes(email);
    if (!email || !fromProxy || !allowed) {
      return res.status(403).render('message', {
        title: 'Access denied',
        kicker: 'Admin',
        heading: 'Access denied.',
        body: "Sign in with an authorised Dishari Google account to use the admin area.",
        navLabel: 'Admin',
      });
    }
    req.proxyAdmin = email;
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.proxyAdmin || (req.session && req.session.adminId)) return next();
  if (req.method === 'GET') return res.redirect('/admin/login');
  return res.status(401).send('Not signed in');
}

module.exports = { createLimiter, securityHeaders, noStore, csrfToken, verifyCsrf, requireAdmin, proxyAdminGate, LOOPBACK };
