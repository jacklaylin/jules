import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChanges, mergeFacts, saveChanges, extractChanges, MEMORY_PROMPT, updateProfile, prevails, profileFirstName, firstName } from '../lib/memory.js';
import { agentTurn, tool, agentContext, toolNames, toolOutputs } from './helpers/agent.js';
import { generateReply } from '../lib/ai.js';
import { receiveInInbox } from '../lib/inbox.js';
import { createProfileHandler } from '../api/profile.js';
const id = '00000000-0000-4000-8000-000000000001';
const message = { id, direction:'inbound', body:'My usual shoe size is US men’s 10.', created_at:'2026-10-05T10:00:00Z' };
const change = { field:'size',key:'shoes/us_men',value:'10',action:'set',source_id:id,evidence:'My usual shoe size is US men’s 10.' };
const env = { MEMORY_ENABLED:'true', AI_ENABLED:'true', OPENAI_API_KEY:'fake-test' };
function db() {
 let profile={facts:[],version:0};
 return { recordEvidence:async()=>{},profile:async()=>structuredClone(profile),saveProfile:async(_id,version,facts)=>{if(version!==profile.version)return false;profile={facts,version:version+1};return true;},conversation:async()=>({id}),
 historyForMemory:async()=>[message],receive:async()=>id,claimAI:async()=>true,context:async()=>[message],memoryStatus:async()=>{},prepareAI:async()=>{},finish:async()=>{} };
}
test('facts require a real inbound source and an exact supporting quote',()=>{
 const fact=validateChanges([change],[message])[0]; assert.equal(fact.source_id,id); assert.equal(fact.updated_at,message.created_at);
 for(const bad of [{...change,evidence:'unsupported'}, {...change,source_id:'missing'}, {...change,field:'password'}]) assert.throws(()=>validateChanges([bad],[message]));
 assert.throws(()=>validateChanges([change],[{...message,direction:'outbound'}]));
});
test('new corrections replace old values, old imports do not undo edits, and removals stay removed',()=>{
 const old=validateChanges([change],[message])[0];
 const newer={...old,value:'10.5',updated_at:'2026-10-05T11:00:00Z'};
 assert.equal(mergeFacts({facts:[old]},[newer])[0].value,'10.5');
 assert.equal(mergeFacts({facts:[newer]},[old])[0].value,'10.5');
 const removed={...newer,deleted:true,updated_at:'2026-10-05T12:00:00Z'};
 assert.equal(mergeFacts({facts:[removed]},[old])[0].deleted,true);
 const exception={...newer,key:'shoes/eu/example_brand',value:'44'};
 assert.equal(mergeFacts({facts:[newer]},[exception]).length,2);
});
test('concurrent profile updates merge without losing independent facts',async()=>{
 const store=db(); const fact=validateChanges([change],[message])[0];
 await Promise.all([saveChanges(store,id,[fact]),saveChanges(store,id,[{...fact,field:'brand',key:'example',value:'likes'}])]);
 assert.equal((await store.profile(id)).facts.length,2);
 const version=(await store.profile(id)).version;await saveChanges(store,id,[fact]);assert.equal((await store.profile(id)).version,version);
});
test('extraction uses strict structured output and excludes temporary budgets and inferred gender in instructions',async()=>{
 assert.match(MEMORY_PROMPT,/not an occasion/);assert.match(MEMORY_PROMPT,/Do not infer gender/);
 const changes=await extractChanges([message],{facts:[]},env,async(_url,options)=>{
 const input=JSON.parse(options.body);assert.equal(input.store,false);assert.equal(input.text.format.strict,true);
 return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({changes:[change]})}]}]})};});
 assert.equal(changes[0].value,'10');
});
test('saved beliefs reach the agent as context, and profile skills are offered only with memory enabled',async()=>{
 let names;
 const reply=await generateReply([{id,direction:'inbound',body:'What is my shoe size?',status:'received'}],env,async(_url,options)=>{
  assert.deepEqual(agentContext(options).saved_profile,[{field:'size',key:'shoes/us_men',value:'10',basis:'stated'}]);names=toolNames(options);
  return agentTurn(tool('profile_status',{response:'You wear US men’s 10. Tell me if that changes.'}));
 },{facts:[{field:'size',key:'shoes/us_men',value:'10',basis:'stated'}],profileAction:async()=>assert.fail()});
 assert.match(reply,/US men’s 10/);assert.ok(names.includes('update_profile')&&names.includes('profile_status'));
 await generateReply([{direction:'inbound',body:'hi'}],env,async(_url,options)=>{assert.ok(!toolNames(options).includes('update_profile'));return agentTurn(tool('conversation_reply',{response:'Hi'}));},{});
});
test('a failed profile save is visible and never acknowledged; the replying tool still answers',async()=>{
 const store=db();let status,sent=[];store.memoryStatus=async(_id,value)=>{status=value;};store.saveProfile=async()=>{throw new Error('private error');};
 const fetcher=async()=>agentTurn(tool('update_profile',{changes:[{action:'remember',field:'size',key:'shoes/us_men',value:'10',quote:'My usual shoe size is US men’s 10.'}],acknowledgment:'Noted.'}),tool('conversation_reply',{response:'What are you shopping for?'}));
 await receiveInInbox({space:{phone:'fake-line'},message:{id:'fake-provider',sender:{id:'fake-person'},content:{text:message.body}}},env,
  {store,generate:(m,e,_f,memory)=>generateReply(m,e,fetcher,memory),send:async(_d,body)=>{sent.push(body);}});
 assert.equal(status,'failed');assert.deepEqual(sent,['What are you shopping for?']);
 // Alone, a failed update falls back to an honest reply instead of its acknowledgment.
 // The model sees the failure as the tool result and writes the reply from it.
 const alone=await generateReply([message],env,async(_u,options)=>toolOutputs(options).some(o=>o.status==='failed')?agentTurn(tool('conversation_reply',{response:'I couldn’t save that just now.'})):agentTurn(tool('update_profile',{changes:[],acknowledgment:'Noted.'})),{profileAction:async()=>{throw new Error('down');}});
 assert.doesNotMatch(alone,/Noted/);
});
test('the profile skill records each valid change with its quote and skips malformed ones',async()=>{
 const store=db();const recorded=[];store.recordEvidence=async(_id,rows)=>{recorded.push(...rows);};
 const result=await updateProfile(store,id,message,{changes:[
  {action:'remember',field:'size',key:'shoes/us_men',value:'10',quote:'My usual shoe size is US men’s 10.'},
  {action:'remember',field:'shopping_range',key:'clothing',value:'menswear',quote:'US men’s'},
  {action:'remember',field:'brand',key:'example',value:'likes',quote:'not in the message'}],acknowledgment:''});
 assert.equal(result.saved,1);assert.deepEqual(result.facts.map(f=>[f.key,f.basis]),[['shoes/us_men','stated']]);
 assert.equal(recorded[0].kind,'chat_statement');assert.deepEqual(result.facts[0].evidence_ids,[recorded[0].id]);
 const forgot=await updateProfile(store,id,{...message,id:'00000000-0000-4000-8000-000000000002',created_at:'2026-10-06T10:00:00Z'},{changes:[{action:'forget',field:'size',key:'shoes/us_men',value:'',quote:'My usual shoe size'}],acknowledgment:''});
 assert.equal(forgot.facts[0].deleted,true);
});
test('beliefs resolve by basis, then recency',()=>{
 const stated={field:'style',key:'navy',value:'likes navy',basis:'stated',updated_at:'2026-10-01T00:00:00Z'};
 const confirmed={...stated,value:'navy knitwear',basis:'confirmed',updated_at:'2026-10-10T00:00:00Z'};
 assert.equal(prevails(confirmed,stated),false);assert.equal(prevails(stated,confirmed),true);
 assert.equal(prevails({...stated,value:'no navy',updated_at:'2026-10-11T00:00:00Z'},stated),true);
 assert.equal(mergeFacts({facts:[stated]},[confirmed])[0].value,'likes navy');
});
const res=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
const req=input=>({method:'POST',url:'/api/profile',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}});
test('profile API denies access before database lookup and rejects stale owner edits',async()=>{
 let result=res();await createProfileHandler({auth:async()=>401,storeFactory:()=>assert.fail()})({method:'GET',headers:{},url:'/api/profile'},result);assert.equal(result.statusCode,401);
 const store=db();const handler=createProfileHandler({auth:async()=>200,storeFactory:()=>store,env});
 result=res();await handler(req({conversation:id,action:'set',field:'size',key:'shoes/us_men',value:'10',version:0}),result);assert.equal(result.statusCode,200);
 result=res();await handler(req({conversation:id,action:'set',field:'size',key:'shoes/us_men',value:'12',version:0}),result);assert.equal(result.statusCode,409);
 assert.equal((await store.profile(id)).facts[0].value,'10');
});

