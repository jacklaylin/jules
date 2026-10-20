import { AsyncLocalStorage } from 'node:async_hooks';
import { enforceCaps } from './cost-caps.js';
import { routeRequest, OPENAI_RESPONSES } from './models.js';

// Per-user cost metering. Every outbound call made while handling one user action (a message, an
// import step, a style reading) is attributed to that action, wherever in the code it happens.
// Costs are estimates from list prices below; provider invoices remain the source of truth.
// Prices are USD. Check them against provider pricing pages when they change (last set 2026-10-13; gpt-5.5,
// web search and SerpApi corrected 2026-10-19; GPT-5 family and luna models added 2026-10-19 from
// developers.openai.com/api/docs/pricing, Standard tier).
export const PRICES = {
  openai: { // per 1M tokens
    'gpt-4.1': { input: 2.00, cached: 0.50, output: 8.00 },
    'gpt-4.1-mini': { input: 0.40, cached: 0.10, output: 1.60 },
    'gpt-4.1-nano': { input: 0.10, cached: 0.025, output: 0.40 },
    // Candidates for the model roles (lib/models.js), so a comparison shows real costs.
    'gpt-5': { input: 1.25, cached: 0.125, output: 10.00 },
    'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.00 },
    'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.40 },
    'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.50 },
    'gpt-5.4-nano': { input: 0.20, cached: 0.02, output: 1.25 },
    'gpt-5.6-luna': { input: 0.20, cached: 0.02, output: 1.20 },
    'gpt-6-luna': { input: 0.10, cached: 0.01, output: 0.50 },
    // The write role's default (style report, stylist). Standard rate under 272K context (checked 2026-10-19).
    'gpt-5.5': { input: 5.00, cached: 0.50, output: 30.00 },
  },
  // OpenRouter, per 1M tokens, for models a role may point at (openrouter:<id>). A model missing here is
  // priced from the cost OpenRouter reports for the call.
  openrouter: {
    'anthropic/claude-haiku-5.5': { input: 0.10, cached: 0.01, output: 0.50 },
    'google/gemini-3.1-flash-lite': { input: 0.25, cached: 0.025, output: 1.50 },
  },
  // OpenAI web_search tool: USD 10 per 1,000 calls; the search content it reads is billed as input
  // tokens, which usage.input_tokens already counts (developers.openai.com/api/docs/pricing, 2026-10-19).
  web_search_call: 0.010,
  // SerpApi Developer plan (since 2026-10-19): USD 75 for 5,000 searches. Override with SERPAPI_COST_PER_SEARCH on another plan.
  serpapi_search: 0.015,
};
const meter = new AsyncLocalStorage();
let installed = false;

// OpenAI list-price cost of a call (or of summed calls to one model). null when the model has no
// price above, so a dashboard can say "unpriced" instead of showing $0.
export function openaiCost(event) {
  const table = event.provider === 'openrouter' ? PRICES.openrouter : PRICES.openai;
  // Exact model or a dated snapshot of it (gpt-4.1-mini-2025-04-14); gpt-5.5 is not gpt-5.
  const rate = table[Object.keys(table).find(m => event.model === m || new RegExp(`^${m.replace(/\./g, '\\.')}-\\d{4}-\\d{2}-\\d{2}$`).test(event.model ?? ''))];
  const search = Number(event.web_search_calls ?? 0) * PRICES.web_search_call;
  const tokens = Number(event.input_tokens ?? 0) + Number(event.output_tokens ?? 0);
  if (!rate) return tokens > 0 ? null : search;
  const cached = Number(event.cached_tokens ?? 0);
  return ((Number(event.input_tokens ?? 0) - cached) * rate.input + cached * rate.cached + Number(event.output_tokens ?? 0) * rate.output) / 1e6 + search;
}

// A model with no price is never counted as free: it is logged, and costed from the price its provider
// reported or else at the dearest rate above, so a spending cap still holds.
const unpricedLogged = new Set();
const DEAREST = () => Object.values(PRICES.openai).reduce((a, b) => b.output > a.output ? b : a);
export function priceFor(event, env = {}) {
  if (event.provider === 'serpapi') return event.units * (Number(env.SERPAPI_COST_PER_SEARCH) || PRICES.serpapi_search);
  const known = openaiCost(event);
  if (known !== null) return known;
  if (Number.isFinite(event.reported_cost)) return event.reported_cost + event.web_search_calls * PRICES.web_search_call;
  const key = `${event.provider}:${event.model}`;
  if (!unpricedLogged.has(key)) { unpricedLogged.add(key); console.log(JSON.stringify({ event: 'usage_unpriced_model', provider: event.provider, model: event.model ?? null, priced_as: 'dearest_known_rate' })); }
  return openaiCost({ ...event, provider: 'openai', model: Object.keys(PRICES.openai).find(m => PRICES.openai[m] === DEAREST()) });
}

