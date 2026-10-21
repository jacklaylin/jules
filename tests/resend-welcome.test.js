import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { resendWelcome, resendWelcomeText, approvedWelcomeText } from '../lib/onboarding.js';
import { CONTACT_CARD_TEXT } from '../lib/contact-card.js';
import { welcomeResult } from '../public/admin-people-view.js';

// Admin › person › Resend the welcome: texts the onboarding welcome again on purpose, e.g. after the first
// ended 'uncertain'. Synthetic numbers and ids only.
const env = { SITE_ORIGIN: 'https://jules.example', JULES_PUBLIC_LINE: '+15555550100' };
const id = '00000000-0000-4000-8000-0000000000c1', phone = '+15555550123';
const original = 'good news: your spot just opened. connect here: https://jules.example/onboarding';

function world({ state = 'offered', optedOut = false, first = { status: 'uncertain', body: original }, failSend = false } = {}) {
  const conversation = { id, sender_id: phone, line: 'shared', ...(optedOut && { sms_opted_out_at: '2026-10-20T00:00:00Z' }) };
  const ledger = new Map(first ? [[`onboarding:${id}:welcome`, { conversation_id: id, ...first }]] : []), sent = [];
  const store = {
    conversation: async c => c === id ? conversation : null,
    onboardingSession: async () => state ? { state } : null,
    operation: async op => ledger.get(op) ?? null,
    reserve: async (conversation_id, op, body) => {
      if (ledger.has(op)) return false;
      ledger.set(op, { conversation_id, body, status: optedOut ? 'blocked' : 'sending' }); return !optedOut;
    },
    finish: async (op, status) => { ledger.get(op).status = status; },
    createSignInLink: async () => 'token-1',
  };
  const send = async (target, body, _reply, options) => {
    if (failSend) throw Object.assign(new Error('boom'), { name: 'ConnectError', code: 'unavailable' });
    sent.push({ to: target.space.phone, body, files: options?.files?.map(f => f.name) ?? [] }); return { id: `p${sent.length}` };
  };
  return { conversation, store, ledger, sent, send };
}

test('a resend after an uncertain welcome texts the same welcome with a signed link, then the card, keeping the old entry', async () => {
  const w = world();
  assert.equal(await resendWelcomeText(w.store, id, env, 'offered'), original);
  const result = await resendWelcome(w.store, w.conversation, env, w.send);
  assert.deepEqual(result, { welcome: 'sent', contact_card: 'sent' });
  assert.deepEqual(w.sent.map(s => s.body), [original.replace('/onboarding', '/onboarding#signin=token-1'), CONTACT_CARD_TEXT]);
  assert.deepEqual(w.sent[1].files, ['jules.vcf']);
  assert.equal(w.ledger.get(`onboarding:${id}:welcome`).status, 'uncertain', 'the first welcome is never reused or deleted');
  const resent = [...w.ledger].find(([op]) => op.startsWith(`onboarding:${id}:welcome:`));
  assert.deepEqual([resent[1].body, resent[1].status], [original, 'sent'], 'the ledger keeps the plain link');
});

test('two clicks are two separate ledger entries; an accepted tester can get it too', async () => {
  const w = world({ state: 'accepted' });
  await resendWelcome(w.store, w.conversation, env, w.send);
  await resendWelcome(w.store, w.conversation, env, w.send);
  const welcomes = [...w.ledger.keys()].filter(op => op.startsWith(`onboarding:${id}:welcome:`));
  assert.equal(welcomes.length, 2);
  assert.notEqual(welcomes[0], welcomes[1]);
  assert.equal(w.sent.filter(s => s.body !== CONTACT_CARD_TEXT).length, 2);
});

test('a number that texted STOP is blocked: nothing is sent, not even the card', async () => {
  const w = world({ optedOut: true });
  assert.deepEqual(await resendWelcome(w.store, w.conversation, env, w.send), { welcome: 'blocked' });
  assert.equal(w.sent.length, 0);
});

test('only offered or accepted onboarding can be resent; nothing is sent otherwise', async () => {
  for (const state of [null, 'invited', 'declined', 'completed']) {
    const w = world({ state });
    assert.equal(await resendWelcomeText(w.store, id, env, state), null);
    await assert.rejects(resendWelcome(w.store, w.conversation, env, w.send), error => error.status === 409);
    assert.equal(w.sent.length, 0);
    assert.equal(w.ledger.size, 1);
  }
});

test('with no earlier welcome the approval welcome is used; a failed send is uncertain and sends no card', async () => {
  const w = world({ first: null });
  assert.equal(await resendWelcomeText(w.store, id, env, 'offered'), approvedWelcomeText(env));
  const failed = world({ failSend: true }), log = console.log, logs = [];
  console.log = line => logs.push(line);
  try { assert.deepEqual(await resendWelcome(failed.store, failed.conversation, env, failed.send), { welcome: 'uncertain' }); }
  finally { console.log = log; }
  assert.ok(logs.some(l => JSON.parse(l).event === 'imessage_send_failed' && JSON.parse(l).code === 'unavailable'));
  assert.equal(failed.sent.length, 0);
});

const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } });
async function post(handler, input, origin = 'https://jules.example') {
  const res = response();
  await handler({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res);
  return res;
}
test('Admin: resend is owner-only, from the Jules site and confirmed', async () => {
  const w = world(), handler = createAdminHandler({ auth: async () => 200, env, send: w.send, storeFactory: () => w.store });
  const input = { action: 'resend-welcome', conversation: id, confirm: true };
  assert.equal((await post(createAdminHandler({ auth: async () => 401, env, storeFactory: () => assert.fail('no database') }), input)).statusCode, 401);
  for (const origin of [null, 'https://evil.example']) assert.equal((await post(handler, input, origin)).statusCode, 400);
  assert.equal((await post(handler, { ...input, confirm: false })).statusCode, 400);
  assert.equal(w.sent.length, 0);
  const done = await post(handler, input);
  assert.deepEqual([done.statusCode, done.body.welcome, done.body.contact_card], [200, 'sent', 'sent']);
  assert.equal(welcomeResult(done.body), 'Welcome sent again and the contact card.');
  assert.match(welcomeResult({ welcome: 'blocked' }), /STOP/);
  assert.match(welcomeResult({ welcome: 'uncertain' }), /imessage_send_failed/);
});
