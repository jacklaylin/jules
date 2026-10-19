import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { referralRef } from '../lib/referral.js';
import { signupRef } from '../public/signup-ref.js';

// Signups from a link someone shared carry ?ref=u-<code for that person>; Admin credits them to that person.
const env = { SUPABASE_SERVICE_ROLE_KEY: 'test-secret' };
const sharer = '00000000-0000-4000-8000-0000000000a1', friend = '00000000-0000-4000-8000-0000000000a2', other = '00000000-0000-4000-8000-0000000000a3';

test('a referral code is a valid signup source, stable per person, and never their internal ID', () => {
  const ref = referralRef(sharer, env);
  assert.match(ref, /^u-[0-9a-f]{12}$/);
  assert.equal(signupRef(ref), ref, 'survives the signup source check unchanged');
  assert.ok(!ref.includes(sharer.replace(/-/g, '').slice(-12)));
  assert.equal(referralRef(sharer, env), ref, 'the same person always gets the same code');
  assert.notEqual(referralRef(friend, env), ref);
  assert.notEqual(referralRef(sharer, { SUPABASE_SERVICE_ROLE_KEY: 'other-secret' }), ref, 'keyed with the server secret');
  for (const bad of [{}, { SUPABASE_SERVICE_ROLE_KEY: 'replace-with-key' }]) assert.equal(referralRef(sharer, bad), null);
  assert.equal(referralRef('', env), null);
});

function admin() {
  const ids = [sharer, friend, other];
  const store = {
    list: async () => ids.map(id => ({ id, sender_id: id.slice(-2), updated_at: '2026-10-19T00:00:00Z' })),
    signupSources: async () => new Map([['a2', referralRef(sharer, env)], ['a3', 'podcast']]),
    accessFor: async () => new Map(),
    signupNames: async () => new Map([['a1', { first_name: 'jack', last_name: 'l' }]]),
    profilesFor: async () => new Map(),
  };
  return createAdminHandler({ auth: async () => 200, env, storeFactory: () => store });
}

test('Admin credits a signup from a shared link to the person who shared it', async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
  await admin()({ method: 'GET', url: '/api/admin', headers: {} }, res);
  const list = new Map(res.body.conversations.map(c => [c.id, c]));
  assert.deepEqual(list.get(friend).referred_by, { id: sharer, name: 'Jack L' });
  assert.equal(list.get(friend).source, referralRef(sharer, env), 'the raw code is still there');
  assert.equal(list.get(other).referred_by, null, 'other sources are unchanged');
  assert.equal(list.get(other).source, 'podcast');
  assert.equal(list.get(sharer).referred_by, null);
});
