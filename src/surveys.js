'use strict';
const config = require('./config');
const { uniqueDisplayName } = require('./names');

const now = () => new Date().toISOString();
const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);

const QUESTION_TYPES = ['yesno', 'choice', 'text'];
const MAX_OPTIONS = 12;

/**
 * Parses the stored JSON list onto the question row:
 * options = answer options ('choice'); fields = text-box labels ('text' with several boxes).
 */
function hydrate(q) {
  if (!q) return q;
  let list = [];
  if (q.options) {
    try { list = JSON.parse(q.options) || []; } catch { list = []; }
  }
  return { ...q, options: q.type === 'choice' ? list : [], fields: q.type === 'text' ? list : [] };
}

/** Cleans a list of labels typed in the builder. Returns { list } or { error }. */
function cleanLabels(raw, title, what) {
  const list = (Array.isArray(raw) ? raw : []).map((o) => String(o || '').trim()).filter(Boolean);
  if (list.length > MAX_OPTIONS) return { error: `A question can have at most ${MAX_OPTIONS} ${what}s.` };
  if (list.some((o) => o.length > 200)) return { error: `A ${what} label is too long.` };
  if (new Set(list.map((o) => o.toLowerCase())).size !== list.length) return { error: `“${title}” has the same ${what} twice.` };
  return { list };
}

class SubmitError extends Error {
  constructor(kind, extra = {}) {
    super(kind);
    this.kind = kind; // 'invalid' | 'used' | 'closed' | 'bad-request'
    Object.assign(this, extra);
  }
}

// ---------- Surveys & questions ----------

// What goes in questions.options: choice options, or text-box labels when there are several boxes.
function listFor(q) {
  if (q.type === 'choice') return JSON.stringify(q.options);
  if (q.type === 'text' && q.fields && q.fields.length) return JSON.stringify(q.fields);
  return null;
}

function createSurvey(db, { name, purpose, status = 'live', questions }) {
  return db.transaction(() => {
    const { lastInsertRowid: surveyId } = db
      .prepare('INSERT INTO surveys (name, purpose, status, created_at) VALUES (?, ?, ?, ?)')
      .run(name, purpose || null, status, now());
    const insertQ = db.prepare(
      'INSERT INTO questions (survey_id, position, type, title, context, options) VALUES (?, ?, ?, ?, ?, ?)'
    );
    questions.forEach((q, i) =>
      insertQ.run(surveyId, i + 1, q.type, q.title, q.context || null, listFor(q))
    );
    return Number(surveyId);
  })();
}

/** Validates the builder's form input. Returns { value } or { error }. */
function parseSurveyInput({ name, purpose, questions }) {
  name = String(name || '').trim();
  purpose = String(purpose || '').trim();
  let list;
  try {
    list = typeof questions === 'string' ? JSON.parse(questions) : questions;
  } catch {
    return { error: 'The question list could not be read.' };
  }
  if (!name) return { error: 'Add a survey name.' };
  if (name.length > 200) return { error: 'The survey name is too long.' };
  if (purpose.length > 4000) return { error: 'The purpose is too long.' };
  if (!Array.isArray(list) || list.length === 0) return { error: 'Add at least one question.' };
  if (list.length > 100) return { error: 'A survey can have at most 100 questions.' };
  const clean = [];
  for (const q of list) {
    const type = q && QUESTION_TYPES.includes(q.type) ? q.type : null;
    const title = String((q && q.title) || '').trim();
    const context = String((q && q.context) || '').trim();
    if (!type || !title) return { error: 'Every question needs a type and a title.' };
    if (title.length > 500 || context.length > 2000) return { error: 'A question is too long.' };
    const item = { type, title, context };
    if (type === 'choice') {
      const r = cleanLabels(q.options, title, 'option');
      if (r.error) return r;
      if (r.list.length < 2) return { error: `“${title}” needs at least 2 options.` };
      item.options = r.list;
    }
    if (type === 'text') {
      const r = cleanLabels(q.fields, title, 'text box');
      if (r.error) return r;
      if (r.list.length) item.fields = r.list; // none = one unlabelled box
    }
    clean.push(item);
  }
  return { value: { name, purpose, questions: clean } };
}

function getSurvey(db, id) {
  return db.prepare('SELECT * FROM surveys WHERE id = ?').get(id) || null;
}

function getQuestions(db, surveyId) {
  return db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position').all(surveyId).map(hydrate);
}

function setStatus(db, surveyId, status) {
  if (!['draft', 'live', 'closed'].includes(status)) throw new Error('bad status');
  db.prepare('UPDATE surveys SET status = ? WHERE id = ?').run(status, surveyId);
}

function codeStats(db, surveyId) {
  const row = db
    .prepare('SELECT COUNT(*) AS issued, COUNT(used_at) AS used FROM codes WHERE survey_id = ?')
    .get(surveyId);
  return { issued: row.issued, used: row.used, unused: row.issued - row.used, rate: pct(row.used, row.issued) };
}

