import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { reportedTurn, scrub, casesDir, freezeReport, syncCases, loadCases, runFrozenCase, scoreFrozen, frozenReport, judgeInput, recordedDraft, conversationHash, combineJudges, judgeModels } from '../lib/frozen-evals.js';
import { agentTurn, tool, agentContext, isAgentRequest, toolNames } from './helpers/agent.js';

const out = value => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) });
const at = minute => `2026-10-21T20:${String(minute).padStart(2, '0')}:00.000Z`;
const jacket = { brand: 'Maison Margiela', name: 'Mesh-Trimmed Shell Jacket', url: 'https://www.mrporter.com/en-us/mens/product/maison-margiela/46376663163148077', match: 'likely_match', sourcing_status: 'store_found',
  listing_check: { status: 'verified', product_name: 'Mesh-Trimmed Shell Jacket', color: 'blue', shopping_range: 'men', product_sku: '46376663163148077' } };

test('a report is about the agent turn it replies to; a signal about the reply before it; other messages are not replayable', () => {
  const rows = [
    { direction: 'inbound', provider_id: 'in-1', created_at: at(30) },
    { direction: 'outbound', status: 'sent', operation_id: 'ack:in-1', created_at: at(30) },
    { direction: 'outbound', status: 'sent', operation_id: 'ai:in-1', provider_id: 'out-1', created_at: at(31) },
    { direction: 'outbound', status: 'sent', operation_id: 'followup:in-1', provider_id: 'out-2', created_at: at(33) },
    { direction: 'outbound', status: 'sent', operation_id: 'feedback:in-9', created_at: at(34) },
  ];
  assert.deepEqual(reportedTurn({ kind: 'developer_feedback', created_at: at(35) }, rows, rows[2]), { inbound: 'in-1' });
  assert.deepEqual(reportedTurn({ kind: 'developer_feedback', created_at: at(35) }, rows, rows[1]), { inbound: 'in-1' });
  assert.deepEqual(reportedTurn({ kind: 'developer_feedback', created_at: at(35) }, rows, rows[3]), { inbound: null, reason: 'reported_message_is_followup' });
  // Unthreaded: the agent reply just before the report (the follow-up and the feedback ack are not agent replies).
  assert.deepEqual(reportedTurn({ kind: 'developer_feedback', created_at: at(35) }, rows, null), { inbound: 'in-1' });
  assert.deepEqual(reportedTurn({ kind: 'quality_signal', created_at: at(36) }, rows, null), { inbound: 'in-1' });
  assert.equal(reportedTurn({ kind: 'quality_signal', created_at: at(29) }, rows, null).inbound, null);
});

test('scrubbing masks phone numbers and emails in text but keeps links, ids, product codes and photo bytes', () => {
  const s = scrub({ body: 'text me at +1 415 555 0134 or a@b.co: https://www.mrporter.com/p/46376663163148077', provider_id: 'spc-msg-e938033332f4', created_at: at(1),
    listing_check: { product_sku: '46376663163148077' }, images: [{ data: 'AAAA1234567890123BBBB' }], nested: [{ value: 'call 4155550134' }] });
  assert.equal(s.body, 'text me at [phone] or [email]: https://www.mrporter.com/p/46376663163148077');
  assert.equal(s.provider_id, 'spc-msg-e938033332f4');
  assert.equal(s.listing_check.product_sku, '46376663163148077');
  assert.equal(s.images[0].data, 'AAAA1234567890123BBBB');
  assert.equal(s.nested[0].value, 'call [phone]');
});

test('cases are refused inside the repository', () => {
  assert.throws(() => casesDir({ FROZEN_EVALS_DIR: join(process.cwd(), 'evals', 'frozen') }), /outside the repository/);
  assert.throws(() => casesDir({ FROZEN_EVALS_DIR: process.cwd() }), /outside the repository/);
  assert.equal(casesDir({ FROZEN_EVALS_DIR: '/tmp/frozen' }), '/tmp/frozen');
});

