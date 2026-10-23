import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {validPieces,validLinks,planPieces,cropPiece,closetFromPhoto,closetAfterOutfits,pieceId,ORIGIN} from '../lib/outfit-closet.js';
import {loadReceipts,receiptWrite} from '../lib/evidence.js';
import {applyReceiptRecord} from '../lib/receipt-extraction.js';
import {wardrobeView,wardrobeEvent,loadWardrobe} from '../lib/wardrobe.js';
import {applyReceiptFeedback} from '../lib/receipt-feedback.js';

const owner='00000000-0000-4000-8000-000000000001';
const shirt={description:'black short-sleeve denim shirt',category:'tops',color:'black',brand:null,box:[0.25,0.25,0.5,0.3]};
const jeans={description:'dark wide-leg jeans',category:'bottoms',color:'dark indigo',brand:null,box:[0.3,0.5,0.4,0.45]};
const sneakers={description:'red suede sneakers with white stripes',category:'shoes',color:'red',brand:null,box:[0.35,0.9,0.3,0.08]};
const crop={mime_type:'image/jpeg',data:'Y3JvcA==',width:400,height:300};

// A store that keeps evidence and the purchase-history row in memory, like the database does.
function fakeStore({photo,history=null}={}){
 const s={_rows:[],history,claims:0};
 return Object.assign(s,{
  gmailImport:async()=>s.history,
  ensureGmailImport:async()=>{s.history??={revision:1,data:{},token_ciphertext:null};},
  claimGmailImport:async()=>(s.claims++,{...s.history}),
  finishGmailImport:async(_o,revision,data,_t,evidence=[])=>{s.history={...s.history,revision:revision+1,data};s._rows.push(...evidence.filter(e=>!s._rows.some(x=>x.id===e.id)));return true;},
  evidence:async(_o,origins)=>s._rows.filter(e=>!origins||origins.includes(e.origin)),
  purchasePhotos:async()=>s._rows.filter(e=>e.kind==='photo_observation').map(e=>({item_id:e.data.item_id,photo_source:e.data.photo_source})),
  purchasePhoto:async(_o,item)=>s._rows.find(e=>e.id==='order_photo:'+item)?.data??null,
  styleSource:async(_o,id)=>id==='photo-1'?{id,kind:'outfit',data:photo}:null,
 });
}
// A purchase already in the history (a receipt), so links have something to point at.
async function withPurchase(store,{id='gmail-shirt',product='La Chemise Denimes',brand='Jacquemus',color='navy',category='tops',photo=false}={}){
 await store.ensureGmailImport(owner);
 const receipts=await loadReceipts(store,owner,store.history),state=structuredClone(receipts.state);
 const record={event_id:'email-1:'+id,kind:'purchased',source_id:'email-1',at:Date.parse('2026-09-01'),evidence:'Order confirmation',
  values:{merchant:'SSENSE',order_reference:'A1',product,sku:null,brand,color,size_label:'M',size_system:null,quantity:1,units_per_pack:null,wardrobe_category:category},item_id:id};
 applyReceiptRecord(state,[],record);
 const evidence=[{id:'gmail:'+record.event_id,kind:'purchase_event',origin:'gmail',source:{type:'gmail_message',id:'email-1'},data:record,recorded_by:'import'}];
 if(photo)evidence.push({id:'order_photo:'+id,kind:'photo_observation',origin:'gmail',source:{type:'gmail_message',id:'email-1'},data:{item_id:id,photo_source:'order_email',...crop},recorded_by:'import'});
 const write=receiptWrite(store.history.data,receipts,state,evidence);
 await store.finishGmailImport(owner,store.history.revision,write.data,null,write.evidence);
}
const outfitPhoto=()=>sharp({create:{width:600,height:900,channels:3,background:'#334455'}}).jpeg().toBuffer().then(b=>b.toString('base64'));

