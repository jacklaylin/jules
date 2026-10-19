import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {filterChips,matchesFilter,nextFilter,filterFromURL,filterURL,countLabel} from '../public/wishlist-filters.js';

const watched={id:'a',price_alert:{active:true,size:'M'}};
const soldOut={id:'b',stock:{status:'sold_out',stores:2,fresh:false}};
const both={id:'c',price_alert:{active:true,size:'L'},stock:{status:'sold_out',stores:1,fresh:true}};
const plain={id:'d',price_alert:{active:false,size:'S'},stock:null};

test('filters match the state each card shows, including older sold-out readings',()=>{
 assert.deepEqual([watched,soldOut,both,plain].filter(i=>matchesFilter(i,'alerts')).map(i=>i.id),['a','c']);
 assert.deepEqual([watched,soldOut,both,plain].filter(i=>matchesFilter(i,'sold-out')).map(i=>i.id),['b','c']);
 assert.equal([watched,soldOut,both,plain].every(i=>matchesFilter(i,'all')),true);
});

test('chips show only states that have items, and no row when nothing can be filtered',()=>{
 assert.deepEqual(filterChips([watched,soldOut,both,plain]).map(c=>[c.id,c.count]),[['all',4],['alerts',2],['sold-out',2]]);
 assert.deepEqual(filterChips([watched,plain]).map(c=>c.id),['all','alerts']);
 assert.deepEqual(filterChips([plain]),[]);
 assert.deepEqual(filterChips([]),[]);
});

test('the selected chip stays at 0 after its last item is removed',()=>{
 assert.deepEqual(filterChips([plain,watched],'sold-out').map(c=>[c.id,c.count]),[['all',2],['alerts',1],['sold-out',0]]);
});

test('the filter round-trips through the link and ignores unknown values',()=>{
 assert.equal(filterFromURL('?filter=sold-out'),'sold-out');
 assert.equal(filterFromURL('?filter=bogus'),'all');
 assert.equal(filterFromURL(''),'all');
 assert.equal(filterURL('https://x.test/wishlist?item=1','alerts'),'/wishlist?item=1&filter=alerts');
 assert.equal(filterURL('https://x.test/wishlist?filter=alerts','all'),'/wishlist');
});

test('the count says how many are shown out of the whole list',()=>{
 assert.equal(countLabel(6,6,false),'6 items');
 assert.equal(countLabel(1,1,false),'1 item');
 assert.equal(countLabel(2,6,true),'2 of 6 items');
});

test('both collection pages put the count on the filter row, not the heading',async()=>{
 for(const page of ['wishlist','wardrobe']){
  const html=await readFile(new URL(`../public/${page}.html`,import.meta.url),'utf8');
  const heading=html.match(/<div class="[^"]*collection-heading[^"]*">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(heading,/id="count"/,page);
  assert.match(html,/class="filter-bar"[^>]*>(?:(?!<\/section>)[\s\S])*id="count"/,page);
 }
});

test('tapping the selected filter turns it off; tapping another switches to it',()=>{
 assert.equal(nextFilter('sold-out','sold-out'),'all');
 assert.equal(nextFilter('sold-out','alerts'),'alerts');
 assert.equal(nextFilter('all','sold-out'),'sold-out');
 assert.equal(nextFilter('all','all'),'all');
});
