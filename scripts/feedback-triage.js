// Reads developer feedback with surrounding turns for the feedback-triage agent.
// Usage (secrets come from the environment, never from this file):
//   node --env-file=.env.local scripts/feedback-triage.js --latest 1
//   node --env-file=.env.local scripts/feedback-triage.js --since 2026-10-10T00:00:00Z
// Output is private conversation data. Print it or write it outside the repository; never commit it.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStore } from '../lib/store.js';
import { triagePackets } from '../lib/feedback-triage.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const since = option('--since') ?? null, latest = option('--latest') ? Number(option('--latest')) : null, out = option('--out');
if (since && Number.isNaN(Date.parse(since))) throw Error('--since must be an ISO timestamp');
if (latest !== null && !(Number.isInteger(latest) && latest > 0)) throw Error('--latest must be a positive whole number');
if (out && resolve(out).startsWith(resolve('.'))) throw Error('--out must be outside the repository; feedback is private.');

const result = await triagePackets(createStore(process.env), { since, latest });
const text = JSON.stringify(result, null, 2) + '\n';
if (out) { await writeFile(out, text, { mode: 0o600 }); console.log(JSON.stringify({ count: result.count, cursor: result.cursor, out })); }
else process.stdout.write(text);
