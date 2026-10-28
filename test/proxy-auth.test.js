'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers');

// ADMIN_AUTH=proxy: Google OAuth (e.g. oauth2-proxy) in front of /admin passes the email in a header.
let ctx;
test.before(async () => {
  ctx = await startServer({ mode: 'proxy', allowedEmails: ['organiser@dishariboston.org'], logoutUrl: '/oauth2/sign_out?rd=/' });
});
test.after(() => ctx.close());

const as = (email) => (email ? { 'X-Auth-Request-Email': email } : {});
const get = (path, email) => fetch(ctx.base + path, { redirect: 'manual', headers: as(email) });

test('no Google identity → 403, never a password form', async () => {
  const res = await get('/admin');
  assert.strictEqual(res.status, 403);
  const html = await res.text();
  assert.match(html, /Access denied/);
  assert.doesNotMatch(html, /type="password"/);
});

test('email not on the allowlist → 403', async () => {
  assert.strictEqual((await get('/admin', 'stranger@gmail.com')).status, 403);
});

test('allowed email gets in; login page redirects to dashboard', async () => {
  const res = await get('/admin', 'Organiser@DishariBoston.org');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Start a new survey/);
  const login = await get('/admin/login', 'organiser@dishariboston.org');
  assert.strictEqual(login.status, 302);
  assert.strictEqual(login.headers.get('location'), '/admin');
});

test('password login is disabled in proxy mode', async () => {
  const res = await fetch(`${ctx.base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@test.org&password=correct-horse-1',
  });
  assert.strictEqual(res.status, 403); // stopped at the Google gate
});

test('CSRF is still required, and sign-out goes to the OAuth sign-out URL', async () => {
  const email = 'organiser@dishariboston.org';
  let res = await get('/admin/surveys/1/codes', email);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const csrf = (await res.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const post = (path, body) => fetch(ctx.base + path, {
    method: 'POST', redirect: 'manual',
    headers: { ...as(email), cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  assert.strictEqual((await post('/admin/surveys/1/codes', { count: 2 })).status, 403);
  res = await post('/admin/surveys/1/codes', { _csrf: csrf, count: 2 });
  assert.strictEqual(res.status, 302);
  res = await post('/admin/logout', { _csrf: csrf });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/oauth2/sign_out?rd=/');
});

test('participant pages are unaffected', async () => {
  assert.strictEqual((await get(`/${ctx.codes[0]}`)).status, 200);
});
