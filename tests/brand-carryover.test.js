import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchPlan,carriedBrands,textWishlistAction} from '../lib/text-wishlist.js';
import {scoreAgentEval} from '../lib/agent-eval.js';

// October 21: a dupe of a linked sweater searched only its own brand. When the tester asked for other
// brands, the plan left that brand out entirely instead of keeping it as the look to match, so the
// ranker had nothing to compare with and mass-market knits were shown. Continuing the same request
// now keeps the current plan's brands; only a brand the model marks dropped is removed.

const previous={continuation:false,mode:'discover',required_brands:['Our Legacy'],reference_brands:[],level:null,hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[]};
const raw=(brands,continuation='same_request')=>({continuation,mode:'discover',named_model:null,brands,level:null,hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[],price:{min:null,max:null,currency:null,budget_key:null}});

test('a brand left out while continuing stays as a reference; dropped, required or reference ones are as the model says',async()=>{
 // Widening beyond it, in any of the ways the model can write it.
 for(const brands of [[],[{name:'Sunspel',role:'reference'}],[{name:'our legacy',role:'reference'}]]){
  const plan=carriedBrands(searchPlan(raw(brands)),previous);
  assert.deepEqual(plan.required_brands,[]);
  assert.ok(plan.reference_brands.some(b=>b.toLowerCase()==='our legacy'),JSON.stringify(brands));
  assert.equal(plan.reference_brands.filter(b=>b.toLowerCase()==='our legacy').length,1,'never listed twice');
 }
 assert.deepEqual(carriedBrands(searchPlan(raw([])),previous).carried_brands,['Our Legacy']);
 // Kept as required: nothing carried.
 const kept=carriedBrands(searchPlan(raw([{name:'Our Legacy',role:'required'}])),previous);
 assert.deepEqual([kept.required_brands,kept.reference_brands,kept.carried_brands],[['Our Legacy'],[],undefined]);
 // Dropped: removed, not carried.
 const dropped=carriedBrands(searchPlan(raw([{name:'Our Legacy',role:'dropped'}])),previous);
 assert.deepEqual([dropped.required_brands,dropped.reference_brands,dropped.dropped_brands],[[],[],['Our Legacy']]);
 // A new request starts clean.
 assert.deepEqual(carriedBrands(searchPlan(raw([],'new_request')),previous).reference_brands,[]);
 // Reference brands carry over too, and a plan with no previous one is unchanged.
 assert.deepEqual(carriedBrands(searchPlan(raw([])),{...previous,required_brands:[],reference_brands:['Auralee']}).reference_brands,['Auralee']);
 const alone=searchPlan(raw([]));assert.equal(carriedBrands(alone,null),alone);
});

test('the search ranks against the carried brand, so results unlike it can be left out',async()=>{
 const p=(id,brand)=>({brand,name:'Half zip '+id,url:`https://${id}.example/products/half-zip`,match:'similar',sourcing_status:'store_found',listing_check:{status:'verified',product_name:'Half zip '+id,product_brand:brand},price_snapshot:{amount:200,currency:'USD'}});
 const state={stage:'search_clarification',options:[],search_brief:'red wool half zip',search_plan:previous};
 for(const brands of [[],[{name:'Sunspel',role:'reference'}]]){
  let ranked,result;
  await textWishlistAction({action:'start',query:'red wool half zip sweater, other brands',search_plan:searchPlan(raw(brands))},{state,env:{},facts:[],record:async r=>{result=r;},
   stylist:async()=>[],search:async()=>({status:'found',products:[p('a','Sunspel'),p('b','Mass Label')]}),rank:async(list,o)=>{ranked=o;return list;},owned:async()=>[]});
  assert.ok(ranked.referenceBrands.includes('Our Legacy'),JSON.stringify(brands));
  assert.deepEqual(result.text_wishlist_state.search_plan.carried_brands,['Our Legacy'],'recorded with the plan');
 }
});

test('routing evals are scored on the plan with the pending brands carried',()=>{
 const test={id:'x',pending:{search_plan:previous},expect:{tool:'find_products',args:{search_plan:{required_brands:[],reference_brands:['Our Legacy']}}}};
 const call=brands=>[{name:'find_products',args:{query:'red half zip',search_plan:raw(brands)}}];
 assert.deepEqual(scoreAgentEval(test,call([])).failures,[]);
 assert.notDeepEqual(scoreAgentEval(test,call([{name:'Our Legacy',role:'dropped'}])).failures,[]);
});