test('validation checks formats only: fixed-value fields need allowed values; durability is the model’s reading',()=>{
 const source={...message,body:'I’m a man. I wear menswear. My usual shoe budget is USD 300.'};
 assert.throws(()=>validateChanges([{...change,field:'gender',key:'identity',value:'male',evidence:'I’m a man.'}],[source]),/gender/);
 assert.throws(()=>validateChanges([{...change,field:'shopping_range',key:'clothing',value:'men’s formal shoes',evidence:'I wear menswear.'}],[source]),/range/);
 assert.equal(validateChanges([{...change,field:'gender',key:'identity',value:'man',evidence:'I’m a man.'}],[source]).length,1);
 assert.equal(validateChanges([{...change,field:'shopping_range',key:'clothing',value:'men',evidence:'I wear menswear.'}],[source]).length,1);
 assert.equal(validateChanges([{...change,field:'budget',key:'shoes/usd',value:'300',evidence:'My usual shoe budget is USD 300.'}],[source]).length,1);
});

test('a first name the person states is remembered, checked as a name, and used when signup has none',async()=>{
 const said={...message,body:'btw you can call me Jack'};
 const store=db();
 const saved=await updateProfile(store,id,said,{changes:[{action:'remember',field:'name',key:'first',value:'Jack',quote:'call me Jack'}],acknowledgment:''});
 assert.equal(saved.saved,1);assert.equal(profileFirstName(saved.facts),'Jack');
 // Format checks only: a first name under key first, not an email address, a sentence or another key.
 for(const bad of [{value:'jack@example.com'},{value:'Jack and I love Prada because it is great forever'},{key:'last'},{value:'4ever'}])
  assert.throws(()=>validateChanges([{field:'name',key:'first',value:'Jack',action:'set',source_id:id,evidence:'call me Jack',...bad}],[said]));
 assert.equal(validateChanges([{field:'name',key:'first',value:'Zoë-Ann',action:'set',source_id:id,evidence:'call me Jack'}],[said])[0].value,'Zoë-Ann');
 // Greetings prefer the signup form's name, then the chat profile's.
 assert.equal(await firstName({...store,signupFirstName:async()=>null},id),'Jack');
 assert.equal(await firstName({...store,signupFirstName:async()=>'Jacob'},id),'Jacob');
 // Forgetting the name removes it from greetings.
 const forgot=await updateProfile(store,id,{...said,id:'00000000-0000-4000-8000-000000000002',created_at:'2026-10-06T10:00:00Z',body:'forget my name'},{changes:[{action:'forget',field:'name',key:'first',value:'',quote:'forget my name'}],acknowledgment:''});
 assert.equal(profileFirstName(forgot.facts),null);
});

