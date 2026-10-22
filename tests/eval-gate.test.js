import test from 'node:test';
import assert from 'node:assert/strict';
import { codeChecks, judgeFrozen, judgePlan, storedRun, judgeAgreement } from '../lib/frozen-evals.js';
import { frozenAreas, routingAreas, areasForFiles, parseAreas } from '../lib/eval-areas.js';
import { openaiCost } from '../lib/usage.js';
import { spendTracker, spendByModel } from '../lib/replay-gate.js';

const out = value => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) });
const verdict = v => ({ verdict: v, reason: 'r' });
const frozen = {
  id: 'dev-1', messages: [
    { direction: 'inbound', status: 'received', body: 'find me the margiela jacket' },
    { direction: 'outbound', status: 'sent', body: 'Which size do you wear?' },
    { direction: 'inbound', status: 'received', body: 'medium, under $900' },
  ],
  pending: { options: [{ name: 'Shell Jacket', url: 'https://www.mrporter.com/p/1', price_snapshot: { amount: 845, currency: 'USD' } }] },
  original: { search: null },
};

test('code decides a run failed from the turn alone: no reply, a made-up link or price, an earlier message repeated', () => {
  assert.deepEqual(codeChecks(frozen, { reply: 'It is $845 at MR PORTER: https://www.mrporter.com/p/1. Under your $900.', calls: [] }), {});
  assert.equal(codeChecks(frozen, { reply: '', calls: [], error: 'timeout' }).did_what_asked.verdict, 'fail');
  assert.equal(codeChecks(frozen, { reply: 'Try https://www.ssense.com/p/9', calls: [] }).coherent.verdict, 'fail');
  assert.match(codeChecks(frozen, { reply: 'It is $799 now.', calls: [] }).coherent.reason, /799/);
  // A link a tool call carried this turn is known.
  assert.deepEqual(codeChecks(frozen, { reply: 'Saved https://www.ssense.com/p/9', calls: [{ name: 'find_products', args: { url: 'https://www.ssense.com/p/9' } }] }), {});
  assert.equal(codeChecks(frozen, { reply: 'which size  do you wear?', calls: [] }).no_repeated_questions.verdict, 'fail');
});

test('a run code failed is not sent to the judge', async () => {
  const result = await judgeFrozen(frozen, { reply: 'Try https://www.ssense.com/p/9', calls: [] }, { OPENAI_API_KEY: 'test' }, async () => { throw Error('the judge was called'); });
  assert.equal(result.passed, false);
  assert.equal(result.judge_calls, 0);
  assert.equal(result.criteria.did_what_asked.verdict, 'not_judged');
});

test('each model in the judge plan scores only its criteria, on the Flex tier, falling back to standard', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body), keys = body.text.format.schema.required.filter(k => k !== 'report_about');
    calls.push({ model: body.model, tier: body.service_tier ?? null, keys });
    if (body.model === 'cheap' && body.service_tier === 'flex') return { ok: false, status: 503, json: async () => ({ error: { code: 'resource_unavailable' } }), clone() { return this; }, headers: { get: () => null } };
    return out({ report_about: body.model === 'strong' ? 'jules_reply' : 'what_search_found', ...Object.fromEntries(keys.map(k => [k, verdict(k === 'meets_report' ? 'fail' : 'pass')])) });
  };
  const env = { OPENAI_API_KEY: 'test', FROZEN_JUDGE_MODEL: 'cheap', FROZEN_JUDGE_PLAN: 'meets_report=strong' };
  assert.deepEqual(judgePlan(env), { did_what_asked: 'cheap', coherent: 'cheap', no_repeated_questions: 'cheap', meets_report: 'strong' });
  const result = await judgeFrozen(frozen, { reply: 'Which color?', calls: [] }, env, fetcher);
  assert.deepEqual(calls.filter(c => c.model === 'strong').map(c => [c.tier, c.keys]), [['flex', ['meets_report']]]);
  assert.deepEqual(calls.filter(c => c.model === 'cheap').map(c => c.tier), ['flex', null], 'Flex unavailable: once more at the standard tier');
  assert.deepEqual(calls.find(c => c.model === 'cheap').keys, ['did_what_asked', 'coherent', 'no_repeated_questions']);
  // report_about comes from the model that scores meets_report.
  assert.equal(result.report_about, 'jules_reply');
  assert.deepEqual(result.failed, ['meets_report']);
  assert.equal(result.judge_calls, 2);
  assert.throws(() => judgePlan({ FROZEN_JUDGE_PLAN: 'tone=x' }), /not <criterion>=<model>/);
  const standard = []; await judgeFrozen(frozen, { reply: 'Which color?', calls: [] }, { ...env, FROZEN_JUDGE_TIER: 'default' }, async (u, o) => { standard.push(JSON.parse(o.body).service_tier ?? null); return fetcher(u, { ...o, body: JSON.stringify({ ...JSON.parse(o.body), model: 'strong' }) }); });
  assert.deepEqual(standard, [null, null]);
});

