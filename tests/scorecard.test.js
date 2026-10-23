import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { metricCells, weekRows, worstTurns, agreement, turnRow, verdict, METRICS, weekStart, forWho } from '../public/scorecard-view.js';
import { loadScorecard, replayDraft, ownConversations } from '../lib/scorecard.js';
import { createAdminHandler } from '../api/admin.js';

const NOW = Date.parse('2026-10-22T12:00:00Z'); // a Thursday; the week began Monday Oct 19
const day = n => new Date(NOW - n * 86400000).toISOString();
const turn = (n, extra = {}) => ({ operation: `ai:m${n}-${Math.random()}`, conversation_id: 'c1', at: day(n), request_type: 'text', result: 'verified', products_shown: 3, verified_shown: 3,
  first_message_ms: 2000, result_ms: 50000, cost_usd: 0.3, labels: ['saved'], headline: 'positive', ...extra });
const many = (count, n, extra) => Array.from({ length: count }, () => turn(n, extra));

test('this week against last week, each metric on its own sample', () => {
  const turns = [...many(6, 1), ...many(6, 9, { headline: 'negative', labels: ['rejected'], result_ms: 80000, verdict: 'fail' })];
  const cells = Object.fromEntries(metricCells(turns, { now: NOW }).map(c => [c.key, c]));
  assert.equal(cells.positive_rate.value, '100%'); assert.equal(cells.positive_rate.verdict, 'Better'); assert.equal(cells.positive_rate.was, 'vs 0%');
  assert.equal(cells.result_p50.value, '50s'); assert.equal(cells.result_p50.verdict, 'Better');
  // No judged turns this week: no data, never a 0%.
  assert.equal(cells.judge_pass_rate.value, '—'); assert.equal(cells.judge_pass_rate.verdict, 'No data');
  assert.equal(cells.cost_per_search.verdict, 'About the same');
  // Under five on either side is too few to tell.
  assert.equal(metricCells([...many(3, 1), ...many(6, 9)], { now: NOW }).find(c => c.key === 'verified_rate').verdict, 'Too few to tell');
});

test('engagement leaves out turns still waiting or with no recorded follow-up; shopping questions are not searches for the verified rate', () => {
  const turns = [...many(5, 1), turn(1, { headline: 'waiting', labels: ['waiting'] }), turn(1, { headline: 'neutral', labels: ['not_recorded'] }), turn(1, { result: 'question', products_shown: 0, headline: 'neutral', labels: ['replied'] })];
  const cells = Object.fromEntries(metricCells(turns, { now: NOW }).map(c => [c.key, c]));
  assert.equal(cells.positive_rate.sample, '5 results'); assert.equal(cells.verified_rate.sample, '7 searches');
});

test('the type filter scopes every figure', () => {
  const turns = [...many(5, 1, { request_type: 'photo', result: 'nothing_found', products_shown: 0 }), ...many(5, 1)];
  assert.equal(metricCells(turns, { now: NOW, type: 'photo' }).find(c => c.key === 'nothing_found_rate').value, '100%');
  assert.equal(metricCells(turns, { now: NOW, type: 'text' }).find(c => c.key === 'nothing_found_rate').value, '0%');
  assert.equal(metricCells(turns, { now: NOW }).find(c => c.key === 'nothing_found_rate').value, '50%');
});

test('a search that found nothing is not a failure; a fallback or unreadable photo is', () => {
  const turns = [...many(2, 1, { result: 'nothing_found', products_shown: 0 }), turn(1, { result: 'failed' }), turn(1, { result: 'unreadable', request_type: 'photo' }), ...many(4, 1)];
  const cells = Object.fromEntries(metricCells(turns, { now: NOW }).map(c => [c.key, c]));
  assert.equal(cells.failed_rate.value, '25%'); assert.equal(cells.nothing_found_rate.value, '25%');
  // Both are still worth reading.
  assert.equal(worstTurns(turns).length, 4);
});

test('testers only leaves out the founder’s own conversation; include mine keeps everything', () => {
  const turns = [...many(3, 1, { conversation_id: 'mine', headline: 'negative', labels: ['flagged'] }), ...many(5, 1, { conversation_id: 'c1' })];
  assert.equal(forWho(turns, 'testers', ['mine']).length, 5); assert.equal(forWho(turns, 'all', ['mine']).length, 8);
  assert.equal(metricCells(forWho(turns, 'testers', ['mine']), { now: NOW }).find(c => c.key === 'positive_rate').value, '100%');
  assert.equal(forWho(turns, 'testers', []).length, 8);
});

