import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateReply as agentReply} from '../lib/ai.js';
import {withConsent,toolOutputs,isConsentCheck,consentResponse} from './helpers/agent.js';
// These tests cover tool routing; the consent check approves (its own tests are in agent.test.js).
const generateReply=(messages,env,fetcher,memory)=>agentReply(messages,env,withConsent(fetcher),memory);
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
  // The refused acceptance comes back as a tool result; a repeat is not run, and the model is made to
  // write the reply (tool_choice forces conversation_reply), so the user never gets the generic fallback.
  const reply=await generateReply([{direction:'inbound',body:'sure'}],env,async(_u,options)=>{calls++;
    return JSON.parse(options.body).tool_choice?.name==='conversation_reply'?agentTurn(tool('conversation_reply',{response:'which pair should i save?'})):agentTurn(tool('save_to_wishlist',{option_indices:[1],consent_context:'answer_to_offer'}));},
    {facts,wishlistState:choice,wishlistAction:()=>assert.fail('An acceptance with no offer cannot save')});
  assert.equal(calls,3);assert.equal(reply,'which pair should i save?');assert.equal(c.state,choice);
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

test('when the agent calls both save and an alert, the alert runs (it includes the save)',async()=>{
  const choice={stage:'choice',query:'Example Trail',options};let executed;
  await generateReply([{direction:'inbound',body:'watch the ivory pair in EU 45'}],env,async()=>agentTurn(
    tool('save_to_wishlist',{option_indices:[0],consent_context:'explicit_request'}),
    tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'explicit_request',size_choices:[{option_index:0,size:'EU 45'}]})),
    {facts,wishlistState:choice,wishlistAction:async intent=>{executed=intent;return 'ok';}});
  assert.equal(executed.consent,'wishlist_alerts');assert.equal(executed.size_choices[0].size,'EU 45');
});

test('conflicting readings never persist: save alongside interest runs the interest only',async()=>{
  const {chooseReplying}=await import('../lib/ai.js');
  const save=tool('save_to_wishlist',{option_indices:[0,1]}),interest=tool('respond_to_options',{decision:'interest',option_indices:[0,1]});
  const parse=c=>({name:c.name,args:JSON.parse(c.arguments)});
  assert.equal(chooseReplying([save,interest].map(parse)).name,'respond_to_options');
  // A reply written alongside a save is only early: the save runs (behind the consent check) and the reply waits.
  assert.equal(chooseReplying([tool('conversation_reply',{response:'ok'}),save].map(parse)).name,'save_to_wishlist');
  assert.equal(chooseReplying([save,tool('manage_price_alerts',{operation:'create'})].map(parse)).name,'manage_price_alerts');
  let executed;
  await generateReply([{direction:'inbound',body:'the ivory and black ones'}],env,async()=>agentTurn(save,interest),
    {facts,wishlistState:{stage:'choice',query:'x',options},wishlistAction:async intent=>{executed=intent;return 'ok';}});
  assert.equal(executed.decision,'interest');assert.equal(executed.consent,'none');
});
test('an independent consent check gates every save: a block makes the agent re-read, and a second block asks instead',async()=>{
  const choice={stage:'choice',query:'x',options};let agentCalls=0,checks=0,saved=0;
  const fetcher=async(_url,options)=>{
    if(JSON.parse(options.body).text?.format?.name==='consent'){checks++;const input=JSON.parse(JSON.parse(options.body).input);assert.equal(input.newest_user_message,'yes');return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"authorizes":false}'}]}]})};}
    // After the block comes back as a tool result, the model asks instead of saving.
    agentCalls++;const blocked=toolOutputs(options).find(o=>o.status==='blocked');
    return agentTurn(blocked?tool('conversation_reply',{response:'Should I save the ivory pair to your wishlist?'}):tool('save_to_wishlist',{option_indices:[0],consent_context:'explicit_request'}));};
  const reply=await agentReply([{direction:'outbound',status:'sent',body:'Do you wear cropped hems?'},{direction:'inbound',body:'yes'}],env,fetcher,{facts,wishlistState:choice,wishlistAction:async()=>{saved++;return 'Saved';}});
  assert.equal(saved,0);assert.equal(agentCalls,2);assert.equal(checks,1);assert.match(reply,/Should I save/);
  // With the user's actual request, the check approves and the save runs.
  saved=0;assert.equal(await agentReply([{direction:'inbound',body:'save the ivory pair'}],env,withConsent(async()=>agentTurn(tool('save_to_wishlist',{option_indices:[0]}))),{facts,wishlistState:choice,wishlistAction:async()=>{saved++;return 'Saved';}}),'Saved');
  assert.equal(saved,1);
});

test('the model decides continuation and option indices afresh: the previous plan shows only the brief’s lasting parts',async()=>{
  const plan={continuation:false,mode:'discover',named_model:null,required_brands:['Our Legacy'],hard_constraints:['pleated'],guidance:[],keep_option_indices:[2],exclude_option_indices:[0]};
  let context;
  await generateReply([{direction:'inbound',body:'other options?'}],env,async(_url,options)=>{context=agentContext(options);return agentTurn(tool('conversation_reply',{response:'ok'}));},
    {facts,wishlistState:{...choice,search_brief:'Our Legacy pleated khakis',search_plan:plan},wishlistAction:async()=>'ok'});
  assert.equal(context.pending_shopping.search_plan,undefined);
  assert.deepEqual(context.pending_shopping.previous_search_plan,{mode:'discover',named_model:null,required_brands:['Our Legacy'],hard_constraints:['pleated'],guidance:[]});
  assert.equal(context.pending_shopping.search_brief,'Our Legacy pleated khakis');
});
test('a save written alongside the closing reply still runs (behind the consent check); the reply waits for its result',async()=>{
  let saved=0,rounds=0;
  const reply=await generateReply([{direction:'inbound',body:'save the black ones. what do they cost?'}],env,async()=>{rounds++;
    return agentTurn(tool('save_to_wishlist',{option_indices:[1],consent_context:'explicit_request'}),tool('conversation_reply',{response:'Saved, price unknown.'}));},
    {facts,wishlistState:choice,wishlistAction:async()=>{saved++;return 'Saved the black pair.';}});
  assert.equal(saved,1);assert.match(reply,/Saved the black pair/);
});
test('a call refused only for its timing can be made again; one that ran cannot',async()=>{
  // Nothing pending: the alert is refused until the search's results exist, then the same call runs.
  let alerts=0,searched=0,request=0;
  const found={stage:'choice',query:'x',options};
  // The raw loop (no restating model), so the model's own third call is the alert.
  await agentReply([{direction:'inbound',body:'find these cheaper and watch the price'}],env,async(_url,options)=>{
    if(isConsentCheck(options))return consentResponse(true);
    request++;
    const outputs=toolOutputs(options);
    if(request===1)return agentTurn(tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'explicit_request'}));
    if(request===2){assert.equal(outputs[0].status,'not_run');return agentTurn(tool('find_products',{query:'Example Trail'}));}
    if(request===3)return agentTurn(tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'explicit_request'}));
    return agentTurn(tool('conversation_reply',{response:'done'}));},
    {facts,wishlistState:null,shoppingState:()=>searched?found:null,
      wishlistAction:async intent=>{if(intent.action==='start'){searched++;return 'Found one.';}alerts++;return 'Watching it.';}});
  assert.equal(searched,1);assert.equal(alerts,1);
});
