import {test} from 'node:test';
import assert from 'node:assert/strict';
import {threadTarget} from '../lib/message-context.js';
import {receiveInInbox} from '../lib/inbox.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,agentContext} from './helpers/agent.js';

// The reply's thread follows what the turn answered and which photos it read, never whether the
// newest message had a photo. Assertions are about the target, not the reply's wording.

// The October 15 report: a text request that got the fallback, then uncaptioned order screenshots.
const romi={id:'romi',provider_id:'p-romi',direction:'inbound',body:'Also where can I find the Jacques Marie Mage Romi glasses for the best price?',created_at:'2026-10-15T15:55:56Z'};
const oops={id:'oops',provider_id:'p-oops',direction:'outbound',status:'sent',body:'i couldn’t prepare a reply just now. could you try again?',created_at:'2026-10-15T15:56:00Z'};
const shots={id:'shots',provider_id:'p-shots',direction:'inbound',body:'[Inspiration images]',created_at:'2026-10-15T17:57:02Z',message_images:[{id:'i1',position:0}]};
const shotsDelivery={space:{phone:'line'},message:{id:'p-shots',sender:{id:'tester'},content:{type:'text',text:''},attachments:[{id:'a1'}]}};
const photo={id:'photo',provider_id:'p-photo',direction:'inbound',body:'[Inspiration images]',created_at:'2026-10-15T10:00:00Z',message_images:[{id:'i0',position:0}]};
const looks={id:'looks',provider_id:'p-looks',direction:'outbound',status:'sent',body:'love the proportions on that coat.',created_at:'2026-10-15T10:00:30Z'};
const text=(id,body,extra={})=>({id,provider_id:'p-'+id,direction:'inbound',body,created_at:'2026-10-15T18:00:00Z',...extra});
const textDelivery=(id,body,content={type:'text',text:body})=>({space:{phone:'line'},message:{id:'p-'+id,sender:{id:'tester'},content,attachments:[]}});

test('a photo whose reply answers an earlier text request is not threaded under the photo',()=>{
 const messages=[romi,oops,shots];
 // The screenshot import and the earlier request were both answered: unclear which one, so no thread.
 assert.equal(threadTarget(shotsDelivery.message,messages,{answered:['romi'],used:['shots']}),null);
 assert.equal(threadTarget(shotsDelivery.message,messages,{answered:['romi','shots']}),null);
 // Only the earlier request was answered: the reply threads under that request.
 assert.deepEqual(threadTarget(shotsDelivery.message,messages,{answered:['romi']}),{id:'p-romi',content:{type:'text'}});
});

test('a photo that is the subject of the turn keeps the reply threaded under it',()=>{
 const messages=[romi,oops,shots];
 assert.equal(threadTarget(shotsDelivery.message,messages,{answered:['shots'],used:['shots']}),shotsDelivery.message);
 // The tool may name the newest message by its provider ID before it has a stored ID.
 assert.equal(threadTarget(shotsDelivery.message,messages,{used:['p-shots']}),shotsDelivery.message);
});

test('a reply in the tester’s own thread stays in that thread whatever the turn read',()=>{
 const current=text('again','what about this one?');
 const delivery=textDelivery('again','what about this one?',{type:'reply',text:'what about this one?',target:{id:'p-looks'}});
 for(const threading of [{},{answered:['romi']},{answered:['romi'],used:['photo']},{used:['photo','shots']}])
  assert.equal(threadTarget(delivery.message,[photo,looks,romi,current],threading),delivery.message);
});

test('a plain text turn is not threaded',()=>{
 const current=text('hi','do you have anything in navy?');
 const delivery=textDelivery('hi','do you have anything in navy?');
 assert.equal(threadTarget(delivery.message,[romi,current],{answered:['hi']}),null);
 assert.equal(threadTarget(delivery.message,[romi,current],{}),null);
});

test('a newest request about an earlier photo threads under that photo; mixed or unknown references do not thread',()=>{
 const current=text('ask','find that coat');
 const delivery=textDelivery('ask','find that coat');
 assert.deepEqual(threadTarget(delivery.message,[photo,looks,current],{answered:['ask'],used:['photo']}),{id:'p-photo',content:{type:'attachment'}});
 assert.equal(threadTarget(delivery.message,[photo,looks,shots,current],{used:['photo','shots']}),null);
 assert.equal(threadTarget(delivery.message,[photo,looks,romi,current],{answered:['romi'],used:['photo']}),null);
 assert.equal(threadTarget(delivery.message,[photo,current],{answered:['not-in-this-conversation']}),null);
});

