// Runs the nightly judge by hand (lib/judge.js). Secrets come from the environment, never from this file.
//   node --env-file=.env.local scripts/judge.js --dry --limit 5   # score 5 due turns and print; saves nothing
//   node --env-file=.env.local scripts/judge.js --dry --days 7 --negative   # only turns with a negative outcome
//   node --env-file=.env.local scripts/judge.js                   # one real run, like a scheduler tick
// Output holds verdicts, criteria and the judge's paraphrased reasons: no message text or phone numbers.
import '../lib/usage.js';
import { createStore } from '../lib/store.js';
import { runJudge } from '../lib/judge.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const limit = option('--limit') ? Number(option('--limit')) : null, dryRun = args.includes('--dry');
const days = option('--days') ? Number(option('--days')) : undefined, only = args.includes('--negative') ? t => t.headline === 'negative' : null;
if (!dryRun && (days || only)) throw Error('--days and --negative are for dry runs only');
const summary = await runJudge(createStore(process.env), process.env, { dryRun, limit, deadlineMs: 600000, ...(days ? { days } : {}), only });
const { results = [], ...rest } = summary;
console.log(JSON.stringify(rest));
for (const r of results) {
  console.log(`\n${r.operation.slice(0, 20)}…  ${r.verdict.toUpperCase()}  $${r.judge_cost_usd.toFixed(4)}`);
  for (const [key, c] of Object.entries(r.criteria)) console.log(`  ${c.verdict.padEnd(14)} ${key.padEnd(15)} ${c.reason}`);
}
