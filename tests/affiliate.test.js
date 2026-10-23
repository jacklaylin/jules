import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affiliateURL } from '../lib/affiliate.js';
import { createGoHandler, goLink } from '../lib/adoption-events.js';
import { wishlistGoLink } from '../lib/wishlist-go.js';

const A = '00000000-0000-4000-8000-00000000000a', KEY = 'abc123def456abc123def456abc12345';
const on = { AFFILIATE_ENABLED: 'true', SOVRN_CAMPAIGN_KEY: KEY };

test('a store link is wrapped in Sovrn’s redirect only when switched on, with an opaque tracking id', () => {
  const url = affiliateURL('https://shop.example/coat?colour=black&utm_source=ig', { env: on, ref: 'ai:m1:0', medium: 'sms' });
  const u = new URL(url);
  assert.equal(u.origin, 'https://redirect.viglink.com');
  assert.equal(u.searchParams.get('key'), KEY);
  assert.equal(u.searchParams.get('u'), 'https://shop.example/coat?colour=black', 'the same store page, without ad tracking');
  assert.match(u.searchParams.get('cuid'), /^[a-f0-9]{24}$/);
  assert.equal(u.searchParams.get('cuid'), new URL(affiliateURL('https://shop.example/other', { env: on, ref: 'ai:m1:0', medium: 'sms' })).searchParams.get('cuid'), 'the id comes from the tap, so it can be matched later');
  assert.equal(u.searchParams.get('utm_medium'), 'sms');
  assert.equal(u.searchParams.has('cp'), false, 'never Sovrn’s other-retailer fallback');
  assert.ok(!url.includes(A) && !url.includes('ai:m1'), 'no ids in the outgoing link');
  for (const env of [{}, { ...on, AFFILIATE_ENABLED: 'false' }, { AFFILIATE_ENABLED: 'true' }, { ...on, SOVRN_CAMPAIGN_KEY: 'replace-with-sovrn-api-key' }, { ...on, SOVRN_CAMPAIGN_KEY: 'bad key&u=x' }])
    assert.equal(affiliateURL('https://shop.example/coat', { env, ref: 'r', medium: 'sms' }), null);
  assert.equal(affiliateURL('http://shop.example/coat', { env: on, ref: 'r', medium: 'sms' }), null);
  assert.equal(affiliateURL('https://shop.example/coat?afsrc=1', { env: on, ref: 'r', medium: 'sms' }), null, 'already an affiliate link');
  assert.equal(affiliateURL('https://shop.example/' + 'x'.repeat(2100), { env: on, ref: 'r', medium: 'sms' }), null, 'too long for a browser');
});

const result = { products: [{ url: 'https://shop.example/coat', name: 'Coat' }], checkout_links: [{ url: 'https://shop.example/coat', checkout_url: 'https://shop.example/cart/1', store: 'Shop' }] };
async function tap(token, env, { method = 'GET', agent = 'Mozilla/5.0 (iPhone)' } = {}) {
  const store = { replyResult: async () => ({ conversation_id: A, search_result: result }), recordAdoptionEvent: async () => {} };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() {} };
  await createGoHandler({ env, store })({ method, url: `/api/image?go=${encodeURIComponent(token)}`, headers: { 'user-agent': agent } }, res);
  return res;
}

test('a person’s tap goes through Sovrn to the same store; off, previews, HEAD and carts go straight there', async () => {
  const base = { SITE_ORIGIN: 'https://jules.example', SUPABASE_SERVICE_ROLE_KEY: 'secret' }, env = { ...base, ...on };
  const product = goLink('ai:m1', 0, env).split('/go/')[1], cart = goLink('ai:m1', 2, env).split('/go/')[1];
  const off = await tap(product, base);
  assert.equal(off.headers.Location, 'https://shop.example/coat'); assert.equal(off.headers['Referrer-Policy'], 'no-referrer', 'switched off, nothing changes');
  const res = await tap(product, env);
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get('u'), 'https://shop.example/coat');
  assert.equal(res.headers['Referrer-Policy'], 'origin', 'Sovrn sees the tap came from Jules, not the link token');
  assert.equal((await tap(product, env, { method: 'HEAD' })).headers.Location, 'https://shop.example/coat');
  assert.equal((await tap(product, env, { agent: 'facebookexternalhit/1.1' })).statusCode, 200, 'a preview fetcher still gets the preview page');
  assert.equal((await tap(cart, env)).headers.Location, 'https://shop.example/cart/1', 'a Shop cart link is not wrapped');
  const wishlist = wishlistGoLink(A, 'group-1', 'https://shop.example/coat', env).slice(4);
  const saved = await tap(wishlist, env);
  assert.equal(new URL(saved.headers.Location).searchParams.get('utm_medium'), 'wishlist');
  assert.equal((await tap(wishlist, env, { agent: 'Slackbot-LinkExpanding 1.0' })).headers.Location, 'https://shop.example/coat');
  assert.equal((await tap(wishlist, { ...base, AFFILIATE_ENABLED: 'true', SOVRN_CAMPAIGN_KEY: 'replace-with-sovrn-api-key' })).headers.Location, 'https://shop.example/coat', 'a missing key forwards straight to the store');
});
