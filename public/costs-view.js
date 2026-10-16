// Admin › Costs data view: the words and rows the page shows for one /api/costs report (day, month to
// date, projected month end per service). Pure functions so the wording (billed, estimated, manual or
// unknown) is testable without a browser.

export const VIEWS = [['', 'By service'], ['features', 'By feature'], ['evals', 'Evals']];
export const viewOf = search => { const view = new URLSearchParams(search).get('view') ?? ''; return VIEWS.some(([v]) => v === view) ? view : ''; };

export const money = value => value === null || value === undefined ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2 }).format(value);
const when = at => { const d = new Date(at); return at && Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'; };

// Beside the title: month to date as the headline, then the day and the projection. Unknown is never $0.
export function totalLine(data) {
  if (!data) return { amount: '—', label: '' };
  const { today, month, projected } = data.totals;
  const partial = data.incomplete.length ? ' · known part only' : '';
  return { amount: money(month), label: `month to date through ${data.date} (UTC) · day ${money(today)} · projected month end ${money(projected)}${month === null ? '' : partial}` };
}

// The status line: coverage, then the budget. over = the day's known spend is above the warning budget.
export function coverageText(data) {
  return data.incomplete.length ? `Incomplete: ${data.incomplete.join(', ')}, so totals include only what is known` : 'Every service is covered';
}
export function budgetText(data) {
  if (data.budget === null) return { text: 'No daily warning budget set', over: false };
  const today = data.totals.today, over = today !== null && today > data.budget;
  return { over, text: `Daily warning budget ${money(data.budget)}: ${over ? 'over budget' : data.incomplete.length ? 'coverage incomplete, actual costs may exceed it' : 'within budget'}` };
}

// How a service's dollars are known: billed (provider's own report), estimate (Jules' metered calls at
// list prices), manual (entered here), or not recorded.
export const basisLabel = basis => basis === 'unknown' ? 'Not recorded' : basis.split('+').map(b => b[0].toUpperCase() + b.slice(1)).join(' + ');
const badgeClass = row => !row.complete ? 'warn' : row.basis === 'billed' ? 'ok' : '';

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
export function meteredText(data, evals) {
  const f = data?.features;
  if (!f) return data?.featureNotice ?? 'Feature costs are unavailable';
  if (!f.features.length) return 'No metered calls this month';
  const lines = [evals ? `${money(f.evalsMonth)} estimated from eval test runs this month` : `${money(f.month - f.evalsMonth)} estimated from people using Jules this month · ${money(f.month)} including evals`];
  if (!evals) lines.push(f.perSearch ? `searches at ${money(f.perSearch.value)} each (${f.perSearch.basis === 'plan' ? 'SerpApi plan price ÷ monthly searches' : 'SERPAPI_COST_PER_SEARCH setting'})` : 'search costs unknown until SerpApi reports a plan price');
  if (f.unpriced.length) lines.push(`no list price for ${f.unpriced.join(', ')}, so those calls are counted but not priced`);
  return lines.join(' · ');
}

// The amount form saves usage for the chosen day; subscriptions and the budget apply to that day's month.
export function entryBody({ kind, service, date, amount, note }) {
  return { service: kind === 'budget' ? 'openai' : service, kind, date: kind === 'usage' ? date : `${date.slice(0, 7)}-01`, amount: Number(amount), note };
}
