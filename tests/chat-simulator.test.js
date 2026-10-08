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
});
