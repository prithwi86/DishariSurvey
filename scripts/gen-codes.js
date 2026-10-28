#!/usr/bin/env node
'use strict';
// Adds new participant codes to a survey and prints them as CSV (code,link).
// Usage: node scripts/gen-codes.js --survey 1 --count 1000 > codes.csv
// Links use BASE_URL, e.g. BASE_URL=https://www.survey.dishariboston.org
const { openDb } = require('../src/db');
const { generateCodes, codeLink } = require('../src/codes');
const { toCsv } = require('../src/csv');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const surveyId = parseInt(arg('survey'), 10);
const count = parseInt(arg('count') || '1000', 10);
if (!surveyId) {
  console.error('Usage: node scripts/gen-codes.js --survey <id> --count <n> > codes.csv');
  process.exit(1);
}

const db = openDb();
try {
  const codes = generateCodes(db, surveyId, count);
  process.stdout.write(toCsv([['code', 'link'], ...codes.map((c) => [c, codeLink(c)])]));
  console.error(`${codes.length} new codes generated for survey ${surveyId}.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
