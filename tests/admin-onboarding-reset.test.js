import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { createStore } from '../lib/store.js';
import { welcomeTester } from '../lib/onboarding.js';
import { sealToken } from '../lib/gmail-client.js';

// Owner reset of one person's onboarding, so the founder can re-test signup with an existing number.
const me = '00000000-0000-4000-8000-0000000000a1', other = '00000000-0000-4000-8000-0000000000b2';
const env = { SITE_ORIGIN: 'https://jules.example/', ONBOARDING_ENABLED: 'true', GMAIL_IMPORT_ENABLED: 'true', GOOGLE_GMAIL_CLIENT_ID: 'synthetic-client', GOOGLE_GMAIL_CLIENT_SECRET: 'synthetic-secret', GMAIL_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') };
const tokens = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600000 };

// One store holding two invited people. Each has onboarding texts, an ordinary reply, an import with
// a Gmail token and evidence, a profile fact and a wishlist entry; only `me` should change.
function world() {
  const sessions = new Map([[me, 'ready'], [other, 'ready']]);
  const messages = [me, other].flatMap(c => [
    { conversation_id: c, operation_id: `onboarding:${c}:welcome`, body: 'welcome', status: 'sent' },
    { conversation_id: c, operation_id: `onboarding:${c}:started`, body: 'started', status: 'sent' },
    { conversation_id: c, operation_id: `ai:${c}:1`, body: 'a shopping reply', status: 'sent' },
  ]);
  const imports = new Map([me, other].map(c => [c, { conversation_id: c, revision: 0, lease_until: null, token_ciphertext: sealToken(tokens, c, env), data: { job: { status: 'ready', started_at: '2026-10-01T00:00:00Z' }, questions: [] } }]));
  const evidence = [me, other].flatMap(c => [{ conversation_id: c, origin: 'gmail' }, { conversation_id: c, origin: 'shop' }, { conversation_id: c, origin: 'message' }]);
  const profiles = new Map([[me, ['size: 32']], [other, ['size: 30']]]), wishlist = new Map([[me, ['jacket']], [other, ['boots']]]);
  const store = {
    conversation: async id => sessions.has(id) || id === '00000000-0000-4000-8000-0000000000c3' ? { id, sender_id: 'synthetic', line: 'shared' } : null,
    onboardingInvite: async () => ({ id: me, sender_id: 'synthetic', line: 'shared' }),
    onboardingSession: async id => sessions.has(id) ? { state: sessions.get(id) } : null,
    advanceOnboarding: async (id, from, to) => { if (sessions.get(id) !== from) return false; sessions.set(id, to); return true; },
    operation: async op => messages.find(m => m.operation_id === op) ?? null,
    reserve: async (conversation_id, op, body) => { if (messages.some(m => m.operation_id === op)) return false; messages.push({ conversation_id, operation_id: op, body, status: 'sending' }); return true; },
    finish: async (op, status) => { messages.find(m => m.operation_id === op).status = status; },
    gmailImport: async id => imports.has(id) ? structuredClone(imports.get(id)) : null,
    claimGmailImport: async id => { const row = imports.get(id); if (!row || row.lease_until) return null; row.revision++; row.lease_until = 'held'; return structuredClone(row); },
    finishGmailImport: async (id, revision, data, token, rows = [], clear = false) => {
      const row = imports.get(id); if (row.revision !== revision || !row.lease_until) return false;
      Object.assign(row, { data: structuredClone(data), token_ciphertext: token, lease_until: null });
      if (clear) for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].conversation_id === id && ['gmail', 'shop'].includes(evidence[i].origin)) evidence.splice(i, 1);
      return true;
    },
    async resetOnboarding(id) {
      const removed = messages.filter(m => m.conversation_id === id && m.operation_id.startsWith(`onboarding:${id}:`));
      for (const m of removed) messages.splice(messages.indexOf(m), 1);
      sessions.set(id, 'invited'); return { texts_removed: removed.length };
    },
  };
  return { store, sessions, messages, imports, evidence, profiles, wishlist };
}
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } });
async function post(handler, input, origin = 'https://jules.example') {
  const res = response();
  await handler({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res);
  return res;
}
const reset = { action: 'reset-onboarding', conversation: me, confirm: true };
function setup(auth = async () => 200) {
  const w = world(), revoked = [];
  const fetcher = async (url, options) => { revoked.push([url, String(options.body)]); return new Response('', { status: 200 }); };
  return { ...w, revoked, handler: createAdminHandler({ auth, env, fetcher, storeFactory: () => w.store }) };
}

test('reset is owner-only and must come from the Jules site, before any data is touched', async () => {
  for (const status of [401, 403]) {
    const res = await post(createAdminHandler({ auth: async () => status, env, storeFactory: () => assert.fail('must not access database') }), reset);
    assert.equal(res.statusCode, status);
  }
  for (const origin of [null, 'https://evil.example']) {
    // 400, not 403: the admin page reads a 403 as "not the owner" and shows the sign-in gate.
    const res = await post(createAdminHandler({ auth: async () => 200, env, storeFactory: () => assert.fail('must not access database') }), reset, origin);
    assert.equal(res.statusCode, 400); assert.match(res.body.error, /admin page/);
  }
  const unconfigured = await post(createAdminHandler({ auth: async () => 200, env: { ...env, SITE_ORIGIN: '' }, storeFactory: () => assert.fail('must not access database') }), reset);
  assert.equal(unconfigured.statusCode, 400);
});

test('reset needs explicit confirmation and an invited person', async () => {
  const s = setup();
  assert.equal((await post(s.handler, { ...reset, confirm: undefined })).statusCode, 400);
  assert.equal(s.sessions.get(me), 'ready'); assert.equal(s.revoked.length, 0);
  const notInvited = await post(s.handler, { ...reset, conversation: '00000000-0000-4000-8000-0000000000c3' });
  assert.equal(notInvited.statusCode, 409); assert.match(notInvited.body.error, /no onboarding/);
  assert.equal((await post(s.handler, { ...reset, conversation: 'not-a-uuid' })).statusCode, 404);
});

test('reset changes only this person: onboarding texts, imported history and state; everyone else is untouched', async () => {
  const s = setup(), before = structuredClone({ other: s.messages.filter(m => m.conversation_id === other), import: s.imports.get(other) });
  const logs = [], log = console.log; console.log = line => logs.push(line);
  let res; try { res = await post(s.handler, reset); } finally { console.log = log; }
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { state: 'invited', texts_removed: 2, history: 'cleared' });
  assert.equal(s.sessions.get(me), 'invited');
  assert.deepEqual(s.messages.filter(m => m.conversation_id === me).map(m => m.operation_id), [`ai:${me}:1`]);
  // Imported history is cleared exactly as the person's own delete does it.
  assert.equal(s.revoked.length, 1); assert.match(s.revoked[0][0], /oauth2\.googleapis\.com\/revoke/); assert.match(s.revoked[0][1], /synthetic-refresh/);
  assert.equal(s.imports.get(me).token_ciphertext, null); assert.deepEqual(s.imports.get(me).data, { questions: [] }); assert.equal(s.imports.get(me).lease_until, null);
  assert.deepEqual(s.evidence.filter(e => e.conversation_id === me).map(e => e.origin), ['message']);
  // The other person, and this person's profile and wishlist, stay as they were.
  assert.equal(s.sessions.get(other), 'ready');
  assert.deepEqual(s.messages.filter(m => m.conversation_id === other), before.other);
  assert.deepEqual(s.imports.get(other), before.import);
  assert.equal(s.evidence.filter(e => e.conversation_id === other).length, 3);
  assert.deepEqual([s.profiles.get(me), s.wishlist.get(me)], [['size: 32'], ['jacket']]);
  // The structured log carries counts only: no conversation id, phone or message text.
  const event = logs.map(l => JSON.parse(l)).find(l => l.event === 'admin_onboarding_reset');
  assert.deepEqual(event, { event: 'admin_onboarding_reset', texts_removed: 2, history: 'cleared' });
  assert.ok(!logs.join('').includes(me));
});

