import test from 'node:test';
import assert from 'node:assert/strict';
import {knowledgeView,brandCounts} from '../lib/person-knowledge.js';
import {brandTasteFact,wishlistFact} from '../lib/brand-taste.js';

const fact=(field,key,value,basis='stated')=>({field,key,value,basis,source:'message'});
const derived=(field,value)=>({field,key:'summary',basis:'inferred',value:JSON.stringify(value)});

test('an empty context still says the style reading needs outfit photos',()=>{
 const {rows,notes}=knowledgeView([]);
 assert.deepEqual(rows.map(r=>[r.about,r.kind,r.value]),[['Style reading','inferred',null]]);
 assert.equal(rows[0].source,'Needs outfit photos');
 assert.deepEqual(notes,{});
});

test('the person’s own facts get a topic; an avoid ranks last and joins Brands only when it names a brand',()=>{
 const facts=[fact('size','suits/eu','50R'),fact('brand','our legacy','love their trousers'),fact('avoid','acne studios','too logo-y'),fact('avoid','polyester','itchy'),fact('occasion','work','office','inferred')];
 const {notes}=knowledgeView([...facts,brandTasteFact({facts,purchases:[{name:'Acne Studios',count:2,recent:0}]})]);
 assert.equal(notes['size|suits/eu'].topic,'Sizes');
 assert.equal(notes['avoid|acne studios'].topic,'Brands');assert.equal(notes['avoid|acne studios'].weight,'last');
 assert.equal(notes['avoid|polyester'].topic,'Style');
 assert.equal(notes['occasion|work'].topic,'Style','a fact Jules inferred is still the person’s own, editable fact');
});

test('brand taste: one Inferred row, the weight on a said brand, and a Seen row per brand they never named',()=>{
 const said=[fact('brand','our legacy','love their trousers')];
 const wishlist=[{item_id:'a',brand:'Auralee',url:'https://x/a',messages:{created_at:'2026-10-20T10:00:00Z'}},{item_id:'b',brand:'Auralee',url:'https://x/b'}];
 const taste=brandTasteFact({facts:said,purchases:[{name:'Our Legacy',count:7,recent:3},{name:'Auralee',count:4,recent:1},{name:'Stüssy',count:4,recent:0}],wishlist});
 const {rows,notes}=knowledgeView([...said,taste,wishlistFact(wishlist)]);
 const reading=rows.find(r=>r.about==='Brand taste');
 assert.equal(reading.kind,'inferred');assert.match(reading.value,/^Auralee, our legacy, Stüssy lead \(3 brands\)$/);
 assert.equal(reading.source,'1 said · 15 bought · 2 saved · 0 liked');
 assert.deepEqual(notes['brand|our legacy'],{topic:'Brands',weight:8,seen:'bought 7, 3 recent'});
 const auralee=rows.find(r=>r.about==='Auralee');
 assert.deepEqual([auralee.kind,auralee.weight,auralee.value,auralee.source,auralee.when],['seen',11,'bought 4, 1 recent · saved 2','Purchases, Wishlist','2026-10-20']);
 assert.equal(rows.some(r=>r.about==='Our Legacy'),false,'a brand they named is their own row, not a second one');
 assert.equal(rows.find(r=>r.about==='Wishlist').value,'2 saved; newest Auralee');
});

test('each derived source becomes one read-only row with where it came from',()=>{
 const {rows}=knowledgeView([
  derived('shopping_history',{items:70,personal_items:64,top_merchants:[{name:'SSENSE'},{name:'Grailed'},{name:'END.'},{name:'COS'}],purchased_sizes:[{size:'32',system:'waist',count:9},{size:'10',system:'us_men',count:4}]}),
  derived('wardrobe',{items:41,groups:[{group:'trousers',items:9},{group:'shirts',items:7},{group:'knitwear',items:6},{group:'shoes',items:5},{group:'outerwear',items:4}]}),
  derived('outfit_photos',{kept:3,latest_at:'2026-10-18T10:00:00Z',reading:['relaxed trousers','mostly navy'],reading_photos:3}),
  derived('liked_items',{items:9,categories:[{name:'overshirts',count:5},{name:'knitwear',count:2}]}),
  derived('store_taste',{stores:[{store:'SSENSE',said:{value:'x'},ordered:20},{store:'Grailed',ordered:12}]})]);
 const by=about=>rows.find(r=>r.about===about);
 assert.equal(by('Shopping history').value,'64 purchases for themselves; most from SSENSE, Grailed, END.');
 assert.equal(by('Bought in').value,'32 (waist) ×9 · 10 (us men) ×4');assert.equal(by('Bought in').topic,'Sizes');
 assert.equal(by('Wardrobe').value,'41 kept: trousers 9 · shirts 7 · knitwear 6 · shoes 5 · +1 more');
 assert.equal(by('Style reading').value,'relaxed trousers; mostly navy');assert.equal(by('Style reading').source,'From 3 outfit photos');
 assert.equal(by('Outfit photos').when,'2026-10-18');
 assert.equal(by('Liked').value,'9 liked; mostly overshirts and knitwear');
 assert.equal(by('Store taste').source,'1 said · 32 orders · 0 saved');
 for(const r of rows)assert.ok(['seen','inferred'].includes(r.kind),r.about);
});

test('brandCounts reads as plain words',()=>{
 assert.equal(brandCounts({bought:2,bought_recently:2,wishlisted:1}),'bought 2, 2 recent · saved 1');
 assert.equal(brandCounts({}),'');
});

test('store taste works like brands: weight on a store they named, a Seen row for one they never named, topics from the field list',()=>{
 const said=[fact('store','ssense','prefers when stock matches'),fact('material','linen','loves it')];
 const taste=derived('store_taste',{stores:[{store:'SSENSE',said:{value:'x'},ordered:20,returned:2,weight:10},{store:'Grailed',ordered:12,last_order:'2026-10-01',weight:10},{store:'Depop',liked:2,weight:6}]});
 const {rows,notes}=knowledgeView([...said,taste]);
 assert.deepEqual(notes['store|ssense'],{topic:'Budget and stores',weight:10,seen:'ordered 20, 2 returned'});
 assert.equal(notes['material|linen'].topic,'Style','a field’s topic comes from lib/memory.js FIELD_FORMS');
 const grailed=rows.find(r=>r.about==='Grailed');
 assert.deepEqual([grailed.kind,grailed.weight,grailed.value,grailed.source,grailed.when],['seen',10,'ordered 12','Purchases','2026-10-01']);
 assert.equal(rows.find(r=>r.about==='Depop').source,'Likes');
 assert.equal(rows.some(r=>r.about==='SSENSE'),false,'a store they named is their own row');
});
