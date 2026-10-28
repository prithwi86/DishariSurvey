'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { setupDb } = require('./helpers');
const { generateCodes } = require('../src/codes');
const { deleteSurvey } = require('../src/surveys');

test('a survey with no codes generated can be deleted', () => {
  const { db, surveyId } = setupDb();
  deleteSurvey(db, surveyId);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM surveys WHERE id = ?').get(surveyId).n, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM questions WHERE survey_id = ?').get(surveyId).n, 0);
});

test('a survey with codes already generated cannot be deleted', () => {
  const { db, surveyId } = setupDb();
  generateCodes(db, surveyId, 1);
  assert.throws(() => deleteSurvey(db, surveyId), /codes have already been generated/i);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM surveys WHERE id = ?').get(surveyId).n, 1);
});

test('deleting an unknown survey throws', () => {
  const { db } = setupDb();
  assert.throws(() => deleteSurvey(db, 9999), /not found/i);
});
