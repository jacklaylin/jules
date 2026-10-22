import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storeTaste,storeTasteFact,storeOf} from '../lib/store-taste.js';
import {tasteView,readUserContext} from '../lib/user-context.js';
import {candidateSignals} from '../lib/discovery-ranking.js';

const orders=[{store:'SSENSE',orders:10,returns:0,last_order:'2026-09-14'},{store:'lululemon',orders:15,returns:1,last_order:'2026-06-25'}];
const wishlist=[{item_id:'a',brand:'Barbour',url:'https://deeceestyle.ch/products/a',messages:{created_at:'2026-10-06T10:00:00Z'}},{item_id:'a',brand:'Barbour',url:'https://deeceestyle.ch/products/a',messages:{created_at:'2026-10-08T10:00:00Z'}}];
const said=[{field:'store',key:'depop',value:'buys vintage there',updated_at:'2026-10-01T00:00:00Z'}];

test('one store reading from what the person said, ordered, saved and liked', () => {
  const stores=storeTaste({facts:said,orders,wishlist,liked:[{name:'Depop',count:2}]});
  assert.deepEqual(stores.find(s=>s.store==='lululemon'),{store:'lululemon',ordered:14,returned:1,last_order:'2026-06-25',weight:10},'the weight is kept for Admin › Knowledge');
  // An item saved twice counts once, dated by its newest save.
  assert.deepEqual(stores.find(s=>s.store==='deeceestyle'),{store:'deeceestyle',wishlisted:1,last_wishlisted:'2026-10-08',weight:3});
  assert.deepEqual(stores.find(s=>s.store==='depop'),{store:'depop',said:{value:'buys vintage there',on:'2026-10-01'},liked:2,weight:6});
  assert.equal(storeTasteFact({}),null);
  assert.equal(storeOf('not a url'),null);
});

test('stated taste carries its date; rules do not; raw store statements give way to the reading', () => {
  const facts=[{field:'style',key:'aesthetic',value:'casual',updated_at:'2026-10-06T04:00:00Z'},{field:'avoid',key:'prints',value:'loud',updated_at:'2026-10-06T04:00:00Z'},...said];
  const view=tasteView([...facts,storeTasteFact({facts:said,orders})],{person:true});
  assert.deepEqual(view.find(f=>f.field==='style'),{field:'style',key:'aesthetic',value:'casual',on:'2026-10-06'});
  assert.equal(view.find(f=>f.field==='avoid').on,undefined);
  assert.ok(!view.some(f=>f.field==='store'));
  assert.ok(view.some(f=>f.field==='store_taste'));
  const signals=candidateSignals({brand:'X',url:'https://www.ssense.com/en-us/men/product/x'},{facts:[storeTasteFact({orders})]});
  assert.equal(signals.store_taste?.ordered,10);
});

test('the chat turn reads the wishlist once and hands it to the layer', async () => {
  let reads=0;const entries=[{item_id:'a',brand:'Barbour',url:'https://deeceestyle.ch/products/a'}];
  const store={profile:async()=>({facts:[]}),wishlistEntries:async()=>{reads++;return entries;}};
  const ctx=await readUserContext(store,'me',{MEMORY_ENABLED:'true',WISHLIST_ENABLED:'true'},{log:()=>{},wishlist:Promise.resolve(entries)});
  assert.equal(reads,0);
  assert.ok(ctx.facts.some(f=>f.field==='wishlist'));
  await readUserContext(store,'me',{MEMORY_ENABLED:'true',WISHLIST_ENABLED:'true'},{log:()=>{}});
  assert.equal(reads,1);
});
