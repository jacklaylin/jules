// Evals only: a stored answer for model requests that depend on the case alone, never on the chat code under test.
// The profile check (lib/memory.js profileCheck, gpt-4.1, about a third of a frozen run's cost) reads the
// conversation and saved facts, and nothing the agent writes, so main, the PR and every one of the ×3 runs send it
// the same request. The key is the whole request body: a change to the check's model, instructions or input is a
// new request and is sent. The stored answer is one sample of the check, reused, so it adds no variance of its own.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const CACHED_REQUESTS = ['profile_check'];
const stored = text => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text, clone() { return stored(text); } });

export async function evalCache(file, { names = CACHED_REQUESTS } = {}) {
  const answers = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
  const stats = { hits: 0, misses: 0 };
  const fetcher = async (url, options) => {
    let name = null;
    try { name = JSON.parse(options?.body ?? '{}')?.text?.format?.name ?? null; } catch { /* not JSON */ }
    if (!names.includes(name)) return globalThis.fetch(url, options);
    const key = createHash('sha256').update(String(options.body)).digest('hex');
    if (answers[key]) { stats.hits++; return stored(answers[key]); }
    stats.misses++;
    const response = await globalThis.fetch(url, options);
    if (response.ok) { const text = await response.clone().text(); try { if (JSON.parse(text).status === 'completed') answers[key] = text; } catch { /* not stored */ } }
    return response;
  };
  const save = async () => { await mkdir(dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, JSON.stringify(answers), { mode: 0o600 }); };
  return { fetcher, save, stats };
}
