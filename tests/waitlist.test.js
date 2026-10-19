import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { WAITLIST_NOTICE, WAITLIST_REPLIES, waitlistContext } from '../lib/waitlist.js';

const id = '00000000-0000-4000-8000-000000000002';
// Mirrors db/034_waitlist.sql claim_waitlist_turn: an allowance of real replies, then one notice a day.
function waitlistStore(access = 'waitlisted') {
  const operations = new Map();
  const store = { operations, access, replies: 0, noticeAt: null, now: Date.now(), turns: 0,
    async receive() { return id; },
    async smsOptedOut() { return false; },
    async claimAI() { return true; },
    async claimWaitlistTurn(_id, allowance) {
      store.turns++;
      if (store.access === 'approved') return { outcome: 'approved', replies_used: 0 };
      if (store.replies < allowance) return { outcome: 'reply', replies_used: ++store.replies };
      if (store.noticeAt === null || store.noticeAt < store.now - 86400000) { store.noticeAt = store.now; return { outcome: 'notice', replies_used: store.replies }; }
      return { outcome: 'quiet', replies_used: store.replies };
    },
    async reserve(conversation_id, op, body, source) { if (operations.has(op)) return false; operations.set(op, { body, source, status: 'sending' }); return true; },
    async finish(op, status) { if (operations.has(op)) operations.get(op).status = status; },
    async operation(op) { return operations.get(op) ?? null; },
    async context() { return [{ id: 'm', direction: 'inbound', body: 'hi', created_at: new Date().toISOString() }]; },
    async replyDiagnostics() {},
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
