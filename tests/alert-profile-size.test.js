import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { profileSizes } from '../lib/wishlist-selection.js';
import { parseSizeOffers } from '../lib/price-alerts.js';

// A price alert watches the user's saved size for the item's category (named by the agent from the
// saved profile), not only shoe sizes. Code validates the named keys; it never converts a size.
const url = 'https://www.ssense.com/en-us/men/product/our-legacy/beige-still-chino-trousers/19426491';
const chinos = { brand:'OUR LEGACY', name:'Beige Still Chino Trousers', url, sourcing_status:'store_found', match:'likely_match', listing_check:{ status:'verified' } };
const suit = { brand:'Example Tailor', name:'Wool Suit', url:'https://shop.example/products/suit', sourcing_status:'store_found', match:'likely_match', listing_check:{ status:'verified' } };
const facts = [
  { field:'size', key:'shoes/eu', value:'45' },
  { field:'size', key:'trousers/it', value:'48' },
  { field:'size', key:'suits/unknown', value:'50R' },
  { field:'size', key:'suits/unknown/our legacy', value:'48R' },
  { field:'size', key:'jackets/unknown', value:'M', deleted:true },
];
const env = { PRICE_ALERTS_ENABLED:'true' };
const offer = (size, amount, link) => ({ size, key:size.toUpperCase(), amount, currency:'USD', available:true, url:link.url });

async function alert(options, sizing, { state, size_choices = [], inspect, profileFacts = facts } = {}) {
  let result;
  const current = state ?? { stage:'offer_set', options, selected_set:options, offered_urls:options.map(p => p.url) };
  const body = await textWishlistAction({ action:'selection', decision:'confirm', consent:'wishlist_alerts', consent_context:'explicit_request', option_indices:options.map((_, i) => i), size_choices,
    option_sizing:sizing.map((s, option_index) => s && { option_index, ...s }).filter(Boolean) },
    { state:current, facts:profileFacts, env, record:async r => { result = r; }, search:() => assert.fail('no search'),
      inspect:async links => inspect ? inspect(links) : { sizes:[], checks:[] } });
  return { body, result, next:result?.text_wishlist_state };
}

test('trousers are watched in the saved trouser size, matched to the retailer’s own label', async () => {
  const r = await alert([chinos], [{ sizing:'apparel', profile_size_keys:['trousers/it'] }],
    { inspect:links => ({ sizes:['IT 46', 'IT 48', 'WAIST US 32'], checks:[{ offers:[offer('IT 48', 590, links[0]), offer('WAIST US 32', 590, links[0])] }] }) });
  assert.equal(r.result.user_confirmed, true); assert.doesNotMatch(r.body, /which.*size/i);
  const [watch] = r.result.alert_requests;
  assert.equal(watch.size, 'IT 48'); assert.deepEqual(watch.links[0].requested_sizes, ['IT 48']);
  assert.equal(watch.baselines[0].amount, 590);
  assert.doesNotMatch(JSON.stringify(r.result.alert_requests), /EU 45|50R/, 'other categories’ sizes are not watched');
});

test('a saved size is watched even before the retailer’s sizes can be read', async () => {
  const r = await alert([suit], [{ sizing:'apparel', profile_size_keys:['suits/unknown'] }]);
  assert.equal(r.result.alert_requests[0].size, '50R'); assert.deepEqual(r.result.alert_requests[0].baselines, []);
});

test('a brand exception replaces the general size only for that brand', () => {
  assert.deepEqual(profileSizes(facts, { brand:'Our Legacy' }, ['suits/unknown']), ['48R']);
  assert.deepEqual(profileSizes(facts, { brand:'Our Legacy' }, ['suits/unknown/our legacy']), ['48R']);
  assert.deepEqual(profileSizes(facts, { brand:'Example Tailor' }, ['suits/unknown']), ['50R']);
  assert.deepEqual(profileSizes(facts, { brand:'Example Tailor' }, ['suits/unknown/our legacy']), [], 'another brand’s exception never applies');
});

