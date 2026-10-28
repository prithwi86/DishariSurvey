'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

// options: JSON array of option labels ('choice'), or of text-box labels for a 'text' question with several boxes.
const QUESTIONS_TABLE = (name) => `CREATE TABLE IF NOT EXISTS ${name} (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
                        position INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('yesno','choice','text')),
                        title TEXT NOT NULL, context TEXT,
                        options TEXT)`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS surveys   (id INTEGER PRIMARY KEY, name TEXT NOT NULL, purpose TEXT,
                        status TEXT NOT NULL CHECK(status IN ('draft','live','closed')), created_at TEXT NOT NULL);
${QUESTIONS_TABLE('questions')};
CREATE TABLE IF NOT EXISTS codes     (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
                        code TEXT NOT NULL, used_at TEXT, UNIQUE(survey_id, code));
CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
                        code_id INTEGER NOT NULL UNIQUE REFERENCES codes(id),
                        display_name TEXT NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(survey_id, display_name));
CREATE TABLE IF NOT EXISTS votes     (response_id INTEGER NOT NULL REFERENCES responses(id), question_id INTEGER NOT NULL REFERENCES questions(id),
                        vote TEXT NOT NULL CHECK(vote IN ('yes','no')), PRIMARY KEY(response_id, question_id));
CREATE TABLE IF NOT EXISTS choices   (response_id INTEGER NOT NULL REFERENCES responses(id), question_id INTEGER NOT NULL REFERENCES questions(id),
                        option_index INTEGER NOT NULL, PRIMARY KEY(response_id, question_id));
                        -- answers to 'choice' questions: index into questions.options
CREATE TABLE IF NOT EXISTS comments  (id INTEGER PRIMARY KEY, response_id INTEGER NOT NULL REFERENCES responses(id),
                        question_id INTEGER NOT NULL REFERENCES questions(id), body TEXT NOT NULL,
                        created_at TEXT NOT NULL, flagged INTEGER NOT NULL DEFAULT 0,
                        field_index INTEGER); -- which text box, for 'text' questions with several boxes
CREATE TABLE IF NOT EXISTS admins    (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions  (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);

-- Participant URLs are /<code> with no survey id, so codes must be unique across all surveys.
CREATE UNIQUE INDEX IF NOT EXISTS codes_code ON codes(code);
CREATE INDEX IF NOT EXISTS questions_survey ON questions(survey_id, position);
CREATE INDEX IF NOT EXISTS comments_question ON comments(question_id);
CREATE INDEX IF NOT EXISTS votes_question ON votes(question_id);
CREATE INDEX IF NOT EXISTS choices_question ON choices(question_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
`;

function openDb(file = config.dbPath) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  if (file !== ':memory:') {
    try { fs.chmodSync(file, 0o600); } catch { /* not owner; leave as is */ }
  }
  return db;
}

/**
 * v1 databases had questions.type limited to yesno/text and no options column.
 * SQLite can't alter a CHECK constraint, so rebuild the table (the documented
 * create-copy-drop-rename procedure, with foreign keys off).
 */
function migrate(db) {
  // v2 → v3: written questions can have several labelled text boxes.
  const commentCols = db.pragma('table_info(comments)').map((c) => c.name);
  if (!commentCols.includes('field_index')) db.exec('ALTER TABLE comments ADD COLUMN field_index INTEGER');

  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'questions'").get();
  if (!row || row.sql.includes("'choice'")) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`${QUESTIONS_TABLE('questions_v2')};
        INSERT INTO questions_v2 (id, survey_id, position, type, title, context)
          SELECT id, survey_id, position, type, title, context FROM questions;
        DROP TABLE questions;
        ALTER TABLE questions_v2 RENAME TO questions;
        CREATE INDEX IF NOT EXISTS questions_survey ON questions(survey_id, position);`);
      const broken = db.pragma('foreign_key_check');
      if (broken.length) throw new Error('Foreign key check failed after migrating questions');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

module.exports = { openDb };
