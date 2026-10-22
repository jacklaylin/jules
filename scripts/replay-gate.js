// Pre-deploy gate: runs the agent routing evals and the reply replay suite against the real model
// N times, reports pass rates per category, and exits non-zero when any category is below the
// threshold. Cases grade intent, state transitions and outcomes, never exact wording.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/replay-gate.js                      # both suites, 3 runs, 80%
//   node --env-file=.env.local scripts/replay-gate.js --suite agent --runs 5 --threshold 0.9
//   node --env-file=.env.local scripts/replay-gate.js --cases cheaper-and-alert,receipt-me-for-both
//   node --env-file=.env.local scripts/replay-gate.js --max-cost 10          # spending cap in USD (default 5)
//   node --env-file=.env.local scripts/replay-gate.js --suite agent --area consent,saves --model gpt-5.6-luna --out results.json
// --area runs only the agent cases in those areas (lib/eval-areas.js); --model sets the chat model (default MODEL_CHAT);
// --out writes every run's result as JSON, for the case-by-case comparison in scripts/chat-gate.js.
// The agent suite stubs every tool (no search, save or alert). The replay suite runs real searches
// (OpenAI and SerpApi credits) but never sends texts, saves items or enables alerts.
// Every run is metered: the estimated cost prints at the end, the gate stops starting runs once the
// cap is reached, and with database credentials the calls are recorded in usage_events (feature
// eval_agent / eval_replay) so the admin Costs page shows them beside real user spend.
import { AGENT_EVAL_CASES, runAgentEval } from '../lib/agent-eval.js';
import { REPLAY_CASES, runReplay } from '../lib/replay.js';
import { gateReport, spendTracker, spendByModel, PRODUCTION_CAPABILITIES } from '../lib/replay-gate.js';
import { routingAreas, parseAreas } from '../lib/eval-areas.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evalCache } from '../lib/eval-cache.js';
import { casesDir } from '../lib/frozen-evals.js';
import { withUsage } from '../lib/usage.js';
import { createStore } from '../lib/store.js';
import { checkSchema, schemaReport, formatSchemaReport } from '../lib/schema-check.js';
import { modelResponse } from '../lib/model-call.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const runs = Number(option('--runs') ?? 3), threshold = Number(option('--threshold') ?? 0.8), concurrency = Number(option('--concurrency') ?? 4);
const maxCost = Number(option('--max-cost') ?? 5);
const suite = option('--suite') ?? 'all', only = option('--cases')?.split(',').map(s => s.trim()).filter(Boolean), category = option('--category');
if (!(Number.isInteger(runs) && runs > 0)) throw Error('--runs must be a positive whole number');
if (!(threshold >= 0 && threshold <= 1)) throw Error('--threshold must be between 0 and 1');
if (!(maxCost > 0)) throw Error('--max-cost must be a positive number of US dollars');
if (!['all', 'agent', 'replay'].includes(suite)) throw Error('--suite must be all, agent or replay');
const areas = option('--area') ? parseAreas(option('--area')) : null, out = option('--out');
if (areas && suite !== 'agent') throw Error('--area works with --suite agent');
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('replace-with')) throw Error('OPENAI_API_KEY is missing; run with --env-file=.env.local');

// An unrun migration breaks every reply in production (October 15), so the gate checks the schema
// first when database credentials are in the environment.
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const schema = schemaReport(await checkSchema(process.env));
  console.log(formatSchemaReport(schema) + '\n');
  if (!schema.ok) process.exit(schema.missing.length ? 1 : 2);
} else console.log('Schema not checked: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.\n');

