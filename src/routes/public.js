'use strict';
const express = require('express');
const { loadLegal } = require('../legal');

module.exports = function publicRoutes() {
  const router = express.Router();
  // Read once at startup; restart the app after editing LEGAL.md.
  const legal = loadLegal();

  router.get('/', (req, res) => {
    res.render('landing', { title: 'Dishari Surveys' });
  });

  router.get('/terms', (req, res) => {
    res.render('legal', { title: legal.terms.title, page: legal.terms, navLabel: 'Terms' });
  });

  router.get('/privacy', (req, res) => {
    res.render('legal', { title: legal.privacy.title, page: legal.privacy, navLabel: 'Privacy' });
  });

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  router.get('/favicon.ico', (req, res) => res.status(204).end());

  return router;
};
