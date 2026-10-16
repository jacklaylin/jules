// Admin › Costs data view: the words and rows the page shows for one day's /api/costs report.
// Pure functions so the wording (what is known, unknown or incomplete) is testable without a browser.

export const VIEWS = [['', 'By service'], ['features', 'By feature'], ['evals', 'Evals']];
export const viewOf = search => { const view = new URLSearchParams(search).get('view') ?? ''; return VIEWS.some(([v]) => v === view) ? view : ''; };

export const money = value => value === null || value === undefined ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
const checked = at => new Date(at).toLocaleString();

// Beside the title: the amount and what kind of total it is. Unknown is never shown as $0.
export function totalLine(data) {
  if (!data) return { amount: '—', label: '' };
  if (data.total === null) return { amount: 'Unknown', label: 'costs unknown' };
  return { amount: money(data.total), label: data.missing ? 'known subtotal' : 'recorded' };
}

// The status line: coverage, then the budget. over = recorded spend is above the warning budget.
export function coverageText(data) {
  return data.missing ? `${data.missing} of ${data.rows.length} services have missing usage or subscription amounts, so the total is incomplete` : 'All services have recorded usage and subscription amounts';
}
export function budgetText(data) {
  if (data.budget === null) return { text: 'No daily warning budget set', over: false };
  const over = data.total !== null && data.total > data.budget;
  return { over, text: `Daily warning budget ${money(data.budget)}: ${over ? 'over budget' : data.missing ? 'coverage incomplete, actual costs may exceed it' : 'within budget'}` };
}

// One line per connected billing source, as the providers report it.
export function providerLines(providers = {}) {
  const lines = [], { openai, serpapi } = providers;
  if (openai) lines.push(['OpenAI', `${openai.message}${openai.status === 'connected' ? ` Total reported ${openai.periodStart} through ${openai.periodEnd} (UTC): ${money(openai.periodTotal)}. Checked ${checked(openai.checkedAt)}.` : ''}`]);
  if (serpapi) lines.push(['SerpApi', `${serpapi.message}${serpapi.status === 'connected' ? ` ${serpapi.used} searches used this billing month; ${serpapi.remaining} credits left; allowance ${serpapi.allowance}. Checked ${checked(serpapi.checkedAt)}.` : ''}`]);
  for (const [name, label] of [['github', 'GitHub'], ['vercel', 'Vercel']]) {
    const p = providers[name]; if (!p) continue;
    lines.push([label, `${p.message}${p.status === 'connected' ? ` Reported daily charges: ${money(p.daily)}. ${name === 'vercel' ? `Excluded unallocated team charges: ${money(p.unallocated)}. ` : ''}Checked ${checked(p.checkedAt)}.` : ''}`]);
  }
  return lines;
}

// By service: every column the ledger has.
export const serviceRow = row => ({
  id: row.id, name: row.name, url: row.url, note: row.note ?? '', usage: money(row.usage),
  subscription: row.daily === null ? 'Unknown' : `${money(row.daily)} (${money(row.monthly)}/mo)`,
  total: money(row.total), source: row.source, complete: row.complete,
});

// By feature and Evals split the metered estimate: owner test runs are not user activity.
export function featureRows(metered, evals) {
  return (metered?.features ?? []).filter(f => !!f.eval === evals).map(f => ({ label: f.label, calls: String(f.calls), cost: money(f.cost) }));
}
export function meteredText(metered, evals) {
  if (!metered) return 'Metered usage is unavailable';
  if (!metered.features.length) return 'No metered calls on this day';
  return evals ? `${money(metered.evals)} estimated from eval test runs` : `${money(metered.total - metered.evals)} estimated from people using Jules · ${money(metered.total)} including evals`;
}

// The amount form saves usage for the chosen day; subscriptions and the budget apply to that day's month.
export function entryBody({ kind, service, date, amount, note }) {
  return { service: kind === 'budget' ? 'openai' : service, kind, date: kind === 'usage' ? date : `${date.slice(0, 7)}-01`, amount: Number(amount), note };
}
