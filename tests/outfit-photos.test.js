import test from 'node:test';
import assert from 'node:assert/strict';
import {keepOutfitPhotos,outfitSourceId,validateReading,outfitReading,OUTFIT_ASK} from '../lib/outfit-photos.js';
import {profileText,sendProfile,announceImport,profileAfterOutfits} from '../lib/receipt-notifications.js';
import {runGmailStep} from '../lib/gmail-worker.js';
import {generateReply} from '../lib/ai.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {agentTurn,tool,toolNames,isAgentRequest,toolOutputs} from './helpers/agent.js';

const owner='owner';
const prepare=async input=>({kind:input.kind,occasion:'',note:'',mime_type:'image/jpeg',data:input.data});
// The style store as the database keeps it: a revision lock, sources, and whether a write cleared evidence.
function styleStore({report=null}={}){
 const s={revision:0,data:{notes:'',tone:'balanced',report},sources:[],writes:[]};
 return Object.assign(s,{styleSession:async()=>({revision:s.revision,data:structuredClone(s.data)}),
  styleSources:async()=>s.sources.map(({data,...rest})=>rest),styleSource:async(o,id)=>s.sources.find(x=>x.id===id)??null,
  writeStyle:async(o,revision,data,{source=null,clear=false}={})=>{if(revision!==s.revision)return false;s.writes.push({clear,source:Boolean(source)});
   if(source){if(s.sources.some(x=>x.id===source.id))throw Error('duplicate key');s.sources.push(source);}s.data=data;s.revision++;return true;}});
}
const photo=n=>({mime_type:'image/jpeg',data:Buffer.from('photo'+n).toString('base64')});

test('texted outfit photos are kept privately once each, in the same store as /style uploads',async()=>{
 const store=styleStore();
 const first=await keepOutfitPhotos({store,owner,messageId:'m1',images:[photo(1),photo(2)],prepare});
 assert.equal(first.added,2);assert.equal(first.total,2);
 assert.ok(store.sources.every(s=>s.kind==='outfit'&&s.note===''&&s.occasion===''),'nothing visible is invented for the photo');
 assert.equal(store.sources[0].id,outfitSourceId(owner,'m1',0));
 const replay=await keepOutfitPhotos({store,owner,messageId:'m1',images:[photo(1),photo(2)],prepare});
 assert.equal(replay.added,0,'a replayed delivery keeps nothing twice');assert.equal(store.sources.length,2);
 assert.ok(store.data.consent_at&&store.data.texted_outfits);
 assert.ok(store.writes.every(w=>!w.clear),'no earlier /style reading, so no evidence is retired');
 const none=await keepOutfitPhotos({store,owner,messageId:'m2',images:[],prepare});assert.equal(none.added,0);
});
test('adding a photo retires an earlier /style reading, as an upload there does',async()=>{
 const store=styleStore({report:{status:'confirmed'}});
 await keepOutfitPhotos({store,owner,messageId:'m1',images:[photo(1)],prepare});
 assert.deepEqual(store.writes,[{clear:true,source:true}]);assert.equal(store.data.report,null);
});
test('a busy style session is retried, and gives up rather than looping',async()=>{
 const store=styleStore(),write=store.writeStyle;let conflicts=1;
 store.writeStyle=async(...a)=>conflicts-->0?false:write(...a);
 assert.equal((await keepOutfitPhotos({store,owner,messageId:'m1',images:[photo(1)],prepare})).added,1);
 store.writeStyle=async()=>false;
 await assert.rejects(keepOutfitPhotos({store,owner,messageId:'m2',images:[photo(2)],prepare}),/busy/);
});

