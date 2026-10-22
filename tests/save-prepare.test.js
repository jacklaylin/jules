import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wishlistProducts } from '../lib/wishlist.js';

// SPEED.md change 6 (October 22): a save of several items prepares them at the same time; the saved
// order and rank stay the order the user saw.
test('several saved items are prepared together and keep their order and rank', async () => {
  const product = (n, wait) => ({ name:`Item ${n}`, url:`https://store.example/products/item-${n}`, candidate_image:`https://store.example/img/${n}.jpg`, wait,
    listing_check:{ status:'unverified' }, reference_provenance:'conversation_product' });
  const started = [];
  const photo = async url => { const p = products.find(x => x.candidate_image === url); started.push(p.name); await new Promise(r => setTimeout(r, p.wait)); return Buffer.from('jpeg'); };
  const products = [product(1, 120), product(2, 20), product(3, 60)];
  const begun = Date.now();
  const entries = await wishlistProducts({ identification_policy:'text_wishlist', user_confirmed:true, products }, '', [], {}, photo,
    { env:{}, fetcher:async () => { throw new Error('offline'); } });
  assert.deepEqual(entries.map(e => e.url), products.map(p => p.url));
  assert.deepEqual(entries.map(e => e.candidate_rank), [0, 1, 2]);
  assert.ok(Date.now() - begun < 180, 'photos are read at the same time, not one after another');
  assert.equal(started.length, 3);
});
