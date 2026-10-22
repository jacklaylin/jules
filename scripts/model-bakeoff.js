// Model bake-off: runs the existing eval suites once per candidate model for one role and reports, per
// model, the pass rate (with failures by category), median and p90 latency, and estimated cost per 100
// turns. Nothing is sent to anyone and nothing is saved, alerted or bought; calls are metered as evals.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/model-bakeoff.js chat --models gpt-4.1-mini,gpt-6-luna,gpt-5-nano:minimal
//   node --env-file=.env.local scripts/model-bakeoff.js search --models gpt-4.1,gpt-6-luna,gpt-5.6-luna
// A model may carry a reasoning effort after a colon (gpt-5-nano:minimal). openrouter: ids need
// OPENROUTER_API_KEY. Options: --runs 3, --concurrency 6, --max-cost 25 (USD for the whole bake-off),
// --out <folder> (default ~/.jules/bakeoffs/<role>-<time>; raw results and replies are kept there).
//   chat:   the agent routing evals (tools stubbed) and the replay cases that need no search.
//           Plus every frozen production case (FROZEN-EVALS.md), judged by a fixed model; --no-frozen leaves them out,
//           --judges gpt-5.5,openrouter:anthropic/claude-opus-5.5 judges them twice (a case passes only when both pass it).
//   search: the replay sourcing cases with the chat model fixed, only the web_search model varying.
//           SerpApi is switched off for these runs so the comparison isolates the search model and
//           uses none of the monthly SerpApi searches (production also merges SerpApi results).
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { AGENT_EVAL_CASES, runAgentEval } from '../lib/agent-eval.js';
import { REPLAY_CASES, runReplay } from '../lib/replay.js';
import { PRODUCTION_CAPABILITIES } from '../lib/replay-gate.js';
import { withUsage, priceFor } from '../lib/usage.js';
import { createStore } from '../lib/store.js';
import { ROLES } from '../lib/models.js';
import { casesDir, loadCases, runFrozenCase } from '../lib/frozen-evals.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const role = args[0];
if (!['chat', 'search'].includes(role)) throw Error('First argument must be chat or search');
const models = (option('--models') ?? '').split(',').map(s => s.trim()).filter(Boolean);
if (!models.length) throw Error('--models is required, e.g. --models gpt-4.1-mini,gpt-6-luna');
const runs = Number(option('--runs') ?? 3), concurrency = Number(option('--concurrency') ?? 6), maxCost = Number(option('--max-cost') ?? 25);
const only = option('--cases')?.split(',').map(s => s.trim()).filter(Boolean);
// Outside the repository: the frozen cases' replies are private conversation data.
const out = resolve(option('--out') ?? join(homedir(), '.jules', 'bakeoffs', `${role}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('replace-with')) throw Error('OPENAI_API_KEY is missing; run with --env-file=.env.local');
if (models.some(m => m.startsWith('openrouter:')) && (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY.startsWith('replace-with'))) throw Error('OPENROUTER_API_KEY is missing: create a key at openrouter.ai/settings/keys and add it to .env.local (never to Git)');
await mkdir(out, { recursive: true, mode: 0o700 });

// Which role a request belongs to, from the request itself: the agent loop offers function tools, the
// composer writes jules_reply, and the search step uses web_search.
const roleOf = body => body.tools?.some(t => t.type === 'web_search') ? 'search' : body.tools?.some(t => t.type === 'function') || body.text?.format?.name === 'jules_reply' ? 'chat' : 'extract';
const run = new AsyncLocalStorage();
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await original(input, init);
  const state = run.getStore();
  if (state && /^https:\/\/(api\.openai\.com\/v1|openrouter\.ai\/api\/v1)\/responses$/.test(String(input)) && typeof init?.body === 'string') {
    const body = JSON.parse(init.body);
    state.pending.push(response.clone().json().then(data => {
      // usage.js sends an openrouter: model to OpenRouter inside this wrapper, so the request still names it.
      const u = data.usage ?? {}, provider = String(body.model).startsWith('openrouter:') ? 'openrouter' : 'openai';
      const event = { provider, model: data.model ?? null, input_tokens: u.input_tokens ?? 0, cached_tokens: u.input_tokens_details?.cached_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
        web_search_calls: (data.output ?? []).filter(o => o.type === 'web_search_call').length, ...(Number.isFinite(u.cost) ? { reported_cost: u.cost } : {}) };
      state.calls.push({ role: roleOf(body), status: response.status, ...event, cost: priceFor(event) });
    }).catch(() => state.calls.push({ role: roleOf(body), status: response.status, error: 'unreadable' })));
  }
  return response;
};

const [spec] = [ROLES[role]];
const envFor = model => {
  const [id, effort] = model.split(/:(?=[a-z]+$)/);
  const env = { ...process.env, ...PRODUCTION_CAPABILITIES, [spec.env]: id, ...(effort ? { [`${spec.env}_REASONING`]: effort } : {}), ...(option('--judges') ? { FROZEN_JUDGE_MODELS: option('--judges') } : {}) };
  if (role === 'search') delete env.SERPAPI_API_KEY;
  return env;
};
const replayCategory = c => c.category ?? (c.expected_status ? 'wishlist-status' : c.expected_saved ? 'save' : c.expected_watches ? 'alerts' : c.expected_selection ? 'selection' : 'sourcing');
const sources = c => replayCategory(c) === 'sourcing' || c.category === 'named-first-try';
// The frozen production cases (FROZEN-EVALS.md, scripts/frozen-evals.js sync) join the chat bake-off unless --no-frozen.
const frozen = role === 'chat' && !args.includes('--no-frozen') ? (await loadCases(casesDir(process.env))).filter(c => c.replayable) : [];
const cases = (role === 'chat'
  ? [...AGENT_EVAL_CASES.map(c => ({ id: c.id, category: `agent:${c.category}`, feature: 'eval_agent', run: env => runAgentEval(c, env) })),
     ...REPLAY_CASES.filter(c => !sources(c)).map(c => ({ id: c.id, category: `replay:${replayCategory(c)}`, feature: 'eval_replay', run: env => runReplay(c, env) })),
     ...frozen.map(c => ({ id: c.id, category: `frozen:${c.category}`, feature: 'eval_frozen', run: env => runFrozenCase(c, env) }))]
  : REPLAY_CASES.filter(sources).map(c => ({ id: c.id, category: `replay:${replayCategory(c)}`, feature: 'eval_replay', run: env => runReplay(c, env) })))
  .filter(c => !only || only.includes(c.id));

const store = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createStore(process.env) : null;
const operation = `eval:bakeoff:${role}:${new Date().toISOString()}`;
let spent = 0;
const results = [];
const queue = models.flatMap(model => cases.flatMap(c => Array.from({ length: runs }, (_, i) => ({ model, c, i }))));
const total = queue.length;
async function worker() {
  for (let job = queue.shift(); job && spent < maxCost; job = queue.shift()) {
    const state = { calls: [], pending: [] }, started = Date.now();
    let outcome;
    try { outcome = await run.run(state, () => withUsage({ store, env: {}, conversation: null, operation, feature: job.c.feature, quiet: true }, () => job.c.run(envFor(job.model)))); }
    catch (error) { outcome = { passed: false, failures: [`run_failed: ${error?.message ?? 'error'}`] }; }
    await Promise.allSettled(state.pending);
    const cost = state.calls.reduce((s, c) => s + (c.cost ?? 0), 0), roleCost = state.calls.filter(c => c.role === role).reduce((s, c) => s + (c.cost ?? 0), 0);
    const roleCalls = state.calls.filter(c => c.role === role), roleIn = roleCalls.reduce((s, c) => s + (c.input_tokens ?? 0), 0), roleCached = roleCalls.reduce((s, c) => s + (c.cached_tokens ?? 0), 0);
    spent += cost;
    const row = { model: job.model, id: job.c.id, category: job.c.category, run: job.i, passed: Boolean(outcome.passed) && !outcome.error,
      failures: [...(outcome.error ? [`error: ${String(outcome.error).slice(0, 120)}`] : []), ...(outcome.failures ?? [])],
      elapsed_ms: Date.now() - started, cost_usd: cost, role_cost_usd: roleCost, role_calls: roleCalls.length, role_input_tokens: roleIn, role_cached_tokens: roleCached,
      role_http_errors: roleCalls.filter(c => c.status !== 200).map(c => c.status), reply: outcome.reply ?? outcome.body ?? null, tools: outcome.tools ?? (outcome.tool ? [outcome.tool] : []),
      // A round past the agent's time limit or refused by the provider: slow or mis-wired, told apart from a wrong answer.
      timed_out: (outcome.timeouts ?? 0) > 0, refused: outcome.refused ?? [], ...(outcome.judges ? { judges: outcome.judges, judges_agree: outcome.judges_agree } : {}) };
    results.push(row);
    await appendFile(resolve(out, 'runs.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
    if (process.stderr.isTTY || results.length % 25 === 0) process.stderr.write(`${results.length}/${total} runs · ~$${spent.toFixed(2)}\n`);
  }
}
const startedAll = Date.now();
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
if (spent >= maxCost) console.log(`Stopped at the $${maxCost} cap after ${results.length}/${total} runs.`);

const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null; };
const summary = models.map(model => {
  const rows = results.filter(r => r.model === model);
  const byCategory = {};
  for (const r of rows) { const c = byCategory[r.category] ??= { runs: 0, passed: 0, failures: {} }; c.runs++; if (r.passed) c.passed++; else for (const f of r.failures.length ? r.failures : ['unknown']) c.failures[f] = (c.failures[f] ?? 0) + 1; }
  const roleIn = rows.reduce((s, r) => s + r.role_input_tokens, 0);
  // Frozen cases also wait for their judge, so latency is read from the other cases; their pass rate is its own number.
  const timed = rows.filter(r => !r.category.startsWith('frozen:')), frozenRows = rows.filter(r => r.category.startsWith('frozen:'));
  return { model, runs: rows.length, pass_rate: rows.length ? rows.filter(r => r.passed).length / rows.length : null,
    frozen_pass_rate: frozenRows.length ? frozenRows.filter(r => r.passed).length / frozenRows.length : null,
    frozen_judge_agreement: frozenRows.some(r => r.judges?.length > 1) ? frozenRows.filter(r => r.judges_agree).length / frozenRows.filter(r => r.judges?.length > 1).length : null,
    timeout_rate: rows.length ? rows.filter(r => r.timed_out).length / rows.length : null, refused_rate: rows.length ? rows.filter(r => r.refused.length).length / rows.length : null,
    median_ms: quantile(timed.map(r => r.elapsed_ms), 0.5), p90_ms: quantile(timed.map(r => r.elapsed_ms), 0.9),
    role_cost_per_100_turns: rows.length ? 100 * rows.reduce((s, r) => s + r.role_cost_usd, 0) / rows.length : null,
    total_cost_per_100_turns: rows.length ? 100 * rows.reduce((s, r) => s + r.cost_usd, 0) / rows.length : null,
    role_cache_share: roleIn ? rows.reduce((s, r) => s + r.role_cached_tokens, 0) / roleIn : null,
    http_errors: rows.flatMap(r => r.role_http_errors), by_category: byCategory };
});
await writeFile(resolve(out, 'summary.json'), JSON.stringify({ role, runs, cases: cases.length, elapsed_s: Math.round((Date.now() - startedAll) / 1000), spent_usd: spent, summary }, null, 2), { mode: 0o600 });
const pct = v => v === null ? '  —' : `${Math.round(v * 100)}%`.padStart(4);
console.log(`\n${role} role · ${cases.length} cases × ${runs} runs · ~$${spent.toFixed(2)} · results in ${out}\n`);
for (const s of summary) console.log(`${s.model.padEnd(44)} pass ${pct(s.pass_rate)}${s.frozen_pass_rate === null ? '' : `  frozen ${pct(s.frozen_pass_rate)}${s.frozen_judge_agreement === null ? '' : ` (judges agree ${pct(s.frozen_judge_agreement)})`}`}  timeouts ${pct(s.timeout_rate)}${s.refused_rate ? `  refused ${pct(s.refused_rate)}` : ''}  median ${(s.median_ms / 1000).toFixed(1)}s  p90 ${(s.p90_ms / 1000).toFixed(1)}s  ${role} $${s.role_cost_per_100_turns?.toFixed(3)}/100 turns  cache ${pct(s.role_cache_share)}${s.http_errors.length ? `  http errors ${s.http_errors.length}` : ''}`);
process.exit(0);
