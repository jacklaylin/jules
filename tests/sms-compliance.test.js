import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { complianceKeyword, STOP_REPLY, START_REPLY } from '../lib/sms-compliance.js';
import { receiveInInbox } from '../lib/inbox.js';
import { deliverReply } from '../lib/replies.js';
import { createPhoneLoginHandler } from '../lib/phone-login.js';

const id = '00000000-0000-4000-8000-000000000001';
const conversation = { id, sender_id: 'fake-sender', line: 'fake-line' };
// Mirrors db/025_sms_opt_out.sql: reserve_reply records a 'blocked' row and refuses non-compliance
// sends while opted out; claim_ai_reply refuses; set_sms_opt_out reports whether the state changed.
function ledgerStore() {
  const operations = new Map();
  const store = { operations, optedOut: false, claims: 0,
    async receive() { return id; },
    async smsOptedOut() { return store.optedOut; },
    async setSmsOptOut(_id, value) { if (store.optedOut === value) return false; store.optedOut = value; return true; },
    async reserve(conversation_id, op, body, source) {
      if (operations.has(op)) return false;
      const blocked = store.optedOut && source !== 'compliance';
      operations.set(op, { conversation_id, body, source, status: blocked ? 'blocked' : 'sending' });
      return !blocked;
    },
    async claimAI() { store.claims++; return !store.optedOut; },
    async finish(op, status) { operations.get(op).status = status; },
    async operation(op) { return operations.get(op) ?? null; },
  };
  return store;
}
let count = 0;
const inbound = text => ({ space: { phone: 'fake-line' }, message: { id: `fake-message-${++count}`, sender: { id: 'fake-sender' }, content: { text } } });
const env = { AI_ENABLED: 'true', SITE_ORIGIN: 'https://jules.example' };
function harness() {
  const store = ledgerStore(), sent = [];
  let generated = 0;
  const options = { store, send: async (_d, body) => { sent.push(body); return { id: `sent-${sent.length}` }; },
    generate: async () => { generated++; return 'agent reply'; }, progress: async () => async () => {} };
  return { store, sent, options, generated: () => generated };
}

test('only a whole-message carrier keyword is a compliance keyword', () => {
  for (const word of ['STOP', 'stop', ' Stop. ', 'unsubscribe', 'CANCEL', 'end', 'Quit', 'stopall']) assert.equal(complianceKeyword(word), 'stop', word);
  for (const word of ['START', 'unstop']) assert.equal(complianceKeyword(word), 'start', word);
  assert.equal(complianceKeyword('help'), 'help');
  for (const text of ['stop watching the coat', 'cancel my price alert', 'can you help me find boots', 'the end', '', null]) assert.equal(complianceKeyword(text), null, String(text));
});

test('STOP opts out before the agent, confirms once, and repeated STOP sends nothing', async () => {
  const h = harness();
  assert.equal(await receiveInInbox(inbound('STOP'), env, h.options), 'sms_opted_out');
  assert.equal(h.store.optedOut, true);
  assert.deepEqual(h.sent, [STOP_REPLY]);
  assert.equal(h.generated(), 0);
  assert.equal(h.store.claims, 0);
  assert.equal(await receiveInInbox(inbound('quit'), env, h.options), 'sms_opt_out_repeated');
  assert.equal(h.sent.length, 1);
});

test('after STOP, messages get no reply and every ledger send is blocked and recorded', async () => {
  const h = harness();
  await receiveInInbox(inbound('stop'), env, h.options);
  assert.equal(await receiveInInbox(inbound('find me a navy coat'), env, h.options), 'imessage_opted_out_received');
  assert.equal(h.generated(), 0);
  const alert = await deliverReply({ store: h.store, send: h.options.send, conversation, operation: 'price-alert:fake', body: 'price dropped', source: 'operator', env });
  assert.equal(alert.status, 'blocked');
  assert.equal(h.store.operations.get('price-alert:fake').status, 'blocked');
  assert.equal(h.sent.length, 1);
  // A blocked send is never sent later, even after START.
  await receiveInInbox(inbound('START'), env, h.options);
  assert.equal((await deliverReply({ store: h.store, send: h.options.send, conversation, operation: 'price-alert:fake', body: 'price dropped', source: 'operator', env })).status, 'blocked');
  assert.ok(!h.sent.includes('price dropped'));
});

test('HELP is answered even while opted out and does not change opt-out state', async () => {
  const h = harness();
  await receiveInInbox(inbound('STOP'), env, h.options);
  assert.equal(await receiveInInbox(inbound('HELP'), env, h.options), 'sms_help_sent');
  assert.equal(h.store.optedOut, true);
  assert.match(h.sent.at(-1), /STOP/);
  assert.match(h.sent.at(-1), /https:\/\/jules\.example\/privacy/);
  assert.equal(h.generated(), 0);
});

test('START re-subscribes after STOP, and later texts are sent again', async () => {
  const h = harness();
  await receiveInInbox(inbound('STOP'), env, h.options);
  assert.equal(await receiveInInbox(inbound('start'), env, h.options), 'sms_opted_in');
  assert.equal(h.store.optedOut, false);
  assert.equal(h.sent.at(-1), START_REPLY);
  const next = await deliverReply({ store: h.store, send: h.options.send, conversation, operation: 'price-alert:later', body: 'back in stock', source: 'operator', env });
  assert.equal(next.status, 'sent');
});

test('START from someone who never opted out is an ordinary message for the agent', async () => {
  const h = harness();
  const outcome = await receiveInInbox(inbound('start'), { ...env, AI_ENABLED: 'false' }, h.options);
  assert.equal(outcome, 'imessage_received');
  assert.equal(h.sent.length, 0);
});

test('an opted-out number gets no sign-in code text and the same response', async () => {
  const loginEnv = { SITE_ORIGIN: 'https://jules.example', SUPABASE_URL: 'https://auth.example', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret', SUPABASE_ANON_KEY: 'synthetic-public' };
  const store = { phoneLoginMember: async () => ({ email: 'person@example.test', line: 'test-line', opted_out: true }), beginPhoneLogin: async () => true };
  const run = createPhoneLoginHandler({ env: loginEnv, storeFactory: () => store, send: () => assert.fail('no text'), fetcher: () => assert.fail('no code') });
  const req = Object.assign(Readable.from([JSON.stringify({ action: 'request', phone: '+14155550123' })]), { method: 'POST', headers: { origin: loginEnv.SITE_ORIGIN, 'content-type': 'application/json' }, socket: { remoteAddress: 'synthetic' } });
  const res = { setHeader() {}, end(v) { this.data = JSON.parse(v); } };
  await run(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.data.challenge);
});
