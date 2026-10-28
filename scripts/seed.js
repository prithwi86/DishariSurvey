#!/usr/bin/env node
'use strict';
// Creates the Dishari Agomoni 2026 Survey (status: live). Safe to run twice.
// Usage: node scripts/seed.js
const { openDb } = require('../src/db');
const { createSurvey } = require('../src/surveys');

const SURVEY = {
  name: 'Dishari Agomoni 2026 Survey',
  purpose:
    'The purpose of this survey is to understand your experience at the Agomoni event. We would like to learn about our shortcomings and improve on them in future events. Your feedback will be greatly helpful for Dishari’s growth and sustainability in the coming years.',
  status: 'live',
  questions: [
    {
      type: 'choice',
      title: 'How would you rate your overall experience at Dishari Agomoni 2026?',
      options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'],
    },
    {
      type: 'choice',
      title: 'How satisfied were you with the cultural performances at Agomoni 2026?',
      options: ['Extremely Satisfied', 'Very Satisfied', 'Somewhat Satisfied', 'Dissatisfied', 'Very Dissatisfied'],
    },
    {
      type: 'choice',
      title: 'How would you rate the quality of food offered at Agomoni 2026?',
      options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor', 'Did Not Purchase Food'],
    },
    {
      type: 'choice',
      title: 'How likely are you to come back to Dishari events in 2027?',
      options: ['Definitely Yes', 'Probably Yes', 'Not Sure', 'Probably Not', 'Definitely Not'],
    },
    {
      type: 'choice',
      title: 'Would you like to be associated with future Dishari Events?',
      options: ['Definitely Yes', 'Probably Yes', 'Not Sure', 'Probably Not', 'Definitely Not'],
    },
    {
      type: 'text',
      title: 'What could Dishari do better in future events?',
      fields: ['Artist Selection', 'Food', 'Venue Location', 'Other'],
    },
    {
      type: 'text',
      title: 'Please share any suggestions, constructive feedback, or ideas that could help us improve your experience in future events.',
    },
  ],
};

const db = openDb();
const existing = db.prepare('SELECT id FROM surveys WHERE name = ?').get(SURVEY.name);
if (existing) {
  console.log(`"${SURVEY.name}" already exists (id ${existing.id}). Nothing to do.`);
} else {
  const id = createSurvey(db, SURVEY);
  console.log(`Created "${SURVEY.name}" with id ${id} and ${SURVEY.questions.length} questions.`);
  console.log(`Next: node scripts/gen-codes.js --survey ${id} --count 1000 > codes.csv`);
}
db.close();
