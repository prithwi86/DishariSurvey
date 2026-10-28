'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, validPayload } = require('./helpers');

let ctx;
test.before(async () => { ctx = await startServer(); });
test.after(() => ctx.close());

const post = (path, body) =>
  fetch(ctx.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('participant pages', async () => {
  const code = ctx.codes[0];
  let res = await fetch(`${ctx.base}/${code}`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /Test Survey/);
  assert.doesNotMatch(html, /\/admin/, 'participant pages never link to /admin');
  assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');

  res = await fetch(`${ctx.base}/ZZZZZZZZ`);
  assert.strictEqual(res.status, 404);
  assert.match(await res.text(), /This link isn(&#39;|')t valid/);
});

test('concurrent submits: exactly one succeeds', async () => {
  const code = ctx.codes[1];
  const results = await Promise.all([1, 2, 3, 4].map(() => post(`/${code}`, validPayload(ctx.qids))));
  const statuses = results.map((r) => r.status).sort();
  assert.deepStrictEqual(statuses, [200, 409, 409, 409]);
  const page = await (await fetch(`${ctx.base}/${code}`)).text();
  assert.match(page, /already submitted/);
});

test('admin requires sign-in and CSRF', async () => {
  let res = await fetch(`${ctx.base}/admin/surveys/1/export.csv`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/admin/login');

  // Get a session + CSRF token from the login page.
  res = await fetch(`${ctx.base}/admin/login`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const csrf = (await res.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const form = (o) => new URLSearchParams(o).toString();
  const opts = (body) => ({ method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body });

  res = await fetch(`${ctx.base}/admin/login`, opts(form({ email: 'admin@test.org', password: 'correct-horse-1' })));
  assert.strictEqual(res.status, 403, 'missing CSRF token is rejected');

  res = await fetch(`${ctx.base}/admin/login`, opts(form({ _csrf: csrf, email: 'admin@test.org', password: 'nope' })));
  assert.strictEqual(res.status, 401);

  res = await fetch(`${ctx.base}/admin/login`, opts(form({ _csrf: csrf, email: 'admin@test.org', password: 'correct-horse-1' })));
  assert.strictEqual(res.status, 302);
  const session = res.headers.get('set-cookie').split(';')[0];
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(res.headers.get('set-cookie'), /SameSite=Lax/i);

  res = await fetch(`${ctx.base}/admin/surveys/1/export.csv`, { headers: { cookie: session } });
  assert.strictEqual(res.status, 200);
  const csv = await res.text();
  assert.match(csv, /display_name/);

  res = await fetch(`${ctx.base}/admin/surveys/1/report.pdf`, { headers: { cookie: session } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('admin login is rate limited after 5 failures', async () => {
  let res = await fetch(`${ctx.base}/admin/login`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const csrf = (await res.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    res = await fetch(`${ctx.base}/admin/login`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, email: 'x@test.org', password: 'wrong' }).toString(),
    });
    statuses.push(res.status);
  }
  // One failure from the previous test plus these.
  assert.ok(statuses.includes(429));
});

test('scripts and styles carry a version stamp, so browsers never run stale code', async () => {
  const html = await (await fetch(`${ctx.base}/${ctx.codes[2]}`)).text();
  assert.match(html, /\/static\/js\/survey\.js\?v=[0-9a-z]+"/);
  assert.match(html, /\/static\/css\/app\.css\?v=[0-9a-z]+"/);
  const res = await fetch(ctx.base + html.match(/(\/static\/js\/survey\.js\?v=[0-9a-z]+)/)[1]);
  assert.strictEqual(res.status, 200);
});