test('reset is idempotent: running it again leaves the same state and revokes nothing new', async () => {
  const s = setup();
  await post(s.handler, reset);
  const again = await post(s.handler, reset);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.body, { state: 'invited', texts_removed: 0, history: 'cleared' });
  assert.equal(s.revoked.length, 1);
  assert.equal(s.sessions.get(me), 'invited');
  // Someone who never imported anything resets too.
  s.imports.delete(me);
  assert.deepEqual((await post(s.handler, reset)).body, { state: 'invited', texts_removed: 0, history: 'none' });
});

test('a running import step stops the reset before anything changes', async () => {
  const s = setup();
  s.imports.get(me).lease_until = 'held';
  const res = await post(s.handler, reset);
  assert.equal(res.statusCode, 409); assert.match(res.body.error, /nothing was changed/);
  assert.equal(s.sessions.get(me), 'ready');
  assert.equal(s.messages.filter(m => m.conversation_id === me).length, 3);
  assert.equal(s.revoked.length, 0);
});

test('after a reset, signing up again with the same number sends the welcome text again', async () => {
  const s = setup(), sent = [];
  const send = async (_target, body) => { sent.push(body); };
  assert.equal((await welcomeTester('synthetic', s.store, env, send)).message_sent, false);
  await post(s.handler, reset);
  const result = await welcomeTester('synthetic', s.store, env, send);
  assert.equal(result.message_sent, true); assert.equal(sent.length, 1);
  assert.equal(s.sessions.get(me), 'offered');
});

test('the database reset filters by this conversation and its own onboarding operation prefix', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url: decodeURIComponent(url), method: options.method, body: options.body }); return new Response(options.method === 'DELETE' ? JSON.stringify([{ id: 'x' }, { id: 'y' }]) : '', { status: 200 }); };
  const store = createStore({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' }, fetcher);
  assert.deepEqual(await store.resetOnboarding(me), { texts_removed: 2 });
  const [remove, patch] = calls;
  assert.equal(remove.method, 'DELETE');
  assert.ok(remove.url.includes(`messages?conversation_id=eq.${me}&operation_id=like.onboarding:${me}:*`));
  assert.equal(patch.method, 'PATCH');
  assert.ok(patch.url.endsWith(`onboarding_sessions?conversation_id=eq.${me}`));
  assert.equal(JSON.parse(patch.body).state, 'invited');
});
