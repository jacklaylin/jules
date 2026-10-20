import test from 'node:test';
import assert from 'node:assert/strict';
import { scanItem, scanSavedItems, scanKey, scanQuery, excludedSites, candidatePages } from '../lib/store-scan.js';
import { groupWishlist } from '../lib/wishlist.js';

const env = { SERPAPI_API_KEY: 'fixture', SHOPPING_COUNTRY: 'US', SHOPPING_CURRENCY: 'USD' };
const lemaireURL = 'https://www.lemaire.fr/products/biker-blouson-unisex-black-paper-cow-leather-ow1211-ll0175-bk999';
const product = {
  brand: 'LEMAIRE', name: 'BIKER BLOUSON IN PAPER COW LEATHER', selected_color: null,
  listing_check: { product_sku: 'OW1211 LL0175_BK999_S', color: 'Black' },
  links: [{ url: lemaireURL, price_snapshot: { amount: 3395, currency: 'USD', source_url: lemaireURL, checked_at: '2026-10-20T00:00:00Z' } }],
};
const ssense = 'https://www.ssense.com/en-us/men/product/lemaire/black-leather-biker-jacket/18940241';
const farfetch = 'https://www.farfetch.com/shopping/men/lemaire-biker-blouson-in-leather-item-34275682.aspx';
const page = (url, extra = {}) => ({ status: 'verified', url, checked_at: '2026-10-20T00:00:00Z', product_brand: 'Lemaire', product_name: 'Black Leather Biker Jacket', product_sku: '261646M181000', price_status: 'found', price_snapshot: { amount: 2682, currency: 'USD', source_url: url, checked_at: '2026-10-20T00:00:00Z' }, ...extra });
const results = links => async params => { assert.equal(params.engine, 'google'); return { organic_results: links.map(link => ({ link })) }; };
const emptyStore = () => ({ scans: [], storeScan: async () => null, async saveStoreScan(key, result) { this.scans.push({ key, result }); } });
// The model check, replaced: the saved listing (0) is the same product as every listing named here.
const sameAs = (...urls) => async listings => [[0, ...listings.map((l, i) => urls.includes(l.url) ? i : -1).filter(i => i > 0)]];

test('the search leaves out the stores on the card and the brand’s own site, and names the colour once', () => {
  const exclude = excludedSites(product);
  assert.ok(exclude.includes('lemaire.fr'));
  const q = scanQuery(product, exclude);
  assert.match(q, /^LEMAIRE BIKER BLOUSON IN PAPER COW LEATHER Black /);
  assert.match(q, /-site:lemaire\.fr/);
  assert.doesNotMatch(scanQuery({ ...product, name: 'Lemaire Biker Blouson Black' }, []), /Black Black|LEMAIRE Lemaire/i);
});

test('only trusted stores’ pages are read, one per store, never a store already on the card', () => {
  const pages = candidatePages([
    { link: lemaireURL }, { link: ssense }, { link: ssense + '?color=black' }, { link: 'https://www.bluefly.com/products/lemaire' },
    { link: 'https://www.ssense-sale.shop/lemaire' }, { link: farfetch }, { link: 'https://www.mrporter.com/en-us/mens/product/lemaire/1' }, { link: 'https://www.mytheresa.com/us/en/men/lemaire' },
  ], ['lemaire.fr'], 'LEMAIRE');
  assert.deepEqual(pages.map(u => new URL(u).hostname), ['www.ssense.com', 'www.farfetch.com', 'www.mrporter.com']);
});

test('a store is added only when its own page is this product for less, decided by the same-product check', async () => {
  const reads = [];
  const verify = async (url, name) => {
    reads.push(name);
    if (url === farfetch) return page(url, { product_name: 'Biker Blouson in Leather', price_snapshot: { amount: 3395, currency: 'USD', source_url: url } }); // not cheaper
    return page(url);
  };
  const same = async listings => { assert.equal(listings.length, 2, 'only cheaper pages are compared'); return sameAs(ssense)(listings); };
  const store = emptyStore();
  const result = await scanItem(product, { env, search: results([ssense, farfetch]), verify, same, store });
  assert.equal(result.searches, 1, 'one search; reading store pages costs none');
  assert.deepEqual(reads, [null, null], 'pages are read without the saved name');
  assert.deepEqual(result.offers.map(o => [o.url, o.price_snapshot.amount, o.retailer]), [[ssense, 2682, 'SSENSE']]);
  assert.deepEqual(result.checked.map(c => c.outcome).sort(), ['not_cheaper', 'verified']);
  assert.equal(store.scans.length, 1); assert.equal(store.scans[0].key, scanKey(product));
});

