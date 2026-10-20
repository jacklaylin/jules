import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomBytes} from 'node:crypto';
import {incomingContent,readImage,MAX_IMAGE_BYTES,MAX_DOWNLOAD_BYTES} from '../lib/images.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool} from './helpers/agent.js';
import {receiveInInbox} from '../lib/inbox.js';
import {createImageHandler} from '../api/image.js';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
const attachment=(bytes=png,mimeType='image/png',size=bytes.length)=>({mimeType,size,stream:async()=>new ReadableStream({start(c){c.enqueue(bytes);c.close();}})});
test('single and album inspiration images keep caption and authenticated IDs, never URLs',()=>{
  const image={type:'attachment',id:'fake-image',mimeType:'image/png',url:'https://untrusted.invalid'};
  assert.deepEqual(incomingContent(image),{text:'[Inspiration images]',attachments:[image]});
  const album={type:'group',items:[{content:{type:'text',text:'I like this jacket'}},{content:image}]};
  assert.equal(incomingContent(album).text,'I like this jacket');
  assert.equal(incomingContent({type:'attachment',mimeType:'video/mp4'}),null);
  assert.throws(()=>incomingContent({type:'group',items:Array.from({length:4},()=>({content:image}))}));
  assert.throws(()=>incomingContent({...image,id:''}));
});
test('image bytes have bounded streaming and checked types, unsupported formats fail',async()=>{
  assert.equal((await readImage(attachment())).data,png.toString('base64'));
  await assert.rejects(readImage(attachment(png,'image/jpeg')));
  await assert.rejects(readImage(attachment(png,'image/heic')));
  await assert.rejects(readImage(attachment(png,'image/png',MAX_DOWNLOAD_BYTES+1)));
  await assert.rejects(readImage(attachment(Buffer.alloc(MAX_DOWNLOAD_BYTES+1),'image/png',0)),{code:'image_too_large'});
});
test('vision uses private inline bytes and treats inferred taste as unconfirmed',async()=>{
  let sent;
  const reply=await generateReply([{direction:'inbound',body:'Wedding shoes under $300'}, {direction:'outbound',status:'sent',body:'What is the wedding dress code?'}, {direction:'inbound',body:'I love this outfit'}],{OPENAI_API_KEY:'fake'},async(url,options)=>{
    sent=JSON.parse(options.body);
    return agentTurn(tool('conversation_reply',{response:'Relaxed tailoring. Which details do you like?'}));
  },{images:[{mime_type:'image/png',data:png.toString('base64')}],facts:[]});
  assert.match(reply,/Relaxed/);
  assert.equal(sent.input.at(-1).content[1].type,'input_image');
  assert.match(sent.input.at(-1).content[1].image_url,/^data:image\/png;base64,/);
  assert.match(sent.instructions,/Seeing an image alone never saves a taste preference/);
  assert.equal(sent.input[1].content,'Wedding shoes under $300');
  assert.equal(sent.input.at(-1).content[0].text,'I love this outfit');
  assert.equal(sent.store,false);
});
test('image receipt saves private bytes, skips inference-to-memory, and sends one reply across retries',async()=>{
  let claimed=false,saved=0,sent=0;
  const store={receive:async()=> 'conversation',claimAI:async()=>{if(claimed)return false;claimed=true;return true;},
    saveImages:async()=>saved++,context:async()=>[{direction:'inbound',body:'[Inspiration images]'}],profile:async()=>({facts:[{field:'brand',key:'example',value:'likes'}]}),prepareAI:async()=>{},finish:async()=>{}};
  const delivery={message:{id:'image-message',attachments:[{id:'fake'}]}};
  const options={store,loadImages:async()=>[{mime_type:'image/png',data:png.toString('base64')}],updateMemory:async()=>assert.fail('Do not persist image inferences'),
    generate:async(context,env,fetch,memory)=>{assert.equal(memory.facts.length,1);assert.equal(memory.images.length,1);return 'What details do you like?';},send:async()=>sent++};
  for(let i=0;i<2;i++) await receiveInInbox(delivery,{AI_ENABLED:'true',MEMORY_ENABLED:'true'},options);
  assert.equal(saved,1);assert.equal(sent,1);
});
test('image failures remain visible and produce a practical fallback without inventing visual details',async()=>{
  let failed=false,body;
  const store={receive:async()=> 'conversation',claimAI:async()=>true,imageStatus:async(id,status)=>{failed=status==='failed';},prepareAI:async(op,text)=>body=text,finish:async()=>{}};
  await receiveInInbox({message:{id:'image',attachments:[{id:'fake'}]}},{AI_ENABLED:'true'},
    {store,loadImages:async()=>{throw new Error('private error');},generate:async()=>assert.fail(),send:async()=>{}});
  assert.equal(failed,true);assert.match(body,/under 15 MB/);
});
test('private image endpoint authenticates before reading any bytes',async()=>{
  const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
  const blocked=response();await createImageHandler({auth:async()=>403,storeFactory:()=>assert.fail()})({headers:{},method:'GET',url:'/api/image?id=bad'},blocked);
  assert.equal(blocked.statusCode,403);
  const accepted=response();await createImageHandler({auth:async()=>200,storeFactory:()=>({image:async()=>({mime_type:'image/png',data:png.toString('base64')})})})({headers:{},method:'GET',url:'/api/image?id=00000000-0000-4000-8000-000000000001'},accepted);
  assert.equal(accepted.statusCode,200);assert.match(accepted.headers['Cache-Control'],/no-store/);assert.deepEqual(accepted.body,png);
});

