import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { updatePurchaseHistory, applyQueuedAnswers } from '../lib/receipt-chat.js';
import { errorClass, sweepStalledReplies, alertFounder, GENERIC_FALLBACK, STALL_MS } from '../lib/reply-failures.js';
import { handleReplyWatchdog, resetWatchdogSecret } from '../lib/reply-watchdog.js';
import { createReceiptFeedback } from '../lib/receipt-feedback.js';

// Each class of failure behind the real fallbacks (Oct 14–15) is tested by its outcome: valid work
// still happens, the tester gets a reply that says what happened, the reason is persisted, and the
// founder is told. Wording is not the acceptance criterion; state and delivery are.

const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key' };
const alerting = { ...env, FOUNDER_ALERT_PHONE: 'founder-test-handle', SITE_ORIGIN: 'https://example.invalid' };
const delivery = (id = 'fake-message', text = 'Me for both') => ({ space: { phone: 'fake-line' }, message: { id, sender: { id: 'fake-tester' }, content: { type: 'text', text }, attachments: [] } });
const quiet = { progress: async () => async () => {}, writeFollowup: async () => null };
const json = (status, value) => { const r = { ok: status < 400, status, json: async () => value, text: async () => JSON.stringify(value) }; r.clone = () => r; return r; };

function memoryStore(extra = {}) {
  const rows = [], diagnostics = new Map(), feedback = [];
  const row = op => rows.find(r => r.operation_id === op);
  return { rows, diagnostics, feedback,
    receive: async () => 'conversation',
    claimAI: async (_c, op) => { rows.push({ operation_id: op, status: 'generating' }); return true; },
    context: async () => [{ direction: 'inbound', provider_id: 'fake-message', body: 'Me for both', status: 'received' }],
    prepareAI: async (op, body, source) => Object.assign(row(op), { body, source, status: 'sending' }),
    finish: async (op, status) => { row(op).status = status; },
    searchResult: async (op, result) => { row(op).search_result = result; },
    replyDiagnostics: async (op, data) => { diagnostics.set(op, data); },
    saveFeedback: async (_id, text) => { feedback.push(text); },
    ...extra };
}
const sendTo = sent => async (d, body) => { sent.push({ to: d.message.sender.id, body }); return { id: `sent-${sent.length}` }; };

