import {test} from 'node:test';
import assert from 'node:assert/strict';
import {untaggedWishlist,validWishlistTags,wishlistTagFingerprint,tagWishlist} from '../lib/wishlist-tags.js';
import {brandTaste,wishlistFact} from '../lib/brand-taste.js';

const save=(item_id,brand,name,extra={})=>({item_id,brand,name,messages:{created_at:'2026-10-20T10:00:00Z'},...extra});

test('wishlist saves are tagged once per item, again only when their details change', () => {
  const a=save('a','Satisfy','Running shorts'),b=save('b','Lemaire','Twisted shirt');
  assert.deepEqual(untaggedWishlist([a,{...a,reply_id:'r2'},b]).map(e=>e.item_id),['a','b']);
  const tagged={...a,tag:{fp:wishlistTagFingerprint(a),group:'activewear'}};
  assert.deepEqual(untaggedWishlist([tagged,b]).map(e=>e.item_id),['b']);
  // Renamed since it was tagged: tagged again.
  assert.deepEqual(untaggedWishlist([{...tagged,name:'Running tights'}]).map(e=>e.item_id),['a']);
});

test('only known ids and the fixed groups are kept from the model', () => {
  const items=[save('a','Satisfy','Running shorts'),save('b','Lemaire','Twisted shirt')];
  const tags=validWishlistTags(items,{items:[{id:'a',item_type:'running shorts',group:'activewear'},{id:'b',item_type:null,group:'blouses'},{id:'z',item_type:null,group:'shirts'}]},'T');
  assert.deepEqual(Object.keys(tags),['a']);
  assert.deepEqual(tags.a,{fp:wishlistTagFingerprint(items[0]),v:tags.a.v,at:'T',group:'activewear',item_type:'running shorts'});
});

test('tagging saves each tag on the item, and a failure tags nothing', async () => {
  const saved=[];const store={wishlistEntries:async()=>[save('a','Satisfy','Running shorts')],saveWishlistTag:async(o,id,tag)=>saved.push([o,id,tag.group])};
  assert.deepEqual(await tagWishlist(store,'me',{},{interpret:async()=>({items:[{id:'a',item_type:'running shorts',group:'activewear'}]})}),{tagged:1,remaining:0});
  assert.deepEqual(saved,[['me','a','activewear']]);
  assert.deepEqual(await tagWishlist(store,'me',{},{interpret:async()=>{throw Error('down');}}),{tagged:0,remaining:1});
  assert.deepEqual(await tagWishlist({wishlistEntries:store.wishlistEntries},'me',{}),{tagged:0,remaining:0});
});

test('brand taste says what each brand was saved as', () => {
  const shorts=save('a','Satisfy','Running shorts'),tee=save('b','Satisfy','Long tee'),shirt=save('c','Lemaire','Twisted shirt');
  const wishlist=[{...shorts,tag:{fp:wishlistTagFingerprint(shorts),group:'activewear'}},{...tee,tag:{fp:wishlistTagFingerprint(tee),group:'activewear'}},{...shirt,tag:{fp:'stale',group:'shoes'}}];
  const brands=brandTaste({wishlist});
  assert.deepEqual(brands.find(b=>b.brand==='Satisfy').wishlisted_as,{activewear:2});
  // A tag made from other details no longer counts.
  assert.equal(brands.find(b=>b.brand==='Lemaire').wishlisted_as,undefined);
  assert.equal(JSON.parse(wishlistFact(wishlist).value).recent[0].kind,'activewear');
});
