import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outfitPhotosFact} from '../lib/outfit-photos.js';
import {receiveInInbox} from '../lib/inbox.js';
import {generateReply} from '../lib/ai.js';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
import {agentTurn,tool,agentContext,isAgentRequest} from './helpers/agent.js';

// The chat knows which outfit photos are already kept (texted earlier or uploaded on /style), so it
// never says it has none when it does, and the reading of them guides discovery as soft taste.
const outfit=(id,at)=>({id,kind:'outfit',created_at:at});
const reading={at:'2026-10-10T00:00:00Z',photos:2,observations:[{text:'mostly black fitted tops',source_ids:['a']},{text:'straight dark jeans',source_ids:['a','b']}]};
const value=fact=>JSON.parse(fact.value);

test('the fact counts only outfit photos, names the newest, and carries the validated reading',()=>{
  const fact=outfitPhotosFact([outfit('a','2026-10-01T00:00:00Z'),{id:'i',kind:'inspiration',created_at:'2026-10-02T00:00:00Z'},outfit('b','2026-10-03T00:00:00Z')],{data:{outfit_reading:reading}});
  assert.equal(fact.field,'outfit_photos');assert.equal(fact.basis,'inferred');
  assert.deepEqual(value(fact),{kept:2,latest_at:'2026-10-03T00:00:00Z',reading:['mostly black fitted tops','straight dark jeans'],reading_photos:2});
  assert.doesNotMatch(fact.value,/source_ids|data:/,'no photo references or bytes');
});
test('no photos is stated plainly, and a leftover reading without photos is not shown',()=>{
  assert.deepEqual(value(outfitPhotosFact([],{data:{outfit_reading:reading}})),{kept:0,latest_at:null});
  assert.deepEqual(value(outfitPhotosFact(null,null)),{kept:0,latest_at:null});
});
test('photos without a reading, or with a malformed one, give the count only',()=>{
  assert.deepEqual(value(outfitPhotosFact([outfit('a','t')],{data:{}})),{kept:1,latest_at:'t'});
  assert.deepEqual(value(outfitPhotosFact([outfit('a','t')],{data:{outfit_reading:{observations:[{text:''},{}],photos:'x'}}})),{kept:1,latest_at:'t'});
});

const delivery={space:{phone:'fake-line'},message:{id:'fake-message',sender:{id:'fake-tester'},content:{type:'text',text:'did you see my outfit pics?'},attachments:[]}};
const quiet={progress:async()=>async()=>{},writeFollowup:async()=>null};
function store(extra={}){
  const rows=[];const row=op=>rows.find(r=>r.operation_id===op);
  return {rows,receive:async()=>'conversation',claimAI:async(_c,op)=>{rows.push({operation_id:op,status:'generating'});return true;},
    context:async()=>[{direction:'inbound',provider_id:'fake-message',body:'did you see my outfit pics?',status:'received'}],
    prepareAI:async(op,body,source)=>Object.assign(row(op),{body,source,status:'sending'}),finish:async(op,status)=>{row(op).status=status;},
    searchResult:async()=>{},replyDiagnostics:async()=>{},...extra};
}
const run=async(env,db)=>{let facts;await receiveInInbox(delivery,{AI_ENABLED:'true',OPENAI_API_KEY:'fake-test-key',...env},{...quiet,store:db,send:async()=>({id:'sent'}),
  generate:async(_m,_e,_f,memory)=>{facts=memory.facts;return 'yes.';}});return facts;};
const styled={styleSources:async()=>[outfit('a','2026-10-01T00:00:00Z'),outfit('b','2026-10-03T00:00:00Z')],styleSession:async()=>({revision:1,data:{outfit_reading:reading}})};

test('a turn tells the agent about photos kept earlier, though none are in the recent messages',async()=>{
  const facts=await run({STYLE_ENABLED:'true'},store(styled));
  const fact=facts.find(f=>f.field==='outfit_photos');
  assert.equal(value(fact).kept,2);assert.equal(value(fact).reading.length,2);
});
test('with nothing kept the agent is told so, rather than left to guess',async()=>{
  const facts=await run({STYLE_ENABLED:'true'},store({styleSources:async()=>[],styleSession:async()=>({revision:0,data:{}})}));
  assert.deepEqual(value(facts.find(f=>f.field==='outfit_photos')),{kept:0,latest_at:null});
});
test('a failed photo read degrades to no fact and the reply still goes out',async()=>{
  const db=store({styleSources:async()=>{throw Error('down');},styleSession:async()=>({revision:0,data:{}})});
  const facts=await run({STYLE_ENABLED:'true'},db);
  assert.equal(facts.some(f=>f.field==='outfit_photos'),false);assert.equal(db.rows[0].status,'sent');
});
test('without the style feature nothing is read',async()=>{
  const facts=await run({},store({styleSources:async()=>assert.fail('not read'),styleSession:async()=>assert.fail('not read')}));
  assert.equal(facts.some(f=>f.field==='outfit_photos'),false);
});

test('the agent sees the fact, and a profile update in the same turn keeps it',async()=>{
  const env={AI_ENABLED:'true',OPENAI_API_KEY:'fake-test-key',MEMORY_ENABLED:'true'};
  const photos=outfitPhotosFact([outfit('a','t')],{data:{outfit_reading:reading}});
  const contexts=[];let round=0;
  const fetcher=async(_u,options)=>{
    if(!isAgentRequest(options))return {ok:true,json:async()=>({status:'completed',output:[]})};
    contexts.push(agentContext(options));
    return ++round===1?agentTurn(tool('update_profile',{changes:[{action:'set',field:'style',key:'tops',value:'likes fitted black tops',quote:'fitted black tops',message_id:'m'}],acknowledgment:'noted.'}))
      :agentTurn(tool('conversation_reply',{response:'yes, i have your outfit photos.'}));
  };
  await generateReply([{direction:'inbound',body:'I like fitted black tops. did you get my pics?'}],env,fetcher,
    {facts:[photos],profileAction:async()=>({saved:1,facts:[{field:'style',key:'tops',value:'likes fitted black tops',basis:'stated'}]})});
  assert.ok(contexts.length>=2);
  for(const c of contexts)assert.ok(c.saved_profile.some(f=>f.field==='outfit_photos'&&JSON.parse(f.value).kept===1),'every round still sees the kept photos');
  assert.ok(contexts.at(-1).saved_profile.some(f=>f.field==='style'),'the profile change applied too');
});

test('discovery ranking receives the outfit reading as soft taste',async()=>{
  let sent;
  const products=[{brand:'A',name:'Top',url:'https://a.example/p'},{brand:'B',name:'Tee',url:'https://b.example/p'}];
  await rankDiscoveryProducts(products,{query:'going out top',facts:[outfitPhotosFact([outfit('a','t')],{data:{outfit_reading:reading}})],env:{OPENAI_API_KEY:'fake-test-key'},
    fetcher:async(_u,options)=>{sent=JSON.parse(JSON.parse(options.body).input[0].content);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({indices:[0,1],rejected_indices:[]})}]}]})};}});
  assert.ok(sent.taste.some(t=>t.field==='outfit_photos'&&JSON.parse(t.value).reading.includes('mostly black fitted tops')));
});
