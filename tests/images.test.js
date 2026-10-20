import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incomingContent,readImage,MAX_IMAGE_BYTES,MAX_DOWNLOAD_BYTES,MAX_LONG_EDGE} from '../lib/images.js';
import sharp from 'sharp';
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
  assert.equal(failed,true);assert.match(body,/JPG, PNG, WebP, or HEIC/);
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
  await assert.rejects(readImage(attachment(bytes,'image/heic'),async()=>Buffer.alloc(MAX_IMAGE_BYTES+1)),{code:'invalid_image_bytes'});
});
test('attachment failures expose bounded diagnostic codes without provider messages or private bytes',async()=>{
 await assert.rejects(readImage(null),{code:'attachment_missing'});
 await assert.rejects(readImage(attachment(png,'image/gif')),{code:'unsupported_type'});
 await assert.rejects(readImage(attachment(png,'image/png',MAX_DOWNLOAD_BYTES+1)),{code:'image_too_large'});
 await assert.rejects(readImage(attachment(png,'image/jpeg')),{code:'invalid_image_bytes'});
 await assert.rejects(readImage(attachment(Buffer.alloc(0))),{code:'empty_image'});
});

// A full-screen iPhone screenshot as PNG: random noise does not compress, so the fixture is well over
// the 3 MB storage limit, like a real photo-heavy Depop grid. Built in memory rather than committed.
const screenshotPNG=async(width,height)=>{
  const raw=Buffer.alloc(width*height*3);
  // Deterministic noise in 2-pixel blocks: photo-like detail that PNG cannot compress well.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)raw[(y*width+x)*3+c]=Math.imul((x>>1)*73856093^(y>>1)*19349663^c*83492791,2654435761)>>>24;
  return sharp(raw,{raw:{width,height,channels:3}}).png({compressionLevel:1}).toBuffer();
};
test('an oversized PNG screenshot is recompressed under the storage limit instead of rejected',async()=>{
  const bytes=await screenshotPNG(1290,2796);
  assert.ok(bytes.length>MAX_IMAGE_BYTES&&bytes.length<MAX_DOWNLOAD_BYTES,`fixture is ${bytes.length} bytes`);
  const image=await readImage(attachment(bytes,'image/png'));
  const out=Buffer.from(image.data,'base64');
  assert.equal(image.mime_type,'image/jpeg');assert.equal(out[0],255);assert.equal(out[1],216);
  assert.ok(out.length<=MAX_IMAGE_BYTES);
  const {width,height}=await sharp(out).metadata();
  assert.ok(width>=600&&height>=1300,`kept ${width}x${height}`);
  assert.equal(width/height>0.45&&width/height<0.47,true);
  // Sizes are diagnosable, and never stored with the image row.
  assert.equal(image.info.original_bytes,bytes.length);assert.equal(image.info.bytes,out.length);
  assert.equal(image.info.converted,'recompressed');assert.equal(image.info.source_width,1290);
  assert.deepEqual(Object.keys({...image}),['mime_type','data']);
});
test('a long scrolling screenshot keeps its aspect ratio within the long-edge cap',async()=>{
  const bytes=await screenshotPNG(600,6000);
  const image=await readImage(attachment(bytes,'image/png'));
  const {width,height}=await sharp(Buffer.from(image.data,'base64')).metadata();
  assert.ok(height<=MAX_LONG_EDGE);assert.equal(Math.round(height/width),10);
});
test('images under the limit are stored untouched, and format checks still run before decoding',async()=>{
  const small=await sharp({create:{width:40,height:40,channels:3,background:'#c00'}}).png().toBuffer();
  const image=await readImage(attachment(small,'image/png'),undefined,async()=>assert.fail('no recompression'));
  assert.equal(image.data,small.toString('base64'));assert.equal(image.info.converted,null);
  const big=await screenshotPNG(1290,2796);
  await assert.rejects(readImage(attachment(big,'image/webp'),undefined,async()=>assert.fail('checked first')),{code:'invalid_image_bytes'});
  await assert.rejects(readImage(attachment(big,'image/png'),undefined,async()=>{throw new Error('decoder');}),e=>e.code==='recompress_failed'&&e.image_info.original_bytes===big.length);
});
test('a failed image records its reason and sizes in reply diagnostics',async()=>{
  const written=[];
  const store={receive:async()=>'conversation',claimAI:async()=>true,imageStatus:async()=>{},prepareAI:async()=>{},finish:async()=>{},replyDiagnostics:async(op,data)=>written.push(data)};
  await receiveInInbox({message:{id:'image',attachments:[{id:'fake'}]}},{AI_ENABLED:'true'},
    {store,loadImages:async()=>{throw Object.assign(new Error('Image download failed'),{image_reason:'image_too_large',image_info:{original_bytes:30000000}});},generate:async()=>assert.fail(),send:async()=>{},alert:async()=>false});
  const final=written.at(-1);
  assert.equal(final.error_class,'image');
  assert.deepEqual(final.image_failure,{stage:'download',reason:'image_too_large',info:{original_bytes:30000000}});
});
