const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
global.crypto = webcrypto;
const fs = require('node:fs');
const code = fs.readFileSync('backend/src.js', 'utf8');
const workerPromise = import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const origin = 'https://anna-2026-maker.github.io';
function fakeEnv() {
  const rows = new Map(), limits = new Map();
  const DB = { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; }, async first() {
      if (sql.includes('FROM limits')) return limits.get(args[0]) || null;
      if (sql.includes('FROM artworks WHERE id')) return rows.get(args[0]) || null;
      if (sql.includes('COUNT(*)')) return { total: rows.size, today: rows.size, prints: [...rows.values()].reduce((sum, row) => sum + row.print_count, 0) };
      return null;
    }, async all() { return { results: [...rows.values()].map(({ edit_hash, image, ...row }) => row) }; }, async run() {
      if (sql.startsWith('INSERT INTO limits')) limits.set(args[0], { count: args[2], updated_at: args[3] });
      if (sql.startsWith('INSERT INTO artworks')) rows.set(args[0], { id: args[0], artist: args[1], image: [...args[2]], edit_hash: args[3], created_at: args[4], updated_at: args[5], bytes: args[6], width: args[7], height: args[8], print_count: 0 });
      if (sql.startsWith('UPDATE artworks SET image')) Object.assign(rows.get(args[5]), { image: [...args[0]], bytes: args[1], width: args[2], height: args[3], updated_at: args[4] });
      if (sql.startsWith('UPDATE artworks SET print_count')) rows.get(args[0]).print_count++;
      if (sql.startsWith('DELETE FROM artworks')) rows.delete(args[0]);
      return {};
    } };
  } };
  return { DB, ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'a-long-test-secret', ALLOWED_ORIGIN: origin };
}
const jpeg = fs.readFileSync('tests/fixtures/tiny.jpg');
function req(path, method = 'GET', body, headers = {}) { return new Request('https://worker.example' + path, { method, headers: { Origin: origin, ...headers }, body }); }
test('automatic creation, private access, authorized update and print count', async () => {
  const worker = (await workerPromise).default, env = fakeEnv();
  const uploadHeaders = { 'Content-Type': 'image/jpeg', 'X-Exhibition-Consent': 'notice' };
  const made = await worker.fetch(req('/api/artworks', 'POST', jpeg, uploadHeaders), env);
  assert.equal(made.status, 201);
  const { id, edit_token } = await made.json();
  assert.equal((await worker.fetch(req('/api/admin/artworks'), env)).status, 401);
  assert.equal((await worker.fetch(req('/api/artworks/' + id, 'PUT', jpeg, { ...uploadHeaders, 'X-Edit-Token': 'wrong' }), env)).status, 403);
  assert.equal((await worker.fetch(req('/api/artworks/' + id, 'PUT', jpeg, { ...uploadHeaders, 'X-Edit-Token': edit_token }), env)).status, 200);
  const login = await worker.fetch(req('/api/admin/login', 'POST', JSON.stringify({ password: 'test-password' }), { 'Content-Type': 'application/json' }), env);
  const { token } = await login.json();
  const auth = { Authorization: 'Bearer ' + token };
  const listing = await (await worker.fetch(req('/api/admin/artworks', 'GET', undefined, auth), env)).json();
  assert.equal(listing.stats.total, 1);
  const imageResponse = await worker.fetch(req('/api/admin/artworks/' + id + '/image', 'GET', undefined, auth), env);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), jpeg);
  await worker.fetch(req('/api/admin/artworks/' + id + '/print', 'PATCH', undefined, auth), env);
  assert.equal((await (await worker.fetch(req('/api/admin/artworks', 'GET', undefined, auth), env)).json()).stats.prints, 1);
  assert.equal((await worker.fetch(req('/api/admin/artworks/' + id, 'DELETE', undefined, auth), env)).status, 200);
  assert.equal((await (await worker.fetch(req('/api/admin/artworks', 'GET', undefined, auth), env)).json()).stats.total, 0);
});
test('rejects untrusted origins and missing consent', async () => {
  const worker = (await workerPromise).default, env = fakeEnv();
  assert.equal((await worker.fetch(new Request('https://worker.example/api/admin/artworks', { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  assert.equal((await worker.fetch(req('/api/artworks', 'POST', jpeg, { 'Content-Type': 'image/jpeg' }), env)).status, 400);
});
