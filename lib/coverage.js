import {merchantKey} from './receipt-extraction.js';
import {CATEGORY_FOR,CATEGORIES,tagFingerprint} from './item-tags.js';
import {priceRange} from './receipt-notifications.js';
import {personalItems,keptItems} from './style-report.js';
import {readReceipts} from './evidence.js';
import {isLiked} from './liked-items.js';

// How much Jules knows about a person's taste, per dimension (design/cold-start-taste-brief.md).
// Each dimension is known, weak or missing, with the evidence behind it. "Thin" is decided by this
// coverage, never by a receipt count. It is computed fresh from existing sources: no model call, no
// writes, never a belief about the person. Later steps choose interview questions from it.
export const DIMENSIONS=['categories','silhouettes','palette','brands','sizes','stores','price_band','channel'];
export const STATUSES=['known','weak','missing'];
const MAX_IDS=10;

const live=facts=>(facts??[]).filter(f=>f&&!f.deleted);
const factIds=facts=>[...new Set(facts.flatMap(f=>f.evidence_ids??[]))].slice(0,MAX_IDS);
const text=v=>typeof v==='string'?v.trim():'';
// Facet keys named in memory.js TASTE_GUIDE; structured keys, not wording.
const facet=(facts,field,key)=>facts.filter(f=>f.field===field&&f.key===key);
// A fabric like or dislike: the material field, key the fabric. Facts saved October 22 before it was a
// field used a material/<fabric> key under style, fit or avoid, and still count, as does a bare material key.
export const isMaterial=f=>f.field==='material'||(['style','fit','avoid'].includes(f.field)&&/^(material|fabric)(\/|$)/.test(f.key??''));
// A shape note: a fit fact, or style silhouette (silhouette/<garment> when it is about one kind of piece).
export const isShape=f=>!isMaterial(f)&&(f.field==='fit'||(f.field==='style'&&/^silhouette(\/|$)/.test(f.key??'')));
const entry=(dimension,status,{facts=[],items=[],sources={},note})=>({dimension,status,sources,evidence_ids:factIds(facts),item_ids:items.map(i=>i.id).slice(0,MAX_IDS),note});

// A tag counts only while it still matches the item's details (item-tags.js fingerprint).
const tagOf=(item,tags)=>{const t=tags?.[item.id];return t&&t.fp===tagFingerprint(item)?t:null;};
const categoryOf=(item,tags)=>{const g=tagOf(item,tags)?.group;const c=g?CATEGORY_FOR[g]:null;return c&&c!=='other'?c:null;};
// A size fact key is category/system[/brand]. Its category is matched to a wardrobe category when it
// names one (singular or plural); otherwise it is reported under its own name.
function sizeCategory(key){
 const c=text(key).split('/')[0].toLowerCase();
 if(!c)return null;
 return CATEGORIES.find(k=>k===c||k===c+'s'||k.replace(/s$/,'')===c)??CATEGORY_FOR[c]??c;
}

