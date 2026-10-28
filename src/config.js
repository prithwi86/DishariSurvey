'use strict';
const path = require('path');

const root = path.resolve(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  root,
  isProduction,
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  // Public base URL used in participant links (no trailing slash).
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  dbPath: path.resolve(root, process.env.DB_PATH || 'data/survey.db'),
  legalPath: path.resolve(root, process.env.LEGAL_PATH || 'design/LEGAL.md'),
  // Secure cookies need HTTPS; on by default in production.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
  sessionSecret: process.env.SESSION_SECRET || null,
  // 'password' (built-in email + password sign-in) or 'proxy' (Google OAuth in front of /admin,
  // e.g. oauth2-proxy via nginx, which passes the signed-in email in a header).
  adminAuth: process.env.ADMIN_AUTH === 'proxy' ? 'proxy' : 'password',
  adminEmailHeader: process.env.ADMIN_EMAIL_HEADER || 'X-Auth-Request-Email',
  // Optional allowlist (comma-separated). Recommended in proxy mode as a second check.
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  adminLogoutUrl: process.env.ADMIN_LOGOUT_URL || '/oauth2/sign_out?rd=/',
  // Optional TTF fonts for the PDF (e.g. Noto Sans + Noto Sans Bengali) for non-Latin text.
  pdfFontRegular: process.env.PDF_FONT_REGULAR || null,
  pdfFontBold: process.env.PDF_FONT_BOLD || null,
  maxCommentLength: 2000,
  maxCommentsPerQuestion: 20,
  maxCodesPerBatch: 5000,
};
