import test from 'node:test';
import assert from 'node:assert/strict';
import { linksCheck, consentCheckFor, scoreTurn, judgeInput, runJudge, handleJudge, dailyLimit, judgeEnv, CRITERIA } from '../lib/judge.js';
import { triagePackets } from '../lib/feedback-triage.js';
import { JOBS } from '../lib/jobs.js';

const verified = (url, extra = {}) => ({ url, brand: 'Thursday', name: 'Desperado', listing_check: { status: 'verified', product_name: 'Desperado', product_brand: 'Thursday', color: 'black', availability: 'in_stock' }, price_snapshot: { amount: 199, currency: 'USD' }, ...extra });
const A = 'https://thursdayboots.com/products/desperado-black', B = 'https://store.example/boot';

test('links: verified result pages pass; links outside the results or unverified ones fail; Jules’s own links are ignored', () => {
  const result = { products: [verified(A, { merchant_options: [{ url: 'https://nordstrom.com/s/desperado' }] })] };
  assert.equal(linksCheck([`here: ${A}?variant=1.`, 'also https://nordstrom.com/s/desperado', 'your list https://jules-gamma.vercel.app/wishlist'], result, { siteOrigin: 'https://jules-gamma.vercel.app' }).verdict, 'pass');
  const unknown = linksCheck([`${A} and https://made-up.example/x`], result);
  assert.equal(unknown.verdict, 'fail'); assert.match(unknown.reason, /1 of 2 links were not among the checked results/);
  const unchecked = linksCheck([B], { products: [{ url: B, sourcing_status: 'store_not_found' }] });
  assert.equal(unchecked.verdict, 'fail'); assert.match(unchecked.reason, /not verified product pages/);
  assert.equal(linksCheck(['which color do you want?'], result).verdict, 'not_applicable');
  // The options a pick stored in the same turn count as the shown results.
  assert.equal(linksCheck([A], { products: [], text_wishlist_state: { options: [verified(A)] } }).verdict, 'pass');
  assert.equal(linksCheck(['https://shop.example/cart/1'], { checkout_links: [{ url: 'https://shop.example/p', checkout_url: 'https://shop.example/cart/1' }] }).verdict, 'pass');
});

test('consent: checked by code from what ran; nothing saved is not applicable', () => {
  assert.equal(consentCheckFor([{ tool: 'find_products', status: 'done' }]).verdict, 'not_applicable');
  assert.equal(consentCheckFor([{ tool: 'save_to_wishlist', status: 'done' }]).verdict, 'pass');
  assert.equal(consentCheckFor([{ tool: 'manage_price_alerts', operation: 'status', status: 'done' }]).verdict, 'not_applicable');
});

const input = (extra = {}) => ({ _bodies: [A], _result: { products: [verified(A)] }, _actions: [{ tool: 'find_products', status: 'done' }], ...extra });
const modelSays = (overrides = {}) => Object.fromEntries(CRITERIA.filter(c => c.by !== 'code').map(c => [c.key, overrides[c.key] ?? { verdict: 'pass', reason: 'Fine.' }]));

test('a turn passes only when no criterion fails; code checks override the model and reasons are scrubbed', () => {
  assert.deepEqual(scoreTurn(modelSays(), input()).failed, []);
  const made = scoreTurn(modelSays({ commerce_facts: { verdict: 'fail', reason: 'Said "free shipping" to +1 415 555 0100, see https://x.example' } }), input());
  assert.equal(made.verdict, 'fail'); assert.deepEqual(made.failed, ['commerce_facts']);
  assert.equal(made.criteria.commerce_facts.reason, 'Said free shipping to [phone], see [link]');
  // The model cannot pass a link the code found outside the results.
  assert.deepEqual(scoreTurn(modelSays(), input({ _bodies: ['https://made-up.example/x'] })).failed, ['links_verified']);
  // A consent failure the model saw (claimed a save that didn't happen) stands even when nothing ran.
  assert.deepEqual(scoreTurn(modelSays({ consent: { verdict: 'fail', reason: 'Claimed a save.' } }), input()).failed, ['consent']);
  // Missing or malformed model output is not applicable, never a pass by accident of shape.
  assert.equal(scoreTurn({ identity: { verdict: 'great' } }, input()).criteria.identity.verdict, 'not_applicable');
});

