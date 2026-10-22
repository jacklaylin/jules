import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnsFrom, findEpisodes, chatMetrics, compareMetrics, composedBy, metricsTrend } from '../lib/chat-metrics.js';
import { triagePackets } from '../lib/feedback-triage.js';

const C = '11111111-aaaa-4000-8000-000000000001', D = '22222222-bbbb-4000-8000-000000000002';
const at = s => new Date(Date.UTC(2026, 9, 14, 12, 0, s)).toISOString();
const inbound = (id, s, conversation = C) => ({ conversation_id: conversation, provider_id: id, direction: 'inbound', status: 'received', source: 'tester', created_at: at(s), body: 'private text' });
const reply = (kind, id, s, extra = {}) => ({ conversation_id: C, operation_id: `${kind}:${id}`, direction: 'outbound', status: 'sent', source: 'ai', created_at: at(s), body: 'private reply', ...extra });
const product = n => ({ brand: 'Example', name: `Model ${n}`, url: `https://shop.example/p/${n}?ref=x` });
const start = (id, s, products, plan = { continuation: false, mode: 'identify', named_model: 'Model' }) =>
  reply('ai', id, s, { search_result: { identification_policy: 'text_wishlist', intent_action: 'start', products, text_wishlist_state: { stage: 'choice', options: products, search_plan: plan } } });
const select = (id, s, chosen) => reply('ai', id, s, { search_result: { identification_policy: 'text_wishlist', intent_action: 'selection', intent_decision: 'interest', products: [], text_wishlist_state: { stage: 'offer_set', selected_set: chosen } } });
const save = (id, s, chosen) => reply('ai', id, s, { search_result: { identification_policy: 'text_wishlist', intent_action: 'selection', intent_decision: 'confirm', user_confirmed: true, products: chosen } });

test('timing uses recorded diagnostics, then acknowledgment and re-dated reply rows, never the placeholder time', () => {
  const rows = [
    inbound('m1', 0), reply('ai', 'm1', 0, { search_result: { checked_at: at(50), timing_diagnostics: { first_message_ms: 4000, result_ms: 52000 } } }),
    inbound('m2', 100), reply('ack', 'm2', 103), reply('ai', 'm2', 140), // re-dated at send time after the acknowledgment
    inbound('m3', 200), reply('ai', 'm3', 200), // placeholder only: no send time known
    inbound('m4', 300), reply('ai', 'm4', 300, { sent_at: at(306) }),
  ];
  const turns = turnsFrom(rows);
  assert.deepEqual(turns.map(t => [t.first_message_ms, t.final_result_ms, t.timing_source]), [
    [4000, 52000, 'recorded'], [3000, 40000, 'estimated'], [null, null, 'unknown'], [6000, 6000, 'recorded']]);
  assert.equal(turns[1].acknowledged, true);
  assert.doesNotMatch(JSON.stringify(turns), /private|11111111-aaaa/);
  assert.equal(turns[0].conversation, '11111111');
});

test('fallbacks and replies that were never delivered count as failures; opted-out and test turns are ignored', () => {
  const now = Date.parse(at(0)) + 3600000;
  const rows = [
    inbound('f1', 0), reply('ai', 'f1', 0, { source: 'ai_fallback', sent_at: at(30) }),
    inbound('g1', 10), reply('ai', 'g1', 10, { status: 'generating' }),
    inbound('u1', 20), reply('ai', 'u1', 20, { status: 'uncertain' }),
    inbound('b1', 30), reply('ai', 'b1', 30, { status: 'blocked' }),
    { ...inbound('identification-test:x', 40) }, reply('ai', 'identification-test:x', 40),
  ];
  const turns = turnsFrom(rows, { now });
  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map(t => [t.fallback, t.stuck]), [[true, false], [false, true], [false, true]]);
  const recent = turnsFrom([inbound('g2', 0), reply('ai', 'g2', 0, { status: 'generating' })], { now: Date.parse(at(60)) });
  assert.equal(recent[0].stuck, false, 'a search still running is not stuck yet');
});

