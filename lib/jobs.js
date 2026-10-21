// Every recurring job Jules runs, and what each one costs (Admin › Costs › Recurring jobs).
// tests/jobs.test.js fails if vercel.json or a db/ migration schedules a job that is not listed here,
// and the dashboard flags any pg_cron job Supabase has that is not listed, so none goes untracked.
// Metered costs come from usage_events.job (lib/usage.js); compute time is in the Vercel and
// Supabase rows, which their billing does not split per job.
export const JOBS = [
  { id: 'price_checks', name: 'Price checks', scheduler: 'vercel', schedule: '0 13 * * *', when: 'Daily, 13:00 UTC', path: '/api/price-checks',
    spends: 'OpenAI for alert texts, SerpApi for finding other stores (at most 10 alerts a run), Photon texts' },
  { id: 'purchase_check', name: 'Daily purchase check', scheduler: 'vercel', schedule: '0 17 * * *', when: 'Daily, 17:00 UTC', path: '/api/wishlist?gmail=refresh',
    spends: 'OpenAI for reading new receipts, tagging items and writing the text, Photon texts' },
  { id: 'gmail_sweep', name: 'Import restart sweep', scheduler: 'supabase', cron: 'jules-gmail-sweep', schedule: '* * * * *', when: 'Every minute; calls Vercel only when an import is stuck, a profile text is due or an onboarding reminder is due', path: '/api/wishlist?gmail=sweep',
    spends: 'OpenAI for 24-hour profile texts and onboarding reminders, Photon texts. Imports it restarts count under Gmail import, not here' },
  { id: 'reply_watchdog', name: 'Stuck-reply watchdog', scheduler: 'supabase', cron: 'jules-reply-watchdog', schedule: '* * * * *', when: 'Every minute; calls Vercel only when a reply is stuck', path: '/api/imessage?watchdog=replies',
    spends: 'OpenAI for recovery texts, Photon texts' },
  { id: 'judge', name: 'Nightly judge', scheduler: 'supabase', cron: 'jules-nightly-judge', schedule: '*/10 9-11 * * *', when: 'Every 10 minutes, 09:00–11:50 UTC (2–4:50 am Pacific), until the day’s turns are judged', path: '/api/imessage?job=judge', stale_ms: 26 * 3600000,
    spends: 'OpenAI (gpt-4.1-mini by default) to score each sourcing turn, at most JUDGE_DAILY_TURNS (default 50) a day' },
];
export const jobIds = JOBS.map(j => j.id);

// Records one run. Never fails the job: before db/034_recurring_jobs.sql the table is missing.
export async function recordJobRun(store, job, startedAt, status, summary = {}) {
  try { await store?.recordJobRun?.({ job, started_at: new Date(startedAt).toISOString(), duration_ms: Math.max(0, Date.now() - startedAt), status, summary }); }
  catch { console.log(JSON.stringify({ event: 'job_run_record_failed', job, status })); }
}

// A day's cost this far above the job's average for earlier days this month is flagged as a spike.
const SPIKE_FACTOR = 2, SPIKE_MIN_USD = 0.10;
// A daily job with no run for this long, or a minute job whose scheduler has not ticked, is flagged.
const DAILY_STALE_MS = 26 * 3600000, MINUTE_STALE_MS = 10 * 60000;
const sum = values => values.reduce((s, v) => s + v, 0);
const latest = values => values.filter(Boolean).sort().at(-1) ?? null;
const usd = n => `$${n.toFixed(2)}`;

