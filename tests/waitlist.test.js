import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { WAITLIST_NOTICE, WAITLIST_REPLIES, waitlistContext } from '../lib/waitlist.js';
import { sweepStalledReplies, STALL_MS } from '../lib/reply-failures.js';

const id = '00000000-0000-4000-8000-000000000002';
// Mirrors db/035_waitlist.sql claim_waitlist_turn: an allowance of real replies, then one notice a day.
// The message ledger mirrors claim_ai_reply / reserve_reply and the stalled-reply watchdog's queries.
function waitlistStore(access = 'waitlisted') {
  const operations = new Map();
  const row = (op, status, source) => ({ id: op, operation_id: op, conversation_id: id, status, source, created_at: new Date(store.now).toISOString(), reply_diagnostics: null });
  const store = { operations, access, replies: 0, noticeAt: null, now: Date.now(), turns: 0,
    async receive() { return id; },
    async smsOptedOut() { return false; },
    async claimAI(_c, op) { if (operations.has(op)) return false; operations.set(op, row(op, 'generating', 'ai')); return true; },
    async claimWaitlistTurn(_id, allowance) {
      store.turns++;
      if (store.access === 'approved') return { outcome: 'approved', replies_used: 0 };
      if (store.replies < allowance) return { outcome: 'reply', replies_used: ++store.replies };
      if (store.noticeAt === null || store.noticeAt < store.now - 86400000) { store.noticeAt = store.now; return { outcome: 'notice', replies_used: store.replies }; }
      return { outcome: 'quiet', replies_used: store.replies };
    },
    async reserve(conversation_id, op, body, source) { if (operations.has(op)) return false; operations.set(op, { ...row(op, 'sending', source), body }); return true; },
    async finish(op, status) { if (operations.has(op)) operations.get(op).status = status; },
    async stalledReplies(before) { return [...operations.values()].filter(m => m.operation_id.startsWith('ai:') && ['generating', 'sending'].includes(m.status) && m.created_at < before && !m.reply_diagnostics?.stalled_at); },
    async claimStalledReply(rowId, diagnostics) { const m = operations.get(rowId); if (!m || m.reply_diagnostics?.stalled_at) return false; m.reply_diagnostics = diagnostics; return true; },
    async conversation() { return { id, line: 'fake-line', sender_id: 'fake-sender' }; },
    async repliedSince(_c, at) { return [...operations.values()].some(m => m.status === 'sent' && m.created_at > at); },
    async operation(op) { return operations.get(op) ?? null; },
    async context() { return [{ id: 'm', direction: 'inbound', body: 'hi', created_at: new Date().toISOString() }]; },
    async replyDiagnostics(op, data) { if (operations.has(op)) operations.get(op).reply_diagnostics = data; },
    async prepareAI() {},
    async searchResult() {},
  };
  return store;
}
let count = 0;
const inbound = text => ({ space: { phone: 'fake-line' }, message: { id: `fake-waitlist-${++count}`, sender: { id: 'fake-sender' }, content: { text } } });
const on = { AI_ENABLED: 'true', WAITLIST_ENABLED: 'true' };
function harness(access) {
  const store = waitlistStore(access), sent = [], seen = [];
  const options = { store, send: async (_d, body) => { sent.push(body); return { id: `sent-${sent.length}` }; },
    generate: async (_c, _e, _f, memory) => { seen.push(memory.waitlist ?? null); return 'agent reply'; }, progress: async () => async () => {} };
  return { store, sent, seen, options };
}

test('a waitlisted number gets the reply allowance, then one notice, then nothing until a day passes', async () => {
  const h = harness();
  for (let i = 0; i < WAITLIST_REPLIES; i++) await receiveInInbox(inbound('find me a navy coat'), on, h.options);
  assert.deepEqual(h.seen, [1, 2, 3].map(used => ({ replies_used: used, replies_left: WAITLIST_REPLIES - used })));
  assert.equal(await receiveInInbox(inbound('and boots?'), on, h.options), 'imessage_waitlist_notice');
  assert.equal(h.sent.at(-1), WAITLIST_NOTICE);
  const sends = h.sent.length;
  assert.equal(await receiveInInbox(inbound('hello?'), on, h.options), 'imessage_waitlist_quiet');
  assert.equal(h.sent.length, sends);
  assert.equal(h.seen.length, WAITLIST_REPLIES);
  h.store.now += 86400001;
  assert.equal(await receiveInInbox(inbound('still there?'), on, h.options), 'imessage_waitlist_notice');
});

