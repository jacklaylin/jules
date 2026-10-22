import {readUserContext} from './user-context.js';
import {readClosetSummary,CLOSET_VERSION} from './closet-summary.js';
import {isLiked} from './liked-items.js';

// The user context layer (lib/user-context.js) as of one turn, for replays (FROZEN-EVALS.md, the chat simulator).
// A frozen case keeps the raw sources the layer reads, compact, and a replay feeds them back through the same
// readUserContext, so the turn sees the derived facts prod built (purchases, wardrobe, liked items, wishlist and
// the brand_taste reading made from all of them) and not only stated facts.

const text=value=>typeof value==='string'?value.trim():'';
// A wishlist save with only what the layer reads: brand, name and description (the tag's fingerprint is made
// from them, lib/wishlist-tag-key.js), when it was saved, whether it was bought, and its tag.
const savedItem=e=>({item_id:e.item_id??null,url:e.url??null,brand:e.brand??null,name:e.name??null,...(e.display_name?{display_name:e.display_name}:{}),
  ...(text(e.description??e.item_description)?{description:text(e.description??e.item_description).slice(0,300)}:{}),
  messages:{created_at:e.messages?.created_at??null},...(e.bought===true||e.bought==='true'?{bought:true}:{}),...(e.tag?{tag:{group:e.tag.group??null,fp:e.tag.fp??null}}:{})});

// The sources as of `before` (an ISO time): wishlist saves and liked items made before it. The purchase summary
// and the closet are aggregates read as they are now (receipts cannot be rolled back to a date). Each source
// degrades to empty on failure. The closet's per-piece list is left out: only discovery ranking reads it.
export async function captureContext(store,owner,{before=null,entries=null}={}){
  const by=at=>!before||!at||at<=before;
  const [wishlist,history,closet,evidence]=await Promise.all([
    entries??(store.wishlistEntries?store.wishlistEntries(owner).catch(()=>[]):[]),
    store.purchaseHistory?store.purchaseHistory(owner).catch(()=>null):null,
    store.gmailImport?readClosetSummary(store,owner).catch(()=>null):null,
    store.evidence?store.evidence(owner,'chat').catch(()=>[]):[],
  ]);
  const {rebuilt:_r,v:_v,owned:_owned,...summary}=closet??{};
  return {
    wishlist:(wishlist??[]).filter(e=>by(e.messages?.created_at)).map(savedItem),
    purchases:history?.summary??null,
    closet:closet?summary:null,
    liked:(evidence??[]).filter(r=>isLiked(r)&&by(r.data?.at)).map(r=>r.data??{}),
  };
}

// The purchase-history row the layer reads the closet from (lib/closet-summary.js readClosetSummary).
export const closetRow=closet=>{if(!closet)return null;const {rebuilt:_r,...summary}=closet;return {data:{closet_summary:{...summary,v:CLOSET_VERSION}}};};

// A read-only store serving a snapshot: the stated facts and the captured sources.
export function snapshotStore(facts=[],snapshot={}){
  const s=snapshot??{};
  return {
    profile:async()=>({facts}),
    purchaseHistory:async()=>({items:s.purchases?.items??0,summary:s.purchases?.items?s.purchases:null,detail:async()=>[]}),
    gmailImport:async()=>closetRow(s.closet),
    evidence:async()=>(s.liked??[]).map((data,n)=>({id:`liked:replay:${n}`,data})),
    recordEvidence:async()=>{},deleteEvidence:async()=>{},
    wishlistEntries:async()=>s.wishlist??[],
  };
}
// Every source the snapshot holds is read; outfit photos are not captured.
const SOURCES={MEMORY_ENABLED:'true',GMAIL_IMPORT_ENABLED:'true',WISHLIST_ENABLED:'true',STYLE_ENABLED:'false'};

// The facts a replayed turn sees: stated facts plus the derived facts readUserContext builds from the snapshot.
// A case frozen before snapshots (no context) still goes through the layer, so its stated brands read as brand_taste as in prod.
export async function replayFacts(facts=[],snapshot=null){
  return (await readUserContext(snapshotStore(facts,snapshot),'replay',SOURCES,{log:()=>{}})).facts;
}
