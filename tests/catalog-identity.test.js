import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shopCandidates} from '../lib/text-sources.js';

// October 21: asked for one brand's exact derby, the store catalog returned the brand's other derby.
// Its name shared half its words with the brief ("black", "derby"), so the word check passed it as the
// exact model and Jules called it that. The plan had no named model, so the named-model check
// (October 18) never ran. Outside discovery, catalog pages now get the same identity judge as web
// results; the judge can only remove a page the word check let through.

const env={SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};
const pages={
 'https://brand.example/products/event-derby-black-crust':'Event Derby - Black Crust',
 'https://brand.example/products/scout-derby-black':'Black Scout Derbys',
 'https://store.example/products/brand-scout-derby':'Scout Derby in Black Leather'};
const search=async()=>({offers:Object.entries(pages).map(([url,title],i)=>({product_id:'p'+i,variant_id:'v'+i,url,title,seller:{domain:new URL(url).hostname},available:true})),ignored_filters:[],next:[]});
const verify=async url=>({status:'verified',url,product_brand:'Brand',product_name:pages[url]});
// The judge as the model answers: the brief's model is exact, the brand's other model is similar.
const judge=calls=>async(brief,candidates)=>{calls.push({brief,names:candidates.map(c=>c.check.product_name)});return candidates.map(c=>({match:/scout/i.test(c.check.product_name)?'exact':'similar',brand:'Brand'}));};

test('a brand’s other model is not shown as the exact one, with or without a named model in the plan',async()=>{
 for(const brief of ['Brand Black Scout Derbys','brand scout derby black','Brand black derbys, the scout']){
  for(const namedModel of [null,'Scout']){
   const calls=[];
   const found=await shopCandidates(brief,{env,search,verify,requiredBrands:['Brand'],namedModel,judge:judge(calls)});
   assert.ok(found.products.every(p=>/scout/i.test(p.name)),`${brief} / ${namedModel}`);
   assert.ok(found.products.every(p=>p.match==='likely_match'));
   assert.ok(!found.products.some(p=>p.url.includes('event-derby')),`${brief} / ${namedModel}`);
   // The other model is recorded as an identity rejection when the judge saw it.
   if(calls[0]?.names.includes('Event Derby - Black Crust'))assert.ok(found.diagnostics.rejections.some(r=>r.url.includes('event-derby')&&r.reason==='different_product'));
  }
 }
});

test('the judge only sees pages that pass the name check, and an unjudged page is not a match',async()=>{
 const calls=[];
 await shopCandidates('Brand Black Scout Derbys',{env,search,verify,requiredBrands:['Brand'],judge:judge(calls)});
 assert.equal(calls.length,1);
 assert.ok(calls[0].names.length>0&&calls[0].names.length<=3);
 // A judge that could not decide a page leaves it out, as for web results.
 const unsure=async(_b,candidates)=>candidates.map(()=>({match:'different',brand:'',unjudged:true}));
 const none=await shopCandidates('Brand Black Scout Derbys',{env,search,verify,requiredBrands:['Brand'],judge:unsure});
 assert.deepEqual(none.products,[]);
 assert.ok(none.diagnostics.rejections.every(r=>r.reason==='not_judged'));
});

test('discovery is unchanged: no judge call, and other models stay as similar candidates',async()=>{
 let called=false;
 const found=await shopCandidates('black leather derbys',{env,search,verify,mode:'discover',judge:async()=>{called=true;return [];}});
 assert.equal(called,false);
 assert.ok(found.products.some(p=>p.url.includes('event-derby')));
 assert.equal(found.diagnostics.rejections,undefined);
});

test('without the model, the judge’s own fallback keeps the earlier word check',async()=>{
 // No OPENAI_API_KEY: judgeCandidates falls back to the listing's brand and name words.
 const found=await shopCandidates('Brand Black Scout Derbys',{env,search,verify,requiredBrands:['Brand']});
 assert.ok(found.products.some(p=>p.url.includes('scout-derby-black')));
});
