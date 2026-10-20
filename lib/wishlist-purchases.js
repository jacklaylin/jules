import {loadReceipts,receiptWrite,wishlistEvidence} from './evidence.js';
import {applyReceiptRecord} from './receipt-extraction.js';
import {groupWishlist} from './wishlist.js';
import {WISHLIST_PURCHASE_ORIGIN} from './connected-sources.js';

// "I bought this" on a saved item (PRD wishlist → wardrobe). The person says they bought it, from the
// wishlist page, the remove toast or a text. Three things follow:
//  - the wishlist entries carry the mark, so the item moves to the Bought filter (hidden from All);
//  - its price alert stops;
//  - two evidence rows under one source id: a wishlist_event (the conversion record) and a
//    purchase_event, so the wardrobe shows the item like any other purchase.
// Undo deletes both rows and clears the mark; an `unbought` wishlist event keeps the audit trail.
// Nothing here is a verified fact about price or stock: the price stays unknown until a receipt shows it.
export const PURCHASE_ORIGIN=WISHLIST_PURCHASE_ORIGIN;
export const PURCHASE_VIA=['wishlist_page','remove_toast','chat'];
export const purchaseSource=group=>'wishlist:'+group;
const clean=(value,max)=>typeof value==='string'&&value.trim()?value.trim().replace(/\s+/g,' ').slice(0,max):null;

export function boughtMark({store=null,size=null,via='wishlist_page'}={},at=new Date().toISOString()){
 return {at,store:clean(store,80),size:clean(size,40),via:PURCHASE_VIA.includes(via)?via:'wishlist_page'};
}

// The purchase as the wardrobe reads it: one validated record on the shared receipt path. Only what the
// person said is filled in; everything else stays unknown.
export function purchaseRecord(item,mark){
 const source=purchaseSource(item.id);
 return {event_id:source,kind:'purchased',source_id:source,at:Date.parse(mark.at),evidence:'Marked as bought from the wishlist',basis:'user_statement',category:null,
  values:{merchant:mark.store,order_reference:null,product:item.name??null,sku:null,brand:null,color:null,size_label:mark.size,size_system:null,quantity:null,units_per_pack:null},
  item_id:'wishlist-item-'+item.id};
}
export function purchaseEvidence(item,mark){
 const source={type:mark.via==='chat'?'message':'wishlist_page',id:purchaseSource(item.id)};
 return [
  {id:`${PURCHASE_ORIGIN}:purchase:${item.id}`,kind:'purchase_event',origin:PURCHASE_ORIGIN,source,data:purchaseRecord(item,mark),recorded_by:'user'},
  {id:`${PURCHASE_ORIGIN}:bought:${item.id}:${mark.at}`,kind:'wishlist_event',origin:PURCHASE_ORIGIN,source,recorded_by:'user',
   data:{action:'bought',item_id:item.id,name:item.name??null,urls:(item.links??[]).map(l=>l.url).slice(0,5),store:mark.store,size:mark.size,via:mark.via,saved_at:item.sent_at??null,at:mark.at}},
 ];
}

const CLAIM_WAITS=[300,700];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Applies the change to the purchase history under its lease, so the cached summary the agent reads is
// rebuilt with it. While an import holds the lease, the evidence is written directly and the import's
// next write rebuilds the summary.
async function writeHistory(store,owner,{add=[],remove=null},{pause=wait}={}){
 if(!await store.gmailImport(owner))await store.ensureGmailImport(owner);
 let row=await store.claimGmailImport(owner);
 for(const ms of CLAIM_WAITS){if(row)break;await pause(ms);row=await store.claimGmailImport(owner);}
 if(!row){
  if(remove)await store.deleteEvidence(owner,PURCHASE_ORIGIN,remove);
  if(add.length)await store.recordEvidence(owner,add);
  console.log(JSON.stringify({event:'wishlist_purchase_history_busy'}));
  return;
 }
 try{
  if(remove)await store.deleteEvidence(owner,PURCHASE_ORIGIN,remove);
  const receipts=await loadReceipts(store,owner,row),state=structuredClone(receipts.state);
  for(const e of add)if(e.kind==='purchase_event')applyReceiptRecord(state,[],e.data);
  const write=receiptWrite(row.data,receipts,state,add);
  if(!await store.finishGmailImport(owner,row.revision,write.data,row.token_ciphertext,write.evidence))throw Error('Purchase history write conflict');
 }catch(error){
  await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});
  throw error;
 }
}

// item: a group from groupWishlist (with entries). A repeat is a no-op, so retries are safe.
export async function markBought(store,owner,item,details,options){
 if(item.bought)return {changed:false,bought:item.bought};
 const mark=boughtMark(details);
 await store.disablePriceAlert(owner,item.id);
 await store.updateWishlistEntries(owner,item.entries,{wishlist_bought:mark,wishlist_removed:false});
 await writeHistory(store,owner,{add:purchaseEvidence(item,mark)},options);
 console.log(JSON.stringify({event:'wishlist_bought',via:mark.via,store_named:Boolean(mark.store),size_named:Boolean(mark.size)}));
 return {changed:true,bought:mark};
}
export async function markNotBought(store,owner,item,options){
 if(!item.bought)return {changed:false};
 await writeHistory(store,owner,{remove:purchaseSource(item.id)},options);
 await store.updateWishlistEntries(owner,item.entries,{wishlist_bought:null});
 await store.recordEvidence(owner,[wishlistEvidence('unbought',item)]);
 console.log(JSON.stringify({event:'wishlist_unbought'}));
 return {changed:true};
}
export async function wishlistGroup(store,owner,group){
 return groupWishlist(await store.wishlistEntries(owner,{includeRemoved:true})).find(g=>g.id===group)??null;
}

// The chat tool (record_wishlist_purchase): the agent names saved items; code checks they are the
// person's and reports only what persisted.
export async function wishlistPurchaseChat(store,owner,operation,ids,details={}){
 const groups=groupWishlist(await store.wishlistEntries(owner,{includeRemoved:true}));
 const targets=groups.filter(g=>ids.includes(g.id));
 if(!targets.length)return 'i couldn’t find that item in your wishlist. which one do you mean?';
 const done=[],failed=[];
 for(const item of targets){
  try{
   const result=operation==='not_bought'?await markNotBought(store,owner,item):await markBought(store,owner,item,{...details,via:'chat'});
   done.push({item,changed:result.changed});
  }catch{console.log(JSON.stringify({event:'wishlist_purchase_chat_failed',operation}));failed.push(item);}
 }
 const names=list=>list.map(e=>(e.item??e).name).join('; ');
 const lines=[];
 if(operation==='not_bought'){
  if(done.length)lines.push(`${names(done)} ${done.length===1?'is':'are'} back on the wishlist and out of the wardrobe. price alerts stay off until turned on again.`);
 }else if(done.length){
  lines.push(`marked ${names(done)} as bought: moved to Bought on the wishlist and added to the wardrobe. price alerts for ${done.length===1?'it':'them'} are off.`+
   (details.store?'':' the store wasn’t recorded.')+' the price stays unknown unless a receipt shows it.');
 }
 if(failed.length)lines.push(`couldn’t update ${names(failed)} just now. nothing changed for ${failed.length===1?'it':'them'}; try again in a minute.`);
 return lines.join('\n');
}
