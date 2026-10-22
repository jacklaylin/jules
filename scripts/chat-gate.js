// The chat eval gate (CHAT-DEVELOPMENT.md "The gate"), cheap enough to never skip.
//   node --env-file=.env.local scripts/chat-gate.js --area consent            # a PR: its area, ×3 on main and here, case by case
//   node --env-file=.env.local scripts/chat-gate.js                           # areas from the files this branch changes
//   node --env-file=.env.local scripts/chat-gate.js --touching lib/skills/options.js,lib/text-wishlist.js
//   node --env-file=.env.local scripts/chat-gate.js --nightly                 # full frozen set ×1 on origin/main, diffed with last night
// Options: --runs 3, --model gpt-5.6-luna (the production chat model; MODEL_CHAT in Vercel), --max-cost 5 (USD, the
//   whole gate; 3 nightly), --no-routing (frozen cases only), --fresh-base (don't reuse today's main results).
// main runs in its own checkout (~/.jules/eval-base, outside the repository) at origin/main, with this checkout's
// eval harness copied in so both sides are judged the same way. Main's results are kept per commit, area, model
// and run count, so several PRs on the same main pay for main once. Results stay in FROZEN_EVALS_DIR (runs/gate,
// runs/nightly). Exit code: 0 passed, 1 a trust-area case flipped to failing, 2 not run, 3 stopped at the cap.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, symlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { casesDir } from '../lib/frozen-evals.js';
import { AREAS, areasForFiles, parseAreas, caseVotes, caseFlips, nightHistory } from '../lib/eval-areas.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const nightly = args.includes('--nightly');
const runs = Number(option('--runs') ?? (nightly ? 1 : 3)), model = option('--model') ?? 'gpt-5.6-luna';
let budget = Number(option('--max-cost') ?? (nightly ? 3 : 5));
if (!(Number.isInteger(runs) && runs > 0)) throw Error('--runs must be a positive whole number');
if (!(budget > 0)) throw Error('--max-cost must be a positive number of US dollars');
if (!process.env.OPENAI_API_KEY) throw Error('OPENAI_API_KEY is missing; run with --env-file=.env.local');
const here = process.cwd(), dir = casesDir(process.env), git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const BASE = resolve(process.env.EVAL_BASE_DIR || join(homedir(), '.jules', 'eval-base'));
// The eval harness: copied from this checkout into main's, so the judge, code checks and areas are the same on both sides.
const HARNESS = ['scripts/frozen-evals.js', 'scripts/replay-gate.js', 'lib/frozen-evals.js', 'lib/eval-areas.js', 'lib/eval-cache.js', 'lib/replay-gate.js'];

// ---- Which areas ----
let areas = null;
if (!nightly) {
  if (option('--area')) areas = parseAreas(option('--area'));
  else {
    const files = option('--touching') ? option('--touching').split(',').map(s => s.trim()).filter(Boolean)
      : [...new Set([...git(here, 'diff', '--name-only', 'origin/main...HEAD').split('\n'), ...git(here, 'diff', '--name-only', 'HEAD').split('\n')].filter(Boolean))];
    const found = areasForFiles(files);
    if (found.shared.length) {
      console.log(`${found.shared.join(', ')} ${found.shared.length > 1 ? 'are' : 'is'} read by every turn, so the files can't say which cases to run.\nName the area your change is about: --area <${AREAS.join('|')}> (several with commas). The nightly full run covers the rest.`);
      process.exit(2);
    }
    if (!found.areas.length) { console.log(`None of the changed files touch chat (${files.length} file${files.length === 1 ? '' : 's'}); no chat eval is needed. Use --area to run one anyway.`); process.exit(0); }
    areas = found.areas;
  }
}

