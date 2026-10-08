import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,finishTextWishlist} from '../lib/text-wishlist.js';
import {wishlistProducts} from '../lib/wishlist.js';
import {generateReply} from '../lib/ai.js';
import {readSizeOffers,priceDrop} from '../lib/price-alerts.js';
import {groupWishlist} from '../lib/wishlist.js';
const product={brand:'Example',name:'Trail sneaker',url:'https://www.prada.com/product/example',match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',color:'Brown'},price_snapshot:{amount:400,currency:'USD',source_url:'https://www.prada.com/product/example',checked_at:'2026-10-07'}};
const env={PRICE_ALERTS_ENABLED:'true'};
const offer={size:'EU 45',key:'EU 45',amount:400,currency:'USD',available:true,url:product.url};
const inspect=async()=>({sizes:['EU 45'],checks:[{offers:[offer]}]});
function harness(){let recorded;return {record:async r=>{recorded=r;},get result(){return recorded;}};}
test('no, unrelated responses, unavailable alerts, and unconfirmed text searches never save or promise monitoring',async()=>{
  const h=harness(),state={stage:'confirm',selected:product,sizes:[]};
  await textWishlistAction({action:'save'},{state,text:'what else?',env,record:h.record});
  assert.equal(h.result.user_confirmed,undefined);
  await textWishlistAction({action:'selection',decision:'decline',option_indices:[]},{state,text:'no',env,record:h.record});
  assert.equal(h.result.text_wishlist_state,null);assert.equal(h.result.products.length,0);
  assert.deepEqual(await wishlistProducts({identification_policy:'text_wishlist',products:[product]},product.url,[],{}),[]);
  await textWishlistAction({action:'alert'},{state,text:'yes',env:{},record:h.record});
  assert.equal(h.result.alert_request,undefined);assert.equal(h.result.user_confirmed,undefined);
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
test('connected text chat interprets intent through the structured model and dispatches without invented prose',async()=>{
  const result=await generateReply([{direction:'inbound',body:'I really want those sneakers'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.text.format.type,'json_schema');
    return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({action:'start',query:'Trail sneaker',choice:''})}]}]})};
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