test('an approved number is never limited and the agent sees no waitlist', async () => {
  const h = harness('approved');
  for (let i = 0; i < WAITLIST_REPLIES + 2; i++) await receiveInInbox(inbound('find me a navy coat'), on, h.options);
  assert.equal(h.seen.length, WAITLIST_REPLIES + 2);
  assert.ok(h.seen.every(w => w === null));
  assert.ok(!h.sent.includes(WAITLIST_NOTICE));
});

test('with the switch off, waitlist state is never read', async () => {
  const h = harness();
  for (let i = 0; i < WAITLIST_REPLIES + 2; i++) await receiveInInbox(inbound('find me a navy coat'), { AI_ENABLED: 'true' }, h.options);
  assert.equal(h.store.turns, 0);
  assert.equal(h.seen.length, WAITLIST_REPLIES + 2);
  assert.ok(!h.sent.includes(WAITLIST_NOTICE));
});

test('the agent context reports remaining replies only for allowance turns', () => {
  assert.equal(waitlistContext(null), null);
  assert.equal(waitlistContext({ outcome: 'approved', replies_used: 0 }), null);
  assert.deepEqual(waitlistContext({ outcome: 'reply', replies_used: WAITLIST_REPLIES }), { replies_used: WAITLIST_REPLIES, replies_left: 0 });
});

// The AI claim runs first so a redelivered webhook is deduplicated before it can use a waitlist turn.
// Notice and quiet turns must close that claim, or the stalled-reply watchdog would later text the
// person "sorry, i lost track of your last message" and alert the founder about a reply never meant to go.
test('waitlist notice and quiet turns leave no reply for the stalled-reply watchdog', async () => {
  const h = harness();
  for (let i = 0; i < WAITLIST_REPLIES; i++) await receiveInInbox(inbound('find me a navy coat'), on, h.options);
  assert.equal(await receiveInInbox(inbound('and boots?'), on, h.options), 'imessage_waitlist_notice');
  assert.equal(await receiveInInbox(inbound('hello?'), on, h.options), 'imessage_waitlist_quiet');
  const held = [...h.store.operations.values()].filter(m => m.operation_id.startsWith('ai:') && m.reply_diagnostics?.outcome?.startsWith('waitlist_'));
  assert.deepEqual(held.map(m => [m.status, m.reply_diagnostics.outcome]), [['blocked', 'waitlist_notice'], ['blocked', 'waitlist_quiet']]);
  assert.ok(![...h.store.operations.values()].some(m => m.status === 'generating'));
  const texts = [];
  h.store.now += STALL_MS + 1000;
  const swept = await sweepStalledReplies({ AI_ENABLED: 'true', FOUNDER_ALERT_PHONE: 'founder-test-handle' },
    { store: h.store, now: () => h.store.now, send: async (_d, body) => { texts.push(body); return { id: 'x' }; }, write: async () => 'recovery' });
  assert.deepEqual(swept, { stalled: 0, recovered: 0, alerted: 0 });
  assert.deepEqual(texts, []);
});

test('a redelivered waitlisted message is deduplicated before it uses a waitlist turn', async () => {
  const h = harness();
  for (let i = 0; i < WAITLIST_REPLIES; i++) await receiveInInbox(inbound('find me a navy coat'), on, h.options);
  const message = inbound('and boots?');
  assert.equal(await receiveInInbox(message, on, h.options), 'imessage_waitlist_notice');
  const turns = h.store.turns, sends = h.sent.length;
  assert.equal(await receiveInInbox(message, on, h.options), 'imessage_ai_duplicate');
  assert.equal(h.store.turns, turns);
  assert.equal(h.sent.length, sends);
});
