import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { signupsWaiting, maskedPhone } from '../lib/new-signups.js';
import { deliverReply } from '../lib/replies.js';
import { createStore } from '../lib/store.js';
import { filterSignups } from '../public/admin-people-view.js';

// Admin › People › New signups: people who signed up but haven't texted Jules yet. Photon only lets
// Jules text someone after they've texted first, so the list is read-only; their first text moves them
// to Testers, where Approve sets them up. Synthetic numbers only.
const env = { SITE_ORIGIN: 'https://jules.example', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const signupId = '00000000-0000-4000-8000-00000000a001', phone = '+15555550123';

function world() {
  const state = { conversations: [], ledger: new Map() };
  const signups = [{ request_id: signupId, phone_number: phone, profile: { first_name: 'sam', last_name: 'rivera' }, consent_at: '2026-10-21T10:00:00Z' }];
  const store = {
    signupsWithoutConversation: async () => signups.filter(s => !state.conversations.some(c => c.sender_id === s.phone_number)),
    reserve: async (conversation_id, op, body) => { if (state.ledger.has(op)) return false; state.ledger.set(op, { conversation_id, body, status: 'sending' }); return true; },
    operation: async op => state.ledger.get(op) ?? null,
    finish: async (op, status) => { state.ledger.get(op).status = status; },
  };
  return { state, store };
}
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } });

test('the list shows only numbers without a conversation, masked to the last four digits', async () => {
  const w = world();
  const list = await signupsWaiting(w.store);
  assert.deepEqual(list, [{ signup: signupId, phone: '•••-0123', signed_up_at: '2026-10-21T10:00:00Z', name: 'Sam Rivera' }]);
  assert.ok(!JSON.stringify(list).includes('5555550123'));
  // Their first text creates their conversation, which takes them off the list (they're under Testers).
  w.state.conversations.push({ id: 'c1', sender_id: phone, line: 'shared' });
  assert.deepEqual(await signupsWaiting(w.store), []);
  assert.equal(maskedPhone('+447700900123'), '•••-0123');
});

test('Admin: the list is owner-only and never carries a full phone; there is no setup action to text first', async () => {
  const w = world(), handler = createAdminHandler({ auth: async () => 200, env, storeFactory: () => w.store });
  const denied = response();
  await createAdminHandler({ auth: async () => 401, env, storeFactory: () => assert.fail('no database') })({ method: 'GET', url: '/api/admin?view=signups', headers: {} }, denied);
  assert.equal(denied.statusCode, 401);
  const list = response();
  await handler({ method: 'GET', url: '/api/admin?view=signups', headers: {} }, list);
  assert.equal(list.body.signups[0].phone, '•••-0123');
  assert.ok(!JSON.stringify(list.body).includes(phone));
  const setUp = response();
  await handler({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', origin: env.SITE_ORIGIN }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'set-up', signup: signupId, confirm: true })); } }, setUp);
  assert.equal(setUp.statusCode, 400);
  assert.equal(w.state.ledger.size, 0);
});

test('the store lists each number’s latest signup once, leaving out numbers that already have a conversation', async () => {
  const urls = [];
  const fetcher = async url => {
    const path = decodeURIComponent(url); urls.push(path);
    if (path.includes('public_signups')) return new Response(JSON.stringify([
      { request_id: 'b', phone_number: '+15555550123', consent_at: '2026-10-21T00:00:00Z' },
      { request_id: 'a', phone_number: '+15555550123', consent_at: '2026-10-20T00:00:00Z' },
      { request_id: 'c', phone_number: '+15555550199', consent_at: '2026-10-19T00:00:00Z' }]), { status: 200 });
    return new Response(JSON.stringify([{ sender_id: '+15555550199' }]), { status: 200 });
  };
  const rows = await createStore(env, fetcher).signupsWithoutConversation();
  assert.deepEqual(rows.map(r => r.request_id), ['b']);
  assert.match(urls[0], /order=consent_at\.desc/);
  assert.match(urls[1], /sender_id=in\.\("\+15555550123","\+15555550199"\)/);
});

test('the page searches signups by name or the last four digits', () => {
  const signups = [{ name: 'Sam Rivera', phone: '•••-0123' }, { name: null, phone: '•••-9876' }];
  assert.equal(filterSignups(signups, 'sam').length, 1);
  assert.equal(filterSignups(signups, '9876')[0].phone, '•••-9876');
  assert.equal(filterSignups(signups, 'zz').length, 0);
  assert.equal(filterSignups(signups, '').length, 2);
});

test('a send Photon refuses ends uncertain and logs why, without the message, numbers or error text', async () => {
  const w = world(), logs = [], log = console.log;
  const error = Object.assign(new Error(`could not reach ${phone} with token synthetic-secret`), { name: 'ConnectError', code: 'unauthenticated', status: 401 });
  console.log = line => logs.push(line);
  try {
    const conversation = { id: '00000000-0000-4000-8000-0000000000c1', sender_id: phone, line: 'shared' };
    const result = await deliverReply({ store: w.store, send: async () => { throw error; }, conversation, operation: 'approved:test', body: 'hello there', source: 'operator', env, compose: async ({ draft }) => ({ body: draft }) });
    assert.equal(result.status, 'uncertain');
  } finally { console.log = log; }
  const failed = logs.map(l => JSON.parse(l)).find(l => l.event === 'imessage_send_failed');
  assert.deepEqual(failed, { event: 'imessage_send_failed', operation: 'approved:test', purpose: 'notification', name: 'ConnectError', code: 'unauthenticated', status: 401 });
  for (const secret of [phone, 'synthetic-secret', 'hello there', 'could not reach']) assert.ok(!logs.join(' ').includes(secret));
});