test('the state as of a turn reads the newest shopping result sent before it', async () => {
  const paths = [];
  const store = createStore({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, async url => { paths.push(url); return { ok: true, text: async () => JSON.stringify([{ created_at: at(10), search_result: { text_wishlist_state: { stage: 'choice', options: [] } } }]) }; });
  assert.deepEqual(await store.textWishlistState('c1', at(20)), { stage: 'choice', options: [] });
  assert.match(decodeURIComponent(paths[0]), /created_at=lt\."?2026-10-21T20:20/);
  // Older than a week before the turn: no pending state.
  assert.equal(await store.textWishlistState('c1', '2026-10-30T00:00:00.000Z'), null);
});

// The Maison Margiela report (October 21): "find this cheaper" came back with the same MR PORTER link, in a
// reply that both asked to save and said it saved.
const conversation = 'conv-1';
const report = { id: 'aaaaaaaa-1111-4000-8000-000000000001', kind: 'developer_feedback', conversation_id: conversation, created_at: at(37), reply_provider_id: 'out-2',
  developer_feedback: 'this makes no sense. you say you don’t know if this is it, then want me to save, then this is it, I saved it. call me at 415-555-0134' };
const history = [
  { id: 'm1', provider_id: 'in-1', direction: 'inbound', status: 'received', created_at: at(20), body: jacket.url },
  { id: 'm2', provider_id: 'out-1', operation_id: 'ai:in-1', direction: 'outbound', status: 'sent', created_at: at(21), body: 'i couldn’t find a verified cheaper option yet.', search_result: { text_wishlist_state: { stage: 'search_clarification', options: [] } } },
  { id: 'm3', provider_id: 'in-2', direction: 'inbound', status: 'received', created_at: at(30), body: 'Lets add this one to my wishlist and look for cheaper options as well' },
  { id: 'm4', provider_id: 'out-2', operation_id: 'ai:in-2', direction: 'outbound', status: 'sent', source: 'ai', created_at: at(31), body: 'this could be it… want me to save it? saved it.\n' + jacket.url,
    search_result: { intent_action: 'start', identification_policy: 'text_wishlist', composed_by: 'model', text_wishlist_state: { stage: 'choice', options: [jacket] }, products: [jacket] },
    reply_diagnostics: { actions: [{ tool: 'find_products', status: 'done' }, { tool: 'save_to_wishlist', status: 'done' }] } },
];
const fakeStore = () => ({
  feedbackSince: async () => [report], qualitySince: async () => [],
  feedbackContext: async (c, time, before, after) => { assert.equal(c, conversation); return [...history.filter(m => m.created_at <= time).slice(-(before + 1)), ...history.filter(m => m.created_at > time).slice(0, after)]; },
  feedbackTarget: async () => assert.fail('the target is in the context window'),
  context: async (c, provider) => { assert.equal(provider, 'in-2'); return history.slice(0, 3).map(({ search_result, reply_diagnostics, operation_id, ...m }) => m); },
  textWishlistState: async (c, before) => { assert.equal(before, at(30)); return history[1].search_result.text_wishlist_state; },
  wishlistEntries: async () => [
    { item_id: 'g1', url: 'https://shop.example/old', name: 'Older jacket', links: [], messages: { created_at: at(5) } },
    { item_id: 'g2', url: jacket.url, name: 'Margiela jacket', messages: { created_at: at(31) } },
  ],
  priceAlerts: async () => [],
  profile: async () => ({ facts: [{ field: 'size', key: 'clothing/tops', value: 'M', basis: 'stated', updated_at: at(1), deleted: false },
    { field: 'brand', key: 'avoid', value: 'X', basis: 'stated', updated_at: at(40), deleted: false }, { field: 'size', key: 'old', value: 'S', updated_at: at(1), deleted: true }] }),
});

test('freezing a report keeps the turn as the agent saw it, the original reply and its recorded search, scrubbed', async () => {
  const frozen = await freezeReport(fakeStore(), report, {}, { classify: async () => 'reply_quality', now: new Date(at(50)) });
  assert.equal(frozen.id, 'dev-aaaaaaaa');
  assert.equal(frozen.replayable, true);
  assert.equal(frozen.category, 'reply_quality');
  assert.equal(frozen.conversation, conversationHash(conversation));
  assert.ok(!JSON.stringify(frozen).includes(conversation), 'the conversation id is hashed');
  assert.match(frozen.expectation.text, /\[phone\]$/);
  assert.equal(frozen.messages.at(-1).body, 'Lets add this one to my wishlist and look for cheaper options as well');
  assert.equal(frozen.pending.stage, 'search_clarification');
  // Saved before the turn only; profile facts deleted or changed after it are left out.
  assert.deepEqual(frozen.wishlist_items.map(i => i.name), ['Older jacket']);
  assert.deepEqual(frozen.facts, [{ field: 'size', key: 'clothing/tops', value: 'M', basis: 'stated', updated_at: at(1) }]);
  assert.match(frozen.original.body, /want me to save it\? saved it/);
  assert.deepEqual(frozen.original.actions.map(a => a.tool), ['find_products', 'save_to_wishlist']);
  assert.equal(frozen.original.search.state.options[0].url, jacket.url);
  assert.match(recordedDraft(frozen.original.search), /Maison Margiela Mesh-Trimmed Shell Jacket — blue at .*\nhttps:\/\/www\.mrporter\.com/);
});

test('a report on a message that is not an agent reply is frozen as not replayable and skipped in the pass rate', async () => {
  const store = { ...fakeStore(), feedbackContext: async () => [...history, { provider_id: 'out-9', operation_id: 'gmail:x', direction: 'outbound', status: 'sent', created_at: at(35) }] };
  const frozen = await freezeReport(store, { ...report, reply_provider_id: 'out-9' }, {}, { classify: async () => assert.fail('not classified') });
  assert.equal(frozen.replayable, false);
  assert.equal(frozen.not_replayable_reason, 'reported_message_is_gmail');
  const result = await runFrozenCase(frozen, {}, { judge: () => assert.fail('not judged') });
  assert.equal(result.skipped, 'reported_message_is_gmail');
  assert.equal(frozenReport([result], [frozen]).runs, 0);
});

test('sync freezes each report once, outside the repository with private file modes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frozen-'));
  const first = await syncCases(fakeStore(), {}, { dir, classify: async () => 'reply_quality' });
  assert.equal(first.added.length, 1);
  const again = await syncCases(fakeStore(), {}, { dir, classify: async () => assert.fail('already frozen') });
  assert.equal(again.added.length, 0);
  const [saved] = await loadCases(dir);
  assert.equal(saved.id, 'dev-aaaaaaaa');
  assert.equal((await stat(join(dir, 'cases', 'dev-aaaaaaaa.json'))).mode & 0o777, 0o600);
  assert.ok(!(await readFile(join(dir, 'cases', 'dev-aaaaaaaa.json'), 'utf8')).includes('415-555'));
});

