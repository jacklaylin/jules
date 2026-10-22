// Chat quality numbers from the production message log: wait times, failed replies, fixed-text
// versus model-written replies, and named products found on the first search.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/chat-metrics.js                 # last 7 days vs the 7 before
//   node --env-file=.env.local scripts/chat-metrics.js --days 14
//   node --env-file=.env.local scripts/chat-metrics.js --since 2026-10-10T00:00:00Z --json
// Output holds counts and short conversation ids only: no message text, phone numbers or names.
import { createStore } from '../lib/store.js';
import { loadChatMetrics, metricsTrend } from '../lib/chat-metrics.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const days = option('--days') ? Number(option('--days')) : 7, since = option('--since') ?? null, json = args.includes('--json');
if (!(days > 0)) throw Error('--days must be a positive number');
if (since && Number.isNaN(Date.parse(since))) throw Error('--since must be an ISO timestamp');

const store = createStore(process.env);
const start = since ?? new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
const [metrics, trend] = await Promise.all([loadChatMetrics(store, { since: start }), metricsTrend(store, { days })]);
if (json) { process.stdout.write(JSON.stringify({ ...metrics, trend }, null, 2) + '\n'); process.exit(0); }

const pct = v => v === null ? '—' : `${Math.round(v * 100)}%`, sec = v => v === null ? '—' : `${v}s`;
const row = s => [s.turns, sec(s.first_message_s.median), sec(s.final_result_s.median), sec(s.final_result_s.p90), `${s.fallbacks + s.stuck}`, pct(s.model_written_share), s.named_accepted ? `${s.first_try}/${s.named_accepted}` : '—', s.messages_per_turn ?? '—', s.messages_per_search_turn ?? '—'];
const table = (label, rows) => {
  const head = [label, 'turns', 'first msg', 'result', 'result p90', 'failed', 'model text', 'first-try find', 'msgs/turn', 'msgs/search'];
  const all = [head, ...rows].map(r => r.map(String)), widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  console.log(all.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n') + '\n');
};
const s = metrics.summary;
console.log(`Chat metrics since ${start} (days are UTC)\n`);
console.log(`Turns: ${s.turns} (${s.timed_turns} timed; timing ${Object.entries(metrics.timing_sources).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`);
console.log(`Time to first message: median ${sec(s.first_message_s.median)}, p90 ${sec(s.first_message_s.p90)}`);
console.log(`Time to final result:  median ${sec(s.final_result_s.median)}, p90 ${sec(s.final_result_s.p90)}, max ${sec(s.final_result_s.max)}`);
console.log(`Messages per turn: ${s.messages_per_turn ?? '—'} (search turns ${s.messages_per_search_turn ?? '—'}); one message only: ${pct(s.single_message_share)}`);
console.log(`Failed replies: ${s.fallbacks} generic fallbacks + ${s.stuck} never delivered = ${pct(s.failure_rate)} of turns`);
console.log(`Reply text: ${s.composed_by.model} model-written, ${s.composed_by.template} fixed template, ${s.composed_by.mixed} mixed, ${s.composed_by.unknown} unknown → ${pct(s.model_written_share)} model-written`);
console.log(`Named-product searches: ${s.named_searches}; accepted ${s.named_accepted}: ${s.first_try} first try, ${s.after_retry} after a retry, ${s.user_supplied} user supplied it → first-try rate ${pct(s.first_try_rate)}\n`);
table('day', metrics.by_day.map(d => [d.day, ...row(d)]));
table('conversation', metrics.by_conversation.map(c => [c.conversation, ...row(c)]));
console.log(`Last ${days} days vs the ${days} before:`);
for (const m of trend.moved) console.log(`  ${m.metric.padEnd(24)} ${String(m.before ?? '—').padStart(6)} (n=${m.before_n}) → ${String(m.after ?? '—').padEnd(6)} (n=${m.after_n})  ${m.verdict}`);
