'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDb } = require('../src/db');
const { generateCodes } = require('../src/codes');
const { createSurvey, getQuestions, submitResponse, getResults, getComments, parseSurveyInput } = require('../src/surveys');

function setup() {
  const db = openDb(':memory:');
  const surveyId = createSurvey(db, {
    name: 'Boxes',
    questions: [
      { type: 'text', title: 'What could we do better?', fields: ['Artist Selection', 'Food', 'Venue Location', 'Other'] },
      { type: 'text', title: 'Anything else?' },
    ],
  });
  const [multi, single] = getQuestions(db, surveyId);
  return { db, surveyId, multi, single };
}

test('several text boxes: each answer is stored against its box; blanks are skipped', () => {
  const { db, surveyId, multi, single } = setup();
  assert.deepStrictEqual(multi.fields, ['Artist Selection', 'Food', 'Venue Location', 'Other']);
  assert.deepStrictEqual(single.fields, []);
  const [code] = generateCodes(db, surveyId, 1);
  submitResponse(db, code, {
    answers: { [multi.id]: { fields: ['More folk music', '  ', null, 'Parking'] }, [single.id]: { comments: ['Thanks!'] } },
  });
  const rows = getComments(db, multi.id).map((c) => [c.field_index, c.body]).sort();
  assert.deepStrictEqual(rows, [[0, 'More folk music'], [3, 'Parking']]);
  assert.deepStrictEqual(getComments(db, single.id).map((c) => c.field_index), [null]);
  const summary = getResults(db, surveyId).questions[0];
  assert.deepStrictEqual(summary.fieldCounts.map((f) => f.count), [1, 0, 0, 1]);
});

test('all boxes may be left empty, but not more boxes than the question has', () => {
  const { db, surveyId, multi } = setup();
  const [a, b] = generateCodes(db, surveyId, 2);
  assert.ok(submitResponse(db, a, { answers: {} }).displayName);
  assert.throws(() => submitResponse(db, b, { answers: { [multi.id]: { fields: ['1', '2', '3', '4', '5'] } } }), (e) => e.kind === 'bad-request');
  assert.throws(() => submitResponse(db, b, { answers: { [multi.id]: { fields: ['x'.repeat(2001)] } } }), (e) => e.kind === 'bad-request');
});

test('builder input: written questions take optional, distinct box labels', () => {
  const q = (fields) => JSON.stringify([{ type: 'text', title: 'Better?', fields }]);
  assert.deepStrictEqual(parseSurveyInput({ name: 'S', questions: q([' Food ', '', 'Venue']) }).value.questions[0].fields, ['Food', 'Venue']);
  assert.strictEqual(parseSurveyInput({ name: 'S', questions: q([]) }).value.questions[0].fields, undefined);
  assert.match(parseSurveyInput({ name: 'S', questions: q(['Food', 'food']) }).error, /same text box twice/);
});

test('a v2 database gains comments.field_index on open', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dishari-')), 'v2.db');
  const v2 = new Database(file);
  v2.exec(`CREATE TABLE comments (id INTEGER PRIMARY KEY, response_id INTEGER NOT NULL, question_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, flagged INTEGER NOT NULL DEFAULT 0);
           INSERT INTO comments VALUES (1, 1, 1, 'kept', 'now', 0);`);
  v2.close();
  const db = openDb(file);
  assert.ok(db.pragma('table_info(comments)').some((c) => c.name === 'field_index'));
  assert.deepStrictEqual(db.prepare('SELECT body, field_index FROM comments').get(), { body: 'kept', field_index: null });
  db.close();
});