test('running a case re-runs only the agent turn: the frozen context, a recorded search, the composer and the judge', async () => {
  const frozen = await freezeReport(fakeStore(), report, {}, { classify: async () => 'reply_quality' });
  const seen = { judge: null, context: null, toolOutput: null, models: [] };
  let rounds = 0;
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses', 'nothing but the model is called');
    const body = JSON.parse(options.body);
    seen.models.push(body.model);
    if (isAgentRequest(options)) {
      rounds++;
      if (rounds === 1) { seen.context = agentContext(options); seen.tools = toolNames(options); return agentTurn(tool('find_products', { query: 'Maison Margiela mesh-trimmed shell jacket cheaper at other stores' })); }
      seen.toolOutput = body.input.filter(i => i.type === 'function_call_output').map(i => i.output).join('\n');
      return agentTurn(tool('conversation_reply', { response: 'only MR PORTER has it so far, at the same listing you sent. want me to save it?' }));
    }
    if (body.text?.format?.name === 'frozen_judge') { seen.judge = JSON.parse(body.input);
      return out({ report_about: 'jules_reply', did_what_asked: { verdict: 'pass', reason: 'Searched other stores.' }, coherent: { verdict: 'pass', reason: 'One message.' }, no_repeated_questions: { verdict: 'not_applicable', reason: 'None.' }, meets_report: { verdict: 'pass', reason: 'No contradiction.' } }); }
    if (body.text?.format?.name === 'jules_reply') return out({ body: 'composed', captions: [] });
    if (body.text?.format?.name === 'quality' || body.text?.format?.name === 'profile_check') return out({ verdict: 'fine', kind: null, about: null, summary: null, newest_message: 'other', changes: [] });
    return out({});
  };
  const result = await runFrozenCase(frozen, { OPENAI_API_KEY: 'test', PRICE_ALERTS_ENABLED: 'replace-me' }, { fetcher, model: 'gpt-test-chat' });
  // Production capabilities, whatever the local environment says.
  assert.ok(seen.tools.includes('manage_price_alerts'));
  assert.equal(seen.context.pending_shopping.stage, 'search_clarification');
  assert.deepEqual(seen.context.saved_wishlist.items.map(i => i.name), ['Older jacket']);
  assert.equal(seen.context.saved_profile[0].value, 'M');
  assert.match(seen.toolOutput, /mrporter\.com/, 'the search answers with the recorded results');
  assert.ok(seen.models.includes('gpt-test-chat'));
  assert.ok(seen.models.includes('gpt-5.5'), 'the judge is a fixed model, not the chat model under test');
  assert.match(seen.judge.report.text, /saved it/);
  assert.match(seen.judge.original_reply, /want me to save it\? saved it/);
  assert.equal(seen.judge.new_reply, result.reply);
  assert.equal(result.category, 'frozen:reply_quality');
  assert.equal(result.passed, true);
});

