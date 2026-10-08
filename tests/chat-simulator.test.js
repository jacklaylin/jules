import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulateTurn,validateSimulation} from '../lib/chat-simulator.js';
import {createSimulatorHandler} from '../api/chat-simulator.js';
import {generateReply} from '../lib/ai.js';
import {remember} from '../lib/memory.js';
const env={OPENAI_API_KEY:'fixture',SEARCH_ENABLED:'true',WISHLIST_ENABLED:'true',MEMORY_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'};
const interpretation={action:'selection',decision:'confirm',consent:'wishlist',consent_context:'explicit_request',option_indices:[0],size_choices:[]};
const model=intent=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(intent)}]}]})});
const deps=intent=>({generate:(messages,settings,_fetch,memory)=>generateReply(messages,settings,model(intent),memory),updateMemory:(store,id,messages,settings)=>remember(store,id,messages,settings,async()=>[])});
const input={text:'Please save this https://www.mrporter.com/en-us/mens/product/example/123'};

test('simulator runs real inbox save, consent, confirmation and later decline with isolated state',async()=>{
  const first=await simulateTurn(input,env,deps(interpretation));
  assert.equal(first.snapshot.items.length,1);assert.equal(first.snapshot.alerts.length,0);
  assert.ok(first.replies[0].startsWith('Saved'));
  assert.equal(first.events.find(e=>e.type==='shopping_outcome').result.intent_action,'selection');
  const before=JSON.stringify(first.snapshot);
  const second=await simulateTurn({text:'No alerts please',snapshot:first.snapshot},env,deps({...interpretation,decision:'decline',consent:'none',option_indices:[]}));
  assert.equal(JSON.stringify(first.snapshot),before);
  assert.equal(second.snapshot.items.length,1);assert.equal(second.snapshot.alerts.length,0);
  assert.equal(second.snapshot.messages.length,4);
  assert.equal(second.snapshot.messages.at(-1).search_result.text_wishlist_state,null);
  assert.equal(second.events.some(e=>e.type==='wishlist_saved'),false);
});

test('simulator failure injection preserves production failure behavior and captured diagnostics',async()=>{
  const failed=await simulateTurn({...input,failure:'save'},env,deps(interpretation));
  assert.equal(failed.snapshot.items.length,0);
  assert.equal(failed.snapshot.messages.at(-1).search_result.text_wishlist_state.already_saved,false);
  assert.ok(!failed.replies[0].startsWith('Saved'));
  const uncertain=await simulateTurn({...input,failure:'delivery'},env,deps(interpretation));
  assert.equal(uncertain.snapshot.items.length,1);assert.deepEqual(uncertain.replies,[]);
  assert.equal(uncertain.snapshot.messages.at(-1).status,'uncertain');
});

test('a save that declines monitoring completes without offering the rejected action again',async()=>{
  const result=await simulateTurn(input,env,deps({...interpretation,offer_alerts:false}));
  assert.equal(result.snapshot.items.length,1);assert.equal(result.snapshot.alerts.length,0);
  assert.equal(result.snapshot.messages.at(-1).search_result.text_wishlist_state,null);
  assert.equal(result.replies[0].includes('?'),false);
});

test('a missing-wishlist complaint inspects persisted items and cannot start another search',async()=>{
  const saved=await simulateTurn(input,env,deps({...interpretation,offer_alerts:false}));
  let evidence;
  const status=await simulateTurn({text:"i don't see it in my wishlist",snapshot:saved.snapshot},env,{
    ...deps(interpretation),generate:(messages,settings,_fetch,memory)=>generateReply(messages,settings,
      async(_url,request)=>{evidence=JSON.parse(JSON.parse(request.body).input[0].content);return model({action:'wishlist_status',response:'That link is in the test wishlist beside chat. Your real wishlist is unchanged.'})();},
      {...memory,wishlistAction:()=>assert.fail('A status complaint must not source or save')}),
  });
  assert.equal(evidence.saved_wishlist.execution.mode,'simulator');
  assert.equal(evidence.saved_wishlist.items.length,1);
  assert.equal(status.snapshot.items.length,1);assert.equal(status.snapshot.alerts.length,0);
  assert.ok(status.events.some(e=>e.type==='shopping_outcome'&&e.result.identification_policy==='wishlist_status'));
  assert.equal(status.events.some(e=>e.type==='wishlist_saved'),false);
});

test('simulator seeds a copy of the owner profile and preserves test overrides without production writes',async()=>{
  const handler=createSimulatorHandler({env:{...env,ADMIN_EMAIL:'fixture@example.test',SUPABASE_URL:'fixture'},auth:async()=>200,
    storeFactory:()=>({wishlistMember:async()=>({conversation_id:'fixture-owner'}),profile:async()=>({facts:[{field:'gender',key:'identity',value:'man'},{field:'size',key:'suit/unknown',value:'50R'}]})}),
    simulate:async input=>{assert.equal(input.snapshot.profile_seeded,true);assert.equal(input.snapshot.profile.facts[0].value,'man');assert.equal(input.snapshot.profile.facts[1].value,'52R');return {snapshot:input.snapshot};}});
  const request={method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify({text:'Find trousers',snapshot:{messages:[],items:[],alerts:[],images:[],profile:{version:0,facts:[{field:'size',key:'suit/unknown',value:'52R'}]}}});}};
  const response={setHeader(){},end(value){this.body=JSON.parse(value);}};
  await handler(request,response);assert.equal(response.statusCode,200);
});

test('simulator persists profile changes through production remember and inbox contracts',async()=>{
  const result=await simulateTurn({text:'I wear suit size 50R'},env,{
    generate:async(_m,_e,_f,memory)=>{assert.equal(memory.facts[0].value,'50R');return 'I’ll use that suit size.';},
    updateMemory:(store,id,messages,settings)=>remember(store,id,messages,settings,async()=>[{field:'size',key:'suit/unknown',value:'50R',updated_at:messages[0].created_at,source_id:messages[0].id}]),
  });
  assert.equal(result.snapshot.profile.version,1);
  assert.equal(result.snapshot.profile.facts[0].value,'50R');
  assert.ok(result.events.some(e=>e.type==='profile_updated'));
});

test('simulator bounds messages, snapshots, failure controls and image bytes',()=>{
  for(const invalid of [{text:''},{text:'a'.repeat(4001)},{text:'test',failure:'external'},{text:'test',image:'not an image'},
    {text:'test',snapshot:{messages:[],profile:{facts:[]},items:[],alerts:[],images:'invalid'}}]){
    assert.throws(()=>validateSimulation(invalid));
  }
});

test('simulator requires owner authorization before invoking a model and never constructs a production store',async()=>{
  let called=0;
  const res=()=>({setHeader(){},end(value){this.body=JSON.parse(value);}});
  const req=()=>({method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(input);}});
  const denied=res();await createSimulatorHandler({env,auth:async()=>403,simulate:()=>{called++;}})(req(),denied);
  assert.equal(denied.statusCode,403);assert.equal(called,0);
  const allowed=res();await createSimulatorHandler({env,auth:async()=>200,simulate:async()=>{called++;return {replies:['Fixture']};}})(req(),allowed);
  assert.equal(allowed.statusCode,200);assert.equal(called,1);
  const navigation=res();const get=req();get.method='GET';
  await createSimulatorHandler({env,auth:async()=>200,simulate:()=>assert.fail('Navigation cannot run a model')})(get,navigation);
  assert.equal(navigation.statusCode,200);assert.equal(navigation.body.owner,true);
});
