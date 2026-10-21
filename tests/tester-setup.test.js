import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { setUpTester, signupsToSetUp, maskedPhone } from '../lib/tester-setup.js';
import { approvedWelcomeText } from '../lib/onboarding.js';
import { CONTACT_CARD_TEXT } from '../lib/contact-card.js';
import { createStore } from '../lib/store.js';
import { filterSignups, setupLines, setupResult } from '../public/admin-people-view.js';

// Setting up a new tester from Admin › People: the owner types the Photon line, Jules creates the
// conversation for that phone and line and runs the usual approval. Synthetic numbers only.
const env = { SITE_ORIGIN: 'https://jules.example', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key', WAITLIST_ENABLED: 'true', ONBOARDING_ENABLED: 'true', GMAIL_IMPORT_ENABLED: 'true', SELF_SERVE_ONBOARDING_ENABLED: 'true' };
const signupId = '00000000-0000-4000-8000-00000000a001', phone = '+15555550123', line = '+15555550188';

function world({ conversations = [], profile = { first_name: 'sam', last_name: 'rivera', gender: 'woman' } } = {}) {
  const state = { conversations: conversations.map(c => ({ access: 'waitlisted', ...c })), members: new Map(), sessions: new Map(), ledger: new Map(), sent: [], users: [], facts: new Map() };
  const signups = [{ request_id: signupId, phone_number: phone, profile, consent_at: '2026-10-21T10:00:00Z' }];
  const find = id => state.conversations.find(c => c.id === id);
  const store = {
    signupById: async id => signups.find(s => s.request_id === id) ?? null,
    signupsWithoutConversation: async () => signups.filter(s => !state.conversations.some(c => c.sender_id === s.phone_number)),
    conversationsForPhone: async p => state.conversations.filter(c => c.sender_id === p).slice(0, 3),
    createConversation: async (sender_id, l) => {
      const found = state.conversations.find(c => c.sender_id === sender_id && c.line === l);
      if (found) return found;
      const row = { id: `00000000-0000-4000-8000-0000000000${String(state.conversations.length + 1).padStart(2, '0')}`, sender_id, line: l, access: 'waitlisted' };
      state.conversations.push(row); return row;
    },
    conversation: async id => find(id) ?? null,
    approveAccess: async id => { const c = find(id); if (c?.access !== 'waitlisted') return false; c.access = 'approved'; return true; },
    accessFor: async ids => new Map(ids.filter(find).map(id => [id, { access: find(id).access }])),
    memberEmail: async id => state.members.get(id) ?? null,
    addMember: async (email, id) => { if (!state.members.has(id)) state.members.set(id, email); },
    inviteOnboarding: async id => { if (!state.sessions.has(id)) state.sessions.set(id, 'invited'); },
    advanceOnboarding: async (id, from, to) => { if (state.sessions.get(id) !== from) return false; state.sessions.set(id, to); return true; },
    onboardingSession: async id => state.sessions.has(id) ? { state: state.sessions.get(id) } : null,
    profile: async id => ({ facts: state.facts.get(id) ?? [], version: 0 }),
    saveProfile: async (id, _v, facts) => { state.facts.set(id, facts); return [{ version: 1 }]; },
    recordEvidence: async () => {},
    reserve: async (conversation_id, op, body) => {
      if (state.ledger.has(op)) return false;
      const blocked = Boolean(find(conversation_id)?.sms_opted_out_at);
      state.ledger.set(op, { conversation_id, body, status: blocked ? 'blocked' : 'sending' }); return !blocked;
    },
    operation: async op => state.ledger.get(op) ?? null,
    finish: async (op, status) => { state.ledger.get(op).status = status; },
  };
  const send = async (target, body) => { state.sent.push({ to: target.space?.phone, sender: target.message?.sender?.id, body }); return { id: `p${state.sent.length}` }; };
  const fetcher = async (url, options) => { state.users.push({ url, body: JSON.parse(options.body) }); return new Response('{}', { status: 200 }); };
  return { state, store, send, fetcher, setUp: input => setUpTester(store, { signup: signupId, line, ...input }, env, send, fetcher) };
}

test('a new signup gets a conversation on the typed line, an account, and the welcome plus contact card once', async () => {
  const w = world();
  const result = await w.setUp({ line: '(555) 555-0188' });
  assert.equal(w.state.conversations.length, 1);
  assert.deepEqual({ sender_id: w.state.conversations[0].sender_id, line: w.state.conversations[0].line, access: w.state.conversations[0].access }, { sender_id: phone, line, access: 'approved' });
  assert.deepEqual({ created: result.created, changed: result.changed, text: result.text, account: result.account, contact_card: result.contact_card }, { created: true, changed: true, text: 'sent', account: 'created', contact_card: 'sent' });
  assert.equal(w.state.users.length, 1);
  assert.equal(w.state.sessions.get(result.conversation), 'offered');
  const bodies = w.state.sent.map(s => s.body);
  assert.deepEqual(bodies, [approvedWelcomeText(env), CONTACT_CARD_TEXT]);
  assert.ok(w.state.sent.every(s => s.to === line && s.sender === phone), 'both texts go to their phone from the line the owner typed');
  // Their gender from the signup form seeds their profile, as if they had texted first.
  assert.ok((w.state.facts.get(result.conversation) ?? []).some(f => f.field === 'gender'));
});

test('a repeat click reuses the conversation and sends nothing new', async () => {
  const w = world();
  await w.setUp();
  const again = await w.setUp();
  assert.equal(w.state.conversations.length, 1);
  assert.deepEqual({ created: again.created, changed: again.changed, text: again.text }, { created: false, changed: false, text: null });
  assert.equal(w.state.sent.length, 2);
  assert.equal(w.state.users.length, 1);
  // Even if they were moved back to the waitlist in between, the ledger keeps the welcome to once.
  w.state.conversations[0].access = 'waitlisted';
  const third = await w.setUp();
  assert.equal(third.text, 'already_sent');
  assert.equal(w.state.sent.length, 2);
});

test('an invalid line or unknown signup changes and sends nothing', async () => {
  for (const bad of ['', 'line-1', '12345', '+0123456789', null]) {
    const w = world();
    await assert.rejects(w.setUp({ line: bad }), error => error.status === 400 && /phone number/.test(error.message));
    assert.equal(w.state.conversations.length, 0);
    assert.equal(w.state.sent.length, 0);
  }
  const w = world();
  await assert.rejects(w.setUp({ signup: '00000000-0000-4000-8000-00000000a999' }), error => error.status === 404);
  assert.equal(w.state.conversations.length, 0);
});

test('an existing conversation on the same line is used, never duplicated; another line is refused', async () => {
  const id = '00000000-0000-4000-8000-0000000000e1';
  const w = world({ conversations: [{ id, sender_id: phone, line }] });
  const result = await w.setUp();
  assert.deepEqual({ conversation: result.conversation, created: result.created, changed: result.changed }, { conversation: id, created: false, changed: true });
  assert.equal(w.state.conversations.length, 1);
  const other = world({ conversations: [{ id, sender_id: phone, line: '+15555550177' }] });
  await assert.rejects(other.setUp(), error => error.status === 409 && /ending 0177/.test(error.message));
  assert.equal(other.state.conversations.length, 1);
  assert.equal(other.state.conversations[0].access, 'waitlisted');
  assert.equal(other.state.sent.length, 0);
  const two = world({ conversations: [{ id, sender_id: phone, line }, { id: '00000000-0000-4000-8000-0000000000e2', sender_id: phone, line: '+15555550177' }] });
  await assert.rejects(two.setUp(), error => error.status === 409 && /more than one line/.test(error.message));
  assert.equal(two.state.sent.length, 0);
});

test('a number that texted STOP is refused before anything changes or is sent', async () => {
  const w = world({ conversations: [{ id: '00000000-0000-4000-8000-0000000000e1', sender_id: phone, line, sms_opted_out_at: '2026-10-20T00:00:00Z' }] });
  await assert.rejects(w.setUp(), error => error.status === 409 && /STOP/.test(error.message));
  assert.equal(w.state.conversations[0].access, 'waitlisted');
  assert.equal(w.state.users.length, 0);
  assert.equal(w.state.sent.length, 0);
});

test('the signup list shows only numbers without a conversation, masked to the last four digits', async () => {
  const w = world();
  const list = await signupsToSetUp(w.store);
  assert.deepEqual(list, [{ signup: signupId, phone: '•••-0123', signed_up_at: '2026-10-21T10:00:00Z', name: 'Sam Rivera' }]);
  assert.ok(!JSON.stringify(list).includes('5555550123'));
  await w.setUp();
  assert.deepEqual(await signupsToSetUp(w.store), []);
  assert.equal(maskedPhone('+447700900123'), '•••-0123');
});

const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } });
async function post(handler, input, origin = 'https://jules.example') {
  const res = response();
  await handler({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res);
  return res;
}
test('Admin: setup is owner-only, from the Jules site and confirmed; the list never carries a full phone', async () => {
  const w = world(), handler = createAdminHandler({ auth: async () => 200, env, send: w.send, fetcher: w.fetcher, storeFactory: () => w.store });
  const input = { action: 'set-up', signup: signupId, line, confirm: true };
  assert.equal((await post(createAdminHandler({ auth: async () => 401, env, storeFactory: () => assert.fail('no database') }), input)).statusCode, 401);
  for (const origin of [null, 'https://evil.example']) assert.equal((await post(handler, input, origin)).statusCode, 400);
  assert.equal((await post(handler, { ...input, confirm: false })).statusCode, 400);
  assert.equal((await post(handler, { ...input, signup: 'not-a-uuid' })).statusCode, 404);
  const bad = await post(handler, { ...input, line: 'abc' });
  assert.deepEqual([bad.statusCode, /phone number/.test(bad.body.error)], [400, true]);
  assert.equal(w.state.conversations.length, 0);
  const list = response();
  await handler({ method: 'GET', url: '/api/admin?view=signups', headers: {} }, list);
  assert.equal(list.body.signups[0].phone, '•••-0123');
  assert.ok(!JSON.stringify(list.body).includes(phone));
  assert.equal(list.body.approval_text, approvedWelcomeText(env));
  const done = await post(handler, input);
  assert.deepEqual([done.statusCode, done.body.created, done.body.text], [200, true, 'sent']);
  const again = await post(handler, input);
  assert.deepEqual([again.statusCode, again.body.changed], [200, false]);
  assert.equal(w.state.sent.length, 2);
});

test('the store creates a conversation once and reuses one a concurrent setup created', async () => {
  const calls = [], existing = { id: '00000000-0000-4000-8000-0000000000e1', sender_id: phone, line };
  let conflict = false;
  const fetcher = async (url, options) => {
    calls.push({ url: decodeURIComponent(url), method: options.method, prefer: options.headers.Prefer });
    if (options.method === 'POST') return new Response(JSON.stringify(conflict ? [] : [existing]), { status: 201 });
    return new Response(JSON.stringify([existing]), { status: 200 });
  };
  const store = createStore(env, fetcher);
  assert.deepEqual(await store.createConversation(phone, line), existing);
  assert.match(calls[0].url, /conversations\?on_conflict=sender_id,line/);
  assert.match(calls[0].prefer, /ignore-duplicates/);
  conflict = true;
  assert.deepEqual(await store.createConversation(phone, line), existing);
  assert.equal(calls.at(-1).method, 'GET');
});

test('the admin page explains the setup, searches by name or last four, and reports the result', () => {
  const lines = setupLines('welcome text', true);
  assert.match(lines[0], /line you enter/);
  assert.ok(lines.some(l => l.includes('“welcome text”')));
  assert.match(lines.at(-1), /contact card/);
  assert.doesNotMatch(setupLines(null, false).join(' '), /contact card/);
  const signups = [{ name: 'Sam Rivera', phone: '•••-0123' }, { name: null, phone: '•••-9876' }];
  assert.equal(filterSignups(signups, 'sam').length, 1);
  assert.equal(filterSignups(signups, '9876')[0].phone, '•••-9876');
  assert.equal(filterSignups(signups, 'zz').length, 0);
  assert.equal(filterSignups(signups, '').length, 2);
  assert.equal(setupResult({ created: true, changed: true, text: 'sent', account: 'created', onboarding: true, contact_card: 'sent' }), 'Set up on their line. Account set up. Jules texted them the welcome and the contact card.');
  assert.match(setupResult({ created: true, changed: true, text: 'sent', account: 'created', onboarding: true, contact_card: 'failed' }), /contact card could not be sent/);
  assert.match(setupResult({ created: true, changed: true, text: 'sent', account: null }), /^Set up on their line\. Jules texted them that their spot opened/);
  assert.match(setupResult({ created: true, changed: true, text: 'blocked', account: 'created', onboarding: true }), /STOP/);
  assert.match(setupResult({ created: false, changed: false, text: null }), /already set up/);
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
