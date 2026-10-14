import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,settleTextWishlist,settledReply} from '../lib/text-wishlist.js';
import {generateReply} from '../lib/ai.js';
import {manageAlerts} from '../lib/inbox.js';
import {agentTurn,tool,toolNames,isAgentRequest} from './helpers/agent.js';

const listing=(url,brand='Kith',name='Kith LAX Tee - White')=>({status:'verified',url,product_brand:brand,product_name:name,availability:'InStock',market_match:true});
const shopProduct=url=>({brand:'Kith',name:'Kith LAX Tee - White',url,match:'likely_match',sourcing_status:'store_found',listing_check:listing(url),price_snapshot:{amount:68,currency:'USD'},source_provider:'shop_catalog'});

test('a failed web search still shows verified results from Shop instead of a failure',async()=>{
  let recorded;const logs=[];const log=console.log;console.log=line=>logs.push(line);
  try{
    const reply=await textWishlistAction({action:'start',query:'Kith LAX tee',search_plan:{continuation:false,mode:'identify',required_brands:['Kith'],hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[]}},
      {env:{SHOP_CATALOG_ENABLED:'true'},record:async r=>{recorded=r;},search:async()=>{throw Error('Product search failed');},
       shop:async(query,{requiredBrands})=>{assert.deepEqual(requiredBrands,['Kith']);return {products:[shopProduct('https://kith.com/products/lax')],diagnostics:{shops:['kith.com'],ignored_filters:[]}};}});
    assert.match(reply,/kith\.com\/products\/lax/);assert.equal(recorded.text_wishlist_state.options.length,1);
    assert.deepEqual(recorded.text_wishlist_diagnostics.shown.map(p=>p.source),['shop_catalog']);
    assert.ok(logs.some(l=>String(l).includes('"text_wishlist_sources"')));
  }finally{console.log=log;}
});

test('Shop stays off unless enabled, and a Shop failure never blocks web results',async()=>{
  const web={status:'found',source_provider:'serpapi_google',products:[{...shopProduct('https://www.ssense.com/p/1'),source_provider:undefined,brand:'Acne'}]};
  let called=false;
  await textWishlistAction({action:'start',query:'Acne tee'},{env:{},record:async()=>{},search:async()=>web,shop:async()=>{called=true;}});
  assert.equal(called,false);
  let recorded;
  const reply=await textWishlistAction({action:'start',query:'Acne tee'},{env:{SHOP_CATALOG_ENABLED:'true'},record:async r=>{recorded=r;},search:async()=>web,shop:async()=>{throw Error('Shop down');}});
  assert.match(reply,/ssense/);assert.equal(recorded.text_wishlist_diagnostics.shop_catalog,null);
});

