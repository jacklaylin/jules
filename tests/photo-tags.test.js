import test from 'node:test';
import assert from 'node:assert/strict';
import {photoToRead,photoFingerprint,unreadPhotos,validPhotoTag,tagWardrobePhotos,withPhotoColours,photoTagStatus,PHOTO_TAG_VERSION} from '../lib/photo-tags.js';
import {tagFingerprint} from '../lib/item-tags.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';

const owner='00000000-0000-4000-8000-000000000001';
const record=(n,values)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1700000000000+n,evidence:`${values.product} M`,category:'clothing',
 values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:'Brand',color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+n});
const viewItem=over=>({id:'item-1',brand:'Brand',product:'Overshirt',color:null,category:'tops',photo:true,photo_source:'order_email',photo_version:'2026-10-15T00:00:00Z:600x800',...over});
const reading=over=>({visible:'clear',color_family:'green',pattern:'solid',fit:'relaxed',silhouette:'Boxy Cropped',fabric:'cotton twill',formality:'casual',details:['chest pockets','Chest pockets','horn buttons'],...over});

test('only photos that are the item’s own qualify, and a search photo’s colour only when the receipt named one',()=>{
 assert.deepEqual(photoToRead(viewItem()),{source:'order_email',version:'2026-10-15T00:00:00Z:600x800',colour:true});
 assert.equal(photoToRead(viewItem({photo_source:'shop_order'})).colour,true);
 // Confirmed searched photo: the blind colour check ran only against a receipt colour.
 assert.equal(photoToRead(viewItem({photo_source:'search_confirmed',photo_version:'photo_suggestion:item-1:0',color:'Olive'})).colour,true);
 assert.equal(photoToRead(viewItem({photo_source:'search_confirmed',photo_version:'photo_suggestion:item-1:0'})).colour,false);
 // A pending suggestion is never the item's photo (wardrobeView leaves photo false), so it is never read.
 assert.equal(photoToRead(viewItem({photo:false,photo_source:null,photo_version:null,suggestion:{version:'photo_suggestion:item-1:0'}})),null);
 assert.equal(photoToRead(viewItem({photo_source:'outfit_crop'})),null);
});

test('the cache is keyed by item and the exact photo it was read from',()=>{
 const a=viewItem(),fp=photoFingerprint(a);
 assert.equal(photoFingerprint(viewItem()),fp);
 // A sharper copy of the order photo is a new version; a new confirmed photo too; another item never shares a key.
 assert.notEqual(photoFingerprint(viewItem({photo_version:'2026-10-15T00:00:00Z:1200x1600'})),fp);
 assert.notEqual(photoFingerprint(viewItem({photo_source:'search_confirmed',photo_version:'photo_suggestion:item-1:1'})),fp);
 assert.notEqual(photoFingerprint(viewItem({id:'item-2'})),fp);
 // A receipt colour added later makes a confirmed searched photo's colour trustworthy: read again.
 const searched=viewItem({photo_source:'search_confirmed',photo_version:'photo_suggestion:item-1:0'});
 assert.notEqual(photoFingerprint({...searched,color:'Olive'}),photoFingerprint(searched));
 const cache={'item-1':{fp,v:PHOTO_TAG_VERSION}};
 assert.deepEqual(unreadPhotos([a,viewItem({id:'item-2'}),viewItem({id:'item-3',photo:false})],cache).map(i=>i.id),['item-2']);
 assert.deepEqual(unreadPhotos([viewItem({photo_version:'new'})],cache).map(i=>i.id),['item-1']);
 assert.deepEqual(photoTagStatus([a,viewItem({id:'item-2'}),viewItem({id:'item-3',photo:false})],cache),{read:1,pending:1,without_photo:1});
});

test('readings keep fixed vocabularies and short phrases; untrusted colour and unknowns are left out',()=>{
 const {tag}=validPhotoTag(viewItem(),reading(),'T');
 assert.deepEqual(tag,{fp:photoFingerprint(viewItem()),v:PHOTO_TAG_VERSION,at:'T',source:'order_email',visible:'clear',color_family:'green',pattern:'solid',fit:'relaxed',
  silhouette:'boxy cropped',fabric:'cotton twill',formality:'casual',details:['chest pockets','horn buttons']});
 const searched=validPhotoTag(viewItem({photo_source:'search_confirmed',photo_version:'s'}),reading()).tag;
 assert.equal(searched.color_family,null);assert.equal(searched.pattern,'solid');
 const vague=validPhotoTag(viewItem(),reading({color_family:'unknown',fit:'unknown',fabric:'a soft brushed heavyweight cotton blend',silhouette:null})).tag;
 assert.equal(vague.color_family,null);assert.equal(vague.fit,null);assert.equal(vague.fabric,null);
 assert.deepEqual(validPhotoTag(viewItem(),reading({pattern:'paisley'})),{tag:null,rejected:'vocabulary'});
 const hidden=validPhotoTag(viewItem(),reading({visible:'not_visible'})).tag;
 assert.equal(hidden.visible,'not_visible');assert.equal(hidden.color_family,undefined);
});

