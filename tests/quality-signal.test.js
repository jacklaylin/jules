import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, chooseReplying } from '../lib/ai.js';
import { receiveInInbox } from '../lib/inbox.js';
import { triagePackets } from '../lib/feedback-triage.js';
import { createStore } from '../lib/store.js';
import { agentTurn, tool, toolNames } from './helpers/agent.js';

// A quality signal is the agent's structured reading that an earlier turn missed what the user
// wanted. It is saved alongside the reply for triage and never changes what Jules does or says.
const env = { OPENAI_API_KEY:'test' };
const turn = body => [{ id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body, status:'received' }];
const signal = (args = {}) => tool('record_quality_signal', { kind:'wrong_results', about:'previous_reply', summary:'Asked for loafers; Jules showed sneakers.', ...args });

test('the signal is saved once beside the reply and never chosen as the reply', async () => {
  const saved = [];
  const reply = await generateReply(turn('those are sneakers, not loafers'), env, async () => agentTurn(signal(), tool('conversation_reply', { response:'Fair—let me fix that.' })), { qualitySignal:async s => saved.push(s) });
  assert.equal(reply, 'Fair—let me fix that.');
  assert.deepEqual(saved, [{ kind:'wrong_results', about:'previous_reply', summary:'Asked for loafers; Jules showed sneakers.' }]);
  assert.equal(chooseReplying([{ name:'record_quality_signal', args:{} }, { name:'find_products', args:{} }]).name, 'find_products');
});

test('the tool is offered only when a signal can be stored, and a failed or invalid save never changes the reply', async () => {
  await generateReply(turn('hi'), env, async (_url, options) => { assert.ok(!toolNames(options).includes('record_quality_signal')); return agentTurn(tool('conversation_reply', { response:'Hi.' })); }, {});
  assert.equal(await generateReply(turn('wrong again'), env, async () => agentTurn(signal(), tool('conversation_reply', { response:'Sorry.' })), { qualitySignal:async () => { throw new Error('column missing'); } }), 'Sorry.');
  const saved = [];
  for (const bad of [{ kind:'made_up' }, { summary:'' }, { summary:'see https://example.com' }])
    await generateReply(turn('hmm'), env, async () => agentTurn(signal(bad), tool('conversation_reply', { response:'Ok.' })), { qualitySignal:async s => saved.push(s) });
  assert.equal(saved.length, 0);
});

test('a signal without a reply asks the agent once more for a reply and still records only one signal', async () => {
  const saved = []; let calls = 0;
  const reply = await generateReply(turn('not what I asked for'), env, async () => ++calls === 1 ? agentTurn(signal()) : agentTurn(signal(), tool('conversation_reply', { response:'Got it—what should change?' })), { qualitySignal:async s => saved.push(s) });
  assert.equal(calls, 2); assert.equal(reply, 'Got it—what should change?'); assert.equal(saved.length, 1);
});

test('the inbox stores the signal on the user’s message with a timestamp', async () => {
  let stored; const sent = [];
  const store = { receive:async () => 'c', claimAI:async () => true, context:async () => turn('wrong item'), prepareAI:async () => {}, finish:async () => {},
    saveQualitySignal:async (id, s) => { stored = { id, ...s }; } };
  await receiveInInbox({ space:{ phone:'l' }, message:{ id:'m1', sender:{ id:'s' }, content:{ type:'text', text:'wrong item' }, attachments:[] } }, { AI_ENABLED:'true', OPENAI_API_KEY:'test' },
    { store, send:async (_d, body) => sent.push(body), generate:(m, e, _f, memory) => generateReply(m, e, async () => agentTurn(signal(), tool('conversation_reply', { response:'On it.' })), memory) });
  assert.equal(stored.id, 'm1'); assert.equal(stored.kind, 'wrong_results'); assert.ok(Date.parse(stored.at)); assert.deepEqual(sent, ['On it.']);
});

test('triage merges developer reports and quality signals in time order and marks the reported reply', async () => {
  const dev = { id:'d1', conversation_id:'c1', created_at:'2026-10-13T10:00:00Z', body:'👎', developer_feedback:'Flagged this reply with 👎.', reply_provider_id:'jules-1' };
  const q = { id:'q1', conversation_id:'c1', created_at:'2026-10-13T09:00:00Z', body:'those are sneakers', quality_signal:{ kind:'wrong_results', about:'previous_reply', summary:'Showed sneakers, call 415-555-0100' }, reply_provider_id:null };
  const context = [{ id:'m0', provider_id:'jules-1', direction:'outbound', body:'One option to start with.', created_at:'2026-10-13T08:59:00Z' }, { id:'m1', provider_id:'p2', direction:'inbound', body:'x', created_at:'2026-10-13T09:00:00Z' }];
  const result = await triagePackets({ feedbackSince:async () => [dev], qualitySince:async () => [q], feedbackContext:async () => context }, { since:'2026-10-13T00:00:00Z' });
  assert.deepEqual(result.packets.map(p => p.kind), ['quality_signal', 'developer_feedback']);
  assert.equal(result.packets[0].signal.summary, 'Showed sneakers, call [phone]'); assert.equal(result.packets[0].report, undefined);
  assert.equal(result.packets[1].context[0].is_reported_message, true); assert.equal(result.packets[1].context[1].is_reported_message, undefined);
  assert.equal(result.cursor, dev.created_at); assert.equal(result.quality_signals_available, true);
});

test('before the quality column exists, triage still returns developer feedback and says signals are unavailable', async () => {
  const dev = { id:'d1', conversation_id:'c1', created_at:'2026-10-13T10:00:00Z', body:'#dev x', developer_feedback:'x' };
  const result = await triagePackets({ feedbackSince:async () => [dev], qualitySince:async () => { throw new Error('column quality_signal does not exist'); }, feedbackContext:async () => [] });
  assert.equal(result.count, 1); assert.equal(result.quality_signals_available, false);
});

test('quality reads and writes are private and cursor-ordered', async () => {
  const paths = [];
  const store = createStore({ SUPABASE_URL:'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY:'fake' }, async url => { paths.push(url); return { ok:true, text:async () => '[]' }; });
  await store.saveQualitySignal('provider', { kind:'other' }); await store.qualitySince('2026-10-12T00:00:00Z');
  assert.match(paths[0], /provider_id=eq.provider&direction=eq.inbound/);
  assert.match(paths[1], /quality_signal=not.is.null&created_at=gt.2026-10-12/); assert.match(paths[1], /order=created_at.asc/); assert.doesNotMatch(paths[1], /sender/);
});