test('composition comes from the recorded field, else the chosen tool; saves and fallbacks are template text', () => {
  const actions = new Map([['ai:a', 'conversation_reply'], ['ai:b', 'find_products']]);
  assert.equal(composedBy({ operation_id: 'ai:a' }, actions), 'model');
  assert.equal(composedBy({ operation_id: 'ai:b' }, actions), 'template');
  assert.equal(composedBy({ operation_id: 'ai:b', search_result: { composed_by: 'model' } }, actions), 'model');
  assert.equal(composedBy({ operation_id: 'ai:a', search_result: { user_confirmed: true } }, actions), 'template');
  assert.equal(composedBy({ operation_id: 'ai:a', source: 'ai_fallback' }, actions), 'template');
  assert.equal(composedBy({ operation_id: 'ai:c' }, actions), 'unknown');
  assert.equal(composedBy({ operation_id: 'ai:d' }, new Map([['ai:d', 'agent_reply']])), 'model', 'the agent loop writes its own message');
});

test('named-product episodes: first try, after a retry, user supplied, and no pick', () => {
  const [a, b, c] = [1, 2, 3].map(product);
  const rows = [
    // first try: the saved item was in the first result set (URL query strings ignored)
    start('s1', 0, [a, b]), save('s2', 10, [{ ...b, url: 'https://shop.example/p/2' }]),
    // retry: a continuation search found it
    start('s3', 20, [a]), start('s4', 30, [c], { continuation: true, mode: 'identify', named_model: 'Model' }), select('s5', 40, [c]),
    // user supplied: saved a link no search showed
    start('s6', 50, []), save('s7', 60, [{ url: 'https://other.example/item' }]),
    // discovery does not count; an unfinished named search is "no pick"
    start('s8', 70, [a], { continuation: false, mode: 'discover', named_model: null }), select('s9', 80, [a]),
    start('s10', 90, [b]),
  ];
  const episodes = findEpisodes(rows);
  assert.deepEqual(episodes.map(e => [e.outcome, e.searches, e.found_on_first_search]), [
    ['first_try', 1, true], ['after_retry', 2, true], ['user_supplied', 1, false], ['no_acceptance', 1, true]]);
});

test('an episode does not carry across conversations', () => {
  const rows = [start('x1', 0, [product(1)]), { ...select('x2', 10, [product(1)]), conversation_id: D }];
  assert.deepEqual(findEpisodes(rows).map(e => e.outcome), ['no_acceptance']);
});

test('summary, per-day and per-conversation numbers', () => {
  const rows = [
    inbound('t1', 0), reply('ai', 't1', 0, { sent_at: at(10) }),
    inbound('t2', 20), reply('ai', 't2', 20, { sent_at: at(50), source: 'ai_fallback' }),
    inbound('t3', 0, D), { ...reply('ai', 't3', 0, { sent_at: at(30) }), conversation_id: D },
  ];
  const actions = new Map([['ai:t1', 'conversation_reply'], ['ai:t3', 'find_products']]);
  const m = chatMetrics(rows, { actions, now: Date.parse(at(100)) });
  assert.equal(m.summary.turns, 3);
  assert.deepEqual(m.summary.final_result_s, { median: 30, p90: 30, max: 30 });
  assert.equal(m.summary.fallbacks, 1); assert.equal(m.summary.failure_rate, 0.333);
  assert.deepEqual(m.summary.composed_by, { model: 1, template: 2, mixed: 0, unknown: 0 });
  assert.equal(m.by_day.length, 1); assert.equal(m.by_day[0].day, '2026-10-14');
  assert.deepEqual(m.by_conversation.map(c => [c.conversation, c.turns]), [['11111111', 2], ['22222222', 1]]);
  assert.equal(chatMetrics(rows, { since: at(15) }).summary.turns, 1);
});

