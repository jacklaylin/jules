import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoppingContext, stateFromSearch } from '../lib/shopping-context.js';
import { generateReply } from '../lib/ai.js';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { wishlistProducts } from '../lib/wishlist.js';
import { verifyWishlistRows } from '../lib/listings.js';
import { receiveInInbox } from '../lib/inbox.js';

const env={AI_ENABLED:'true',SEARCH_ENABLED:'true',WISHLIST_ENABLED:'true',PRICE_ALERTS_ENABLED:'true',OPENAI_API_KEY:'fixture'};
const products=[0,1].map(i=>({brand:'Fixture Brand',name:`Fixture trousers ${i}`,
  url:`https://www.mrporter.com/en-us/mens/product/fixture/trousers/${i}`,
  match:'likely_match',sourcing_status:'store_not_found',listing_checks:[{status:'check_failed'}],merchant_options:[]}));
const interpretation=(indices=[0,1],extra={})=>({action:'selection',decision:'confirm',option_indices:indices,
  consent:'wishlist',consent_context:'explicit_request',size_choices:[],...extra});

test('image and ordinary search results become referenced options; explicit cleared state stays cleared',()=>{
  for(const identification_policy of ['visual_comparison','readable_identifier_required','text_search']){
    const state=stateFromSearch({identification_policy,products});
    assert.deepEqual(state.options.map(p=>p.url),products.map(p=>p.url));
    assert.ok(state.options.every(p=>p.reference_provenance==='conversation_product'));
  }
  assert.equal(stateFromSearch({products,text_wishlist_state:null}),null);
});

test('a supplied link resolves its own product rather than all older candidates and does not authorize saving',()=>{
  const state=stateFromSearch({products});
  const current=shoppingContext([{direction:'inbound',body:products[1].url}],state);
  assert.equal(current.options.length,1);assert.equal(current.options[0].name,products[1].name);
  assert.equal(current.options[0].reference_provenance,'user_link');
  assert.equal(current.confirmed_consent,undefined);
  const fresh=shoppingContext([{direction:'inbound',body:'https://www.mrporter.com/product/new-item'}],null);
  assert.equal(fresh.options[0].match,'unverified');
  assert.equal(fresh.options[0].price_snapshot,undefined);
  assert.equal(shoppingContext([{direction:'inbound',body:'https://localhost/item'}],null),null);
});

test('varied save follow-ups route interpreted existing references to save without sourcing or verification',async()=>{
  for(const [message,indices] of [['Can you add these to my wishlist',[0,1]],['Keep the second one for me',[1]],
    ['Save both, no alerts',[0,1]],['Put the first in my list',[0]]]){
    let recorded,calls=0;
    const state=stateFromSearch({identification_policy:'visual_comparison',products});
    const body=await generateReply([{direction:'outbound',status:'sent',body:'Previous product findings'},
      {direction:'inbound',body:message}],env,async(_url,request)=>{
      calls++;const input=JSON.parse(request.body);
      assert.equal(input.text.format.type,'json_schema');
      assert.equal(JSON.parse(input.input[0].content).newest_message,message);
      return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[
        {type:'output_text',text:JSON.stringify(interpretation(indices))}]}]})};
    },{wishlistState:state,wishlistAction:(args,resolvedState)=>textWishlistAction(args,{state:resolvedState,text:message,
      env,record:async result=>{recorded=result;},search:()=>assert.fail('A save must not source again'),
      verify:()=>assert.fail('Saving does not require a retailer fetch')})});
    assert.equal(calls,1);assert.equal(recorded.user_confirmed,true);
    assert.deepEqual(recorded.products.map(p=>p.url),indices.map(i=>products[i].url));
    assert.deepEqual(recorded.alert_requests,[]);
    assert.equal(recorded.text_wishlist_state.offered_action,'alerts');
    assert.ok(!body.includes('https://'));
  }
});

test('save request followed by a separate link uses that supplied reference without search',async()=>{
  let recorded;
  const link='https://www.mrporter.com/product/user-selected-item';
  await generateReply([{direction:'inbound',body:'Can you add these to my wishlist'},
    {direction:'inbound',body:link}],env,async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',
      content:[{type:'output_text',text:JSON.stringify(interpretation([0]))}]}]})}),{
    wishlistAction:(args,state)=>textWishlistAction(args,{state,text:link,env,record:async r=>{recorded=r;},
      search:()=>assert.fail('User supplied the item already')})});
  assert.equal(recorded.user_confirmed,true);assert.equal(recorded.products[0].url,link);
});

test('a standalone link, uncertainty and unrelated conversation do not become save consent',async()=>{
  for(const [decision,indices] of [['interest',[0]],['clarify',[]],['decline',[]]]){
    let result;
    await textWishlistAction(interpretation(indices,{decision,consent:'none',consent_context:'none',response:'Which item did you mean?'}),{
      state:stateFromSearch({products}),env,record:async r=>{result=r;}});
    assert.equal(result.user_confirmed,undefined);assert.equal(result.alert_requests,undefined);
  }
  let actions=0;
  const body=await generateReply([{direction:'inbound',body:'How should I style a blazer?'}],env,
    async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',
      text:JSON.stringify({action:'conversation',response:'Try relaxed trousers with it.'})}]}]})}),
    {wishlistState:stateFromSearch({products}),wishlistAction:()=>{actions++;}});
  assert.equal(actions,0);assert.equal(body,'Try relaxed trousers with it.');
});

