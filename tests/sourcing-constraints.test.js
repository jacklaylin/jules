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
    assert.equal((reply.match(/ · sold out/g)??[]).length,2,mode);assert.match(reply,/^every match i verified is sold out./);assert.match(reply,/similar item/);
    assert.notEqual(state.stage,'choice');assert.deepEqual(state.options,[]);
  }
});
test('reply wording follows the final number of options',async()=>{
  const one=await run(start(),[p('a','Our Legacy')]);
  assert.doesNotMatch(one.reply,/A few options|Which feel closest|^1\. /m);assert.match(one.reply,/one option/);
  const three=await run(start(),[p('a','A'),p('b','B'),p('c','C')]);assert.match(three.reply,/a few options/);assert.match(three.reply,/which feel closest/);
  const seen=await run(start({mode:'identify'}),[p('a','Our Legacy')]);assert.match(seen.reply,/this could match/);
  const seenMany=await run(start({mode:'identify'}),[p('a','Our Legacy'),p('b','Our Legacy',{name:'Other trouser b'})]);assert.match(seenMany.reply,/these could match/);
  assert.match(formatSearch({products:[p('a','A')]}),/^i found this option\./);
  assert.match(formatSearch({products:[p('a','A'),p('b','B')]}),/^i found these options\./);
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
    assert.match(reply,/can’t see its price or sizes from here/,mode);assert.doesNotMatch(reply,/couldn’t be (checked|read)|error|verif/i,mode);assert.match(reply,/store\.example\/p\/a/,mode);
    assert.doesNotMatch(reply,/p\/b|products\/c|Bonus|I found this option|couldn’t find a verified/,mode);
    // The unread page is a real option: selectable, with price and sizes unknown.
    assert.equal(state.stage,'choice',mode);assert.deepEqual(state.options.map(o=>o.url),[u('a').url],mode);assert.deepEqual(recorded.text_wishlist_diagnostics.unverified_shown,[u('a').url]);
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
    assert.doesNotMatch(verified.reply,/can’t see the price or stock on the page you sent/);
    const blocked={...link,sourcing_status:'store_not_found',match:'unverified',listing_check:undefined};
    const failed=await run(start({mode,required_brands:['Our Legacy']}),[p('a','Our Legacy')],reference(blocked));
    assert.match(failed.reply,/^i can’t see the price or stock on the page you sent/,mode);assert.match(failed.reply,/products\/a/);
    assert.deepEqual(failed.recorded.text_wishlist_diagnostics.supplied_links.map(s=>s.status),['unverified']);
    const nothing=await run(start({mode,required_brands:['Our Legacy']}),[],reference(blocked));
    assert.match(nothing.reply,/^i can’t see the price or stock on the page you sent/,mode);assert.match(nothing.reply,/similar brands/);
  }
  const sold={...link,listing_check:{...link.listing_check,availability:'OutOfStock'}};
  const soldReply=await run(start({mode:'identify'}),[p('a','Our Legacy')],reference(sold));
  assert.match(soldReply.reply,/sold out/);assert.notEqual(soldReply.state.options[0].url,link.url);
});
test('search replies never end with a technical verification footer, and extras never read as the found item',()=>{
  const body=formatSearch({products:[p('a','A'),u('b','B'),u('c','C')]});
  assert.match(body,/^i found this option\./);assert.doesNotMatch(body,/product-page checks|Other retrieved sources|p\/b/);
  assert.doesNotMatch(formatSearch({products:[bonus('c','Our Legacy','likely_match')]}),/^I found this option/);
});

