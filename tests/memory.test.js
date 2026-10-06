import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChanges, mergeFacts, saveChanges, extractChanges, MEMORY_PROMPT } from '../lib/memory.js';
import { generateReply } from '../lib/ai.js';
import { receiveInInbox } from '../lib/inbox.js';
import { createProfileHandler } from '../api/profile.js';
const id = '00000000-0000-4000-8000-000000000001';
const message = { id, direction:'inbound', body:'My usual shoe size is US men’s 10.', created_at:'2026-10-05T10:00:00Z' };
const change = { field:'size',key:'shoes/us_men',value:'10',action:'set',source_id:id,evidence:'My usual shoe size is US men’s 10.' };
const env = { MEMORY_ENABLED:'true', AI_ENABLED:'true', OPENAI_API_KEY:'fake-test' };
function db() {
 let profile={facts:[],version:0};
 return { profile:async()=>structuredClone(profile),saveProfile:async(_id,version,facts)=>{if(version!==profile.version)return false;profile={facts,version:version+1};return true;},conversation:async()=>({id}),
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
test('persistent memory is included independently of recent conversation and failed updates cannot be claimed as saved',async()=>{
 await generateReply([{direction:'inbound',body:'What is my shoe size?',status:'received'}],env,async(_url,options)=>{
 const body=JSON.parse(options.body);assert.match(body.instructions,/shoes\/us_men/);assert.match(body.instructions,/Memory update failed/);assert.match(body.instructions,/Do not claim new preferences were saved/);
 return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'You wear US men’s 10.'}]}]})};
 },{enabled:true,saved:false,facts:[{field:'size',key:'shoes/us_men',value:'10'}]});
});
test('inbound memory failures remain visible while a reply uses existing saved facts',async()=>{
 const store=db();let status,sent=0;store.memoryStatus=async(_id,value)=>{status=value;};
 await receiveInInbox({space:{phone:'fake-line'},message:{id:'fake-provider',sender:{id:'fake-person'},content:{text:message.body}}},env,
 {store,updateMemory:async()=>{throw new Error('private error');},generate:async(_m,_e,_f,memory)=>{assert.equal(memory.saved,false);return 'Reply';},send:async()=>{sent++;}});
 assert.equal(status,'failed');assert.equal(sent,1);
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

test('temporary budgets, request clothing ranges and unsupported size units are excluded even if the model emits them',()=>{
 const source={...message,body:'Formal men’s shoes, less than $1200. I’m size eye 45 / us 12'};
 const facts=validateChanges([
 {...change,field:'budget',key:'shoes/unknown',value:'1200',evidence:'less than $1200'},
 {...change,field:'shopping_range',key:'clothing',value:'men’s formal shoes',evidence:'Formal men’s shoes'},
 {...change,key:'shoes/eu',value:'45',evidence:'I’m size eye 45 / us 12'},
 {...change,key:'shoes/us_men',value:'12',evidence:'I’m size eye 45 / us 12'}
 ],[source]); assert.equal(facts.length,1);assert.equal(facts[0].key,'shoes/us_men');
 const usual={...message,body:'My usual shoe budget is USD 300.'};
 assert.equal(validateChanges([{...change,field:'budget',key:'shoes/usd',value:'300',evidence:usual.body}],[usual]).length,1);
});
