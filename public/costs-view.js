// Admin › Costs data view: the words and rows the page shows for one /api/costs report. The page shows a
// month by default (to date, or the whole month once it is over) with a projection; Day is an option. Pure functions so the wording (billed, estimated, manual or
// unknown) is testable without a browser.

export const VIEWS = [['', 'By service'], ['features', 'By feature'], ['people', 'By person'], ['jobs', 'Recurring jobs'], ['evals', 'Evals']];
export const viewOf = search => { const view = new URLSearchParams(search).get('view') ?? ''; return VIEWS.some(([v]) => v === view) ? view : ''; };

export const PERIODS = [['month', 'Month'], ['day', 'Day']];
export const periodOf = search => new URLSearchParams(search).get('period') === 'day' ? 'day' : 'month';
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
// The day the API reports through: the chosen day, or for a month its last day (today while it is running).
export function apiDate(period, value, today) {
  if (period === 'day') return value > today ? today : value;
  const month = value.slice(0, 7);
  return month >= today.slice(0, 7) ? today : lastDay(month);
}
// The picker value when switching period: a day keeps its month; a month opens on its reported day.
export const pickerValue = (period, value, today) => period === 'month' ? value.slice(0, 7) : apiDate('month', value, today);
const monthName = date => new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fullMonth = date => date === lastDay(date.slice(0, 7));

