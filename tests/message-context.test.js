import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageReferences,referencedImage,replyProviderId} from '../lib/message-context.js';
import {createStore} from '../lib/store.js';
import {receiveInInbox} from '../lib/inbox.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,agentContext} from './helpers/agent.js';
import {shoppingContext} from '../lib/shopping-context.js';
const image=(id,caption)=>({id,provider_id:`provider-${id}`,direction:'inbound',body:caption,message_images:[{id:`photo-${id}`,position:0}]});
const older=image('older','Sunglasses');const bag=image('bag','Lemaire hobo bag');const newer=image('newer','Shoes');
const explicit={id:'current',provider_id:'provider-current',direction:'inbound',body:'Also this bag',reply_context:{resolved:true,provider_id:bag.provider_id,messages:[bag]}};
test('explicit image target wins over newer and older unrelated images',()=>{
 assert.equal(referencedImage([older,bag,newer,explicit]).id,'bag');
 assert.equal(referencedImage([older,bag,newer,explicit],'older'),null);
 assert.deepEqual(imageReferences([older,bag,newer,explicit]).map(m=>m.caption),['Lemaire hobo bag']);
});
test('missing, foreign and cyclic targets never fall back to latest photo',()=>{
 for(const messages of [[],[newer]]){
 const current={...explicit,reply_context:{resolved:false,messages}};
 assert.deepEqual(imageReferences([older,bag,newer,current]),[]);
 }
});
test('a resolved thread without a photo falls back to the conversation photos, never marked as the reply target',()=>{
 const note={id:'note',provider_id:'provider-note',direction:'outbound',body:'i’ll keep Brut Archives in mind for future recommendations.'};
 const side={id:'side',provider_id:'provider-side',direction:'inbound',body:'Brut is a cool brand'};
 for(const body of ['What did you find?','any luck?','so is it brut or not']){
  const current={id:'current',provider_id:'provider-current',direction:'inbound',body,reply_context:{resolved:true,messages:[note,side]}};
  const refs=imageReferences([older,bag,side,note,current]);
  assert.deepEqual(refs.map(m=>[m.id,m.explicit_reply]),[['older',false],['bag',false]],body);
  assert.equal(referencedImage([older,bag,side,note,current]).id,'bag',body);
 }
 // No photo anywhere: still nothing.
 assert.deepEqual(imageReferences([side,note,{direction:'inbound',body:'What did you find?',reply_context:{resolved:true,messages:[note]}}]),[]);
});
test('new attached image remains current even when replying to an older message',()=>{
 const current={...image('current','A new bag'),reply_context:explicit.reply_context};
 assert.equal(referencedImage([older,bag,current]).id,'current');
});
test('ordinary followup may select any available image by ID; unknown ID cannot retarget',()=>{
 const current={direction:'inbound',body:'Find the earlier one'};
 assert.equal(referencedImage([older,bag,current],'older').id,'older');
 assert.equal(referencedImage([older,bag,current],'foreign'),null);
});
test('only valid signed reply IDs are persisted, never quoted target text',()=>{
 assert.equal(replyProviderId({content:{type:'reply',target:{id:'target',content:{text:'Untrusted'}}}}),'target');
 for(const id of ['',123,'x'.repeat(501)])assert.equal(replyProviderId({content:{type:'reply',target:{id}}}),null);
});
test('database resolves old reply chain outside recent window within the same conversation',async()=>{
 const queries=[];
 const db=createStore({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake'},async(url)=>{
 const u=new URL(url);queries.push(u);
 let rows;
 if(u.searchParams.get('select')==='id,created_at,reply_provider_id')rows=[{id:'current',created_at:'2026-10-09',reply_provider_id:'provider-caption'}];
 else if(u.searchParams.has('reply_provider_id'))rows=[];
 else if(u.searchParams.get('provider_id')==='eq.provider-caption')rows=[{id:'caption',provider_id:'provider-caption',direction:'inbound',body:'Lemaire hobo bag',reply_provider_id:'provider-bag'}];
 else if(u.searchParams.get('provider_id')==='eq.provider-bag')rows=[bag];
 else rows=[{...explicit,reply_context:undefined},newer];
 return {ok:true,text:async()=>JSON.stringify(rows)};
 });
 const rows=await db.context('owner','provider-current');
 const current=rows.find(m=>m.id==='current');assert.equal(current.reply_context.resolved,true);
 assert.deepEqual(current.reply_context.messages.map(m=>m.id),['bag','caption']);
 assert.ok(queries.every(q=>q.searchParams.get('conversation_id')==='eq.owner'));
});
test('threaded followup loads the intended bytes and replies to its triggering message',async()=>{
 let loaded,reply;
 const store={receive:async()=> 'conversation',claimAI:async()=>true,context:async()=>[older,bag,newer,explicit],
 imagesForMessage:async id=>{loaded=id;return [{mime_type:'image/png',data:'bag-bytes'}]},prepareAI:async()=>{},finish:async()=>{},searchResult:async()=>{}};
 const delivery={space:{phone:'fake'},message:{id:'provider-current',sender:{id:'fake'},content:{type:'reply',text:'Also this bag',target:{id:'provider-bag'}},attachments:[]}};
 await receiveInInbox(delivery,{AI_ENABLED:'true'},{store,progress:async()=>async()=>{},generate:async(context,env,fetch,memory)=>{
 assert.equal(memory.imageReferences[0].caption,'Lemaire hobo bag');await memory.loadImages('bag');return 'Reply';
 },send:async(d,b,e,rich)=>{reply=rich.replyTarget.id;}});
 assert.equal(loaded,'bag');assert.equal(reply,'provider-current');
});
test('the one agent gets the explicit caption and reply target as context and decides the action',async()=>{
 let request,context;
 await generateReply([older,bag,newer,explicit],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async(url,options)=>{
  request=JSON.parse(options.body);context=agentContext(options);return agentTurn(tool('conversation_reply',{response:'Want me to find that bag?'}));
 },{imageReferences:imageReferences([older,bag,newer,explicit]),wishlistAction:async()=>assert.fail('No action without model authorization')});
 assert.deepEqual(context.message_references.images.map(i=>i.caption),['Lemaire hobo bag']);assert.equal(context.message_references.reply.provider_id,bag.provider_id);
 const find=request.tools.find(t=>t.name==='find_products');assert.ok(find.parameters.required.includes('image_message_id'));
});
test('threaded product selection uses original result set rather than newest choices',()=>{
 const result={products:[{name:'Bag',url:'https://example.com/bag'}]};
 const current={...explicit,reply_context:{resolved:true,messages:[{search_result:result}]}};
 const state=shoppingContext([current],{stage:'choice',options:[{url:'https://example.com/shoes'}]});
 assert.equal(state.options[0].name,'Bag');
});

