import { openaiCost } from './usage.js';
import { buildJobs, jobIds } from './jobs.js';
export const services = [
  ['openai', 'OpenAI API', 'https://platform.openai.com/usage'],
  ['photon', 'Photon', 'https://app.photon.codes/'],
  ['serpapi', 'SerpApi', 'https://serpapi.com/dashboard'],
  ['vercel', 'Vercel', 'https://vercel.com/dashboard'],
  ['supabase', 'Supabase', 'https://supabase.com/dashboard'],
  ['github', 'GitHub', 'https://github.com/settings/billing'],
  ['codex', 'ChatGPT / Codex', 'https://chatgpt.com/'],
].map(([id, name, url]) => ({ id, name, url }));
// Listed only in a month with metered OpenRouter calls (a model role set to openrouter:, lib/models.js).
// Its dollars come only from the meter, so it takes no manual amounts (metered_only).
const OPENROUTER = { id:'openrouter', name:'OpenRouter', url:'https://openrouter.ai/activity', metered_only:true };
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
}
export function validateEntry(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('Invalid cost entry'), {status:400});
  // A job budget is per recurring job (service 'job:<id>'); everything else is per service.
  const service = input.kind === 'job_budget' ? jobIds.some(id => input.service === 'job:'+id) : services.some(s => s.id === input.service);
  if (!service || !['usage','subscription','budget','job_budget'].includes(input.kind) || !validDate(input.date) || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0 || input.amount > 1000000 || (input.kind !== 'usage' && !input.date.endsWith('-01')) || typeof input.note !== 'string' || input.note.length > 300) throw Object.assign(new Error('Invalid cost entry'), {status:400});
  return {service:input.service, kind:input.kind, date:input.date, amount:Math.round(input.amount * 1000000) / 1000000, note:input.note};
}
// How each service's dollars are known. billed = the provider's own report; estimate = Jules' metered
// calls at list prices; manual = typed into the ledger here.
const SOURCES = {
  openai:'OpenAI Costs API, with Jules-metered estimates for days OpenAI has not reported yet',
  photon:'Manual ledger', serpapi:'SerpApi Account API (plan price)', vercel:'Vercel billing API',
  supabase:'Manual ledger', github:'GitHub billing API for metered charges; plan fee manual', codex:'Manual ledger',
};
// OpenAI reports a day's costs late; a billed $0 on these recent days is treated as "not reported yet".
const REPORTING_LAG_DAYS = 2;
// Billed minus recorded beyond this (and beyond this share of billed) means spend Jules did not record,
// or list prices that are off. Smaller gaps are rounding and pricing details (e.g. cached-token rates).
const GAP_MIN_USD = 0.25, GAP_SHARE = 0.10;

// OpenAI's billed dollars against Jules' own recorded calls, over the days OpenAI has finished
// reporting. A positive gap is spend some code path made outside the meter (lib/usage.js withUsage).
export function reconcileOpenAI({days, provider, estimate, recent, unpriced = []}) {
  if (provider?.status !== 'connected') return {status:'not_connected'};
  if (!estimate) return {status:'unavailable'};
  const settled = days.filter(d => provider.days[d] !== undefined && !recent(d));
  if (!settled.length) return {status:'waiting'};
  const billed = sum(settled.map(d => provider.days[d])), recorded = sum(settled.map(d => estimate[d] ?? 0)), gap = billed - recorded;
  const limit = Math.max(GAP_MIN_USD, GAP_SHARE * billed);
  return {status: gap > limit ? 'unrecorded' : gap < -limit ? 'overestimated' : 'matched', billed, recorded, gap, through:settled.at(-1), days:settled.length,
    scope:provider.scope, unpriced};
}
const FEATURES = {chat:'Chat replies',gmail_import:'Gmail import',gmail_refresh:'Daily purchase check',shop_history:'Shop import',style_reading:'Style reading',style_report:'Style report',purchase_tags:'Purchase tagging',wardrobe_photo_tags:'Wardrobe photo reading',price_alerts:'Price alerts',unattributed:'Not attributed (calls outside the meter)',eval_agent:'Evals · agent routing (test runs)',eval_replay:'Evals · reply replays (test runs)'};
const DAY = 86400000;
const dayList = (date) => { const out=[]; for (let t=Date.parse(date.slice(0,7)+'-01T00:00:00Z'); t<=Date.parse(date+'T00:00:00Z'); t+=DAY) out.push(new Date(t).toISOString().slice(0,10)); return out; };
const monthName = date => new Date(date.slice(0,7)+'-01T00:00:00Z').toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});
// A monthly fee or budget applies from the month it was entered until a later month's entry replaces it.
const recurring = (entries, kind, month) => entries.filter(e => e.kind===kind && e.date<=month).sort((a,b) => b.date.localeCompare(a.date))[0] ?? null;
const sum = values => values.reduce((s,v) => s + v, 0);
const money = n => `$${n.toFixed(2)}`;
const latest = values => values.filter(Boolean).sort().at(-1) ?? null;

