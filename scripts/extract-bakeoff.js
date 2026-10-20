// Extract-role bake-off on one person's own already-imported Gmail receipts. Each sampled email is
// re-read from Gmail with the stored read-only token, prepared exactly as the import prepares it, and
// read by the receipt prompt with the baseline model and each candidate (3 runs each). What is compared
// is what Jules would keep: the events after code verification (lib/receipt-extraction.js), not the raw
// model text. Results stay local; the receipts are personal data and never leave this machine except
// to the model under test, which must be allowed to read personal data (OpenAI, or a US-pinned
// OpenRouter provider; never DeepSeek).
//   node --env-file=.env.local scripts/extract-bakeoff.js \
//     --models gpt-4.1-mini,gpt-6-luna,gpt-5-nano:minimal --emails 40 --out <private folder>
// It needs the production GMAIL_TOKEN_KEY locally. When that key is Sensitive in Vercel, run the same
// comparison from the admin page instead (action extract-compare, lib/extract-compare.js).
// It reads the import connected with ADMIN_EMAIL unless EVAL_CONVERSATION_ID names another.
// The first model is the baseline. Its run 1 is the reference; its runs 2–3 show how often the baseline
// disagrees with itself, which is the noise floor for the candidates.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStore } from '../lib/store.js';
import { compareEmail, sampleSources, summarizeComparison } from '../lib/extract-compare.js';
import { assertPrivateDataAllowed } from '../lib/models.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = process.env;
// Defaults to the admin's own Gmail import (the one connected with ADMIN_EMAIL).
async function adminImport() {
  if (!env.ADMIN_EMAIL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
  const rows = await (await fetch(env.SUPABASE_URL + '/rest/v1/gmail_imports?select=conversation_id,account:data->account', { headers })).json();
  return rows.find(r => JSON.stringify(r.account ?? '').toLowerCase().includes(env.ADMIN_EMAIL.toLowerCase()))?.conversation_id ?? null;
}
const conversation = env.EVAL_CONVERSATION_ID || await adminImport();
const models = (option('--models') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const emailCount = Number(option('--emails') ?? 40), runs = Number(option('--runs') ?? 3);
const out = resolve(option('--out') ?? `.eval-local/bakeoff-extract-${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (!conversation || models.length < 2) throw Error('Use node --env-file=.env.local scripts/extract-bakeoff.js --models <baseline>,<candidate>[,...] (reads the ADMIN_EMAIL import, or set EVAL_CONVERSATION_ID)');
for (const m of models) assertPrivateDataAllowed(m.split(/:(?=[a-z]+$)/)[0]);
await mkdir(out, { recursive: true, mode: 0o700 });

const store = createStore(env), row = await store.gmailImport(conversation);
if (!row?.token_ciphertext) throw Error('No connected Gmail import for this conversation');
const sample = sampleSources(row, emailCount), results = [];
let spent = 0;
for (const [n, s] of sample.entries()) {
  // Runs go one after another; the models of one run go together (production shares these rate limits).
  const readings = Object.fromEntries(models.map(m => [m, []]));
  let subject = '';
  try {
    for (let run = 0; run < runs; run++) {
      const one = await compareEmail({ store, row, owner: conversation, env, id: s.id, models });
      subject = one.subject;
      for (const m of models) { readings[m].push(one.readings[m]); spent += one.readings[m].cost; }
    }
    results.push({ id: s.id, subject, readings });
  } catch (error) { results.push({ id: s.id, error: 'gmail: ' + error.message }); }
  process.stderr.write(`${n + 1}/${sample.length} emails · ~$${spent.toFixed(2)}\n`);
}
const { summary, disagreements } = summarizeComparison(results, models), baseline = models[0], ok = results.filter(r => r.readings);
await writeFile(resolve(out, 'extract-results.json'), JSON.stringify({ baseline, runs, emails: sample.length, spent_usd: spent, summary, disagreements, results }, null, 2), { mode: 0o600 });
const pct = v => v === null ? '  —' : `${Math.round(v * 100)}%`.padStart(4);
console.log(`\nextract role · ${ok.length} emails × ${runs} runs · ~$${spent.toFixed(2)} · results in ${out}\n`);
for (const s of summary) console.log(`${s.model.padEnd(28)} agrees ${pct(s.email_agreement)} (events ${pct(s.event_count_agreement)})  failed ${s.failures}  median ${(s.median_ms / 1000).toFixed(1)}s  p90 ${(s.p90_ms / 1000).toFixed(1)}s  $${s.cost_per_100_emails?.toFixed(3)}/100 emails`);
console.log(`${disagreements.length} disagreements listed in extract-results.json`);
process.exit(0);
