// How many tokens of profile the chat agent reads per round for one person (saved_profile in lib/ai.js),
// whole and per source, and what each kind of turn would send with context routing on
// (CHAT_CONTEXT_ROUTING, lib/skills/router.js). Read-only. Tokens are estimated as characters ÷ 4.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/profile-size.js <conversation id>
// Output holds counts and source names only: no profile text, phone numbers or names.
import { createStore } from '../lib/store.js';
import { readUserContext, DERIVED_FIELDS } from '../lib/user-context.js';
import { profileSources } from '../lib/skills/router.js';

const owner = process.argv[2];
if (!owner) throw Error('Pass a conversation id');
const { facts } = await readUserContext(createStore(process.env), owner, process.env, { log: () => {} });
const row = f => JSON.stringify({ field: f.field, key: f.key, value: f.value, basis: f.basis }).length;
const live = facts.filter(f => !f.deleted), tokens = list => Math.round((JSON.stringify(list.map(f => ({ field: f.field, key: f.key, value: f.value, basis: f.basis }))).length) / 4);
const bySource = {};
for (const f of live) { const k = DERIVED_FIELDS.includes(f.field) ? f.field : 'stated'; bySource[k] = (bySource[k] ?? 0) + row(f); }
console.log(`saved_profile: ${tokens(live)} tokens`);
for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${Math.round(v / 4)}`);
console.log('With context routing on, by the job the router picks:');
for (const job of ['find_exact', 'explore', 'options', 'profile', 'conversation', 'history', 'save_or_watch', 'saved_items']) {
  const sources = profileSources(['core', job]);
  console.log(`  ${job}: ${tokens(live.filter(f => !sources || !DERIVED_FIELDS.includes(f.field) || sources.includes(f.field)))}`);
}
