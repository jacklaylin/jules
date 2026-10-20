// Extract-role bake-off on one person's own already-imported Gmail receipts. Each sampled email is
// re-read from Gmail with the stored read-only token, prepared exactly as the import prepares it, and
// read by the receipt prompt with the baseline model and each candidate (3 runs each). What is compared
// is what Jules would keep: the events after code verification (lib/receipt-extraction.js), not the raw
// model text. Results stay local; the receipts are personal data and never leave this machine except
// to the model under test, which must be allowed to read personal data (OpenAI, or a US-pinned
// OpenRouter provider; never DeepSeek).
//   node --env-file=.env.local scripts/extract-bakeoff.js \
//     --models gpt-4.1-mini,gpt-6-luna,gpt-5-nano:minimal --emails 40 --out <private folder>
// It reads the import connected with ADMIN_EMAIL unless EVAL_CONVERSATION_ID names another.
// The first model is the baseline. Its run 1 is the reference; its runs 2–3 show how often the baseline
// disagrees with itself, which is the noise floor for the candidates.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStore } from '../lib/store.js';
import { openToken, accessToken, gmailGet } from '../lib/gmail-client.js';
import { prepareReceiptEmail } from '../lib/receipt-email.js';
import { modelSource } from '../lib/order-media.js';
import { receiptModel, RECEIPT_SCHEMA, RECEIPT_PROMPT, reconcileReceipt, emptyReceiptState } from '../lib/receipt-extraction.js';
import { withUsage } from '../lib/usage.js';
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
const tokens = await accessToken(openToken(row.token_ciphertext, conversation, env), env);
// A spread across the import, oldest to newest, so one store's template does not dominate.
const all = (row.data.sources ?? []).filter(s => s.id), step = Math.max(1, Math.floor(all.length / emailCount));
const sample = all.filter((_, i) => i % step === 0).slice(0, emailCount);

const norm = v => v == null ? null : String(v).toLowerCase().replace(/\s+/g, ' ').trim();
const FIELDS = ['merchant', 'brand', 'product', 'size_label', 'color', 'quantity', 'order_reference'];
// What Jules keeps from one reading: the verified events, or the reason the email was refused.
function kept(source, proposal) {
  try {
    const { records } = reconcileReceipt(emptyReceiptState(conversation), source, proposal);
    return records.map(r => ({ kind: r.kind, category: r.category, ...Object.fromEntries(FIELDS.map(f => [f, norm(r.values?.[f])])), price: norm(r.price?.amount ?? r.price?.text ?? null), recipient: r.recipient?.value ?? 'unknown' }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  } catch (error) { return { refused: error.message.split(':')[0] }; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inTurn = async (n, work) => { const out = []; for (let i = 0; i < n; i++) out.push(await work()); return out; };

const results = [];
let spent = 0;
for (const [n, s] of sample.entries()) {
  let source;
  try { source = await prepareReceiptEmail(await gmailGet('messages/' + encodeURIComponent(s.id) + '?format=full', tokens), tokens); }
  catch (error) { results.push({ id: s.id, error: 'gmail: ' + error.message }); continue; }
  const subject = String(source.text ?? '').match(/^SUBJECT\n(.*)$/m)?.[1]?.slice(0, 120) ?? '';
  const readings = {};
  await Promise.all(models.map(async model => {
    const [id, effort] = model.split(/:(?=[a-z]+$)/);
    // One model's runs go one after another, so at most one call per model is in flight (production
    // shares these rate limits).
    readings[model] = await inTurn(runs, async () => {
      const started = Date.now(); let cost = 0;
      try {
        const proposal = await withUsage({ env: {}, conversation: null, operation: 'eval:bakeoff:extract', feature: 'eval_extract', quiet: true, onUsage: rows => { cost = rows.reduce((t, r) => t + r.cost_usd, 0); } },
          () => receiptModel({ schema: RECEIPT_SCHEMA, instructions: RECEIPT_PROMPT, context: { source: modelSource(source), existing_items: [] } }, { ...env, MODEL_EXTRACT: id, ...(effort ? { MODEL_EXTRACT_REASONING: effort } : {}) }));
        return { kept: kept(source, proposal), ms: Date.now() - started, cost };
      } catch (error) { return { kept: { failed: error.message }, ms: Date.now() - started, cost }; }
    });
  }));
  for (const r of Object.values(readings).flat()) spent += r.cost;
  results.push({ id: s.id, subject, readings });
  process.stderr.write(`${n + 1}/${sample.length} emails · ~$${spent.toFixed(2)}\n`);
}

const [baseline] = models;
const ok = results.filter(r => r.readings);
const quantile = (values, q) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)] : null; };
const summary = models.map(model => {
  const pairs = ok.flatMap(r => r.readings[model].slice(model === baseline ? 1 : 0).map(reading => ({ r, reading, ref: r.readings[baseline][0] })));
  const events = pairs.filter(p => Array.isArray(p.ref.kept) && Array.isArray(p.reading.kept));
  const fieldTotals = Object.fromEntries(FIELDS.map(f => [f, { same: 0, total: 0 }]));
  for (const { ref, reading } of events) for (const [i, e] of ref.kept.entries()) { const c = reading.kept[i]; if (!c) continue; for (const f of FIELDS) { if (e[f] === null && c[f] === null) continue; fieldTotals[f].total++; if (e[f] === c[f]) fieldTotals[f].same++; } }
  const readings = ok.flatMap(r => r.readings[model]);
  return { model, compared: pairs.length, email_agreement: pairs.length ? pairs.filter(p => same(p.ref.kept, p.reading.kept)).length / pairs.length : null,
    event_count_agreement: events.length ? events.filter(p => p.ref.kept.length === p.reading.kept.length).length / events.length : null,
    field_agreement: Object.fromEntries(Object.entries(fieldTotals).map(([f, t]) => [f, t.total ? t.same / t.total : null])),
    failures: readings.filter(x => x.kept?.failed).length, median_ms: quantile(readings.map(x => x.ms), 0.5), p90_ms: quantile(readings.map(x => x.ms), 0.9),
    cost_per_100_emails: readings.length ? 100 * readings.reduce((t, x) => t + x.cost, 0) / readings.length : null };
});
// The disagreements to eyeball: the reference reading beside each candidate reading that differs.
const disagreements = ok.flatMap(r => models.slice(1).flatMap(model => r.readings[model].map((reading, run) => ({ reading, run })).filter(x => !same(x.reading.kept, r.readings[baseline][0].kept))
  .slice(0, 1).map(x => ({ email: r.id, subject: r.subject, model, run: x.run, baseline: r.readings[baseline][0].kept, candidate: x.reading.kept }))));
await writeFile(resolve(out, 'extract-results.json'), JSON.stringify({ baseline, runs, emails: sample.length, spent_usd: spent, summary, disagreements, results }, null, 2), { mode: 0o600 });
const pct = v => v === null ? '  —' : `${Math.round(v * 100)}%`.padStart(4);
console.log(`\nextract role · ${ok.length} emails × ${runs} runs · ~$${spent.toFixed(2)} · results in ${out}\n`);
for (const s of summary) console.log(`${s.model.padEnd(28)} agrees ${pct(s.email_agreement)} (events ${pct(s.event_count_agreement)})  failed ${s.failures}  median ${(s.median_ms / 1000).toFixed(1)}s  p90 ${(s.p90_ms / 1000).toFixed(1)}s  $${s.cost_per_100_emails?.toFixed(3)}/100 emails`);
console.log(`${disagreements.length} disagreements listed in extract-results.json`);
process.exit(0);
