#!/usr/bin/env node
'use strict';
// Creates an admin, or resets their password if the email already exists.
// Usage: node scripts/create-admin.js you@dishari.org
// (Set ADMIN_PASSWORD to skip the prompt, e.g. in automation.)
const readline = require('readline');
const bcrypt = require('bcrypt');
const { openDb } = require('../src/db');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/create-admin.js you@dishari.org');
  process.exit(1);
}

/** Prompts without echoing the typed characters. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('Password (min 10 characters): ');
    const again = await askHidden('Repeat password: ');
    if (password !== again) {
      console.error('Passwords do not match.');
      process.exit(1);
    }
  }
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  const db = openDb();
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`Password updated for ${email}.`);
  } else {
    db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email, hash);
    console.log(`Admin ${email} created. Sign in at /admin.`);
  }
  db.close();
})();
