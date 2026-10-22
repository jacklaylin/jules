import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lookCheck,lookFor,ownBrands} from '../lib/look-check.js';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
import {textWishlistAction} from '../lib/text-wishlist.js';

// October 22 (dev-108fce7f): in a red chunky half-zip search naming no brand, a small casual label's
// listing filled one of three slots for a shopper whose brands are Saint Laurent, Prada and Dries. The
// founder would rather see two options than one Jules isn't confident in. With no brand, level or price in
// the request, the look is the user's own brands; one listing per call is read against it.
const p=(id,brand)=>({brand,name:'Half Zip '+id,url:`https://${id}.example/products/half-zip`,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:'Half Zip '+id,product_brand:brand,description:'A half zip.'},price_snapshot:{amount:200,currency:'USD'}});
const filling=p('filling','Filling Pieces'),reef=p('reef','ReefKnots'),dries=p('dries','Dries Van Noten');
const answer=json=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(json)}]}]})});
const env={OPENAI_API_KEY:'test'};
const taste={field:'brand_taste',key:'summary',value:JSON.stringify({brands:[{brand:'MFPEN',bought:3},{brand:'Dries Van Noten',said:{value:'favorite brand'}},{brand:'Prada',said:{value:'favorite brand'}}]})};
const facts=[taste,{field:'avoid',key:'avoid-fast-fashion',value:'does not want generic fast fashion'}];
// A model stub answering per listing brand; it records what each call was sent.
const model=verdicts=>{const sent=[];return {sent,fetcher:async(_u,o)=>{const input=JSON.parse(JSON.parse(o.body).input[0].content);sent.push(input);const v=verdicts[input.listing.brand];if(v instanceof Error)throw v;return answer({nearest_brand:'Prada',verdict:v??'close'});}};};

test('own brands come from the brand_taste reading, else stated brand facts, without avoided brands',()=>{
 assert.deepEqual(ownBrands(facts),['MFPEN','Dries Van Noten','Prada']);
 assert.deepEqual(ownBrands([{field:'brand',key:'style-pack/prada',value:'favorite brand'},{field:'brand',key:'prada',value:'favorite brand'},{field:'brand',key:'gap',value:'x'},{field:'avoid',key:'gap',value:'no'}]),['prada']);
 assert.deepEqual(ownBrands([{field:'brand',key:'prada',value:'x',deleted:true}]),[]);
});

test('the look: named brands or a level first; else own brands, unless price, someone else or nothing known says not to',()=>{
 assert.deepEqual(lookFor({referenceBrands:['Our Legacy'],facts}),{brands:['Our Legacy'],level:null,basis:'request'});
 assert.deepEqual(lookFor({level:'luxury',facts}),{brands:[],level:'luxury',basis:'request'});
 assert.deepEqual(lookFor({facts}),{brands:['MFPEN','Dries Van Noten','Prada'],level:null,basis:'taste'});
 // A quality stance (no ceiling, no wish for lower prices) keeps the user's brands as the look.
 assert.equal(lookFor({facts,band:{min:null,max:null,prefers_lower:false,quality:true}}).basis,'taste');
 for(const input of [{facts,band:{min:null,max:null,prefers_lower:true}},{facts,band:{min:null,max:150}},{facts,forSomeoneElse:true},{facts:[]}])
  assert.equal(lookFor(input),null,JSON.stringify(input));
});

test('a listing read as unlike the look is returned; close, unsure and failed reads keep it',async()=>{
 const {sent,fetcher}=model({ReefKnots:'unlike','Filling Pieces':'close'});
 const record={};
 const out=await lookCheck([filling,reef],{look:lookFor({facts}),env,fetcher,record});
 assert.deepEqual([...out.keys()],[reef.url]);assert.equal(out.get(reef.url).brand,'ReefKnots');
 assert.deepEqual(sent[0].look,{brands:['MFPEN','Dries Van Noten','Prada'],level:null});
 assert.equal(sent[0].listing.price.amount,200);
 assert.equal(record.look_check.basis,'taste');assert.equal(record.look_check.checked,2);
 for(const verdict of ['unsure',Error('offline')]){
  const r={};const kept=await lookCheck([reef],{look:lookFor({facts}),env,fetcher:model({ReefKnots:verdict}).fetcher,record:r});
  assert.equal(kept.size,0);
 }
});

test('a candidate of a look brand or a link the user sent is never checked; no look, no calls',async()=>{
 const {sent,fetcher}=model({'Dries Van Noten':'unlike',ReefKnots:'unlike'});
 const out=await lookCheck([dries,reef],{look:lookFor({facts}),keep:[reef.url],env,fetcher});
 assert.equal(out.size,0);assert.equal(sent.length,0);
 assert.equal((await lookCheck([reef],{look:null,env,fetcher})).size,0);assert.equal(sent.length,0);
});

test('the ranker no longer leaves anything out by itself',async()=>{
 const record={};
 const out=await rankDiscoveryProducts([filling,reef,dries],{query:'red half-zip',referenceBrands:['Dries Van Noten'],env,record,fetcher:async()=>answer({indices:[2,0,1],rejected_indices:[],unlike_references_indices:[0,1]})});
 assert.deepEqual(out.map(x=>x.brand),['Dries Van Noten','Filling Pieces','ReefKnots']);
});

const plan={continuation:false,mode:'discover',hard_constraints:['half-zip sweater','red'],guidance:[],reference_brands:[],required_brands:[],keep_option_indices:[],exclude_option_indices:[]};
const turn=async({unlike=[],products=[filling,reef,dries],search_plan=plan}={})=>{
 let result,asked;
 const reply=await textWishlistAction({action:'start',query:'red chunky half-zip',search_plan},{env:{},facts,record:async r=>{result=r;},
  stylist:async()=>[],search:async()=>({status:'found',products}),rank:async list=>list,owned:async()=>[],
  look:async(list,input)=>{asked=input.look;return new Map(list.filter(x=>unlike.includes(x.brand)).map(x=>[x.url,{brand:x.brand}]));}});
 return {reply,result,asked};
};

test('discovery leaves out a candidate unlike the user\'s own brands and says so in those terms',async()=>{
 const {reply,result,asked}=await turn({unlike:['ReefKnots']});
 assert.equal(asked.basis,'taste');
 assert.match(reply,/left out one that wasn’t close to the brands you usually go for/);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.brand),['Filling Pieces','Dries Van Noten']);
 assert.ok(result.text_wishlist_state.excluded_urls.includes(reef.url),'not shown again as "more"');
 assert.equal(result.text_wishlist_diagnostics.rank.unlike_basis,'taste');
 const none=await turn({unlike:['ReefKnots','Filling Pieces'],products:[filling,reef]});
 assert.match(none.reply,/nothing i found is close enough to the brands you usually go for yet/);
 assert.ok(!/https?:\/\//.test(none.reply));assert.equal(none.result.text_wishlist_diagnostics.status,'unlike_references');
});

test('one left out that would never have been shown is not announced',async()=>{
 const pool=['a','b','c','d'].map(id=>p(id,'Brand '+id));
 const {reply,result}=await turn({unlike:['Brand d'],products:pool});
 assert.ok(!/left out/.test(reply));assert.equal(result.text_wishlist_state.options.length,3);
});