test('photo colour fills only an unknown receipt colour, and only from a current reading',()=>{
 const state=projectReceiptEvidence(owner,[record(1,{product:'Overshirt'}),record(2,{product:'Tee',color:'White'}),record(3,{product:'Jeans'})]).state;
 const [i1,i2,i3]=state.items;
 const text=(i,c)=>({fp:tagFingerprint(i),v:1,item_type:'x',group:'tops',color_family:c,resale:null});
 const tags={'item-1':text(i1,'unknown'),'item-2':text(i2,'white'),'item-3':text(i3,'unknown')};
 const photos={'item-1':{v:PHOTO_TAG_VERSION,color_family:'green'},'item-2':{v:PHOTO_TAG_VERSION,color_family:'grey'},'item-3':{v:PHOTO_TAG_VERSION,color_family:null}};
 const out=withPhotoColours(state,tags,photos);
 assert.equal(out['item-1'].color_family,'green');assert.equal(out['item-1'].color_from,'photo');
 assert.equal(out['item-2'].color_family,'white');assert.equal(out['item-3'].color_family,'unknown');
 assert.equal(withPhotoColours(state,tags,{'item-1':{v:PHOTO_TAG_VERSION+1,color_family:'green'}})['item-1'].color_family,'unknown');
 assert.equal(tags['item-1'].color_family,'unknown');
});

function fixture({photoRows=[],suggestions=[],data={}}={}){
 const rows=[record(1,{product:'Overshirt'}),record(2,{product:'Loafers',color:'Brown'}),record(3,{product:'Tee'}),record(4,{product:'Scarf'})];
 let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',lease_until:null,data:{job:{status:'ready'},sources:[],questions:[],...data}},busy=false;
 const reads=[];
 return {reads,get row(){return row;},set busy(v){busy=v;},
  gmailImport:async()=>structuredClone(row),evidence:async()=>structuredClone(rows),
  purchasePhotos:async()=>photoRows,purchasePhoto:async(o,id)=>{reads.push('order:'+id);return photoRows.some(p=>p.item_id===id)?{mime_type:'image/jpeg',data:'AAAA'}:null;},
  wardrobePhotoEvidence:async()=>suggestions,wardrobeSuggestionPhoto:async(o,id)=>{reads.push('search:'+id);return {mime_type:'image/jpeg',data:'BBBB'};},
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,next,token)=>{if(revision!==row.revision)return false;busy=false;row={...row,data:structuredClone(next),token_ciphertext:token};return true;}};
}
const order=(id,w=600)=>({item_id:id,photo_source:'order_email',width:String(w),height:String(w),version:'2026-10-15T00:00:00Z'});
const env={OPENAI_API_KEY:'test'};

test('reads each qualifying photo once, never a pending suggestion, and keeps the cache across runs',async()=>{
 const store=fixture({photoRows:[order('item-1'),order('item-2')],suggestions:[
  {id:'photo_suggestion:item-3:0',item_id:'item-3',created_at:'2026-10-19'},{id:'photo_decision:item-3:1',item_id:'item-3',suggestion_id:'photo_suggestion:item-3:0',decision:'yes'},
  {id:'photo_suggestion:item-4:0',item_id:'item-4',created_at:'2026-10-19'}]});
 const seen=[],vision=async(prompt,content)=>{seen.push(content[0].text);return reading();};
 const run=await tagWardrobePhotos(store,owner,env,{vision});
 assert.equal(run.read,3);assert.equal(run.remaining,0);
 assert.deepEqual(store.reads.sort(),['order:item-1','order:item-2','search:photo_suggestion:item-3:0']);
 const cache=store.row.data.photo_tags;
 assert.deepEqual(Object.keys(cache).sort(),['item-1','item-2','item-3']);
 assert.equal(cache['item-1'].color_family,'green');
 // Confirmed searched photo for an item whose receipt named no colour: its colour may differ, so none is kept.
 assert.equal(cache['item-3'].source,'search_confirmed');assert.equal(cache['item-3'].color_family,null);
 // The model is told what to look for, never the receipt colour.
 assert.ok(seen.every(t=>!/brown/i.test(t)));
 const again=await tagWardrobePhotos(store,owner,env,{vision:async()=>{throw Error('should not be called');}});
 assert.equal(again.read,0);assert.equal(again.remaining,0);
});

test('a busy history or a model outage loses nothing and leaves the rest for later',async()=>{
 const store=fixture({photoRows:[order('item-1'),order('item-2')]});
 store.busy=true;
 const busy=await tagWardrobePhotos(store,owner,env,{vision:async()=>reading(),pause:async()=>{}});
 assert.equal(busy.busy,true);assert.equal(busy.remaining,2);assert.equal(store.row.data.photo_tags,undefined);
 store.busy=false;
 const down=await tagWardrobePhotos(store,owner,env,{vision:async()=>{throw Object.assign(Error('rate'),{provider_status:429});}});
 assert.equal(down.read,0);assert.equal(down.remaining,2);assert.equal(store.row.data.photo_tags,undefined);
 const later=await tagWardrobePhotos(store,owner,env,{vision:async()=>reading()});
 assert.equal(later.read,2);
});

test('entries for items gone from the history are dropped, and the reading can be switched off',async()=>{
 const store=fixture({photoRows:[order('item-1')],data:{photo_tags:{'item-9':{fp:'x',v:1}}}});
 await tagWardrobePhotos(store,owner,env,{vision:async()=>reading()});
 assert.deepEqual(Object.keys(store.row.data.photo_tags),['item-1']);
 assert.deepEqual(await tagWardrobePhotos(store,owner,{...env,WARDROBE_PHOTO_TAGS:'false'},{vision:async()=>reading()}).then(r=>r.read),0);
});