test('calibration rebuilds a stored run and measures agreement per criterion', () => {
  assert.equal(storedRun({ reply: 'x', tools: [{ name: 'find_products', args: {} }] }).exact, true);
  const saved = storedRun({ reply: 'x', tools: [{ name: 'save_to_wishlist', args: {} }] });
  assert.deepEqual([saved.exact, saved.run.confirmed, saved.run.outcome.saved_now], [false, true, true]);
  assert.equal(storedRun({ reply: 'x', tools: [{ name: 'save_to_wishlist' }], confirmed: false, outcome: { saved_now: false } }).exact, true);
  const c = (a, b) => ({ criteria: { did_what_asked: verdict(a), coherent: verdict('pass'), no_repeated_questions: verdict(b), meets_report: verdict('pass') } });
  const pairs = [
    { reference: { ...c('pass', 'not_applicable'), passed: true }, candidate: { ...c('pass', 'pass'), passed: true } },
    { reference: { ...c('fail', 'pass'), passed: false }, candidate: { ...c('pass', 'pass'), passed: true } },
  ];
  const a = judgeAgreement(pairs), by = Object.fromEntries(a.criteria.map(x => [x.key, x]));
  assert.equal(by.did_what_asked.exact, 0.5);
  assert.equal(by.no_repeated_questions.exact, 0.5);
  assert.equal(by.no_repeated_questions.decision, 1, 'not applicable and pass both let the case pass');
  assert.equal(a.passed, 0.5);
});

test('cases map to areas from what their turn did, and changed files to areas', () => {
  assert.deepEqual(frozenAreas({ original: { actions: [{ tool: 'save_to_wishlist' }] }, category: 'ignored_request' }), ['saves', 'consent']);
  assert.deepEqual(frozenAreas({ original: { actions: [] }, category: 'wrong_results' }, [{ name: 'find_products', args: { search_plan: { brands: [{ role: 'reference' }], price: { stance: 'prefers_lower' } } } }]), ['search', 'brand', 'price']);
  assert.deepEqual(frozenAreas({ original: null, category: 'wrong_results' }), ['conversation']);
  assert.deepEqual(routingAreas('save'), ['saves', 'consent']);
  assert.deepEqual(routingAreas('something-new'), ['conversation']);
  const files = areasForFiles(['lib/skills/options.js', 'lib/text-wishlist.js', 'public/wishlist.css']);
  assert.deepEqual([files.areas, files.shared, files.unmapped], [['saves', 'consent', 'options'], [], ['public/wishlist.css']]);
  assert.deepEqual(areasForFiles(['lib/ai.js']).shared, ['lib/ai.js']);
  assert.throws(() => parseAreas('consent,tone'), /Unknown area tone/);
});

test('a Flex call costs half, and a run reports what each model cost', () => {
  const call = { provider: 'openai', model: 'gpt-5.5', input_tokens: 1e6, cached_tokens: 0, output_tokens: 0 };
  assert.equal(openaiCost(call), 5);
  assert.equal(openaiCost({ ...call, service_tier: 'flex' }), 2.5);
  const t = spendTracker(5);
  t.add([{ provider: 'openai', model: 'gpt-5.5', cost_usd: 0.02, input_tokens: 1 }, { provider: 'openai', model: 'gpt-5.6-luna', cost_usd: 0.01, input_tokens: 1 }, { provider: 'openai', model: 'gpt-5.5', cost_usd: 0.02, input_tokens: 1 }]);
  assert.equal(spendByModel(t), 'gpt-5.5 $0.04 (2 calls) · gpt-5.6-luna $0.01 (1 calls)');
});