test('a case passes only when no criterion fails, and an empty reply fails', () => {
  const pass = { verdict: 'pass', reason: 'ok' }, fail = { verdict: 'fail', reason: 'Asked to save and said it saved, call 415 555 0134.' };
  assert.equal(scoreFrozen({ did_what_asked: pass, coherent: pass, no_repeated_questions: { verdict: 'not_applicable', reason: '' }, meets_report: pass }, { reply: 'hi' }).passed, true);
  const contradicted = scoreFrozen({ did_what_asked: pass, coherent: fail, no_repeated_questions: pass, meets_report: pass }, { reply: 'hi' });
  assert.deepEqual(contradicted.failed, ['coherent']);
  assert.ok(!contradicted.failures[0].includes('555'), 'reasons are redacted');
  assert.deepEqual(scoreFrozen({ did_what_asked: pass, coherent: pass, no_repeated_questions: pass, meets_report: pass }, { reply: '', error: 'AI request failed' }).failed, ['did_what_asked']);
  assert.deepEqual(scoreFrozen(null, { reply: 'hi' }).failed.length, 4);
  // A report about what the search found cannot be tested when the turn searched again (the same recorded results come back),
  // nor one about link delivery; one about Jules's own reply is scored as judged.
  const stale = { report_about: 'what_search_found', did_what_asked: pass, coherent: pass, no_repeated_questions: pass, meets_report: fail };
  assert.equal(scoreFrozen(stale, { reply: 'hi', calls: [{ name: 'find_products', args: {} }] }).criteria.meets_report.verdict, 'not_applicable');
  assert.equal(scoreFrozen(stale, { reply: 'hi', calls: [{ name: 'respond_to_options', args: {} }] }).passed, false);
  assert.equal(scoreFrozen({ ...stale, report_about: 'link_delivery' }, { reply: 'hi', calls: [] }).passed, true);
  assert.equal(scoreFrozen({ ...stale, report_about: 'jules_reply' }, { reply: 'hi', calls: [{ name: 'find_products', args: {} }] }).passed, false);
});

test('one number: the pass rate over every replayed case, with categories and criteria', () => {
  const crit = (v = 'pass') => ({ did_what_asked: { verdict: v }, coherent: { verdict: 'pass' }, no_repeated_questions: { verdict: 'not_applicable' }, meets_report: { verdict: v } });
  const results = [
    { id: 'a', category: 'frozen:reply_quality', passed: true, failures: [], criteria: crit() },
    { id: 'b', category: 'frozen:reply_quality', passed: false, failures: ['meets_report: x'], criteria: crit('fail') },
    { id: 'c', category: 'frozen:wrong_results', passed: true, failures: [], criteria: crit() },
    { id: 'd', category: 'frozen:wrong_results', passed: true, error: 'boom', failures: [], criteria: crit() },
    { id: 'e', skipped: 'reported_message_is_gmail' },
  ];
  const report = frozenReport(results, [{ id: 'e', replayable: false, not_replayable_reason: 'reported_message_is_gmail' }]);
  assert.equal(report.pass_rate, 0.5);
  assert.equal(report.runs, 4);
  assert.deepEqual(report.categories.map(c => [c.category, c.pass_rate]), [['frozen:reply_quality', 0.5], ['frozen:wrong_results', 0.5]]);
  assert.equal(report.criteria.find(c => c.key === 'meets_report').pass_rate, 0.75);
  assert.equal(report.criteria.find(c => c.key === 'no_repeated_questions').pass_rate, null);
  assert.deepEqual(report.skipped, [{ id: 'e', reason: 'reported_message_is_gmail' }]);
});

