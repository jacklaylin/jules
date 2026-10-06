import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../lib/ai.js';
import { receiveInInbox } from '../lib/inbox.js';
const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key' };
const delivery = { space: { phone: 'fake-line' }, message: { id: 'fake-message', sender: { id: 'fake-person' }, content: { text: 'Wedding shoes' } } };
function store() {
  let claimed = false;
  const state = {};
  return { state, receive: async () => 'conversation', claimAI: async () => { if (claimed) return false; claimed = true; return true; },
    context: async () => [{ direction: 'inbound', body: 'Wedding shoes', status: 'received' }],
    prepareAI: async (op, body, source) => Object.assign(state, { op, body, source, status: 'sending' }),
    finish: async (op, status) => { state.status = status; } };
}
test('AI uses bounded role-aware recent context and does not store API response', async () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ direction: 'inbound', body: 'x'.repeat(3000) + i, status: 'received' }));
  history.push({ direction: 'outbound', body: 'unsent', status: 'uncertain' });
  history.push({ direction: 'outbound', body: 'What is your budget?', status: 'sent' });
  const result = await generateReply(history, env, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body); assert.ok(body.instructions.includes('This is the source of truth')); assert.equal(body.store, false); assert.equal(body.input.length, 20);
    assert.equal(body.input.at(-1).role, 'assistant'); assert.ok(body.input.every(m => m.content.length <= 2000));
    assert.ok(!body.input.some(m => m.content === 'unsent'));
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'What will you wear?' }] }] }) };
  });
  assert.equal(result, 'What will you wear?');
});
test('incomplete, empty and failed model responses are not sent as replies', async () => {
  for (const data of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [] }]) {
    await assert.rejects(generateReply([], env, async () => ({ ok: true, json: async () => data })));
  }
  await assert.rejects(generateReply([], env, async () => ({ ok: false })));
});
test('concurrent webhook deliveries generate and send one durable AI reply', async () => {
  const db = store(); let generated = 0, sent = 0;
  const options = { store: db, generate: async messages => { generated++; assert.equal(messages[0].body, 'Wedding shoes'); return 'What is the dress code?'; }, send: async () => { sent++; } };
  await Promise.all([receiveInInbox(delivery, env, options), receiveInInbox(delivery, env, options)]);
  assert.equal(generated, 1); assert.equal(sent, 1); assert.equal(db.state.source, 'ai'); assert.equal(db.state.status, 'sent');
});
test('generation failure produces a visible fallback, while ambiguous send never retries', async () => {
  const db = store(); let sent = 0;
  const options = { store: db, generate: async () => { throw new Error('private error'); }, send: async () => { sent++; throw new Error('unknown outcome'); } };
  assert.equal(await receiveInInbox(delivery, env, options), 'imessage_ai_reply_uncertain');
  assert.equal(db.state.source, 'ai_fallback'); assert.match(db.state.body, /manual review/); assert.equal(db.state.status, 'uncertain');
  await receiveInInbox(delivery, env, options); assert.equal(sent, 1);
});
test('failure saving generated text prevents a send and a retry cannot send twice', async () => {
  const db = store(); db.prepareAI = async () => { throw new Error('offline'); }; let sent = 0;
  const options = { store: db, generate: async () => 'Reply', send: async () => { sent++; } };
  await assert.rejects(receiveInInbox(delivery, env, options));
  await receiveInInbox(delivery, env, options); assert.equal(sent, 0);
});
