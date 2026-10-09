import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesWishlistFilters as matches,wishlistStores} from '../public/wishlist-filters.js';

const jacket={name:'Studio Linen Jacket',retailers:['shop.example','other.example'],price_alert:{active:true}};
test('search and store and alert filters combine across saved fields',()=>{
 assert.equal(matches(jacket,{search:'  LINEN studio ',store:'other.example',alert:'on'}),true);
 assert.equal(matches(jacket,{search:'linen shop.example'}),true);
 for(const filters of [{search:'boots'},{store:'missing.example'},{alert:'off'},{search:'linen',store:'missing.example'}])assert.equal(matches(jacket,filters),false);
});
test('missing data stays available and does not imply an active alert',()=>{
 const item={name:'Unidentified piece'};
 assert.equal(matches(item),true);
 assert.equal(matches(item,{alert:'off'}),true);
 assert.equal(matches(item,{alert:'on'}),false);
 assert.equal(matches(item,{store:'shop.example'}),false);
 assert.equal(matches({...jacket,price_alert:{active:false}},{alert:'off'}),true);
});
test('store options use all distinct saved stores and search is literal',()=>{
 assert.deepEqual(wishlistStores([jacket,{retailers:['shop.example']},{}]),['other.example','shop.example']);
 assert.equal(matches(jacket,{search:'.*'}),false);
 assert.equal(matches({name:'Studio [one]'},{search:'[one]'}),true);
});
