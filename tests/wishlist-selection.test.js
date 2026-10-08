import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,finishTextWishlist} from '../lib/text-wishlist.js';
import {generateReply} from '../lib/ai.js';
import {createStore} from '../lib/store.js';
const options=['Ivory','Black','Navy'].map((color,i)=>({brand:'Example',name:'Trail sneakers',url:'https://www.prada.com/us/en/p/example/'+i,sourcing_status:'store_found',match:'likely_match',listing_check:{status:'verified',shopping_range:'men',color}}));
const state={stage:'choice',query:'Example Trail',options};
const facts=[{field:'gender',key:'identity',value:'man'},{field:'size',key:'shoes/eu',value:'45'}];
const env={PRICE_ALERTS_ENABLED:'true'};
const inspect=async links=>({sizes:['EU 45'],checks:[{offers:[{size:'EU 45',key:'EU 45',amount:400,currency:'USD',available:true,url:links[0].url}]}]});
async function act(args,current=state,extra={}){let result;const body=await textWishlistAction({action:'selection',decision:'interest',consent:'none',size_choices:[],...args},{state:current,facts,env,inspect,record:async r=>{result=r;},search:()=>assert.fail('selection must not source again'),...extra});return {body,result,next:result.text_wishlist_state};}
test('structured selection represents one, a subset, all, and none without forcing one choice or repeating links',async()=>{
 for(const indices of [[1],[0,1],[0,1,2]]){
  const r=await act({option_indices:indices});assert.deepEqual(r.next.selected_set.map(p=>p.url),indices.map(i=>options[i].url));assert.equal(r.next.stage,'offer_set');assert.equal(r.result.user_confirmed,undefined);assert.doesNotMatch(r.body,/https:|Which color/);assert.ok(r.body.includes('wishlist'));
 }
 const none=await act({decision:'decline',option_indices:[]});assert.equal(none.next,null);assert.equal(none.result.user_confirmed,undefined);
 for(const option_indices of [[3],[-1],[0,0],['1']])assert.equal((await act({option_indices})).next.stage,'choice');
});
test('natural input is interpreted by the model into referenced options, not routed by wording rules',async()=>{
 for(const message of ['Ivory or black I think','Both neutrals appeal to me','Everything except the navy pair','The first two are on my radar']){
  let result,calls=0;
  const body=await generateReply([{direction:'outbound',status:'sent',body:'Which version do you like?'},{direction:'inbound',body:message}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async(url,request)=>{
   calls++;const input=JSON.parse(request.body);assert.ok(input.instructions.includes('subset'));assert.ok(JSON.stringify(input.input).includes(message));assert.equal(input.text.format.type,'json_schema');
   return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({action:'selection',decision:'interest',option_indices:[0,1],consent:'none',size_choices:[]})}]}]})};
  },{wishlistState:state,wishlistAction:args=>textWishlistAction(args,{state,text:message,facts,env,inspect,record:async r=>{result=r;},search:()=>assert.fail()})});
  assert.equal(calls,1);assert.equal(result.text_wishlist_state.selected_set.length,2);assert.ok(body.includes('both'));assert.doesNotMatch(body,/https:/);
 }
});
test('multi-item save and reminders require a scoped offer and validated available size baselines',async()=>{
 const offer=(await act({option_indices:[0,1]})).next;
 const save=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist'},offer);
 assert.equal(save.result.user_confirmed,true);assert.equal(save.result.products.length,2);assert.deepEqual(save.result.alert_requests,[]);
 const watch=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer);
 assert.equal(watch.result.alert_requests.length,2);assert.ok(watch.result.alert_requests.every(w=>w.size==='EU 45'));
 const unsafe=await act({decision:'confirm',option_indices:[2],consent:'wishlist'},offer);assert.equal(unsafe.result.user_confirmed,undefined);
 const noConsent=await act({decision:'confirm',option_indices:[0,1],consent:'none'},offer);assert.equal(noConsent.result.user_confirmed,undefined);
 const explicit=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist',consent_context:'explicit_request'});assert.equal(explicit.result.products.length,2);assert.equal(explicit.result.user_confirmed,true);
 const unoffered=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist',consent_context:'answer_to_offer'});assert.equal(unoffered.result.user_confirmed,undefined);
 const unavailable=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer,{inspect:async()=>({sizes:['EU 45'],checks:[]})});assert.equal(unavailable.result.user_confirmed,undefined);
 const needSize=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer,{facts:[]});assert.equal(needSize.next.stage,'size_set');assert.equal(needSize.result.user_confirmed,undefined);
});
test('clarification and corrections preserve context and cannot perform unoffered actions',async()=>{
 const question=await act({decision:'clarify',option_indices:[],response:'Do you mean the suede pair or the mesh pair?'});assert.equal(question.next,state);assert.equal(question.result.user_confirmed,undefined);
 const oldOffer=(await act({option_indices:[0,1]})).next;
 const corrected=await act({decision:'interest',option_indices:[1]},oldOffer);assert.deepEqual(corrected.next.offered_urls,[options[1].url]);
});
test('feedback acknowledgements do not hide pending choices, and explicit cleared state is not revived',async()=>{
 let cleared=false;const store=createStore({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'fake'},async url=>{
  assert.ok(url.includes('search_result->>identification_policy=eq.text_wishlist'));
  return {ok:true,text:async()=>JSON.stringify([{created_at:new Date().toISOString(),search_result:{identification_policy:'text_wishlist',text_wishlist_state:cleared?null:state}}])};
 });assert.deepEqual(await store.textWishlistState('example'),state);cleared=true;assert.equal(await store.textWishlistState('example'),null);
});
test('multi-variant completion attaches reminders to their corresponding saved wishlist items',async()=>{
 const result=(await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},(await act({option_indices:[0,1]})).next)).result;
 const calls=[];
 const body=await finishTextWishlist({operation:'op',conversationId:'c',result,env:{},store:{wishlistReplyId:async()=> 'reply',wishlistEntries:async()=>options.slice(0,2).map((p,i)=>({reply_id:'reply',item_id:String(i),text_origin:true,name:p.name,brand:p.brand,links:[{url:p.url}]})),enablePriceAlert:async args=>{calls.push(args);return {active:true};}}});
 assert.equal(calls.length,2);assert.notEqual(calls[0].p_item,calls[1].p_item);assert.ok(body.includes('2'));
});
