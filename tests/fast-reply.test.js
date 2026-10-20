import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox, searchUpdates } from '../lib/inbox.js';
import { generateReply, searchFollowup } from '../lib/ai.js';
import { agentTurn, tool, agentTurns } from './helpers/agent.js';

const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key' };
const delivery = (id = 'fake-message') => ({ space: { phone: 'fake-line' }, message: { id, sender: { id: 'fake-person' }, content: { text: 'Find a navy waxed jacket' } } });
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
function gate() { let open; const opened = new Promise(resolve => { open = resolve; }); return { open, opened }; }

// An in-memory store that keeps outbound rows in the order the conversation would show them.
function memoryStore() {
  const rows = [], events = [];
  const row = op => rows.find(r => r.operation_id === op);
  return { rows, events,
    receive: async () => 'conversation',
    claimAI: async (_c, op) => { if (row(op)) return false; rows.push({ operation_id: op, status: 'generating', seq: rows.length }); return true; },
    context: async () => [{ direction: 'inbound', body: 'Find a navy waxed jacket', status: 'received' }],
    reserve: async (_c, op, body, source) => { if (row(op)) return false; rows.push({ operation_id: op, body, source, status: 'sending', seq: rows.length }); return true; },
    operation: async op => row(op) ? { conversation_id: 'conversation', ...row(op) } : null,
    prepareAI: async (op, body, source, { resequence = false } = {}) => { Object.assign(row(op), { body, source, status: 'sending', ...(resequence ? { seq: rows.length } : {}) }); events.push(['prepare', op, resequence]); },
    finish: async (op, status) => { row(op).status = status; },
    searchResult: async (op, result) => { row(op).search_result = result; },
    history: () => [...rows].sort((a, b) => a.seq - b.seq).filter(r => r.status === 'sent').map(r => r.body),
  };
}
// A search turn as the agent runs it: commit to the search (sending the acknowledgment), then search.
const searchTurn = (search, acknowledgment = 'Looking for a navy waxed jacket now.') => async (_messages, _env, _fetch, memory) => {
  await memory.searchStarting({ acknowledgment, brief: 'navy waxed jacket' });
  await memory.recordSearch({ identification_policy: 'text_wishlist', products: [] });
  await search;
  return 'Here are the options I found.';
};
const quiet = { progress: async () => async () => {}, writeFollowup: async () => null };

test('a search turn is acknowledged before the webhook responds, and the result follows as its own message', async () => {
  const db = memoryStore(), sent = [], search = gate(), deferred = [];
  const outcome = await receiveInInbox(delivery(), env, { ...quiet, store: db, generate: searchTurn(search.opened),
    send: async (_d, body) => { sent.push(body); return { id: `sent-${sent.length}` }; }, defer: work => deferred.push(work) });
  assert.equal(outcome, 'imessage_ai_search_acknowledged');
  assert.deepEqual(sent, ['Looking for a navy waxed jacket now.']);
  assert.equal(deferred.length, 1);
  search.open(); await deferred[0];
  assert.deepEqual(sent, ['Looking for a navy waxed jacket now.', 'Here are the options I found.']);
  // History keeps send order, so the next turn sees the acknowledgment before the result.
  assert.deepEqual(db.history(), ['Looking for a navy waxed jacket now.', 'Here are the options I found.']);
  assert.deepEqual(db.events, [['prepare', 'ai:fake-message', true]]);
  assert.equal(db.rows.find(r => r.operation_id === 'ack:fake-message').source, 'ai');
});

test('turns that do not search complete before the webhook responds and send one message', async () => {
  const db = memoryStore(), sent = [], deferred = [];
  const outcome = await receiveInInbox(delivery(), env, { ...quiet, store: db, generate: async () => 'Saved to your wishlist.',
    send: async (_d, body) => { sent.push(body); }, defer: work => deferred.push(work) });
  assert.equal(outcome, 'imessage_ai_reply_sent');
  assert.deepEqual(sent, ['Saved to your wishlist.']); assert.equal(deferred.length, 0);
  assert.deepEqual(db.events, [['prepare', 'ai:fake-message', false]]);
});

test('a webhook retry during a background search sends neither a second acknowledgment nor a second result', async () => {
  const db = memoryStore(), sent = [], search = gate(), deferred = [];
  let generated = 0;
  const options = { ...quiet, store: db, send: async (_d, body) => { sent.push(body); }, defer: work => deferred.push(work),
    generate: (...args) => { generated++; return searchTurn(search.opened)(...args); } };
  assert.equal(await receiveInInbox(delivery(), env, options), 'imessage_ai_search_acknowledged');
  assert.equal(await receiveInInbox(delivery(), env, options), 'imessage_ai_duplicate');
  search.open(); await Promise.all(deferred);
  assert.equal(await receiveInInbox(delivery(), env, options), 'imessage_ai_duplicate');
  assert.equal(generated, 1); assert.equal(sent.length, 2);
});