const iso = ms => new Date(ms).toISOString();
const NOW = Date.parse('2026-10-21T10:00:00Z'), T = NOW - 2 * 86400000;
function context(id, { reply = `found it: ${A}`, next = 'saving it' } = {}) {
  return [
    { direction: 'inbound', provider_id: 'old', body: 'hi', status: 'received', created_at: iso(T - 60000) },
    { direction: 'inbound', provider_id: 'flag', body: 'private note', status: 'received', developer_feedback: 'note', created_at: iso(T - 30000) },
    { direction: 'inbound', provider_id: id, body: 'black thursday desperado boots, my email is a@b.co', status: 'received', created_at: iso(T), message_images: [] },
    { direction: 'outbound', operation_id: `ack:${id}`, body: 'looking now', status: 'sent', created_at: iso(T + 1000) },
    { direction: 'outbound', operation_id: `ai:${id}`, body: reply, status: 'sent', created_at: iso(T + 50000),
      search_result: { products: [verified(A)] }, reply_diagnostics: { actions: [{ tool: 'find_products', status: 'done', option_indices: [0] }], saved_now: false } },
    { direction: 'inbound', provider_id: 'next', body: next, status: 'received', created_at: iso(T + 90000) },
  ];
}

test('the judge sees the conversation redacted, this turn’s messages, checked facts and actions — not links or flags', () => {
  const view = judgeInput(context('in1'), { operation: 'ai:in1' });
  assert.equal(view.user_message.text, 'black thursday desperado boots, my email is [email]');
  assert.deepEqual(view.earlier_conversation.map(m => m.text), ['hi']);
  assert.deepEqual(view.jules_messages.map(m => m.from), ['jules', 'jules']);
  assert.equal(view.next_user_message.text, 'saving it');
  assert.equal(view.checked_products[0].page_checked, true); assert.equal(view.checked_products[0].url, undefined);
  assert.deepEqual(view.actions, [{ tool: 'find_products', status: 'done' }]);
  assert.equal(judgeInput(context('in1'), { operation: 'ai:missing' }), null);
  // An older saved reply (no recorded outcome) still tells the judge the save happened.
  const older = context('in1'); delete older[4].reply_diagnostics; older[4].wishlist_saved = true;
  assert.equal(judgeInput(older, { operation: 'ai:in1' }).saved_now, true);
});

