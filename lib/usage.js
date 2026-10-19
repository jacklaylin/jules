import { AsyncLocalStorage } from 'node:async_hooks';

// Per-user cost metering. Every outbound call made while handling one user action (a message, an
// import step, a style reading) is attributed to that action, wherever in the code it happens.
// Costs are estimates from list prices below; provider invoices remain the source of truth.
// Prices are USD. Check them against provider pricing pages when they change (last set 2026-10-13).
export const PRICES = {
  openai: { // per 1M tokens
    'gpt-4.1': { input: 2.00, cached: 0.50, output: 8.00 },
    'gpt-4.1-mini': { input: 0.40, cached: 0.10, output: 1.60 },
    'gpt-4.1-nano': { input: 0.10, cached: 0.025, output: 0.40 },
    // Candidates for OPENAI_CHAT_MODEL, so a comparison shows real costs.
    'gpt-5': { input: 1.25, cached: 0.125, output: 10.00 },
    'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.00 },
  },
  web_search_call: 0.025, // per call (USD 25 per 1,000)
  serpapi_search: 0.015,  // per search; plan-dependent, override with SERPAPI_COST_PER_SEARCH
};
const meter = new AsyncLocalStorage();
let installed = false;

// OpenAI list-price cost of a call (or of summed calls to one model). null when the model has no
// price above, so a dashboard can say "unpriced" instead of showing $0.
export function openaiCost(event) {
  // Exact model or a dated snapshot of it (gpt-4.1-mini-2025-04-14); gpt-5.5 is not gpt-5.
  const rate = PRICES.openai[Object.keys(PRICES.openai).find(m => event.model === m || new RegExp(`^${m.replace(/\./g, '\\.')}-\\d{4}-\\d{2}-\\d{2}$`).test(event.model ?? ''))];
  const search = Number(event.web_search_calls ?? 0) * PRICES.web_search_call;
  const tokens = Number(event.input_tokens ?? 0) + Number(event.output_tokens ?? 0);
  if (!rate) return tokens > 0 ? null : search;
  const cached = Number(event.cached_tokens ?? 0);
  return ((Number(event.input_tokens ?? 0) - cached) * rate.input + cached * rate.cached + Number(event.output_tokens ?? 0) * rate.output) / 1e6 + search;
}

export function priceFor(event, env = {}) {
  if (event.provider === 'serpapi') return event.units * (Number(env.SERPAPI_COST_PER_SEARCH) || PRICES.serpapi_search);
  return openaiCost(event) ?? event.web_search_calls * PRICES.web_search_call;
}

async function observe(state, url, response) {
  const { hostname, pathname } = new URL(url);
  if (hostname === 'serpapi.com' && /^\/search/.test(pathname)) {
    state.events.push({ provider: 'serpapi', model: new URL(url).searchParams.get('engine') ?? 'google', units: 1, input_tokens: 0, cached_tokens: 0, output_tokens: 0, web_search_calls: 0 });
  } else if (hostname === 'api.openai.com' && pathname === '/v1/responses' && response.ok) {
    const data = await response.json();
    const usage = data.usage ?? {};
    state.events.push({ provider: 'openai', model: data.model ?? null, units: 1, input_tokens: usage.input_tokens ?? 0,
      cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
      web_search_calls: (data.output ?? []).filter(o => o.type === 'web_search_call').length });
  }
}

// Wraps the global fetch once. Outside a metered action it is a pass-through.
export function installUsageMeter() {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init);
    const state = meter.getStore();
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    // Only billable providers are read; retailer pages and files are never copied.
    if (state && /^https:\/\/(api\.openai\.com|serpapi\.com)\//.test(url)) state.pending.push(observe(state, url, response.clone()).catch(() => {}));
    return response;
  };
}

// Runs one user action under the meter and records what it cost. Recording never fails the action.
// onUsage receives the priced rows even without a store (the eval gate keeps a running total).
// job: the recurring job (lib/jobs.js) this action runs inside; a nested action inherits it, so every
// call a scheduled job causes is counted against that job.
export async function withUsage({ store, env = {}, conversation, operation, feature, job, onUsage, quiet = false }, work) {
  installUsageMeter();
  const state = { events: [], pending: [], action: null, job: job ?? meter.getStore()?.job ?? null };
  try { return await meter.run(state, work); }
  finally {
    await Promise.allSettled(state.pending);
    const rows = state.events.map(e => ({ conversation_id: conversation, operation, feature, action: state.action, ...(state.job ? { job: state.job } : {}), ...e, cost_usd: Number(priceFor(e, env).toFixed(6)) }));
    if (rows.length) onUsage?.(rows);
    if (rows.length && store?.recordUsage) {
      try { await store.recordUsage(rows); }
      catch {
        // Before db/034_recurring_jobs.sql has run there is no job column: keep the cost, lose only the job.
        try { if (!state.job) throw new Error('not a job'); await store.recordUsage(rows.map(({ job: _, ...row }) => row)); console.log(JSON.stringify({ event: 'usage_job_unrecorded', job: state.job, calls: rows.length })); }
        catch { console.log(JSON.stringify({ event: 'usage_record_failed', operation, calls: rows.length })); }
      }
      if (!quiet) console.log(JSON.stringify({ event: 'usage_recorded', feature, action: state.action, calls: rows.length, cost_usd: Number(rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)) }));
    }
  }
}
// The agent labels the action once it has chosen a tool (e.g. find_products).
export function labelUsage(action) { const state = meter.getStore(); if (state && !state.action) state.action = action; }
