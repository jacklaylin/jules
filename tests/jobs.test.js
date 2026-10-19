import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JOBS, buildJobs, recordJobRun } from '../lib/jobs.js';
import { buildReport, validateEntry } from '../lib/costs.js';
import { jobRows, jobsAlert, entryBody } from '../public/costs-view.js';
import { createPriceChecksHandler } from '../api/price-checks.js';
import { handleGmailRefresh } from '../lib/purchase-texts.js';

// The guard against an untracked cost: every schedule in the repo must be in lib/jobs.js, with the same timing.
test('every Vercel cron and every Supabase pg_cron schedule in the repo is a registered job',()=>{
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url))).crons ?? [];
  for (const cron of vercel) {
    const job = JOBS.find(j => j.scheduler === 'vercel' && j.path === cron.path);
    assert.ok(job, `${cron.path} is scheduled in vercel.json but not listed in lib/jobs.js`);
    assert.equal(job.schedule, cron.schedule, `${job.id} schedule matches vercel.json`);
  }
  const dir = new URL('../db/', import.meta.url), scheduled = new Map();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort())
    for (const [, name, schedule] of readFileSync(new URL(file, dir), 'utf8').matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) scheduled.set(name, schedule);
  assert.ok(scheduled.size >= 2);
  for (const [name, schedule] of scheduled) {
    const job = JOBS.find(j => j.cron === name);
    assert.ok(job, `${name} is scheduled in db/ but not listed in lib/jobs.js`);
    assert.equal(job.schedule, schedule);
  }
  // And nothing listed that no longer runs.
  for (const job of JOBS) assert.ok(job.scheduler === 'vercel' ? vercel.some(c => c.path === job.path) : scheduled.has(job.cron), `${job.id} is still scheduled`);
});

const days = n => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const cost = (day, feature, value) => ({ day, feature, provider: 'openai', calls: 1, cost: value });
const scheduled = [{ jobname: 'jules-gmail-sweep', schedule: '* * * * *', active: true, runs: 100, failed: 0, last_run: '2026-10-10T11:59:00Z' },
  { jobname: 'jules-reply-watchdog', schedule: '* * * * *', active: true, runs: 100, failed: 0, last_run: '2026-10-10T11:59:00Z' }];
const runs = [{ day: '2026-10-10', job: 'price_checks', runs: 1, failed: 0, last_at: '2026-10-10T13:00:00Z', last_status: 'ok' },
  { day: '2026-10-10', job: 'purchase_check', runs: 1, failed: 0, last_at: '2026-10-09T17:00:00Z', last_status: 'ok' }];
const now = new Date('2026-10-10T18:00:00Z');
const row = (report, id) => report.rows.find(r => r.id === id);

test('a job is flagged over budget, projected over budget, or when a day spikes past double its average',()=>{
  const priced = [...days(9).map(d => cost(d, 'price_checks', 1)), cost('2026-10-10', 'price_checks', 1),
    ...days(9).map(d => cost(d, 'purchase_check', 0.2)), cost('2026-10-10', 'purchase_check', 1)];
  const entries = [{ service: 'job:price_checks', kind: 'job_budget', date: '2026-09-01', amount: 20 }, { service: 'job:purchase_check', kind: 'job_budget', date: '2026-10-01', amount: 5 }];
  const report = buildJobs({ date: '2026-10-10', days: days(10), priced, runs, scheduled, entries, now });
  const price = row(report, 'price_checks'), purchase = row(report, 'purchase_check');
  // $10 so far, $31 projected: the budget carried forward from September is not yet spent, but will be.
  assert.equal(price.month, 10); assert.equal(price.projected, 31); assert.equal(price.budget, 20); assert.equal(price.status, 'warn');
  assert.ok(price.flags.some(f => /Projected \$31\.00/.test(f.text)));
  // $1 on a day whose average is $0.20 is a spike; $2.80 projected to ~$8.68 is over the $5 budget.
  assert.ok(purchase.flags.some(f => /more than 2×/.test(f.text))); assert.ok(purchase.flags.some(f => /over its \$5\.00/.test(f.text)));
  assert.deepEqual(report.over, []);
  const spent = buildJobs({ date: '2026-10-10', days: days(10), priced, runs, scheduled, entries: [{ ...entries[0], amount: 9 }], now });
  assert.equal(row(spent, 'price_checks').status, 'over'); assert.deepEqual(spent.over, ['Price checks']);
});