test('comparison says better, worse, or too few to tell', () => {
  const base = { turns: 10, timed_turns: 10, first_timed: 10, composed_known: 10, named_accepted: 6, first_message_s: { median: 40 }, final_result_s: { median: 60, p90: 100 }, failure_rate: 0.2, model_written_share: 0.3, first_try_rate: 0.5 };
  const after = { ...base, first_message_s: { median: 4 }, final_result_s: { median: 70, p90: 100 }, model_written_share: 0.6, named_accepted: 2, first_try_rate: 1 };
  const moved = Object.fromEntries(compareMetrics(base, after).map(m => [m.metric, m.verdict]));
  assert.deepEqual(moved, { 'first_message_s.median': 'better', 'final_result_s.median': 'worse', 'final_result_s.p90': 'unchanged',
    failure_rate: 'unchanged', model_written_share: 'better', first_try_rate: 'too few to tell' });
});

test('triage packets include the trend when the store can read metrics, without failing triage when it cannot', async () => {
  const rows = [inbound('t1', 0), reply('ai', 't1', 0, { sent_at: at(10) })];
  const store = { feedbackSince: async () => [], feedbackContext: async () => [], metricRows: async () => rows, replyActions: async () => [] };
  const result = await triagePackets(store, { since: new Date(Date.now() - 2 * 86400000).toISOString() });
  assert.equal(result.metrics.days, 2); assert.ok(Array.isArray(result.metrics.moved));
  const broken = await triagePackets({ ...store, metricRows: async () => { throw Error('down'); } }, {});
  assert.equal(broken.metrics.error, 'Chat metrics could not be read.');
  assert.equal((await triagePackets({ feedbackSince: async () => [], feedbackContext: async () => [] }, {})).metrics, null);
  const trend = await metricsTrend(store, { days: 7, now: Date.parse(at(60)) });
  assert.equal(trend.current.turns, 1); assert.equal(trend.previous.turns, 0);
});