export const money = value => value === null || value === undefined ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2 }).format(value);
const when = at => { const d = new Date(at); return at && Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'; };

// Beside the title: the month (to date, with its projection) or the day. Unknown is never $0.
export function totalLine(data, period = 'month') {
  if (!data) return { amount: '—', label: '' };
  const { today, month, projected } = data.totals;
  const partial = data.incomplete.length ? ' · known part only' : '';
  if (period === 'day') return { amount: money(today), label: `${data.date} (UTC) · month to date ${money(month)}${today === null ? '' : partial}` };
  const label = fullMonth(data.date) ? `${monthName(data.date)} (UTC), whole month` : `${monthName(data.date)} to date, through ${data.date} (UTC) · projected month end ${money(projected)} (calculated)`;
  return { amount: money(month), label: label + (month === null ? '' : partial) };
}

// Lifetime since the build started, through the selected date. Missing services are named by month.
export function lifetimeText(data) {
  const l = data?.lifetime;
  if (!l) return '';
  const missing = l.gaps.map(g => `${g.services.join(', ')} in ${monthName(g.month + '-01')}`).join('; ');
  return `Lifetime since ${monthName(l.since + '-01')}: ${money(l.total)} through ${l.through}${l.total !== null && missing ? ` · known part only (missing ${missing})` : ''}`;
}

// The status line: coverage, then the budget. over = the day's known spend is above the warning budget.
export function coverageText(data) {
  return data.incomplete.length ? `Incomplete: ${data.incomplete.join(', ')}, so totals include only what is known` : 'Every service is covered';
}
// The warning budget is per day, so it is compared only in Day.
export function budgetText(data, period = 'day') {
  if (period !== 'day') return { text: '', over: false };
  if (data.budget === null) return { text: 'No daily warning budget set', over: false };
  const today = data.totals.today, over = today !== null && today > data.budget;
  return { over, text: `Daily warning budget ${money(data.budget)}: ${over ? 'over budget' : data.incomplete.length ? 'coverage incomplete, actual costs may exceed it' : 'within budget'}` };
}

// How a service's dollars are known: billed (provider's own report), estimate (Jules' metered calls at
// list prices), manual (entered here), or not recorded.
export const basisLabel = basis => basis === 'unknown' ? 'Not recorded' : basis.split('+').map(b => b[0].toUpperCase() + b.slice(1)).join(' + ');
const badgeClass = row => !row.complete ? 'warn' : row.basis === 'billed' ? 'ok' : '';

// The amount columns for the period: [field, heading]. A finished month needs no projection.
export function serviceColumns(period, data) {
  if (period === 'day') return [['today', 'Day']];
  return data && fullMonth(data.date) ? [['month', 'Month']] : [['month', 'Month to date'], ['projected', 'Projected month end (calculated)']];
}
export const featureColumn = (period, data) => period === 'day' ? ['today', 'Day'] : ['month', data && fullMonth(data.date) ? 'Month' : 'Month to date'];

// By service: one row per service with the day, month to date, projection, basis and last update.
export const serviceRow = row => ({
  id: row.id, name: row.name, url: row.url, notes: row.notes ?? [],
  today: money(row.today), month: money(row.month), projected: money(row.projected),
  basis: basisLabel(row.basis) + (row.complete ? '' : ' · incomplete'), badge: badgeClass(row), source: row.source, updated: when(row.updated),
});

// By feature and Evals split the metered estimate: owner test runs are not user activity.
export function featureRows(features, evals) {
  return (features?.features ?? []).filter(f => !!f.eval === evals).map(f => ({ label: f.label, aiCalls: String(f.aiCalls), searches: String(f.searches), today: money(f.today), month: money(f.month) + (f.unpriced ? ' + unpriced' : '') }));
}
export function meteredText(data, evals, period = 'month') {
  const f = data?.features;
  if (!f) return data?.featureNotice ?? 'Feature costs are unavailable';
  if (!f.features.length) return 'No metered calls this month';
  const key = period === 'day' ? 'today' : 'month', when = period === 'day' ? 'on this day' : 'this month';
  const total = list => list.reduce((s, x) => s + x[key], 0), evalCost = total(f.features.filter(x => x.eval));
  const lines = [evals ? `${money(evalCost)} estimated from eval test runs ${when}` : `${money(total(f.features) - evalCost)} estimated from people using Jules ${when} · ${money(total(f.features))} including evals`];
  if (!evals) lines.push(f.perSearch ? `searches at ${money(f.perSearch.value)} each (${f.perSearch.basis === 'plan' ? 'SerpApi plan price ÷ monthly searches' : 'SERPAPI_COST_PER_SEARCH setting'})` : 'search costs unknown until SerpApi reports a plan price');
  if (f.unpriced.length) lines.push(`no list price for ${f.unpriced.join(', ')}, so those calls are counted but not priced`);
  return lines.join(' · ');
}

// OpenAI billed vs what Jules recorded, on every view: a gap is spend made outside the meter.
const shortDay = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export function reconcileText(data) {
  const r = data?.reconciliation;
  if (!r || r.status === 'not_connected') return { text: 'OpenAI billing not connected, so spend Jules didn’t record can’t be checked', over: false };
  if (r.status === 'unavailable') return { text: 'Jules’ recorded calls are unavailable, so OpenAI billing can’t be checked against them', over: false };
  if (r.status === 'waiting') return { text: 'OpenAI hasn’t finished reporting any day this month yet, so billed vs recorded can’t be checked', over: false };
  const through = `through ${shortDay(r.through)} (UTC)`, scope = r.scope === 'organization' ? ' · billing covers the whole OpenAI organization, so other apps on it count too' : '';
  const unpriced = r.unpriced.length ? ` · calls to ${r.unpriced.join(', ')} have no list price, so part of the gap may be those` : '';
  if (r.status === 'matched') return { text: `OpenAI billed ${money(r.billed)} ${through}; Jules recorded ${money(r.recorded)}, so nothing is going unrecorded`, over: false };
  if (r.status === 'unrecorded') return { text: `OpenAI billed ${money(r.gap)} that Jules didn’t record ${through} (${money(r.billed)} billed, ${money(r.recorded)} recorded): some calls are made outside the cost meter${scope}${unpriced}`, over: true };
  return { text: `Jules recorded ${money(-r.gap)} more than OpenAI billed ${through} (${money(r.recorded)} recorded, ${money(r.billed)} billed): list prices in lib/usage.js may be out of date`, over: false };
}

// Recurring jobs: one row per scheduled job with its runs, metered cost, budget and what needs attention.
const STATUS = { over: ['Over', 'warn'], warn: ['Check', 'warn'], ok: ['OK', 'ok'] };
export const jobColumns = (period, data) => period === 'day' ? [['today', 'Day']] : data && fullMonth(data.date) ? [['month', 'Month']] : [['month', 'Month to date'], ['projected', 'Projected month end (calculated)']];
export function jobRows(jobs) {
  return (jobs?.rows ?? []).map(j => ({
    name: j.name, when: j.when, spends: j.spends, where: j.scheduler === 'vercel' ? 'Vercel cron' : j.scheduler === 'supabase' ? 'Supabase scheduler' : 'Unknown scheduler',
    today: money(j.today), month: money(j.month), projected: money(j.projected), budget: j.budget === null ? 'None' : money(j.budget),
    // Supabase jobs check every minute and call Vercel only when there is work: show both counts.
    runs: [j.runs === null ? (j.ticks === null ? 'Unknown' : '') : `${j.runs}${j.failed ? ` (${j.failed} failed)` : ''}`, j.ticks === null ? '' : `${j.ticks.toLocaleString('en-US')} checks`].filter(Boolean).join(' · '), usage: `${j.calls} AI · ${j.searches} searches`,
    lastRun: j.lastRun ? when(j.lastRun) : 'None recorded', status: STATUS[j.status][0], badge: STATUS[j.status][1], flags: j.flags.map(f => f.text),
  }));
}
// The status line on every view, so a job running over budget is never hidden behind another tab.
export function jobsAlert(data) {
  const j = data?.jobs;
  if (!j) return { text: '', over: false };
  if (j.over.length) return { text: `Recurring jobs over budget or untracked: ${j.over.join(', ')}`, over: true };
  return { text: j.attention.length ? `Recurring jobs to check: ${j.attention.join(', ')}` : '', over: false };
}
export function jobsText(data, period = 'month') {
  const j = data?.jobs;
  if (!j) return 'Recurring job costs are unavailable';
  const key = period === 'day' ? 'today' : 'month', count = j.rows.filter(r => !r.unregistered).length;
  return [`${count} recurring jobs`, `${money(j.totals[key])} metered ${period === 'day' ? 'on this day' : 'this month'}`, period === 'day' ? '' : `projected ${money(j.totals.projected)}`, data.jobsNotice ?? ''].filter(Boolean).join(' · ');
}

// The amount form saves usage for the chosen day; subscriptions and the budget apply to that day's month.
export function entryBody({ kind, service, date, amount, note }) {
  // A job budget's service is the job ('job:<id>'), chosen from the same list.
  return { service: kind === 'budget' ? 'openai' : service, kind, date: kind === 'usage' ? date : `${date.slice(0, 7)}-01`, amount: Number(amount), note };
}

// Spending caps (lib/cost-caps.js, COST-CAPS.md): the status line and the By person rows. Spend is the metered
// estimate for today and this month (UTC), whatever date is picked; caps are off until set in Vercel.
const capOf = (spent, limit) => limit === null || limit === undefined ? `${money(spent)}` : `${money(spent)} of ${money(limit)}`;
export function capsText(data) {
  const s = data?.spending;
  if (!s) return { text: data ? 'Spending caps: spend per person is unavailable. If db/036_cost_caps.sql has not been run in Supabase, run it.' : '', over: false };
  if (!s.on) return { text: 'Spending caps are off.', over: false };
  const g = s.global, parts = [];
  if (g.limits.day !== null) parts.push(`today ${capOf(g.day, g.limits.day)}`);
  if (g.limits.month !== null) parts.push(`this month ${capOf(g.month, g.limits.month)}`);
  const capped = s.people.filter(p => p.capped).length;
  return { text: [g.capped ? `Global cap reached: Jules is paused for everyone until ${resetLabel(g.capped.resets_at)}` : parts.length ? `Global cap: ${parts.join(', ')}` : '',
    capped ? `${capped} ${capped === 1 ? 'person is' : 'people are'} at their cap` : ''].filter(Boolean).join(' · ') + '.', over: Boolean(g.capped || capped) };
}
const resetLabel = at => new Date(at).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' UTC';
export function personRows(spending) {
  return (spending?.people ?? []).map(p => ({ id: p.conversation_id, name: p.name ?? p.sender_id ?? 'Unknown person', sub: p.name ? p.sender_id ?? '' : '',
    today: capOf(p.today, p.limits.day), month: capOf(p.month, p.limits.month),
    ...(p.capped ? { status: `Capped until ${resetLabel(p.capped.resets_at)}`, badge: 'fail' }
      : p.limits.day === null && p.limits.month === null ? { status: 'No cap', badge: 'plain' }
      : Math.max(p.limits.day ? p.today / p.limits.day : 0, p.limits.month ? p.month / p.limits.month : 0) >= 0.8 ? { status: 'Near cap', badge: 'warn' } : { status: 'Under cap', badge: 'ok' }) }));
}
