'use strict';
const bcrypt = require('bcrypt');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createSurvey } = require('../src/surveys');
const { generateCodes } = require('../src/codes');

const QUESTIONS = [
  { type: 'yesno', title: 'Enjoyed it?' },
  { type: 'yesno', title: 'Food ok?' },
  { type: 'text', title: 'Anything else?' },
  { type: 'choice', title: 'Rate the food', options: ['Excellent', 'Good', 'Poor', 'Did Not Purchase Food'] },
];

function setupDb() {
  const db = openDb(':memory:');
  const surveyId = createSurvey(db, { name: 'Test Survey', purpose: 'Testing.', questions: QUESTIONS });
  const qids = db.prepare('SELECT id FROM questions WHERE survey_id = ? ORDER BY position').all(surveyId).map((r) => r.id);
  return { db, surveyId, qids };
}

/** Starts the app on a random port. */
async function startServer(auth = {}) {
  const ctx = setupDb();
  ctx.db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run('admin@test.org', bcrypt.hashSync('correct-horse-1', 4));
  const app = createApp({ db: ctx.db, sessionSecret: 'test-secret', auth });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  ctx.server = server;
  ctx.base = `http://127.0.0.1:${server.address().port}`;
  ctx.codes = generateCodes(ctx.db, ctx.surveyId, 10);
  ctx.close = () => new Promise((r) => server.close(r));
  return ctx;
}

function validPayload(qids) {
  return {
    answers: {
      [qids[0]]: { vote: 'yes', comments: ['Great', '  '] },
      [qids[1]]: { vote: 'no' },
      [qids[2]]: { comments: ['More events please'] },
      [qids[3]]: { choice: 1 },
    },
  };
}

module.exports = { setupDb, startServer, validPayload };