test('an acknowledgment is sent once even when the turn starts its search again', async () => {
  const sent = [];
  const updates = searchUpdates({ followupAfterMs: 1000, writeFollowup: async () => null, deliver: async (kind, body) => { sent.push([kind, body]); return { status: 'sent' }; } });
  await updates.begin({ acknowledgment: 'On it.' }); await updates.begin({ acknowledgment: 'On it again.' });
  await updates.finish();
  assert.deepEqual(sent, [['ack', 'On it.']]); assert.equal(updates.timing.acknowledged, true);
});

test('a search past the deadline gets one model-written follow-up, before the result', async () => {
  const db = memoryStore(), sent = [], search = gate(), deferred = [], briefs = [];
  await receiveInInbox(delivery(), env, { ...quiet, store: db, generate: searchTurn(search.opened), followupAfterMs: 20,
    writeFollowup: async input => { briefs.push(input); return 'Still digging through a few stores.'; },
    send: async (_d, body) => { sent.push(body); }, defer: work => deferred.push(work) });
  await tick(80);
  search.open(); await deferred[0];
  assert.deepEqual(sent, ['Looking for a navy waxed jacket now.', 'Still digging through a few stores.', 'Here are the options I found.']);
  assert.deepEqual(briefs, [{ brief: 'navy waxed jacket', acknowledgment: 'Looking for a navy waxed jacket now.' }]);
  assert.deepEqual(db.history(), sent);
  assert.equal(db.rows.find(r => r.operation_id === 'ai:fake-message').search_result.timing_diagnostics.followup_sent, true);
});

test('no follow-up when the search finishes before the deadline, or when the model writes nothing usable', async () => {
  for (const [followupAfterMs, text] of [[60000, 'Still looking.'], [10, null]]) {
    const sent = [], search = gate(), deferred = [];
    await receiveInInbox(delivery(), env, { ...quiet, store: memoryStore(), generate: searchTurn(search.opened), followupAfterMs,
      writeFollowup: async () => text, send: async (_d, body) => { sent.push(body); }, defer: work => deferred.push(work) });
    await tick(30); search.open(); await deferred[0]; await tick(30);
    assert.deepEqual(sent, ['Looking for a navy waxed jacket now.', 'Here are the options I found.']);
  }
});

// October 19: the follow-up time counts from the start of the turn, not from when the search began,
// so a search that starts late in the turn can't get its follow-up a moment before the turn deadline.
test('the follow-up counts from the start of the turn, not from the start of the search', async () => {
  let clock = 0;
  const sent = [];
  // The search begins 45 s into the turn; its follow-up is due 20 ms later, not 45 s later.
  const updates = searchUpdates({ now: () => clock, followupAfterMs: 45020, writeFollowup: async () => 'Still looking.', deliver: async (kind, body) => { sent.push(body); return { status: 'sent' }; } });
  clock = 45000;
  await updates.begin({ acknowledgment: 'On it.' });
  await tick(200);
  assert.deepEqual(sent, ['On it.', 'Still looking.']); assert.equal(updates.timing.followup_sent, true);
  await updates.finish();
});

test('a search that begins after the follow-up time gets only its acknowledgment', async () => {
  let clock = 0, written = 0;
  const sent = [], started = [];
  const updates = searchUpdates({ now: () => clock, followupAfterMs: 90000, onStart: () => started.push(clock),
    writeFollowup: async () => { written++; return 'Still looking.'; }, deliver: async (kind, body) => { sent.push(body); return { status: 'sent' }; } });
  clock = 95000;
  await updates.begin({ acknowledgment: 'On it.' });
  await tick(20); await updates.finish();
  assert.deepEqual(sent, ['On it.']); assert.equal(written, 0); assert.deepEqual(started, [95000]);
});

test('a follow-up still being written when the result is ready is dropped, never sent after it', async () => {
  const sent = [], written = gate();
  const updates = searchUpdates({ followupAfterMs: 5, writeFollowup: () => written.opened, deliver: async (kind, body) => { sent.push(body); return { status: 'sent' }; } });
  await updates.begin({ acknowledgment: 'On it.' });
  await tick(20);
  await updates.finish(); sent.push('Result');
  written.open('Still looking.'); await tick(10);
  assert.deepEqual(sent, ['On it.', 'Result']); assert.equal(updates.timing.followup_sent, false);
});