test('photo observations must cite photos that were read and stay short, with no prices or links',()=>{
 const read=validateReading({observations:[
  {text:'Mostly navy and grey, layered.',source_ids:['a','b']},
  {text:'wide-leg trousers',source_ids:['zzz']},
  {text:'buys $200 boots',source_ids:['a']},
  {text:'x'.repeat(91),source_ids:['a']},
  {text:'see https://shop.example',source_ids:['a']},
  {text:'relaxed fits',source_ids:[]},
 ]},['a','b']);
 assert.deepEqual(read,[{text:'mostly navy and grey, layered',source_ids:['a','b']}]);
});
test('the outfit reading is off without the style feature and never breaks the summary',async()=>{
 assert.deepEqual(await outfitReading(styleStore(),owner,{}),[]);
 const store=styleStore();store.sources.push({id:'a',kind:'outfit',mime_type:'image/jpeg',data:'x'});
 assert.deepEqual(await outfitReading(store,owner,{STYLE_ENABLED:'true'},{read:async()=>{throw Error('model down');}}),[]);
 const kept=await outfitReading(store,owner,{STYLE_ENABLED:'true'},{read:async sources=>[{text:'lots of denim',source_ids:[sources[0].id]}]});
 assert.deepEqual(kept,[{text:'lots of denim',source_ids:['a']}]);
 assert.deepEqual(store.data.outfit_reading.observations,kept,'the reading is kept with the style session');
});

