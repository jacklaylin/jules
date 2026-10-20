import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates, titleMatches, colorAccepted, sameProduct, scanItem, scanSavedItems, scanKey, registryStore } from '../lib/store-scan.js';
import { serpApiJSON, recentShoppingResults } from '../lib/serpapi.js';
import { groupWishlist } from '../lib/wishlist.js';

const env = { SERPAPI_API_KEY: 'fixture', SHOPPING_COUNTRY: 'US', SHOPPING_CURRENCY: 'USD' };
const product = {
  brand: 'Barbour', name: 'Paul Smith Loves Barbour Transport Windowpane Waxed Jacket', selected_color: null,
  listing_check: { product_sku: 'MWX2611BR71', color: null },
  links: [{ url: 'https://www.barbour.com/us/transport-MWX2611BR71.html', price_snapshot: { amount: 700, currency: 'USD', source_url: 'https://www.barbour.com/us/transport-MWX2611BR71.html', checked_at: '2026-10-10T00:00:00Z' } }],
};
const row = (source, title, price, token = source) => ({ source, title, extracted_price: price, immersive_product_page_token: token });
const endRow = row('END. Clothing', 'Barbour x Paul Smith Transport Windowpane Wax Jacket', 560, 'end');
const page = (url, extra = {}) => ({ status: 'verified', url, checked_at: '2026-10-20T00:00:00Z', product_brand: 'Barbour', product_name: 'Barbour x Paul Smith Transport Windowpane Wax Jacket', product_sku: 'MWX2611BR71', price_status: 'found', price_snapshot: { amount: 560, currency: 'USD', source_url: url, checked_at: '2026-10-20T00:00:00Z' }, ...extra });
const endURL = 'https://www.endclothing.com/us/barbour-x-paul-smith-transport-mwx2611br71.html';
const emptyStore = () => ({ scans: [], storeScan: async () => null, async saveStoreScan(key, result) { this.scans.push({ key, result }); } });

test('only trusted stores listing this product clearly cheaper are worth a lookup, one per store', () => {
  const rows = [
    endRow,
    row('END. Clothing', 'Barbour x Paul Smith Transport Windowpane Wax Jacket', 590, 'end-2'),
    row('Bluefly', 'Barbour Paul Smith Transport Windowpane Waxed Jacket', 400),        // not a trusted store
    row('Barbour', 'Paul Smith Loves Barbour Transport Windowpane Waxed Jacket', 500),   // the saved store
    row('Farfetch', 'Barbour x Paul Smith Transport Windowpane Wax Jacket', 690),       // under a 3% saving
    row('SSENSE', 'Barbour Bedale Wax Jacket', 300),                                    // a different product
    row('Mytheresa', 'Barbour x Paul Smith Transport Windowpane Waxed Jacket', 620),
    row('Neiman Marcus', 'Barbour Paul Smith Transport Windowpane Waxed Jacket', 610),
  ];
  const picked = pickCandidates(rows, { brand: product.brand, name: product.name, saved: { amount: 700 }, exclude: ['barbour.com'] });
  assert.deepEqual(picked.map(c => [c.store.domain, c.price]), [['endclothing.com', 560], ['neimanmarcus.com', 610]]);
  assert.equal(registryStore('Bluefly'), null);
  assert.equal(registryStore('farfetch.com').domain, 'farfetch.com');
});

test('a listing naming the saved colour is preferred over a cheaper one that does not', () => {
  const rows = [row('Farfetch', 'Prada Speedrock Re-Nylon and suede sneakers Black', 900, 'black'), row('Farfetch', 'Prada Speedrock Re-Nylon and suede sneakers Ivory', 1000, 'ivory')];
  const [picked] = pickCandidates(rows, { brand: 'Prada', name: 'Speedrock Re-Nylon and suede sneakers', color: 'Ivory', saved: { amount: 1170 } });
  assert.equal(picked.token, 'ivory');
});

test('product identity: the same product code, or the brand and most of its words, across store wording', () => {
  assert.ok(titleMatches('Barbour x Paul Smith Transport Windowpane Wax Jacket', product));
  assert.ok(!titleMatches('Barbour x Paul Smith Corduroy Collar Jacket', product));
  assert.ok(!titleMatches('Paul Smith Transport Windowpane Waxed Jacket', product), 'the brand must be named');
  assert.ok(sameProduct({ product_name: 'Something else entirely', product_sku: 'mwx2611br71' }, { ...product, sku: 'MWX2611BR71' }));
  assert.ok(!sameProduct({ product_brand: 'Prada', product_name: 'Collapse Re-Nylon and suede sneakers' }, { brand: 'Prada', name: 'Speedrock Re-Nylon and suede sneakers' }));
});