test('the judge sees the report, both replies and the new actions, without tool replies or long arguments', () => {
  const c = { source: 'developer_feedback', category: 'reply_quality', expectation: { text: 'note' }, images: [], original: { body: 'old' },
    messages: [{ direction: 'inbound', body: 'hi' }, { direction: 'outbound', status: 'sent', body: 'hello' }, { direction: 'outbound', status: 'failed', body: 'never sent' }, { direction: 'inbound', body: 'find it cheaper', reply_provider_id: 'x' }] };
  const input = judgeInput(c, { reply: 'new', calls: [{ name: 'find_products', args: { query: 'q'.repeat(1000) } }, { name: 'conversation_reply', args: {} }], confirmed: false });
  assert.deepEqual(input.earlier_conversation, [{ from: 'user', text: 'hi' }, { from: 'jules', text: 'hello' }]);
  assert.deepEqual(input.user_message, { text: 'find it cheaper', photos: 0, replying_to_earlier_message: true });
  assert.deepEqual(input.new_actions.map(a => a.tool), ['find_products']);
  assert.ok(input.new_actions[0].args.length < 500);
  assert.equal(input.original_reply, 'old');
});

test('with two judges a case passes only when both pass it, and their agreement is reported', () => {
  const pass = { verdict: 'pass', reason: 'ok' }, fail = { verdict: 'fail', reason: 'Asked to save and said saved.' };
  const verdict = (model, coherent) => ({ ...scoreFrozen({ report_about: 'jules_reply', did_what_asked: pass, coherent, no_repeated_questions: pass, meets_report: pass }, { reply: 'hi' }), judge_model: model });
  const split = combineJudges([verdict('gpt-5.5', pass), verdict('openrouter:anthropic/claude-opus-5.5', fail)]);
  assert.equal(split.passed, false);
  assert.equal(split.judges_agree, false);
  assert.deepEqual(split.failed, ['coherent']);
  assert.equal(split.criteria.coherent.by, 'openrouter:anthropic/claude-opus-5.5');
  assert.match(split.failures[0], /^\[claude-opus-5\.5\] coherent:/);
  const both = combineJudges([verdict('gpt-5.5', pass), verdict('openrouter:anthropic/claude-opus-5.5', pass)]);
  assert.equal(both.passed, true);
  const report = frozenReport([{ id: 'a', category: 'frozen:x', ...split, timeouts: 1, refused: [] }, { id: 'b', category: 'frozen:x', ...both, timeouts: 0, refused: [502] }]);
  assert.equal(report.pass_rate, 0.5);
  assert.equal(report.judge_agreement, 0.5);
  assert.deepEqual(report.judges.map(j => [j.model, j.pass_rate]), [['gpt-5.5', 1], ['openrouter:anthropic/claude-opus-5.5', 0.5]]);
  assert.equal(report.timeout_rate, 0.5);
  assert.equal(report.refused_rate, 0.5);
  assert.deepEqual(judgeModels({ FROZEN_JUDGE_MODELS: 'gpt-5.5, openrouter:anthropic/claude-opus-5.5' }), ['gpt-5.5', 'openrouter:anthropic/claude-opus-5.5']);
  assert.deepEqual(judgeModels({}), ['gpt-5.5']);
});

test('an agent round that runs out of time is counted, apart from a wrong answer', async () => {
  const frozen = await freezeReport(fakeStore(), report, {}, { classify: async () => 'reply_quality' });
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools) { const error = new Error('The operation timed out.'); error.name = 'TimeoutError'; throw error; }
    if (body.text?.format?.name === 'frozen_judge') return out({ report_about: 'jules_reply', did_what_asked: { verdict: 'fail', reason: 'No reply.' }, coherent: { verdict: 'pass', reason: '' }, no_repeated_questions: { verdict: 'not_applicable', reason: '' }, meets_report: { verdict: 'fail', reason: '' } });
    return out({});
  };
  const result = await runFrozenCase(frozen, { OPENAI_API_KEY: 'test' }, { fetcher });
  assert.ok(result.timeouts >= 1);
  assert.equal(result.passed, false);
});
