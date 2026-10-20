import {outfitPhotosFact} from './outfit-photos.js';
import {likedItemsFact} from './liked-items.js';

// The user context layer: everything Jules knows about a person, read in one place so every search,
// recommendation and ranking works from the same picture. It is assembled fresh for each request
// from its sources, so a new receipt, a closet edit or a newly liked item counts on the next message.
// See USER-CONTEXT.md.
//
// Sources, strongest first:
//   stated: facts the person said in chat or the signup form (taste_profiles, lib/memory.js)
//   shopping_history: purchases from Gmail, Shop and order screenshots, with closet edits applied
//   liked_items: screenshots of their likes and shown options they liked
//   outfit_photos: outfit photos kept for the style reading
// Derived sources are soft evidence below anything the person states.
export const DERIVED_FIELDS=['shopping_history','outfit_photos','liked_items'];
export const derivedFact=f=>DERIVED_FIELDS.includes(f.field);

// The one taste view. Every consumer that weighs taste reads these fields, so a new source added
// here reaches the stylist, search and ranking together instead of one at a time.
export const TASTE_VIEW_FIELDS=['brand','category','style','inspiration','fit','avoid','occasion','owned','store','retailer','budget','spending',...DERIVED_FIELDS];
// Who the person is, beside their taste: the stylist reads these to aim directions at the right department and fit.
export const PERSON_FIELDS=['shopping_range','gender','size'];

// The person's taste as compact field/key/value rows. A request for someone else uses none of it:
// the person's own taste must not steer a gift.
export function tasteView(facts=[],{forSomeoneElse=false,person=false}={}){
  if(forSomeoneElse)return [];
  const fields=person?[...TASTE_VIEW_FIELDS,...PERSON_FIELDS]:TASTE_VIEW_FIELDS;
  return facts.filter(f=>!f.deleted&&fields.includes(f.field)).map(({field,key,value})=>({field,key,value}));
}

// Reads every source for one person. Each derived source degrades to empty on failure, so a broken
// source never blocks a reply. facts: stated facts plus a compact summary of each derived source.
// withPurchaseDetail swaps the purchase summary for per-item purchases (used by ranking only).
export async function readUserContext(store,owner,env,{log=console.log}={}){
  const optional=(label,read)=>read().catch(()=>{log(JSON.stringify({event:'context_read_failed',source:label}));return null;});
  const likesOn=env.MEMORY_ENABLED==='true'&&Boolean(store.evidence&&store.recordEvidence&&store.deleteEvidence);
  const [profile,history,outfits,liked]=await Promise.all([
    env.MEMORY_ENABLED==='true'?store.profile(owner):null,
    env.GMAIL_IMPORT_ENABLED==='true'&&store.purchaseHistory?optional('purchase_history',()=>store.purchaseHistory(owner)):null,
    // Outfit photos already kept, so the agent never says it has none when it does.
    env.STYLE_ENABLED==='true'&&store.styleSources&&store.styleSession?optional('outfit_photos',async()=>outfitPhotosFact(...await Promise.all([store.styleSources(owner),store.styleSession(owner)]))):null,
    // Liked items kept as taste signals (screenshots of likes, options the user liked); never wishlist items.
    likesOn?optional('liked_items',async()=>likedItemsFact(await store.evidence(owner,'chat'))):null,
  ]);
  // The agent and search see a compact purchase summary; per-item detail goes only to discovery ranking.
  const summary=history?.summary?[{field:'shopping_history',key:'summary',value:JSON.stringify(history.summary),basis:'inferred'}]:[];
  const facts=[...(profile?.facts??[]),...summary,...(outfits?[outfits]:[]),...(liked?[liked]:[])];
  log(JSON.stringify({event:'user_context',stated:(profile?.facts??[]).filter(f=>!f.deleted).length,purchases:history?.items??0,outfit_photos:Boolean(outfits),liked_items:Boolean(liked)}));
  return {facts,purchases:history?.items??0,
    withPurchaseDetail:async(current=facts)=>[...current.filter(f=>f.field!=='shopping_history'),...(history?await history.detail():[])]};
}
