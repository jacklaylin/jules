import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rereadImage} from '../lib/image-reread.js';
import {createAdminHandler} from '../api/admin.js';

const person='00000000-0000-4000-8000-0000000000aa',messageId='00000000-0000-4000-8000-0000000000bb';
const conversation={id:person,sender_id:'synthetic-tester',line:'synthetic-line'};
const image=()=>Object.defineProperty({mime_type:'image/jpeg',data:'AAAA'},'info',{value:{original_bytes:5200000,bytes:900000,converted:'recompressed'}});
function world(message={id:messageId,provider_id:'provider-1',direction:'inbound',image_status:'failed',message_images:[]}){
  const saved=[];
  return {saved,store:{conversation:async id=>id===person?conversation:null,conversationMessage:async(c,id)=>c===person&&id===messageId?message:null,
    saveImages:async(provider,images)=>saved.push({provider,images})}};
}
async function adminPost(handler,input,origin='https://jules.example'){
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.status=this.statusCode;this.data=JSON.parse(value);}};
  await handler({method:'POST',url:'/api/admin',headers:{'content-type':'application/json',...(origin?{origin}:{})},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}},res);
  return res;
}

test('a failed photo is read again from Photon by its own message and saved with its sizes',async()=>{
  const w=world();let asked;
  const result=await rereadImage(w.store,conversation,messageId,{},{load:async args=>{asked=args;return [image()];}});
  assert.deepEqual(asked,{sender:'synthetic-tester',line:'synthetic-line',providerId:'provider-1'});
  assert.equal(result.status,'saved');assert.equal(result.count,1);assert.equal(result.image_info[0].original_bytes,5200000);
  assert.equal(w.saved[0].provider,'provider-1');assert.deepEqual(Object.keys({...w.saved[0].images[0]}),['mime_type','data']);
});
test('a re-read never overwrites saved photos and only applies to a failed inbound photo',async()=>{
  const load=async()=>assert.fail('no download');
  const saved=world({id:messageId,provider_id:'p',direction:'inbound',image_status:'saved',message_images:[{id:'x'}]});
  assert.equal((await rereadImage(saved.store,conversation,messageId,{},{load})).status,'already_saved');
  await assert.rejects(rereadImage(world({id:messageId,provider_id:'p',direction:'inbound',image_status:null,message_images:[]}).store,conversation,messageId,{},{load}),{status:409});
  await assert.rejects(rereadImage(world({id:messageId,provider_id:'p',direction:'outbound',image_status:'failed'}).store,conversation,messageId,{},{load}),{status:400});
  assert.equal(saved.saved.length,0);
});
test('a re-read that still fails reports its reason and leaves the message as it was',async()=>{
  const w=world();
  const result=await rereadImage(w.store,conversation,messageId,{},{load:async()=>{throw Object.assign(new Error('Image download failed'),{image_reason:'message_not_found'});}});
  assert.deepEqual(result,{status:'failed',reason:'message_not_found'});assert.equal(w.saved.length,0);
});
test('admin re-read needs the admin page, confirmation and a message in that conversation',async()=>{
  const w=world();
  const handler=createAdminHandler({auth:async()=>200,env:{SITE_ORIGIN:'https://jules.example'},storeFactory:()=>w.store});
  for(const origin of [null,'https://evil.example'])assert.match((await adminPost(handler,{action:'reread-image',conversation:person,message:messageId,confirm:true},origin)).data.error,/admin page/);
  assert.match((await adminPost(handler,{action:'reread-image',conversation:person,message:messageId})).data.error,/Confirm/);
  assert.match((await adminPost(handler,{action:'reread-image',conversation:person,message:'not-a-uuid',confirm:true})).data.error,/Unknown message/);
  assert.match((await adminPost(handler,{action:'reread-image',conversation:person,message:'00000000-0000-4000-8000-0000000000cc',confirm:true})).data.error,/isn’t in this conversation/);
  assert.equal(w.saved.length,0);
});