// A named model is the exact product the user wants; the model's plan field, not wording, decides.
test('a named model is searched as identification and the query always carries the name',async()=>{
  const briefs=[['Dries Van Noten pants in black','Peyter'],['black wide-leg trousers, ideally in my size','Peyter'],['Jacques Marie Mage sunglasses','Romi'],['Balenciaga large bag in black','Rodeo']];
  for(const [query,named_model] of briefs){
    const {recorded,queries,state}=await run({action:'start',query,search_plan:plan({named_model,required_brands:[]})},[p('a','Brand')]);
    assert.match(queries[0],new RegExp(named_model));
    assert.equal(state.search_plan.mode,'identify');assert.equal(recorded.text_wishlist_diagnostics.mode,'identify');
    assert.equal(state.search_plan.named_model,named_model);
  }
  const {queries}=await run({action:'start',query:'Dries Van Noten Peyter pants',search_plan:plan({named_model:'peyter'})},[p('a','Brand')]);
  assert.equal(queries[0].match(/peyter/gi).length,1,'a name already in the brief is not repeated');
});
test('without a named model the agent’s mode and brief are unchanged',async()=>{
  for(const named_model of [null,undefined,'','  ']){
    const {queries,state}=await run({action:'start',query:'relaxed khakis, any brand',search_plan:plan({named_model})},[p('a','Brand')]);
    assert.equal(state.search_plan.mode,'discover');assert.match(queries[0],/^relaxed khakis, any brand/);
  }
});

// A candidate whose own page checked out as a category/collection page is withheld; what is shown stays
// selectable, so a follow-up refers to exactly the items in the reply.
const collectionPage=(id,brand)=>({...u(id,brand),url:'https://store.example/collections/trousers?page='+id,identity_sources:[{url:'https://store.example/collections/trousers?page='+id}],listing_checks:[{url:'https://store.example/collections/trousers?page='+id,status:'not_product'}]});
test('a collection page is never offered as a possible match; the brand question follows instead',async()=>{
  for(const mode of ['identify','discover']){
    const {reply,state,recorded}=await run(start({mode,required_brands:['Our Legacy']}),[collectionPage('2','Our Legacy')]);
    assert.ok(!reply.includes('collections/trousers'),mode);assert.match(reply,/Our Legacy/,mode);
    assert.deepEqual(state.options,[],mode);
    assert.deepEqual(recorded.text_wishlist_diagnostics.unverified_withheld,[collectionPage('2').url],mode);
    assert.deepEqual(recorded.text_wishlist_diagnostics.unverified_shown,[],mode);
  }
  // Mixed with a page that only failed to load, the loadable-but-unchecked one is option 1.
  const {reply,state}=await run(start({mode:'identify',required_brands:['Our Legacy']}),[collectionPage('2','Our Legacy'),u('a','Our Legacy')]);
  assert.ok(!reply.includes('collections/trousers'));assert.match(reply,/Our Legacy Pleated chino a/);
  assert.deepEqual(state.options.map(o=>o.url),[u('a').url]);
});
test('after an unverified result, follow-ups resolve against the shown items across varied selections',async()=>{
  const shown=await run(start({mode:'identify',required_brands:['Our Legacy']}),[u('a','Our Legacy'),u('b','Our Legacy')]);
  assert.deepEqual(shown.state.options.map(o=>o.url),[u('a').url,u('b').url]);
  const select=async(args)=>{let recorded;const reply=await textWishlistAction({action:'selection',consent:'none',consent_context:'none',...args},{state:shown.state,env:{},record:async r=>{recorded=r;},search:()=>assert.fail('a selection must not restart search')});return {reply,recorded};};
  // One, both, none and a hesitant answer each keep the intended set; nothing is saved without consent.
  for(const [indices,decision,size] of [[[1],'interest',1],[[0,1],'interest',2]]){
    const {recorded}=await select({decision,option_indices:indices});
    assert.equal(recorded.text_wishlist_state.stage,'offer_set');
    assert.deepEqual(recorded.text_wishlist_state.selected_set.map(o=>o.url),indices.map(i=>shown.state.options[i].url));
    assert.equal(recorded.text_wishlist_state.selected_set.length,size);assert.notEqual(recorded.user_confirmed,true);
  }
  const none=await select({decision:'decline',option_indices:[]});assert.equal(none.recorded.text_wishlist_state,null);
  const unsure=await select({decision:'clarify',option_indices:[],response:'which one looked closer to you?'});
  assert.deepEqual(unsure.recorded.text_wishlist_state.options.map(o=>o.url),[u('a').url,u('b').url]);
});
