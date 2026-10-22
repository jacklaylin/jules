import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ALL,filterChips,matchesFilter,nextFilter,filterFromURL,filterURL,countLabel,filterLabel} from '../public/wishlist-filters.js';

const state=filter=>({category:'all',filter});
const ids=chips=>chips.map(c=>[c.id,c.count]);

const watched={id:'a',price_alert:{active:true,size:'M'}};
const soldOut={id:'b',stock:{status:'sold_out',stores:2,fresh:false}};
const both={id:'c',price_alert:{active:true,size:'L'},stock:{status:'sold_out',stores:1,fresh:true}};
const plain={id:'d',price_alert:{active:false,size:'S'},stock:null};

test('filters match the state each card shows, including older sold-out readings',()=>{
 assert.deepEqual([watched,soldOut,both,plain].filter(i=>matchesFilter(i,state('alerts'))).map(i=>i.id),['a','c']);
 assert.deepEqual([watched,soldOut,both,plain].filter(i=>matchesFilter(i,state('sold-out'))).map(i=>i.id),['b','c']);
 assert.equal([watched,soldOut,both,plain].every(i=>matchesFilter(i,ALL)),true);
});

test('chips show only states that have items, and no row when nothing can be filtered',()=>{
 assert.deepEqual(filterChips([watched,soldOut,both,plain]).map(c=>[c.id,c.count]),[['all',4],['alerts',2],['sold-out',2]]);
 assert.deepEqual(filterChips([watched,plain]).map(c=>c.id),['all','alerts']);
 assert.deepEqual(filterChips([plain]),[]);
 assert.deepEqual(filterChips([]),[]);
});

test('the selected chip stays at 0 after its last item is removed',()=>{
 assert.deepEqual(filterChips([plain,watched],state('sold-out')).map(c=>[c.id,c.count]),[['all',2],['alerts',1],['sold-out',0]]);
});

test('the filter round-trips through the link and ignores unknown values',()=>{
 assert.deepEqual(filterFromURL('?filter=sold-out'),state('sold-out'));
 assert.deepEqual(filterFromURL('?filter=bogus&category=hats'),ALL);
 assert.deepEqual(filterFromURL(''),ALL);
 assert.deepEqual(filterFromURL('?category=shoes&filter=alerts'),{category:'shoes',filter:'alerts'});
 assert.deepEqual(filterFromURL('?category=toString'),ALL);
 assert.equal(filterURL('https://x.test/wishlist?item=1',state('alerts')),'/wishlist?item=1&filter=alerts');
 assert.equal(filterURL('https://x.test/wishlist',{category:'shoes',filter:'alerts'}),'/wishlist?category=shoes&filter=alerts');
 assert.equal(filterURL('https://x.test/wishlist?filter=alerts&category=shoes',ALL),'/wishlist');
});

test('the count says how many are shown out of the whole list',()=>{
 assert.equal(countLabel(6,6,ALL),'6 items');
 assert.equal(countLabel(1,1,ALL),'1 item');
 assert.equal(countLabel(2,6,state('alerts')),'2 of 6 items');
 assert.equal(countLabel(2,18,{category:'shoes',filter:'alerts'}),'2 of 18 items');
 assert.equal(countLabel(4,18,{category:'shoes',filter:'all'}),'4 of 18 items');
 assert.equal(countLabel(3,6,state('bought')),'3 bought');
});

test('bought items are hidden by default and shown only under Bought',()=>{
 const bought={id:'e',bought:{at:'2026-10-20T00:00:00Z',store:null},price_alert:{active:true,size:'M'},stock:{status:'sold_out'}};
 const items=[watched,soldOut,plain,bought];
 assert.deepEqual(items.filter(i=>matchesFilter(i,ALL)).map(i=>i.id),['a','b','d']);
 assert.deepEqual(items.filter(i=>matchesFilter(i,state('bought'))).map(i=>i.id),['e']);
 // A bought item is never counted under the other states it still carries.
 assert.deepEqual(filterChips(items).map(c=>[c.id,c.count]),[['all',3],['alerts',1],['sold-out',1],['bought',1]]);
 assert.deepEqual(filterFromURL('?filter=bought'),state('bought'));
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
 const tap=(selection,group,id)=>nextFilter(selection,{group,id});
 assert.deepEqual(tap(state('sold-out'),'state','sold-out'),ALL);
 assert.deepEqual(tap(state('sold-out'),'state','alerts'),state('alerts'));
 assert.deepEqual(tap(ALL,'state','sold-out'),state('sold-out'));
 assert.deepEqual(tap(ALL,'all','all'),ALL);
});

