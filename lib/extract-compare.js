// Extract-role comparison on the owner's own already-imported Gmail receipts (the model bake-off,
// MODEL-BAKEOFF.md). One email is re-read from Gmail with the stored read-only token, prepared exactly
// as the import prepares it, and read once by each model. What is compared is what Jules would keep:
// the events after code verification, not the raw model text. Nothing is saved; email text never
// leaves this function, only the verified fields each model's reading would keep.
import { openToken, accessToken, gmailGet } from './gmail-client.js';
import { prepareReceiptEmail } from './receipt-email.js';
import { modelSource } from './order-media.js';
import { receiptModel, RECEIPT_SCHEMA, RECEIPT_PROMPT, reconcileReceipt, emptyReceiptState } from './receipt-extraction.js';
import { withUsage } from './usage.js';
import { assertPrivateDataAllowed } from './models.js';

// The first is the baseline (today's extract model). A suffix after a colon is the reasoning effort.
export const COMPARE_MODELS = ['gpt-4.1-mini', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-nano:minimal'];
export const FIELDS = ['merchant', 'brand', 'product', 'size_label', 'color', 'quantity', 'order_reference'];
const norm = v => v == null ? null : String(v).toLowerCase().replace(/\s+/g, ' ').trim();

// A spread across the import, oldest to newest, so one store's template does not dominate.
export function sampleSources(row, count) {
  const all = (row?.data?.sources ?? []).filter(s => s.id), step = Math.max(1, Math.floor(all.length / count));
  return all.filter((_, i) => i % step === 0).slice(0, count);
}

// What Jules keeps from one reading: the verified events, or the reason the email was refused.
export function keptFrom(owner, source, proposal) {
  try {
    const { records } = reconcileReceipt(emptyReceiptState(owner), source, proposal);
    return records.map(r => ({ kind: r.kind, category: r.category, ...Object.fromEntries(FIELDS.map(f => [f, norm(r.values?.[f])])), price: norm(r.price?.amount ?? r.price?.text ?? null), recipient: r.recipient?.value ?? 'unknown' }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  } catch (error) { return { refused: String(error.message).split(':')[0] }; }
}

// One email, read once by each model at the same time. Metered as an eval.
export async function compareEmail({ store, row, owner, env, id, models = COMPARE_MODELS, fetcher = fetch, interpret = receiptModel }) {
  for (const m of models) assertPrivateDataAllowed(m.split(/:(?=[a-z]+$)/)[0]);
  const tokens = await accessToken(openToken(row.token_ciphertext, owner, env), env, fetcher);
  const source = await prepareReceiptEmail(await gmailGet('messages/' + encodeURIComponent(id) + '?format=full', tokens, fetcher), tokens, { fetcher });
  const subject = String(source.text ?? '').match(/^SUBJECT\n(.*)$/m)?.[1]?.slice(0, 120) ?? '';
  const readings = Object.fromEntries(await Promise.all(models.map(async model => {
    const [modelId, effort] = model.split(/:(?=[a-z]+$)/), started = Date.now();
    let cost = 0;
    try {
      const proposal = await withUsage({ store, env, conversation: null, operation: 'eval:extract-compare', feature: 'eval_extract', quiet: true, onUsage: rows => { cost = rows.reduce((t, r) => t + r.cost_usd, 0); } },
        () => interpret({ schema: RECEIPT_SCHEMA, instructions: RECEIPT_PROMPT, context: { source: modelSource(source), existing_items: [] } }, { ...env, MODEL_EXTRACT: modelId, ...(effort ? { MODEL_EXTRACT_REASONING: effort } : {}) }, fetcher));
      return [model, { kept: keptFrom(owner, source, proposal), ms: Date.now() - started, cost }];
    } catch (error) { return [model, { kept: { failed: String(error.message).slice(0, 80) }, ms: Date.now() - started, cost }]; }
  })));
  return { id, subject, readings };
}

// Agreement with the baseline's first reading, per model, and the disagreements to eyeball. results
// holds [{id, subject, readings: {model: [reading per run]}}]. Self-contained (no outside names), so the
// admin page can run the same summary over results it collected.
export function summarizeComparison(results, models) {
  const FIELDS = ['merchant', 'brand', 'product', 'size_label', 'color', 'quantity', 'order_reference'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const quantile = (values, q) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)] : null; };
  const baseline = models[0], ok = results.filter(r => r.readings?.[baseline]?.length);
  const summary = models.map(model => {
    const pairs = ok.flatMap(r => (r.readings[model] ?? []).slice(model === baseline ? 1 : 0).map(reading => ({ reading, ref: r.readings[baseline][0] })));
    const events = pairs.filter(p => Array.isArray(p.ref.kept) && Array.isArray(p.reading.kept));
    const fields = Object.fromEntries(FIELDS.map(f => [f, { same: 0, total: 0 }]));
    for (const { ref, reading } of events) for (const [i, e] of ref.kept.entries()) { const c = reading.kept[i]; if (!c) continue; for (const f of FIELDS) { if (e[f] === null && c[f] === null) continue; fields[f].total++; if (e[f] === c[f]) fields[f].same++; } }
    const readings = ok.flatMap(r => r.readings[model] ?? []);
    return { model, compared: pairs.length, email_agreement: pairs.length ? pairs.filter(p => same(p.ref.kept, p.reading.kept)).length / pairs.length : null,
      event_count_agreement: events.length ? events.filter(p => p.ref.kept.length === p.reading.kept.length).length / events.length : null,
      field_agreement: Object.fromEntries(Object.entries(fields).map(([f, t]) => [f, t.total ? t.same / t.total : null])),
      failures: readings.filter(x => x.kept?.failed).length, median_ms: quantile(readings.map(x => x.ms), 0.5), p90_ms: quantile(readings.map(x => x.ms), 0.9),
      cost_per_100_emails: readings.length ? 100 * readings.reduce((t, x) => t + x.cost, 0) / readings.length : null };
  });
  const disagreements = ok.flatMap(r => models.slice(1).flatMap(model => (r.readings[model] ?? []).map((reading, run) => ({ reading, run })).filter(x => !same(x.reading.kept, r.readings[baseline][0].kept))
    .slice(0, 1).map(x => ({ email: r.id, subject: r.subject, model, run: x.run, baseline: r.readings[baseline][0].kept, candidate: x.reading.kept }))));
  return { summary, disagreements };
}
