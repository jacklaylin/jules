import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageReferences,referencedImage,replyProviderId} from '../lib/message-context.js';
import {createStore} from '../lib/store.js';
import {receiveInInbox} from '../lib/inbox.js';
import {generateReply} from '../lib/ai.js';
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
