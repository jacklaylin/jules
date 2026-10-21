import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,finishTextWishlist} from '../lib/text-wishlist.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,restating} from './helpers/agent.js';
import {createStore} from '../lib/store.js';
const options=['Ivory','Black','Navy'].map((color,i)=>({brand:'Example',name:'Trail sneakers',url:'https://www.prada.com/us/en/p/example/'+i,sourcing_status:'store_found',match:'likely_match',listing_check:{status:'verified',shopping_range:'men',color}}));
const state={stage:'choice',query:'Example Trail',options};
const facts=[{field:'gender',key:'identity',value:'man'},{field:'size',key:'shoes/eu',value:'45'}];
const env={PRICE_ALERTS_ENABLED:'true'};
const inspect=async links=>({sizes:['EU 45'],checks:[{offers:[{size:'EU 45',key:'EU 45',amount:400,currency:'USD',available:true,url:links[0].url}]}]});
async function act(args,current=state,extra={}){let result;const body=await textWishlistAction({action:'selection',decision:'interest',consent:'none',size_choices:[],option_sizing:options.map((_,option_index)=>({option_index,sizing:'footwear'})),...args},{state:current,facts,env,inspect,record:async r=>{result=r;},search:()=>assert.fail('selection must not source again'),...extra});return {body,result,next:result.text_wishlist_state};}
test('structured selection represents one, a subset, all, and none without forcing one choice or repeating links',async()=>{
 for(const indices of [[1],[0,1],[0,1,2]]){
  const r=await act({option_indices:indices});assert.deepEqual(r.next.selected_set.map(p=>p.url),indices.map(i=>options[i].url));assert.equal(r.next.stage,'offer_set');assert.equal(r.result.user_confirmed,undefined);assert.doesNotMatch(r.body,/https:|Which color/);assert.ok(r.body.includes('wishlist'));
 }
 const none=await act({decision:'decline',option_indices:[]});assert.equal(none.next,null);assert.equal(none.result.user_confirmed,undefined);
 for(const option_indices of [[3],[-1],[0,0],['1']])assert.equal((await act({option_indices})).next.stage,'choice');
});
test('natural input is interpreted by the model into referenced options, not routed by wording rules',async()=>{
 for(const message of ['Ivory or black I think','Both neutrals appeal to me','Everything except the navy pair','The first two are on my radar']){
  let result,calls=0; const acknowledgments=[];
  const body=await generateReply([{direction:'outbound',status:'sent',body:'Which version do you like?'},{direction:'inbound',body:message}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},restating(async(url,request)=>{
   calls++;const input=JSON.parse(request.body);assert.ok(input.instructions.includes('subset'));assert.equal(input.input.at(-1).content,message);assert.ok(input.tools.some(t=>t.name==='respond_to_options'));
   return agentTurn(tool('respond_to_options',{decision:'interest',option_indices:[0,1]}));
  }),{wishlistState:state,acknowledge:async intent=>acknowledgments.push(intent),wishlistAction:args=>textWishlistAction(args,{state,facts,env,inspect,record:async r=>{result=r;},search:()=>assert.fail()})});
  assert.equal(calls,1);assert.deepEqual(acknowledgments.map(a=>a.action),['selection']);assert.equal(result.text_wishlist_state.selected_set.length,2);assert.ok(body.includes('both'));assert.doesNotMatch(body,/https:/);
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
 const unavailable=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer,{inspect:async()=>({sizes:['EU 45'],checks:[]})});assert.equal(unavailable.result.user_confirmed,true);assert.equal(unavailable.result.alert_requests.length,2);assert.deepEqual(unavailable.result.alert_requests[0].baselines,[]);
 const needSize=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer,{facts:[]});assert.equal(needSize.next.stage,'size_set');assert.equal(needSize.result.user_confirmed,undefined);
});
test('clarification and corrections preserve context and cannot perform unoffered actions',async()=>{
 const question=await act({decision:'clarify',option_indices:[],response:'Do you mean the suede pair or the mesh pair?'});assert.equal(question.next,state);assert.equal(question.result.user_confirmed,undefined);
 const oldOffer=(await act({option_indices:[0,1]})).next;
 const corrected=await act({decision:'interest',option_indices:[1]},oldOffer);assert.deepEqual(corrected.next.offered_urls,[options[1].url]);
});
test('feedback acknowledgements do not hide pending choices, and explicit cleared state is not revived',async()=>{
 let cleared=false;const store=createStore({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'fake'},async url=>{
  assert.ok(url.includes('search_result=not.is.null'));assert.ok(url.includes('conversation_id=eq.example'));assert.ok(url.includes('status=eq.sent'));
  return {ok:true,text:async()=>JSON.stringify([{created_at:new Date().toISOString(),search_result:{identification_policy:'text_wishlist',text_wishlist_state:cleared?null:state}}])};
 });assert.deepEqual(await store.textWishlistState('example'),state);cleared=true;assert.equal(await store.textWishlistState('example'),null);
});
test('multi-variant completion attaches reminders to their corresponding saved wishlist items',async()=>{
 const result=(await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},(await act({option_indices:[0,1]})).next)).result;
 const calls=[];
 const body=await finishTextWishlist({operation:'op',conversationId:'c',result,env:{},store:{recordEvidence:async()=>{},wishlistReplyId:async()=> 'reply',wishlistEntries:async()=>options.slice(0,2).map((p,i)=>({reply_id:'reply',item_id:String(i),text_origin:true,name:p.name,brand:p.brand,links:[{url:p.url}]})),enablePriceAlert:async args=>{calls.push(args);return {active:true};}}});
 assert.equal(calls.length,2);assert.notEqual(calls[0].p_item,calls[1].p_item);assert.ok(body.includes('2'));
});

