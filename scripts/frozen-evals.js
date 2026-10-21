// The frozen eval set (FROZEN-EVALS.md): reported production turns re-run with stubbed tools and scored by a
// model judge, giving one pass rate. Secrets come from the environment, never from this file.
//   node --env-file=.env.local scripts/frozen-evals.js sync                  # freeze reports not frozen yet
//   node --env-file=.env.local scripts/frozen-evals.js run                   # sync, then run every case once
//   node --env-file=.env.local scripts/frozen-evals.js run --model gpt-5.5 --runs 3
//   node --env-file=.env.local scripts/frozen-evals.js run --cases dev-1a2b3c4d --no-sync
//   node --env-file=.env.local scripts/frozen-evals.js list
// Options: --since <ISO> (sync; default October 13), --category <name>, --concurrency 4, --max-cost 15 (USD).
// Cases and run results live in FROZEN_EVALS_DIR (default ~/.jules/frozen-evals), outside the repository:
// they hold private conversations. Nothing is searched, saved, alerted or sent.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { withUsage } from '../lib/usage.js';
import { spendTracker } from '../lib/replay-gate.js';
import { chatModel } from '../lib/compose.js';
import { casesDir, loadCases, syncCases, runFrozenCase, frozenReport, judgeModel, DEFAULT_SINCE } from '../lib/frozen-evals.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const command = args[0] ?? 'run';
if (!['sync', 'run', 'list'].includes(command)) throw Error('First argument must be sync, run or list');
const env = { ...process.env, SEARCH_ENABLED: 'true' };
const dir = casesDir(env);
const database = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
const store = database ? createStore(env) : null;

if (command === 'sync' || (command === 'run' && !args.includes('--no-sync'))) {
  if (!database) { if (command === 'sync') throw Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to read reports; run with --env-file=.env.local'); console.log('Not synced: no database credentials. Running the cases already frozen.'); }
  else {
    const since = option('--since') ?? DEFAULT_SINCE;
    if (Number.isNaN(Date.parse(since))) throw Error('--since must be an ISO timestamp');
    const { reports, added } = await withUsage({ store, env, conversation: null, operation: 'eval:frozen:sync', feature: 'eval_frozen', quiet: true }, () => syncCases(store, env, { dir, since, log: c => console.log(c.error ? `  could not freeze ${c.id}: ${c.error}` : `  froze ${c.id} (${c.category}${c.replayable ? '' : `, not replayable: ${c.not_replayable_reason}`})`) }));
    console.log(`Synced ${reports} reports since ${since}: ${added.length} new case${added.length === 1 ? '' : 's'} in ${dir}\n`);
  }
}
const all = await loadCases(dir);
if (command === 'list') {
  for (const c of all) console.log(`${c.id.padEnd(16)} ${c.reported_at.slice(0, 16)}  ${c.category.padEnd(22)} ${c.replayable ? '' : `(not replayable: ${c.not_replayable_reason}) `}${String(c.expectation?.text ?? '').slice(0, 90).replace(/\s+/g, ' ')}`);
  console.log(`\n${all.length} cases, ${all.filter(c => c.replayable).length} replayable.`);
}
if (command !== 'run') process.exit(0);

if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.startsWith('replace-with')) throw Error('OPENAI_API_KEY is missing; run with --env-file=.env.local');
const runs = Number(option('--runs') ?? 1), concurrency = Number(option('--concurrency') ?? 4), maxCost = Number(option('--max-cost') ?? 15);
const model = option('--model') ?? null, only = option('--cases')?.split(',').map(s => s.trim()).filter(Boolean), category = option('--category');
if (!(Number.isInteger(runs) && runs > 0)) throw Error('--runs must be a positive whole number');
const cases = all.filter(c => (!only || only.includes(c.id)) && (!category || c.category === category));
const replayable = cases.filter(c => c.replayable);
if (!replayable.length) throw Error(`No replayable cases${all.length ? ' match the filters' : ` in ${dir}; run sync first`}`);

const spend = spendTracker(maxCost), operation = 'eval:frozen:' + new Date().toISOString();
const queue = replayable.flatMap(c => Array.from({ length: runs }, () => c));
const results = [];
async function worker() {
  for (let c = queue.shift(); c && !spend.capped; c = queue.shift()) {
    let outcome;
    try { outcome = await withUsage({ store, env, conversation: null, operation, feature: 'eval_frozen', onUsage: rows => spend.add(rows), quiet: true }, () => runFrozenCase(c, env, { model })); }
    catch (error) { outcome = { id: c.id, category: `frozen:${c.category}`, passed: false, failures: [`run_failed: ${String(error?.message ?? error).slice(0, 120)}`] }; }
    results.push(outcome);
    if (process.stderr.isTTY) process.stderr.write(`\r${results.length}/${replayable.length * runs} runs · ~$${spend.spent.toFixed(2)}`);
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
if (process.stderr.isTTY) process.stderr.write('\n');

const report = frozenReport(results, cases);
const pct = v => v === null ? '   —' : `${Math.round(v * 100)}%`.padStart(4);
const chat = model ?? chatModel(env);
console.log(`Frozen eval set · ${report.cases} cases × ${runs} run${runs === 1 ? '' : 's'} · chat ${chat} · judge ${judgeModel(env)} · ${Math.round((Date.now() - started) / 1000)}s\n`);
console.log(`PASS RATE  ${pct(report.pass_rate)}  (${results.filter(r => r.passed).length}/${report.runs} runs)\n`);
for (const c of report.categories) console.log(`  ${pct(c.pass_rate)}  ${c.category.padEnd(30)} ${c.passes}/${c.runs}`);
console.log('\nBy criterion:');
for (const c of report.criteria) console.log(`  ${pct(c.pass_rate)}  ${c.label.padEnd(30)} ${c.scored} scored`);
const untestable = report.report_about.what_search_found + report.report_about.link_delivery + report.report_about.outside_the_reply;
if (untestable) console.log(`\nReports only about search results, link delivery or outside the reply (judge's reading): ${report.report_about.what_search_found} / ${report.report_about.link_delivery} / ${report.report_about.outside_the_reply} runs. "Respects the report" is not applicable for those when this replay cannot reproduce them.`);
if (report.skipped.length) console.log(`\n${report.skipped.length} cases not replayable (not an agent reply): ${[...new Set(report.skipped.map(s => s.reason))].join(', ')}`);
const failing = report.case_rates.filter(c => c.pass_rate < 1);
if (failing.length) { console.log('\nFailing cases:'); for (const c of failing) console.log(`  ${pct(c.pass_rate)}  ${c.id} (${c.category}): ${c.failures.join('; ').slice(0, 300)}`); }
await mkdir(join(dir, 'runs'), { recursive: true, mode: 0o700 });
const out = join(dir, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${chat.replace(/[^A-Za-z0-9.-]/g, '_')}.json`);
await writeFile(out, JSON.stringify({ chat_model: chat, judge_model: judgeModel(env), runs, spent_usd: spend.spent, report, results }, null, 2), { mode: 0o600 });
console.log(`\nEstimated cost: $${spend.spent.toFixed(2)} (cap $${maxCost.toFixed(2)}). Replies and reasons: ${out}`);
if (queue.length) console.log(`Stopped at the spending cap after ${results.length} runs; the number above is incomplete.`);
