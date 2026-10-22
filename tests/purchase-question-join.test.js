import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { announceImport } from '../lib/receipt-notifications.js';
import { purchaseEvidence } from '../lib/receipt-extraction.js';

// A turn that updated purchase history used to send its reply and then the next open purchase question
// as a second text (about 4 a week in prod). The reply now carries the question; it is recorded as asked
// so it is never sent again, and history holds it once. Wording is not the criterion: delivery and state are.

const owner = 'conversation';
// Composition is skipped (no configured key), so the texts are code's drafts.
const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'replace-with-test-key', GMAIL_IMPORT_ENABLED: 'true' };
const buy = (n, v) => purchaseEvidence({ event_id: `m${n}:purchased`, kind: 'purchased', source_id: `m${n}`, at: n, evidence: 'x',
  values: { merchant: 'SSENSE', order_reference: 'O' + n, sku: null, brand: 'Our Legacy', color: null, size_label: '32', size_system: null, quantity: 1, units_per_pack: null, product: 'Jeans ' + n, ...v }, item_id: 'item-' + n });
const purchases = [buy(1, {}), buy(2, { merchant: 'Mr Porter', brand: 'BODE', size_label: 'XL' }), buy(3, { merchant: 'FARFETCH', size_label: 'M' })];
const ACK = 'i’ve updated your purchase history.';

// One ledger for the chat reply (ai:*) and the import texts (gmail:*), as the messages table is.
function shop(questions) {
  const rows = new Map(), sent = [];
  const store = { rows, sent,
    gmailImport: async () => ({ data: { job: { status: 'ready', started_at: 's1' }, questions } }), evidence: async () => purchases,
    operation: async k => rows.get(k) ?? null, conversation: async () => ({ id: owner, line: 'line', sender_id: 'tester' }),
    reserve: async (c, k, body, source) => { if (rows.has(k)) return false; rows.set(k, { conversation_id: c, body, source, status: 'sending' }); return true; },
    receive: async () => owner,
    claimAI: async (_c, k) => { if (rows.has(k)) return false; rows.set(k, { conversation_id: owner, status: 'generating', source: 'ai' }); return true; },
    prepareAI: async (k, body, source) => Object.assign(rows.get(k), { body, source, status: 'sending' }),
    finish: async (k, status) => { rows.get(k).status = status; },
    purchaseHistory: async () => ({ items: purchases.length }), searchResult: async () => {}, replyDiagnostics: async () => {}, recordDelivery: async () => {},
    context: async () => [{ id: 'c1', provider_id: 'p-now', direction: 'inbound', body: 'the bode shirts were mine', status: 'received' }] };
  // What the chat history keeps: sent outbound rows (lib/compose.js recentTurns, lib/ai.js).
  store.history = () => [...rows.values()].filter(r => r.status === 'sent').map(r => r.body);
  return store;
}
const delivery = (id = 'p-now') => ({ space: { phone: 'line' }, message: { id, sender: { id: 'tester' }, content: { type: 'text', text: 'the bode shirts were mine' }, attachments: [] } });
const turn = (store, { id, historyUpdate = async () => ({ updated: true, body: ACK }), generate } = {}) =>
  receiveInInbox(delivery(id), env, { store, progress: async () => async () => {}, writeFollowup: async () => null, historyUpdate,
    generate: generate ?? (async (_m, _e, _f, memory) => { await memory.purchaseHistoryAction(); return ACK; }),
    send: async (_d, text) => { store.sent.push(text); return { id: 'sent-' + store.sent.length }; } });
const countThenSummary = async store => { await announceImport(store, owner, {}, async (_d, b) => { store.sent.push(b); }); };

test('a purchase-history reply carries the next open question in one text, asked once', async () => {
  const questions = [{ id: 'q1', status: 'open', question: 'Were the BODE shirts for you?', item_ids: ['item-2'] }, { id: 'q2', status: 'open', question: 'Were the FARFETCH jeans for you?', item_ids: ['item-3'] }];
  const store = shop(questions);
  await countThenSummary(store);
  assert.equal(store.sent.at(-1), 'Were the BODE shirts for you?');
  // The tester answers q1; the update closes it and the next question rides along with the reply.
  store.sent.length = 0; questions[0].status = 'answered';
  await turn(store);
  assert.equal(store.sent.length, 1, 'one text');
  assert.equal(store.sent[0], `${ACK}\n\nWere the FARFETCH jeans for you?`);
  assert.equal(store.rows.get(`gmail:${owner}:question:s1:q2`).status, 'blocked', 'recorded as asked, never sent on its own');
  assert.equal(store.history().filter(b => /FARFETCH jeans/.test(b)).length, 1, 'history shows the question once, inside the reply');
  // A redelivered webhook sends nothing, and a later history update does not ask it again.
  await turn(store);
  assert.equal(store.sent.length, 1);
  await turn(store, { id: 'p-later' });
  assert.deepEqual(store.sent.slice(1), [ACK], 'the question already asked is not repeated');
});

test('an unsent summary keeps its own text before the question, and a turn with no update sends nothing extra', async () => {
  const questions = [{ id: 'q1', status: 'open', question: 'Were the BODE shirts for you?', item_ids: ['item-2'] }];
  // The count went out but not the summary: the reply, then the summary and question as their own texts.
  let store = shop(questions);
  store.rows.set(`gmail:${owner}:ready:s1`, { conversation_id: owner, status: 'sent', body: 'done reading' });
  await turn(store);
  assert.equal(store.sent[0], ACK, 'the reply is not joined');
  assert.equal(store.sent.at(-1), 'Were the BODE shirts for you?');
  assert.ok(store.sent.length >= 3, 'the summary keeps its own text between them');
  // No update this turn (the history tool reported nothing changed): nothing is joined or sent after.
  store = shop([{ id: 'q1', status: 'open', question: 'Were the BODE shirts for you?', item_ids: ['item-2'] }, { id: 'q2', status: 'open', question: 'Were the FARFETCH jeans for you?', item_ids: ['item-3'] }]);
  await countThenSummary(store); store.sent.length = 0;
  await turn(store, { historyUpdate: async () => ({ updated: false, body: 'nothing changed.' }), generate: async (_m, _e, _f, memory) => { await memory.purchaseHistoryAction(); return 'nothing changed.'; } });
  assert.deepEqual(store.sent, ['nothing changed.']);
  assert.equal(store.rows.get(`gmail:${owner}:question:s1:q2`), undefined);
});
