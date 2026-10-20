import test from 'node:test';
import assert from 'node:assert/strict';
import { domainToASCII } from 'node:url';
import { scanItem, scanSavedItems, scanKey, scanQuery, excludedSites, candidatePages, unreviewedAddressRisk } from '../lib/store-scan.js';
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

test('store pages come in two tiers, one per store: trusted, then other stores that aren’t spam, copycat or resale', () => {
  const pages = candidatePages([
    { link: lemaireURL }, { link: ssense }, { link: ssense + '?color=black' }, { link: 'https://www.northboutique.com/products/lemaire-zip-up-leather-jacket-963318344' },
    { link: 'https://www.ssense-sale.shop/lemaire' }, { link: 'https://www.lyst.com/clothing/lemaire-jacket' }, { link: 'https://www.grailed.com/listings/1' },
    { link: farfetch }, { link: 'https://www.mrporter.com/en-us/mens/product/lemaire/1' }, { link: 'https://www.mytheresa.com/us/en/men/lemaire' }, { link: 'https://www.' + domainToASCII('ѕsense.com') + '/x' }, { link: 'https://lemaireoutlet.com/jacket' }, { link: 'https://www.atelierbleu.eu/en/US/men/products/lemaire' },
  ], ['lemaire.fr'], 'LEMAIRE');
  assert.deepEqual(pages.trusted.map(u => new URL(u).hostname), ['www.ssense.com', 'www.farfetch.com', 'www.mrporter.com']);
  assert.deepEqual(pages.other.map(u => new URL(u).hostname), ['www.northboutique.com', 'www.atelierbleu.eu'], 'never an aggregator, resale, look-alike-alphabet or store-name-plus-words site');
  assert.equal(unreviewedAddressRisk('https://www.ssense-sale.shop/x', 'LEMAIRE'), 'risky_domain_ending');
  assert.equal(unreviewedAddressRisk('https://ssensesale.com/x', 'LEMAIRE'), 'store_name_in_domain');
  assert.equal(unreviewedAddressRisk('https://lemaire-official.co.uk/x', 'LEMAIRE'), 'store_name_in_domain');
  assert.equal(unreviewedAddressRisk('https://www.cettire.com/x', 'LEMAIRE'), null);
  assert.equal(unreviewedAddressRisk('https://www.vitkac.com/x', 'LEMAIRE'), null);
});