// One row per job: runs, cost for the day / month to date / projected month end, its budget and
// what needs attention. usage, runs or scheduled is null when it could not be read; unknown stays
// null, never $0. priced: usage_by_day_job rows priced by lib/costs.js priceMetered (feature = job).
export function buildJobs({ date, days, priced, runs, scheduled, entries = [], now = new Date() }) {
  const month = date.slice(0, 7) + '-01', inMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const current = now.toISOString().slice(0, 10) === date;
  const known = new Set(JOBS.map(j => j.id));
  const extra = [...new Set([...(priced ?? []).map(r => r.feature), ...(runs ?? []).map(r => r.job)].filter(id => !known.has(id)))]
    .map(id => ({ id, name: id, scheduler: null, when: 'Unknown', spends: 'Unknown', unregistered: true }));
  const crons = [...(scheduled ?? []).filter(s => !JOBS.some(j => j.cron === s.jobname))
    .map(s => ({ id: null, cron: s.jobname, name: s.jobname, scheduler: 'supabase', schedule: s.schedule, when: s.schedule, spends: 'Unknown', unregistered: true }))];
  const rows = [...JOBS, ...extra, ...crons].map(job => {
    const mine = (priced ?? []).filter(r => r.feature === job.id), flags = [];
    const byDay = {}; let unpriced = false;
    for (const r of mine) { if (r.cost === null) unpriced = true; else byDay[r.day] = (byDay[r.day] ?? 0) + r.cost; }
    // A job Jules does not run (an unlisted pg_cron job) records no metered calls: its cost is unknown, not $0.
    const metered = priced && !(job.unregistered && job.cron);
    const monthCost = metered ? sum(days.map(d => byDay[d] ?? 0)) : null;
    const today = metered ? byDay[date] ?? 0 : null;
    const projected = monthCost === null ? null : monthCost / days.length * inMonth;
    const runRows = (runs ?? []).filter(r => r.job === job.id && days.includes(String(r.day).slice(0, 10)));
    const last = runRows.slice().sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)))[0];
    const tick = job.cron ? (scheduled ?? []).find(s => s.jobname === job.cron) : null;
    const budgetEntry = entries.filter(e => e.kind === 'job_budget' && e.service === 'job:' + job.id && e.date <= month).sort((a, b) => b.date.localeCompare(a.date))[0];
    const budget = budgetEntry ? Number(budgetEntry.amount) : null;
    if (job.unregistered) flags.push({ level: 'over', text: job.cron ? `Supabase runs this job (${job.schedule}) but it is not in lib/jobs.js, so its costs are not attributed.` : 'Costs recorded under a job that is not in lib/jobs.js.' });
    if (budget !== null && monthCost > budget) flags.push({ level: 'over', text: `Over its ${usd(budget)} monthly budget.` });
    else if (budget !== null && projected > budget) flags.push({ level: 'warn', text: `Projected ${usd(projected)}, over its ${usd(budget)} monthly budget.` });
    const before = days.filter(d => d < date), avg = before.length ? sum(before.map(d => byDay[d] ?? 0)) / before.length : null;
    if (today !== null && today >= SPIKE_MIN_USD && avg !== null && today > SPIKE_FACTOR * avg) flags.push({ level: 'warn', text: `${usd(today)} on this day, more than ${SPIKE_FACTOR}× its ${usd(avg)} daily average this month.` });
    if (unpriced) flags.push({ level: 'warn', text: 'Some calls use a model with no list price; they are counted, not priced.' });
    if (runs && runRows.some(r => Number(r.failed) > 0)) flags.push({ level: 'warn', text: `${sum(runRows.map(r => Number(r.failed)))} failed run(s) this month.` });
    if (job.cron && scheduled && !job.unregistered) {
      if (!tick) flags.push({ level: 'over', text: `Not scheduled in Supabase: ${job.cron} is missing. Re-run its db/ migration.` });
      else if (!tick.active) flags.push({ level: 'warn', text: `Paused in Supabase (${job.cron} is inactive).` });
      // A job that ticks only in a nightly window (stale_ms) is stale after a missed night, not after 10 minutes.
      else if (current && (!tick.last_run || now - Date.parse(tick.last_run) > (job.stale_ms ?? MINUTE_STALE_MS))) flags.push({ level: 'warn', text: job.stale_ms ? 'The Supabase scheduler has not run it in over 26 hours.' : 'The Supabase scheduler has not run it in the last 10 minutes.' });
    }
    if (job.scheduler === 'vercel' && runs && current && (!last || now - Date.parse(last.last_at) > DAILY_STALE_MS)) flags.push({ level: 'warn', text: last ? 'No run in over 26 hours.' : 'No run recorded this month.' });
    if (last?.last_status === 'skipped') flags.push({ level: 'info', text: 'Last run was skipped: the job is switched off in Vercel settings.' });
    if (budget === null && !job.unregistered) flags.push({ level: 'info', text: 'No monthly budget set.' });
    return {
      id: job.id, name: job.name, when: job.when, scheduler: job.scheduler, spends: job.spends, unregistered: !!job.unregistered,
      today, month: monthCost, projected, budget, calls: sum(mine.map(r => r.provider === 'openai' ? r.calls : 0)), searches: sum(mine.map(r => r.provider === 'serpapi' ? r.calls : 0)),
      runs: runs && !(job.unregistered && job.cron) ? sum(runRows.map(r => Number(r.runs))) : null, failed: runs ? sum(runRows.map(r => Number(r.failed))) : null,
      lastRun: latest([last?.last_at, tick?.last_run]), lastStatus: last?.last_status ?? null, ticks: tick ? Number(tick.runs) : null,
      status: flags.some(f => f.level === 'over') ? 'over' : flags.some(f => f.level === 'warn') ? 'warn' : 'ok', flags,
    };
  });
  const total = key => rows.every(r => r[key] === null) ? null : sum(rows.map(r => r[key] ?? 0));
  return { rows, totals: { today: total('today'), month: total('month'), projected: total('projected') },
    attention: rows.filter(r => r.status !== 'ok').map(r => r.name), over: rows.filter(r => r.status === 'over').map(r => r.name),
    known: { costs: !!priced, runs: !!runs, scheduled: !!scheduled } };
}
