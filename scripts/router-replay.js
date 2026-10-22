// Replays past turns through the skill router (lib/skills/router.js) to measure its recall without
// waiting for new traffic: for each recorded reply whose turn kept the tools the agent called, the
// router reads the conversation up to that turn's newest message, and its picks are checked against
// those tools, as router-recall.js does for live shadow turns.
// One router call per turn (small model); nothing is sent and nothing is written.
// The shown options and the newest message's photos are rebuilt as they were; saved items and a waiting
// style question are not, so the result is a cautious estimate.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/router-replay.js --days 60
//   ... --misses   also lists each miss with the router's one-line reading (no quotes or names)
// Output holds counts and job and tool names only: no message text, phone numbers or names.
import { createStore } from '../lib/store.js';
import { routeTurn, routeCoverage, routeRecall } from '../lib/skills/router.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const days = Number(option('--days') ?? 60);
if (!(days > 0)) throw Error('--days must be a positive number');
const store = createStore(process.env);
const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
// Turns that recorded their tools; live shadow turns are left to router-recall.js.
const turns = (await store.metricRows(since)).filter(r => r.direction === 'outbound' && Array.isArray(r.reply_diagnostics?.actions) && !r.reply_diagnostics.skill_route);

const rows = [], misses = {}, detail = [];
let skipped = 0;
for (const turn of turns) {
  const history = await store.feedbackContext(turn.conversation_id, turn.created_at, 14, 0);
  const last = history.findLastIndex(m => m.direction === 'inbound' && m.created_at <= turn.created_at);
  if (last < 0) { skipped++; continue; }
  const messages = history.slice(0, last + 1);
  const photos = messages[last].message_images?.length ?? 0;
  // The shopping state the user saw when they wrote (shown options, the stage), as the frozen evals rebuild it.
  const wishlistState = await store.textWishlistState(turn.conversation_id, messages[last].created_at).catch(() => null);
  // The newest message's photos, as the live router sees them.
  const images = photos ? await store.imagesForMessage(messages[last].id).catch(() => []) : [];
  const route = await routeTurn(messages, { wishlistState, images }, process.env);
  const coverage = routeCoverage(route, turn.reply_diagnostics.actions);
  rows.push({ reply_diagnostics: { skill_route: coverage } });
  if (!coverage.covered) detail.push(`picked ${(route.jobs ?? []).join('+')}${route.confident ? '' : ' (unsure)'}; agent called ${coverage.called.join(', ')}; options shown ${wishlistState?.options?.length ?? 0}${photos ? '; photo' : ''}\n    ${route.reason ?? ''}`);
  if (!coverage.covered) for (const tool of coverage.missed) {
    const key = `${tool} ← picked ${(route.jobs ?? []).join('+') || 'nothing'}${photos ? ' (photo)' : ''}`;
    misses[key] = (misses[key] ?? 0) + 1;
  }
}

const report = routeRecall(rows);
const pct = v => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
console.log(`Skill router replay over recorded turns since ${since}\n`);
console.log(`Turns replayed: ${report.turns} (skipped ${skipped}; unsure ${report.unsure}, failed ${report.failed}; both load every skill)`);
console.log(`Recall: ${pct(report.recall)} of turns covered every tool called; confident picks alone ${pct(report.confident_recall)}. Gate: 98%.`);
console.log(`Skills a turn would load (median, including core): ${report.skills_loaded_median ?? '—'} of 10; router time median ${report.ms_median ?? '—'} ms`);
console.log('Misses (tool the agent called ← what the router picked):');
for (const [k, n] of Object.entries(misses).sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`);
console.log(`Jobs picked: ${Object.entries(report.picked).sort((a, b) => b[1] - a[1]).map(([j, n]) => `${j} ${n}`).join(', ') || 'none'}`);
if (args.includes('--misses')) { console.log('\nEach miss:'); for (const d of detail) console.log('  ' + d); }
