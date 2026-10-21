// How well the shadow skill router (lib/skills/router.js) picked each turn's skills, from the
// production message log: the share of turns whose loaded skills covered every tool the agent called.
// Selective loading (CHAT-SKILLS.md step 12) waits for at least 98%.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/router-recall.js            # last 7 days
//   node --env-file=.env.local scripts/router-recall.js --days 2 --json
// Output holds counts and tool and skill names only: no message text, phone numbers or names.
import { createStore } from '../lib/store.js';
import { routeRecall } from '../lib/skills/router.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const days = option('--days') ? Number(option('--days')) : 7, json = args.includes('--json');
if (!(days > 0)) throw Error('--days must be a positive number');

const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
const report = routeRecall(await createStore(process.env).metricRows(since));
if (json) { process.stdout.write(JSON.stringify({ since, ...report }, null, 2) + '\n'); process.exit(0); }
const pct = v => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
console.log(`Skill router, shadow mode, since ${since}\n`);
console.log(`Turns with a route: ${report.turns} (unsure ${report.unsure}, failed ${report.failed}; both load every skill)`);
console.log(`Recall: ${pct(report.recall)} of turns covered every tool called; confident picks alone ${pct(report.confident_recall)}. Gate: 98%.`);
console.log(`Skills a turn would load (median, including core): ${report.skills_loaded_median ?? '—'} of 10; router time median ${report.ms_median ?? '—'} ms`);
console.log(`Missed tools: ${Object.entries(report.missed_tools).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`);
console.log(`Jobs picked: ${Object.entries(report.picked).sort((a, b) => b[1] - a[1]).map(([j, n]) => `${j} ${n}`).join(', ') || 'none'}`);