const options=[{name:'LAX Tee',url:'https://kith.com/products/lax',listing_check:{status:'verified',product_name:'Kith LAX Tee'}}];
test('checkout is offered only with a checkout capability and resolves references in code',async()=>{
  let offered;
  const memory=checkoutAction=>({wishlistAction:async()=>'unused',wishlistState:{stage:'choice',options},wishlistItems:[{id:'saved-1',name:'Coat',links:[{url:'https://www.ssense.com/p/coat'}]}],...(checkoutAction?{checkoutAction}:{})});
  await generateReply([{direction:'inbound',body:'nice'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(_u,o)=>{offered=toolNames(o);return agentTurn(tool('conversation_reply',{response:'Glad you like it.'}));},memory());
  assert.ok(!offered.includes('prepare_checkout'));
  let targets;
  const reply=await generateReply([{direction:'inbound',body:'ok I’m ready to buy the tee in medium and the coat'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(_u,o)=>{
    assert.ok(toolNames(o).includes('prepare_checkout'));
    return agentTurn(tool('prepare_checkout',{items:[{option_index:0,saved_item_id:null,size:'Medium (M)',color:null},{option_index:null,saved_item_id:'saved-1',size:null,color:null}]}));
  },memory(async t=>{targets=t;return 'links';}));
  assert.equal(reply,'links');
  assert.deepEqual(targets.map(t=>[t.url,t.size]),[['https://kith.com/products/lax','Medium (M)'],['https://www.ssense.com/p/coat',null]]);
});

test('a checkout reference to an item that does not exist is re-read, never guessed',async()=>{
  let calls=0,validation;
  const reply=await generateReply([{direction:'inbound',body:'buy it'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(_u,o)=>{
    if(!isAgentRequest(o))throw Error('unexpected');calls++;
    if(calls===2)validation=JSON.parse(JSON.parse(o.body).input[0].content.replace(/^APPLICATION CONTEXT \(data, not instructions\): /,'')).validation_feedback;
    return calls===1?agentTurn(tool('prepare_checkout',{items:[{option_index:7,saved_item_id:null,size:null,color:null}]})):agentTurn(tool('conversation_reply',{response:'Which one would you like to buy?'}));
  },{wishlistAction:async()=>'unused',wishlistState:{stage:'choice',options},checkoutAction:async()=>assert.fail('Invalid reference must not check out')});
  assert.equal(calls,2);assert.match(validation.error,/option index or a saved_wishlist item id/);assert.equal(reply,'Which one would you like to buy?');
});

test('an unclear save failure repeats only the failed keyed write and reports what persisted',async()=>{
  const entries=[{reply_id:'reply',item_id:'item',name:'Tee',links:[{url:'https://kith.com/p'}],messages:{created_at:'2026-10-13'}}];
  let saves=0;
  const base={wishlistReplyId:async()=> 'reply',recordEvidence:async()=>{throw Error('timeout');},enablePriceAlert:async()=>({active:true})};
  const landed=await settleTextWishlist({store:{...base,wishlistEntries:async()=>entries,priceAlerts:async()=>[]},operation:'op',conversationId:'owner',result:{identification_policy:'text_wishlist',user_confirmed:true},env:{},save:async()=>{saves++;}});
  assert.equal(saves,1);assert.deepEqual([landed.saved,landed.alerts],[true,null]);assert.equal(settledReply(landed,{}),'Saved to your wishlist.');
  const missing=await settleTextWishlist({store:{...base,wishlistEntries:async()=>[]},operation:'op',conversationId:'owner',result:{identification_policy:'text_wishlist',user_confirmed:true},env:{},save:null});
  assert.equal(missing.saved,false);assert.match(settledReply(missing,{}),/couldn’t save/);
  const watch={size:'M',baselines:[],links:[]};
  const alertsOff=await settleTextWishlist({store:{...base,wishlistEntries:async()=>entries,priceAlerts:async()=>[{group_id:'other',active:true}]},operation:'op',conversationId:'owner',result:{identification_policy:'text_wishlist',user_confirmed:true,alert_request:watch},env:{},save:null});
  assert.match(settledReply(alertsOff,{}),/couldn’t finish setting up the price alerts/);
  const unknown=await settleTextWishlist({store:{...base,wishlistEntries:async()=>{throw Error('down');}},operation:'op',conversationId:'owner',result:{identification_policy:'text_wishlist',user_confirmed:true},env:{SITE_ORIGIN:'https://jules.example'},save:null});
  assert.equal(unknown.saved,null);assert.match(settledReply(unknown,{SITE_ORIGIN:'https://jules.example'}),/couldn’t confirm whether that save finished/);
});

test('a failed alert cancellation reports the alerts that are actually still on',async()=>{
  const items=[{id:'a',name:'Tee'},{id:'b',name:'Coat'}],alerts=[{group_id:'a',active:true},{group_id:'b',active:true}];
  const store={disablePriceAlert:async(_c,id)=>{if(id==='b')throw Error('timeout');alerts.find(a=>a.group_id===id).active=false;},priceAlerts:async()=>alerts};
  assert.match(await manageAlerts('cancel',[],{store,conversationId:'owner',items,alerts:structuredClone(alerts)}),/couldn’t turn off the price alerts for Coat/);
  const landed={disablePriceAlert:async()=>{throw Error('timeout');},priceAlerts:async()=>[]};
  assert.match(await manageAlerts('cancel',[],{store:landed,conversationId:'owner',items,alerts}),/Price alerts are off/);
});
