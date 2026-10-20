import {loadReceipts} from './evidence.js';
import {tagFingerprint} from './item-tags.js';
import {PHOTO_TAG_VERSION} from './photo-tags.js';
import {wardrobeView} from './wardrobe.js';

// The closet summary (PRD section 29, October 20, step 2 of learning from the wardrobe): a compact picture
// of what the person owns now, by category, for the stylist and search to aim picks at the closet they
// have. Built from the wardrobe view (no gifts, returns, removed or disputed items), the receipt-text item
// tags and the photo tags. Owning is not wearing or liking, so it is soft context only: never a hard
// filter, never a claim of a preference, and below the current request and anything the person states.
//
// It is a cache on the purchase-history row (data.closet_summary), like history_summary. Any receipt,
// item-tag or photo-tag write drops it; the background photo run rebuilds it, and a reply that finds no
// cached copy builds it in memory.
export const CLOSET_VERSION=1;
export const ABOUT='What they own now, from receipts and item photos. Owning is not wearing or liking.';
const CATEGORY_LIMIT=6;
// Underwear, socks and unfiled items say little about style and would crowd out the rest.
const SKIPPED=new Set(['other','unsorted']);

// Top values with counts, most common first, as one short line ("black 26, white 9"). min: a value must
// recur to count as a pattern of the closet. undefined when nothing qualifies, so the field is left out.
const top=(values,n,min=1)=>{
 const counts=new Map();for(const v of values)if(v)counts.set(v,(counts.get(v)??0)+1);
 const best=[...counts].filter(([,c])=>c>=min).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).slice(0,n);
 return best.length?best.map(([v,c])=>`${v} ${c}`).join(', '):undefined;
};

export function closetSummary(state,itemTags={},photoTags={}){
 const raw=new Map((state.items??[]).map(i=>[i.id,i]));
 const items=wardrobeView(state,{tags:itemTags}).items;
 const groups=new Map();
 let photos=0;
 for(const item of items){
  const source=raw.get(item.id),text=itemTags[item.id],tag=source&&text?.fp===tagFingerprint(source)?text:null;
  const photo=photoTags[item.id]?.v===PHOTO_TAG_VERSION&&photoTags[item.id].visible!=='not_visible'?photoTags[item.id]:null;
  if(photo)photos++;
  const category=item.category??'unsorted';
  if(!groups.has(category))groups.set(category,[]);
  // Receipt text that names a colour wins; the item's own photo fills in where it gave none.
  const textColour=tag?.color_family&&tag.color_family!=='unknown'?tag.color_family:null;
  groups.get(category).push({type:tag?.item_type??null,colour:textColour??photo?.color_family??null,photo});
 }
 const categories=[...groups].filter(([c])=>!SKIPPED.has(c)).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0])).slice(0,CATEGORY_LIMIT).map(([category,list])=>{
  const seen=list.filter(x=>x.photo);
  return {category,items:list.length,
   types:top(list.map(x=>x.type),3),
   colours:top(list.map(x=>x.colour),4),
   // From photos only; a read photo with no clear value adds nothing.
   patterns:top(seen.map(x=>x.photo.pattern),3),
   fits:top(seen.map(x=>x.photo.fit),2),
   silhouettes:top(seen.map(x=>x.photo.silhouette),2,2),
   formality:top(seen.map(x=>x.photo.formality),2),
   details:top(seen.flatMap(x=>x.photo.details??[]),2,2)};
 });
 return {v:CLOSET_VERSION,about:ABOUT,items:items.length,photos_read:photos,categories};
}

// The summary as one derived fact for the user context layer, or null for an empty wardrobe.
export function closetFact(summary){
 if(!summary?.items)return null;
 const {v:_,...value}=summary;
 return {field:'wardrobe',key:'summary',value:JSON.stringify(value),basis:'inferred'};
}

// The cached summary, or one built in memory when a write has dropped it. Never writes.
export async function readClosetSummary(store,owner){
 const row=await store.gmailImport(owner);
 if(!row)return null;
 if(row.data.closet_summary?.v===CLOSET_VERSION)return row.data.closet_summary;
 const {state}=await loadReceipts(store,owner,row);
 return closetSummary(state,row.data.item_tags??{},row.data.photo_tags??{});
}
// Rebuilds the cached summary when a write dropped it (or its version changed); a current one is left alone.
export async function ensureClosetSummary(store,owner){
 const row=await store.gmailImport(owner);
 if(!row||row.data.closet_summary?.v===CLOSET_VERSION)return {status:row?'current':'none'};
 return refreshClosetSummary(store,owner);
}
// Rebuilds the cached summary under the history lock. Best effort: a busy history keeps the in-memory path.
export async function refreshClosetSummary(store,owner){
 const row=await store.claimGmailImport(owner);
 if(!row)return {status:'busy'};
 try{
  const {state}=await loadReceipts(store,owner,row),summary=closetSummary(state,row.data.item_tags??{},row.data.photo_tags??{});
  const saved=await store.finishGmailImport(owner,row.revision,{...row.data,closet_summary:summary},row.token_ciphertext);
  console.log(JSON.stringify({event:'closet_summary_refreshed',saved,items:summary.items,photos_read:summary.photos_read,chars:JSON.stringify(summary).length}));
  return {status:saved?'saved':'busy',summary};
 }catch(error){
  await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});
  throw error;
 }
}