test('ambiguous image search cannot silently select the latest reference',async()=>{
 let loaded=false;
 const response=await generateReply([older,bag,{direction:'inbound',body:'Find that one'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async()=>agentTurn(tool('find_products',{query:'A bag',use_image:true,image_message_id:null})),
 {imageReferences:[older,bag],loadImages:async()=>{loaded=true;return []}});
 assert.equal(loaded,false);assert.ok(response);
});

// iMessage points every reply in a thread at the thread's first message. A product set Jules sent
// later in that thread is what the user is answering, not the thread's first (older) result.
const threadStore=(messages,queries=[])=>createStore({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake'},async(url)=>{
 const u=new URL(url);queries.push(u);const p=k=>u.searchParams.get(k);
 const inList=v=>v?.startsWith('in.(')?v.slice(4,-1).split(',').map(x=>JSON.parse(x)):null;
 let rows;
 if(p('select')==='id,created_at,reply_provider_id')rows=messages.filter(m=>m.provider_id===p('provider_id').slice(3));
 else if(p('provider_id'))rows=messages.filter(m=>m.provider_id===p('provider_id').slice(3));
 else if(p('reply_provider_id')){const ids=inList(p('reply_provider_id'));rows=messages.filter(m=>ids.includes(m.reply_provider_id)&&m.id!==p('id').slice(4)&&!m.developer_feedback&&(p('direction')?m.direction===p('direction').slice(3):true));}
 else rows=[...messages].reverse();
 return {ok:true,text:async()=>JSON.stringify(rows)};
});
const firstResult={text_wishlist_state:{stage:'search_clarification',options:[]}};
const laterResult={text_wishlist_state:{stage:'choice',options:[{name:'Peyter pants',url:'https://shop.example.com/peyter'}]}};
const root={id:'root',provider_id:'p-root',direction:'outbound',status:'sent',body:'No verified match yet',created_at:'2026-10-15T00:00:00Z',search_result:firstResult};
const ask={id:'ask',provider_id:'p-ask',direction:'inbound',body:'Use the model name',created_at:'2026-10-15T00:01:00Z',reply_provider_id:'p-root'};
const answer={id:'answer',provider_id:'p-answer',direction:'outbound',status:'sent',body:'Peyter pants',created_at:'2026-10-15T00:02:00Z',reply_provider_id:'p-ask',search_result:laterResult};
const note={id:'note',provider_id:'p-note',direction:'inbound',body:'bug report',developer_feedback:'bug',created_at:'2026-10-15T00:03:00Z',reply_provider_id:'p-root'};
test('a reply inside an iMessage thread resolves against the newest result in that thread',async()=>{
 for(const body of ['Add them to my wishlist','Save these and watch the price','Not those, show me others']){
  const current={id:'current',provider_id:'p-current',direction:'inbound',body,created_at:'2026-10-15T00:04:00Z',reply_provider_id:'p-root'};
  const queries=[];const rows=await threadStore([root,ask,answer,note,current],queries).context('owner','p-current');
  const now=rows.find(m=>m.id==='current');
  assert.equal(now.reply_context.resolved,true);
  assert.deepEqual(now.reply_context.messages.map(m=>m.id),['root','ask','answer']);
  assert.equal(shoppingContext(rows,null).options[0].name,'Peyter pants');
  assert.ok(queries.every(q=>q.searchParams.get('conversation_id')==='eq.owner'));
  assert.ok(queries.filter(q=>q.searchParams.has('reply_provider_id')).every(q=>q.searchParams.get('created_at')==='lte.2026-10-15T00:04:00Z'&&q.searchParams.get('developer_feedback')==='is.null'));
 }
});
test('thread turns never include unsent answers or other threads; the first result stays when nothing newer exists',async()=>{
 const pending={...answer,id:'pending',provider_id:null,status:'generating'};
 const elsewhere={...answer,id:'elsewhere',provider_id:'p-elsewhere',reply_provider_id:'p-other'};
 const current={id:'current',provider_id:'p-current',direction:'inbound',body:'Yes that one',created_at:'2026-10-15T00:04:00Z',reply_provider_id:'p-root'};
 const rows=await threadStore([root,ask,pending,elsewhere,current]).context('owner','p-current');
 assert.deepEqual(rows.find(m=>m.id==='current').reply_context.messages.map(m=>m.id),['root','ask']);
 assert.equal(shoppingContext(rows,laterResult.text_wishlist_state).stage,'search_clarification');
});
test('a photo sent inside a thread is the thread image the next reply refers to',async()=>{
 const photo={id:'photo',provider_id:'p-photo',direction:'inbound',body:'This one',created_at:'2026-10-15T00:01:30Z',reply_provider_id:'p-root',message_images:[{id:'img',position:0}]};
 const rootPhoto={...root,direction:'inbound',status:'received',message_images:[{id:'root-img',position:0}],search_result:null};
 const current={id:'current',provider_id:'p-current',direction:'inbound',body:'Where is it from',created_at:'2026-10-15T00:04:00Z',reply_provider_id:'p-root'};
 const rows=await threadStore([rootPhoto,photo,current]).context('owner','p-current');
 assert.equal(referencedImage(rows).id,'photo');
});