test('real HEIC phone-format bytes convert to a bounded JPEG for storage and vision',async()=>{
  const {readFile}=await import('node:fs/promises');
  const bytes=await readFile(new URL('./fixtures/white-8x8.heic',import.meta.url));
  const image=await readImage(attachment(bytes,'image/heic'));
  assert.equal(image.mime_type,'image/jpeg');
  const jpeg=Buffer.from(image.data,'base64');
  assert.equal(jpeg[0],255);assert.equal(jpeg[1],216);assert.ok(jpeg.length<MAX_IMAGE_BYTES);
});
test('HEIC conversion errors and oversized conversion output stay on the fallback path',async()=>{
  const bytes=Buffer.from([0,0,0,20,102,116,121,112,104,101,105,99,0,0,0,0]);
  await assert.rejects(readImage(attachment(bytes,'image/heic'),async()=>{throw new Error('Invalid HEIC');}));
  await assert.rejects(readImage(attachment(bytes,'image/heic'),async()=>Buffer.alloc(MAX_IMAGE_BYTES+1)));
});
test('attachment failures expose bounded diagnostic codes without provider messages or private bytes',async()=>{
 await assert.rejects(readImage(null),{code:'attachment_missing'});
 await assert.rejects(readImage(attachment(png,'image/gif')),{code:'unsupported_type'});
 await assert.rejects(readImage(attachment(png,'image/png',MAX_DOWNLOAD_BYTES+1)),{code:'image_too_large'});
 await assert.rejects(readImage(attachment(png,'image/jpeg')),{code:'invalid_image_bytes'});
 await assert.rejects(readImage(attachment(Buffer.alloc(0))),{code:'empty_image'});
});
// Random noise is the worst case for compression, standing in for an image-heavy grid screenshot.
const noisePNG=(width,height)=>sharp(randomBytes(width*height*3),{raw:{width,height,channels:3}}).png().toBuffer();
test('oversized iPhone screenshots are shrunk under the storage limit as metadata-free JPEG',async()=>{
  const bytes=await sharp(await noisePNG(1179,2556)).withMetadata({exif:{IFD0:{Copyright:'private'}}}).png().toBuffer();
  assert.ok(bytes.length>MAX_IMAGE_BYTES&&bytes.length<MAX_DOWNLOAD_BYTES);
  const image=await readImage(attachment(bytes,'image/png'));
  assert.equal(image.mime_type,'image/jpeg');
  const jpeg=Buffer.from(image.data,'base64');
  assert.ok(jpeg.length<=MAX_IMAGE_BYTES);
  const meta=await sharp(jpeg).metadata();
  assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);
  assert.ok(meta.width>=900,'grid screenshot keeps enough width to read');
});
test('tall screenshots keep their aspect ratio and a legible long edge',async()=>{
  const bytes=await noisePNG(800,5000);
  assert.ok(bytes.length>MAX_IMAGE_BYTES&&bytes.length<MAX_DOWNLOAD_BYTES);
  const jpeg=Buffer.from((await readImage(attachment(bytes,'image/png'))).data,'base64');
  assert.ok(jpeg.length<=MAX_IMAGE_BYTES);
  const {width,height}=await sharp(jpeg).metadata();
  assert.ok(height>=3072&&height<=4096,`height ${height}`);
  assert.ok(Math.abs(width/height-800/5000)<0.01);
});
test('small images pass through untouched and undecodable large bytes fail with a bounded code',async()=>{
  const small=await sharp({create:{width:40,height:40,channels:3,background:'#123456'}}).png().toBuffer();
  assert.equal((await readImage(attachment(small))).data,small.toString('base64'));
  const fake=Buffer.concat([png,Buffer.alloc(MAX_IMAGE_BYTES+1)]);
  await assert.rejects(readImage(attachment(fake,'image/png')),{code:'image_normalization_failed'});
});