test('size and budget keys keep their shape: a store name alone is not a size key, and a legacy bad key can still be forgotten', () => {
 const message = { id: '00000000-0000-4000-8000-000000000009', direction: 'inbound', body: 'Size 31 is also fine. I usually spend $300 on jeans.', created_at: '2026-10-15T10:00:00Z' };
 const one = change => { try { return validateChanges([{ action: 'set', source_id: message.id, ...change }], [message]); } catch { return []; } };
 assert.equal(one({ field: 'size', key: 'mfpen retail aps', value: '31', evidence: 'Size 31 is also fine' }).length, 0);
 assert.equal(one({ field: 'size', key: 'trousers/waist', value: '31', evidence: 'Size 31 is also fine' }).length, 1);
 assert.equal(one({ field: 'size', key: 'trousers/unknown/a.p.c.', value: '31', evidence: 'Size 31 is also fine' }).length, 1);
 assert.equal(one({ field: 'budget', key: 'jeans', value: '$300', evidence: 'I usually spend $300 on jeans.' }).length, 0);
 assert.equal(one({ field: 'budget', key: 'jeans/usd', value: '$300', evidence: 'I usually spend $300 on jeans.' }).length, 1);
 assert.equal(one({ field: 'size', key: 'mfpen retail aps', value: '', action: 'remove', evidence: 'Size 31 is also fine' }).length, 1);
});
