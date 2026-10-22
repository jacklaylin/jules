import {outfitPhotosFact} from './outfit-photos.js';
import {likedItemsFact} from './liked-items.js';
import {wishlistFact,brandTasteFact} from './brand-taste.js';

// The user context layer: everything Jules knows about a person, read in one place so every search,
// recommendation and ranking works from the same picture. It is assembled fresh for each request
// from its sources, so a new receipt, a closet edit or a newly liked item counts on the next message.
// See USER-CONTEXT.md.
//
// Sources, strongest first:
//   stated: facts the person said in chat or the signup form (taste_profiles, lib/memory.js)
//   shopping_history: purchases from Gmail, Shop and order screenshots, with closet edits applied
//   wardrobe: what they own now by category, from the wardrobe view, item tags and photo tags
//   liked_items: screenshots of their likes and shown options they liked
//   wishlist: items they saved to their wishlist
//   outfit_photos: outfit photos kept for the style reading
//   brand_taste: one reading of the brands they like, across what they said, bought, saved and liked
// Derived sources are soft evidence below anything the person states.
export const DERIVED_FIELDS=['shopping_history','wardrobe','outfit_photos','liked_items','wishlist','brand_taste'];
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
  // With a brand_taste reading, the raw brand statements are inside it with their dates; shown again on
  // their own they read as a fixed favourites list (October 22).
  const combined=facts.some(f=>!f.deleted&&f.field==='brand_taste');
  return facts.filter(f=>!f.deleted&&fields.includes(f.field)&&!(combined&&f.field==='brand')).map(({field,key,value})=>({field,key,value}));
}

