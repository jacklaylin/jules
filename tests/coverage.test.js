import test from 'node:test';
import assert from 'node:assert/strict';
import {coverage,readCoverage,logCoverage,DIMENSIONS} from '../lib/coverage.js';
import {purchaseEvidence,correctionEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {tagFingerprint,TAG_VERSION} from '../lib/item-tags.js';

const owner='owner';
const buy=(n,v={},price=null)=>purchaseEvidence({event_id:`m${n}:purchased`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',basis:'order_confirmation',category:'clothing',
 ...(price?{price:{amount:price,currency:'USD',text:'$'+price}}:{}),
 values:{merchant:'Depop',order_reference:'O'+n,sku:null,brand:null,color:null,size_label:null,size_system:null,quantity:1,units_per_pack:null,product:'Item '+n,...v},item_id:'item-'+n,recipient:{value:'self',quote:'x'}});
const stateOf=rows=>projectReceiptEvidence(owner,rows).state;
// Tags as lib/item-tags.js stores them, keyed by item and fingerprinted against its current details.
const tagged=(state,tag)=>Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),v:TAG_VERSION,at:'2026-10-20T00:00:00Z',item_type:'jacket',group:'tops',color_family:'unknown',resale:true,...tag(i)}]));
const fact=(field,key,value,id=field+key)=>({field,key,value,basis:'stated',evidence_ids:['chat:'+id]});
const status=(c,d)=>c.dimensions.find(x=>x.dimension===d).status;

test('no sources at all is empty, with every dimension missing',()=>{
 const c=coverage();
 assert.equal(c.level,'empty');
 assert.deepEqual(c.dimensions.map(d=>d.dimension),DIMENSIONS);
 assert.ok(c.dimensions.every(d=>d.status==='missing'));
});

test('fifty receipts from one marketplace with no colours, photos or stated sizes is still thin (case J)',()=>{
 const state=stateOf(Array.from({length:50},(_,n)=>buy(n+1,{size_label:'M'})));
 const c=coverage({state,tags:tagged(state,i=>({group:Number(i.id.split('-')[1])%2?'tops':'trousers'}))});
 assert.equal(c.level,'thin');
 assert.equal(status(c,'categories'),'known');
 assert.equal(status(c,'stores'),'known');
 assert.equal(status(c,'channel'),'known');
 assert.equal(status(c,'palette'),'missing');
 assert.equal(status(c,'silhouettes'),'weak','product names only hint at silhouette');
 assert.equal(status(c,'sizes'),'weak','bought sizes never make a size known');
});

test('a few purchases plus outfit photos and stated taste is rich (case J)',()=>{
 const state=stateOf([1,2,3,4,5,6].map(n=>buy(n,{merchant:n<5?'COS':'Uniqlo',color:'black',brand:'COS'})));
 const facts=[fact('style','palette','earth tones and black'),fact('size','tops/us','M'),fact('size','bottoms/us','30'),fact('store','cos','goes there for basics')];
 const c=coverage({facts,state,tags:tagged(state,i=>({group:Number(i.id.split('-')[1])<4?'tops':'trousers',color_family:'black',resale:false})),
  outfits:{kept:3,reading_photos:3,observations:3}});
 assert.equal(status(c,'silhouettes'),'known');
 assert.equal(status(c,'palette'),'known');
 assert.equal(status(c,'sizes'),'known');
 assert.equal(c.level,'rich');
});

test('a resale-heavy history with no photos (case A) is thin, with secondhand spend flagged',()=>{
 const rows=[1,2,3,4,5,6,7].map(n=>buy(n,{merchant:'Depop',color:n<=3?'brown':null,size_label:n<=5?'M':null},20+n));
 rows.push(buy(8,{merchant:'Poshmark',brand:'Levi\'s'},30),buy(9,{merchant:'Uniqlo',brand:'Uniqlo'},40));
 const state=stateOf(rows);
 const c=coverage({state,tags:tagged(state,i=>({group:['item-1','item-2','item-8'].includes(i.id)?'trousers':'tops',color_family:i.color?'brown':'unknown',resale:i.merchant!=='Uniqlo'}))});
 assert.equal(c.level,'thin');
 assert.equal(status(c,'categories'),'known');
 assert.equal(status(c,'silhouettes'),'weak');
 assert.equal(status(c,'palette'),'weak','three written colours are not a palette');
 assert.equal(status(c,'brands'),'weak');
 assert.equal(status(c,'sizes'),'weak');
 assert.equal(status(c,'stores'),'known');
 assert.equal(status(c,'price_band'),'known');
 assert.equal(c.dimensions.find(d=>d.dimension==='price_band').resale_band,true);
 assert.equal(status(c,'channel'),'known');
 assert.equal(c.dimensions.find(d=>d.dimension==='channel').resale_share,0.89);
});

