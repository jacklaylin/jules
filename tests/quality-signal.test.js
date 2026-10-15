import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, chooseReplying } from '../lib/ai.js';
import { receiveInInbox } from '../lib/inbox.js';
import { triagePackets } from '../lib/feedback-triage.js';
import { createStore } from '../lib/store.js';
import { agentTurn, tool, toolNames } from './helpers/agent.js';

// A quality signal is the agent's structured reading that an earlier turn missed what the user
// wanted. It is saved for triage and never changes what Jules does or says.
const env = { OPENAI_API_KEY:'test' };
const turn = body => [{ id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body, status:'received' }];
// The signal comes from an independent quality check (its own structured model call) run beside the turn.
const missed = (args = {}) => ({ verdict:'missed', kind:'wrong_results', about:'previous_reply', summary:'Asked for loafers; Jules showed sneakers.', ...args });
const fine = { verdict:'fine', kind:null, about:null, summary:null };
const isQuality = options => JSON.parse(options.body).text?.format?.name === 'quality';
const verdict = v => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(v) }] }] }) });
// The agent replies; the quality check answers with the given verdict.
const model = (response, check = missed()) => async (_url, options) => isQuality(options) ? verdict(check) : agentTurn(tool('conversation_reply', { response }));
const after = body => [{ id:'00000000-0000-4000-8000-000000000000', direction:'outbound', status:'sent', body:'Here are three loafers.' }, ...turn(body)];

test('a missed verdict is saved once and never changes the reply', async () => {
  const saved = [];
  const body = await generateReply(after('those are sneakers, not loafers'), env, model('Fair—let me fix that.'), { qualitySignal:async s => saved.push(s) });
  assert.equal(body, 'Fair—let me fix that.');
  assert.deepEqual(saved, [{ kind:'wrong_results', about:'previous_reply', summary:'Asked for loafers; Jules showed sneakers.' }]);
  assert.equal(chooseReplying([{ name:'record_quality_signal', args:{} }, { name:'find_products', args:{} }]).name, 'find_products');
});

test('a fine verdict, a failed check or save, or an invalid signal never records or changes the reply', async () => {
  const saved = [], memory = { qualitySignal:async s => saved.push(s) };
  assert.equal(await generateReply(after('more like that'), env, model('Here you go.', fine), memory), 'Here you go.');
  assert.equal(await generateReply(after('wrong again'), env, async (_u, o) => isQuality(o) ? { ok:false } : agentTurn(tool('conversation_reply', { response:'Sorry.' })), memory), 'Sorry.');
  assert.equal(await generateReply(after('wrong again'), env, model('Sorry.'), { qualitySignal:async () => { throw new Error('column missing'); } }), 'Sorry.');
  for (const bad of [{ kind:'made_up' }, { summary:'' }, { summary:'see https://example.com' }])
    await generateReply(after('hmm'), env, model('Ok.', missed(bad)), memory);
  assert.equal(saved.length, 0);
});

test('the check runs only when a signal can be stored and Jules has spoken; the side tool is not offered', async () => {
  let checks = 0;
  const counting = async (_url, options) => { if (isQuality(options)) { checks++; return verdict(missed()); } assert.ok(!toolNames(options).includes('record_quality_signal')); return agentTurn(tool('conversation_reply', { response:'Hi.' })); };
  await generateReply(after('hi'), env, counting, {});
  await generateReply(turn('hi'), env, counting, { qualitySignal:async () => {} });
  assert.equal(checks, 0);
  await generateReply(after('hi'), env, counting, { qualitySignal:async () => {} });
  assert.equal(checks, 1);
});

test('the inbox stores the signal on the user’s message with a timestamp', async () => {
  let stored; const sent = [];
  const store = { receive:async () => 'c', claimAI:async () => true, context:async () => after('wrong item'), prepareAI:async () => {}, finish:async () => {},
    saveQualitySignal:async (id, s) => { stored = { id, ...s }; } };
  await receiveInInbox({ space:{ phone:'l' }, message:{ id:'m1', sender:{ id:'s' }, content:{ type:'text', text:'wrong item' }, attachments:[] } }, { AI_ENABLED:'true', OPENAI_API_KEY:'test' },
    { store, send:async (_d, body) => sent.push(body), generate:(m, e, _f, memory) => generateReply(m, e, model('On it.'), memory) });
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