test('a follow-up already being sent finishes before the result goes out', async () => {
  const order = [], delivering = gate(), sending = gate();
  const updates = searchUpdates({ followupAfterMs: 5, writeFollowup: async () => 'Still looking.',
    deliver: async (kind, body) => { if (kind === 'followup') { sending.open(); await delivering.opened; } order.push(body); return { status: 'sent' }; } });
  await updates.begin({ acknowledgment: 'On it.' });
  // Wait for the follow-up to be mid-send, not a fixed delay: a slow CI runner may not have fired its timer yet.
  await sending.opened;
  const finishing = updates.finish().then(() => order.push('Result'));
  await tick(5); delivering.open(); await finishing;
  assert.deepEqual(order, ['On it.', 'Still looking.', 'Result']);
});

test('time to first message and time to result are recorded with the search outcome', async () => {
  let clock = 1000;
  const db = memoryStore(), deferred = [], search = gate();
  await receiveInInbox(delivery(), env, { ...quiet, store: db, now: () => clock, generate: searchTurn(search.opened),
    send: async () => { clock += 2000; }, defer: work => deferred.push(work) });
  clock += 40000; search.open(); await deferred[0];
  const timing = db.rows.find(r => r.operation_id === 'ai:fake-message').search_result.timing_diagnostics;
  assert.deepEqual(timing, { acknowledged: true, followup_sent: false, first_message_ms: 2000, result_ms: 44000, compact_retry: false });
});

test('a failed reply is retried once with a compact context before the generic fallback', async () => {
  const db = memoryStore(), sent = [], calls = [];
  await receiveInInbox(delivery(), env, { ...quiet, store: db, send: async (_d, body) => { sent.push(body); },
    generate: async (_m, _e, _f, memory) => { calls.push(memory.compact === true); if (calls.length === 1) throw new Error('timeout'); return 'What is the occasion?'; } });
  assert.deepEqual(calls, [false, true]); assert.deepEqual(sent, ['What is the occasion?']);
  const failing = memoryStore(), fallback = []; let attempts = 0;
  await receiveInInbox(delivery(), env, { ...quiet, store: failing, send: async (_d, body) => { fallback.push(body); },
    generate: async () => { attempts++; throw new Error('timeout'); } });
  assert.equal(attempts, 2); assert.match(fallback[0], /couldn’t prepare a reply/);
});

test('a compact retry discards the failed attempt’s search outcome', async () => {
  const db = memoryStore(); let attempt = 0;
  await receiveInInbox(delivery(), env, { ...quiet, store: db, send: async () => {},
    generate: async (_m, _e, _f, memory) => { if (++attempt === 1) { await memory.recordSearch({ identification_policy: 'text_wishlist', products: [{ url: 'https://shop.example/a' }] }); throw new Error('later step failed'); } return 'Tell me more about the fit.'; } });
  assert.equal(db.rows.find(r => r.operation_id === 'ai:fake-message').search_result, null);
});

test('compact agent input keeps the newest turns and pending options but drops older history', async () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ direction: i % 2 ? 'outbound' : 'inbound', status: 'sent', body: 'x'.repeat(1500) + i }));
  for (const compact of [false, true]) {
    await generateReply(history, env, async (_url, options) => {
      const turns = agentTurns(JSON.parse(options.body).input);
      assert.equal(turns.length, compact ? 6 : 20); assert.ok(turns.every(t => t.content.length <= (compact ? 600 : 2000)));
      return agentTurn(tool('conversation_reply', { response: 'Noted.' }));
    }, { compact });
  }
});

test('the agent’s acknowledgment is sent before the search runs; one with a link is not sent', async () => {
  for (const [acknowledgment, expected] of [['Looking for Paraboot Michaels in black.', 'Looking for Paraboot Michaels in black.'], ['See https://shop.example', null]]) {
    const order = [];
    await generateReply([{ direction: 'inbound', body: 'Find black Paraboot Michael', status: 'received' }], { ...env, SEARCH_ENABLED: 'true' },
      async () => agentTurn(tool('find_products', { query: 'Paraboot Michael black', acknowledgment })),
      { wishlistAction: async () => { order.push('search'); return 'Found it.'; }, searchStarting: async update => order.push(update) });
    assert.deepEqual(order, [{ acknowledgment: expected, brief: 'Paraboot Michael black' }, 'search']);
  }
});

test('the follow-up is written by the model in Jules’s voice and rejected when it contains a link', async () => {
  for (const [message, expected] of [['Still on it, a couple of stores are slow.', 'Still on it, a couple of stores are slow.'], ['Check https://x.example', null]]) {
    const result = await searchFollowup({ brief: 'navy waxed jacket', acknowledgment: 'Looking now.' }, env, async (_url, options) => {
      const body = JSON.parse(options.body); assert.match(body.instructions, /source of truth/); assert.match(body.input, /navy waxed jacket/);
      return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ message }) }] }] }) };
    });
    assert.equal(result, expected);
  }
});