// Reads every source for one person. Each derived source degrades to empty on failure, so a broken
// source never blocks a reply. facts: stated facts plus a compact summary of each derived source.
// withPurchaseDetail swaps the purchase summary for per-item purchases (used by ranking only).
export async function readUserContext(store,owner,env,{log=console.log,purchases=true,inputs=false}={}){
  // With inputs, the raw rows read are returned too (taste coverage and the early read count from them), every
  // source is read whatever the feature flags say, and only a raw source that fails is logged, as coverage logs it.
  const optional=(label,read,raw=null)=>Promise.resolve().then(read).catch(()=>{if(!inputs)log(JSON.stringify({event:'context_read_failed',source:label}));else if(raw)log(JSON.stringify({event:'coverage_source_failed',source:raw}));return null;});
  const on=flag=>inputs||env[flag]==='true';
  // The purchase-history row is large and several sources read it: fetched once per call.
  const shared=Object.create(store);
  if(store.gmailImport){let row;shared.gmailImport=id=>id===owner?(row??=store.gmailImport(id)):store.gmailImport(id);}
  const likesOn=inputs?Boolean(store.evidence):env.MEMORY_ENABLED==='true'&&Boolean(store.evidence&&store.recordEvidence&&store.deleteEvidence);
  const [profile,history,closetSummary,styleSources,styleSession,chat,wishlist,row]=await Promise.all([
    on('MEMORY_ENABLED')&&store.profile?(inputs?optional('profile',()=>store.profile(owner),'profile'):store.profile(owner)):null,
    purchases&&on('GMAIL_IMPORT_ENABLED')&&store.purchaseHistory?optional('purchase_history',()=>shared.purchaseHistory(owner)):null,
    // A compact closet summary (lib/closet-summary.js), soft context for the stylist and search. Loaded on
    // first use: it reads the wardrobe, which imports modules that import this one.
    purchases&&on('GMAIL_IMPORT_ENABLED')&&store.gmailImport?optional('wardrobe',async()=>{const {readClosetSummary}=await import('./closet-summary.js');return readClosetSummary(shared,owner);}):null,
    // Outfit photos already kept, so the agent never says it has none when it does.
    on('STYLE_ENABLED')&&store.styleSources?optional('outfit_photos',()=>store.styleSources(owner),'outfit_photos'):null,
    on('STYLE_ENABLED')&&store.styleSession?optional('outfit_photos',()=>store.styleSession(owner),'style_session'):null,
    // Liked items kept as taste signals (screenshots of likes, options the user liked); never wishlist items.
    likesOn?optional('liked_items',()=>store.evidence(owner,'chat'),'liked_items'):null,
    // Wishlist saves: what they want (USER-CONTEXT.md step 2).
    on('WISHLIST_ENABLED')&&store.wishlistEntries?optional('wishlist',()=>store.wishlistEntries(owner),'wishlist'):null,
    inputs&&store.gmailImport?optional('purchases',()=>shared.gmailImport(owner),'purchases'):null,
  ]);
  const outfits=styleSources&&styleSession?outfitPhotosFact(styleSources,styleSession):null;
  const liked=chat?likedItemsFact(chat):null;
  // The agent and search see a compact purchase summary; per-item detail goes only to discovery ranking.

  const closet=closetSummary?(await import('./closet-summary.js')).closetFact(closetSummary):null;
  const saved=wishlistFact(wishlist??[]);
  const taste=brandTasteFact({facts:profile?.facts??[],purchases:history?.summary?.top_brands??[],closet:closetSummary?.brands??null,wishlist:wishlist??[],liked:liked?JSON.parse(liked.value).brands??[]:[]});
  // With brand_taste, the purchase summary leaves out its top brands: the same counts are in brand_taste, kept-only
  // and with kinds of items, so the agent reads each brand once (October 22: about 4,600 tokens of profile per turn).
  const {top_brands:_top,...withoutBrands}=history?.summary??{};
  const summary=history?.summary?[{field:'shopping_history',key:'summary',value:JSON.stringify(taste?withoutBrands:history.summary),basis:'inferred'}]:[];
  // A summary built from receipts because its saved copy was missing or older is saved for the next message.
  if(history?.rebuilt&&history.summary||closetSummary?.rebuilt)import('./closet-summary.js').then(m=>m.refreshContextCaches(store,owner)).catch(()=>{});
  const facts=[...(profile?.facts??[]),...summary,...(closet?[closet]:[]),...(outfits?[outfits]:[]),...(liked?[liked]:[]),...(saved?[saved]:[]),...(taste?[taste]:[])];
  if(!inputs)log(JSON.stringify({event:'user_context',stated:(profile?.facts??[]).filter(f=>!f.deleted).length,purchases:history?.items??0,wardrobe:closet?JSON.parse(closet.value).items:0,outfit_photos:Boolean(outfits),liked_items:Boolean(liked),wishlist:saved?JSON.parse(saved.value).items:0,brand_taste:taste?JSON.parse(taste.value).brands.length:0}));
  // The raw rows, for taste coverage (lib/coverage.js readTasteInputs).
  const raw=inputs?{profile,row,styleSources,styleSession,chat,wishlist}:undefined;
  return {facts,purchases:history?.items??0,...(raw?{inputs:raw}:{}),
    withPurchaseDetail:async(current=facts)=>[...current.filter(f=>f.field!=='shopping_history'),...(history?await history.detail():[])]};
}

// What the purchase-import questions read about the person (USER-CONTEXT.md step 3): the layer without its
// purchase sources, since the import being read is the purchases. The profile is always read here, as it
// was before the layer, whatever MEMORY_ENABLED says.
export const contextForImport=(store,owner,env)=>readUserContext(store,owner,{...env,MEMORY_ENABLED:'true'},{purchases:false,log:()=>{}}).then(c=>c.facts);

// What Jules knows about a person, for the owner's Admin view (USER-CONTEXT.md step 4): how much each source
// gave, the brand reading, and the compact summaries the stylist and search read. Read-only.
export function contextReport({facts=[],purchases=0}={}){
  const derived=field=>{const f=facts.find(x=>!x.deleted&&x.field===field);try{return f?JSON.parse(f.value):null;}catch{return null;}};
  const wardrobe=derived('wardrobe'),wishlist=derived('wishlist'),liked=derived('liked_items'),taste=derived('brand_taste');
  const stated=facts.filter(f=>!f.deleted&&!derivedFact(f));
  return {
    sources:{stated:stated.length,purchases,wardrobe:wardrobe?.items??0,wishlist:wishlist?.items??0,liked:liked?.items??0,outfit_photos:Boolean(derived('outfit_photos'))},
    brands:taste?.brands??[],
    wardrobe:(wardrobe?.groups??[]).map(g=>({group:g.group,items:g.items,types:typeof g.types==='string'?g.types:null})),
    wishlist:wishlist?.recent??[],
    liked:liked?.recent??[],
  };
}
