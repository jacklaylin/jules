import { openaiCost, PRICES } from './usage.js';

// Spending caps (COST-CAPS.md). A per-person ceiling and a global ceiling, each per UTC day and per UTC
// month, all off unless set in the environment. Spend is the metered estimate in usage_events, priced
// from token and search counts at today's list prices (so a model priced late still counts).
// Caps are checked before work starts, so one turn can run slightly past a ceiling; the next one stops.

const amount = value => { const n = Number(value); return value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };
export function capSettings(env = {}) {
  return {
    user: { day: amount(env.COST_CAP_USER_DAILY_USD), month: amount(env.COST_CAP_USER_MONTHLY_USD) },
    global: { day: amount(env.COST_CAP_GLOBAL_DAILY_USD), month: amount(env.COST_CAP_GLOBAL_MONTHLY_USD) },
  };
}
export const capsOn = settings => [settings.user.day, settings.user.month, settings.global.day, settings.global.month].some(v => v !== null);

// Everyone is on the free plan today. A paid plan (Jules+) would return its own limits here, or none,
// once a person's plan is stored; nothing else in the cap logic changes.
export const planFor = () => 'free';
export const limitsFor = (plan, settings) => plan === 'free' ? settings.user : { day: null, month: null };

export const perSearch = env => Number(env.SERPAPI_COST_PER_SEARCH) > 0 ? Number(env.SERPAPI_COST_PER_SEARCH) : PRICES.serpapi_search;
// One summed row of usage (a view row) in dollars. Rows from the older per-user view carry only cost_usd.
export function rowCost(row, env = {}) {
  if (row.provider === 'serpapi') return Number(row.units ?? row.calls ?? 0) * perSearch(env);
  if (row.provider === 'openai') return openaiCost(row) ?? Number(row.cost_usd ?? 0);
  return Number(row.cost_usd ?? 0);
}
export function spendFrom(rows, today, env = {}) {
  let day = 0, month = 0;
  for (const row of rows ?? []) { const cost = rowCost(row, env); month += cost; if (String(row.day).slice(0, 10) === today) day += cost; }
  return { day, month };
}

