'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { setupDb, validPayload } = require('./helpers');
const { generateCodes } = require('../src/codes');
const { openDb } = require('../src/db');
const { submitResponse, getResults, getQuestions, parseSurveyInput, getResponsesForExport } = require('../src/surveys');

test('multiple-choice answers are required and must be a valid option', () => {
  const { db, surveyId, qids } = setupDb();
  const [code] = generateCodes(db, surveyId, 1);
  for (const bad of [undefined, -1, 4, 1.5, '1']) {
    const p = validPayload(qids);
    p.answers[qids[3]] = { choice: bad };
    assert.throws(() => submitResponse(db, code, p), (e) => e.kind === 'bad-request', `choice=${bad}`);
  }
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM responses').get().n, 0);
});

test('choices are stored, tallied per option, and take no comments', () => {
  const { db, surveyId, qids } = setupDb();
  const codes = generateCodes(db, surveyId, 4);
  [0, 1, 1, 3].forEach((choice, i) => {
    const p = validPayload(qids);
    p.answers[qids[3]] = { choice, comments: ['should be ignored'] };
    submitResponse(db, codes[i], p);
  });
  const q = getResults(db, surveyId).questions[3];
  assert.strictEqual(q.tally.total, 4);
  assert.deepStrictEqual(q.tally.options.map((o) => [o.label, o.count, o.pct]), [
    ['Excellent', 1, 25], ['Good', 2, 50], ['Poor', 0, 0], ['Did Not Purchase Food', 1, 25],
  ]);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM comments WHERE question_id = ?').get(qids[3]).n, 0);
  const exported = getResponsesForExport(db, surveyId);
  assert.strictEqual(exported[0].choices[qids[3]], 0);
});

test('a written answer may be left blank', () => {
  const { db, surveyId, qids } = setupDb();
  const [code] = generateCodes(db, surveyId, 1);
  const p = validPayload(qids);
  p.answers[qids[2]] = { comments: [] };
  assert.ok(submitResponse(db, code, p).displayName);
});

test('builder input: choice questions need 2+ distinct options', () => {
  const base = { name: 'S', purpose: '' };
  const q = (options) => JSON.stringify([{ type: 'choice', title: 'Pick', options }]);
  assert.match(parseSurveyInput({ ...base, questions: q(['Only one']) }).error, /at least 2 options/);
  assert.match(parseSurveyInput({ ...base, questions: q(['A', 'a']) }).error, /same option twice/);
  const ok = parseSurveyInput({ ...base, questions: q([' A ', '', 'B']) });
  assert.deepStrictEqual(ok.value.questions[0].options, ['A', 'B']);
  assert.ok(parseSurveyInput({ ...base, questions: JSON.stringify([{ type: 'text', title: 'Why?' }]) }).value);
});

test('a v1 database (no choice type) is migrated on open, keeping its data', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dishari-')), 'v1.db');
  const v1 = new Database(file);
  v1.exec(`
    CREATE TABLE surveys (id INTEGER PRIMARY KEY, name TEXT NOT NULL, purpose TEXT, status TEXT NOT NULL CHECK(status IN ('draft','live','closed')), created_at TEXT NOT NULL);
    CREATE TABLE questions (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id), position INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('yesno','text')), title TEXT NOT NULL, context TEXT);
    CREATE TABLE codes (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id), code TEXT NOT NULL, used_at TEXT, UNIQUE(survey_id, code));
    CREATE TABLE responses (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id), code_id INTEGER NOT NULL UNIQUE REFERENCES codes(id), display_name TEXT NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(survey_id, display_name));
    CREATE TABLE votes (response_id INTEGER NOT NULL REFERENCES responses(id), question_id INTEGER NOT NULL REFERENCES questions(id), vote TEXT NOT NULL CHECK(vote IN ('yes','no')), PRIMARY KEY(response_id, question_id));
    INSERT INTO surveys VALUES (1, 'Old', NULL, 'live', 'now');
    INSERT INTO questions VALUES (1, 1, 1, 'yesno', 'Old question', NULL);
    INSERT INTO codes VALUES (1, 1, 'ABCDEFGH', 'now');
    INSERT INTO responses VALUES (1, 1, 1, 'redkoel1', 'now');
    INSERT INTO votes VALUES (1, 1, 'yes');`);
  v1.close();

  const db = openDb(file);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'questions'").get().sql, /'choice'/);
  assert.strictEqual(getQuestions(db, 1)[0].title, 'Old question');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM votes v JOIN questions q ON q.id = v.question_id').get().n, 1);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.prepare("INSERT INTO questions (survey_id, position, type, title, options) VALUES (1, 2, 'choice', 'New', '[\"A\",\"B\"]')").run();
  db.close();
});