test('pieces need a wardrobe category and a real box inside the photo; brand only when the model read it',()=>{
 const pieces=validPieces({pieces:[
  {description:'  Black Short-Sleeve  Denim Shirt ',category:'tops',color:'Black',brand_text:'',box:[0.25,0.25,0.5,0.3]},
  {description:'jeans',category:'trousers',color:'blue',brand_text:'',box:[0.3,0.5,0.4,0.45]},
  {description:'sneakers',category:'shoes',color:'red',brand_text:'adidas',box:[0.8,0.9,0.4,0.08]},
  {description:'tank',category:'tops',color:'white',brand_text:'',box:[0.4,0.4,0.01,0.1]},
  {description:'cap',category:'accessories',color:'black',brand_text:'The North Face',box:[0.4,0,0.2,0.1]},
 ]});
 assert.deepEqual(pieces.map(p=>p.description),['black short-sleeve denim shirt','cap']);
 assert.equal(pieces[0].brand,null);assert.equal(pieces[0].color,'black');assert.equal(pieces[1].brand,'The North Face');
 assert.equal(validPieces({pieces:Array(9).fill({description:'tee',category:'tops',color:'',brand_text:'',box:[0,0,0.5,0.5]})}).length,6);
});

test('links point only at the person\'s own wardrobe items of the same category, each item once',()=>{
 const wardrobe=[{id:'shirt',category:'tops'},{id:'jeans',category:'bottoms'},{id:'untagged',category:null}];
 const links=validLinks({links:[{piece:0,item_id:'shirt',match:'same'},{piece:1,item_id:'shirt',match:'maybe'},{piece:2,item_id:'jeans',match:'same'},{piece:3,item_id:'someone-else',match:'same'},{piece:4,item_id:'untagged',match:'maybe'},{piece:9,item_id:'jeans',match:'same'}]},
  [shirt,{...shirt,description:'second shirt'},sneakers,jeans,jeans],wardrobe);
 assert.deepEqual(links,[{item_id:'shirt',match:'same'},{item_id:null,match:'none'},{item_id:null,match:'none'},{item_id:null,match:'none'},{item_id:'untagged',match:'maybe'}]);
});

test('a confident match fills a missing photo only; maybe adds the piece and asks; new pieces carry only what the photo shows',()=>{
 const wardrobe=[{id:'shirt',category:'tops',brand:'Jacquemus',product:'La Chemise Denimes',color:'navy',photo:false,source_ids:['email-1']},
  {id:'jeans',category:'bottoms',product:'Wide jeans',photo:true,source_ids:['email-2']},{id:'boots',category:'shoes',product:'Boots',photo:false,source_ids:['email-3']}];
 const plan=planPieces('photo-1',[shirt,jeans,sneakers],[crop,crop,crop],[{item_id:'shirt',match:'same'},{item_id:'jeans',match:'same'},{item_id:'boots',match:'maybe'}],wardrobe,new Set(['jeans']));
 assert.deepEqual(plan.outcome,{added:1,attached:1,asked:0,already:1});
 // The receipt shirt gets the person's crop; the jeans keep their order photo.
 assert.deepEqual(plan.evidence.filter(e=>e.kind==='photo_observation').map(e=>e.data.item_id),['shirt',pieceId('photo-1',2)]);
 assert.ok(plan.evidence.every(e=>e.origin===ORIGIN));
 const [record]=plan.records;
 assert.equal(record.at,null);assert.equal(record.values.merchant,null);assert.equal(record.values.size_label,null);assert.equal(record.values.brand,null);
 assert.equal(record.values.wardrobe_category,'shoes');assert.equal(record.basis,'photo');
 // The question names the wardrobe item first, so "same" folds the new piece into it.
 assert.deepEqual(plan.questions[0].item_ids,['boots',record.item_id]);assert.equal(plan.questions[0].topic,'duplicate');
});

test('a crop is the person\'s own pixels, inside the photo and at most 900px',async()=>{
 const bytes=await sharp({create:{width:2000,height:3000,channels:3,background:'#123456'}}).jpeg().toBuffer();
 const out=await cropPiece(bytes,[0.9,0.9,0.1,0.1]);
 const meta=await sharp(Buffer.from(out.data,'base64')).metadata();
 assert.equal(meta.format,'jpeg');assert.ok(meta.width<=900&&meta.height<=900);assert.equal(out.width,meta.width);
});