// Production capabilities whatever .env.local says, so the agent evals offer the tools testers have.
const env = { ...process.env, ...PRODUCTION_CAPABILITIES, ...(option('--model') ? { MODEL_CHAT: option('--model') } : {}) };
const store = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createStore(process.env) : null;
const spend = spendTracker(maxCost), gateRun = 'eval:' + new Date().toISOString();
// One cheap request first, so a bad key fails in a second with a clear message instead of as every case failing.
const preflight = await modelResponse({ role: 'extract', env, body: { input: 'ok', max_output_tokens: 16 } }).catch(() => null);
if (!preflight?.ok) {
  const code = preflight ? (await preflight.json().catch(() => ({}))).error?.code ?? preflight.status : 'network error';
  console.error(`OpenAI rejected the request (${code}). Check OPENAI_API_KEY in .env.local matches the key in Vercel; nothing was run.`);
  process.exit(2);
}
// The profile check's stored answers for the agent suite (lib/eval-cache.js); --no-cache sends every request.
const cache = args.includes('--no-cache') ? null : await evalCache(join(casesDir(process.env), 'cache', 'requests.json'));
const replayCategory = c => c.category ?? (c.expected_status ? 'wishlist-status' : c.expected_saved ? 'save' : c.expected_watches ? 'alerts' : c.expected_selection ? 'selection' : 'sourcing');
const jobs = [
  ...(suite !== 'replay' ? AGENT_EVAL_CASES.filter(c => !areas || routingAreas(c.category).some(a => areas.includes(a))).map(c => ({ id: c.id, category: `agent:${c.category}`, areas: routingAreas(c.category), feature: 'eval_agent', run: () => runAgentEval(c, env, cache ? { fetcher: cache.fetcher } : {}) })) : []),
  ...(suite !== 'agent' ? REPLAY_CASES.map(c => ({ id: c.id, category: `replay:${replayCategory(c)}`, feature: 'eval_replay', run: () => runReplay(c, env) })) : []),
].filter(j => (!only || only.includes(j.id)) && (!category || j.category.endsWith(`:${category}`)));
if (!jobs.length) throw Error('No cases match the filters');

const queue = jobs.flatMap(job => Array.from({ length: runs }, (_, run) => ({ ...job, run_index: run })));
const results = [];
let done = 0;
const metered = job => withUsage({ store, env, conversation: null, operation: gateRun, feature: job.feature, onUsage: rows => spend.add(rows), quiet: true }, job.run);
async function worker() {
  for (let job = queue.shift(); job && !spend.capped; job = queue.shift()) {
    let outcome;
    try { outcome = await metered(job); } catch (error) { outcome = { passed: false, failures: [`run_failed: ${error?.message ?? 'error'}`] }; }
    results.push({ id: job.id, category: job.category, areas: job.areas ?? null, passed: Boolean(outcome.passed) && !outcome.error, failures: [...(outcome.error ? [`error: ${outcome.error}`] : []), ...(outcome.failures ?? [])], elapsed_ms: outcome.elapsed_ms ?? null });
    done++;
    if (process.stderr.isTTY) process.stderr.write(`\r${done}/${jobs.length * runs} runs · ~$${spend.spent.toFixed(2)}`);
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
if (process.stderr.isTTY) process.stderr.write('\n');

await cache?.save();
const report = gateReport(results, { threshold });
const pct = v => `${Math.round(v * 100)}%`.padStart(4);
console.log(`Replay gate · ${jobs.length} cases × ${runs} runs · threshold ${pct(threshold)} per category · ${Math.round((Date.now() - started) / 1000)}s\n`);
for (const c of report.categories) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${pct(c.pass_rate)}  ${c.category.padEnd(26)} ${c.passes}/${c.runs}`);
const shaky = report.cases.filter(c => c.pass_rate < 1);
if (shaky.length) {
  console.log('\nCases that failed at least once:');
  for (const c of shaky) console.log(`  ${pct(c.pass_rate)}  ${c.id} (${c.category}): ${c.failures.join('; ')}`);
}
const total = jobs.length * runs;
console.log(`\nEstimated cost: $${spend.spent.toFixed(2)} (${spend.openai_calls} OpenAI calls, ${spend.searches} SerpApi searches; list prices, cap $${maxCost.toFixed(2)}): ${spendByModel(spend)}. ${store ? 'Recorded on the admin Costs page.' : 'Not recorded: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.'}`);
if (out) await writeFile(out, JSON.stringify({ chat_model: env.MODEL_CHAT ?? null, runs, areas, spent_usd: spend.spent, spent_by_model: spend.by_model, complete: results.length === total, report, results }, null, 2), { mode: 0o600 });
if (spend.unpriced.size) console.log(`Cost unknown for ${[...spend.unpriced].join(', ')}: add its prices to lib/usage.js PRICES. Those calls are costed at the dearest known rate.`);
if (results.length < total) {
  console.log(`\nStopped at the $${maxCost.toFixed(2)} spending cap after ${results.length} of ${total} runs; the gate is incomplete. Rerun with fewer cases (--cases, --category), fewer --runs, or a higher --max-cost.`);
  process.exit(3);
}
console.log(`\n${report.passed ? 'Gate passed.' : 'Gate FAILED: fix the categories above before deploying.'}`);
process.exit(report.passed ? 0 : 1);
