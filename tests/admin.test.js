import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../lib/auth.js';
import { deliverReply } from '../lib/replies.js';
import { receiveInInbox } from '../lib/inbox.js';
import { createAdminHandler } from '../api/admin.js';
import { createStore } from '../lib/store.js';

const id = '00000000-0000-4000-8000-000000000001';
const operation = '00000000-0000-4000-8000-000000000002';
const conversation = { id, sender_id: 'fake-sender', line: 'shared' };
function memoryStore() {
  const operations = new Map();
  const received = new Map();
  return { operations, received,
    async receive(delivery) { received.set(delivery.message.id, delivery.message.content.text); return id; },
    async reserve(conversation_id, op, body) { if (operations.has(op)) return false; operations.set(op, { conversation_id, body, status: 'sending' }); return true; },
    async finish(op, status) { operations.get(op).status = status; },
    async operation(op) { return operations.get(op); },
    async conversation(value) { return value === id ? conversation : null; },
    async list() { return [conversation]; },
    async messages() { return { messages: [], before: null }; },
  };
}
test('auth requires verified owner identity checked with Supabase, not token claims', async () => {
  const env = { ADMIN_EMAIL: 'owner@example.invalid', SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'fake' };
  let calls = 0;
  const identity = user => async (_url, options) => { calls++; assert.equal(options.headers.Authorization, 'Bearer fake-token'); return { ok: true, json: async () => user }; };
  assert.equal(await authorize({}, env, identity({})), 401);
  assert.equal(calls, 0);
  assert.equal(await authorize({ authorization: 'Bearer fake-token' }, env, identity({ email: env.ADMIN_EMAIL })), 403);
  assert.equal(await authorize({ authorization: 'Bearer fake-token' }, env, identity({ email: 'other@example.invalid', email_confirmed_at: 'date' })), 403);
  assert.equal(await authorize({ authorization: 'Bearer fake-token' }, env, identity({ email: env.ADMIN_EMAIL.toUpperCase(), email_confirmed_at: 'date' })), 200);
});
test('concurrent or retried replies send once and mismatched operation IDs fail', async () => {
  const store = memoryStore(); let count = 0;
  const args = { store, conversation, operation, body: 'A manual reply', source: 'operator', send: async () => { count++; } };
  await Promise.all([deliverReply(args), deliverReply(args)]);
  assert.equal(count, 1);
  assert.equal((await deliverReply(args)).status, 'sent');
  await assert.rejects(deliverReply({ ...args, body: 'Changed reply' }), error => error.status === 409);
});
test('ambiguous send failure stays visible and never automatically retries', async () => {
  const store = memoryStore(); let count = 0;
  const args = { store, conversation, operation, body: 'Reply', source: 'operator', send: async () => { count++; throw new Error('private data'); } };
  assert.equal((await deliverReply(args)).status, 'uncertain');
  assert.equal((await deliverReply(args)).status, 'uncertain');
  assert.equal(count, 1);
});
test('a database status update failure never triggers a second send', async () => {
  const store = memoryStore(); store.finish = async () => { throw new Error('offline'); }; let count = 0;
  const args = { store, conversation, operation, body: 'Reply', source: 'operator', send: async () => { count++; } };
  await assert.rejects(deliverReply(args));
  assert.equal((await deliverReply(args)).status, 'sending');
  assert.equal(count, 1);
});
test('with the agent off, inbox persists every inbound text for the operator and no wording triggers a reply', async () => {
  const store = memoryStore(); let count = 0;
  const delivery = text => ({ space: { phone: 'shared' }, message: { id: text, sender: { id: 'fake-sender' }, content: { text } } });
  const options = { store, send: async () => { count++; } };
  for (const text of ['hello', 'Find a jacket']) assert.equal(await receiveInInbox(delivery(text), {}, options), 'imessage_received');
  assert.equal(count, 0);
  assert.equal(store.received.size, 2);
});
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } });
const request = input => ({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } });
test('admin blocks unauthenticated reads and sends before accessing private data', async () => {
  for (const method of ['GET', 'POST']) {
    const res = response(); await createAdminHandler({ auth: async () => 401, storeFactory: () => assert.fail('must not access database') })({ ...request({}), method }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
test('admin conversations are read-only: manual replies are retired and never reach the store or Photon', async () => {
  const handler = createAdminHandler({ auth: async () => 200, storeFactory: () => assert.fail('must not access database') });
  const res = response(); await handler(request({ conversation: id, operation, body: 'Reply' }), res);
  assert.equal(res.statusCode, 400);
  const put = response(); await handler({ ...request({}), method: 'PUT' }, put); assert.equal(put.statusCode, 405); assert.equal(put.headers.Allow, 'GET, POST');
});
test('owner access check answers without reading private data, and non-owners are refused', async () => {
  const get = url => ({ method: 'GET', url, headers: {} });
  const owner = response(); await createAdminHandler({ auth: async () => 200, storeFactory: () => assert.fail('must not access database') })(get('/api/admin?view=access'), owner);
  assert.equal(owner.statusCode, 200); assert.deepEqual(owner.body, { owner: true });
  const other = response(); await createAdminHandler({ auth: async () => 403, storeFactory: () => assert.fail('must not access database') })(get('/api/admin?view=access'), other);
  assert.equal(other.statusCode, 403);
});
test('history pages retain stable ordering and use service credentials only on server requests', async () => {
  const store = createStore({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake-private' }, async (url, options) => {
    assert.match(url, /limit=101/); assert.equal(options.headers.apikey, 'fake-private');
    return { ok: true, text: async () => JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ id: String(i), created_at: '2026-01-01T00:00:00Z' }))) };
  });
  const page = await store.messages(id);
  assert.equal(page.messages.length, 100); assert.equal(page.messages[0].id, '99'); assert.equal(page.before.id, '99');
});