test('a cheaper page the check does not confirm is never added; a shared product code is enough', async () => {
  const notSame = async () => [];
  const different = await scanItem(product, { env, search: results([ssense]), verify: async url => page(url), same: notSame, store: emptyStore() });
  assert.equal(different.offers.length, 0); assert.equal(different.checked[0].outcome, 'different_product');
  const coded = await scanItem(product, { env, search: results([ssense]), verify: async url => page(url, { product_sku: 'ow1211 ll0175_bk999_s' }), same: notSame, store: emptyStore() });
  assert.equal(coded.offers.length, 1);
});

test('unreadable, sold-out, priceless or other-brand pages are set aside before any model check', async () => {
  const same = async () => assert.fail('nothing cheaper to compare');
  for (const [check, outcome] of [
    [{ status: 'check_failed' }, 'page_unreadable'],
    [page(ssense, { verification_basis: 'search_index' }), 'page_unreadable'],
    [page(ssense, { availability: 'OutOfStock' }), 'sold_out'],
    [page(ssense, { price_snapshot: null }), 'no_page_price'],
    [page(ssense, { product_brand: 'Acne Studios' }), 'different_brand'],
  ]) {
    const result = await scanItem(product, { env, search: results([ssense]), verify: async () => check, same, store: emptyStore() });
    assert.equal(result.offers.length, 0); assert.equal(result.checked[0].outcome, outcome);
  }
});

test('another person’s scan today is reused with no search, compared against this person’s price', async () => {
  const offer = { url: ssense, retailer: 'SSENSE', price_snapshot: { amount: 2682, currency: 'USD', source_url: ssense, checked_at: '2026-10-20T00:00:00Z' } };
  const store = { storeScan: async () => ({ scanned_at: new Date().toISOString(), result: { offers: [offer] } }) };
  const none = async () => assert.fail('no search when a fresh shared scan exists');
  assert.equal((await scanItem(product, { env, search: none, verify: none, same: none, store })).offers.length, 1);
  const cheaperSaved = { ...product, links: [{ ...product.links[0], price_snapshot: { ...product.links[0].price_snapshot, amount: 2700 } }] };
  assert.equal((await scanItem(cheaperSaved, { env, search: none, verify: none, same: none, store })).offers.length, 0, 'under a 3% saving');
  const stale = { storeScan: async () => ({ scanned_at: '2026-01-01T00:00:00Z', result: { offers: [offer] } }), saveStoreScan: async () => {} };
  assert.equal((await scanItem(product, { env, search: results([]), verify: none, same: none, store: stale })).source, 'search');
});

test('no saved price, no product identity or another currency spends nothing', async () => {
  const none = async () => assert.fail('no search');
  for (const [item, reason] of [
    [{ ...product, links: [{ url: lemaireURL }] }, 'no_saved_price'],
    [{ ...product, brand: null }, 'no_product_identity'],
    [{ ...product, links: [{ ...product.links[0], price_snapshot: { ...product.links[0].price_snapshot, currency: 'EUR' } }] }, 'other_currency'],
  ]) assert.equal((await scanItem(item, { env, search: none, verify: none, same: none, store: emptyStore() })).reason, reason);
});

test('found stores join the saved item with sizes unconfirmed and show on the card that way', async () => {
  const added = [];
  const store = { ...emptyStore(), savedWishlistItems: async () => [{ id: 'item-1', conversation_id: 'c-1', product }], addWishlistLinks: async (conversation, id, links) => { added.push({ conversation, id, links }); return links.length; } };
  const [result] = await scanSavedItems({ store, operation: 'op-1', env, search: results([ssense]), verify: async url => page(url), same: sameAs(ssense) });
  assert.equal(result.added, 1);
  const [link] = added[0].links;
  assert.equal(link.discovered.sizes, 'unconfirmed'); assert.equal(link.availability, null);
  const [card] = groupWishlist([{ item_id: 'item-1', reply_id: 'r', text_origin: true, brand: product.brand, name: product.name, links: [...product.links, link], messages: { created_at: '2026-10-20' } }], { currency: 'USD' });
  const found = card.links.find(l => l.url === ssense);
  assert.equal(found.discovered, true); assert.equal(found.price.amount, 2682);
  assert.deepEqual(card.price_ranges, [{ currency: 'USD', min: 2682, max: 3395 }]);
  const none = async () => assert.fail('no scan without a search key');
  assert.deepEqual(await scanSavedItems({ store, operation: 'op-1', env: { ...env, SERPAPI_API_KEY: '' }, search: none, verify: none, same: none }), []);
});
