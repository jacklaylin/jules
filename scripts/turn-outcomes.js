// What testers did after each set of results (lib/turn-outcomes.js), from the production log.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/turn-outcomes.js            # last 7 days
//   node --env-file=.env.local scripts/turn-outcomes.js --days 14 --json
// Output holds counts, labels and short conversation ids only: no message text, phone numbers or names.
import { createStore } from '../lib/store.js';
import { loadTurnOutcomes } from '../lib/turn-outcomes.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const days = option('--days') ? Number(option('--days')) : 7;
if (!(days > 0)) throw Error('--days must be a positive number');
const report = await loadTurnOutcomes(createStore(process.env), { days });
if (args.includes('--json')) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0); }

const s = report.summary, pct = v => v === null ? '—' : `${Math.round(v * 100)}%`, sec = v => v === null ? '—' : `${Math.round(v / 100) / 10}s`;
console.log(`Sourcing turns since ${report.since}: ${s.turns} (text ${s.by_type.text}, photo ${s.by_type.photo}, link ${s.by_type.link})\n`);
console.log(`Showed a verified product page   ${pct(s.verified_rate)}`);
console.log(`Positive next step               ${pct(s.positive_rate)} of ${s.positive_sample} with results`);
console.log(`Negative next step               ${pct(s.negative_rate)}`);
console.log(`Failed or nothing found          ${pct(s.failed_rate)}`);
console.log(`First reply p50 / p90            ${sec(s.first_message_ms.p50)} / ${sec(s.first_message_ms.p90)}`);
console.log(`Result p50 / p90                 ${sec(s.result_ms.p50)} / ${sec(s.result_ms.p90)}`);
console.log(`Cost per sourcing turn           ${s.cost_per_turn_usd === null ? '—' : '$' + s.cost_per_turn_usd.toFixed(3)}\n`);
console.log('Labels: ' + Object.entries(s.labels).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') + '\n');
const rows = report.turns.map(t => [t.at.slice(0, 16).replace('T', ' '), String(t.conversation_id).slice(0, 8), t.request_type, t.result, `${t.verified_shown}/${t.products_shown}`, sec(t.result_ms), '$' + t.cost_usd.toFixed(3), t.headline, t.labels.join(' ')]);
const head = ['when (UTC)', 'conv', 'type', 'result', 'verified', 'result', 'cost', 'outcome', 'labels'];
const all = [head, ...rows], widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
console.log(all.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n'));
