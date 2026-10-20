import test from 'node:test';
import assert from 'node:assert/strict';
import { sameProductGroups, mergeListings, mergeSameProducts, sameBrand } from '../lib/same-product.js';
import { selectionOutcome } from '../lib/wishlist-selection.js';
import { wishlistProducts } from '../lib/wishlist.js';
import { formatSearch } from '../lib/search.js';
import { optionFacts } from '../lib/ai.js';

const env = { OPENAI_API_KEY: 'fixture', SHOPPING_CURRENCY: 'USD' };
const lemaireURL = 'https://www.lemaire.fr/products/biker-blouson-unisex-black-paper-cow-leather-ow1211-ll0175-bk999';
const ssenseURL = 'https://www.ssense.com/en-us/men/product/lemaire/black-leather-biker-jacket/18940241';
const check = (url, name, amount, extra = {}) => ({ status: 'verified', url, product_brand: 'LEMAIRE', product_name: name, color: 'Black', product_images: [url + '/photo.jpg'], price_snapshot: { amount, currency: 'USD', source_url: url, checked_at: '2026-10-20T00:00:00Z' }, ...extra });
const listing = (url, name, amount, extra = {}) => ({ brand: 'LEMAIRE', name, url, match: 'likely_match', sourcing_status: 'store_found', retailer: { name: new URL(url).hostname.replace(/^www\./, ''), tier: 'preferred' }, listing_check: check(url, name, amount), price_snapshot: check(url, name, amount).price_snapshot, merchant_options: [], ...extra });
const lemaire = listing(lemaireURL, 'BIKER BLOUSON IN PAPER COW LEATHER', 3395, { retailer: { name: 'LEMAIRE', tier: 'official' } });
const ssense = listing(ssenseURL, 'Black Leather Biker Jacket', 2682, { retailer: { name: 'SSENSE', tier: 'preferred' } });
const other = listing('https://www.mrporter.com/en-us/mens/product/lemaire/soft-leather-blouson/1', 'Soft Leather Blouson', 2900);
// A model service answering with the given groups; records each request.
const model = (groups, requests = []) => async (_url, init) => { requests.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ groups }) }] }] })); };

test('the check sees each listing’s details and photo, and keeps only certain, real, same-brand, multi-store groups', async () => {
  const requests = [];
  const groups = await sameProductGroups([lemaire, ssense, other], { env, fetcher: model([{ indices: [0, 1], evidence: 'same jacket', certain: true }, { indices: [2, 0], evidence: 'similar', certain: false }], requests) });
  assert.deepEqual(groups, [[0, 1]]);
  const content = requests[0].input[0].content;
  assert.ok(content.some(c => c.type === 'input_image' && c.image_url === lemaireURL + '/photo.jpg'));
  assert.match(content[0].text, /Black Leather Biker Jacket/);
  for (const answer of [
    [{ indices: [0, 5], evidence: '', certain: true }],                                 // not a listing
    [{ indices: [0, 1], evidence: '', certain: true }, { indices: [1, 2], evidence: '', certain: true }], // a listing twice: the first stands
  ]) assert.ok((await sameProductGroups([lemaire, ssense, other], { env, fetcher: model(answer) })).every(g => g.every(i => i < 3)));
  const acne = { ...other, brand: 'Acne Studios', listing_check: { ...other.listing_check, product_brand: 'Acne Studios' } };
  assert.deepEqual(await sameProductGroups([lemaire, ssense, acne], { env, fetcher: model([{ indices: [0, 2], evidence: '', certain: true }]) }), [], 'never across brands');
  const sameStore = { ...ssense, url: lemaireURL + '?v=2' };
  assert.deepEqual(await sameProductGroups([lemaire, sameStore], { env, fetcher: model([{ indices: [0, 1], evidence: '', certain: true }]) }), [], 'never one store twice');
});