test('error classes are fixed labels from the error, never from message text', () => {
  assert.equal(errorClass(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(errorClass(new SyntaxError('Unexpected token')), 'json_parse');
  assert.equal(errorClass(new Error('AI request failed')), 'model_http');
  assert.equal(errorClass(new Error('Purchase history busy')), 'purchase_history_busy');
  assert.equal(errorClass(Object.assign(new Error('Agent validation feedback'), { retry: {} })), 'validation');
  assert.equal(errorClass(Object.assign(new Error('?'), { database_status: 500 })), 'database');
  assert.equal(errorClass(new Error('something new')), 'exception');
});

test('a fallback persists step, error class, model status and elapsed time, then texts the founder after the tester', async () => {
  const db = memoryStore(), sent = [];
  // The model answers 500 twice (first try and compact retry).
  const generate = async (_m, _e, fetcher) => { const r = await fetcher('https://api.openai.com/v1/responses', {}); if (!r.ok) throw new Error('AI request failed'); };
  const fetchStub = async () => json(500, {});
  const realFetch = globalThis.fetch; globalThis.fetch = fetchStub;
  try { assert.equal(await receiveInInbox(delivery(), alerting, { ...quiet, store: db, generate, send: sendTo(sent) }), 'imessage_ai_fallback_sent'); }
  finally { globalThis.fetch = realFetch; }
  const row = db.rows[0], d = db.diagnostics.get('ai:fake-message');
  assert.equal(row.source, 'ai_fallback'); assert.equal(row.body, GENERIC_FALLBACK);
  assert.equal(d.outcome, 'fallback'); assert.equal(d.step, 'retry'); assert.equal(d.error_class, 'model_http'); assert.equal(d.model_status, 500);
  assert.equal(d.compact_retry, true); assert.ok(Number.isFinite(d.elapsed_ms)); assert.equal(d.founder_alerted, true);
  assert.deepEqual(sent.map(s => s.to), ['fake-tester', 'founder-test-handle'], 'the tester is answered first');
  assert.match(sent[1].body, /model_http/); assert.ok(!sent[1].body.includes('Me for both'), 'the alert carries no message text');
});

test('without FOUNDER_ALERT_PHONE nothing extra is sent, and the reason is still persisted', async () => {
  const db = memoryStore(), sent = [];
  await receiveInInbox(delivery(), env, { ...quiet, store: db, generate: async () => { throw new Error('AI response incomplete'); }, send: sendTo(sent) });
  assert.equal(sent.length, 1); assert.equal(db.diagnostics.get('ai:fake-message').error_class, 'model_incomplete');
  assert.equal(db.diagnostics.get('ai:fake-message').founder_alerted, false);
  assert.equal(await alertFounder({ FOUNDER_ALERT_PHONE: 'replace-with-your-phone' }, { line: 'fake-line', kind: 'fallback', conversationId: 'c', diagnostics: {} }, { send: () => assert.fail() }), false);
});

test('when the model fails after a durable action, the reply reports that action instead of the generic text', async () => {
  const db = memoryStore(), sent = [];
  const generate = async (_m, _e, _f, memory) => { await memory.feedbackAction('the reply was too long'); throw new Error('AI request failed'); };
  await receiveInInbox(delivery('fake-message', '#dev the reply was too long'), env, { ...quiet, store: db, generate, send: sendTo(sent) });
  assert.deepEqual(db.feedback, ['the reply was too long', 'the reply was too long'], 'the retry re-runs the same idempotent save');
  assert.notEqual(sent[0].body, GENERIC_FALLBACK);
  assert.match(sent[0].body, /feedback saved/); assert.equal(db.rows[0].source, 'ai_fallback');
  assert.deepEqual(db.diagnostics.get('ai:fake-message').completed, ['feedback']);
});

test('a turn past its deadline is answered before the function limit; late search results are not attached', async () => {
  const db = memoryStore(), sent = [];
  let late;
  const generate = (_m, _e, _f, memory) => new Promise(resolve => { late = async () => { await memory.recordSearch({ products: [{ url: 'https://example.com/p' }] }); resolve('too late'); }; });
  const outcome = await receiveInInbox(delivery(), env, { ...quiet, store: db, generate, send: sendTo(sent), turnDeadlineMs: 30 });
  assert.equal(outcome, 'imessage_ai_fallback_sent');
  const d = db.diagnostics.get('ai:fake-message');
  assert.equal(d.error_class, 'turn_deadline'); assert.equal(d.compact_retry, false, 'no retry without time for it');
  await late();
  assert.equal(db.rows[0].search_result, undefined);
});

test('a hung progress connection or send cannot leave a reply generating', async () => {
  const db = memoryStore(), sent = [];
  await receiveInInbox(delivery(), env, { ...quiet, store: db, progress: () => new Promise(() => {}), progressTimeoutMs: 10, generate: async () => 'got it.', send: sendTo(sent) });
  assert.equal(db.rows[0].status, 'sent'); assert.equal(sent[0].body, 'got it.');
  const hung = memoryStore();
  assert.equal(await receiveInInbox(delivery(), env, { ...quiet, store: hung, generate: async () => 'got it.', send: () => new Promise(() => {}), sendTimeoutMs: 10 }), 'imessage_ai_reply_uncertain');
  assert.equal(hung.rows[0].status, 'uncertain'); assert.equal(hung.diagnostics.get('ai:fake-message').delivery, 'uncertain');
});

test('a successful turn records a compact sent outcome', async () => {
  const db = memoryStore();
  await receiveInInbox(delivery(), env, { ...quiet, store: db, generate: async () => 'got it.', send: sendTo([]) });
  assert.equal(db.diagnostics.get('ai:fake-message').outcome, 'sent');
});

// Purchase history: the answer to an import question while the import worker holds the lease.
const item = id => ({ id, source_ids: ['source-' + id], brand: 'BODE', product_name: 'Camp-collar shirt', size_label: id === 'xl' ? 'XL' : 'XXL' });
function historyStore({ busy = 0, queue = true } = {}) {
  const state = createReceiptFeedback('owner', [item('xl'), item('xxl')]);
  const question = { id: 'q1', item_ids: ['xl', 'xxl'], topic: 'recipient', fields: [], question: 'Who were the BODE shirts for?', status: 'open' };
  // A pre-evidence import row: its feedback state converts in memory (lib/evidence.js loadReceipts).
  const data = { feedback: { ...state, questions: [question] } };
  let claims = 0;
  const store = { queued: [], cleared: [], writes: [],
    gmailImport: async () => ({ data }),
    context: async () => [{ provider_id: 'fake-message', created_at: '2026-10-15T04:18:21Z', direction: 'inbound', body: 'Me for both' }],
    claimGmailImport: async () => (++claims > busy ? { revision: claims, data, token_ciphertext: null, chat_answers: store.queued } : null),
    finishGmailImport: async (...args) => { store.writes.push(args); return true; },
    queueHistoryAnswer: async (_o, answer) => { if (!queue) throw new Error('Database request failed'); store.queued.push(answer); return true; },
    clearHistoryAnswers: async (_o, ids) => { store.cleared.push(...ids); },
  };
  return store;
}
const bothMine = async () => ({ actions: [{ item_ids: ['xl', 'xxl'], action: 'set_recipient', recipient: 'self', recipient_label: null, corrections: [], target_item_id: null, question_id: null }] });

test('a history answer while the import holds the lease is queued, not a fallback; the next lease holder applies it', async () => {
  const store = historyStore({ busy: 99 });
  const result = await updatePurchaseHistory(delivery(), 'owner', store, env, { interpret: bothMine, wait: async () => {} });
  assert.equal(result.queued, true); assert.equal(result.updated, false); assert.equal(store.queued.length, 1);
  assert.equal(store.queued[0].id, 'imessage:fake-message');
  // The worker (or the next chat answer) applies queued answers with the lease held.
  const { state, applied } = applyQueuedAnswers(createReceiptFeedback('owner', [item('xl'), item('xxl')]), store.queued, 'owner');
  assert.equal(applied, 1); assert.ok(state.feedback.some(e => e.id.startsWith('imessage:fake-message')));
  // Applying the same queued answer again changes nothing.
  assert.deepEqual(applyQueuedAnswers(state, store.queued, 'owner').state.feedback, state.feedback);
});

test('a brief lease wait succeeds without queueing; earlier queued answers apply first and are cleared', async () => {
  const store = historyStore({ busy: 2 });
  store.queued.push({ id: 'imessage:earlier', at: '2026-10-15T04:00:00Z', proposal: await bothMine() });
  const result = await updatePurchaseHistory(delivery(), 'owner', store, env, { interpret: bothMine, wait: async () => {} });
  assert.equal(result.updated, true); assert.equal(store.writes.length, 1); assert.deepEqual(store.cleared, ['imessage:earlier']);
});

test('if queueing is unavailable or interpretation fails, the tool returns an honest reply instead of throwing', async () => {
  const unqueued = await updatePurchaseHistory(delivery(), 'owner', historyStore({ busy: 99, queue: false }), env, { interpret: bothMine, wait: async () => {} });
  assert.equal(unqueued.failure, 'purchase_history_busy'); assert.equal(unqueued.updated, false);
  const failed = await updatePurchaseHistory(delivery(), 'owner', historyStore(), env, { interpret: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); } });
  assert.equal(failed.failure, 'receipt_interpret');
});

