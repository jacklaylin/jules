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
  },
  web_search_call: 0.025, // per call (USD 25 per 1,000)
  serpapi_search: 0.015,  // per search; plan-dependent, override with SERPAPI_COST_PER_SEARCH
};
const meter = new AsyncLocalStorage();
let installed = false;

export function priceFor(event, env = {}) {
  if (event.provider === 'serpapi') return event.units * (Number(env.SERPAPI_COST_PER_SEARCH) || PRICES.serpapi_search);
  const model = Object.keys(PRICES.openai).filter(m => event.model?.startsWith(m)).sort((a, b) => b.length - a.length)[0];
  const rate = PRICES.openai[model];
  const tokens = rate ? ((event.input_tokens - event.cached_tokens) * rate.input + event.cached_tokens * rate.cached + event.output_tokens * rate.output) / 1e6 : 0;
  return tokens + event.web_search_calls * PRICES.web_search_call;
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
export async function withUsage({ store, env = {}, conversation, operation, feature }, work) {
  installUsageMeter();
  const state = { events: [], pending: [], action: null };
  try { return await meter.run(state, work); }
  finally {
    await Promise.allSettled(state.pending);
    if (state.events.length && store?.recordUsage) {
      const rows = state.events.map(e => ({ conversation_id: conversation, operation, feature, action: state.action, ...e, cost_usd: Number(priceFor(e, env).toFixed(6)) }));
      try { await store.recordUsage(rows); }
      catch { console.log(JSON.stringify({ event: 'usage_record_failed', operation, calls: rows.length })); }
      console.log(JSON.stringify({ event: 'usage_recorded', feature, action: state.action, calls: rows.length, cost_usd: Number(rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)) }));
    }
  }
}
// The agent labels the action once it has chosen a tool (e.g. find_products).
export function labelUsage(action) { const state = meter.getStore(); if (state && !state.action) state.action = action; }
