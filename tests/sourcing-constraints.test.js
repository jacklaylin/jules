import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {formatSearch} from '../lib/search.js';

// Required brands, sold-out listings and reply wording are enforced on verified sourcing data,
// whatever wording the request used.
const plan=(extra={})=>({continuation:false,mode:'discover',required_brands:[],hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[],...extra});
const p=(id,brand,{availability=null,name='Wide pleated trouser '+id,match='likely_match'}={})=>({brand,name,url:'https://shop.example/products/'+id,match,sourcing_status:'store_found',
  listing_check:{status:'verified',product_name:name,product_brand:brand,availability,url:'https://shop.example/products/'+id},price_snapshot:{amount:300,currency:'USD'}});
async function run(args,products,state=null){
  let recorded,queries=[];
  const reply=await textWishlistAction(args,{state,env:{},record:async r=>{recorded=r;},search:async q=>{queries.push(q);return {products,refinement_attempted:true};},rank:async x=>x});
  return {reply,recorded,queries,state:recorded.text_wishlist_state};
}
const start=(extra)=>({action:'start',query:'Our Legacy wide-leg pleated khaki trousers',search_plan:plan(extra)});

test('a required brand filters verified candidates by the retailer page brand, in discovery too',async()=>{
  const {reply,recorded,queries,state}=await run(start({required_brands:['Our Legacy']}),[p('a','CMMN SWDN'),p('b','The Row'),p('c','OUR LEGACY WORK SHOP'),p('d','Our Legacy')]);
  assert.match(queries[0],/only products from Our Legacy qualify/);assert.doesNotMatch(queries[0],/new brands/);
  assert.deepEqual(state.options.map(o=>o.url),[p('c').url,p('d').url]);
  assert.doesNotMatch(reply,/products\/a|products\/b/);
  assert.deepEqual(recorded.products.map(o=>o.url),state.options.map(o=>o.url),'shown products are recorded');
  const d=recorded.text_wishlist_diagnostics;
  assert.equal(d.status,'shown');assert.deepEqual(d.required_brands,['Our Legacy']);assert.equal(d.mode,'discover');
  assert.deepEqual(d.brand_rejections.map(r=>r.brand),['CMMN SWDN','The Row']);
});
test('a page without a brand field falls back to its product name, then the search label',async()=>{
  const unnamed=(id,name,brand)=>{const x=p(id,brand,{name});x.listing_check.product_brand=null;return x;};
  const {state}=await run(start({required_brands:['our legacy']}),[unnamed('a','Our Legacy Borrowed Chino','Other'),unnamed('b','Borrowed Chino','Our Legacy'),unnamed('c','Ourlegacyish trouser','Elsewhere')]);
  assert.deepEqual(state.options.map(o=>o.url),[p('a').url,p('b').url]);
});
test('without a required brand, other brands remain welcome',async()=>{
  const {state,queries}=await run(start(),[p('a','CMMN SWDN'),p('b','Our Legacy')]);
  assert.equal(state.options.length,2);assert.match(queries[0],/new brands and stores are welcome/);
});
test('when only other brands verify, Jules offers to widen instead of substituting them',async()=>{
  const {reply,state,recorded}=await run(start({required_brands:['Our Legacy']}),[p('a','CMMN SWDN'),p('b','The Row')]);
  assert.match(reply,/Our Legacy/);assert.match(reply,/similar brands/);assert.doesNotMatch(reply,/https?:/);
  assert.equal(state.stage,'search_clarification');assert.deepEqual(state.options,[]);assert.deepEqual(state.search_plan.required_brands,['Our Legacy']);
  assert.equal(recorded.text_wishlist_diagnostics.brand_rejections.length,2);
});
test('sold-out listings are never offered as options when an available one verifies',async()=>{
  const {reply,state,recorded}=await run(start({required_brands:['Our Legacy']}),[p('a','Our Legacy',{availability:'OutOfStock'}),p('b','Our Legacy',{availability:'InStock'}),p('c','Our Legacy')]);
  assert.deepEqual(state.options.map(o=>o.url),[p('b').url,p('c').url],'unknown availability stays eligible, never claimed in stock');
  assert.doesNotMatch(reply,/products\/a/);assert.doesNotMatch(reply,/in stock/i);
  assert.deepEqual(recorded.text_wishlist_diagnostics.sold_out.map(r=>r.url),[p('a').url]);
});
test('when everything verified is sold out, Jules says so and offers alternatives without a choice to save',async()=>{
  for(const mode of ['discover','identify']){
    const {reply,state}=await run(start({mode,required_brands:['Our Legacy']}),[p('a','Our Legacy',{availability:'OutOfStock'}),p('b','Our Legacy',{availability:'SoldOut'})]);
    assert.equal((reply.match(/Sold out/g)??[]).length,2,mode);assert.match(reply,/^Every match I verified is sold out./);assert.match(reply,/similar item/);
    assert.notEqual(state.stage,'choice');assert.deepEqual(state.options,[]);
  }
});
test('reply wording follows the final number of options',async()=>{
  const one=await run(start(),[p('a','Our Legacy')]);
  assert.doesNotMatch(one.reply,/A few options|Which feel closest|^1\. /m);assert.match(one.reply,/One option/);
  const three=await run(start(),[p('a','A'),p('b','B'),p('c','C')]);assert.match(three.reply,/A few options/);assert.match(three.reply,/Which feel closest/);
  const seen=await run(start({mode:'identify'}),[p('a','Our Legacy')]);assert.match(seen.reply,/This could match/);
  const seenMany=await run(start({mode:'identify'}),[p('a','Our Legacy'),p('b','Our Legacy',{name:'Other trouser b'})]);assert.match(seenMany.reply,/These could match/);
  assert.match(formatSearch({products:[p('a','A')]}),/^I found this option\./);
  assert.match(formatSearch({products:[p('a','A'),p('b','B')]}),/^I found these options\./);
});
test('a continued brand search keeps the brand while excluding what was already shown',async()=>{
  const first=await run(start({required_brands:['Our Legacy']}),[p('a','Our Legacy')]);
  const next=await run({action:'start',query:'Our Legacy wide-leg pleated khaki trousers, other options',search_plan:plan({continuation:true,required_brands:['Our Legacy'],exclude_option_indices:[0]})},[p('a','Our Legacy'),p('x','CMMN SWDN'),p('y','Our Legacy')],first.state);
  assert.deepEqual(next.state.options.map(o=>o.url),[p('y').url]);assert.ok(next.state.excluded_urls.includes(p('a').url));
});