function listSurveys(db) {
  return db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM questions q WHERE q.survey_id = s.id) AS question_count,
         (SELECT COUNT(*) FROM codes c WHERE c.survey_id = s.id) AS issued,
         (SELECT COUNT(used_at) FROM codes c WHERE c.survey_id = s.id) AS used
       FROM surveys s ORDER BY s.created_at DESC, s.id DESC`
    )
    .all();
}

// ---------- Codes ----------

function latestCodes(db, surveyId, limit = 5) {
  return db.prepare('SELECT code FROM codes WHERE survey_id = ? ORDER BY id DESC LIMIT ?').all(surveyId, limit);
}

function allCodes(db, surveyId) {
  return db.prepare('SELECT code, used_at FROM codes WHERE survey_id = ? ORDER BY id').all(surveyId);
}

/** Looks up a participant code and works out which screen it should see. */
function lookupCode(db, code) {
  const row = db
    .prepare(
      `SELECT c.id AS code_id, c.used_at, s.id AS survey_id, s.status, r.display_name
       FROM codes c JOIN surveys s ON s.id = c.survey_id
       LEFT JOIN responses r ON r.code_id = c.id
       WHERE c.code = ?`
    )
    .get(code);
  if (!row || row.status === 'draft') return { state: 'invalid' };
  if (row.used_at) return { state: 'used', displayName: row.display_name };
  if (row.status === 'closed') return { state: 'closed' };
  return { state: 'open', codeId: row.code_id, survey: getSurvey(db, row.survey_id) };
}

// ---------- Submission ----------

/**
 * Normalises the participant payload against the survey's questions.
 * payload.answers = { [questionId]: { vote: 'yes'|'no', choice: <option index>, comments: [string] } }
 * Yes/No and multiple-choice answers are required; comments and written answers are optional.
 * Multiple-choice questions take no comments.
 */
function normaliseAnswers(questions, payload) {
  const answers = (payload && typeof payload.answers === 'object' && payload.answers) || {};
  const out = [];
  for (const q of questions) {
    const a = answers[q.id] || {};
    const vote = a.vote === 'yes' || a.vote === 'no' ? a.vote : null;
    if (q.type === 'yesno' && !vote) throw new SubmitError('bad-request', { message: `Missing vote for question ${q.position}` });
    let choice = null;
    if (q.type === 'choice') {
      choice = a.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) {
        throw new SubmitError('bad-request', { message: `Missing answer for question ${q.position}` });
      }
    }
    const clean = (c) => {
      if (c == null) return '';
      if (typeof c !== 'string') throw new SubmitError('bad-request', { message: 'Bad comment' });
      const body = c.trim();
      if (body.length > config.maxCommentLength) throw new SubmitError('bad-request', { message: 'Comment too long' });
      return body;
    };
    // comments: [{ body, field }] — field is the text-box index, or null.
    const comments = [];
    if (q.type === 'text' && q.fields.length) {
      const raw = Array.isArray(a.fields) ? a.fields : [];
      if (raw.length > q.fields.length) throw new SubmitError('bad-request', { message: 'Too many text boxes' });
      raw.forEach((c, field) => {
        const body = clean(c);
        if (body) comments.push({ body, field });
      });
    } else if (q.type !== 'choice') {
      const raw = Array.isArray(a.comments) ? a.comments : [];
      if (raw.length > config.maxCommentsPerQuestion) throw new SubmitError('bad-request', { message: 'Too many comments' });
      for (const c of raw) {
        const body = clean(c);
        if (body) comments.push({ body, field: null });
      }
    }
    out.push({ question: q, vote: q.type === 'yesno' ? vote : null, choice, comments });
  }
  return out;
}

/**
 * One transaction: check the code is unused → insert response, votes, comments → mark code used.
 * The UNIQUE constraint on responses.code_id is the final guard against double submits.
 */
function submitResponse(db, code, payload) {
  const tx = db.transaction(() => {
    const found = lookupCode(db, code);
    if (found.state !== 'open') throw new SubmitError(found.state, { displayName: found.displayName });

    const questions = getQuestions(db, found.survey.id);
    const answers = normaliseAnswers(questions, payload);
    const ts = now();

    const nameTaken = db.prepare('SELECT 1 FROM responses WHERE survey_id = ? AND display_name = ?');
    const displayName = uniqueDisplayName((n) => !!nameTaken.get(found.survey.id, n));

    const { lastInsertRowid: responseId } = db
      .prepare('INSERT INTO responses (survey_id, code_id, display_name, submitted_at) VALUES (?, ?, ?, ?)')
      .run(found.survey.id, found.codeId, displayName, ts);

    const insVote = db.prepare('INSERT INTO votes (response_id, question_id, vote) VALUES (?, ?, ?)');
    const insChoice = db.prepare('INSERT INTO choices (response_id, question_id, option_index) VALUES (?, ?, ?)');
    const insComment = db.prepare(
      'INSERT INTO comments (response_id, question_id, body, created_at, field_index) VALUES (?, ?, ?, ?, ?)'
    );
    for (const a of answers) {
      if (a.vote) insVote.run(responseId, a.question.id, a.vote);
      if (a.choice !== null) insChoice.run(responseId, a.question.id, a.choice);
      for (const c of a.comments) insComment.run(responseId, a.question.id, c.body, ts, c.field);
    }

    const marked = db.prepare('UPDATE codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(ts, found.codeId);
    if (marked.changes !== 1) throw new SubmitError('used');
    return { displayName, responseId: Number(responseId) };
  });

  try {
    return tx.immediate();
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE' && /code_id/.test(err.message)) {
      const again = lookupCode(db, code);
      throw new SubmitError('used', { displayName: again.displayName });
    }
    throw err;
  }
}

// ---------- Results ----------

function tally(db, questionId) {
  const row = db
    .prepare(
      `SELECT SUM(vote = 'yes') AS yes, SUM(vote = 'no') AS no FROM votes WHERE question_id = ?`
    )
    .get(questionId);
  const yes = row.yes || 0;
  const no = row.no || 0;
  return { yes, no, total: yes + no, yesPct: pct(yes, yes + no), noPct: pct(no, yes + no) };
}

/** Counts per option for a multiple-choice question, in the question's option order. */
function choiceTally(db, q) {
  const counts = new Map(
    db.prepare('SELECT option_index, COUNT(*) AS n FROM choices WHERE question_id = ? GROUP BY option_index').all(q.id)
      .map((r) => [r.option_index, r.n])
  );
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    total,
    options: q.options.map((label, i) => ({ label, count: counts.get(i) || 0, pct: pct(counts.get(i) || 0, total) })),
  };
}

/** Tally for whichever closed question type this is, or null for written questions. */
function questionTally(db, q) {
  if (q.type === 'yesno') return tally(db, q.id);
  if (q.type === 'choice') return choiceTally(db, q);
  return null;
}

function getComments(db, questionId, { excludeFlagged = false } = {}) {
  return db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.flagged, c.field_index, r.display_name
       FROM comments c JOIN responses r ON r.id = c.response_id
       WHERE c.question_id = ? ${excludeFlagged ? 'AND c.flagged = 0' : ''}
       ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(questionId);
}

function questionSummary(db, q) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE question_id = ?').get(q.id).n;
  const summary = { ...q, n: q.position, commentCount: count };
  if (q.type === 'yesno') Object.assign(summary, tally(db, q.id));
  else if (q.type === 'choice') summary.tally = choiceTally(db, q);
  else {
    const latest = db
      .prepare('SELECT body FROM comments WHERE question_id = ? AND flagged = 0 ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(q.id);
    summary.snippet = latest ? latest.body : null;
    if (q.fields.length) {
      const counts = new Map(
        db.prepare('SELECT field_index, COUNT(*) AS n FROM comments WHERE question_id = ? GROUP BY field_index').all(q.id)
          .map((r) => [r.field_index, r.n])
      );
      summary.fieldCounts = q.fields.map((label, i) => ({ label, count: counts.get(i) || 0 }));
    }
  }
  return summary;
}

function getResults(db, surveyId) {
  const survey = getSurvey(db, surveyId);
  if (!survey) return null;
  const questions = getQuestions(db, surveyId).map((q) => questionSummary(db, q));
  return { survey, questions, stats: codeStats(db, surveyId) };
}

function getQuestionByPosition(db, surveyId, position) {
  return hydrate(db.prepare('SELECT * FROM questions WHERE survey_id = ? AND position = ?').get(surveyId, position)) || null;
}

function setCommentFlag(db, surveyId, commentId, flagged) {
  return db
    .prepare(
      `UPDATE comments SET flagged = ? WHERE id = ?
         AND question_id IN (SELECT id FROM questions WHERE survey_id = ?)`
    )
    .run(flagged ? 1 : 0, commentId, surveyId).changes;
}

/** All responses with their votes and comments, for the CSV export. */
function getResponsesForExport(db, surveyId) {
  const responses = db
    .prepare('SELECT id, display_name, submitted_at FROM responses WHERE survey_id = ? ORDER BY submitted_at, id')
    .all(surveyId);
  const votes = db.prepare('SELECT question_id, vote FROM votes WHERE response_id = ?');
  const choices = db.prepare('SELECT question_id, option_index FROM choices WHERE response_id = ?');
  const comments = db.prepare('SELECT question_id, body, flagged, field_index FROM comments WHERE response_id = ? ORDER BY id');
  return responses.map((r) => ({
    ...r,
    votes: Object.fromEntries(votes.all(r.id).map((v) => [v.question_id, v.vote])),
    choices: Object.fromEntries(choices.all(r.id).map((c) => [c.question_id, c.option_index])),
    comments: comments.all(r.id),
  }));
}

module.exports = {
  SubmitError,
  createSurvey,
  parseSurveyInput,
  getSurvey,
  getQuestions,
  setStatus,
  codeStats,
  listSurveys,
  latestCodes,
  allCodes,
  lookupCode,
  submitResponse,
  tally,
  choiceTally,
  questionTally,
  QUESTION_TYPES,
  getComments,
  getResults,
  getQuestionByPosition,
  setCommentFlag,
  getResponsesForExport,
};
