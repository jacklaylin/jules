import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { safeError } from '../lib/reply-failures.js';

const env = { SUPABASE_URL: 'https://db.example.com', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const owner = '11111111-1111-4111-8111-111111111111';
const timeout = () => ({ ok: false, status: 500, json: async () => ({ code: '57014', message: 'canceling statement due to statement timeout' }) });
const rows = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test('a read cancelled by the statement timeout is retried once and succeeds', async () => {
  const calls = [];
  const store = createStore(env, async (_url, options) => { calls.push(options.method); return calls.length === 1 ? timeout() : rows([{ facts: [], version: 3 }]); });
  const profile = await store.profile(owner);
  assert.equal(profile.version, 3);
  assert.deepEqual(calls, ['GET', 'GET']);
});

test('a read that times out twice fails, naming the table but no ids or filters', async () => {
  let calls = 0;
  const store = createStore(env, async () => { calls++; return timeout(); });
  const error = await store.profile(owner).catch(e => e);
  assert.equal(calls, 2, 'retried only once');
  assert.equal(error.database_code, '57014');
  assert.equal(error.database_table, 'taste_profiles');
  assert.equal(safeError(error).database_table, 'taste_profiles');
  assert.ok(!JSON.stringify(safeError(error)).includes('1111'));
});

test('a write that times out is never repeated', async () => {
  let calls = 0;
  const store = createStore(env, async () => { calls++; return timeout(); });
  const error = await store.saveProfile(owner, 1, []).catch(e => e);
  assert.equal(calls, 1);
  assert.equal(error.database_table, 'rpc/save_taste_profile');
});