// facts: taste-profile facts. state: receipt state (or null). tags: item tags from the purchase-history row.
// outfits: {kept, reading_photos, observations}. liked: number of liked items kept.
// wishlist: wishlist entries (items the person saved), a brand source since October 22.
export function coverage({facts=[],state=null,tags={},outfits={},liked=0,wishlist=[]}={}){
 const stated=live(facts),items=state?keptItems(personalItems(state)):[];
 const kept=Number(outfits.kept)||0,readPhotos=Number(outfits.reading_photos)||0,observations=Number(outfits.observations)||0;
 const readOutfits=kept>=2&&readPhotos>=2&&observations>0;
 const out=[];

 // Categories: what kinds of things they buy or say they own.
 const categorised=items.filter(i=>categoryOf(i,tags)),categories=new Set(categorised.map(i=>categoryOf(i,tags)));
 const owned=stated.filter(f=>['category','owned'].includes(f.field));
 out.push(entry('categories',(categorised.length>=3&&categories.size>=2)||owned.length>=2?'known':categorised.length||owned.length?'weak':'missing',
  {facts:owned,items:categorised,sources:{purchases:categorised.length,stated:owned.length},note:`${categories.size} categories across ${categorised.length} purchases`}));

 // Silhouettes: how they like things to fit and look. Product names only hint at it.
 const shape=stated.filter(isShape);
 // Fabric likes and dislikes are their own row (person-summary.js), not a silhouette or a look.
 const looks=stated.filter(f=>['style','inspiration'].includes(f.field)&&!shape.includes(f)&&!isMaterial(f));
 const typed=items.filter(i=>tagOf(i,tags)?.item_type);
 out.push(entry('silhouettes',shape.length||readOutfits?'known':kept||looks.length||liked||typed.length?'weak':'missing',
  {facts:[...shape,...looks],items:typed,sources:{stated:shape.length,other_stated:looks.length,outfit_photos:kept,liked,product_names:typed.length},
   note:shape.length&&readOutfits?`stated, and read from ${readPhotos} outfit photos`:shape.length?'stated':readOutfits?`read from ${readPhotos} outfit photos`:'no stated fit or outfit reading'}));

 // Palette: colours they wear or say they like. A receipt colour must be written on the receipt (item-tags.js).
 const palette=facet(stated,'style','palette');
 const coloured=items.filter(i=>{const c=tagOf(i,tags)?.color_family;return c&&!['unknown','multi'].includes(c);});
 const families=Object.values(coloured.reduce((m,i)=>{const c=tagOf(i,tags).color_family;m[c]=(m[c]??0)+1;return m;},{})).sort((a,b)=>b-a);
 const clustered=coloured.length>=4&&(families[0]+(families[1]??0))*10>=coloured.length*6;
 out.push(entry('palette',palette.length||readOutfits||clustered?'known':coloured.length||kept||liked?'weak':'missing',
  {facts:palette,items:coloured,sources:{stated:palette.length,purchases:coloured.length,outfit_photos:kept,liked},note:`${coloured.length} purchases with a written colour`}));

 // Brands: a stated brand, or one bought three times with the brand written on the receipt.
 const brandFacts=stated.filter(f=>f.field==='brand');
 const byBrand=items.filter(i=>text(i.brand)).reduce((m,i)=>{const k=merchantKey(i.brand);if(k)(m[k]??=[]).push(i);return m;},{});
 const repeat=Object.values(byBrand).filter(list=>list.length>=3).flat();
 // Wishlist saves: a brand saved as two or more distinct items is as telling as a repeat purchase.
 const savedByBrand=Object.values((wishlist??[]).filter(w=>text(w.brand)&&(w.item_id??w.url)).reduce((m,w)=>{const k=merchantKey(w.brand);if(k)(m[k]??=new Set()).add(w.item_id??w.url);return m;},{}));
 const savedRepeat=savedByBrand.filter(set=>set.size>=2).length;
 const inspired=stated.filter(f=>f.field==='inspiration');
 out.push(entry('brands',brandFacts.length||repeat.length||savedRepeat?'known':Object.keys(byBrand).length||savedByBrand.length||liked||inspired.length?'weak':'missing',
  {facts:[...brandFacts,...inspired],items:repeat.length?repeat:Object.values(byBrand).flat(),sources:{stated:brandFacts.length,purchases:Object.keys(byBrand).length,wishlist:savedByBrand.length,liked},note:`${Object.keys(byBrand).length} brands on receipts, ${savedByBrand.length} on the wishlist`}));

 // Sizes, per category: only a stated or confirmed size makes one known. Bought is not fits.
 const sizeFacts=stated.filter(f=>f.field==='size'),perCategory={};
 for(const f of sizeFacts){const c=sizeCategory(f.key);if(c)perCategory[c]='known';}
 const sized=items.filter(i=>text(i.size_label));
 for(const i of sized){const c=categoryOf(i,tags);if(c&&!perCategory[c])perCategory[c]='weak';}
 // The size bought most often in each category not yet stated, so a question can offer it ("mostly M?").
 const bought={};
 for(const i of sized){const c=categoryOf(i,tags);if(c&&perCategory[c]==='weak')(bought[c]??={})[text(i.size_label)]=(bought[c][text(i.size_label)]??0)+1;}
 const commonest=Object.fromEntries(Object.entries(bought).map(([c,counts])=>[c,Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0]]));
 const sizeStatuses=Object.values(perCategory);
 out.push({...entry('sizes',!sizeStatuses.length?'missing':sizeStatuses.every(s=>s==='known')?'known':'weak',
  {facts:sizeFacts,items:sized,sources:{stated:sizeFacts.length,purchased_sizes:sized.length},note:`${sizeStatuses.filter(s=>s==='known').length} of ${sizeStatuses.length} categories stated`}),categories:perCategory,bought:commonest,purchases:Object.fromEntries(Object.keys(perCategory).map(c=>[c,items.filter(i=>categoryOf(i,tags)===c).length]))});

 // Stores: a stated store, or a clear top store in their own purchases (history, never a favourite).
 const storeFacts=stated.filter(f=>f.field==='store');
 const byStore=Object.values(items.filter(i=>text(i.merchant)).reduce((m,i)=>{const k=merchantKey(i.merchant);if(k)(m[k]??=[]).push(i);return m;},{})).sort((a,b)=>b.length-a.length);
 const shopped=byStore.flat().length,top=byStore[0]??[];
 out.push(entry('stores',storeFacts.length||(shopped>=3&&top.length>=2&&top.length*3>=shopped)?'known':shopped?'weak':'missing',
  {facts:storeFacts,items:top,sources:{stated:storeFacts.length,purchases:shopped,stores:byStore.length},note:`${byStore.length} stores across ${shopped} purchases`}));

 // Price band: a stated usual budget, or the receipt band (3+ priced items in one currency).
 const budget=stated.filter(f=>['budget','spending'].includes(f.field));
 const priced=items.filter(i=>i.price?.amount>0&&i.price.currency),band=priceRange(items);
 const resalePriced=priced.filter(i=>tagOf(i,tags)?.resale===true).length;
 out.push({...entry('price_band',budget.length||band?'known':priced.length?'weak':'missing',
  {facts:budget,items:priced,sources:{stated:budget.length,priced:priced.length},note:band?`receipts: ${band}`:`${priced.length} priced purchases`}),
  resale_band:Boolean(band)&&resalePriced*2>priced.length});

 // New vs resale: from the item tags' marketplace reading; unknown stays unknown.
 const channelled=items.filter(i=>typeof tagOf(i,tags)?.resale==='boolean'),resale=channelled.filter(i=>tagOf(i,tags).resale);
 out.push({...entry('channel',channelled.length>=3?'known':channelled.length?'weak':'missing',
  {items:channelled,sources:{purchases:channelled.length,resale:resale.length},note:`${resale.length} of ${channelled.length} purchases secondhand`}),
  resale_share:channelled.length?Math.round(resale.length/channelled.length*100)/100:null});

 const known=out.filter(d=>d.status==='known').length,is=d=>out.find(x=>x.dimension===d).status;
 const level=out.every(d=>d.status==='missing')?'empty':is('silhouettes')==='known'&&is('palette')==='known'&&known>=5?'rich':'thin';
 return {level,known,dimensions:out};
}