const buy=(n,v={})=>purchaseEvidence({event_id:`m${n}:purchased`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',values:{merchant:'SSENSE',order_reference:'O'+n,sku:null,brand:'Our Legacy',color:null,size_label:'32',size_system:null,quantity:1,units_per_pack:null,product:'Jeans '+n,...v},item_id:'item-'+n});
const two=[buy(1),buy(2,{brand:'BODE',merchant:'Mr Porter'})];
const stateOf=rows=>projectReceiptEvidence(owner,rows).state;
test('the summary adds what they wear from their photos, and works from photos alone',()=>{
 const both=profileText(stateOf(two),[{text:'lots of washed denim'},{text:'muted earth tones'}]);
 assert.match(both,/from your purchases and outfit photos/);assert.match(both,/brands you buy most: BODE, Our Legacy/);
 assert.match(both,/what you wear: lots of washed denim; muted earth tones/);
 assert.equal(profileText(stateOf(two)),profileText(stateOf(two),[]),'without photos the summary is unchanged');
 assert.match(profileText(stateOf([buy(1)]),[{text:'lots of washed denim'}]),/from your outfit photos:\nlots of washed denim/);
 assert.equal(profileText(stateOf([buy(1)]),[]),null);
});

// The message ledger plus the style store, for the order of texts after an import.
function ledger({asked=true,photos=0,questions=[]}={}){
 const store=styleStore(),operations=new Map(),sent=[];
 for(let i=0;i<photos;i++)store.sources.push({id:'p'+i,kind:'outfit',mime_type:'image/jpeg',data:'x'});
 if(asked)operations.set(`gmail:${owner}:outfits:s1`,{status:'sent'});
 return Object.assign(store,{sent,operations,gmailImport:async()=>({data:{job:{status:'ready',started_at:'s1'},questions}}),evidence:async()=>two,operation:async k=>operations.get(k),
  conversation:async()=>({id:owner,line:'l',sender_id:'p'}),reserve:async(o,k,body)=>{if(operations.has(k))return false;operations.set(k,{status:'sending',body});return true;},
  finish:async(k,status)=>{operations.get(k).status=status;},send:async(d,body)=>{sent.push(body);}});
}
const env={STYLE_ENABLED:'true'};
const reading=async(store)=>store.sources.length?[{text:'mostly black',source_ids:[store.sources[0].id]}]:[];
test('after asking for outfit photos, the summary waits for five before it is sent',async()=>{
 const store=ledger({photos:2});
 await announceImport(store,owner,env,store.send);
 assert.equal(store.sent.length,1,'only the completion text: the summary waits for photos');
 assert.equal(await sendProfile(store,owner,env,store.send,null,{reading}),null);
 for(let i=2;i<5;i++)store.sources.push({id:'p'+i,kind:'outfit',mime_type:'image/jpeg',data:'x'});
 await sendProfile(store,owner,env,store.send,null,{reading});
 assert.equal(store.sent.length,2);assert.match(store.sent[1],/what you wear: mostly black/);
 assert.equal(await sendProfile(store,owner,env,store.send,null,{reading:()=>assert.fail('read once')}),null,'sent once, without reading the photos again');
});
test('the 24-hour fallback sends the summary with whatever photos came',async()=>{
 const store=ledger({photos:1});store.operations.set(`gmail:${owner}:ready:s1`,{status:'sent'});
 await sendProfile(store,owner,env,store.send,null,{reading,force:true});
 assert.match(store.sent[0],/what you wear: mostly black/);
});
test('without a photo request (or the style feature) the summary is not held',async()=>{
 let store=ledger({asked:false});await announceImport(store,owner,env,store.send);assert.equal(store.sent.length,2);
 store=ledger({photos:0});await announceImport(store,owner,{},store.send);assert.equal(store.sent.length,2);
});
test('kept photos send the waiting summary only when no question is open',async()=>{
 let store=ledger({photos:5,questions:[{id:'q1',status:'open',question:'Q?'}]});store.operations.set(`gmail:${owner}:ready:s1`,{status:'sent'});
 assert.equal(await profileAfterOutfits(store,owner,{},store.send),null);assert.equal(store.sent.length,0);
 store=ledger({photos:5});store.operations.set(`gmail:${owner}:ready:s1`,{status:'sent'});
 await profileAfterOutfits(store,owner,{},store.send);assert.equal(store.sent.length,1);
});

test('the first import asks for outfit photos in its own text when the style store is on',async()=>{
 const run=async env=>{let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',data:{job:{status:'listing',started_at:'s'}}};const notes=[];
  const store={claimGmailImport:async()=>structuredClone(row),gmailImport:async()=>structuredClone(row),finishGmailImport:async(o,r,data,token)=>{row={...row,data,token_ciphertext:token};return true;},evidence:async()=>[],profile:async()=>({facts:[]})};
  await runGmailStep(owner,store,env,{},{step:async r=>r,notify:async(s,o,e,stage,body)=>{notes.push([stage,body]);return {status:'sent'};},schedule:()=>{}});return notes;};
 const on=await run({STYLE_ENABLED:'true'});
 assert.deepEqual(on.map(n=>n[0]),['started:s','outfits:s']);assert.equal(on[1][1],OUTFIT_ASK);assert.ok(!/while you wait/.test(on[0][1]));
 assert.deepEqual((await run({})).map(n=>n[0]),['started:s']);
});

// The agent decides the photos are the user's outfits; code only keeps the images it was given.
test('the agent can keep outfit photos instead of searching, and only when photos are present',async()=>{
 const kept=[];let offered,told;
 const memory={images:[photo(1),photo(2)],imageReferences:[],outfitPhotosAction:async(images,ref)=>{kept.push({count:images.length,ref});return 'Kept 2 outfit photos (2 so far).';}};
 const fetcher=async(url,options)=>{
  if(!isAgentRequest(options))throw Error('unexpected');
  if(!toolOutputs(options).length){offered=toolNames(options);return agentTurn(tool('add_outfit_photos',{image_message_id:null}));}
  told=toolOutputs(options)[0];return agentTurn(tool('conversation_reply',{response:'got them, love the layering. send a few more if you have them.'}));
 };
 const body=await generateReply([{direction:'inbound',status:'received',body:'[Inspiration images]'}],{OPENAI_API_KEY:'test'},fetcher,memory);
 assert.ok(offered.includes('add_outfit_photos'));assert.deepEqual(kept,[{count:2,ref:null}]);
 assert.equal(told.status,'done');assert.match(body,/got them/);
 let names;
 await generateReply([{direction:'inbound',status:'received',body:'hi'}],{OPENAI_API_KEY:'test'},async(url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'hey'}));},{outfitPhotosAction:async()=>assert.fail()});
 assert.ok(!names.includes('add_outfit_photos'),'no photos, no tool');
});