function fakeModel(verdicts) {
  const calls = [];
  const fetcher = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(verdicts) }] }] }) }; };
  return { fetcher, calls };
}
function fakeStore({ turns, judged = [], judgedToday = 0 }) {
  const saved = [], judgements = new Map();
  const messages = turns.flatMap(t => context(t.id).map(m => ({ ...m, conversation_id: 'c1', sent_at: m.direction === 'outbound' ? iso(Date.parse(m.created_at) + (t.offset ?? 0)) : undefined, created_at: iso(Date.parse(m.created_at) + (t.offset ?? 0)) })));
  return { saved, judgements,
    outcomeRows: async () => ({ messages, usage: [], events: [] }),
    saveSourcingTurns: async rows => { saved.push(...rows); },
    judgedSince: async () => judgedToday, judgedOperations: async () => judged,
    saveJudgement: async (op, j) => { judgements.set(op, j); },
    feedbackContext: async (_c, at) => context(turns.find(t => Math.abs(Date.parse(at) - (T + (t.offset ?? 0))) < 1000)?.id ?? 'none').map(m => ({ ...m, created_at: iso(Date.parse(m.created_at) + (turns.find(t => Math.abs(Date.parse(at) - (T + (t.offset ?? 0))) < 1000)?.offset ?? 0)) })),
    recordUsage: async () => {} };
}
const env = { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4.1-mini' };

test('a run refreshes outcomes, judges due turns once, and stores verdicts with reasons', async () => {
  const store = fakeStore({ turns: [{ id: 'in1' }, { id: 'in2', offset: 600000 }], judged: ['ai:in2'] });
  const { fetcher, calls } = fakeModel(modelSays({ identity: { verdict: 'fail', reason: 'Showed brown, asked for black.' } }));
  const summary = await runJudge(store, env, { now: NOW, fetcher });
  assert.deepEqual(store.saved.map(r => r.operation).sort(), ['ai:in1', 'ai:in2']);
  assert.ok(store.saved.every(r => !('criteria' in r) && !('verdict' in r)), 'outcome refresh never touches judge fields');
  assert.equal(summary.judged, 1); assert.equal(summary.failed, 1); assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gpt-4.1-mini');
  const j = store.judgements.get('ai:in1');
  assert.equal(j.verdict, 'fail'); assert.deepEqual(j.failed, ['identity']); assert.equal(j.criteria.links_verified.verdict, 'pass');
  assert.ok(!JSON.stringify(calls[0].input).includes('private note'), 'developer feedback never reaches the judge');
});

test('the daily limit, recent turns, a missing key and dry runs are respected', async () => {
  const { fetcher, calls } = fakeModel(modelSays());
  assert.equal((await runJudge(fakeStore({ turns: [{ id: 'in1' }], judgedToday: 50 }), env, { now: NOW, fetcher })).skipped, 'daily_limit');
  assert.equal((await runJudge(fakeStore({ turns: [{ id: 'in1' }] }), { ...env, JUDGE_DAILY_TURNS: '0' }, { now: NOW, fetcher })).skipped, 'daily_limit');
  // Results sent under a day ago wait for their follow-up.
  assert.equal((await runJudge(fakeStore({ turns: [{ id: 'in1' }] }), env, { now: T + 3600000, fetcher })).due, 0);
  assert.equal((await runJudge(fakeStore({ turns: [{ id: 'in1' }] }), { OPENAI_API_KEY: 'replace-with-key' }, { now: NOW, fetcher })).skipped, 'not_configured');
  assert.equal(calls.length, 0);
  const dry = fakeStore({ turns: [{ id: 'in1' }] }), result = await runJudge(dry, env, { now: NOW, fetcher, dryRun: true });
  assert.equal(result.results.length, 1); assert.equal(dry.saved.length, 0); assert.equal(dry.judgements.size, 0);
  assert.equal(dailyLimit({}), 50); assert.equal(dailyLimit({ JUDGE_DAILY_TURNS: '12' }), 12);
  assert.equal(judgeEnv({ OPENAI_MODEL: 'a', OPENAI_JUDGE_MODEL: 'gpt-4.1' }).OPENAI_MODEL, 'gpt-4.1');
});

test('the scheduler endpoint needs the secret and records the run', async () => {
  const res = () => ({ status: null, body: null });
  const json = (r, status, body) => { r.status = status; r.body = body; };
  const denied = res(); await handleJudge({}, denied, env, { store: {}, authorized: async () => false, json });
  assert.equal(denied.status, 401);
  const runs = [], store = { ...fakeStore({ turns: [] }), recordJobRun: async row => runs.push(row) };
  const ok = res(); await handleJudge({}, ok, env, { store, authorized: async () => true, json });
  assert.equal(ok.status, 200); assert.equal(runs[0].job, 'judge'); assert.equal(runs[0].status, 'ok');
  assert.ok(JOBS.some(j => j.id === 'judge' && j.cron === 'jules-nightly-judge'));
});

test('judge failures reach feedback triage with their reasons and the conversation around the turn', async () => {
  const store = {
    feedbackSince: async () => [], qualitySince: async () => [], metricRows: async () => [],
    judgeFailuresSince: async () => [{ operation: 'ai:in1', conversation_id: 'c1', at: iso(T), judged_at: iso(NOW), result: 'verified', labels: ['rejected'], failed: ['identity'],
      criteria: { identity: { verdict: 'fail', reason: 'Showed brown, asked for black.' }, links_verified: { verdict: 'pass', reason: 'ok' } } }],
    feedbackContext: async () => context('in1'),
  };
  const out = await triagePackets(store, {});
  const packet = out.packets.find(p => p.kind === 'judge_failure');
  assert.deepEqual(packet.judge.reasons, { identity: 'Showed brown, asked for black.' });
  assert.equal(packet.context.find(m => m.is_reported_message).text, 'black thursday desperado boots, my email is [email]');
  assert.equal(out.judge_failures_available, true);
  // Before db/037 the read fails and triage still works.
  const before = await triagePackets({ ...store, judgeFailuresSince: async () => { throw Object.assign(new Error('x'), { database_status: 404 }); } }, {});
  assert.equal(before.judge_failures_available, false); assert.equal(before.packets.length, 0);
});