// Reads every source for one person through the user context layer (lib/user-context.js, USER-CONTEXT.md),
// which returns the raw rows coverage and the early read count from. A source that fails to load counts as
// empty, so neither ever blocks anything; the log records which was skipped.
export async function readTasteInputs(store,owner,{log=console.log}={}){
 const {readUserContext}=await import('./user-context.js');
 // Receipts are rebuilt beside the user context, not after it: the large purchase-history row is read once for
 // both, and its evidence read starts with it.
 const shared=Object.create(store);let once;
 if(store.gmailImport)shared.gmailImport=id=>id===owner?(once??=store.gmailImport(id)):store.gmailImport(id);
 const receipts=store.gmailImport?Promise.resolve().then(()=>readReceipts(shared,owner)).then(r=>r.receipts?.state??null)
  // A row that failed to read is logged once, as purchases, by the user context.
  .catch(async()=>{if(await once?.then(()=>true,()=>false))log(JSON.stringify({event:'coverage_source_failed',source:'receipts'}));return null;}):null;
 const [{inputs,facts:context},read]=await Promise.all([readUserContext(shared,owner,{},{log,inputs:true}),receipts]);
 const {profile,row,styleSources:sources,styleSession:session,chat,wishlist}=inputs;
 const state=row?read:null;
 const reading=session?.data?.outfit_reading;
 const observations=Array.isArray(reading?.observations)?reading.observations.map(o=>o?.text).filter(t=>typeof t==='string'&&t.trim()):[];
 // context: the user context facts, with the brand and store readings (Admin › Summary reads them).
 return {facts:profile?.facts??[],context,state,tags:row?.data?.item_tags??{},likedRows:(chat??[]).filter(isLiked),wishlist:wishlist??[],
  outfits:{kept:(sources??[]).filter(s=>s.kind==='outfit').length,reading_photos:Number.isInteger(reading?.photos)?reading.photos:0,observations:observations.length,texts:observations}};
}
export async function readCoverage(store,owner,options={}){
 const inputs=await readTasteInputs(store,owner,options);
 return coverage({...inputs,liked:inputs.likedRows.length});
}

// One structured log line per run, for following how a tester's profile fills in. Never throws.
export async function logCoverage(store,owner,trigger,{log=console.log}={}){
 try{
  const c=await readCoverage(store,owner,{log});
  log(JSON.stringify({event:'coverage_computed',trigger,level:c.level,...Object.fromEntries(c.dimensions.map(d=>[d.dimension,d.status]))}));
  return c;
 }catch{log(JSON.stringify({event:'coverage_failed',trigger}));return null;}
}
