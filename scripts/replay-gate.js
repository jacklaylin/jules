// Pre-deploy gate: runs the agent routing evals and the reply replay suite against the real model
// N times, reports pass rates per category, and exits non-zero when any category is below the
// threshold. Cases grade intent, state transitions and outcomes, never exact wording.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/replay-gate.js                      # both suites, 3 runs, 80%
//   node --env-file=.env.local scripts/replay-gate.js --suite agent --runs 5 --threshold 0.9
//   node --env-file=.env.local scripts/replay-gate.js --cases cheaper-and-alert,receipt-me-for-both
// The agent suite stubs every tool (no search, save or alert). The replay suite runs real searches
// (OpenAI and SerpApi credits) but never sends texts, saves items or enables alerts.
import { AGENT_EVAL_CASES, runAgentEval } from '../lib/agent-eval.js';
import { REPLAY_CASES, runReplay } from '../lib/replay.js';
import { gateReport } from '../lib/replay-gate.js';
import { checkSchema, schemaReport, formatSchemaReport } from '../lib/schema-check.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const runs = Number(option('--runs') ?? 3), threshold = Number(option('--threshold') ?? 0.8), concurrency = Number(option('--concurrency') ?? 4);
const suite = option('--suite') ?? 'all', only = option('--cases')?.split(',').map(s => s.trim()).filter(Boolean), category = option('--category');
if (!(Number.isInteger(runs) && runs > 0)) throw Error('--runs must be a positive whole number');
if (!(threshold >= 0 && threshold <= 1)) throw Error('--threshold must be between 0 and 1');
if (!['all', 'agent', 'replay'].includes(suite)) throw Error('--suite must be all, agent or replay');
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('replace-with')) throw Error('OPENAI_API_KEY is missing; run with --env-file=.env.local');

// An unrun migration breaks every reply in production (October 15), so the gate checks the schema
// first when database credentials are in the environment.
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const schema = schemaReport(await checkSchema(process.env));
  console.log(formatSchemaReport(schema) + '\n');
  if (!schema.ok) process.exit(schema.missing.length ? 1 : 2);
} else console.log('Schema not checked: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.\n');

const env = { ...process.env, SEARCH_ENABLED: 'true' };
// One cheap request first, so a bad key fails in a second with a clear message instead of as every case failing.
const preflight = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4.1-mini', input: 'ok', max_output_tokens: 16, store: false }) }).catch(() => null);
if (!preflight?.ok) {
  const code = preflight ? (await preflight.json().catch(() => ({}))).error?.code ?? preflight.status : 'network error';
  console.error(`OpenAI rejected the request (${code}). Check OPENAI_API_KEY in .env.local matches the key in Vercel; nothing was run.`);
  process.exit(2);
}
const replayCategory = c => c.category ?? (c.expected_status ? 'wishlist-status' : c.expected_saved ? 'save' : c.expected_watches ? 'alerts' : c.expected_selection ? 'selection' : 'sourcing');
const jobs = [
  ...(suite !== 'replay' ? AGENT_EVAL_CASES.map(c => ({ id: c.id, category: `agent:${c.category}`, run: () => runAgentEval(c, env) })) : []),
  ...(suite !== 'agent' ? REPLAY_CASES.map(c => ({ id: c.id, category: `replay:${replayCategory(c)}`, run: () => runReplay(c, env) })) : []),
].filter(j => (!only || only.includes(j.id)) && (!category || j.category.endsWith(`:${category}`)));
if (!jobs.length) throw Error('No cases match the filters');

const queue = jobs.flatMap(job => Array.from({ length: runs }, (_, run) => ({ ...job, run_index: run })));
const results = [];
let done = 0;
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    let outcome;
    try { outcome = await job.run(); } catch (error) { outcome = { passed: false, failures: [`run_failed: ${error?.message ?? 'error'}`] }; }
    results.push({ id: job.id, category: job.category, passed: Boolean(outcome.passed) && !outcome.error, failures: [...(outcome.error ? [`error: ${outcome.error}`] : []), ...(outcome.failures ?? [])], elapsed_ms: outcome.elapsed_ms ?? null });
    done++;
    if (process.stderr.isTTY) process.stderr.write(`\r${done}/${jobs.length * runs} runs`);
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
if (process.stderr.isTTY) process.stderr.write('\n');

const report = gateReport(results, { threshold });
const pct = v => `${Math.round(v * 100)}%`.padStart(4);
console.log(`Replay gate · ${jobs.length} cases × ${runs} runs · threshold ${pct(threshold)} per category · ${Math.round((Date.now() - started) / 1000)}s\n`);
for (const c of report.categories) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${pct(c.pass_rate)}  ${c.category.padEnd(26)} ${c.passes}/${c.runs}`);
const shaky = report.cases.filter(c => c.pass_rate < 1);
if (shaky.length) {
  console.log('\nCases that failed at least once:');
  for (const c of shaky) console.log(`  ${pct(c.pass_rate)}  ${c.id} (${c.category}): ${c.failures.join('; ')}`);
}
console.log(`\n${report.passed ? 'Gate passed.' : 'Gate FAILED: fix the categories above before deploying.'}`);
process.exit(report.passed ? 0 : 1);