test('metric rows page through results and still read before migration 027 adds sent_at', async () => {
  const { createStore } = await import('../lib/store.js');
  const urls = [];
  const fetcher = async url => {
    urls.push(decodeURIComponent(url));
    if (url.includes('sent_at') || url.includes('reply_diagnostics')) return new Response(JSON.stringify({ code: '42703' }), { status: 400 });
    const offset = Number(new URL(url).searchParams.get('offset'));
    return new Response(JSON.stringify(Array.from({ length: offset === 0 ? 1000 : 3 }, () => ({ direction: 'inbound' }))), { status: 200 });
  };
  const store = createStore({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' }, fetcher);
  const rows = await store.metricRows('2026-10-01T00:00:00Z');
  assert.equal(rows.length, 1003);
  assert.ok(urls.every(u => !/\bbody\b/.test(u)), 'message text is never read');
  assert.equal(urls.filter(u => u.includes('offset=1000')).length, 1);
});

test('reply diagnostics: recorded outcomes and composition win, and a watchdog-recovered reply counts as a stall', () => {
  const rows = [
    inbound('r1', 0), reply('ai', 'r1', 0, { source: 'ai_recovery', sent_at: at(700), reply_diagnostics: { outcome: 'stalled', recovery: 'watchdog' } }),
    inbound('r2', 10), reply('ai', 'r2', 10, { sent_at: at(20), reply_diagnostics: { outcome: 'sent', composed_by: 'model' } }),
    inbound('r3', 20), reply('ai', 'r3', 20, { sent_at: at(30), reply_diagnostics: { outcome: 'fallback' } }),
  ];
  const turns = turnsFrom(rows, { actions: new Map([['ai:r2', 'find_products']]) });
  assert.deepEqual(turns.map(t => [t.stuck, t.fallback, t.composed_by]), [[true, false, 'template'], [false, false, 'model'], [false, true, 'template']]);
});

test('each metric is judged on its own sample, and a figure with nothing before it is never called "no data"', () => {
  const week = (over = {}) => ({ turns: 50, timed_turns: 30, first_timed: 32, composed_known: 40, named_accepted: 6, named_searches: 10,
    first_message_s: { median: 15 }, final_result_s: { median: 40, p90: 80 }, failure_rate: 0.1, model_written_share: 0.5, first_try_rate: 0.5, ...over });
  const verdicts = (before, after) => Object.fromEntries(compareMetrics(before, after).map(m => [m.metric, m]));
  // Authorship known for only 3 replies the week before: too few to call the rise better, however many messages there were.
  let moved = verdicts(week({ composed_known: 3, model_written_share: 0 }), week());
  assert.equal(moved.model_written_share.verdict, 'too few to tell');
  assert.deepEqual([moved.model_written_share.before_n, moved.model_written_share.after_n], [3, 40]);
  assert.deepEqual([moved['first_message_s.median'].after_n, moved['final_result_s.p90'].after_n, moved.failure_rate.after_n], [32, 30, 50]);
  // 2 picks this week, none the week before: too few to tell (the screenshot's "100%, No data").
  moved = verdicts(week({ named_accepted: 0, first_try_rate: null }), week({ named_accepted: 2, first_try_rate: 1 }));
  assert.deepEqual([moved.first_try_rate.after, moved.first_try_rate.verdict], [1, 'too few to tell']);
  // Enough this week and nothing before: "no earlier data". Nothing this week: "no data".
  moved = verdicts(week({ named_accepted: 0, first_try_rate: null }), week({ named_accepted: 8, first_try_rate: 0.75 }));
  assert.equal(moved.first_try_rate.verdict, 'no earlier data');
  moved = verdicts(week(), week({ named_accepted: 0, first_try_rate: null }));
  assert.deepEqual([moved.first_try_rate.after, moved.first_try_rate.verdict, moved.first_try_rate.after_n], [null, 'no data', 0]);
  // Lower waits and failures are better; more model-written replies and first-try finds are better.
  moved = verdicts(week(), week({ first_message_s: { median: 20 }, failure_rate: 0.05, model_written_share: 0.4, first_try_rate: 0.6 }));
  assert.deepEqual(['first_message_s.median', 'failure_rate', 'model_written_share', 'first_try_rate'].map(k => moved[k].verdict), ['worse', 'better', 'worse', 'better']);
});

test('the summary counts the replies behind each figure', () => {
  const rows = [
    inbound('n1', 0), reply('ack', 'n1', 2), reply('ai', 'n1', 0, { status: 'generating' }), // acknowledged, result still running
    inbound('n2', 10), reply('ai', 'n2', 10, { sent_at: at(20), reply_diagnostics: { outcome: 'sent', composed_by: 'model' } }),
  ];
  const s = chatMetrics(rows, { now: Date.parse(at(60)) }).summary;
  assert.deepEqual([s.turns, s.first_timed, s.timed_turns, s.composed_known], [2, 2, 1, 1]);
});

test('messages per turn count every sent row of the turn plus the reply’s cards and photos', () => {
  const rows = [
    inbound('n1', 0), reply('ai', 'n1', 2),
    inbound('n2', 10), reply('ack', 'n2', 18), reply('ai', 'n2', 40, { search_result: { timing_diagnostics: { result_ms: 30000 } }, reply_diagnostics: { sent_parts: [{ kind: 'card' }, { kind: 'card' }] } }),
    inbound('n3', 50), reply('ai', 'n3', 60, { search_result: { timing_diagnostics: { result_ms: 10000, ack_held: true } } }),
    inbound('n4', 70), reply('ai', 'n4', 70, { status: 'generating' }),
  ];
  const turns = turnsFrom(rows, { now: Date.parse(at(80)) });
  assert.deepEqual(turns.map(t => [t.messages, t.searched]), [[1, false], [4, true], [1, true], [null, false]]);
  const summary = chatMetrics(rows, { now: Date.parse(at(80)) }).summary;
  assert.equal(summary.messages_per_turn, 2); assert.equal(summary.messages_per_search_turn, 2.5);
  assert.equal(summary.search_turns, 2); assert.equal(summary.single_message_share, 0.667);
});