// Saves tagged by kind of item (api/wishlist.js sends the wardrobe category); untagged ones have none.
const shoes={id:'s1',category:'shoes',price_alert:{active:true,size:'10'}};
const boots={id:'s2',category:'shoes',stock:{status:'sold_out'}};
const coat={id:'c1',category:'outerwear',price_alert:{active:true,size:'M'}};
const untagged={id:'u1',category:null};
const boughtShoes={id:'s3',category:'shoes',bought:{at:'2026-10-20T00:00:00Z',store:null}};
const list=[shoes,boots,coat,untagged,boughtShoes];

test('one category and one state combine: shoes with alerts on',()=>{
 const shown=selection=>list.filter(i=>matchesFilter(i,selection)).map(i=>i.id);
 assert.deepEqual(shown({category:'shoes',filter:'alerts'}),['s1']);
 assert.deepEqual(shown({category:'shoes',filter:'all'}),['s1','s2']);
 assert.deepEqual(shown({category:'all',filter:'alerts'}),['s1','c1']);
 assert.deepEqual(shown({category:'shoes',filter:'bought'}),['s3']);
 assert.deepEqual(shown({category:'outerwear',filter:'sold-out'}),[]);
 // An untagged save is only in All.
 assert.deepEqual(shown(ALL),['s1','s2','c1','u1']);
});

test('category chips follow the wardrobe order, count wanted items only, and keep their counts whatever is on',()=>{
 const expected=[['all',4],['outerwear',1],['shoes',2],['alerts',2],['sold-out',1],['bought',1]];
 assert.deepEqual(ids(filterChips(list)),expected);
 assert.deepEqual(ids(filterChips(list,{category:'shoes',filter:'alerts'})),expected);
 assert.deepEqual(filterChips(list).map(c=>c.group),['all','category','category','state','state','state']);
});

test('categories show only when one would narrow the list',()=>{
 // Every save is shoes: a Shoes chip would show the same as All.
 assert.deepEqual(ids(filterChips([shoes,boots])),[['all',2],['alerts',1],['sold-out',1]]);
 // One category beside an untagged save does narrow it.
 assert.deepEqual(ids(filterChips([shoes,untagged])),[['all',2],['shoes',1],['alerts',1]]);
 // A selected category stays (at 0) after its last item goes.
 assert.deepEqual(ids(filterChips([coat,untagged],{category:'shoes',filter:'all'})),[['all',2],['outerwear',1],['shoes',0],['alerts',1]]);
});

test('tapping a selected chip clears only its own group; All clears both',()=>{
 const both={category:'shoes',filter:'alerts'};
 assert.deepEqual(nextFilter(both,{group:'category',id:'shoes'}),{category:'all',filter:'alerts'});
 assert.deepEqual(nextFilter(both,{group:'state',id:'alerts'}),{category:'shoes',filter:'all'});
 assert.deepEqual(nextFilter(both,{group:'category',id:'outerwear'}),{category:'outerwear',filter:'alerts'});
 assert.deepEqual(nextFilter(both,{group:'all',id:'all'}),ALL);
});

test('the empty state names both picks',()=>{
 assert.equal(filterLabel({category:'shoes',filter:'alerts'}),'Shoes · Alerts on');
 assert.equal(filterLabel(state('sold-out')),'Sold out');
 assert.equal(filterLabel(ALL),'All');
});

test('both collection pages read the category names from one shared module',async()=>{
 const {CATEGORY_LABELS}=await import('../public/categories.js');
 const {CATEGORIES}=await import('../lib/item-tags.js');
 assert.deepEqual(Object.keys(CATEGORY_LABELS),CATEGORIES);
 for(const page of ['wardrobe','wishlist-filters']){
  const source=await readFile(new URL(`../public/${page}.js`,import.meta.url),'utf8');
  assert.match(source,/from '\.\/categories\.js'/,page);
  assert.doesNotMatch(source,/CATEGORY_LABELS=\{/,page);
 }
});