test('multi-turn: an import question answered during the import, then a new request, both get real replies', async () => {
  const store = { ...memoryStore(), ...historyStore({ busy: 99 }) };
  store.context = async () => [{ direction: 'outbound', status: 'sent', body: 'Who were the BODE shirts for?' }, { direction: 'inbound', provider_id: 'fake-message', body: 'Me for both' }];
  store.purchaseHistory = async () => ({ items: 2 });
  const sent = [];
  const agent = async (_m, _e, _f, memory) => memory.purchaseHistoryAction ? memory.purchaseHistoryAction() : 'no history tool';
  const historyUpdate = (d, owner, s, e) => updatePurchaseHistory(d, owner, s, e, { interpret: bothMine, wait: async () => {} });
  await receiveInInbox(delivery(), { ...env, GMAIL_IMPORT_ENABLED: 'true' }, { ...quiet, store, send: sendTo(sent), generate: agent, historyUpdate });
  assert.equal(store.rows[0].source, 'ai'); assert.equal(store.queued.length, 1);
  await receiveInInbox(delivery('next', 'can you find black dries peyter pants'), { ...env, GMAIL_IMPORT_ENABLED: 'true' }, { ...quiet, store, send: sendTo(sent), generate: async () => 'looking now.' });
  assert.deepEqual(store.rows.map(r => r.source), ['ai', 'ai']);
});

