import test from 'node:test';
import assert from 'node:assert/strict';
import {earlyReadText,earlyReadFor} from '../lib/early-read.js';
import {coverage} from '../lib/coverage.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {tagFingerprint,TAG_VERSION} from '../lib/item-tags.js';

const owner='owner',on={INTERVIEW_ENABLED:'true'};
const buy=(n,v={},price=null)=>purchaseEvidence({event_id:`m${n}:purchased`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',basis:'order_confirmation',category:'clothing',
 ...(price?{price:{amount:price,currency:'USD',text:'$'+price}}:{}),
 values:{merchant:'Depop',order_reference:'O'+n,sku:null,brand:null,color:null,size_label:null,size_system:null,quantity:1,units_per_pack:null,product:'Item '+n,...v},item_id:'item-'+n,recipient:{value:'self',quote:'x'}});
const stateOf=rows=>projectReceiptEvidence(owner,rows).state;
const tagged=(state,tag=()=>({}))=>Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),v:TAG_VERSION,item_type:'jacket',group:'tops',color_family:'unknown',resale:true,...tag(i)}]));
const fact=(field,key,value,basis='stated')=>({field,key,value,basis,evidence_ids:['chat:'+field+key]});
const read=input=>earlyReadText({...input,coverage:coverage({...input,liked:(input.likedRows??[]).length})});
// Claims an early read must never make: a favourite store, or loyalty.
const UNSUPPORTED=/favou?rite|loyal|obsessed/i;

test('a resale-heavy history (case A) reads as secondhand, with secondhand spend and the store as history, not a favourite',()=>{
 const rows=[1,2,3,4,5,6,7].map(n=>buy(n,{color:n<=3?'brown':null,size_label:n<=5?'M':null},20+n));
 rows.push(buy(8,{merchant:'Uniqlo',brand:'Uniqlo'},40));
 const state=stateOf(rows),tags=tagged(state,i=>({group:i.id==='item-1'?'trousers':'tops',resale:i.merchant==='Depop'}));
 const facts=[fact('size','tops/us','M')];
 const r=read({facts,state,tags});
 assert.match(r.text,/early read/);
 assert.deepEqual(r.sources,['what you told me','your orders']);
 assert.match(r.text,/sizes you told me: M in tops \(us\)/);
 assert.match(r.text,/mostly secondhand/);
 assert.match(r.text,/most often from Depop/);
 assert.match(r.text,/spend secondhand: \$/);
 assert.doesNotMatch(r.text,UNSUPPORTED);
 assert.doesNotMatch(r.text,/from your outfit photos/,'no photos, so no claim about what they wear');
 assert.match(r.text,/photos of outfits you actually wear would sharpen it/,'it invites what would make it sharper');
});

test('stated answers alone make a read in their own words, and never a wear pattern (case B)',()=>{
 const facts=[fact('style','palette','earth tones, lots of brown'),fact('fit','jeans','relaxed, never skinny'),fact('store','depop','looks for vintage there')];
 const r=read({facts});
 assert.deepEqual(r.sources,['what you told me']);
 assert.match(r.text,/what you told me: palette: earth tones, lots of brown; jeans: relaxed, never skinny; depop: looks for vintage there/);
 assert.doesNotMatch(r.text,/ordered|outfit photos|saved/);
 assert.equal(r.lines.length,1);
});

test('inferred or deleted facts are not stated answers',()=>{
 assert.equal(read({facts:[fact('style','palette','black','inferred'),{...fact('brand','cos','likes'),deleted:true}]}),null);
});

test('saved items are what they like, never what they own',()=>{
 const likedRows=[1,2,3].map(n=>({id:'liked:'+n,data:{category:'slip skirt',brand:n<3?'Reformation':null}}));
 const r=read({likedRows});
 assert.deepEqual(r.sources,['what you saved']);
 assert.match(r.text,/from what you saved: lots of slip skirt, some Reformation/);
 assert.doesNotMatch(r.text,/you own|you wear|ordered/);
});

test('outfit photos are the only source that speaks to what they wear',()=>{
 const r=read({outfits:{kept:2,reading_photos:2,observations:1,texts:['wide-leg trousers with cropped knits']}});
 assert.match(r.text,/from your outfit photos: wide-leg trousers with cropped knits/);
 assert.match(r.text,/it’ll get sharper as we go/);
});

test('what is still unknown is said, not guessed',()=>{
 const r=read({facts:[fact('store','depop','vintage')]});
 assert.match(r.text,/still learning: your colours, the fits you like and your sizes\./);
});

test('nothing to say yet means no early read',()=>{
 assert.equal(read({}),null);
});

// The person's sources, in memory.
const storeWith=({facts=[],rows=[],tags={},outfits=0})=>({profile:async()=>({facts}),gmailImport:async()=>rows.length?{data:{item_tags:tags}}:null,evidence:async o=>o==='chat'?[]:rows,
 styleSources:async()=>Array.from({length:outfits},(_,i)=>({id:'o'+i,kind:'outfit'})),styleSession:async()=>({data:outfits?{outfit_reading:{photos:outfits,observations:[{text:'black wide-leg trousers'}]}}:{}})});

test('earlyReadFor: only for thin profiles, only with the interview on',async()=>{
 const thin=storeWith({facts:[fact('size','shoes/us_women','8')]});
 assert.equal(await earlyReadFor(thin,owner,{}),null,'off without INTERVIEW_ENABLED');
 const r=await earlyReadFor(thin,owner,on,{log:()=>{}});
 assert.equal(r.level,'thin');assert.match(r.text,/8 in shoes \(us women\)/);
 const rows=[1,2,3,4,5,6].map(n=>buy(n,{merchant:'COS',brand:'COS',color:'black'})),state=stateOf(rows);
 const rich=storeWith({facts:[fact('style','palette','black'),fact('store','cos','basics'),fact('budget','tops/usd','100')],rows,tags:tagged(state,()=>({color_family:'black',resale:false})),outfits:3});
 assert.equal(await earlyReadFor(rich,owner,on,{log:()=>{}}),null,'a rich profile keeps the purchase summary');
});

