'use strict';
const crypto = require('crypto');
const config = require('./config');

// No 0/O/1/I/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function normaliseCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/**
 * Adds `count` new codes to a survey. Never touches existing codes.
 * Returns the new codes in insertion order.
 */
function generateCodes(db, surveyId, count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1 || n > config.maxCodesPerBatch) {
    throw new RangeError(`count must be between 1 and ${config.maxCodesPerBatch}`);
  }
  const survey = db.prepare('SELECT id FROM surveys WHERE id = ?').get(surveyId);
  if (!survey) throw new Error(`Survey ${surveyId} not found`);

  const insert = db.prepare('INSERT OR IGNORE INTO codes (survey_id, code) VALUES (?, ?)');
  return db.transaction(() => {
    const created = [];
    while (created.length < n) {
      const code = randomCode();
      if (insert.run(surveyId, code).changes === 1) created.push(code);
    }
    return created;
  })();
}

function codeLink(code) {
  return `${config.baseUrl}/${code}`;
}

module.exports = { ALPHABET, CODE_LENGTH, generateCodes, normaliseCode, codeLink, randomCode };