// Watchdog for replies stuck generating or sending.
function stuckStore(rows, { movedOn = false } = {}) {
  const writes = [];
  return { writes, rows,
    stalledReplies: async () => rows.filter(r => !r.reply_diagnostics?.stalled_at && ['generating', 'sending'].includes(r.status)),
    claimStalledReply: async (id, d) => { const r = rows.find(x => x.id === id); if (r.reply_diagnostics?.stalled_at) return false; r.reply_diagnostics = d; return true; },
    conversation: async () => ({ id: 'conversation', line: 'fake-line', sender_id: 'fake-tester' }),
    smsOptedOut: async () => false,
    context: async () => [{ direction: 'inbound', body: 'find black dries peyter pants' }],
    repliedSince: async () => movedOn,
    prepareAI: async (op, body, source) => { Object.assign(rows.find(r => r.operation_id === op), { body, source, status: 'sending' }); },
    finish: async (op, status) => { rows.find(r => r.operation_id === op).status = status; },
    replyDiagnostics: async (op, d) => { writes.push([op, d]); },
  };
}
const stuck = (status, ageMs, step = 'tool:wishlist_start') => ({ id: 'row-' + status, conversation_id: 'conversation', operation_id: 'ai:stuck-' + status, status,
  created_at: new Date(Date.now() - ageMs).toISOString(), reply_diagnostics: { outcome: 'in_progress', step } });

test('a reply stuck generating gets one model-written recovery and one founder alert, with its last step kept', async () => {
  const store = stuckStore([stuck('generating', STALL_MS + 5000)]), sent = [];
  const result = await sweepStalledReplies(alerting, { store, send: sendTo(sent), write: async () => 'sorry, i lost track of your dries peyter search. could you send it again?' });
  assert.deepEqual(result, { stalled: 1, recovered: 1, alerted: 1 });
  assert.deepEqual(sent.map(s => s.to), ['fake-tester', 'founder-test-handle']);
  const row = store.rows[0]; assert.equal(row.status, 'sent'); assert.equal(row.source, 'ai_recovery');
  const d = store.writes.at(-1)[1]; assert.equal(d.outcome, 'stalled'); assert.equal(d.step, 'tool:wishlist_start'); assert.equal(d.recovery, 'sent'); assert.equal(d.recovery_written_by, 'model');
  assert.deepEqual(await sweepStalledReplies(alerting, { store, send: sendTo(sent), write: async () => 'x' }), { stalled: 0, recovered: 0, alerted: 0 });
  assert.equal(sent.length, 2, 'never twice');
});

test('a stuck send is never resent, a moved-on conversation gets no late recovery, and a failed writer falls back to fixed text', async () => {
  const sending = stuckStore([stuck('sending', STALL_MS + 5000)]), sent = [];
  await sweepStalledReplies(alerting, { store: sending, send: sendTo(sent), write: () => assert.fail('no recovery for a send that may have arrived') });
  assert.deepEqual(sent.map(s => s.to), ['founder-test-handle']); assert.equal(sending.writes.at(-1)[1].recovery, 'may_have_arrived');
  const moved = stuckStore([stuck('generating', STALL_MS + 5000)], { movedOn: true }), sent2 = [];
  await sweepStalledReplies(alerting, { store: moved, send: sendTo(sent2), write: () => assert.fail() });
  assert.deepEqual(sent2.map(s => s.to), ['founder-test-handle']); assert.equal(moved.writes.at(-1)[1].recovery, 'conversation_moved_on');
  const broken = stuckStore([stuck('generating', STALL_MS + 5000)]), sent3 = [];
  await sweepStalledReplies(env, { store: broken, send: sendTo(sent3), write: async () => { throw new Error('AI request failed'); } });
  assert.equal(sent3.length, 1); assert.equal(broken.writes.at(-1)[1].recovery_written_by, 'template');
});

test('the watchdog endpoint requires the scheduler secret', async () => {
  resetWatchdogSecret();
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } });
  const secret = 'a'.repeat(40), store = { ...stuckStore([]), gmailSweepSecret: async () => secret };
  const denied = response(); await handleReplyWatchdog({ headers: { authorization: 'Bearer wrong' } }, denied, env, { storeFactory: () => store });
  assert.equal(denied.statusCode, 401);
  const allowed = response(); await handleReplyWatchdog({ headers: { authorization: 'Bearer ' + secret } }, allowed, env, { storeFactory: () => store });
  assert.equal(allowed.statusCode, 200); assert.deepEqual(JSON.parse(allowed.body), { stalled: 0, recovered: 0, alerted: 0 });
  resetWatchdogSecret();
});
