import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// gmail_sweep_tick() decides each minute whether to wake Vercel. Each migration that redefines it
// replaces the whole body, so a copy taken from an older version silently drops later wake-up
// conditions (026 and 039 dropped 024's gmail_profiles_due(); 045 restores it).
const dir = new URL('../db/', import.meta.url);
const definitions = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().flatMap(file => {
  const sql = readFileSync(new URL(file, dir), 'utf8');
  const match = sql.match(/create or replace function public\.gmail_sweep_tick\(\)[\s\S]*?end; \$\$;/i);
  return match ? [{ file, body: match[0] }] : [];
});
const dueChecks = body => [...body.matchAll(/\b(\w+_due)\(\)/g)].map(m => m[1]);

test('the latest gmail_sweep_tick() keeps every due-function wake-up an earlier version had', () => {
  const latest = definitions.at(-1);
  const kept = new Set(dueChecks(latest.body));
  for (const { file, body } of definitions.slice(0, -1))
    for (const name of dueChecks(body)) assert.ok(kept.has(name), `${latest.file} still wakes the sweep for ${name}() (added in ${file})`);
});

test('the latest gmail_sweep_tick() wakes for stuck imports and the 24-hour profile text', () => {
  const { body } = definitions.at(-1);
  assert.match(body, /from gmail_imports where/);
  assert.match(body, /not exists\(select 1 from gmail_profiles_due\(\)\)/);
  assert.match(body, /site_origin\(\)\|\|'\/api\/wishlist\?gmail=sweep'/);
});