// Prices metered calls for the month: OpenAI from token counts at list price (unknown models stay
// unpriced), SerpApi searches as a share of the plan price when SerpApi reports one.
export function priceMetered(rows, serpapi, env = {}) {
  const perSearch = serpapi?.status==='connected' && serpapi.monthlyPrice!==null && serpapi.allowance>0 ? {value:serpapi.monthlyPrice/serpapi.allowance, basis:'plan'}
    : Number(env.SERPAPI_COST_PER_SEARCH) > 0 ? {value:Number(env.SERPAPI_COST_PER_SEARCH), basis:'setting'} : null;
  const unpriced = new Set();
  const priced = rows.map(r => {
    const day = String(r.day).slice(0,10);
    if (r.provider === 'serpapi') { const searches = Number(r.units ?? r.calls); return {day, feature:r.feature, provider:'serpapi', calls:searches, cost:perSearch ? searches*perSearch.value : null, last:r.last_at ?? null}; }
    // OpenRouter calls are kept apart from OpenAI's bill. One with no list price here is costed at the
    // dollars recorded for it, which come from OpenRouter's own per-call report.
    const openrouter = r.provider === 'openrouter';
    const cost = openaiCost(r) ?? (openrouter && r.cost_usd != null ? Number(r.cost_usd) : null);
    if (cost === null) unpriced.add(r.model ?? 'unknown model');
    return {day, feature:r.feature, provider:openrouter ? 'openrouter' : 'openai', calls:Number(r.calls), cost, last:r.last_at ?? null};
  });
  return {rows:priced, perSearch, unpriced:[...unpriced]};
}

// Feature breakdown for the selected day and the month so far. Unpriced calls are counted, not valued.
export function featureCosts(date, priced) {
  const by = new Map();
  for (const r of priced) {
    const f = by.get(r.feature) ?? {feature:r.feature, label:FEATURES[r.feature] ?? r.feature, eval:r.feature.startsWith('eval_'), aiCalls:0, searches:0, today:0, month:0, unpriced:false};
    if (r.provider === 'serpapi') f.searches += r.calls; else f.aiCalls += r.calls;
    if (r.cost === null) f.unpriced = true;
    else { f.month += r.cost; if (r.day === date) f.today += r.cost; }
    by.set(r.feature, f);
  }
  const features = [...by.values()].sort((a,b) => b.month - a.month);
  return {features, today:sum(features.map(f=>f.today)), month:sum(features.map(f=>f.month)), evalsMonth:sum(features.filter(f=>f.eval).map(f=>f.month))};
}

