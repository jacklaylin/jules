import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createReceiptFeedback} from '../lib/receipt-feedback.js';
import {wardrobeView} from '../lib/wardrobe.js';
import {suggestionState,needsSuggestion,suggestWardrobePhotos,decideSuggestion,findProductPhoto,WARDROBE_ORIGIN} from '../lib/wardrobe-photos.js';

const OWNER='owner-1';
const env={SERPAPI_API_KEY:'fixture'};
const bought=(id,extra={})=>({id,source_ids:[`gmail:${id}`],brand:'Asics',product:'GT-2160 Sneakers',merchant:'FWRD.com',size_label:'12',color:'Black & Pure Silver',
 source_events:[{kind:'purchased',at:Date.parse('2026-09-08T00:00:00Z'),source_id:`gmail:${id}`}],...extra});
const photo={mime_type:'image/jpeg',data:Buffer.from('jpeg').toString('base64'),width:400,height:400};
// An evidence store holding only the wardrobe origin, as PostgREST returns it (no photo bytes in the list).
function memory(){
 const rows=[];
 return {rows,
  wardrobePhotoEvidence:async()=>rows.map(r=>({id:r.id,item_id:r.data.item_id,asset_url:r.data.asset_url??null,title:r.data.title??null,seller:r.data.seller??null,suggestion_id:r.data.suggestion_id??null,decision:r.data.decision??null})),
  recordEvidence:async(_owner,add)=>{for(const r of add)if(!rows.some(x=>x.id===r.id))rows.push(r);},
 };
}
const found=(url='https://cdn.example/gt2160.jpg')=>async()=>({asset_url:url,title:'ASICS GT-2160 Black Pure Silver',seller:'ASICS',link:'https://www.asics.com/p/1',photo});

test('a found photo is a suggestion until the owner says yes; no makes it go away',async()=>{
 const store=memory();const items=[{id:'i1',photo:false}];
 await suggestWardrobePhotos(store,OWNER,items,{env,find:found()});
 assert.equal(store.rows[0].origin,WARDROBE_ORIGIN);assert.equal(store.rows[0].kind,'photo_observation');
 let s=suggestionState(await store.wardrobePhotoEvidence()).get('i1');
 assert.ok(s.pending);assert.equal(s.confirmed,null);assert.equal(needsSuggestion(s),false,'no second search while one waits');
 await decideSuggestion(store,OWNER,'i1','yes',{items});
 s=suggestionState(await store.wardrobePhotoEvidence()).get('i1');assert.equal(s.confirmed.id,store.rows[0].id);assert.equal(s.pending,null);
 await assert.rejects(decideSuggestion(store,OWNER,'i1','no',{items}),{status:409},'nothing left to answer');
});

test('"not mine" leads to one more search that skips the rejected photo, then stops',async()=>{
 const store=memory();const items=[{id:'i1',photo:false}];const excluded=[];
 const find=async(item,{exclude})=>{excluded.push([...exclude]);return found('https://cdn.example/'+excluded.length+'.jpg')();};
 await suggestWardrobePhotos(store,OWNER,items,{env,find});await decideSuggestion(store,OWNER,'i1','no',{items});
 await suggestWardrobePhotos(store,OWNER,items,{env,find});await decideSuggestion(store,OWNER,'i1','no',{items});
 const result=await suggestWardrobePhotos(store,OWNER,items,{env,find});
 assert.deepEqual(excluded,[[],['https://cdn.example/1.jpg']]);assert.equal(result.searched,0);assert.equal(result.remaining,0);
});

test('nothing found is recorded and tried once more; a search outage records nothing',async()=>{
 const store=memory();const items=[{id:'i1',photo:false},{id:'i2',photo:true}];let calls=0;
 const outage=await suggestWardrobePhotos(store,OWNER,items,{env,find:async()=>{calls++;throw Error('Search source unavailable');}});
 assert.equal(store.rows.length,0);assert.equal(outage.remaining,0);
 await suggestWardrobePhotos(store,OWNER,items,{env,find:async()=>{calls++;return null;}});
 await suggestWardrobePhotos(store,OWNER,items,{env,find:async()=>{calls++;return null;}});
 await suggestWardrobePhotos(store,OWNER,items,{env,find:async()=>{calls++;return null;}});
 assert.equal(calls,3,'outage + two empty searches; an item with an order photo is never searched');
 assert.ok(store.rows.every(r=>r.id.startsWith('photo_search:i1:')));
});

test('each request looks at a few items and reports how many still need a look; it can be switched off',async()=>{
 const store=memory();const items=['a','b','c','d','e'].map(id=>({id,photo:false}));
 const first=await suggestWardrobePhotos(store,OWNER,items,{env,find:found()});assert.equal(first.searched,2);assert.equal(first.remaining,3);
 const off=await suggestWardrobePhotos(memory(),OWNER,items,{env:{...env,WARDROBE_PHOTO_SUGGESTIONS:'false'},find:()=>assert.fail()});assert.equal(off.searched,0);
 const noKey=await suggestWardrobePhotos(memory(),OWNER,items,{env:{},find:()=>assert.fail()});assert.equal(noKey.searched,0);
});

test('answers are checked: only yes or no, only for an item in this wardrobe',async()=>{
 const store=memory();const items=[{id:'i1',photo:false}];
 await suggestWardrobePhotos(store,OWNER,items,{env,find:found()});
 await assert.rejects(decideSuggestion(store,OWNER,'i1','maybe',{items}),{status:400});
 await assert.rejects(decideSuggestion(store,OWNER,'other',  'yes',{items}),{status:404});
});