test('a Supabase job not in the registry, or a registered one missing from Supabase, is never silently left out',()=>{
  const extra = buildJobs({ date: '2026-10-10', days: days(10), priced: [], runs, now,
    scheduled: [scheduled[0], { jobname: 'someone-elses-job', schedule: '*/5 * * * *', active: true, runs: 3, failed: 0, last_run: '2026-10-10T17:55:00Z' }] });
  const untracked = extra.rows.find(r => r.name === 'someone-elses-job');
  assert.equal(untracked.status, 'over'); assert.ok(untracked.unregistered); assert.equal(untracked.month, null);
  assert.equal(jobRows(extra).find(r => r.name === 'someone-elses-job').runs, '3 checks');
  assert.equal(row(extra, 'reply_watchdog').status, 'over'); assert.ok(row(extra, 'reply_watchdog').flags.some(f => /missing/.test(f.text)));
  // Costs recorded under an unknown job id show up too.
  assert.ok(buildJobs({ date: '2026-10-10', days: days(10), priced: [cost('2026-10-10', 'retired_job', 1)], runs, scheduled, now }).rows.some(r => r.id === 'retired_job' && r.status === 'over'));
});

test('a daily job that has not run in over 26 hours is flagged; unreadable figures stay unknown, not $0',()=>{
  const report = buildJobs({ date: '2026-10-10', days: days(10), priced: [], runs, scheduled, now: new Date('2026-10-10T20:00:00Z') });
  assert.ok(row(report, 'purchase_check').flags.some(f => /26 hours/.test(f.text))); assert.equal(row(report, 'price_checks').status, 'ok');
  const unknown = buildJobs({ date: '2026-10-10', days: days(10), priced: null, runs: null, scheduled: null, now });
  assert.equal(unknown.totals.month, null); assert.equal(row(unknown, 'price_checks').runs, null); assert.equal(row(unknown, 'price_checks').status, 'ok');
  assert.equal(jobRows(unknown)[0].month, 'Unknown'); assert.equal(jobRows(unknown)[0].runs, 'Unknown');
});

test('the cost report prices each job\'s metered calls and the status line names jobs over budget',()=>{
  const noBilling = { openai: { status: 'not_connected' }, serpapi: { status: 'not_connected' }, github: { status: 'not_connected' }, vercel: { status: 'not_connected' } };
  // 1M input tokens of gpt-4.1-mini = $0.40 at list price.
  const jobUsage = [{ day: '2026-10-10', job: 'reply_watchdog', provider: 'openai', model: 'gpt-4.1-mini', calls: 3, input_tokens: 1e6, cached_tokens: 0, output_tokens: 0, web_search_calls: 0 }];
  const report = buildReport({ date: '2026-10-10', entries: [{ service: 'job:reply_watchdog', kind: 'job_budget', date: '2026-10-01', amount: 0.1 }], providers: noBilling, metered: [], jobUsage, jobRuns: runs, scheduled, now });
  assert.ok(Math.abs(row(report.jobs, 'reply_watchdog').month - 0.4) < 1e-9); assert.equal(row(report.jobs, 'reply_watchdog').calls, 3);
  assert.deepEqual(jobsAlert(report), { text: 'Recurring jobs over budget or untracked: Stuck-reply watchdog', over: true });
});

test('a job budget is saved against a registered job only',()=>{
  const entry = entryBody({ kind: 'job_budget', service: 'job:price_checks', date: '2026-10-14', amount: '12', note: '' });
  assert.deepEqual(validateEntry(entry), { service: 'job:price_checks', kind: 'job_budget', date: '2026-10-01', amount: 12, note: '' });
  for (const service of ['job:unknown', 'openai']) assert.throws(() => validateEntry({ ...entry, service }));
  // A job id is not a service, so it cannot carry usage or a subscription.
  assert.throws(() => validateEntry({ ...entry, kind: 'subscription' }));
});

const response = () => ({ headers: {}, setHeader() {}, end(body) { this.body = JSON.parse(body); } });
test('scheduled runs are recorded as worked, failed or skipped, and a missing table never fails the job',async()=>{
  const recorded = [];
  const store = { claimPriceAlerts: async () => [], recordJobRun: async run => recorded.push(run) };
  const cron = { method: 'GET', headers: { authorization: 'Bearer s' } };
  await createPriceChecksHandler({ env: { CRON_SECRET: 's', PRICE_ALERTS_ENABLED: 'true' }, storeFactory: () => store })(cron, response());
  await createPriceChecksHandler({ env: { CRON_SECRET: 's' }, storeFactory: () => store })(cron, response());
  await handleGmailRefresh(cron, response(), store, { CRON_SECRET: 's', GMAIL_IMPORT_ENABLED: 'true', PURCHASE_TEXTS_ENABLED: 'true' }, async () => ({ people: 2, failed: 1 }));
  assert.deepEqual(recorded.map(r => [r.job, r.status]), [['price_checks', 'ok'], ['price_checks', 'skipped'], ['purchase_check', 'failed']]);
  assert.ok(recorded.every(r => Number.isInteger(r.duration_ms) && r.duration_ms >= 0 && !Number.isNaN(Date.parse(r.started_at))));
  await recordJobRun({ recordJobRun: async () => { throw new Error('relation "job_runs" does not exist'); } }, 'price_checks', Date.now(), 'ok');
});