test('known profile sizes save approved watches despite unreadable retailer stock',async()=>{
 const offer=(await act({option_indices:[0,1]})).next;
 const r=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer,{inspect:async()=>({sizes:[],checks:[]})});
 assert.equal(r.result.user_confirmed,true);assert.equal(r.result.alert_requests.length,2);
 assert.ok(r.result.alert_requests.every(w=>w.size==='EU 45'&&w.baselines.length===0));
 assert.doesNotMatch(r.body,/Which.*size|Should I/);
});
test('size clarification retains approval and resumes it without another consent question',async()=>{
 const offer=(await act({option_indices:[0,1]})).next;
 const pending=await act({decision:'confirm',option_indices:[0,1],consent:'wishlist_alerts'},offer,{facts:[],inspect:async()=>({sizes:[],checks:[]})});
 assert.equal(pending.next.confirmed_consent,'wishlist_alerts');
 const finished=await act({decision:'interest',option_indices:[0,1]},pending.next,{inspect:async()=>({sizes:[],checks:[]})});
 assert.equal(finished.result.user_confirmed,true);assert.equal(finished.result.alert_requests.length,2);
 assert.doesNotMatch(finished.body,/Should I|Which.*size/);
 const changed=await act({decision:'interest',option_indices:[2]},pending.next);
 assert.equal(changed.result.user_confirmed,undefined);
});

// October 21: Jules offered two items it had no product record for; "yes" then confirmed the saved list,
// which stands in as the options when nothing is pending, and the reply said "already in your wishlist".
test('a plain save of the saved list standing in saves nothing and asks which item; alerts on saved items still work',async()=>{
 const {shoppingContext}=await import('../lib/shopping-context.js');
 const savedItems=[{id:'saved-jacket',name:'Biker jacket',links:[{url:'https://shop.example/jacket'}]},{id:'saved-boots',name:'Square-toe boots',links:[{url:'https://shop.example/boots'}]}];
 const standIn=shoppingContext([{direction:'inbound',body:'yes'}],null,savedItems);
 for(const option_indices of [[0],[0,1]]){
  const r=await act({decision:'confirm',option_indices,consent:'wishlist',consent_context:'explicit_request',option_sizing:[]},standIn);
  assert.notEqual(r.result.user_confirmed,true,'nothing is committed');
  assert.match(r.body,/already in your wishlist, so nothing new was saved\. which item did you mean\?/);
  for(const i of option_indices)assert.ok(r.body.includes(savedItems[i].name),'it names what is saved');
 }
 // Asking for alerts on a saved item is not held back by this.
 const alert=await act({decision:'confirm',option_indices:[0],consent:'wishlist_alerts',consent_context:'explicit_request',option_sizing:[]},standIn);
 assert.doesNotMatch(alert.body,/nothing new was saved/);
 // Real pending options are saved as before.
 const offer=(await act({option_indices:[0]})).next;
 assert.equal((await act({decision:'confirm',option_indices:[0],consent:'wishlist'},offer)).result.user_confirmed,true);
});