test('colour: the page colour, a single-priced page selling the colour, or a listing that named it', () => {
  assert.ok(colorAccepted({ color: 'ivory' }, 'Ivory', ''));
  assert.ok(!colorAccepted({ color: 'Black' }, 'Ivory', 'Ivory'));
  assert.ok(colorAccepted({ color: 'Black', color_options: [{ color: 'Ivory' }], price_status: 'found' }, 'Ivory', ''));
  assert.ok(!colorAccepted({ color: 'Black', color_options: [{ color: 'Ivory' }], price_status: 'variant_prices' }, 'Ivory', ''));
  assert.ok(colorAccepted({}, 'Ivory', 'Prada Speedrock Ivory'));
  assert.ok(!colorAccepted({}, 'Ivory', 'Prada Speedrock'));
  assert.ok(colorAccepted({ color: 'Black' }, null, ''));
});

test('a scan adds a store only when its own page shows this product for less; Google’s price is never used', async () => {
  const calls = [], reads = [];
  const search = async params => {
    calls.push(params.engine);
    if (params.engine === 'google_shopping') return { shopping_results: [endRow, row('Neiman Marcus', 'Barbour Paul Smith Transport Windowpane Waxed Jacket', 610, 'nm'), row('Mytheresa', 'Barbour Paul Smith Transport Windowpane Waxed Jacket', 600, 'my')] };
    const link = { end: endURL, nm: 'https://www.neimanmarcus.com/p/barbour-transport', my: 'https://www.mytheresa.com/us/en/men/barbour-transport' }[params.page_token];
    return { product_results: { stores: [{ name: 'Store', link }] } };
  };
  const verify = async (url, name) => {
    reads.push(name);
    if (url.includes('neimanmarcus')) return page(url, { price_snapshot: { amount: 720, currency: 'USD', source_url: url } }); // page price higher than Google's
    if (url.includes('mytheresa')) return { status: 'check_failed' };
    return page(url);
  };
  const store = emptyStore();
  const result = await scanItem(product, { env, search, verify, store, recent: () => [] });
  assert.equal(result.source, 'search');
  assert.equal(result.searches, 3, 'one Shopping search and one link lookup per store worth checking');
  assert.deepEqual(calls.sort(), ['google_immersive_product', 'google_immersive_product', 'google_shopping']);
  assert.deepEqual(reads, [null, null], 'pages are read without the saved name; identity is checked after');
  assert.deepEqual(result.offers.map(o => [o.url, o.price_snapshot.amount]), [[endURL, 560]]);
  assert.deepEqual(result.checked.map(c => c.outcome).sort(), ['page_unreadable', 'verified']);
  assert.equal(store.scans.length, 1, 'a full scan is shared with other people saving this product');
  assert.equal(store.scans[0].key, scanKey(product));
});

test('the identifying search’s results are read first, so a save can cost no Shopping search', async () => {
  const calls = [];
  const search = async params => { calls.push(params.engine); return { product_results: { stores: [{ link: endURL }] } }; };
  const store = emptyStore();
  const result = await scanItem(product, { env, search, verify: async url => page(url), store, recent: () => [endRow] });
  assert.equal(result.source, 'recent');
  assert.deepEqual(calls, ['google_immersive_product']);
  assert.equal(result.offers.length, 1);
  assert.equal(store.scans.length, 0, 'a partial view of the stores is not shared');
});

test('another person’s scan today is reused with no searches, compared against this person’s price', async () => {
  const offer = { url: endURL, retailer: 'END.', price_snapshot: { amount: 560, currency: 'USD', source_url: endURL, checked_at: '2026-10-20T00:00:00Z' } };
  const store = { storeScan: async () => ({ scanned_at: new Date().toISOString(), result: { offers: [offer] } }) };
  const search = async () => assert.fail('no search when a fresh shared scan exists');
  assert.equal((await scanItem(product, { env, search, verify: search, store })).offers.length, 1);
  const cheaperSaved = { ...product, links: [{ ...product.links[0], price_snapshot: { ...product.links[0].price_snapshot, amount: 570 } }] };
  assert.equal((await scanItem(cheaperSaved, { env, search, verify: search, store })).offers.length, 0, '$10 less is under a 3% saving');
  const stale = { storeScan: async () => ({ scanned_at: '2026-01-01T00:00:00Z', result: { offers: [offer] } }), saveStoreScan: async () => {} };
  const fresh = await scanItem(product, { env, search: async () => ({ shopping_results: [] }), verify: search, store: stale, recent: () => [] });
  assert.equal(fresh.source, 'search');
});

