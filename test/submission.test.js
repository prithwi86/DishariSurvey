'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { setupDb, validPayload } = require('./helpers');
const { generateCodes, normaliseCode, ALPHABET } = require('../src/codes');
const { submitResponse, lookupCode, setStatus, SubmitError, getResults } = require('../src/surveys');

test('codes: 8 chars from the unambiguous alphabet, unique, additive', () => {
  const { db, surveyId } = setupDb();
  const first = generateCodes(db, surveyId, 500);
  const second = generateCodes(db, surveyId, 500);
  const all = first.concat(second);
  assert.strictEqual(new Set(all).size, 1000);
  for (const c of all) assert.match(c, new RegExp(`^[${ALPHABET}]{8}$`));
  assert.ok(!/[01OIL]/.test(all.join('')));
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM codes').get().n, 1000);
  assert.throws(() => generateCodes(db, surveyId, 0), RangeError);
  assert.throws(() => generateCodes(db, surveyId, 5001), RangeError);
});

test('normaliseCode accepts lowercase and rejects bad shapes', () => {
  assert.strictEqual(normaliseCode(' abcdefgh '), 'ABCDEFGH');
  assert.strictEqual(normaliseCode('ABCDEFG0'), null); // 0 not in alphabet
  assert.strictEqual(normaliseCode('ABC'), null);
  assert.strictEqual(normaliseCode('../admin'), null);
});

test('one submission per code', () => {
  const { db, surveyId, qids } = setupDb();
  const [code] = generateCodes(db, surveyId, 1);
  const { displayName } = submitResponse(db, code, validPayload(qids));
  assert.match(displayName, /^[a-z]+[1-9][0-9]?$/);

  assert.throws(() => submitResponse(db, code, validPayload(qids)), (e) => e instanceof SubmitError && e.kind === 'used' && e.displayName === displayName);
  assert.deepStrictEqual(lookupCode(db, code), { state: 'used', displayName });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM responses').get().n, 1);
  // Blank comments are dropped.
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM comments').get().n, 2);
  // DB constraint backs up the transaction.
  const codeId = db.prepare('SELECT id FROM codes WHERE code = ?').get(code).id;
  assert.throws(() => db.prepare("INSERT INTO responses (survey_id, code_id, display_name, submitted_at) VALUES (?, ?, 'x', 'now')").run(surveyId, codeId), /UNIQUE/);
});

test('failed validation writes nothing and leaves the code usable', () => {
  const { db, surveyId, qids } = setupDb();
  const [code] = generateCodes(db, surveyId, 1);
  const missingVote = { answers: { [qids[0]]: { vote: 'yes' } } };
  assert.throws(() => submitResponse(db, code, missingVote), (e) => e.kind === 'bad-request');
  const tooLong = validPayload(qids);
  tooLong.answers[qids[2]].comments = ['x'.repeat(2001)];
  assert.throws(() => submitResponse(db, code, tooLong), (e) => e.kind === 'bad-request');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM responses').get().n, 0);
  assert.strictEqual(lookupCode(db, code).state, 'open');
});

test('unknown, closed and draft surveys', () => {
  const { db, surveyId, qids } = setupDb();
  const [code] = generateCodes(db, surveyId, 1);
  assert.strictEqual(lookupCode(db, 'ZZZZZZZZ').state, 'invalid');
  setStatus(db, surveyId, 'closed');
  assert.strictEqual(lookupCode(db, code).state, 'closed');
  assert.throws(() => submitResponse(db, code, validPayload(qids)), (e) => e.kind === 'closed');
  setStatus(db, surveyId, 'draft');
  assert.strictEqual(lookupCode(db, code).state, 'invalid');
});

test('display names are unique per survey and tallies add up', () => {
  const { db, surveyId, qids } = setupDb();
  const codes = generateCodes(db, surveyId, 300);
  const names = codes.map((c) => submitResponse(db, c, validPayload(qids)).displayName);
  assert.strictEqual(new Set(names).size, 300);
  const r = getResults(db, surveyId);
  assert.deepStrictEqual([r.stats.issued, r.stats.used, r.stats.rate], [300, 300, 100]);
  assert.deepStrictEqual([r.questions[0].yes, r.questions[0].no, r.questions[0].yesPct], [300, 0, 100]);
});
