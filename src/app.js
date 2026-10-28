'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const { icon } = require('./icons');
const format = require('./format');
const { securityHeaders } = require('./security');

function createApp({ db, sessionSecret, auth = {} }) {
  const app = express();
  app.disable('x-powered-by');
  // nginx on the same machine sets X-Forwarded-For / X-Forwarded-Proto.
  app.set('trust proxy', 'loopback');
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  app.locals.icon = icon;
  app.locals.fmt = format;
  app.locals.baseUrl = config.baseUrl;
  app.locals.asset = assetUrl;

  app.use(securityHeaders);
  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: '1h', index: false }));

  app.use(require('./routes/public')());
  app.use('/admin', require('./routes/admin')({ db, sessionSecret, auth }));
  app.use(require('./routes/participant')({ db }));

  app.use((req, res) => {
    res.status(404).render('message', {
      title: 'Not found',
      kicker: 'Dishari',
      heading: 'Page not found.',
      body: 'If you were sent a survey link, please use the exact link from your email.',
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(err.status || 500).render('message', {
      title: 'Something went wrong',
      kicker: 'Dishari',
      heading: 'Something went wrong.',
      body: 'Please try again in a moment.',
    });
  });

  return app;
}

/**
 * '/static/js/survey.js' → '/static/js/survey.js?v=<last-modified>'. Browsers cache static
 * files for an hour; the version stamp makes them fetch a changed file immediately.
 */
function assetUrl(url) {
  try {
    const file = path.join(config.root, 'public', url.replace(/^\/static\//, ''));
    return `${url}?v=${Math.floor(fs.statSync(file).mtimeMs).toString(36)}`;
  } catch {
    return url;
  }
}

module.exports = { createApp, assetUrl };