const DAY = 86400000;
export function resetsAt(period, now = new Date()) {
  if (period === 'day') return new Date(Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z') + DAY);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// The first ceiling reached, global before personal and month before day (the later reset wins).
// user/global: {day, month} spend, or null when not read.
export function capState({ user = null, global = null, settings, plan = 'free', now = new Date() }) {
  const limits = { user: limitsFor(plan, settings), global: settings.global };
  for (const [scope, period] of [['global', 'month'], ['global', 'day'], ['user', 'month'], ['user', 'day']]) {
    const limit = limits[scope][period], spend = scope === 'user' ? user : global;
    if (limit !== null && spend && spend[period] >= limit) return { capped: true, scope, period, spent: spend[period], limit, resets_at: resetsAt(period, now).toISOString(), user, global };
  }
  return { capped: false, user, global };
}

// What Jules texts instead of working, written by code so it costs nothing and never claims results.
// The person's message stays in the conversation, so their next message picks it up.
export function capNotice(state, now = new Date()) {
  const resets = new Date(state.resets_at);
  const hours = Math.ceil((resets - now) / 3600000);
  const when = state.period === 'month' ? `on ${resets.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).toLowerCase()}`
    : hours <= 1 ? 'in about an hour' : `in about ${hours} hours`;
  const opening = state.scope === 'global' ? 'i’m at capacity right now, so i can’t work on this yet.'
    : `i’ve hit my limit for ${state.period === 'day' ? 'today' : 'this month'}, so i can’t work on this right now.`;
  return `${opening} your message is saved here, so nothing is lost. text me again ${when} and i’ll pick it up from there.`;
}
// A capped person hears the notice at most this often; other messages in between get no reply.
export const NOTICE_EVERY_MS = 3 * 3600000;

// Web handlers that show error.message for errors with a status (the style page) show this plain text.
export class CostCapReached extends Error {
  constructor(state) {
    super(`Jules has reached its ${state.scope === 'global' ? 'overall' : 'personal'} spending limit for ${state.period === 'day' ? 'today' : 'this month'}, so this can’t run right now. Nothing you saved is lost; try again after ${new Date(state.resets_at).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} UTC.`);
    this.code = 'cost_cap'; this.status = 429; this.state = state;
  }
}

// Short-lived cache so metered actions inside one turn don't each re-read spend.
const CACHE_MS = 30000;
const cache = new Map();
async function cached(key, fresh, read, now) {
  const hit = cache.get(key);
  if (!fresh && hit && now - hit.at < CACHE_MS) return hit.value;
  const value = await read();
  cache.set(key, { at: now, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}
export const clearCapCache = () => cache.clear();

// Current cap state for one person (conversation null: only the global cap). Off when no cap is set.
// If spend can't be read the work goes ahead (a database problem must not silence Jules) and it is logged.
export async function checkCaps(store, conversation, env = {}, { now = new Date(), fresh = false } = {}) {
  const settings = capSettings(env);
  if (!capsOn(settings)) return { capped: false, off: true };
  const today = now.toISOString().slice(0, 10), month = today.slice(0, 8) + '01', at = now.getTime();
  const plan = planFor(conversation), limits = limitsFor(plan, settings);
  const needUser = Boolean(conversation) && (limits.day !== null || limits.month !== null);
  const needGlobal = settings.global.day !== null || settings.global.month !== null;
  try {
    const [user, global] = await Promise.all([
      needUser ? cached(`user:${conversation}:${today}`, fresh, async () => spendFrom(await store.userSpend(conversation, month), today, env), at) : null,
      needGlobal ? cached(`global:${today}`, fresh, async () => spendFrom(await store.globalSpend(month), today, env), at) : null,
    ]);
    return capState({ user, global, settings, plan, now });
  } catch (error) {
    console.log(JSON.stringify({ event: 'cost_cap_check_failed', status: error?.database_status ?? null }));
    return { capped: false, unknown: true };
  }
}

export function logCapReached(state, where) {
  console.log(JSON.stringify({ event: 'cost_cap_reached', where, scope: state.scope, period: state.period, spent_usd: Number(state.spent.toFixed(4)), limit_usd: state.limit }));
}

// For withUsage: stops a person's metered work before it starts once a ceiling is reached.
export async function enforceCaps({ store, env, conversation, operation }) {
  if (!conversation || !store?.userSpend || !capsOn(capSettings(env))) return;
  const state = await checkCaps(store, conversation, env);
  if (!state.capped) return;
  logCapReached(state, String(operation ?? '').split(':')[0] || 'unknown');
  throw new CostCapReached(state);
}

// Admin view: each person's spend today and this month against their limits, plus the global total.
export async function spendingReport(store, env = {}, { now = new Date() } = {}) {
  const settings = capSettings(env), today = now.toISOString().slice(0, 10), month = today.slice(0, 8) + '01';
  const [rows, globalRows] = await Promise.all([store.spendByUser(month), store.globalSpend(month)]);
  const byPerson = new Map();
  for (const row of rows) { if (!row.conversation_id) continue; const list = byPerson.get(row.conversation_id) ?? []; list.push(row); byPerson.set(row.conversation_id, list); }
  const global = spendFrom(globalRows, today, env);
  const people = [...byPerson].map(([id, list]) => {
    const spend = spendFrom(list, today, env), plan = planFor(id), state = capState({ user: spend, global, settings, plan, now });
    return { conversation_id: id, plan, today: spend.day, month: spend.month, limits: limitsFor(plan, settings),
      capped: state.capped && state.scope === 'user' ? { period: state.period, resets_at: state.resets_at } : null };
  }).sort((a, b) => b.month - a.month);
  const globalState = capState({ global, settings, now });
  return { on: capsOn(settings), settings, per_search: perSearch(env), today, global: { ...global, limits: settings.global,
    capped: globalState.capped ? { period: globalState.period, resets_at: globalState.resets_at } : null }, people };
}
