import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoption, weekStart } from '../lib/adoption.js';
import { createStore } from '../lib/store.js';
import { createAdminHandler } from '../api/admin.js';
import { testerCells, weekCells, summaryCells, duration } from '../public/adoption-view.js';

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c';
// Wednesday Oct 14 2026, noon UTC.
const now = Date.parse('2026-10-14T12:00:00Z');
const rows = {
  conversations: [
    { id: A, sender_id: '+15550000001', created_at: '2026-09-30T10:00:00Z' },
    { id: B, sender_id: '+15550000002', created_at: '2026-10-06T10:00:00Z' },
    { id: C, sender_id: '+15550000003', created_at: '2026-10-13T09:00:00Z' },
  ],
  inbound: [
    { conversation_id: A, created_at: '2026-09-30T10:01:00Z' },
    { conversation_id: A, created_at: '2026-10-12T08:00:00Z' },
    { conversation_id: A, created_at: '2026-10-12T09:00:00Z' },
    { conversation_id: A, created_at: '2026-10-14T09:00:00Z' },
    { conversation_id: B, created_at: '2026-10-06T10:05:00Z' },
  ],
  results: [{ conversation_id: A, created_at: '2026-09-30T13:01:00Z' }, { conversation_id: B, created_at: '2026-10-06T10:06:00Z' }],
  saves: [{ conversation_id: A, saved_at: '2026-10-01T10:00:00Z' }],
  alerts: [{ conversation_id: A, active: true, created_at: '2026-10-08T10:00:00Z' }, { conversation_id: A, active: false, created_at: '2026-10-02T10:00:00Z' }],
  costs: [{ conversation_id: A, cost_usd: '0.125' }, { conversation_id: A, cost_usd: 0.2 }],
};

test('each tester gets their furthest ladder step, activity and activation speed', () => {
  const report = adoption(rows, now);
  const [a, b, c] = report.testers;
  assert.deepEqual([a.id, b.id, c.id], [A, B, C], 'sorted by furthest step');
  assert.equal(a.stage, 'watching'); assert.equal(b.stage, 'results'); assert.equal(c.stage, 'joined');
  assert.equal(a.active_days_7, 2, 'two distinct days in the last week');
  assert.equal(a.active_days_total, 3);
  assert.equal(a.alerts_active, 1); assert.equal(a.alerts_total, 2);
  assert.equal(a.reached.watching, '2026-10-02T10:00:00Z', 'first alert ever, even if cancelled later');
  assert.equal(a.hours_to_results, 3);
  assert.equal(a.cost_usd, 0.33);
  assert.equal(c.last_active_at, null); assert.equal(c.hours_to_results, null); assert.equal(c.cost_usd, null);
  assert.deepEqual(report.summary, { testers: 3, active_7: 1, results: 2, saved: 1, watching_now: 1 });
});

test('weekly ladder counts testers who reached each step by the end of each week, newest first', () => {
  const { weeks } = adoption(rows, now);
  assert.deepEqual(weeks.map(w => w.week_of), ['2026-10-12', '2026-10-05', '2026-09-28']);
  assert.equal(weeks[0].current, true);
  assert.deepEqual(weeks[2], { week_of: '2026-09-28', current: false, joined: 1, active: 1, reached: { joined: 1, messaged: 1, results: 1, saved: 1, watching: 1 } });
  assert.deepEqual(weeks[1].reached, { joined: 2, messaged: 2, results: 2, saved: 1, watching: 1 });
  assert.equal(weeks[1].active, 1, 'only B messaged that week');
  assert.deepEqual(weeks[0], { week_of: '2026-10-12', current: true, joined: 1, active: 1, reached: { joined: 3, messaged: 2, results: 2, saved: 1, watching: 1 } });
});

test('the ladder is capped at eight weeks and an empty database gives an empty report', () => {
  const old = adoption({ conversations: [{ id: A, sender_id: 'x', created_at: '2026-01-01T00:00:00Z' }] }, now);
  assert.equal(old.weeks.length, 8);
  assert.equal(old.weeks.at(-1).reached.joined, 1);
  const empty = adoption({}, now);
  assert.deepEqual(empty.testers, []); assert.deepEqual(empty.weeks, []); assert.equal(empty.summary.testers, 0);
  assert.equal(weekStart('2026-10-18T23:59:00Z').toISOString(), '2026-10-12T00:00:00.000Z', 'Sunday belongs to the week that started Monday');
});

test('adoptionRows reads ids and timestamps only and keeps replies that carried products', async () => {
  const paths = [];
  const fetcher = async url => {
    const path = decodeURIComponent(new URL(url).pathname.replace('/rest/v1/', '') + new URL(url).search); paths.push(path);
    const body = path.startsWith('messages') && path.includes('outbound')
      ? [{ conversation_id: A, created_at: 't1', first: { url: 'https://shop.example/a' } }, { conversation_id: A, created_at: 't2', first: null }]
      : [];
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  const result = await createStore({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, fetcher).adoptionRows();
  assert.deepEqual(result.results, [{ conversation_id: A, created_at: 't1' }]);
  assert.ok(paths.every(p => !/select=[^&]*body/.test(p)), 'no message text is read');
  assert.ok(paths.some(p => p.includes('identification-test')), 'owner test messages are excluded');
  assert.ok(paths.some(p => p.includes('line=neq.simulator')));
});

test('the admin API serves the adoption view to the owner only', async () => {
  const store = { adoptionRows: async () => rows };
  const call = async access => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await createAdminHandler({ auth: async () => access, storeFactory: () => store })({ method: 'GET', url: '/api/admin?view=adoption', headers: {} }, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const ok = await call(200);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.summary.testers, 3);
  assert.equal((await call(401)).status, 401);
});

test('page cells read plainly', () => {
  const report = adoption(rows, now);
  const a = testerCells(report.testers[0], report.steps, now);
  assert.deepEqual(a.stage, { label: 'Watching', tone: 'ok' });
  assert.equal(testerCells(report.testers[1], report.steps, now).stage.tone, 'plain');
  assert.equal(a.active_days, '2 of 7'); assert.equal(a.alerts, '1 on · 2 set'); assert.equal(a.first_results, '3 hours'); assert.equal(a.cost, '$0.33');
  assert.equal(testerCells(report.testers[2], report.steps, now).last_active, 'never');
  assert.deepEqual([duration(0.01), duration(1), duration(72), duration(null)], ['1 min', '1 hour', '3 days', '—']);
  const week = weekCells(report.weeks[0], report.steps);
  assert.ok(week.week.includes('(this week)'));
  assert.deepEqual(week.steps.map(s => s.value), ['3', '2 · 67%', '2 · 67%', '1 · 33%', '1 · 33%']);
  assert.equal(summaryCells(report.summary)[1].note, '33% of testers');
});