test('the founder’s conversation comes from the signup-alert conversation or the founder’s phone, never placeholders', () => {
  const conversations = [{ id: 'a', sender_id: '+14155550142' }, { id: 'b', sender_id: '+1 (415) 555-0199' }, { id: 'c', sender_id: '+14155550100' }];
  assert.deepEqual(ownConversations(conversations, { OWNER_ALERT_CONVERSATION_ID: 'a', FOUNDER_ALERT_PHONE: '+14155550199' }).ids.sort(), ['a', 'b']);
  assert.deepEqual(ownConversations(conversations, { OWNER_ALERT_CONVERSATION_ID: 'replace-with-your-own-conversation-id', FOUNDER_ALERT_PHONE: 'replace-with-your-phone-in-international-format' }), { ids: [], configured: false });
  assert.deepEqual(ownConversations(conversations, {}), { ids: [], configured: false });
});

test('weeks run newest first from Monday, at most eight', () => {
  const rows = weekRows([turn(1), turn(9), turn(80)], { now: NOW });
  assert.equal(rows.length, 8); assert.equal(rows[0].week_of, '2026-10-19'); assert.equal(rows[0].current, true);
  assert.equal(rows[1].searches, 1); assert.equal(rows[0].cells.length, METRICS.length);
  assert.equal(new Date(weekStart(NOW)).getUTCDay(), 1);
  assert.deepEqual(weekRows([], { now: NOW }), []);
});

test('turns to read: judge failures first, then negative outcomes, then failed searches; fine turns are left out', () => {
  const fine = turn(1), negative = turn(2, { headline: 'negative', labels: ['rejected'] }), failed = turn(1, { result: 'failed', headline: 'silent', labels: ['silent'] });
  const judged = turn(3, { verdict: 'fail', failed: ['identity', 'commerce_facts'], criteria: { identity: { reason: 'Brown, not black.' }, commerce_facts: { reason: 'Free shipping not shown.' } } });
  assert.deepEqual(worstTurns([fine, failed, negative, judged]).map(t => t.operation), [judged.operation, negative.operation, failed.operation]);
  const row = turnRow({ ...judged, message_id: 'msg-1' }, { senders: { c1: '+14155550142' } });
  assert.equal(row.href, '/admin/people/c1?tab=conversation&message=msg-1'); assert.equal(row.tester, '+14155550142');
  assert.equal(row.judge, 'Wrong product or variant, Unsupported price, stock or shipping');
  assert.deepEqual(row.reasons.map(r => r.reason), ['Brown, not black.', 'Free shipping not shown.']);
  assert.equal(turnRow(turn(1)).judge, 'Not judged yet');
});

test('agreement counts only marked turns', () => {
  assert.deepEqual(agreement([turn(1, { founder_verdict: 'agree' }), turn(1, { founder_verdict: 'disagree' }), turn(1)]), { marked: 2, agree: 1, rate: 0.5 });
  assert.equal(agreement([]).rate, null);
  assert.equal(verdict(METRICS[0], { value: 0.5, n: 10 }, { value: null, n: 0 }), 'no earlier data');
});

// The data loader: stored rows for eight weeks plus the last three days computed live; fresh labels win, judge fields stay.
function store({ stored = [], failStored = false } = {}) {
  const T = Date.parse(day(1));
  const messages = [
    { conversation_id: 'c1', direction: 'inbound', provider_id: 'p1', created_at: new Date(T).toISOString(), body: 'boots' },
    { conversation_id: 'c1', direction: 'outbound', operation_id: 'ai:p1', provider_id: 'o1', status: 'sent', source: 'ai', created_at: new Date(T + 40000).toISOString(), sent_at: new Date(T + 40000).toISOString(),
      search_result: { products: [{ url: 'https://s.example/a', listing_check: { status: 'verified' } }] }, reply_diagnostics: { actions: [{ tool: 'find_products', status: 'done', continuation: 'new_request' }] } },
  ];
  return {
    sourcingTurns: async () => { if (failStored) throw Object.assign(new Error('missing'), { database_status: 404 }); return stored; },
    outcomeRows: async () => ({ messages, usage: [], events: [{ conversation_id: 'c1', kind: 'reaction', ref: 'ai:p1', detail: 'love' }] }),
    list: async () => [{ id: 'c1', sender_id: '+14155550142' }],
    inboundIds: async () => new Map([['p1', 'msg-p1']]),
    feedbackContext: async () => [{ direction: 'outbound', status: 'sent', body: 'hi, what are you after?' }, { direction: 'inbound', provider_id: 'flag', body: 'note', developer_feedback: 'x' }, { direction: 'inbound', provider_id: 'p1', body: 'black boots, call me on +1 415 555 0100', status: 'received' }],
  };
}

