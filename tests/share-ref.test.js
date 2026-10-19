import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { shareRef } from '../lib/style-report.js';
import { signupRef } from '../public/signup-ref.js';

// Signups from one person's share link carry ?ref=r-<hash of the link>; Admin credits them to that person.
const sharer = '00000000-0000-4000-8000-0000000000a1', friend = '00000000-0000-4000-8000-0000000000a2', other = '00000000-0000-4000-8000-0000000000a3';
const token = 'AbCdEfGhIjKlMnOpQrStUv';

test('a share ref is a valid signup source that never contains the share link', () => {
  const ref = shareRef(token);
  assert.match(ref, /^r-[0-9a-f]{12}$/);
  assert.equal(signupRef(ref), ref, 'survives the signup source check unchanged');
  assert.ok(!ref.includes(token) && !ref.toLowerCase().includes(token.toLowerCase().slice(0, 6)));
  assert.equal(shareRef(token), ref, 'the same link always gives the same ref');
  assert.notEqual(shareRef('ZyXwVuTsRqPoNmLkJiHgFe'), ref);
});

function admin(shareLinks = async () => [{ conversation_id: sharer, token }]) {
  const ids = [sharer, friend, other];
  const store = {
    list: async () => ids.map(id => ({ id, sender_id: id.slice(-2), updated_at: '2026-10-19T00:00:00Z' })),
    signupSources: async () => new Map([['a2', shareRef(token)], ['a3', 'podcast']]),
    shareLinks,
    accessFor: async () => new Map(),
    signupNames: async () => new Map([['a1', { first_name: 'jack', last_name: 'l' }]]),
    profilesFor: async () => new Map(),
  };
  return createAdminHandler({ auth: async () => 200, env: {}, storeFactory: () => store });
}
async function people(handler) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'GET', url: '/api/admin', headers: {} }, res);
  return new Map(res.body.conversations.map(c => [c.id, c]));
}

test('Admin credits a signup from a share link to the person who shared it', async () => {
  const list = await people(admin());
  assert.deepEqual(list.get(friend).referred_by, { id: sharer, name: 'Jack L' });
  assert.equal(list.get(other).referred_by, null, 'other sources are unchanged');
  assert.equal(list.get(other).source, 'podcast');
  assert.equal(list.get(sharer).referred_by, null);
});

test('the people list still loads when share links cannot be read', async () => {
  const list = await people(admin(async () => { throw new Error('database down'); }));
  assert.equal(list.get(friend).referred_by, null);
  assert.equal(list.get(friend).source, shareRef(token));
});
