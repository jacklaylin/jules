import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateReply} from '../lib/ai.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {agentTurn,tool,agentContext,toolNames} from './helpers/agent.js';

// Multi-turn conversations through the one agent: the model's tool choice (mocked) is executed by
// the real wishlist executors, and the recorded state carries into the next turn. Tests assert
// state transitions and consent, not wording.
const options=['Ivory','Black','Navy'].map((color,i)=>({brand:'Example',name:'Trail sneakers',url:'https://www.prada.com/us/en/p/example/'+i,sourcing_status:'store_found',match:'likely_match',
  listing_check:{status:'verified',shopping_range:'men',color,color_options:[{color:'Ivory',url:'https://www.prada.com/us/en/p/example/0'},{color:'Black',url:'https://www.prada.com/us/en/p/example/1'}]}}));
const facts=[{field:'gender',key:'identity',value:'man',basis:'stated'},{field:'size',key:'shoes/eu',value:'45',basis:'stated'}];
const env={OPENAI_API_KEY:'test',SEARCH_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'};
const inspect=async links=>({sizes:['EU 45'],checks:[{offers:[{size:'EU 45',key:'EU 45',amount:400,currency:'USD',available:true,url:links[0].url}]}]});
function conversation(initial){
  let state=initial,last;const history=[];
  const say=async(text,...calls)=>{
    history.push({direction:'inbound',status:'received',body:text});
    const body=await generateReply([...history],env,async(_url,request)=>{last=request;return agentTurn(...calls);},{facts,wishlistState:state,
      wishlistAction:(args,current)=>textWishlistAction(args,{state:current,facts,env,inspect,record:async r=>{last={...last,result:r};state=r.text_wishlist_state;},search:()=>assert.fail('No new search in these turns')})});
    history.push({direction:'outbound',status:'sent',body});
    return {body,result:last.result,state};
  };
  return {say,get state(){return state;}};
}
const choice={stage:'choice',query:'Example Trail',options};

test('subset interest, then acceptance of the offer, saves exactly that subset and offers alerts once',async()=>{
  const c=conversation(choice);
  const liked=await c.say('the ivory and black ones',tool('respond_to_options',{decision:'interest',option_indices:[0,1]}));
  assert.equal(liked.result.user_confirmed,undefined);assert.equal(liked.state.stage,'offer_set');assert.deepEqual(liked.state.selected_set.map(p=>p.listing_check.color),['Ivory','Black']);
  const saved=await c.say('yes add them',tool('save_to_wishlist',{option_indices:[0,1],consent_context:'answer_to_offer'}));
  assert.equal(saved.result.user_confirmed,true);assert.equal(saved.result.products.length,2);assert.deepEqual(saved.result.alert_requests,[]);
  assert.equal(saved.state.offered_action,'alerts');
});

test('all, exclusions and none are distinct sets; none never saves',async()=>{
  const all=await conversation(choice).say('all of them',tool('respond_to_options',{decision:'interest',option_indices:[0,1,2]}));
  assert.equal(all.state.selected_set.length,3);
  const except=await conversation(choice).say('everything except the navy',tool('respond_to_options',{decision:'interest',option_indices:[0,1]}));
  assert.deepEqual(except.state.selected_set.map(p=>p.listing_check.color),['Ivory','Black']);
  const none=await conversation(choice).say('none of these',tool('respond_to_options',{decision:'decline',option_indices:[]}));
  assert.equal(none.state,null);assert.equal(none.result.user_confirmed,undefined);
});

test('an explicit request saves without an earlier offer; an unmatched acceptance is re-read, never saved',async()=>{
  const explicit=await conversation(choice).say('save the black pair',tool('save_to_wishlist',{option_indices:[1],consent_context:'explicit_request'}));
  assert.equal(explicit.result.user_confirmed,true);assert.equal(explicit.result.products[0].listing_check.color,'Black');
  let calls=0;const c=conversation(choice);
  await assert.rejects(generateReply([{direction:'inbound',body:'sure'}],env,async()=>{calls++;return agentTurn(tool('save_to_wishlist',{option_indices:[1],consent_context:'answer_to_offer'}));},
    {facts,wishlistState:choice,wishlistAction:()=>assert.fail('An acceptance with no offer cannot save')}));
  assert.equal(calls,2);assert.equal(c.state,choice);
});

test('alerts with a stated size: the save is implied, the size label is kept exactly, and baselines are attached',async()=>{
  const offered=(await conversation(choice).say('the ivory ones',tool('respond_to_options',{decision:'interest',option_indices:[0]}))).state;
  const watch=await conversation(offered).say('yes, watch them in EU 45',tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'answer_to_offer',size_choices:[{option_index:0,size:'EU 45'}]}));
  assert.equal(watch.result.user_confirmed,true);assert.equal(watch.result.alert_requests.length,1);assert.equal(watch.result.alert_requests[0].size,'EU 45');
});