async function observe(state, url, response) {
  const { hostname, pathname } = new URL(url);
  // SerpApi only charges for searches it ran; a refused call (no credits left, rate limit, bad key) is free.
  if (hostname === 'serpapi.com' && /^\/search/.test(pathname) && response.ok) {
    state.events.push({ provider: 'serpapi', model: new URL(url).searchParams.get('engine') ?? 'google', units: 1, input_tokens: 0, cached_tokens: 0, output_tokens: 0, web_search_calls: 0 });
  } else if (((hostname === 'api.openai.com' && pathname === '/v1/responses') || (hostname === 'openrouter.ai' && pathname === '/api/v1/responses')) && response.ok) {
    const data = await response.json();
    const usage = data.usage ?? {};
    state.events.push({ provider: hostname === 'openrouter.ai' ? 'openrouter' : 'openai', model: data.model ?? null, units: 1, input_tokens: usage.input_tokens ?? 0,
      cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
      web_search_calls: (data.output ?? []).filter(o => o.type === 'web_search_call').length,
      ...(Number.isFinite(usage.cost) ? { reported_cost: usage.cost } : {}) });
  }
}

// The file and line that made a call, so an unattributed one can be found and wrapped (lib/foo.js:42).
function callSite(stack = new Error().stack ?? '') {
  for (const line of stack.split('\n').slice(1)) {
    const match = line.match(/\/((?:lib|api|scripts)\/[\w./-]+\.js):(\d+)/);
    if (match && match[1] !== 'lib/usage.js') return `${match[1]}:${match[2]}`;
  }
  return 'unknown';
}

// A billable call made outside any metered action is still recorded, as feature 'unattributed' with
// its call site, so billed spend never goes missing from the dashboard. The store is loaded lazily
// (lib/store.js imports modules that import this one) and only when the database is configured.
let fallbackStore;
async function recordUnattributed(site, state) {
  await Promise.allSettled(state.pending);
  if (!state.events.length) return;
  const env = globalThis.process?.env ?? {};
  try {
    fallbackStore ??= (await import('./store.js')).createStore(env);
    await fallbackStore.recordUsage(state.events.map(({ reported_cost, ...e }) => ({ conversation_id: null, operation: 'unmetered:' + site, feature: 'unattributed', action: null, ...e, cost_usd: Number(priceFor({ ...e, reported_cost }, env).toFixed(6)) })));
    console.log(JSON.stringify({ event: 'usage_unattributed', site, calls: state.events.length }));
  } catch { console.log(JSON.stringify({ event: 'usage_unattributed_unrecorded', site })); }
}
const pendingUnattributed = new Set();
// Lets a short-lived script wait for unattributed rows before it exits; serverless functions use waitUntil.
export const flushUnattributed = () => Promise.allSettled([...pendingUnattributed]);

// Wraps the global fetch once, when this module loads, so code that keeps its own reference to fetch
// (handlers created at startup take fetcher = fetch) still goes through the meter.
export function installUsageMeter() {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    // A role pointed at OpenRouter (lib/models.js) is sent there; the meter below then sees that call.
    if (input === OPENAI_RESPONSES) ({ url: input, init } = routeRequest(input, init, globalThis.process?.env ?? {}));
    const response = await original(input, init);
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    // Only billable providers are read; retailer pages and files are never copied.
    if (!/^https:\/\/(api\.openai\.com|serpapi\.com|openrouter\.ai)\//.test(url)) return response;
    const state = meter.getStore();
    if (state) state.pending.push(observe(state, url, response.clone()).catch(() => {}));
    else {
      const loose = { events: [], pending: [] };
      loose.pending.push(observe(loose, url, response.clone()).catch(() => {}));
      const env = globalThis.process?.env ?? {};
      if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_SERVICE_ROLE_KEY.startsWith('replace-with')) {
        const work = recordUnattributed(callSite(), loose).finally(() => pendingUnattributed.delete(work));
        pendingUnattributed.add(work);
        import('@vercel/functions').then(({ waitUntil }) => waitUntil(work)).catch(() => {});
      }
    }
    return response;
  };
}
installUsageMeter();

// Runs one user action under the meter and records what it cost. Recording never fails the action.
// onUsage receives the priced rows even without a store (the eval gate keeps a running total).
// job: the recurring job (lib/jobs.js) this action runs inside; a nested action inherits it, so every
// call a scheduled job causes is counted against that job.
export async function withUsage({ store, env = {}, conversation, operation, feature, job, onUsage, quiet = false }, work) {
  installUsageMeter();
  // A person over a spending cap (lib/cost-caps.js) starts no new paid work; this throws CostCapReached.
  await enforceCaps({ store, env, conversation, operation });
  const state = { events: [], pending: [], action: null, job: job ?? meter.getStore()?.job ?? null };
  try { return await meter.run(state, work); }
  finally {
    await Promise.allSettled(state.pending);
    const rows = state.events.map(({ reported_cost, ...e }) => ({ conversation_id: conversation, operation, feature, action: state.action, ...(state.job ? { job: state.job } : {}), ...e, cost_usd: Number(priceFor({ ...e, reported_cost }, env).toFixed(6)) }));
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