test('sizes are per category: a stated size is known, a bought size stays weak',()=>{
 const state=stateOf([buy(1,{size_label:'M'}),buy(2,{size_label:'10'})]);
 const c=coverage({facts:[fact('size','tops/us','M')],state,tags:tagged(state,i=>({group:i.id==='item-1'?'knitwear':'shoes'}))});
 const sizes=c.dimensions.find(d=>d.dimension==='sizes');
 assert.deepEqual(sizes.categories,{tops:'known',shoes:'weak'});
 assert.deepEqual(sizes.bought,{shoes:'10'},'the bought size is offered only where none is stated');
 assert.equal(sizes.status,'weak');
 assert.deepEqual(sizes.evidence_ids,['chat:sizetops/us']);
});

test('gifts, removed items and stale tags do not count',()=>{
 const rows=[buy(1),buy(2),buy(3),buy(4),
  correctionEvidence({id:'c3',owner_id:owner,source:'operator_review',at:'2026-10-14T00:00:00Z',item_ids:['item-3'],action:'set_recipient',value:'other',label:'sister',review:{reason:'correct',note:null}}),
  correctionEvidence({id:'c4',owner_id:owner,source:'operator_review',at:'2026-10-14T00:00:00Z',item_ids:['item-4'],action:'dispute_purchase',review:{reason:'correct',note:null}})];
 const state=stateOf(rows),tags=tagged(state,()=>({}));
 tags['item-2']={...tags['item-2'],fp:'stale'};
 const c=coverage({state,tags});
 assert.deepEqual(c.dimensions.find(d=>d.dimension==='channel').item_ids,['item-1']);
 assert.equal(c.dimensions.find(d=>d.dimension==='stores').sources.purchases,2,'only the two personal purchases');
});

test('inspiration and liked items raise taste dimensions to weak at most',()=>{
 const c=coverage({facts:[fact('inspiration','the row','quiet luxury')],liked:6});
 for(const d of ['silhouettes','palette','brands'])assert.equal(status(c,d),'weak',d);
 assert.equal(c.level,'thin');
});

test('deleted facts are ignored',()=>{
 const c=coverage({facts:[{...fact('brand','cos','likes'),deleted:true}]});
 assert.equal(status(c,'brands'),'missing');
});

test('a failing source is skipped and logged; coverage still returns',async()=>{
 const logs=[];
 const store={profile:async()=>({facts:[fact('store','depop','buys vintage there')]}),gmailImport:async()=>{throw Error('down');},
  styleSources:async()=>[{id:'a',kind:'outfit'}],styleSession:async()=>({data:{}}),evidence:async()=>[{id:'liked:x',data:{}}]};
 const c=await readCoverage(store,owner,{log:l=>logs.push(JSON.parse(l))});
 assert.equal(status(c,'stores'),'known');
 assert.equal(status(c,'silhouettes'),'weak');
 assert.deepEqual(logs,[{event:'coverage_source_failed',source:'purchases'}]);
});

test('the coverage log line carries statuses only, never purchase details',async()=>{
 const logs=[];
 const rows=[buy(1,{brand:'Secret Brand',product:'Secret Jacket'})],state=stateOf(rows);
 const store={gmailImport:async()=>({data:{item_tags:tagged(state,()=>({}))}}),evidence:async()=>rows,profile:async()=>null};
 const c=await logCoverage(store,owner,'import_ready',{log:l=>logs.push(l)});
 assert.equal(c.dimensions.find(d=>d.dimension==='brands').status,'weak','the purchase was read');
 const line=JSON.parse(logs.at(-1));
 assert.equal(line.event,'coverage_computed');
 assert.equal(line.trigger,'import_ready');
 assert.deepEqual(Object.keys(line).filter(k=>DIMENSIONS.includes(k)),DIMENSIONS);
 assert.ok(!/Secret/.test(logs.join('\n')));
});
