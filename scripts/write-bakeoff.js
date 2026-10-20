// Write-role bake-off on fictional purchase histories (no one's real receipts): each model writes the
// style report's receipt line and Gatekeeper line for the same people, 3 runs each. Reports how often
// the writing passes the report's own copy checks (a miss falls back to a fixed line), median and p90
// latency and cost, and keeps every line for the blind voice comparison.
//   node --env-file=.env.local scripts/write-bakeoff.js --models gpt-5.5,gpt-6-luna,gpt-5.6-luna --out <folder>
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { receiptLines, writeReceipt, gatekeeper, writeGateLine, reportWriter } from '../lib/style-report.js';
import { projectReceiptEvidence, purchaseEvidence } from '../lib/receipt-extraction.js';
import { withUsage } from '../lib/usage.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const models = (option('--models') ?? 'gpt-5.5,gpt-6-luna,gpt-5.6-luna').split(',').map(s => s.trim()).filter(Boolean);
const runs = Number(option('--runs') ?? 3);
const out = resolve(option('--out') ?? `.eval-local/bakeoff-write-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(out, { recursive: true, mode: 0o700 });

// Fictional people, built the way the tests build them: [merchant, brand, product, year, returned].
const owner = '00000000-0000-4000-8000-0000000000b4';
const PEOPLE = {
  'quiet-luxury': [['SSENSE', 'Auralee', 'Wool Cardigan', 2024], ['SSENSE', 'Lemaire', 'Twisted Shirt', 2024], ['Lemaire', 'Lemaire', 'Croissant Bag', 2025], ['SSENSE', 'Our Legacy', 'Box Shirt', 2025, true], ['Auralee', 'Auralee', 'Super Light Wool Trousers', 2025], ['COS', 'COS', 'Merino Crewneck', 2023]],
  'gym-to-office': [['lululemon athletica', 'Lululemon', 'ABC Pant', 2023], ['lululemon athletica', 'Lululemon', 'Metal Vent Tee', 2024], ['Suit Supply B.V.', 'Suitsupply', 'Navy Havana Suit', 2024], ['ON RUNNING', 'On', 'Cloudmonster', 2025], ['lululemon athletica', 'Lululemon', 'License to Train Short', 2025, true], ['Suit Supply B.V.', 'Suitsupply', 'Poplin Shirt', 2025]],
  'sneaker-collector': [['Nike', 'Nike', 'Air Max 1', 2023], ['END.', 'New Balance', '990v6', 2024], ['END.', 'Salomon', 'XT-6', 2024], ['Nike', 'Nike', 'Dunk Low', 2025, true], ['Kith', 'Asics', 'Gel-Kayano 14', 2025], ['END.', 'Salomon', 'ACS Pro', 2025]],
  'archive-hunter': [['Grailed', 'Maison Margiela', 'Tabi Boots', 2024], ['SSENSE', 'Our Legacy', 'Third Cut Jeans', 2024], ['Grailed', 'Comme des Garçons', 'Homme Plus Blazer', 2025], ['SSENSE', 'Kapital', 'Boro Jacket', 2025], ['Grailed', 'Maison Margiela', 'GAT Sneakers', 2023, true]],
  'workwear': [['Carhartt WIP', 'Carhartt WIP', 'Detroit Jacket', 2023], ['Engineered Garments', 'Engineered Garments', 'Bedford Jacket', 2024], ['Uniqlo', 'Uniqlo', 'Oxford Shirt', 2024], ['Red Wing', 'Red Wing', 'Iron Ranger', 2025], ['Carhartt WIP', 'Carhartt WIP', 'Double Knee Pant', 2025, true], ['Uniqlo', 'Uniqlo', 'Heattech Tee', 2025]],
  'occasion-dresser': [['Net-a-Porter', 'Khaite', 'Silk Slip Dress', 2024], ['Reformation', 'Reformation', 'Juliette Dress', 2024, true], ['Net-a-Porter', 'The Row', 'Margaux Bag', 2025], ['Toteme', 'Toteme', 'Wool Coat', 2025], ['Reformation', 'Reformation', 'Linen Midi', 2025]],
};
let seq = 0;
const historyOf = rows => projectReceiptEvidence(owner, rows.flatMap(([merchant, brand, product, year, returned]) => {
  const n = ++seq, at = Date.UTC(year, n % 12, 1);
  return [purchaseEvidence({ event_id: `m${n}:0`, kind: 'purchased', source_id: `m${n}`, at, evidence: 'line', category: 'clothing', item_id: 'item-' + n, recipient: { value: 'self', quote: 'Ship to Sam' },
    values: { merchant, order_reference: 'O' + n, sku: null, brand, color: null, size_label: 'M', size_system: null, quantity: 1, units_per_pack: null, product } }),
    ...(returned ? [purchaseEvidence({ event_id: `r${n}:0`, kind: 'returned', source_id: `r${n}`, at: at + 864e5, evidence: 'returned', item_id: 'item-' + n,
      values: { merchant, order_reference: 'O' + n, sku: null, brand, color: null, size_label: 'M', size_system: null, quantity: null, units_per_pack: null, product } })] : [])];
})).state;

const lines = [];
await Promise.all(models.flatMap(model => Object.entries(PEOPLE).flatMap(([person, rows]) => Array.from({ length: runs }, async (_, run) => {
  const state = historyOf(rows), env = { ...process.env, MODEL_WRITE: model };
  for (const card of ['receipt', 'gatekeeper']) {
    const started = Date.now(); let cost = 0, result = null, error = null;
    try {
      result = await withUsage({ env: {}, conversation: null, operation: 'eval:bakeoff:write', feature: 'eval_write', quiet: true, onUsage: r => { cost = r.reduce((t, x) => t + x.cost_usd, 0); } }, () =>
        card === 'receipt' ? writeReceipt(receiptLines(state, {}), reportWriter(env)) : (gatekeeper(state).eligible ? writeGateLine(gatekeeper(state), reportWriter(env), 'Sam') : null));
    } catch (e) { error = e.message; }
    if (result === null && !error) continue;
    lines.push({ model, person, card, run, written: Boolean(result?.written), line: card === 'receipt' ? result?.fine : result?.line, ms: Date.now() - started, cost, error });
  }
}))));

const quantile = (v, q) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null; };
const summary = models.map(model => { const r = lines.filter(l => l.model === model);
  return { model, lines: r.length, written_rate: r.filter(l => l.written).length / r.length, median_ms: quantile(r.map(l => l.ms), 0.5), p90_ms: quantile(r.map(l => l.ms), 0.9), cost_per_100_lines: 100 * r.reduce((t, l) => t + l.cost, 0) / r.length, errors: r.filter(l => l.error).length }; });
await writeFile(resolve(out, 'write-results.json'), JSON.stringify({ runs, summary, lines }, null, 2), { mode: 0o600 });
const pct = v => `${Math.round(v * 100)}%`.padStart(4);
for (const s of summary) console.log(`${s.model.padEnd(16)} passes copy checks ${pct(s.written_rate)} of ${s.lines}  median ${(s.median_ms / 1000).toFixed(1)}s  p90 ${(s.p90_ms / 1000).toFixed(1)}s  $${s.cost_per_100_lines.toFixed(3)}/100 lines  errors ${s.errors}`);
process.exit(0);