test('explicit saves retain blocked links without invented prices or stock and survive wishlist refresh',async()=>{
  const selected=stateFromSearch({products}).options;
  const payload=await wishlistProducts({identification_policy:'text_wishlist',user_confirmed:true,products:selected},
    'Fixture save preparation',[],{},async()=>Buffer.from('fixture'));
  assert.equal(payload.length,2);
  assert.ok(payload.every(p=>p.sourcing_status==='saved_reference'&&p.links[0].user_saved===true));
  const rows=await verifyWishlistRows(payload,undefined,async()=>({status:'check_failed'}));
  assert.ok(rows.every(p=>p.links.length===1&&p.links[0].verification_status==='unverified'
    &&p.links[0].price_snapshot===null&&p.links[0].availability===null));
  const unrequested=await verifyWishlistRows([{...payload[0],links:[{url:products[0].url}]}],undefined,
    async()=>({status:'check_failed'}));
  assert.equal(unrequested[0].links.length,0);
});

function inboxHarness({failSave=false,failSend=false,failPayload=false}={}){
  let claimed=false,stored,phase='generating',saved=false,payload;
  const sends=[],events=[];
  const store={receive:async()=> 'fixture-conversation',claimAI:async()=>{if(claimed)return false;claimed=true;return true;},
    context:async()=>[{direction:'inbound',body:'Save these',status:'received'}],
    textWishlistState:async()=>stateFromSearch({products}),
    searchResult:async(_operation,r)=>{stored=r;},
    wishlistPayload:async(_operation,p)=>{if(failPayload)throw Error('Fixture');payload=p;},
    saveConfirmedWishlist:async()=>{events.push('persist');if(failSave)throw Error('Fixture');saved=true;},
    wishlistReplyId:async()=>{assert.equal(phase,'generating');return 'fixture-reply';},
    wishlistEntries:async()=>saved?payload.map((p,i)=>({reply_id:'fixture-reply',item_id:`fixture-item-${i}`,
      text_origin:true,name:p.name,brand:p.brand,links:p.links,messages:{created_at:'2026-10-08'}})):[],
    prepareAI:async(_operation,_body)=>{phase='sending';events.push('prepare');},
    finish:async(_operation,p)=>{phase=p;events.push(p);},
    saveWishlist:async()=>assert.fail('Confirmed save must not wait for delivery'),
    enablePriceAlert:async()=>assert.fail('Save-only consent cannot enable an alert'),
  };
  const generate=async(_messages,_env,_fetch,memory)=>memory.wishlistAction(interpretation());
  const send=async(_delivery,body)=>{events.push('send');sends.push(body);if(failSend)throw Error('Fixture');};
  return {store,generate,send,sends,events,get stored(){return stored;},get saved(){return saved;},get phase(){return phase;}};
}
const delivery={space:{phone:'fixture-line'},message:{id:'fixture-message',sender:{id:'fixture-person'},content:{text:'Save these'}}};

test('inbound saves before sending one confirmation and offers alerts without repeating links',async()=>{
  const h=inboxHarness();
  await receiveInInbox(delivery,env,{...h,progress:async()=>async()=>{}});
  assert.equal(h.saved,true);assert.equal(h.sends.length,1);assert.equal(h.stored.user_confirmed,true);
  assert.deepEqual(h.events,['persist','prepare','send','sent']);
  assert.equal(h.stored.text_wishlist_state.selected_set.length,2);
  assert.ok(!h.sends[0].includes('https://'));
  assert.ok(!h.sends[0].includes('I’ll add'));
});

test('save or snapshot failure cannot claim success or enable alerts',async()=>{
  for(const extra of [{failSave:true},{failPayload:true}]){
    const h=inboxHarness(extra);await receiveInInbox(delivery,env,{...h,progress:async()=>async()=>{}});
    assert.equal(h.saved,false);assert.equal(h.sends.length,1);
    assert.ok(!h.sends[0].startsWith('Saved'));assert.equal(h.phase,'sent');
    assert.equal(h.stored.user_confirmed,false);
    assert.equal(h.stored.text_wishlist_state.already_saved,false);
  }
});

test('uncertain delivery retains the authorized save and duplicate webhooks do not repeat the confirmation',async()=>{
  const h=inboxHarness({failSend:true});
  assert.equal(await receiveInInbox(delivery,env,{...h,progress:async()=>async()=>{}}),'imessage_ai_reply_uncertain');
  assert.equal(h.saved,true);assert.equal(h.phase,'uncertain');
  assert.equal(await receiveInInbox(delivery,env,{...h,progress:async()=>async()=>{}}),'imessage_ai_duplicate');
  assert.equal(h.sends.length,1);assert.equal(h.events.filter(e=>e==='persist').length,1);
});

test('declining the post-save alert offer does not undo a save or authorize monitoring',async()=>{
  let result;
  await textWishlistAction(interpretation([],{decision:'decline',consent:'none'}),{
    state:{...stateFromSearch({products}),already_saved:true,offered_action:'alerts'},env,
    record:async r=>{result=r;},inspect:()=>assert.fail('Declined monitoring cannot inspect')});
  assert.equal(result.user_confirmed,undefined);assert.equal(result.alert_requests,undefined);
  assert.equal(result.text_wishlist_state,null);
});

test('an alert clarification after saving preserves saved state and makes no active-alert claim',async()=>{
  let result;
  const body=await textWishlistAction(interpretation([0],{consent:'wishlist_alerts',consent_context:'answer_to_offer'}),{
    state:{...stateFromSearch({products}),stage:'offer_set',already_saved:true,offered_action:'alerts',offered_urls:[products[0].url]},env,
    record:async r=>{result=r;},inspect:async()=>({sizes:[],checks:[]})});
  assert.equal(result.text_wishlist_state.stage,'size_set');
  assert.equal(result.text_wishlist_state.already_saved,true);
  assert.equal(result.user_confirmed,undefined);
  assert.ok(body.includes('items are saved'));
});
