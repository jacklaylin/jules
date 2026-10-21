// Answer-engine visibility probe (docs/aeo/README.md). Asks each target question once per answer engine with
// web search on, records whether Jules is mentioned or cited, and writes docs/aeo/YYYY-MM-DD.md and .json.
// It only reads answers: it never edits the site or posts anywhere. Keys come from the environment.
//   node --env-file=.env.local scripts/aeo/probe.js              # full run, writes the dated report
//   node --env-file=.env.local scripts/aeo/probe.js --dry        # list questions and engines; no calls
//   node --env-file=.env.local scripts/aeo/probe.js --engines perplexity --limit 2   # small trial
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENGINES } from './engines.js';
import { analyzeAnswer, summarize, renderReport, findPrevious } from './analyze.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const config = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));
const questions = config.questions.slice(0, option('--limit') ? Number(option('--limit')) : undefined);
const only = option('--engines')?.split(',');
const date = option('--date') ?? new Date().toISOString().slice(0, 10);
const outDir = new URL('../../docs/aeo/', import.meta.url).pathname;
const maxCost = Number(process.env.AEO_MAX_COST_USD) || 5;

// AEO_INJECTED_KEYS lists engines whose key the cloud environment adds to requests (network secrets).
const injected = (process.env.AEO_INJECTED_KEYS ?? '').split(',').map(s => s.trim());
const engines = ENGINES.filter(e => !only || only.includes(e.id)).map(e => {
  const model = process.env[e.modelEnv] || e.defaultModel, key = process.env[e.keyEnv] || null;
  const usable = Boolean(key) || injected.includes(e.id);
  return { ...e, model, key, usable, status: usable ? 'ran' : 'skipped', note: usable ? null : `${e.keyEnv} is not set` };
});
for (const e of engines) console.log(`${e.id.padEnd(11)} ${e.model.padEnd(18)} ${e.status === 'ran' ? (e.key ? 'will run' : 'will run (key added by the environment)') : `skipped: ${e.note}`}`);
console.log(`${questions.length} questions, cost cap $${maxCost}`);
if (args.includes('--dry')) { for (const q of questions) console.log(`  ${q.id.padEnd(28)} ${q.text}`); process.exit(0); }
if (!engines.some(e => e.usable)) { console.error('No engine has a key set; nothing to run.'); process.exit(1); }

const results = [];
let spent = 0;
for (const q of questions) {
  if (spent >= maxCost) { console.log(`Cost cap reached ($${spent.toFixed(2)}); stopping before ${q.id}.`); break; }
  // One call per question per engine; engines run side by side.
  const round = await Promise.all(engines.filter(e => e.usable).map(async e => {
    const base = { question_id: q.id, question: q.text, job: q.job, engine: e.id, model: e.model, date };
    try {
      const data = await e.request(fetch, e.key, e.model, q.text);
      const row = { ...base, ok: true, served_model: data.model ?? e.model, ...analyzeAnswer(e.parse(data, e.model), config.competitors) };
      console.log(JSON.stringify({ event: 'aeo_answer', engine: e.id, question: q.id, mentioned: row.mention.confidence, cited: row.mention.cited, citations: row.cited_domains.length, ...row.usage, cost_usd: row.cost_usd, stop_reason: row.stop_reason }));
      return row;
    } catch (error) {
      console.log(JSON.stringify({ event: 'aeo_error', engine: e.id, question: q.id, error: error.message.slice(0, 300) }));
      return { ...base, ok: false, error: error.message.slice(0, 300) };
    }
  }));
  results.push(...round);
  spent += round.reduce((s, r) => s + (r.ok && r.cost_usd == null ? 0.25 : r.cost_usd ?? 0), 0); // an unpriced model counts high for the cap
}

const run = {
  date, generated_at: new Date().toISOString(), questions_version: config.version, questions,
  engines: engines.map(({ id, label, model, status, note }) => ({ id, label, model, status, note })), results,
};
run.summary = summarize(run);
const previous = findPrevious(outDir, date);
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}${date}.json`, JSON.stringify(run, null, 2) + '\n');
writeFileSync(`${outDir}${date}.md`, renderReport(run, previous));
console.log(`\nWrote docs/aeo/${date}.md and .json. Estimated cost $${run.summary.cost_usd.toFixed(2)}.`);
for (const e of run.summary.engines) console.log(`${e.id.padEnd(11)} ${e.status === 'ran' ? `mentioned in ${e.mentioned}/${e.answers}, cited in ${e.cited}, errors ${e.errors}` : e.note}`);
