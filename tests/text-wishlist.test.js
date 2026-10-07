import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,finishTextWishlist} from '../lib/text-wishlist.js';
import {wishlistProducts} from '../lib/wishlist.js';
import {generateReply} from '../lib/ai.js';
import {readSizeOffers,priceDrop} from '../lib/price-alerts.js';
import {groupWishlist} from '../lib/wishlist.js';
import {pendingColorChoices} from '../lib/wishlist-intent.js';
const product={brand:'Example',name:'Trail sneaker',url:'https://www.prada.com/product/example',match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',color:'Brown'},price_snapshot:{amount:400,currency:'USD',source_url:'https://www.prada.com/product/example',checked_at:'2026-10-07'}};
const env={PRICE_ALERTS_ENABLED:'true'};
const offer={size:'EU 45',key:'EU 45',amount:400,currency:'USD',available:true,url:product.url};
const inspect=async()=>({sizes:['EU 45'],checks:[{offers:[offer]}]});
function harness(){let recorded;return {record:async r=>{recorded=r;},get result(){return recorded;}};}
test('tentative multiple-color replies narrow pending choices without repeating sourcing or saving',async()=>{
 const options=['Ivory','Black','Navy'].map((color,i)=>({...product,url:product.url+'/'+i,listing_check:{...product.listing_check,color}}));
 const h=harness();
 const state={stage:'choice',query:'Example Trail sneaker',options};
 const body=await generateReply([{direction:'inbound',body:'Ivory or black I think'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async()=>assert.fail('No new model or search request'),{wishlistState:state,wishlistAction:args=>textWishlistAction(args,{state,text:'Ivory or black I think',env:{},record:h.record,search:()=>assert.fail('No new search')})});
 assert.deepEqual(h.result.text_wishlist_state.options.map(p=>p.listing_check.color),['Ivory','Black']);
 assert.equal(h.result.text_wishlist_state.stage,'choice');assert.equal(h.result.user_confirmed,undefined);assert.equal(h.result.alert_request,undefined);
 assert.doesNotMatch(body,/https:|Navy|found these listings/);assert.ok(body.endsWith('?'));
 const narrowed=h.result.text_wishlist_state;
 await textWishlistAction({action:'select',choice:'I prefer black'},{state:narrowed,text:'I prefer black',env:{},record:h.record});
 assert.equal(h.result.text_wishlist_state.selected.listing_check.color,'Black');assert.equal(h.result.text_wishlist_state.stage,'confirm');assert.equal(h.result.user_confirmed,undefined);
 assert.deepEqual(pendingColorChoices('Ivory but not black',state),['ivory']);
 assert.deepEqual(pendingColorChoices('I wore black yesterday',state),[]);
});
test('text desire sources real options but does not save; exact color selection offers only supported alerts',async()=>{
  const h=harness();
  const first=await textWishlistAction({action:'start',query:'Example Trail sneaker'},{env,record:h.record,search:async()=>({products:[product]})});
  assert.match(first,/Brown/);assert.equal(h.result.user_confirmed,undefined);assert.equal(h.result.products.length,0);
  const state=h.result.text_wishlist_state;
  await textWishlistAction({action:'select',choice:'brown'},{state,env,record:h.record,inspect});
  assert.equal(h.result.text_wishlist_state.selected.url,product.url);assert.equal(h.result.user_confirmed,undefined);
  await textWishlistAction({action:'select',choice:'green'},{state,env,record:h.record,inspect});
  assert.equal(h.result.text_wishlist_state.stage,'choice');
});
test('consent requires the pending offer, asks size, reconfirms, and rechecks baseline before preparing save',async()=>{
  const h=harness();let state={stage:'confirm',selected:product,sizes:['EU 45']};
  await textWishlistAction({action:'alert'},{state,text:'yes',env,record:h.record,inspect});
  state=h.result.text_wishlist_state;assert.equal(state.stage,'size');
  await textWishlistAction({action:'select',choice:'EU 45'},{state,text:'EU 45',env,record:h.record,inspect});
  state=h.result.text_wishlist_state;assert.equal(state.stage,'confirm');assert.equal(state.size,'EU 45');assert.equal(h.result.user_confirmed,undefined);
  await textWishlistAction({action:'alert'},{state,text:'yes',env,record:h.record,inspect});
  assert.equal(h.result.user_confirmed,true);assert.equal(h.result.alert_request.baselines[0].amount,400);
  const payload=await wishlistProducts(h.result,product.url,[{id:'old-photo'}],{},async()=>{throw Error();});
  assert.equal(payload[0].source_image_id,null);
  const stale=await textWishlistAction({action:'alert'},{state,text:'yes',env,record:h.record,inspect:async()=>({checks:[],sizes:[]})});
  assert.match(stale,/haven’t enabled/);assert.equal(h.result.user_confirmed,undefined);
});
test('no, unrelated responses, unavailable alerts, and unconfirmed text searches never save or promise monitoring',async()=>{
  const h=harness(),state={stage:'confirm',selected:product,sizes:[]};
  await textWishlistAction({action:'save'},{state,text:'what else?',env,record:h.record});
  assert.equal(h.result.user_confirmed,undefined);
  await textWishlistAction({action:'decline'},{state,text:'no',env,record:h.record});
  assert.equal(h.result.text_wishlist_state,null);assert.equal(h.result.products.length,0);
  assert.deepEqual(await wishlistProducts({identification_policy:'text_wishlist',products:[product]},product.url,[],{}),[]);
  await textWishlistAction({action:'alert'},{state,text:'yes',env:{},record:h.record});
  assert.equal(h.result.alert_request,null);assert.equal(h.result.user_confirmed,true);
});
test('active alert acknowledgement requires persisted wishlist item and successful activation',async()=>{
  const row={reply_id:'reply',item_id:'item',name:product.name,brand:product.brand,match:'likely_match',links:[{url:product.url}],messages:{created_at:'2026-10-07'}};
  const store={wishlistReplyId:async()=> 'reply',wishlistEntries:async()=>[row],enablePriceAlert:async input=>{assert.equal(input.p_item,'item');assert.equal(input.p_size,'EU 45');return {active:true};}};
  const result={identification_policy:'text_wishlist',user_confirmed:true,alert_request:{size:'EU 45',baselines:[offer],links:[{url:product.url,color:'Brown'}]}};
  assert.match(await finishTextWishlist({store,result,env,operation:'op',conversationId:'owner'}),/every three days/);
  await assert.rejects(finishTextWishlist({store:{...store,wishlistEntries:async()=>[]},result,env}));
  await assert.rejects(finishTextWishlist({store:{...store,enablePriceAlert:async()=>({active:false})},result,env}));
});
test('color changes or missing retailer color invalidate size-price monitoring',async()=>{
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Trail sneaker',color:'Black',size:'EU 45',offers:{price:400,priceCurrency:'USD',availability:'https://schema.org/InStock'}})+'</script>';
  const result=await readSizeOffers({url:product.url,name:product.name,color:'Brown'},async()=>new Response(html,{headers:{'Content-Type':'text/html'}}));
  assert.equal(result.status,'color_unverified');assert.deepEqual(result.offers,[]);
});
test('AI exposes text wishlist only when connected and dispatches tool without inventing prose',async()=>{
  const result=await generateReply([{direction:'inbound',body:'I really want those sneakers'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(url,options)=>{
    const body=JSON.parse(options.body);assert.ok(body.tools.some(t=>t.name==='text_wishlist'));assert.match(body.instructions,/I really want/);
    return {ok:true,json:async()=>({status:'completed',output:[{type:'function_call',name:'text_wishlist',arguments:JSON.stringify({action:'start',query:'Trail sneaker',choice:''})}]})};
  },{wishlistAction:async args=>{assert.equal(args.action,'start');return 'Sourced options';}});
  assert.equal(result,'Sourced options');
});
test('text alerts trigger on any verified drop while existing alerts retain the ten-percent rule',()=>{
  assert.equal(priceDrop({...offer,drop_percent:0},{...offer,amount:399}),true);
  assert.equal(priceDrop(offer,{...offer,amount:399}),false);
  assert.equal(priceDrop({...offer,drop_percent:0},{...offer,amount:400}),false);
  assert.equal(priceDrop({...offer,drop_percent:0},{...offer,amount:300,available:false}),false);
});
test('repeat text saves reuse one grid item and preserve separate products',()=>{
  const row={text_origin:'true',reply_id:'first',item_id:'one',name:product.name,match:'likely_match',links:[{url:product.url}],messages:{created_at:'2026-10-06'}};
  const groups=groupWishlist([row,{...row,reply_id:'second',messages:{created_at:'2026-10-07'}},{...row,item_id:'two',name:'Other shoe'}]);
  assert.equal(groups.length,2);assert.equal(groups[0].sent_at,'2026-10-07');
});
test('only exact, system-labeled saved sizes are reused; no guessing EU/US conversions',async()=>{
  const h=harness();
  await textWishlistAction({action:'select',choice:'brown'},{state:{stage:'choice',options:[product]},env,record:h.record,inspect,facts:[{field:'size',key:'shoes/eu',value:'45'}]});
  assert.equal(h.result.text_wishlist_state.size,'EU 45');
  await textWishlistAction({action:'select',choice:'brown'},{state:{stage:'choice',options:[product]},env,record:h.record,inspect,facts:[{field:'size',key:'shoes/us_men',value:'12'}]});
  assert.equal(h.result.text_wishlist_state.size,null);
});

test('wishlist search failure produces a specific reply and never advances saving or alerts',async()=>{
  const h=harness();
  const reply=await textWishlistAction({action:'start',query:'Trail sneakers'},{env,record:h.record,search:async()=>{throw new Error('Product search failed');}});
  assert.match(reply,/finish the search/);assert.doesNotMatch(reply,/prepare a reply|https:/);
  assert.equal(h.result.status,'failed');assert.equal(h.result.text_wishlist_state,null);
  assert.equal(h.result.user_confirmed,undefined);assert.equal(h.result.alert_request,undefined);
  assert.deepEqual(h.result.products,[]);assert.equal(h.result.text_wishlist_diagnostics.stage,'search');
});

test('failed category or unreadable candidates trigger one targeted product-page search',async()=>{
 const h=harness();let calls=0;
 const reply=await textWishlistAction({action:'start',query:'Example Trail sneaker'},{env,record:h.record,search:async(query)=>{
  calls++;
  if(calls===1)return {products:[{...product,url:'https://www.prada.com/category',sourcing_status:'store_not_found',listing_check:undefined,listing_checks:[{status:'not_product'}]}]};
  assert.match(query,/individual product detail pages/);assert.match(query,/Exclude: https:\/\/www.prada.com\/category/);
  return {products:[product]};
 }});
 assert.equal(calls,2);assert.match(reply,/Brown/);assert.equal(h.result.text_wishlist_state.stage,'choice');assert.equal(h.result.user_confirmed,undefined);
});
test('repeated unreadable candidates stop after one refinement without inventing product details',async()=>{
 const h=harness();let calls=0;
 const reply=await textWishlistAction({action:'start',query:'Example Trail sneaker'},{env,record:h.record,search:async()=>{calls++;return {products:[{...product,sourcing_status:'store_not_found',listing_check:{status:'check_failed'}}]};}});
 assert.equal(calls,2);assert.equal(h.result.text_wishlist_state,null);assert.equal(h.result.user_confirmed,undefined);assert.doesNotMatch(reply,/400|Brown|https:/);
});