// One service's figures. usage: {day: {amount, basis}} for known days; fixed: per-day fee shares
// (or a monthly fee) with its basis. Projection = fees for the whole month + average daily usage.
function serviceFigures({date, days, usage, usageComplete, fixed}) {
  const elapsed = days.length, inMonth = new Date(Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)), 0)).getUTCDate();
  const known = days.filter(d => usage[d]);
  const usageMonth = sum(known.map(d => usage[d].amount));
  const avg = known.length ? usageMonth / (usageComplete ? elapsed : known.length) : null;
  let fixedToday = null, fixedMonth = null, fixedProjected = null;
  if (fixed?.monthly !== undefined) { fixedToday = fixed.monthly/inMonth; fixedMonth = fixed.monthly*elapsed/inMonth; fixedProjected = fixed.monthly; }
  else if (fixed?.byDay) { fixedToday = fixed.byDay[date] ?? 0; fixedMonth = sum(days.map(d => fixed.byDay[d] ?? 0)); fixedProjected = fixedMonth + fixedToday*(inMonth-elapsed); }
  const add = (a,b) => a===null && b===null ? null : (a??0)+(b??0);
  const bases = new Set([...known.map(d => usage[d].basis), ...(fixed ? [fixed.basis] : [])]);
  return {
    today: add(usage[date]?.amount ?? null, fixedToday),
    month: add(known.length ? usageMonth : null, fixedMonth),
    projected: add(avg===null ? null : avg*inMonth, fixedProjected),
    basis: bases.size ? [...bases].sort((a,b) => ['billed','manual','estimate'].indexOf(a)-['billed','manual','estimate'].indexOf(b)).join('+') : 'unknown',
    daysKnown: known.length, elapsed, inMonth,
  };
}