test('the scorecard merges stored judge fields with fresh outcome labels, and degrades before db/038', async () => {
  const data = await loadScorecard(store({ stored: [{ operation: 'ai:p1', conversation_id: 'c1', at: day(1), labels: ['silent'], headline: 'silent', verdict: 'fail', failed: ['identity'], criteria: { identity: { reason: 'x' } }, cost_usd: '0.1' }] }), { now: NOW });
  const [t] = data.turns;
  assert.deepEqual(t.labels, ['reacted']); assert.equal(t.verdict, 'fail'); assert.equal(t.message_id, 'msg-p1');
  assert.equal(data.judge_available, true); assert.equal(data.senders.c1, '+14155550142');
  assert.deepEqual(data.own_conversations, []); assert.equal(data.own_configured, false);
  assert.deepEqual((await loadScorecard(store(), { now: NOW, env: { FOUNDER_ALERT_PHONE: '+1 415 555 0142' } })).own_conversations, ['c1']);
  const before = await loadScorecard(store({ failStored: true }), { now: NOW });
  assert.equal(before.judge_available, false); assert.equal(before.turns.length, 1);
});

test('a replay draft masks contact details and leaves out flags', async () => {
  const draft = await replayDraft(store(), { operation: 'ai:p1', conversation_id: 'c1', at: day(1), failed: ['identity'], criteria: { identity: { reason: 'Brown, not black.' } } });
  assert.equal(draft.message, 'black boots, call me on [phone]');
  assert.deepEqual(draft.history.map(h => h.body), ['hi, what are you after?']);
  assert.deepEqual(draft.judge, { identity: 'Brown, not black.' });
  assert.match(draft.todo, /Anonymise/);
});

function post(body, headers = {}) { return Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', origin: 'https://jules.example', ...headers } }); }
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.data = JSON.parse(v); } });
function admin(overrides = {}) {
  const marks = [];
  const handler = createAdminHandler({ auth: async () => 200, env: { SITE_ORIGIN: 'https://jules.example' }, storeFactory: () => ({
    conversation: async id => id === '00000000-0000-4000-8000-000000000001' ? { id } : null,
    sourcingTurn: async op => op === 'ai:p1' ? { operation: 'ai:p1', conversation_id: '00000000-0000-4000-8000-000000000001', at: day(1), failed: [] } : null,
    markJudgement: async (op, v) => { marks.push([op, v]); }, ...overrides }) });
  return { handler, marks };
}
const C = '00000000-0000-4000-8000-000000000001';

test('the owner marks the judge only on a saved turn of that conversation, from the admin page', async () => {
  const { handler, marks } = admin();
  let res = response(); await handler(post({ action: 'judge-mark', conversation: C, operation: 'ai:p1', verdict: 'disagree' }), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(marks, [['ai:p1', 'disagree']]);
  res = response(); await handler(post({ action: 'judge-mark', conversation: C, operation: 'ai:p1', verdict: null }), res);
  assert.deepEqual(marks.at(-1), ['ai:p1', null]);
  for (const [body, headers, status] of [
    [{ action: 'judge-mark', conversation: C, operation: 'ai:p1', verdict: 'maybe' }, {}, 400],
    [{ action: 'judge-mark', conversation: C, operation: 'ai:other', verdict: 'agree' }, {}, 404],
    [{ action: 'judge-mark', conversation: C, operation: 'drop table', verdict: 'agree' }, {}, 400],
    [{ action: 'judge-mark', conversation: C, operation: 'ai:p1', verdict: 'agree' }, { origin: 'https://evil.example' }, 400],
  ]) { res = response(); await handler(post(body, headers), res); assert.equal(res.statusCode, status, JSON.stringify(body)); }
  assert.equal(marks.length, 2);
});

test('OpenAI account outages are left out of every figure and the turns to read, and shown beside the week’s count', () => {
  const turns = [...many(5, 1), ...many(3, 1, { result: 'outage', products_shown: 0, headline: 'silent', labels: ['silent'], result_ms: 1000 })];
  const cells = Object.fromEntries(metricCells(turns, { now: NOW }).map(c => [c.key, c]));
  assert.equal(cells.failed_rate.value, '0%'); assert.equal(cells.failed_rate.sample, '5 searches'); assert.equal(cells.result_p50.value, '50s');
  assert.equal(worstTurns(turns).length, 0);
  const [week] = weekRows(turns, { now: NOW });
  assert.equal(week.searches, 5); assert.equal(week.outages, 3);
});