test('a screening judge passes what it passes; only what it fails goes to the plan judge, which decides', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body), keys = body.text.format.schema.required.filter(k => k !== 'report_about');
    calls.push([body.model, keys]);
    if (body.model === 'screen') return out({ report_about: 'jules_reply', did_what_asked: verdict('fail'), coherent: verdict('pass'), no_repeated_questions: verdict('fail'), meets_report: verdict('not_applicable') });
    return out({ report_about: 'jules_reply', did_what_asked: verdict('pass'), no_repeated_questions: verdict('fail') });
  };
  const result = await judgeFrozen(frozen, { reply: 'Which color?', calls: [] }, { OPENAI_API_KEY: 'test', FROZEN_JUDGE_SCREEN: 'screen', FROZEN_JUDGE_MODEL: 'strong' }, fetcher);
  assert.deepEqual(calls, [['screen', ['did_what_asked', 'coherent', 'no_repeated_questions', 'meets_report']], ['strong', ['did_what_asked', 'no_repeated_questions']]]);
  assert.deepEqual(result.failed, ['no_repeated_questions'], 'the strong judge overturned one screen failure and kept the other');
  assert.equal(result.criteria.meets_report.verdict, 'not_applicable');
  assert.equal(result.judge_calls, 2);
  // Nothing failed by the screen: one cheap call.
  calls.length = 0;
  await judgeFrozen(frozen, { reply: 'Which color?', calls: [] }, { OPENAI_API_KEY: 'test', FROZEN_JUDGE_SCREEN: 'screen', FROZEN_JUDGE_MODEL: 'strong' },
    async (u, o) => { calls.push(JSON.parse(o.body).model); return out({ report_about: 'jules_reply', did_what_asked: verdict('pass'), coherent: verdict('pass'), no_repeated_questions: verdict('not_applicable'), meets_report: verdict('pass') }); });
  assert.deepEqual(calls, ['screen']);
});

test('the profile check is answered from the eval cache when the exact request was answered before; nothing else is', async () => {
  const { mkdtemp } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const file = join(await mkdtemp(join(tmpdir(), 'eval-cache-')), 'requests.json');
  const sent = [], original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { sent.push(JSON.parse(options.body).text?.format?.name ?? 'chat'); return { ok: true, status: 200, clone() { return this; }, text: async () => JSON.stringify({ status: 'completed', output: [] }), json: async () => ({ status: 'completed', output: [] }) }; };
  try {
    const request = name => ({ method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', input: 'same', text: { format: { name } } }) });
    const first = await (await import('../lib/eval-cache.js')).evalCache(file);
    await first.fetcher('https://api.openai.com/v1/responses', request('profile_check'));
    await first.fetcher('https://api.openai.com/v1/responses', request('profile_check'));
    await first.fetcher('https://api.openai.com/v1/responses', request('quality'));
    await first.fetcher('https://api.openai.com/v1/responses', request('quality'));
    await first.save();
    const again = await (await import('../lib/eval-cache.js')).evalCache(file);
    const answer = await again.fetcher('https://api.openai.com/v1/responses', request('profile_check'));
    assert.deepEqual(await answer.clone().json(), { status: 'completed', output: [] });
    await again.fetcher('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', input: 'changed', text: { format: { name: 'profile_check' } } }) });
    assert.deepEqual(sent, ['profile_check', 'quality', 'quality', 'profile_check'], 'a repeat or a stored request is not sent; a changed one is');
    assert.deepEqual([first.stats, again.stats], [{ hits: 1, misses: 1 }, { hits: 1, misses: 1 }]);
  } finally { globalThis.fetch = original; }
});

test('runs are compared case by case: majority flips, trust areas, new cases, and a case\'s recent nights', async () => {
  const { caseFlips, nightHistory } = await import('../lib/eval-areas.js');
  const run = (id, passed, areas = ['search']) => ({ id, passed, areas, failures: passed ? [] : [`${id} failed`] });
  const main = [run('a', true), run('a', true), run('a', false), run('b', true, ['consent']), run('b', true, ['consent']), run('b', true, ['consent']), run('c', false), run('c', false), run('c', true)];
  const pr = [run('a', true), run('a', false), run('a', true), run('b', false, ['consent']), run('b', false, ['consent']), run('b', true, ['consent']), run('c', true), run('c', true), run('c', false), run('d', true)];
  const { fell, rose, added } = caseFlips(main, pr);
  assert.deepEqual(fell.map(f => [f.id, f.trust, f.was.passes, f.now.passes]), [['b', true, 3, 1]]);
  assert.deepEqual(rose.map(f => f.id), ['c']);
  assert.deepEqual(added, ['d']);
  assert.deepEqual([...fell[0].now.failures], ['b failed']);
  assert.equal(nightHistory([{ results: [run('a', true)] }, { results: [] }, { results: [run('a', false)] }], 'a'), '✓·✗');
});
