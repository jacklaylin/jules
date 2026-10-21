import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountEmail, createSignInUser } from '../lib/accounts.js';
import { approveAccess, approvalPreview, APPROVED_TEXT } from '../lib/waitlist.js';
import { approvedWelcomeText } from '../lib/onboarding.js';
import { accessResult, approvalLines } from '../public/admin-people-view.js';

// Self-serve onboarding: approving someone gives them what the owner used to add by hand
// (sign-in user, member row, onboarding invite) and texts the onboarding welcome once.
const id = '00000000-0000-4000-8000-0000000000f1';
const conversation = { id, sender_id: 'synthetic-sender', line: 'synthetic-line' };
const env = { SITE_ORIGIN: 'https://jules.example', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key', WAITLIST_ENABLED: 'true', ONBOARDING_ENABLED: 'true', GMAIL_IMPORT_ENABLED: 'true', SELF_SERVE_ONBOARDING_ENABLED: 'true' };

function world({ member = null, session = null, access = 'waitlisted' } = {}) {
  const state = { access, member, session, ledger: new Map(), sent: [], users: [] };
  const store = {
    approveAccess: async () => { if (state.access !== 'waitlisted') return false; state.access = 'approved'; return true; },
    memberEmail: async () => state.member,
    addMember: async email => { state.member ??= email; },
    inviteOnboarding: async () => { state.session ??= 'invited'; },
    advanceOnboarding: async (_id, from, to) => { if (state.session !== from) return false; state.session = to; return true; },
    onboardingSession: async () => state.session ? { state: state.session } : null,
    reserve: async (_c, op, body) => { if (state.ledger.has(op)) return false; state.ledger.set(op, { conversation_id: id, body, status: 'sending' }); return true; },
    operation: async op => state.ledger.get(op) ?? null,
    finish: async (op, status) => { state.ledger.get(op).status = status; },
  };
  const send = async (_d, body) => { state.sent.push(body); return { id: `p${state.sent.length}` }; };
  const fetcher = async (url, options) => { state.users.push({ url, body: JSON.parse(options.body) }); return new Response('{}', { status: 200 }); };
  return { state, store, send, fetcher };
}

test('a sign-in user is created once; an existing one is fine and other failures throw without detail', async () => {
  const calls = [];
  const reply = (status, body) => async (url, options) => { calls.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization }); return new Response(JSON.stringify(body), { status }); };
  assert.equal(await createSignInUser(accountEmail(id), env, reply(200, { id: 'u1' })), 'created');
  assert.deepEqual(calls[0], { url: 'https://db.example/auth/v1/admin/users', body: { email: `${id}@members.jules.invalid`, email_confirm: true }, auth: 'Bearer synthetic-key' });
  assert.equal(await createSignInUser(accountEmail(id), env, reply(422, { code: 'email_exists', msg: 'A user with this email address has already been registered' })), 'existing');
  await assert.rejects(createSignInUser(accountEmail(id), env, reply(422, { code: 'email_address_invalid', msg: 'secret detail' })), error => error.status === 422 && error.code === 'email_address_invalid' && !error.message.includes('secret'));
  await assert.rejects(createSignInUser(accountEmail(id), env, reply(500, {})), error => error.status === 500);
});

test('approving a new person sets up their account and texts the onboarding welcome instead of the plain text', async () => {
  const w = world();
  const result = await approveAccess(w.store, conversation, env, w.send, w.fetcher);
  assert.deepEqual(result, { changed: true, text: 'sent', account: 'created', onboarding: true, contact_card: 'skipped' });
  assert.equal(w.state.users.length, 1);
  assert.equal(w.state.member, accountEmail(id));
  assert.equal(w.state.session, 'offered');
  assert.deepEqual(w.state.sent, [approvedWelcomeText(env)]);
  assert.ok(!w.state.sent.includes(APPROVED_TEXT));
});

test('an owner-provisioned tester keeps their account; someone past onboarding gets the plain text', async () => {
  const invited = world({ member: 'tester@example.com', session: 'invited' });
  assert.deepEqual(await approveAccess(invited.store, conversation, env, invited.send, invited.fetcher), { changed: true, text: 'sent', account: 'existing', onboarding: true, contact_card: 'skipped' });
  assert.equal(invited.state.users.length, 0);
  assert.equal(invited.state.member, 'tester@example.com');
  const done = world({ member: 'tester@example.com', session: 'ready' });
  assert.deepEqual(await approveAccess(done.store, conversation, env, done.send, done.fetcher), { changed: true, text: 'sent', account: 'existing' });
  assert.deepEqual(done.state.sent, [APPROVED_TEXT]);
  assert.equal(done.state.session, 'ready');
});

test('a failed account setup still approves them and sends the plain text; nothing is sent twice', async () => {
  const w = world();
  w.fetcher = async () => new Response('{}', { status: 500 });
  const result = await approveAccess(w.store, conversation, env, w.send, w.fetcher);
  assert.deepEqual(result, { changed: true, text: 'sent', account: 'failed' });
  assert.equal(w.state.access, 'approved');
  assert.equal(w.state.member, null);
  assert.deepEqual(w.state.sent, [APPROVED_TEXT]);
  const again = world();
  await approveAccess(again.store, conversation, env, again.send, again.fetcher);
  again.state.access = 'waitlisted';
  assert.equal((await approveAccess(again.store, conversation, env, again.send, again.fetcher)).text, 'already_sent');
  assert.equal(again.state.sent.length, 1);
});

test('with self-serve onboarding off, approval behaves as before and creates nothing', async () => {
  const w = world();
  const off = { ...env, SELF_SERVE_ONBOARDING_ENABLED: 'false' };
  assert.deepEqual(await approveAccess(w.store, conversation, off, w.send, w.fetcher), { changed: true, text: 'sent', account: null });
  assert.equal(w.state.users.length, 0);
  assert.equal(w.state.member, null);
  assert.deepEqual(w.state.sent, [APPROVED_TEXT]);
  assert.equal(approvalPreview({ ...off, WAITLIST_ENABLED: 'false' }), null);
  // It also stays off without the onboarding offer or the real Gmail import.
  for (const missing of ['ONBOARDING_ENABLED', 'GMAIL_IMPORT_ENABLED']) assert.equal(approvalPreview({ ...env, [missing]: 'false' }).account, false);
});

test('the owner sees what approving does and how it went', () => {
  const preview = approvalPreview(env);
  assert.deepEqual(preview, { text: approvedWelcomeText(env), account: true });
  assert.match(approvalLines(preview.text, true).join(' '), /sets up their account/);
  assert.doesNotMatch(approvalLines(APPROVED_TEXT, false).join(' '), /account/);
  assert.match(accessResult('approved', { changed: true, text: 'sent', account: 'created' }), /^Approved\. Account set up\./);
  assert.match(accessResult('approved', { changed: true, text: 'sent', account: 'failed' }), /could not be set up/);
});
