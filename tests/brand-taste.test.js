import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brandTaste,brandTasteFact,brandTasteOf,wishlistFact} from '../lib/brand-taste.js';
import {tasteView} from '../lib/user-context.js';
import {candidateSignals} from '../lib/discovery-ranking.js';

// October 22: three brands from one early message (and their style-pack copies) were read as fixed taste.
const said=[{field:'brand',key:'prada',value:'favorite brand',updated_at:'2026-10-06T04:39:15Z'},{field:'brand',key:'style-pack/prada',value:'favorite brand',updated_at:'2026-10-08T02:38:28Z'},{field:'brand',key:'st laurent',value:'favorite brand',updated_at:'2026-10-06T04:39:15Z'}];
const purchases=[{name:'OUR LEGACY',count:11,recent:6},{name:'Prada',count:1,recent:0}];
const wishlist=[{item_id:'a',brand:'Our Legacy',messages:{created_at:'2026-10-20T10:00:00Z'}},{item_id:'a',brand:'Our Legacy',messages:{created_at:'2026-10-21T10:00:00Z'}},{item_id:'b',brand:'Satisfy',messages:{created_at:'2026-10-09T10:00:00Z'}}];
const liked=[{name:'Satisfy',count:2}];

test('one brand reading from what the person said, bought, saved and liked', () => {
  const brands=brandTaste({facts:said,purchases,wishlist,liked});
  // A statement and its style-pack copy are one statement; the item saved twice counts once.
  const prada=brands.find(b=>b.brand==='prada');
  assert.deepEqual(prada,{brand:'prada',said:{value:'favorite brand',on:'2026-10-06'},bought:1});
  assert.deepEqual(brands.find(b=>b.brand==='OUR LEGACY'),{brand:'OUR LEGACY',bought:11,bought_recently:6,wishlisted:1,last_wishlisted:'2026-10-21'});
  // Behaviour orders the list; a stated brand with nothing behind it still appears, after those with evidence.
  assert.deepEqual(brands.map(b=>b.brand),['OUR LEGACY','Satisfy','prada','st laurent']);
  assert.equal(brandTaste({}).length,0);
  assert.equal(brandTasteFact({}),null);
  assert.deepEqual(brandTaste({facts:[{...said[0],deleted:true}]}),[]);
});

test('the wishlist is a source: distinct items, newest save first', () => {
  const fact=wishlistFact(wishlist);
  const value=JSON.parse(fact.value);
  assert.equal(value.items,2);
  assert.deepEqual(value.recent.map(i=>[i.brand,i.saved]),[['Our Legacy','2026-10-21'],['Satisfy','2026-10-09']]);
  assert.equal(wishlistFact([]),null);
});

test('with a brand reading, the raw brand statements stop appearing as a separate favourites list', () => {
  const taste=brandTasteFact({facts:said,purchases,wishlist,liked});
  const facts=[...said,{field:'style',key:'aesthetic',value:'casual but chic'},taste];
  assert.deepEqual(tasteView(facts).map(f=>f.field),['style','brand_taste']);
  // Without one (an older caller passing only stated facts) the statements stay.
  assert.deepEqual(tasteView(said).map(f=>f.field),['brand','brand','brand']);
  assert.equal(brandTasteOf(facts).length,4);
  // The ranker sees the candidate brand's own entry, and no separate brand statements.
  const signals=candidateSignals({brand:'Our Legacy',url:'https://www.ourlegacy.com/x'},{facts});
  assert.equal(signals.brand_taste.bought,11);
  assert.ok(!signals.saved_facts.some(f=>f.field==='brand'));
  assert.equal(candidateSignals({brand:'Unknown Label',url:'https://example.com/x'},{facts}).brand_taste,null);
});

test('purchases say what each brand was bought for, without basics', () => {
  // The closet's counts are kept items: Salomon had 9 on receipts (7 recent), 7 of them returned.
  const closet=[{brand:'MAAP',items:18,recent:18,groups:{activewear:18}},{brand:'Our Legacy',items:11,recent:6,groups:{shirts:6,knitwear:3}},{brand:'Salomon',items:2,recent:2,groups:{shoes:1,trousers:1}}];
  const brands=brandTaste({purchases:[{name:'MAAP',count:18,recent:18},{name:'Bombas',count:5,recent:5},{name:'OUR LEGACY',count:11,recent:6},{name:'Salomon',count:9,recent:7}],closet});
  assert.deepEqual(brands.find(b=>b.brand==='MAAP').bought_as,{activewear:18});
  assert.equal(brands.find(b=>b.brand==='Our Legacy').bought_recently,6);
  assert.deepEqual([brands.find(b=>b.brand==='Salomon').bought,brands.find(b=>b.brand==='Salomon').bought_recently],[2,2]);
  // Receipt counts aren't used with a closet, so a basics-only brand (only on receipts) adds nothing.
  assert.equal(brands.find(b=>/bombas/i.test(b.brand)),undefined);
});

test('taste coverage counts wishlist brands, and the style reading gets one brand line', async () => {
  const {coverage}=await import('../lib/coverage.js');
  const {brandTasteLine}=await import('../lib/brand-taste.js');
  const brands=d=>d.dimensions.find(x=>x.dimension==='brands');
  assert.equal(brands(coverage({})).status,'missing');
  assert.equal(brands(coverage({wishlist:[{item_id:'a',brand:'Lemaire'}]})).status,'weak');
  assert.equal(brands(coverage({wishlist:[{item_id:'a',brand:'Lemaire'},{item_id:'a',brand:'Lemaire'}]})).status,'weak');
  assert.equal(brands(coverage({wishlist:[{item_id:'a',brand:'Lemaire'},{item_id:'b',brand:'LEMAIRE'}]})).status,'known');
  assert.equal(brandTasteLine([{brand:'Dries Van Noten',said:{value:'favorite brand',on:'2026-10-06'},bought:6,bought_as:{trousers:3,shirts:2,outerwear:1},wishlisted:2},{brand:'MAAP',bought:18,bought_as:{activewear:14}}]),
    'Dries Van Noten (said favorite brand (2026-10-06); bought 6 as trousers, shirts; saved 2), MAAP (bought 18 as activewear)');
});

test('the Admin view reports every source, the brand reading and the summaries', async () => {
  const {contextReport}=await import('../lib/user-context.js');
  const stated=[{field:'brand',key:'example label',value:'favorite brand'},{field:'style',key:'aesthetic',value:'casual'},{field:'size',key:'old',value:'x',deleted:true}];
  const facts=[...stated,wishlistFact(wishlist),brandTasteFact({facts:stated,wishlist}),{field:'wardrobe',key:'summary',value:JSON.stringify({items:9,groups:[{group:'tops',items:5,types:'tee 3'}]})}];
  const r=contextReport({facts,purchases:12});
  assert.deepEqual(r.sources,{stated:2,purchases:12,wardrobe:9,wishlist:2,liked:0,outfit_photos:false});
  assert.deepEqual(r.brands.map(b=>b.brand),['Our Legacy','Satisfy','example label']);
  assert.deepEqual(r.wardrobe,[{group:'tops',items:5,types:'tee 3'}]);
  assert.equal(r.wishlist.length,2);
  assert.deepEqual(contextReport({}),{sources:{stated:0,purchases:0,wardrobe:0,wishlist:0,liked:0,outfit_photos:false},brands:[],wardrobe:[],wishlist:[],liked:[]});
});
