'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./src/config');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

/** SESSION_SECRET from the environment, else a random one kept next to the database. */
function sessionSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  const file = path.join(path.dirname(config.dbPath), 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('base64url');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

if (config.adminAuth === 'proxy') {
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
    console.error('ADMIN_AUTH=proxy requires HOST=127.0.0.1 so only nginx can reach the app.');
    process.exit(1);
  }
  console.log(`Admin sign-in: Google OAuth gate (header ${config.adminEmailHeader}).`);
  if (!config.adminEmails.length) {
    console.warn('Warning: ADMIN_EMAILS is not set, so any account the Google gate lets through can use /admin.');
  }
}

const db = openDb();
const app = createApp({ db, sessionSecret: sessionSecret() });

const server = app.listen(config.port, config.host, () => {
  console.log(`Dishari survey listening on http://${config.host}:${config.port} (links use ${config.baseUrl})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
