import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { APPROVED_TEXT } from '../lib/waitlist.js';
import { filterPeople, accessSegments, accessChange, accessResult } from '../public/admin-people-view.js';

// Owner approval from Admin › People (db/035): only a waitlisted person changes, and only that change texts them once.
const waiting = '00000000-0000-4000-8000-0000000000d1', approved = '00000000-0000-4000-8000-0000000000d2';
const on = { SITE_ORIGIN: 'https://jules.example/', WAITLIST_ENABLED: 'true' };
function world({ optedOut = false } = {}) {
  const access = new Map([[waiting, 'waitlisted'], [approved, 'approved']]), ledger = new Map(), sent = [];
  const store = {
    conversation: async id => access.has(id) ? { id, sender_id: 'synthetic', line: 'shared' } : null,
    approveAccess: async id => { if (access.get(id) !== 'waitlisted') return false; access.set(id, 'approved'); return true; },
    waitlistAccess: async id => { if (access.get(id) !== 'approved') return false; access.set(id, 'waitlisted'); return true; },
    signupNames: async phones => new Map(phones.includes('d1') ? [['d1', { first_name: 'jane', last_name: 'doe' }]] : []),
    profilesFor: async () => new Map([[approved, [{ field: 'name', key: 'first', value: 'sam', basis: 'explicit' }]]]),
    accessFor: async ids => new Map(ids.filter(id => access.has(id)).map(id => [id, { access: access.get(id) }])),
    list: async () => [...access.keys()].map(id => ({ id, sender_id: id.slice(-2), updated_at: '2026-10-19T00:00:00Z' })),
    messages: async () => ({ messages: [], before: null }),
    reserve: async (conversation_id, op, body) => { if (ledger.has(op)) return false; ledger.set(op, { conversation_id, body, status: optedOut ? 'blocked' : 'sending' }); return !optedOut; },
    operation: async op => ledger.get(op) ?? null,
    finish: async (op, status) => { ledger.get(op).status = status; },
  };
  const send = async (_d, body) => { sent.push(body); return { id: `p${sent.length}` }; };
  return { store, access, sent, handler: (env = on) => createAdminHandler({ auth: async () => 200, env, send, storeFactory: () => store }) };
}
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } });
async function post(handler, input, origin = 'https://jules.example') {
  const res = response();
  await handler({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res);
  return res;
}
async function get(handler, url) { const res = response(); await handler({ method: 'GET', url, headers: {} }, res); return res; }
const approve = { action: 'approve', conversation: waiting, confirm: true };

test('approval is owner-only, from the Jules site, and confirmed, before anything changes', async () => {
  const w = world();
  for (const status of [401, 403]) assert.equal((await post(createAdminHandler({ auth: async () => status, env: on, storeFactory: () => assert.fail('no database') }), approve)).statusCode, status);
  for (const origin of [null, 'https://evil.example']) assert.equal((await post(w.handler(), approve, origin)).statusCode, 400);
  assert.equal((await post(w.handler(), { ...approve, confirm: false })).statusCode, 400);
  assert.equal(w.access.get(waiting), 'waitlisted');
  assert.equal(w.sent.length, 0);
});

test('approving a waitlisted person texts them once; approving again changes and sends nothing', async () => {
  const w = world();
  const first = await post(w.handler(), approve);
  assert.equal(first.statusCode, 200);
  assert.deepEqual({ changed: first.body.changed, text: first.body.text, access: first.body.access.access }, { changed: true, text: 'sent', access: 'approved' });
  assert.deepEqual(w.sent, [APPROVED_TEXT]);
  const again = await post(w.handler(), approve);
  assert.deepEqual({ changed: again.body.changed, text: again.body.text }, { changed: false, text: null });
  assert.equal(w.sent.length, 1);
  assert.equal((await post(w.handler(), { ...approve, conversation: approved })).body.changed, false);
});

test('with the waitlist off, approval records the change without texting; STOP blocks the text', async () => {
  const off = world();
  const res = await post(off.handler({ SITE_ORIGIN: on.SITE_ORIGIN }), approve);
  assert.deepEqual({ changed: res.body.changed, text: res.body.text }, { changed: true, text: null });
  assert.equal(off.sent.length, 0);
  const stopped = world({ optedOut: true });
  assert.equal((await post(stopped.handler(), approve)).body.text, 'blocked');
  assert.equal(stopped.sent.length, 0);
  assert.equal(stopped.access.get(waiting), 'approved');
});

test('the people list and person view report status, and stay usable when it cannot be read', async () => {
  const w = world();
  const list = await get(w.handler(), '/api/admin');
  assert.deepEqual(Object.fromEntries(list.body.conversations.map(c => [c.id, c.access])), { [waiting]: 'waitlisted', [approved]: 'approved' });
  const person = await get(w.handler(), `/api/admin?conversation=${waiting}`);
  assert.equal(person.body.access.access, 'waitlisted');
  assert.equal(person.body.approval_text, APPROVED_TEXT);
  w.store.accessFor = async () => { throw new Error('column access does not exist'); };
  const before = await get(w.handler(), '/api/admin');
  assert.equal(before.statusCode, 200);
  assert.ok(before.body.conversations.every(c => c.access === null));
  assert.equal((await get(w.handler(), `/api/admin?conversation=${waiting}`)).body.access, null);
});

test('the status filter counts each status and hides itself when no status is known', () => {
  const people = [{ sender_id: '+1415', access: 'waitlisted' }, { sender_id: '+1416', access: 'approved' }, { sender_id: '+1417', access: 'approved' }];
  assert.deepEqual(accessSegments(people), [['', 'All', 3], ['waitlisted', 'Waitlisted', 1], ['approved', 'Approved', 2]]);
  assert.deepEqual(filterPeople(people, '', 'approved').map(p => p.sender_id), ['+1416', '+1417']);
  assert.deepEqual(filterPeople(people, '1415', 'approved'), []);
  assert.deepEqual(accessSegments(people.map(p => ({ ...p, access: null }))), []);
});

test('the list names each person from their signup, else the name told to Jules, and stays usable without names', async () => {
  const w = world();
  const names = c => Object.fromEntries(c.map(p => [p.id, p.name]));
  assert.deepEqual(names((await get(w.handler(), '/api/admin')).body.conversations), { [waiting]: 'Jane Doe', [approved]: 'Sam' });
  w.store.signupNames = async () => { throw new Error('signups unavailable'); };
  w.store.profilesFor = async () => { throw new Error('profiles unavailable'); };
  const res = await get(w.handler(), '/api/admin');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(names(res.body.conversations), { [waiting]: null, [approved]: null });
  assert.deepEqual(filterPeople([{ sender_id: '+1415', name: 'Jane Doe' }], 'janedoe').length, 1);
});

test('moving someone back to the waitlist is confirmed, texts nothing, and re-approving never resends', async () => {
  const w = world();
  assert.equal((await post(w.handler(), { action: 'waitlist', conversation: approved, confirm: false })).statusCode, 400);
  assert.equal((await post(w.handler(), { action: 'waitlist', conversation: approved }, 'https://evil.example')).statusCode, 400);
  const back = await post(w.handler(), { action: 'waitlist', conversation: approved, confirm: true });
  assert.deepEqual({ changed: back.body.changed, text: back.body.text, access: back.body.access.access }, { changed: true, text: null, access: 'waitlisted' });
  assert.equal(w.sent.length, 0);
  await post(w.handler(), approve);
  await post(w.handler(), { action: 'waitlist', conversation: waiting, confirm: true });
  const again = await post(w.handler(), approve);
  assert.deepEqual({ changed: again.body.changed, text: again.body.text }, { changed: true, text: 'already_sent' });
  assert.deepEqual(w.sent, [APPROVED_TEXT]);
});

test('the confirmation says what each change does', () => {
  const opts = { allowance: 3, approvalText: APPROVED_TEXT };
  assert.match(accessChange({}, 'approved', opts).lines.join(' '), /texts them once/);
  assert.match(accessChange({}, 'approved', { ...opts, approvalText: null }).lines.join(' '), /No text is sent/);
  assert.match(accessChange({ waitlist_replies: 1 }, 'waitlisted', opts).lines[0], /2 more replies/);
  assert.match(accessChange({ waitlist_replies: 3 }, 'waitlisted', opts).lines[0], /the waitlist text/);
  assert.match(accessResult('approved', { changed: true, text: 'already_sent' }), /nothing new was sent/);
  assert.match(accessResult('waitlisted', { changed: true, text: null }), /Nothing was sent/);
});