test('declining alerts after a save keeps the save and does not offer alerts again',async()=>{
  const c=conversation(choice);
  await c.say('save the ivory pair',tool('save_to_wishlist',{option_indices:[0],consent_context:'explicit_request'}));
  assert.equal(c.state.offered_action,'alerts');assert.equal(c.state.already_saved,true);
  const declined=await c.say('no reminders, just keep it saved',tool('respond_to_options',{decision:'decline',option_indices:[]}));
  assert.equal(declined.state,null);assert.equal(declined.result.user_confirmed,undefined);
});

test('an unrelated turn keeps pending options; a durable fact and an action can share one turn',async()=>{
  const c=conversation(choice);
  const chat=await c.say('how should I style these?',tool('conversation_reply',{response:'With straight dark trousers.'}));
  assert.equal(chat.body,'With straight dark trousers.');assert.equal(c.state,choice);
  let profile;
  const reply=await generateReply([{id:'00000000-0000-4000-8000-000000000009',direction:'inbound',body:'I wear EU 45. Save the black pair.'}],env,async(_url,request)=>{
    assert.ok(toolNames(request).includes('update_profile'));
    return agentTurn(tool('update_profile',{changes:[{action:'remember',field:'size',key:'shoes/eu',value:'45',quote:'I wear EU 45.'}],acknowledgment:'Noted.'}),tool('save_to_wishlist',{option_indices:[1],consent_context:'explicit_request'}));
  },{facts,wishlistState:choice,profileAction:async args=>{profile=args;return {facts,saved:1};},
    wishlistAction:(args,current)=>textWishlistAction(args,{state:current,facts,env,inspect,record:async()=>{},search:()=>assert.fail()})});
  assert.equal(profile.changes[0].value,'45');assert.doesNotMatch(reply,/Noted/);
});

test('pending options, saved items with alert status, and the profile reach the agent as data',async()=>{
  let context,names;
  await generateReply([{direction:'inbound',body:'which alerts are on?'}],env,async(_url,request)=>{context=agentContext(request);names=toolNames(request);return agentTurn(tool('manage_price_alerts',{operation:'status'}));},
    {facts,wishlistState:choice,wishlistItems:[{id:'saved-1',name:'Coat',links:[],price_alert:{active:true,size:'50R'}}],wishlistAction:()=>assert.fail(),alertsAction:async(operation,ids)=>{assert.equal(operation,'status');assert.deepEqual(ids,[]);return 'Reminders are on for Coat.';}});
  assert.equal(context.pending_shopping.options.length,3);assert.equal(context.saved_wishlist.items[0].price_alert.size,'50R');assert.equal(context.saved_profile.length,2);
  for(const name of ['find_products','save_to_wishlist','manage_price_alerts','respond_to_options','wishlist_status','conversation_reply'])assert.ok(names.includes(name),name);
});

test('alert status and cancel act only on the user’s own saved items and report actual state',async()=>{
  const {manageAlerts}=await import('../lib/inbox.js');const disabled=[];
  const store={disablePriceAlert:async(_c,id)=>{disabled.push(id);}};
  const items=[{id:'coat',name:'Coat'},{id:'boots',name:'Boots'}],alerts=[{group_id:'coat',active:true,size:'50R'},{group_id:'boots',active:false}];
  const run=(operation,ids)=>manageAlerts(operation,ids,{store,conversationId:'c',items,alerts});
  assert.match(await run('status',[]),/Coat \(size 50R\)/);assert.doesNotMatch(await run('status',[]),/Boots/);
  assert.match(await run('cancel',['someone-else']),/couldn’t find/);assert.deepEqual(disabled,[]);
  assert.match(await run('cancel',['boots']),/isn’t an active/);assert.deepEqual(disabled,[]);
  await run('cancel',['coat']);assert.deepEqual(disabled,['coat']);
});
