import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.js';
import {sentMessageId} from '../lib/message-context.js';
import {triagePackets} from '../lib/feedback-triage.js';

// October 21: five of six reports replied to or tapped a product card. Cards keep their ids with their
// answer (reply_diagnostics.sent_parts, October 20), but the triage packet matched only the answer's own
// id, so it could not say which product a report was about; tapbacks on cards were also never counted
// (store.reactionTarget). A tapback names the part it is on as "p:0/<id>", which nothing matched.

test('a tapback’s part prefix is a format, not part of the message id',()=>{
 assert.equal(sentMessageId('p:0/spc-msg-1'),'spc-msg-1');
 assert.equal(sentMessageId('p:12/spc-msg-1'),'spc-msg-1');
 for(const id of ['spc-msg-1','p-answer','p:x/spc-msg-1','p:0spc'])assert.equal(sentMessageId(id),id);
 assert.equal(sentMessageId(null),null);
});

// The store, in memory: rows by provider id, outbound rows by a part id they kept.
const memory=(messages,queries=[])=>createStore({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake'},async url=>{
 const u=new URL(url);queries.push(u);const p=k=>u.searchParams.get(k);
 const inList=v=>v?.startsWith('in.(')?v.slice(4,-1).split(',').map(x=>JSON.parse(x)):null;
 let rows;
 const part=p('reply_diagnostics->sent_parts');
 if(part){const [{id}]=JSON.parse(part.slice(3));rows=messages.filter(m=>m.direction==='outbound'&&m.reply_diagnostics?.sent_parts?.some(s=>s.id===id));}
 else if(p('provider_id'))rows=messages.filter(m=>m.provider_id===p('provider_id').slice(3));
 else if(p('reply_provider_id')){const ids=inList(p('reply_provider_id'));rows=messages.filter(m=>ids.includes(m.reply_provider_id)&&m.id!==p('id').slice(4));}
 else rows=[...messages].reverse();
 if(p('select')?.includes('conversations!inner'))rows=rows.map(r=>({conversation_id:r.conversation_id??'owner',operation_id:r.operation_id}));
 return {ok:true,text:async()=>JSON.stringify(rows)};
});
const answer={id:'answer',provider_id:'p-answer',operation_id:'ai:in1',direction:'outbound',status:'sent',body:'three derbys',created_at:'2026-10-21T04:46:39Z',reply_provider_id:null,
 search_result:{text_wishlist_state:{stage:'choice',options:[{name:'A',url:'https://a.example/p'},{name:'B',url:'https://b.example/p'},{name:'C',url:'https://c.example/p'}]}},
 reply_diagnostics:{outcome:'sent',sent_parts:[{id:'card-1',kind:'card',option:1},{id:'card-2',kind:'card',option:2},{id:'card-3',kind:'card',option:3}]}};

test('a reply naming a card part with the tapback prefix resolves to that card’s option',async()=>{
 for(const target of ['p:0/card-3','card-3']){
  const current={id:'current',provider_id:'p-current',direction:'inbound',body:'not this one',created_at:'2026-10-21T16:33:22Z',reply_provider_id:target};
  const now=(await memory([answer,current]).context('owner','p-current')).find(m=>m.id==='current');
  assert.equal(now.reply_context.resolved,true,target);
  assert.deepEqual(now.reply_context.messages.map(m=>[m.id,m.replied_to_part]),[['answer',{kind:'card',option:3}]]);
 }
 // The answer itself, named with the prefix, resolves too.
 const direct={id:'current',provider_id:'p-current',direction:'inbound',body:'this',created_at:'2026-10-21T16:33:22Z',reply_provider_id:'p:0/p-answer'};
 assert.equal((await memory([answer,direct]).context('owner','p-current')).find(m=>m.id==='current').reply_context.resolved,true);
});

test('a tapback on a product card counts against its answer',async()=>{
 for(const target of ['p:0/card-2','card-2','p:0/p-answer','p-answer']){
  const queries=[];
  const found=await memory([answer],queries).reactionTarget(target,'sender-1');
  assert.deepEqual(found,{conversation_id:'owner',operation_id:'ai:in1'},target);
  assert.ok(queries.every(q=>q.searchParams.get('conversations.sender_id')==='eq.sender-1'),'only the reacting person’s own replies');
 }
 assert.equal(await memory([answer]).reactionTarget('p:0/unknown','sender-1'),null);
});

const report={id:'r1',conversation_id:'c1',created_at:'2026-10-21T16:33:45Z',body:'#dev this page only links to another store',developer_feedback:'this page only links to another store'};
test('a triage packet marks the reported card and its option, inside the window or fetched from outside it',async()=>{
 const inWindow={feedbackSince:async()=>[{...report,reply_provider_id:'p:0/card-3'}],feedbackContext:async()=>[answer],feedbackTarget:assert.fail};
 const [a]=(await triagePackets(inWindow)).packets;
 assert.equal(a.context[0].is_reported_message,true);
 assert.deepEqual(a.context[0].reported_part,{kind:'card',option:3});
 assert.equal(a.reported_message_found,true);assert.equal(a.reported_message,undefined);
 // The answer, sent hours before, is outside the window: it is fetched by the part id.
 const looked=[];
 const outside={feedbackSince:async()=>[{...report,reply_provider_id:'card-1'}],feedbackContext:async()=>[],feedbackTarget:async(c,id)=>{looked.push([c,id]);return answer;}};
 const [b]=(await triagePackets(outside)).packets;
 assert.deepEqual(looked,[['c1','card-1']]);
 assert.deepEqual([b.reported_message.id,b.reported_message.is_reported_message,b.reported_message.reported_part],['answer',true,{kind:'card',option:1}]);
 assert.equal(b.reported_message_found,true);
 // Not found anywhere: said plainly, never guessed.
 const [c]=(await triagePackets({feedbackSince:async()=>[{...report,reply_provider_id:'gone'}],feedbackContext:async()=>[answer],feedbackTarget:async()=>null})).packets;
 assert.equal(c.reported_message_found,false);assert.ok(c.context.every(t=>!t.is_reported_message));
 // A report that replies to nothing has no such field.
 const [d]=(await triagePackets({feedbackSince:async()=>[report],feedbackContext:async()=>[answer]})).packets;
 assert.equal(d.reported_message_found,undefined);
});

test('the store fetches a reported message by its own id or by a card it sent, within the conversation',async()=>{
 const queries=[];const store=memory([answer],queries);
 assert.equal((await store.feedbackTarget('owner','p:0/card-2')).id,'answer');
 assert.equal((await store.feedbackTarget('owner','p-answer')).id,'answer');
 assert.equal(await store.feedbackTarget('owner','nothing'),null);
 assert.ok(queries.every(q=>q.searchParams.get('conversation_id')==='eq.owner'));
});