test('no model call without two stores of one brand; a failed photo request is retried without photos', async () => {
  const none = async () => assert.fail('no model call');
  assert.deepEqual(await sameProductGroups([lemaire, { ...other, brand: 'Acne', listing_check: { ...other.listing_check, product_brand: 'Acne' } }], { env, fetcher: none }), []);
  assert.deepEqual(await sameProductGroups([lemaire, ssense], { env: {}, fetcher: none }), []);
  const requests = [];
  const flaky = async (url, init) => { const body = JSON.parse(init.body); requests.push(body); return body.input[0].content.some(c => c.type === 'input_image') ? new Response('{}', { status: 400 }) : model([{ indices: [0, 1], evidence: '', certain: true }])(url, init); };
  assert.deepEqual(await sameProductGroups([lemaire, ssense], { env, fetcher: flaky }), [[0, 1]]);
  assert.equal(requests.length, 2);
  assert.deepEqual(await sameProductGroups([lemaire, ssense], { env, fetcher: async () => new Response('{}', { status: 500 }) }), [], 'a failed check merges nothing');
  assert.ok(sameBrand('LEMAIRE', 'Lemaire') && sameBrand('Barbour', 'Barbour x Paul Smith') && !sameBrand('Prada', 'Miu Miu'));
});

test('one product at several stores: the cheapest store leads and every other store follows with its own price', () => {
  const merged = mergeListings([lemaire, ssense]);
  assert.equal(merged.url, ssenseURL); assert.equal(merged.price_snapshot.amount, 2682);
  assert.deepEqual(merged.merchant_options.map(m => [m.url, m.price_snapshot.amount, m.listing_check.status]), [[lemaireURL, 3395, 'verified']]);
  assert.equal(merged.same_product_stores, 2);
});

test('search results: the same jacket at LEMAIRE and SSENSE becomes one option showing both prices', async () => {
  const products = await mergeSameProducts([lemaire, ssense, other], { env, fetcher: model([{ indices: [0, 1], evidence: 'same jacket', certain: true }]) });
  assert.equal(products.length, 2);
  assert.equal(products[0].url, ssenseURL); assert.equal(products[1], other);
  const body = formatSearch({ status: 'found', intro: 'found it', products: [products[0]] });
  assert.match(body, /\$2,682/); assert.match(body, /also at LEMAIRE for \$3,395/);
  assert.ok(body.includes(lemaireURL) && body.includes(ssenseURL));
  const [facts] = optionFacts({ options: [products[0]] });
  assert.deepEqual(facts.other_stores, [{ store: 'LEMAIRE', url: lemaireURL, price: '$3,395.00' }]);
  const unverified = { ...ssense, sourcing_status: 'store_not_found' };
  assert.equal((await mergeSameProducts([lemaire, unverified], { env, fetcher: async () => assert.fail('only verified listings are compared') })).length, 2);
});

test('“those are the same one”: the save keeps one item with both stores, and the size the user gave applies', async () => {
  const respond = (body, state, extra) => ({ body, state, extra });
  const args = { decision: 'confirm', consent: 'wishlist', consent_context: 'explicit_request', option_indices: [0, 1], same_product_groups: [[0, 1]], size_choices: [{ option_index: 0, size: 'L' }], option_sizing: [], color_choices: [] };
  const saved = await selectionOutcome(args, { state: { stage: 'choice', options: [lemaire, ssense] }, facts: [], env, constraints: {}, respond });
  assert.equal(saved.extra.products.length, 1);
  const [item] = saved.extra.products;
  assert.equal(item.url, ssenseURL); assert.deepEqual(item.merchant_options.map(m => m.url), [lemaireURL]);
  assert.match(saved.body, /add it to your wishlist/);
  const [entry] = await wishlistProducts({ identification_policy: 'text_wishlist', user_confirmed: true, products: saved.extra.products }, '', [], {}, async () => Buffer.from('x'));
  assert.deepEqual(entry.links.map(l => l.url), [ssenseURL, lemaireURL], 'one card, both stores');
  // A group the code cannot honour (a different brand, or an option not selected) saves the options separately.
  const acne = { ...other, brand: 'Acne Studios', listing_check: { ...other.listing_check, product_brand: 'Acne Studios' } };
  const separate = await selectionOutcome({ ...args, same_product_groups: [[0, 1]] }, { state: { stage: 'choice', options: [lemaire, acne] }, facts: [], env, constraints: {}, respond });
  assert.equal(separate.extra.products.length, 2);
  const unselected = await selectionOutcome({ ...args, option_indices: [0], same_product_groups: [[0, 1]], size_choices: [] }, { state: { stage: 'choice', options: [lemaire, ssense] }, facts: [], env, constraints: {}, respond });
  assert.equal(unselected.extra.products.length, 1); assert.equal(unselected.extra.products[0].url, lemaireURL);
});