// The whole dashboard: per service today / month to date / projected month end, how each number is
// known and when it was last updated, plus the feature breakdown. Unknown stays null, never $0.
// jobUsage / jobRuns / scheduled: usage_by_day_job, job_runs_by_day and the scheduled_jobs() list (null
// when unreadable, e.g. before db/034_recurring_jobs.sql) for the Recurring jobs view.
export function buildReport({date, entries, providers, metered, jobUsage = null, jobRuns = null, scheduled = null, env = {}, now = new Date()}) {
  const days = dayList(date), month = date.slice(0,7)+'-01';
  const priced = metered ? priceMetered(metered, providers.serpapi, env) : null;
  const estimateByDay = provider => { const out = {}; for (const r of priced?.rows ?? []) if (r.provider===provider && r.cost!==null) out[r.day] = (out[r.day] ?? 0) + r.cost; return out; };
  const lastMetered = provider => latest((priced?.rows ?? []).filter(r => r.provider===provider).map(r => r.last));
  const recent = d => (Date.parse(now.toISOString().slice(0,10)) - Date.parse(d)) / DAY < REPORTING_LAG_DAYS;
  let reconciliation = {status:'not_connected'};
  const rows = [...services, ...(priced?.rows.some(r => r.provider === 'openrouter') ? [OPENROUTER] : [])].map(service => {
    const mine = entries.filter(e => e.service === service.id);
    const manualUsage = Object.fromEntries(mine.filter(e => e.kind==='usage' && days.includes(e.date)).map(e => [e.date, {amount:Number(e.amount), basis:'manual'}]));
    const fee = recurring(mine, 'subscription', month);
    const manualFee = fee ? {monthly:Number(fee.amount), basis:'manual'} : null;
    const provider = providers[service.id];
    const notes = [];
    let usage = manualUsage, usageComplete = false, fixed = manualFee, updated = latest(mine.map(e => e.updated_at)), source = 'Manual ledger';
    // A failed or missing billing connection says why and what to set.
    if (provider?.status === 'error' || provider?.status === 'not_connected') notes.push(provider.message);
    if (service.id === 'openai') {
      const estimate = estimateByDay('openai');
      usage = {};
      for (const d of days) {
        const billed = provider?.status==='connected' ? provider.days[d] : undefined;
        if (billed !== undefined && !(recent(d) && billed === 0 && estimate[d] > 0)) usage[d] = {amount:billed, basis:'billed'};
        else if (manualUsage[d]) usage[d] = manualUsage[d];
        else if (estimate[d] !== undefined) usage[d] = {amount:estimate[d], basis:'estimate'};
      }
      usageComplete = provider?.status === 'connected';
      if (provider?.status === 'connected') { source = SOURCES.openai; updated = provider.checkedAt; notes.push(provider.message); if (provider.otherProjects > 0) notes.push(`Other OpenAI projects this month (not counted): $${provider.otherProjects.toFixed(2)}.`); }
      else { source = 'Jules-metered estimate at list prices (OpenAI billing not connected)'; updated = latest([updated, lastMetered('openai')]); }
      if (priced?.unpriced.length) notes.push(`No list price for ${priced.unpriced.join(', ')}; those calls are left out of estimates.`);
      reconciliation = reconcileOpenAI({days, provider, estimate:priced && estimate, recent, unpriced:priced?.unpriced ?? []});
      if (reconciliation.days) notes.push(`Billed ${money(reconciliation.billed)} vs ${money(reconciliation.recorded)} recorded by Jules through ${reconciliation.through} (${reconciliation.status === 'matched' ? 'they match' : `${money(Math.abs(reconciliation.gap))} ${reconciliation.gap > 0 ? 'not recorded by Jules' : 'more recorded than billed'}`}).`);
    } else if (service.id === 'serpapi' && provider?.status === 'connected') {
      source = SOURCES.serpapi; updated = provider.checkedAt;
      if (provider.monthlyPrice !== null) { fixed = {monthly:provider.monthlyPrice, basis:'billed'}; usage = {}; usageComplete = true; if (manualFee) notes.push('Manual monthly fee ignored; SerpApi reports the plan price.'); }
      notes.push(`${provider.planName ?? 'Plan'}: ${provider.used} of ${provider.allowance} searches used, ${provider.remaining} left${provider.renewalDate ? `, renews ${provider.renewalDate}` : ''}.`);
      if (provider.monthlyPrice === null) notes.push(provider.message);
    } else if (service.id === 'vercel' && provider?.status === 'connected') {
      source = SOURCES.vercel; updated = provider.checkedAt; usageComplete = true; notes.push(provider.message);
      usage = Object.fromEntries(days.map(d => [d, {amount:provider.days[d] ?? 0, basis:'billed'}]));
      if (provider.fixed.length) { fixed = {byDay:provider.fixedDays, basis:'billed'}; if (manualFee) notes.push('Manual monthly fee ignored; Vercel reports the plan fee.'); }
      else if (!manualFee) notes.push('Vercel reported no plan or seat fee this month. If you pay one, enter it once as a monthly subscription; it carries forward each month.');
      if (provider.otherProjects) notes.push(`Other Vercel projects this month (not counted): $${provider.otherProjects.toFixed(2)}.`);
    } else if (service.id === 'openrouter') {
      const estimate = estimateByDay('openrouter');
      usage = Object.fromEntries(days.filter(d => estimate[d] !== undefined).map(d => [d, {amount:estimate[d], basis:'estimate'}]));
      usageComplete = true; source = 'Jules-metered: list prices, or the cost OpenRouter reported for each call'; updated = latest([updated, lastMetered('openrouter')]);
    } else if (service.id === 'github' && provider?.status === 'connected') {
      source = SOURCES.github; updated = provider.checkedAt;
      usage = {...manualUsage, [date]:{amount:provider.days[date], basis:'billed'}};
    }
    if (fee && fixed === manualFee && fee.date !== month) notes.push(`Monthly fee of $${Number(fee.amount).toFixed(2)} carried forward from ${monthName(fee.date)}. Enter a new amount if it changed (0 if it stopped).`);
    const figures = serviceFigures({date, days, usage, usageComplete, fixed});
    // A manual service is covered once its monthly fee is entered (enter 0 if free); daily usage
    // entries add to it. Without a fee it stays incomplete, never assumed free.
    const complete = usageComplete || !!fixed;
    if (source === 'Manual ledger') notes.push([fixed ? '' : 'No monthly fee entered.', figures.daysKnown ? `Usage entered for ${figures.daysKnown} of ${days.length} days.` : ''].filter(Boolean).join(' '));
    return {...service, ...figures, source, updated, notes:notes.filter(Boolean), complete};
  });
  const total = key => rows.every(r => r[key]===null) ? null : sum(rows.map(r => r[key] ?? 0));
  const features = priced ? featureCosts(date, priced.rows) : null;
  return {date, rows, reconciliation, totals:{today:total('today'), month:total('month'), projected:total('projected')}, incomplete:rows.filter(r => !r.complete).map(r => r.name),
    budget:(b => b ? Number(b.amount) : null)(recurring(entries, 'budget', month)),
    features:features && {...features, perSearch:priced.perSearch, unpriced:priced.unpriced},
    jobs:buildJobs({date, days, priced:jobUsage && priceMetered(jobUsage.map(r => ({...r, feature:r.job})), providers.serpapi, env).rows, runs:jobRuns, scheduled, entries, now})};
}
