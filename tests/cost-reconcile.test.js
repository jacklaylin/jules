import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/costs.js';
import { reconcileText } from '../public/costs-view.js';

const noBilling = { openai: { status: 'not_connected' }, serpapi: { status: 'not_connected' }, github: { status: 'not_connected' }, vercel: { status: 'not_connected' } };
const openai = (days, scope = 'project') => ({ ...noBilling, openai: { status: 'connected', days, otherProjects: 0, scope, checkedAt: '2026-10-10T12:00:00Z', message: '' } });
// 1M input tokens of gpt-4.1-mini = $0.40 at list price.
const call = (day, millions, model = 'gpt-4.1-mini') => ({ day, feature: 'chat', provider: 'openai', model, calls: 1, input_tokens: millions * 1e6, cached_tokens: 0, output_tokens: 0, web_search_calls: 0 });
const report = (providers, metered, now = '2026-10-10T15:00:00Z') => buildReport({ date: '2026-10-10', entries: [], providers, metered, now: new Date(now) });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('billed spend Jules did not record is shown on every view, counting only days OpenAI has finished reporting',()=>{
  // Oct 1–2 billed $3 but Jules recorded $0.80; Oct 9–10 are still inside OpenAI's reporting lag.
  const r = report(openai({ '2026-10-01': 1, '2026-10-02': 2, '2026-10-09': 50, '2026-10-10': 0 }), [call('2026-10-01', 1), call('2026-10-02', 1), call('2026-10-10', 1)]);
  assert.equal(r.reconciliation.status, 'unrecorded'); close(r.reconciliation.billed, 3); close(r.reconciliation.recorded, 0.8); close(r.reconciliation.gap, 2.2);
  assert.equal(r.reconciliation.through, '2026-10-02'); assert.equal(r.reconciliation.days, 2);
  const line = reconcileText(r); assert.equal(line.over, true); assert.match(line.text, /\$2\.20 that Jules didn’t record through Oct 2/);
  assert.ok(r.rows.find(x => x.id === 'openai').notes.some(n => /\$2\.20 not recorded by Jules/.test(n)));
});

test('small gaps match; recording more than billed points at list prices; whole-organization billing is called out',()=>{
  const matched = report(openai({ '2026-10-01': 0.45 }), [call('2026-10-01', 1)]);
  assert.equal(matched.reconciliation.status, 'matched'); assert.equal(reconcileText(matched).over, false); assert.match(reconcileText(matched).text, /nothing is going unrecorded/);
  const over = report(openai({ '2026-10-01': 1 }), [call('2026-10-01', 5)]);
  assert.equal(over.reconciliation.status, 'overestimated'); assert.match(reconcileText(over).text, /\$1\.00 more than OpenAI billed.*lib\/usage\.js/);
  const org = report(openai({ '2026-10-01': 5 }, 'organization'), [call('2026-10-01', 1)]);
  assert.match(reconcileText(org).text, /whole OpenAI organization/);
  // Calls to a model with no list price are recorded but unpriced: the gap says they may be part of it.
  const unpriced = report(openai({ '2026-10-01': 5 }), [call('2026-10-01', 1), call('2026-10-01', 1, 'gpt-9')]);
  assert.match(reconcileText(unpriced).text, /gpt-9 have no list price/);
});

test('without billing, metering or a finished day the check says why instead of guessing',()=>{
  assert.equal(report(noBilling, [call('2026-10-01', 1)]).reconciliation.status, 'not_connected');
  assert.equal(report(openai({ '2026-10-01': 1 }), null).reconciliation.status, 'unavailable');
  const early = buildReport({ date: '2026-10-01', entries: [], providers: openai({ '2026-10-01': 1 }), metered: [], now: new Date('2026-10-01T15:00:00Z') });
  assert.equal(early.reconciliation.status, 'waiting');
  for (const r of [report(noBilling, []), report(openai({ '2026-10-01': 1 }), null), early]) { const line = reconcileText(r); assert.equal(line.over, false); assert.match(line.text, /can’t be checked/); }
});