// The whole turn: the inbox, the agent loop with a scripted model, and the send. Non-agent model
// calls (product search) fail, which is enough: what the turn read is recorded before searching.
async function turn({context,delivery,rounds,env={}}){
 let target,requests=[],round=0;const recorded=[];
 const store={receive:async()=>'conversation',claimAI:async()=>true,context:async()=>context,saveImages:async()=>{},
  imagesForMessage:async()=>[{mime_type:'image/png',data:'aGk='}],prepareAI:async()=>{},finish:async()=>{},searchResult:async()=>{},
  replyDiagnostics:async()=>{},claimGmailImport:async()=>null,recordDelivery:async(_op,_id,reply)=>recorded.push(reply)};
 const fetcher=async(_url,options)=>{
  if(!Array.isArray(JSON.parse(options?.body??'{}').tools))return {ok:false,status:500,json:async()=>({})};
  requests.push(options);return rounds[Math.min(round++,rounds.length-1)];
 };
 await receiveInInbox(delivery,{AI_ENABLED:'true',OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true',...env},{store,
  generate:(messages,e,_f,memory)=>generateReply(messages,e,fetcher,memory),
  send:async(_d,_b,_e,rich)=>{target=rich.replyTarget;return {id:'sent'};},
  loadImages:async()=>[{mime_type:'image/png',data:'aGk='}],progress:async()=>async()=>{},writeFollowup:async()=>null,
  screenshotImport:async()=>({body:'Added 2 purchases from SSENSE.',user:'added 2 ssense purchases to your history.',added:2,linked:0})});
 return {target,recorded,requests};
}
const reply=(answers,response='here’s where things stand.')=>agentTurn(tool('conversation_reply',{response,answers_message_ids:answers}));

test('October 15 report: screenshots imported while answering an earlier request are not the thread target',async()=>{
 const env={GMAIL_IMPORT_ENABLED:'true'};
 const {target,recorded,requests}=await turn({context:[romi,oops,shots],delivery:shotsDelivery,env,
  rounds:[agentTurn(tool('add_order_screenshot',{image_message_ids:['shots']})),reply(['romi','shots'])]});
 assert.equal(target,null);assert.deepEqual(recorded,[null]);
 // The agent can name the earlier request because it sees its reference ID.
 assert.deepEqual(agentContext(requests[0]).earlier_user_messages.map(m=>m.id),['romi']);
 // The same turn where the agent says it answered only the screenshots stays threaded under them.
 const screenshotsOnly=await turn({context:[romi,oops,shots],delivery:shotsDelivery,env,
  rounds:[agentTurn(tool('add_order_screenshot',{image_message_ids:['shots']})),reply(['shots'])]});
 assert.equal(screenshotsOnly.target.id,'p-shots');
 // Answering only the earlier request (no import) threads under that request.
 const earlierOnly=await turn({context:[romi,oops,shots],delivery:shotsDelivery,rounds:[reply(['romi'])]});
 assert.deepEqual(earlierOnly.target,{id:'p-romi',content:{type:'text'}});
});

test('a search about the newest photo threads under that photo',async()=>{
 const coat={...shots,body:'who makes this coat?'};
 const delivery={...shotsDelivery,message:{...shotsDelivery.message,content:{type:'text',text:'who makes this coat?'}}};
 const {target}=await turn({context:[romi,oops,coat],delivery,
  rounds:[agentTurn(tool('find_products',{query:'camel wrap coat',use_image:true,answers_message_ids:['shots']})),reply(['shots'])]});
 assert.equal(target.id,'p-shots');
});

test('a newest text request about an earlier photo threads under the photo it read',async()=>{
 const current=text('ask','find that coat');
 const {target}=await turn({context:[photo,looks,current],delivery:textDelivery('ask','find that coat'),
  rounds:[agentTurn(tool('find_products',{query:'camel wrap coat',use_image:true,image_message_id:'photo',answers_message_ids:['ask']})),reply(['ask'])]});
 assert.deepEqual(target,{id:'p-photo',content:{type:'attachment'}});
});

test('an explicit reply from the tester is answered in their thread',async()=>{
 const current=text('again','what about in black?',{reply_context:{resolved:true,messages:[looks]}});
 const delivery=textDelivery('again','what about in black?',{type:'reply',text:'what about in black?',target:{id:'p-looks'}});
 const {target,recorded}=await turn({context:[photo,looks,romi,current],delivery,rounds:[reply(['again'])]});
 assert.equal(target,delivery.message);assert.deepEqual(recorded,['p-again']);
});

test('a plain text turn, and a fallback, are sent unthreaded',async()=>{
 const current=text('hi','what goes with grey flannel?');
 const plain=await turn({context:[romi,oops,current],delivery:textDelivery('hi','what goes with grey flannel?'),rounds:[reply(['hi'])]});
 assert.equal(plain.target,null);
 // A model that cannot be reached: the fallback answers nothing in particular, even on a photo turn.
 const failed=await turn({context:[romi,oops,shots],delivery:shotsDelivery,rounds:[{ok:false,status:500,json:async()=>({})}]});
 assert.equal(failed.target,null);
});