test('different product, colour or a sold-out page is never added', async () => {
  const search = async params => params.engine === 'google_shopping' ? { shopping_results: [endRow] } : { product_results: { stores: [{ link: endURL }] } };
  for (const [check, outcome] of [
    [page(endURL, { product_name: 'Barbour x Paul Smith Corduroy Collar Jacket', product_sku: 'OTHER' }), 'different_product'],
    [page(endURL, { availability: 'OutOfStock' }), 'sold_out'],
    [page(endURL, { color: 'Navy' }), 'color_mismatch'],
    [page(endURL, { price_snapshot: null }), 'no_page_price'],
    [page(endURL, { verification_basis: 'search_index' }), 'page_unreadable'],
  ]) {
    const result = await scanItem({ ...product, selected_color: 'Brown' }, { env, search, verify: async () => check, store: emptyStore(), recent: () => [] });
    assert.equal(result.offers.length, 0); assert.equal(result.checked[0].outcome, outcome);
  }
  const untrusted = async params => params.engine === 'google_shopping' ? { shopping_results: [endRow] } : { product_results: { stores: [{ link: 'https://endclothlng.com/p/1' }] } };
  const result = await scanItem(product, { env, search: untrusted, verify: async () => assert.fail('an untrusted link is never read'), store: emptyStore(), recent: () => [] });
  assert.equal(result.checked[0].outcome, 'untrusted_link');
});

test('no saved price, no product identity or another currency spends nothing', async () => {
  const search = async () => assert.fail('no search');
  for (const [item, reason] of [
    [{ ...product, links: [{ url: product.links[0].url }] }, 'no_saved_price'],
    [{ ...product, brand: null }, 'no_product_identity'],
    [{ ...product, links: [{ ...product.links[0], price_snapshot: { ...product.links[0].price_snapshot, currency: 'EUR' } }] }, 'other_currency'],
  ]) assert.equal((await scanItem(item, { env, search, verify: search, store: emptyStore() })).reason, reason);
});

test('found stores join the saved item with sizes unconfirmed and show on the card that way', async () => {
  const added = [];
  const store = { ...emptyStore(), savedWishlistItems: async () => [{ id: 'item-1', conversation_id: 'c-1', product }], addWishlistLinks: async (conversation, id, links) => { added.push({ conversation, id, links }); return links.length; } };
  const search = async params => params.engine === 'google_shopping' ? { shopping_results: [endRow] } : { product_results: { stores: [{ link: endURL }] } };
  const [result] = await scanSavedItems({ store, operation: 'op-1', env, search, verify: async url => page(url) });
  assert.equal(result.added, 1);
  const [link] = added[0].links;
  assert.equal(added[0].id, 'item-1');
  assert.equal(link.discovered.sizes, 'unconfirmed'); assert.equal(link.availability, null);
  const [card] = groupWishlist([{ item_id: 'item-1', reply_id: 'r', text_origin: true, brand: product.brand, name: product.name, links: [...product.links, link], messages: { created_at: '2026-10-20' } }], { currency: 'USD' });
  const found = card.links.find(l => l.url === endURL);
  assert.equal(found.discovered, true); assert.equal(found.price.amount, 560);
  assert.deepEqual(card.price_ranges, [{ currency: 'USD', min: 560, max: 700 }]);
  assert.deepEqual(await scanSavedItems({ store, operation: 'op-1', env: { ...env, SERPAPI_API_KEY: '' }, search, verify: search }), []);
});

test('Shopping results this instance just paid for are remembered briefly, per country', async () => {
  const fetcher = async () => new Response(JSON.stringify({ shopping_results: [{ title: 'Remembered fixture', source: 'END.' }] }));
  await serpApiJSON('https://serpapi.com/search.json?engine=google_shopping&q=x&gl=us', {}, { SERPAPI_API_KEY: 'recent-fixture' }, fetcher);
  assert.ok(recentShoppingResults('us').some(r => r.title === 'Remembered fixture'));
  assert.ok(!recentShoppingResults('gb').some(r => r.title === 'Remembered fixture'));
  assert.ok(!recentShoppingResults('us', Date.now() + 3600000).some(r => r.title === 'Remembered fixture'));
});
