import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textWishlistAction, finishTextWishlist } from '../lib/text-wishlist.js';
import { parseSizeOffers, ONE_SIZE } from '../lib/price-alerts.js';

// A saved size applies only to its own category: a shoe size is never watched on sunglasses or a
// jacket. One-size items are watched by item price, read from an offer bound to the exact listing.
const url = 'https://visionaryoptics.com/products/jacques-marie-mage-romi?variant=47582497472666';
const shoe = 'https://shop.example/products/loafer';
const glasses = { brand:'Jacques Marie Mage', name:'Romi Sunglasses', url, sourcing_status:'store_found', match:'likely_match', listing_check:{ status:'verified', color:'88 Black Black' } };
const loafer = { brand:'Lemaire', name:'Loafer', url:shoe, sourcing_status:'store_found', match:'likely_match', listing_check:{ status:'verified' } };
const facts = [{ field:'size', key:'shoes/eu', value:'45' }, { field:'size', key:'shoes/us_men', value:'12' }];
const env = { PRICE_ALERTS_ENABLED:'true' };
const oneSizeOffer = link => ({ size:ONE_SIZE, key:'ONE SIZE', amount:1295, currency:'USD', available:true, url:link.url });

async function alert(options, sizing, { inspect, state, size_choices = [] } = {}) {
  const seen = []; let result;
  const current = state ?? { stage:'offer_set', options, selected_set:options, offered_urls:options.map(p => p.url) };
  const body = await textWishlistAction({ action:'selection', decision:'confirm', consent:'wishlist_alerts', consent_context:'explicit_request', option_indices:options.map((_, i) => i), size_choices,
    option_sizing:sizing.map((s, option_index) => s && { option_index, sizing:s }).filter(Boolean) },
    { state:current, facts, env, record:async r => { result = r; }, search:() => assert.fail('no search'),
      inspect:async links => { seen.push(links); return inspect ? inspect(links) : { sizes:[], checks:[] }; } });
  return { body, result, seen, next:result?.text_wishlist_state };
}

test('a one-size item is watched as one size and never borrows the saved shoe size', async () => {
  const r = await alert([glasses], ['one_size'], { inspect:links => ({ sizes:[ONE_SIZE], checks:[{ offers:[oneSizeOffer(links[0])] }] }) });
  assert.deepEqual(r.seen[0][0].requested_sizes, [ONE_SIZE]);
  const [watch] = r.result.alert_requests;
  assert.equal(watch.size, ONE_SIZE); assert.deepEqual(watch.links[0].requested_sizes, [ONE_SIZE]);
  assert.equal(watch.baselines[0].amount, 1295); assert.doesNotMatch(JSON.stringify(r.result), /EU 45|US men 12/);
});

test('without a footwear reading, a saved shoe size is not applied; Jules asks which size instead', async () => {
  for (const sizing of [[], ['apparel']]) {
    const r = await alert([glasses], sizing);
    assert.equal(r.result.user_confirmed, undefined); assert.equal(r.next.stage, 'size_set'); assert.doesNotMatch(r.body, /EU 45/);
  }
  const shoes = await alert([loafer], ['footwear']);
  assert.equal(shoes.result.alert_requests[0].size, 'EU 45');
});

test('a one-size reading is not trusted when the page lists real sizes', async () => {
  const r = await alert([glasses], ['one_size'], { inspect:() => ({ sizes:['S', 'M'], checks:[] }) });
  assert.equal(r.next.stage, 'size_set'); assert.equal(r.result.user_confirmed, undefined);
});

test('mixed sets keep each item’s own sizing, and the sizing survives a size question', async () => {
  const both = await alert([glasses, loafer], ['one_size', 'footwear']);
  assert.deepEqual(both.result.alert_requests.map(w => w.size), [ONE_SIZE, 'EU 45']);
  const asked = await alert([glasses, { ...loafer, url:shoe + '-2' }], ['one_size', 'apparel']);
  assert.equal(asked.next.stage, 'size_set');
  const resumed = await alert(asked.next.selected_set, [], { state:asked.next, size_choices:[{ option_index:1, size:'M' }] });
  assert.deepEqual(resumed.result.alert_requests.map(w => w.size), [ONE_SIZE, 'M']);
});

const page = product => `<script type="application/ld+json">${JSON.stringify({ '@type':'Product', name:'Romi Sunglasses', brand:{ name:'Jacques Marie Mage' }, ...product })}</script>`;
test('one-size prices come only from the offer bound to the listing, and only when asked for', () => {
  const single = page({ offers:{ price:'1295.00', priceCurrency:'USD', availability:'https://schema.org/InStock' } });
  assert.deepEqual(parseSizeOffers(single, 'Romi Sunglasses', url, 't'), []);
  const [row] = parseSizeOffers(single, 'Romi Sunglasses', url, 't', { oneSize:true });
  assert.equal(row.size, ONE_SIZE); assert.equal(row.amount, 1295); assert.equal(row.available, true);
  const colors = page({ offers:[{ url, price:'1295.00', priceCurrency:'USD', availability:'https://schema.org/OutOfStock' }, { url:url.replace(/\d+$/, '1'), price:'1195.00', priceCurrency:'USD', availability:'https://schema.org/InStock' }] });
  const bound = parseSizeOffers(colors, 'Romi Sunglasses', url, 't', { oneSize:true });
  assert.equal(bound.length, 1); assert.equal(bound[0].amount, 1295); assert.equal(bound[0].available, false);
  const unbound = page({ offers:[{ price:'1295.00', priceCurrency:'USD' }, { price:'1195.00', priceCurrency:'USD' }] });
  assert.deepEqual(parseSizeOffers(unbound, 'Romi Sunglasses', url, 't', { oneSize:true }), [], 'two unbound prices are ambiguous');
  const sized = page({ size:['S', 'M'], offers:{ price:'300', priceCurrency:'USD' } });
  assert.ok(parseSizeOffers(sized, 'Romi Sunglasses', url, 't', { oneSize:true }).every(r => r.size !== ONE_SIZE));
});

test('the save confirmation states the verified price for a one-size watch, or that none is verified yet', async () => {
  const rows = [{ reply_id:'r', item_id:'i', name:'Romi', links:[{ url }], messages:{ created_at:'2026-10-13' } }];
  const store = { wishlistReplyId:async () => 'r', wishlistEntries:async () => rows, recordEvidence:async () => {}, enablePriceAlert:async () => ({ active:true }) };
  const result = baselines => ({ identification_policy:'text_wishlist', user_confirmed:true, alert_requests:[{ url, size:ONE_SIZE, baselines, links:[{ url }] }] });
  const priced = await finishTextWishlist({ store, result:result([{ amount:1295, currency:'USD', url, available:true }]), env:{}, conversationId:'c' });
  assert.match(priced, /\$1,295\.00 at visionaryoptics\.com, in stock/); assert.match(priced, /one size/); assert.doesNotMatch(priced, /size One size/);
  const unpriced = await finishTextWishlist({ store, result:result([]), env:{}, conversationId:'c' });
  assert.match(unpriced, /no verified price/); assert.doesNotMatch(unpriced, /\$/);
});