// Fallback replies apply the same request scope as options, and keep in-scope partial results.
const u=(id,brand,{match='likely_match',name='Pleated chino '+id}={})=>({brand,name,url:'https://store.example/p/'+id,match,sourcing_status:'store_not_found',
  identity_sources:[{url:'https://store.example/p/'+id}],listing_checks:[{status:'check_failed'}]});
const bonus=(id,brand,match='similar')=>({...p(id,brand,{match}),role:'bonus'});
test('an unverifiable in-brand match is shown honestly instead of reported as nothing found, in every mode',async()=>{
  for(const mode of ['identify','discover']){
    const {reply,state,recorded}=await run(start({mode,required_brands:['Our Legacy']}),[u('a','Our Legacy'),u('b','CMMN SWDN'),bonus('c','The Row')]);
    assert.match(reply,/haven’t verified/,mode);assert.match(reply,/store\.example\/p\/a/,mode);
    assert.doesNotMatch(reply,/p\/b|products\/c|Bonus|I found this option|couldn’t find a verified/,mode);
    assert.notEqual(state.stage,'choice');assert.deepEqual(recorded.text_wishlist_diagnostics.unverified_shown,[u('a').url]);
  }
});
test('an out-of-scope verified extra is never presented as the found item',async()=>{
  // Identify mode: a verified similar extra from the right brand is not the requested item.
  const branded=await run(start({mode:'identify',required_brands:['Our Legacy']}),[bonus('c','Our Legacy'),u('b','CMMN SWDN')]);
  assert.match(branded.reply,/Our Legacy/);assert.match(branded.reply,/similar brands/);assert.doesNotMatch(branded.reply,/https?:|Bonus/);
  const open=await run(start({mode:'identify'}),[bonus('c','Our Legacy'),p('d','Our Legacy',{match:'similar'})]);
  assert.doesNotMatch(open.reply,/https?:|Bonus|I found this option/);assert.match(open.reply,/couldn’t verify a match/);
  // Previously shown or rejected candidates stay out of the fallback too.
  const first=await run(start({mode:'identify'}),[p('a','Our Legacy')]);
  const again=await run({action:'start',query:'Our Legacy pleated chino, others',search_plan:plan({mode:'identify',continuation:true,exclude_option_indices:[0]})},[{...u('a','Our Legacy'),url:p('a').url}],first.state);
  assert.doesNotMatch(again.reply,/products\/a/);
});
test('a link the user just sent is offered first when verified and acknowledged when not',async()=>{
  const link={...p('s','',{name:'Still Chino Trousers'}),reference_provenance:'user_link'};link.listing_check.product_brand=null;
  const reference=extra=>({stage:'reference',supplied_links:[extra.url],options:[extra]});
  for(const mode of ['identify','discover']){
    const verified=await run(start({mode,required_brands:['Our Legacy']}),[p('a','Our Legacy'),p('b','Other')],reference(link));
    assert.equal(verified.state.options[0].url,link.url,mode);assert.ok(verified.state.options.some(o=>o.url===p('a').url));
    assert.doesNotMatch(verified.reply,/couldn’t open the page you sent/);
    const blocked={...link,sourcing_status:'store_not_found',match:'unverified',listing_check:undefined};
    const failed=await run(start({mode,required_brands:['Our Legacy']}),[p('a','Our Legacy')],reference(blocked));
    assert.match(failed.reply,/^I couldn’t open the page you sent/,mode);assert.match(failed.reply,/products\/a/);
    assert.deepEqual(failed.recorded.text_wishlist_diagnostics.supplied_links.map(s=>s.status),['unverified']);
    const nothing=await run(start({mode,required_brands:['Our Legacy']}),[],reference(blocked));
    assert.match(nothing.reply,/^I couldn’t open the page you sent/,mode);assert.match(nothing.reply,/similar brands/);
  }
  const sold={...link,listing_check:{...link.listing_check,availability:'OutOfStock'}};
  const soldReply=await run(start({mode:'identify'}),[p('a','Our Legacy')],reference(sold));
  assert.match(soldReply.reply,/sold out/);assert.notEqual(soldReply.state.options[0].url,link.url);
});
test('search replies never end with a technical verification footer, and extras never read as the found item',()=>{
  const body=formatSearch({products:[p('a','A'),u('b','B'),u('c','C')]});
  assert.match(body,/^I found this option\./);assert.doesNotMatch(body,/product-page checks|Other retrieved sources|p\/b/);
  assert.doesNotMatch(formatSearch({products:[bonus('c','Our Legacy','likely_match')]}),/^I found this option/);
});
