import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchPlan,textWishlistAction} from '../lib/text-wishlist.js';

// Brands the user names as taste, inspiration or a comparison are kept in the stored plan and shape
// the search, but never filter it. The model assigns the role; code only keeps what it assigned.
const raw=(brands,extra={})=>({continuation:'new_request',mode:'discover',named_model:null,brands,hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[],...extra});
const p=(id,brand)=>({brand,name:'Top '+id,url:'https://shop.example/products/'+id,match:'similar',sourcing_status:'store_found',
  listing_check:{status:'verified',product_name:'Top '+id,product_brand:brand,availability:null,url:'https://shop.example/products/'+id},price_snapshot:{amount:120,currency:'USD'}});
async function run(args,products,state=null){
  let recorded,queries=[];
  await textWishlistAction(args,{state,env:{},record:async r=>{recorded=r;},search:async q=>{queries.push(q);return {products,refinement_attempted:true};},rank:async x=>x});
  return {queries,state:recorded.text_wishlist_state};
}

test('reference brands are kept separately from required ones, deduplicated, in the user\'s spelling',()=>{
  const plan=searchPlan(raw([{name:'Brand Ref A',role:'reference'},{name:' Brand Ref A ',role:'reference'},{name:'Brand Req',role:'required'},{name:'Brand Ref B',role:'reference'}]));
  assert.deepEqual(plan.required_brands,['Brand Req']);
  assert.deepEqual(plan.reference_brands,['Brand Ref A','Brand Ref B']);
  assert.equal('brands' in plan,false);
});
test('a brand marked both required and reference stays required only',()=>{
  const plan=searchPlan(raw([{name:'Brand Req',role:'required'},{name:'brand req',role:'reference'}]));
  assert.deepEqual(plan.required_brands,['Brand Req']);assert.deepEqual(plan.reference_brands,[]);
});
test('alternatives keep reference brands while the named model becomes guidance',()=>{
  const plan=searchPlan(raw([{name:'Brand Ref',role:'reference'}],{mode:'alternatives',named_model:'Model X'}));
  assert.equal(plan.mode,'discover');assert.deepEqual(plan.reference_brands,['Brand Ref']);assert.deepEqual(plan.guidance,['like the Model X']);
});
test('a stored plan without brand roles is left as it was',()=>{
  const stored={continuation:true,mode:'discover',required_brands:['Brand Req'],hard_constraints:[],guidance:[]};
  assert.deepEqual(searchPlan(stored),{...stored,continuation:true});
});

test('reference brands reach the search as taste, and every brand stays welcome',async()=>{
  const plan=searchPlan(raw([{name:'Brand Ref A',role:'reference'},{name:'Brand Ref B',role:'reference'}]));
  const {queries,state}=await run({action:'start',query:'going out top with visual interest',search_plan:plan},[p('a','Other One'),p('b','Other Two')]);
  assert.match(queries[0],/style references the user named/);assert.match(queries[0],/Brand Ref A/);assert.match(queries[0],/Brand Ref B/);
  assert.match(queries[0],/new brands and stores are welcome/);assert.doesNotMatch(queries[0],/only products from/);
  assert.equal(state.options.length,2,'reference brands never filter results');
  assert.deepEqual(state.search_plan.reference_brands,['Brand Ref A','Brand Ref B'],'kept for the next turn');
});
test('without reference brands the search query carries no reference clause',async()=>{
  const {queries}=await run({action:'start',query:'black slim top',search_plan:searchPlan(raw([]))},[p('a','Any')]);
  assert.doesNotMatch(queries[0],/style references/);
});
test('a follow-up that keeps a reference brand while asking for more still searches all brands',async()=>{
  const first=await run({action:'start',query:'slim 3/4 sleeve top',search_plan:searchPlan(raw([{name:'Brand Ref',role:'reference'}]))},[p('a','Other')]);
  const more=searchPlan(raw([{name:'Brand Ref',role:'reference'}],{continuation:'same_request',exclude_option_indices:[0]}));
  const {queries,state}=await run({action:'start',query:'slim 3/4 sleeve top, more options',search_plan:more},[p('b','Another'),p('c','Third')],first.state);
  assert.match(queries[0],/Brand Ref/);assert.doesNotMatch(queries[0],/only products from/);
  assert.deepEqual(state.options.map(o=>o.url),[p('b').url,p('c').url]);
});