test('the wardrobe shows the order photo first, a confirmed search photo next, and a pending one only as a suggestion',async()=>{
 const state=createReceiptFeedback(OWNER,[bought('i1'),bought('i2'),bought('i3')],[]);
 const store=memory();const all=['i1','i2','i3'].map(id=>({id,photo:false}));
 await suggestWardrobePhotos(store,OWNER,all,{env,find:found(),limit:3});
 await decideSuggestion(store,OWNER,'i2','yes',{items:all});
 const view=wardrobeView(state,{photos:new Map([['i3','order_email']]),suggestions:suggestionState(await store.wardrobePhotoEvidence())});
 const by=Object.fromEntries(view.items.map(i=>[i.id,i]));
 assert.deepEqual([by.i1.photo,by.i1.suggestion],[false,{seller:'ASICS'}]);
 assert.deepEqual([by.i2.photo,by.i2.photo_source,by.i2.suggestion],[true,'search_confirmed',null]);
 assert.deepEqual([by.i3.photo,by.i3.photo_source,by.i3.suggestion],[true,'order_email',null]);
});

// findProductPhoto against stubbed search, image and model responses.
const png=await sharp({create:{width:300,height:300,channels:3,background:'#111'}}).png().toBuffer();
function fakeWeb(shopping,images=[]){
 const seen=[];
 return {seen,fetcher:async url=>{
  const u=new URL(url);
  if(u.hostname==='serpapi.com'){const engine=u.searchParams.get('engine');seen.push(engine);return new Response(JSON.stringify(engine==='google_shopping'?{shopping_results:shopping}:{images_results:images}));}
  return new Response(png,{headers:{'content-type':'image/png'}});
 }};
}
test('resale listings are never candidates, and a photo needs the model, a blind colour match and a consistent title',async()=>{
 const web=fakeWeb([{title:'ASICS GT-2160 used',source:'eBay - seller123',product_link:'https://www.ebay.com/itm/1',thumbnail:'https://img.example/ebay.jpg'},
  {title:'ASICS GT-2160 Black Pure Silver',source:'ASICS',product_link:'https://www.asics.com/p/1',thumbnail:'https://img.example/asics.jpg'}]);
 const prompts=[];
 const vision=async(instructions,content)=>{prompts.push({instructions,content});
  if(instructions.startsWith('You check product photos'))return {choice:0,model_match:true,reason:'same model'};
  if(instructions.startsWith('Describe only'))return {colours:'black with silver'};
  if(instructions.startsWith('A purchase receipt'))return {verdict:'consistent'};
  return {verdict:'same'};};
 const result=await findProductPhoto(bought('i1'),{env,fetcher:web.fetcher,vision});
 assert.equal(result.asset_url,'https://img.example/asics.jpg');assert.equal(result.seller,'ASICS');assert.equal(result.photo.mime_type,'image/jpeg');
 const pick=prompts[0].content.map(c=>c.text??'').join(' ');assert.ok(!pick.includes('eBay'),'resale never shown to the model');
 const blind=prompts[1].content.map(c=>c.text??'').join(' ');assert.ok(!blind.includes('Pure Silver'),'colour is named without the receipt colour');
});
test('an unsure colour or a contradicting title is no photo; the image search is tried before giving up',async()=>{
 for(const [colour,title] of [['unsure','same'],['consistent','different']]){
  const web=fakeWeb([{title:'ASICS GT-2160',source:'ASICS',product_link:'https://www.asics.com/p/1',thumbnail:'https://img.example/a.jpg'}],[{title:'ASICS GT-2160',source:'FWRD',link:'https://www.fwrd.com/p/2',original:'https://img.example/b.jpg'}]);
  const vision=async instructions=>instructions.startsWith('You check product photos')?{choice:0,model_match:true,reason:''}:instructions.startsWith('Describe only')?{colours:'grey'}:instructions.startsWith('A purchase receipt')?{verdict:colour}:{verdict:title};
  assert.equal(await findProductPhoto(bought('i1'),{env,fetcher:web.fetcher,vision}),null);
  assert.deepEqual(web.seen,['google_shopping','google_images']);
 }
});
test('a pending suggestion is served only as a suggestion; once confirmed it is the item photo',async()=>{
 const {handleWardrobe}=await import('../lib/wardrobe.js');
 const store=memory();const items=[{id:'i1',photo:false}];
 await suggestWardrobePhotos(store,OWNER,items,{env,find:found()});
 Object.assign(store,{purchasePhoto:async()=>null,wardrobeSuggestionPhoto:async(_o,id)=>store.rows.find(r=>r.id===id)?.data});
 const get=async query=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};await handleWardrobe({method:'GET',url:'/api/wishlist?wardrobe=1&'+query,headers:{}},res,{store,env,auth:async()=>({status:200,conversation:OWNER})});return res;};
 assert.equal((await get('photo=i1')).statusCode,404);
 const pending=await get('suggestion=i1');assert.equal(pending.statusCode,200);assert.equal(pending.headers['Content-Type'],'image/jpeg');
 await decideSuggestion(store,OWNER,'i1','yes',{items});
 assert.equal((await get('photo=i1')).statusCode,200);assert.equal((await get('suggestion=i1')).statusCode,404);
});
