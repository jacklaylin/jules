import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevanceCheck, relevantProducts, storeDepartment } from '../lib/relevance.js';
import { readDepartments } from '../lib/department-read.js';

// October 22: a Dries Van Noten half-zip from NET-A-PORTER (a women-only store) was shown in a men's
// search. Its page was read only through the search index, so it stated no department and passed as
// unknown. A store that sells one department carries it in the registry; it decides when the page doesn't.
const page = (url, check = {}) => ({ url, name:'Striped Jacquard-Knit Half-Zip Sweater', brand:'Dries Van Noten', sourcing_status:'store_found',
  listing_check:{ status:'verified', url, verification_basis:'search_index', shopping_range:null, ...check } });
const nap = 'https://www.net-a-porter.com/en-us/shop/product/dries-van-noten/clothing/polo/striped-jacquard-knit-half-zip-sweater/46376663162959061';
const mrp = 'https://www.mrporter.com/en-us/mens/product/dries-van-noten/clothing/half-zip/example/123';
const men = { range:'men', allow_unknown_range:true }, women = { range:'women', allow_unknown_range:true };

test('a one-department store decides when the page states no department', () => {
  assert.equal(storeDepartment(nap), 'women');
  assert.equal(storeDepartment(mrp), 'men');
  assert.equal(storeDepartment('https://www.ssense.com/en-us/men/product/x'), null);
  assert.equal(storeDepartment('not a url'), null);
  assert.deepEqual(relevanceCheck(page(nap), men), { eligible:false, reason:'range_mismatch' });
  assert.equal(relevanceCheck(page(nap), women).eligible, true);
  assert.equal(relevanceCheck(page(mrp), men).eligible, true);
  assert.equal(relevanceCheck(page(mrp), women).eligible, false);
  // No department asked for, or shopping for someone else: no constraint, as before.
  assert.equal(relevanceCheck(page(nap), {}).eligible, true);
});

test('the page\'s own department still wins, and other stores are unchanged', () => {
  assert.equal(relevanceCheck(page(nap, { shopping_range:'unisex' }), men).eligible, true);
  const other = page('https://www.ssense.com/en-us/product/x');
  assert.deepEqual(relevanceCheck(other, men), { eligible:true, reason:'range_unknown' });
});

test('the women-only store\'s option is left out of a men\'s set, and a stocked merchant elsewhere is kept', () => {
  const kept = { ...page('https://www.ssense.com/en-us/product/x'), merchant_options:[{ listing_check:page(nap).listing_check }, { listing_check:page(mrp).listing_check }] };
  const { products } = relevantProducts({ products:[page(nap), kept] }, men);
  assert.deepEqual(products.map(p => p.url), [kept.url]);
  assert.deepEqual(products[0].merchant_options.map(m => m.listing_check.url), [mrp]);
});

test('a one-department store\'s page needs no department read', async () => {
  let reads = 0;
  const fetcher = async () => { reads++; throw new Error('should not be called'); };
  const out = await readDepartments([page(nap), page(mrp)], 'men', { env:{ OPENAI_API_KEY:'test' }, fetcher });
  assert.equal(reads, 0);
  assert.equal(out.length, 2);
});