test('an outfit photo becomes wardrobe items with crops; the same photo read again changes nothing',async()=>{
 const store=fakeStore({photo:await outfitPhoto()});
 await withPurchase(store);
 let linked=null;
 const result=await closetFromPhoto(store,owner,'photo-1',{},{pieces:async()=>[shirt,jeans,sneakers],
  link:async(pieces,crops,wardrobe)=>{linked=wardrobe.map(i=>i.id);return [{item_id:'gmail-shirt',match:'same'},{item_id:null,match:'none'},{item_id:null,match:'none'}];}});
 assert.deepEqual(linked,['gmail-shirt']);
 assert.deepEqual({added:result.added,attached:result.attached},{added:2,attached:1});
 const {view}=await loadWardrobe(store,owner,{});
 const pieces=view.items.filter(i=>i.from_photo);
 assert.deepEqual(pieces.map(i=>[i.product,i.category,i.bought_at,i.merchant,i.photo_source]).sort(),
  [['dark wide-leg jeans','bottoms',null,null,'your_photo'],['red suede sneakers with white stripes','shoes',null,null,'your_photo']]);
 const bought=view.items.find(i=>i.id==='gmail-shirt');
 assert.equal(bought.from_photo,false);assert.equal(bought.photo_source,'your_photo');assert.equal(bought.merchant,'SSENSE');
 const before=store._rows.length;
 assert.equal((await closetFromPhoto(store,owner,'photo-1',{},{pieces:async()=>assert.fail('Must not read the photo twice'),link:async()=>[]})).skipped,'already_read');
 assert.equal(store._rows.length,before);
});

test('"same item" on a maybe folds the piece into the purchase, which then shows the person\'s crop',async()=>{
 const store=fakeStore({photo:await outfitPhoto()});
 await withPurchase(store);
 const result=await closetFromPhoto(store,owner,'photo-1',{},{pieces:async()=>[shirt],link:async()=>[{item_id:'gmail-shirt',match:'maybe'}]});
 assert.deepEqual({added:result.added,asked:result.asked},{added:1,asked:1});
 let {view,receipts}=await loadWardrobe(store,owner,{});
 assert.equal(view.items.length,2);assert.equal(view.questions[0].topic,'duplicate');assert.match(view.questions[0].question,/jacquemus/i);
 const event=wardrobeEvent(owner,receipts.state,{action:'answer',question_id:view.questions[0].id,answer:'same'});
 const state=applyReceiptFeedback(receipts.state,event),write=receiptWrite(store.history.data,receipts,state);
 await store.finishGmailImport(owner,store.history.revision,write.data,null,write.evidence);
 ({view}=await loadWardrobe(store,owner,{}));
 assert.deepEqual(view.items.map(i=>i.id),['gmail-shirt']);
 assert.equal(view.items[0].photo_source,'your_photo');assert.equal(view.items[0].photo_item,pieceId('photo-1',0));
});

test('a photo with no readable pieces, a missing photo and a switched-off feature change nothing',async()=>{
 const store=fakeStore({photo:await outfitPhoto()});
 assert.deepEqual(await closetFromPhoto(store,owner,'photo-1',{},{pieces:async()=>[],link:async()=>assert.fail()}),{pieces:0});
 assert.equal((await closetFromPhoto(store,owner,'missing',{},{pieces:async()=>assert.fail()})).skipped,'no_photo');
 assert.deepEqual(await closetAfterOutfits(store,owner,{},{photoIds:['photo-1'],read:async()=>assert.fail('off by default')}),[]);
 // On: a failure for one photo is logged and the next is still read; new items are filed into categories.
 let tagged=0;
 const results=await closetAfterOutfits(store,owner,{OUTFIT_CLOSET_ENABLED:'true'},{photoIds:['a','b'],
  read:async(_s,_o,id)=>{if(id==='a')throw Error('model down');return {added:2};},tag:async()=>{tagged++;}});
 assert.deepEqual(results,[{added:2}]);assert.equal(tagged,1);
});

test('the wardrobe view marks photo pieces and keeps them out of purchase-only facts',()=>{
 const state={owner_id:owner,items:[],questions:[],feedback:[]};
 const s=structuredClone(state);
 applyReceiptRecord(s,[],{event_id:'outfit:p:0',kind:'purchased',source_id:'outfit:p',at:null,evidence:'photo',basis:'photo',category:null,
  values:{merchant:null,order_reference:null,product:'white tank',sku:null,brand:null,color:'white',size_label:null,size_system:null,quantity:null,units_per_pack:null,wardrobe_category:'tops'},item_id:'piece'});
 const [item]=wardrobeView(s).items;
 assert.equal(item.from_photo,true);assert.equal(item.bought_at,null);assert.equal(item.category,'tops');
});
