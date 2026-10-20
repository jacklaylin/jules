import {merchantKey} from './receipt-extraction.js';
import {CATEGORY_FOR,CATEGORIES,tagFingerprint} from './item-tags.js';
import {priceRange} from './receipt-notifications.js';
import {personalItems,keptItems} from './style-report.js';
import {loadReceipts} from './evidence.js';
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
export function coverage({facts=[],state=null,tags={},outfits={},liked=0}={}){
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
 const shape=[...stated.filter(f=>f.field==='fit'),...facet(stated,'style','silhouette')];
 const looks=stated.filter(f=>['style','inspiration'].includes(f.field)&&!shape.includes(f));
 const typed=items.filter(i=>tagOf(i,tags)?.item_type);
 out.push(entry('silhouettes',shape.length||readOutfits?'known':kept||looks.length||liked||typed.length?'weak':'missing',
  {facts:[...shape,...looks],items:typed,sources:{stated:shape.length,other_stated:looks.length,outfit_photos:kept,liked,product_names:typed.length},
   note:readOutfits?`read from ${readPhotos} outfit photos`:shape.length?'stated':'no stated fit or outfit reading'}));

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
 const inspired=stated.filter(f=>f.field==='inspiration');
 out.push(entry('brands',brandFacts.length||repeat.length?'known':Object.keys(byBrand).length||liked||inspired.length?'weak':'missing',
  {facts:[...brandFacts,...inspired],items:repeat.length?repeat:Object.values(byBrand).flat(),sources:{stated:brandFacts.length,purchases:Object.keys(byBrand).length,liked},note:`${Object.keys(byBrand).length} brands on receipts`}));

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

// Reads every source for one person. A source that fails to load counts as empty, so coverage never
// blocks anything; the log records which source was skipped.
export async function readCoverage(store,owner,{log=console.log}={}){
 const optional=(label,read)=>Promise.resolve().then(read).catch(()=>{log(JSON.stringify({event:'coverage_source_failed',source:label}));return null;});
 const [profile,row,sources,session,chat]=await Promise.all([
  store.profile?optional('profile',()=>store.profile(owner)):null,
  store.gmailImport?optional('purchases',()=>store.gmailImport(owner)):null,
  store.styleSources?optional('outfit_photos',()=>store.styleSources(owner)):null,
  store.styleSession?optional('style_session',()=>store.styleSession(owner)):null,
  store.evidence?optional('liked_items',()=>store.evidence(owner,'chat')):null]);
 const state=row?await optional('receipts',async()=>(await loadReceipts(store,owner,row)).state):null;
 const reading=session?.data?.outfit_reading;
 return coverage({facts:profile?.facts??[],state,tags:row?.data?.item_tags??{},liked:(chat??[]).filter(isLiked).length,
  outfits:{kept:(sources??[]).filter(s=>s.kind==='outfit').length,reading_photos:Number.isInteger(reading?.photos)?reading.photos:0,
   observations:Array.isArray(reading?.observations)?reading.observations.length:0}});
}

// One structured log line per run, for following how a tester's profile fills in. Never throws.
export async function logCoverage(store,owner,trigger,{log=console.log}={}){
 try{
  const c=await readCoverage(store,owner,{log});
  log(JSON.stringify({event:'coverage_computed',trigger,level:c.level,...Object.fromEntries(c.dimensions.map(d=>[d.dimension,d.status]))}));
  return c;
 }catch{log(JSON.stringify({event:'coverage_failed',trigger}));return null;}
}