test('keys that are not saved, deleted, or for someone else’s brand are ignored, and Jules asks instead', async () => {
  assert.deepEqual(profileSizes(facts, chinos, ['trousers/waist', 'jackets/unknown']), []);
  // A malformed saved key (a store name, no category/system) is not evidence of a trouser size.
  assert.deepEqual(profileSizes([{ field:'size', key:'example retail aps', value:'31' }], chinos, ['example retail aps']), []);
  const r = await alert([chinos], [{ sizing:'apparel', profile_size_keys:['trousers/waist'] }], { inspect:() => ({ sizes:['IT 46', 'IT 48'], checks:[] }) });
  assert.equal(r.result.user_confirmed, undefined); assert.equal(r.next.stage, 'size_set'); assert.match(r.body, /IT 46, IT 48/);
});

test('stated systems are kept as labels and never converted', () => {
  const stated = [{ field:'size', key:'trousers/it', value:'IT 48' }, { field:'size', key:'shirts/unknown', value:'M' }, { field:'size', key:'shoes/us_men', value:'12' }];
  assert.deepEqual(profileSizes(stated, {}, ['trousers/it']), ['IT 48']);
  assert.deepEqual(profileSizes(stated, {}, ['shirts/unknown']), ['M']);
  assert.deepEqual(profileSizes(stated, {}, ['shoes/us_men']), ['US men 12']);
});

test('the agent’s size reading survives a size question for another item in the set', async () => {
  const other = { ...suit, url:'https://shop.example/products/shirt', name:'Shirt' };
  const asked = await alert([chinos, other], [{ sizing:'apparel', profile_size_keys:['trousers/it'] }, { sizing:'apparel', profile_size_keys:[] }]);
  assert.equal(asked.next.stage, 'size_set'); assert.match(asked.body, /Shirt/); assert.doesNotMatch(asked.body, /Chino/);
  const resumed = await alert(asked.next.selected_set, [], { state:asked.next, size_choices:[{ option_index:1, size:'M' }] });
  assert.deepEqual(resumed.result.alert_requests.map(w => w.size), ['IT 48', 'M']);
});

test('without a size reading, footwear still uses the saved shoe size and clothing does not', async () => {
  const loafer = { ...suit, url:'https://shop.example/products/loafer', name:'Loafer' };
  assert.equal((await alert([loafer], [{ sizing:'footwear', profile_size_keys:[] }])).result.alert_requests[0].size, 'EU 45');
  assert.equal((await alert([chinos], [{ sizing:'apparel', profile_size_keys:[] }])).next.stage, 'size_set');
});

test('SSENSE size selectors read lettered sizes and the retailer’s own “IT = waist” labels', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({ '@type':'Product', name:'Beige Still Chino Trousers', brand:{ name:'OUR LEGACY' }, offers:{ price:590, priceCurrency:'USD', availability:'https://schema.org/InStock', url } }) + '</script>'
    + '<select id="size-dropdown"><option value="" disabled="" selected="">SELECT A SIZE</option>'
    + '<option value="398">IT 46 = WAIST US 30 - Only 2 remaining</option><option value="399">IT 48 = WAIST US 32</option>'
    + '<option value="402" disabled="">IT 54 = WAIST US 38 - Sold Out</option><option value="500">M - Only 1 remaining</option></select>';
  const rows = parseSizeOffers(html, 'Beige Still Chino Trousers', url, 't');
  assert.deepEqual(rows.map(r => r.size), ['IT 46', 'WAIST US 30', 'IT 48', 'WAIST US 32', 'IT 54', 'WAIST US 38', 'M']);
  assert.ok(rows.every(r => r.amount === 590 && r.currency === 'USD'));
  assert.deepEqual(rows.filter(r => !r.available).map(r => r.size), ['IT 54', 'WAIST US 38']);
  assert.equal(rows.find(r => r.size === 'WAIST US 32').retailer_size_id, '399', 'both labels name the same retailer option');
});