// ---- main's checkout ----
git(here, 'fetch', '-q', 'origin', 'main');
const baseSha = git(here, 'rev-parse', 'origin/main');
if (!existsSync(join(BASE, '.git'))) { mkdirSync(resolve(BASE, '..'), { recursive: true }); git(here, 'worktree', 'add', '-q', '--detach', BASE, baseSha); }
else git(BASE, 'checkout', '-q', '-f', '--detach', baseSha);
git(BASE, 'clean', '-q', '-fd', '--', 'lib', 'scripts');
if (!existsSync(join(BASE, 'node_modules'))) symlinkSync(realpathSync(join(here, 'node_modules')), join(BASE, 'node_modules'));
// A main from before the harness existed gets it copied in; a PR run always copies it, so both sides are judged alike.
if (!nightly || !existsSync(join(BASE, 'lib', 'eval-areas.js'))) for (const f of HARNESS) copyFileSync(join(here, f), join(BASE, f));

let spent = 0, capped = false;
function child(cwd, script, extra, out) {
  if (capped) return null;
  const r = spawnSync(process.execPath, [script, ...extra, '--model', model, '--runs', String(runs), '--max-cost', Math.max(0.01, budget - spent).toFixed(2), '--concurrency', '6', '--out', out],
    { cwd, env: process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
  // Not run (a refused key, an account out of credit or over its spend limit, a crash): say why and stop.
  if (!existsSync(out)) { console.log((r.stdout + r.stderr).split('\n').filter(l => !l.startsWith('{"event')).slice(-15).join('\n')); console.log(`\n${script} did not finish in ${cwd}; nothing more was run. Estimated cost so far: $${spent.toFixed(2)}.`); process.exit(2); }
  const data = JSON.parse(readFileSync(out, 'utf8'));
  spent += data.spent_usd ?? 0;
  if (data.complete === false) capped = true;
  return data;
}
const tag = `${baseSha.slice(0, 10)}-${model}-x${runs}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const pct = v => `${Math.round(v * 100)}%`;

if (nightly) {
  // ---- Nightly: the full frozen set ×1 on main, compared with the previous night ----
  const folder = join(dir, 'runs', 'nightly'); mkdirSync(folder, { recursive: true, mode: 0o700 });
  const out = join(folder, `${stamp}-${baseSha.slice(0, 10)}.json`);
  const data = child(BASE, 'scripts/frozen-evals.js', ['run'], out);
  const names = readdirSync(folder).filter(n => n.endsWith('.json') && join(folder, n) !== out).sort();
  const earlier = names.map(n => JSON.parse(readFileSync(join(folder, n), 'utf8')));
  const last = earlier.at(-1);
  console.log(`Nightly · main ${baseSha.slice(0, 10)} · ${caseVotes(data.results).size} cases × ${runs} · chat ${model} · pass rate ${pct(data.report.pass_rate)}${last ? ` (last night ${pct(last.report.pass_rate)})` : ''} · $${spent.toFixed(2)}`);
  if (!last) { console.log('\nNo earlier night to compare with; tomorrow will.'); process.exit(capped ? 3 : 0); }
  const lastSha = names.at(-1).slice(-15, -5); // <time>-<main commit>.json
  if (lastSha !== baseSha.slice(0, 10)) { console.log(`\nMerged since last night:`); console.log(git(BASE, 'log', '--oneline', '--no-decorate', `${lastSha}..${baseSha}`) || '  (nothing)'); }
  const { fell, rose, added } = caseFlips(last.results, data.results), recent = [...earlier.slice(-6), data];
  console.log(`\nFlipped to failing (${fell.length}):`); for (const f of fell) console.log(`  ${f.id}  ${nightHistory(recent, f.id)}  ${f.now.areas.join(',')}${f.trust ? '  TRUST' : ''}\n      ${[...f.now.failures].join('; ').slice(0, 240)}`);
  console.log(`\nFlipped to passing (${rose.length}):`); for (const f of rose) console.log(`  ${f.id}  ${nightHistory(recent, f.id)}`);
  if (added.length) console.log(`\nNew cases tonight: ${added.join(', ')}`);
  console.log(`\nOne run per case moves by chance: a case that flips with a mixed history above is noise; one that held for nights and then flipped points at the merges listed. Results: ${out}`);
  process.exit(capped ? 3 : 0);
}

// ---- A PR: its areas ×runs on main and on this checkout ----
const head = git(here, 'rev-parse', '--short=10', 'HEAD'), dirty = Boolean(git(here, 'status', '--porcelain', '--', 'lib', 'scripts', 'api'));
const folder = join(dir, 'runs', 'gate'); mkdirSync(folder, { recursive: true, mode: 0o700 });
const areaTag = areas.join('+'), reuse = !args.includes('--fresh-base');
const suites = [['frozen', 'scripts/frozen-evals.js', ['run', '--no-sync', '--area', areas.join(',')]],
  ...(args.includes('--no-routing') ? [] : [['routing', 'scripts/replay-gate.js', ['--suite', 'agent', '--area', areas.join(',')]]])];
console.log(`Chat gate · areas ${areas.join(', ')} · ×${runs} on main ${baseSha.slice(0, 10)} and ${head}${dirty ? ' (with uncommitted changes)' : ''} · chat ${model} · cap $${budget.toFixed(2)}\n`);
const results = {};
for (const [suite, script, extra] of suites) {
  const baseFile = join(folder, `main-${tag}-${areaTag}-${suite}.json`);
  const cached = reuse && existsSync(baseFile) && JSON.parse(readFileSync(baseFile, 'utf8'));
  const main = cached?.complete !== false && cached ? cached : child(BASE, script, extra, baseFile);
  if (cached && main === cached) console.log(`  main ${suite}: reused today's results for ${baseSha.slice(0, 10)}`);
  const pr = child(here, script, extra, join(folder, `pr-${stamp}-${head}-${areaTag}-${suite}.json`));
  results[suite] = { main, pr };
}

let blocked = false;
for (const [suite, { main, pr }] of Object.entries(results)) {
  if (!main || !pr) continue;
  const { fell, rose, added, before: a, after: b } = caseFlips(main.results, pr.results);
  const rate = m => { const l = [...m.values()]; return l.reduce((s, e) => s + e.passes, 0) / Math.max(1, l.reduce((s, e) => s + e.runs, 0)); };
  console.log(`\n${suite === 'frozen' ? 'Frozen failure set' : 'Routing evals'} · ${b.size} cases · pass rate main ${pct(rate(a))} → PR ${pct(rate(b))}`);
  for (const f of fell) {
    if (f.trust) blocked = true;
    console.log(`  ✗ ${f.trust ? 'TRUST ' : ''}${f.id} ${f.was.passes}/${f.was.runs} → ${f.now.passes}/${f.now.runs} (${f.now.areas.join(',')}): ${[...f.now.failures].join('; ').slice(0, 240)}`);
  }
  for (const f of rose) console.log(`  ✓ ${f.id} ${f.was.passes}/${f.was.runs} → ${f.now.passes}/${f.now.runs}`);
  if (!fell.length && !rose.length) console.log('  no case flipped');
  if (added.length) console.log(`  new on this branch: ${added.map(id => `${id} ${b.get(id).passes}/${b.get(id).runs}`).join(', ')}`);
}
console.log(`\nEstimated cost: $${spent.toFixed(2)} (cap $${budget.toFixed(2)}).${capped ? ' Stopped at the cap: the comparison is incomplete; rerun with a higher --max-cost or fewer areas.' : ''}`);
console.log(blocked ? '\nGate FAILED: a case in a trust area (saves, alerts, consent, prices) flipped to failing. Explain and fix it before merging.'
  : '\nGate passed: no trust-area case flipped to failing. Explain any other ✗ above in the PR.');
process.exit(capped ? 3 : blocked ? 1 : 0);