test('other stores are read only when no trusted store has it for less, and are labelled unreviewed', async () => {
  // An unreviewed store (Cettire, Vitkac and Antonioli joined the trusted list in #277).
  const cettire = 'https://www.northboutique.com/products/lemaire-zip-up-leather-jacket-963318344';
  const reads = [];
  const verify = async url => { reads.push(new URL(url).hostname); return url === farfetch ? page(url, { price_snapshot: { amount: 3400, currency: 'USD', source_url: url } }) : page(url, { price_snapshot: { amount: 2500, currency: 'USD', source_url: url } }); };
  const result = await scanItem(product, { env, search: results([farfetch, cettire]), verify, same: sameAs(cettire), store: emptyStore() });
  assert.deepEqual(reads, ['www.farfetch.com', 'www.northboutique.com']);
  assert.deepEqual(result.offers.map(o => [o.url, o.tier]), [[cettire, 'unreviewed']]);
  assert.equal(result.searches, 1, 'the same search; no extra cost');
  const trustedWins = [];
  const both = await scanItem(product, { env, search: results([ssense, cettire]), verify: async url => { trustedWins.push(url); return page(url); }, same: sameAs(ssense, cettire), store: emptyStore() });
  assert.deepEqual(trustedWins, [ssense], 'a trusted store with it for less ends the scan');
  assert.deepEqual(both.offers.map(o => o.tier), ['trusted']);
  const tooCheap = await scanItem(product, { env, search: results([cettire]), verify: async url => page(url, { price_snapshot: { amount: 900, currency: 'USD', source_url: url } }), same: sameAs(cettire), store: emptyStore() });
  assert.equal(tooCheap.offers.length, 0); assert.equal(tooCheap.checked[0].outcome, 'implausible_discount', 'an unreviewed store far under the saved price is not believed');
  const added = [];
  const store = { ...emptyStore(), savedWishlistItems: async () => [{ id: 'item-1', conversation_id: 'c-1', product }], addWishlistLinks: async (c, id, links) => { added.push(...links); return links.length; } };
  await scanSavedItems({ store, operation: 'op', env, search: results([farfetch, cettire]), verify, same: sameAs(cettire) });
  assert.equal(added[0].store_tier, 'unreviewed');
  const [card] = groupWishlist([{ item_id: 'item-1', reply_id: 'r', text_origin: true, brand: product.brand, name: product.name, links: [...product.links, added[0]], messages: { created_at: '2026-10-20' } }], { currency: 'USD' });
  const found = card.links.find(l => l.url === cettire);
  assert.equal(found.unreviewed, true); assert.equal(found.best_price, false, 'an unreviewed store never takes the badge');
  assert.ok(card.links.every(l => !l.best_price), 'nor does a pricier trusted store');
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

test('best price: one strictly cheapest in-stock store with a page-read price, among two or more', async () => {
  const { bestPriceURL } = await import('../lib/wishlist.js');
  const link = (url, amount, extra = {}) => ({ url, price: { amount, currency: 'USD' }, verification_status: 'verified', availability: null, ...extra });
  const a = 'https://www.ssense.com/a', b = 'https://www.lemaire.fr/b', c = 'https://www.mrporter.com/c';
  assert.equal(bestPriceURL([link(a, 2682), link(b, 3395)]), a);
  assert.equal(bestPriceURL([link(a, 2682)]), null, 'a lone store');
  assert.equal(bestPriceURL([link(a, 2682), link(b, 2682)]), null, 'a tie');
  assert.equal(bestPriceURL([link(c, 2450, { availability: 'OutOfStock' }), link(a, 2682), link(b, 3395)]), a, 'a sold-out store never takes it');
  assert.equal(bestPriceURL([link(c, 2450, { availability: 'OutOfStock' }), link(a, 2682)]), null, 'one store left to buy from');
  assert.equal(bestPriceURL([link(a, 2000, { price: { amount: 2000, currency: 'USD', evidence_level: 'indexed' } }), link(b, 3395), link(c, 3000)]), c, 'an indexed price never takes it');
  assert.equal(bestPriceURL([link(a, 2000, { verification_status: 'unverified' }), link(b, 3395)]), null);
  assert.equal(bestPriceURL([link(a, 2000), link(b, 1800, { price: { amount: 1800, currency: 'EUR' } })]), null, 'mixed currencies');
  assert.equal(bestPriceURL([link(a, 2682), { url: b, price: null, verification_status: 'verified' }]), null, 'a store without a price');
  const rows = [{ item_id: 'i', reply_id: 'r', text_origin: true, brand: 'LEMAIRE', name: 'Jacket', messages: { created_at: '2026-10-20' },
    links: [a, b].map((url, i) => ({ url, verification_status: 'verified', price_snapshot: { amount: [2682, 3395][i], currency: 'USD', source_url: url, checked_at: '2026-10-20T00:00:00Z' } }))}];
  const [card] = groupWishlist(rows, { currency: 'USD' });
  assert.deepEqual(card.links.map(l => [l.url, l.best_price]), [[a, true], [b, false]]);
});

test('a store the scan adds joins the item’s price alert in the alert’s sizes, and the alert text names it as found', async () => {
  const { watchFoundStores } = await import('../lib/store-scan.js');
  const { decidePriceCheck } = await import('../lib/alert-decision.js');
  const rows = [{ item_id: 'item-1', reply_id: 'r', text_origin: true, brand: product.brand, name: product.name, links: product.links, messages: { created_at: '2026-10-20' } }];
  const [group] = groupWishlist(rows);
  const alertLink = { url: lemaireURL, name: 'LEMAIRE BIKER BLOUSON', requested_sizes: ['L'], market_country: 'US', market_currency: 'USD' };
  const saved = [];
  const store = { wishlistEntries: async () => rows, setPriceAlertLinks: async (id, links) => saved.push({ id, links }),
    priceAlerts: async () => [{ id: 'a1', group_id: group.id, active: true, links: [alertLink] }, { id: 'off', group_id: group.id, active: false, links: [alertLink] }, { id: 'other', group_id: 'x', active: true, links: [] }] };
  const offers = [{ url: ssense, tier: 'trusted', color: 'Black', price_snapshot: {} }, { url: lemaireURL, tier: 'trusted', price_snapshot: {} }];
  assert.equal(await watchFoundStores(store, { id: 'item-1', conversation_id: 'c', product }, offers), 1);
  assert.equal(saved.length, 1); assert.equal(saved[0].id, 'a1', 'only the item’s active alert');
  const joined = saved[0].links[1];
  assert.deepEqual([joined.url, joined.requested_sizes, joined.color, joined.discovered_via], [ssense, ['L'], 'Black', 'store_scan']);
  // The alert's next check: SSENSE's lower page price in size L is announced as a store Jules found.
  const offer = (url, amount) => ({ url, size: 'L', key: 'L', amount, currency: 'USD', available: true, name: 'Jacket', checked_at: '2026-10-21T00:00:00Z' });
  const alert = { id: 'a1', name: 'LEMAIRE Black Leather Biker Jacket', size: 'L', links: saved[0].links, baselines: [{ ...offer(lemaireURL, 3395), drop_percent: 0 }], last_result: { stock: 'in_stock' } };
  const decision = decidePriceCheck(alert, [{ url: lemaireURL, status: 'checked', offers: [offer(lemaireURL, 3395)] }, { url: ssense, status: 'checked', offers: [offer(ssense, 2682)] }]);
  assert.equal(decision.event.kind, 'price_drop');
  assert.match(decision.event.body, /at ssense\.com, a store I found for you for \$2,682 \(was \$3,395, 21% off\)\. shipping and other fees not included\./);
  const unreviewed = { ...alert, links: alert.links.map(l => l.url === ssense ? { ...l, store_tier: 'unreviewed' } : l) };
  assert.match(decidePriceCheck(unreviewed, [{ url: ssense, status: 'checked', offers: [offer(ssense, 2682)] }]).event.body, /a store I found for you \(not one i’ve reviewed yet\)/);
  // Nothing new to add, or no group for the item: no write.
  saved.length = 0;
  assert.equal(await watchFoundStores(store, { id: 'item-1', conversation_id: 'c', product }, [{ url: lemaireURL }]), 0);
  assert.equal(await watchFoundStores(store, { id: 'missing', conversation_id: 'c', product }, offers), 0);
  assert.equal(saved.length, 0);
});
