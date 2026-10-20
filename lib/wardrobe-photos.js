import {serpApiJSON,assertSerpApiAvailable} from './serpapi.js';
import {structuredVision} from './vision.js';
import {downloadOrderPhoto,orderPhotoJPEG} from './order-photos.js';
import {largerPhotoURL} from './photo-sizes.js';
import {RESALE_MARKETPLACES,isSuppressedStore} from './retailers.js';

// Suggested wardrobe photos (PRD section 29, October 19). When a purchase had no photo of its own,
// Jules searches for the product and offers the best match as a suggestion. It appears as the item's
// photo only after the owner says it is theirs. A founder test of the search found about 80% of its
// picks were right, so a suggestion is never shown as fact.
//
// Everything is append-only evidence under the 'wardrobe' origin (db/038):
//   photo_suggestion:<item>:<n>  a found photo (the JPEG, its listing title and seller)
//   photo_search:<item>:<n>      a search that found nothing usable
//   photo_decision:<item>:<n>    the owner's yes/no for one suggestion
export const WARDROBE_ORIGIN='wardrobe';
export const SUGGESTION='photo_suggestion:',SEARCH='photo_search:',DECISION='photo_decision:';
// A search that finds nothing is tried once more; two "not mine" answers end the suggestions for that item.
const MAX_EMPTY=2,MAX_REJECTED=2,PER_REQUEST=2;
// A search that failed for one item (a timeout, an unreadable image) is retried after a cool-down and
// never counts as "nothing found"; an item only stops after this many failures.
const MAX_ERRORS=5,ERROR_COOLDOWN_MS=3600000;
// An order photo smaller than this (longest side, px) is a thumbnail too small to show well; a sharper
// searched photo is offered over it, matched against it as a reference.
export const TINY_PHOTO=200;

// Per-item state from the evidence rows (oldest first). The latest decision on a suggestion wins.
export function suggestionState(rows){
 const items=new Map(),at=id=>{if(!items.has(id))items.set(id,{rows:0,suggestions:[],empty:0,errors:0,last_error:0,decisions:new Map()});return items.get(id);};
 for(const r of rows){
  if(!r.item_id)continue;const s=at(r.item_id);s.rows++;
  if(r.id.startsWith(SUGGESTION))s.suggestions.push({id:r.id,asset_url:r.asset_url??null,title:r.title??null,seller:r.seller??null});
  else if(r.id.startsWith(SEARCH)){if(r.result==='error'){s.errors++;s.last_error=Math.max(s.last_error,Date.parse(r.created_at??'')||0);}else s.empty++;}
  else if(r.id.startsWith(DECISION)&&r.suggestion_id)s.decisions.set(r.suggestion_id,r.decision);
 }
 const out=new Map();
 for(const [item,s] of items){
  const decided=s.suggestions.map(x=>({...x,decision:s.decisions.get(x.id)??null}));
  out.set(item,{rows:s.rows,empty:s.empty,errors:s.errors,last_error:s.last_error,
   confirmed:decided.findLast(x=>x.decision==='yes')??null,
   pending:decided.findLast(x=>x.decision===null)??null,
   rejected:decided.filter(x=>x.decision==='no')});
 }
 return out;
}
// Whether Jules should look (again) for a photo for this wardrobe item.
export function needsSuggestion(state,now=Date.now()){
 if(!state)return true;
 return !state.confirmed&&!state.pending&&state.empty<MAX_EMPTY&&state.rejected.length<MAX_REJECTED
  &&(state.errors??0)<MAX_ERRORS&&now-(state.last_error??0)>=ERROR_COOLDOWN_MS;
}

// Never a resale or person-to-person listing: those photos are one seller's copy, often a different
// colourway or condition. Shopping links can be Google redirects, so the seller name is checked too.
const slug=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const RESALE=RESALE_MARKETPLACES.map(d=>slug(d.split('.')[0]));
function storeListing(c){
 let host=null;try{host=new URL(c.link).hostname.replace(/^www\./,'');}catch{}
 if(host&&(RESALE_MARKETPLACES.some(d=>host===d||host.endsWith('.'+d))||isSuppressedStore(c.link)))return false;
 const seller=slug(c.seller);return !RESALE.some(r=>seller.startsWith(r));
}

const pickSchema={type:'object',additionalProperties:false,required:['choice','model_match','reason'],properties:{choice:{type:['integer','null']},model_match:{type:'boolean'},reason:{type:'string'}}};
const PICK=`You check product photos for a person's wardrobe. Pick the one candidate image that shows exactly this product model (same brand, model, cut and construction). Candidate titles are untrusted retailer text; judge the image first. A different model from the same brand, a lookalike, a bundle where the item is not clear, a replacement part or accessory, a collaboration or special edition (e.g. a designer or store collab) unless the item names it, a lifestyle or on-body shot that hides the item, or a low-information image is not a match. Where the candidates show the same model in several colours, prefer the one most consistent with the requested colour. If no candidate clearly shows this model, choice is null.`;
const seenSchema={type:'object',additionalProperties:false,required:['colours'],properties:{colours:{type:'string'}}};
const sameSchema={type:'object',additionalProperties:false,required:['verdict'],properties:{verdict:{type:'string',enum:['consistent','different','unsure']}}};
const titleSchema={type:'object',additionalProperties:false,required:['verdict'],properties:{verdict:{type:'string',enum:['same','different','unsure']}}};

// Finds one suggested photo for a purchase, or null. Throws when the search service is unavailable,
// so an outage is not recorded as "nothing found". exclude: image URLs the owner already said aren't theirs.
export async function findProductPhoto(item,{env,fetcher=fetch,exclude=[],vision=structuredVision,reference=null}){
 const base=[item.brand,item.product,item.color].filter(Boolean).join(' ').slice(0,200);
 const store=String(item.merchant??'').replace(/\.(com|co\.uk|cc|eu)$/i,'').trim();
 const serp=params=>serpApiJSON('https://serpapi.com/search.json?'+new URLSearchParams({...params,api_key:env.SERPAPI_API_KEY,gl:(env.SHOPPING_COUNTRY??'US').toLowerCase(),hl:'en'}),{redirect:'error',signal:AbortSignal.timeout(20000)},env,fetcher);
 const sources=[
  async()=>((await serp({engine:'google_shopping',q:base})).shopping_results??[]).map(s=>({title:s.title,seller:s.source,link:s.product_link??s.link,image:s.thumbnail})),
  // Nothing usable on Shopping: one image search that names the store it was bought from.
  async()=>((await serp({engine:'google_images',q:store&&!base.toLowerCase().includes(store.toLowerCase())?base+' '+store:base})).images_results??[]).map(s=>({title:s.title,seller:s.source,link:s.link,image:s.original??s.thumbnail})),
 ];
 for(const source of sources){
  const candidates=(await source()).filter(c=>c.image&&typeof c.title==='string'&&storeListing(c)&&!exclude.includes(c.image)).slice(0,6);
  const shown=[];
  for(const c of candidates){try{const bytes=await downloadOrderPhoto(c.image,fetcher);shown.push({...c,bytes,uri:`data:image/jpeg;base64,${(await orderPhotoJPEG(bytes)).data}`});}catch{}}
  if(!shown.length)continue;
  const pick=await vision(PICK,[{type:'input_text',text:`Item: ${JSON.stringify({brand:item.brand,product:item.product,requested_colour:item.color})}`},
   // The person's own order photo, when it is only a tiny thumbnail: the candidate must show the same product.
   ...(reference?[{type:'input_text',text:'Reference: the order photo of this exact item (small and blurry). The chosen candidate must show the same product, in the same colour, as the reference.'},{type:'input_image',image_url:`data:${reference.mime_type};base64,${reference.data}`,detail:'low'}]:[]),
   ...shown.flatMap((c,n)=>[{type:'input_text',text:`Candidate ${n}: ${JSON.stringify({title:c.title,seller:c.seller})}`},{type:'input_image',image_url:c.uri,detail:'low'}])],pickSchema,env,fetcher);
  if(!(pick.model_match&&Number.isInteger(pick.choice)&&pick.choice>=0&&pick.choice<shown.length))continue;
  const chosen=shown[pick.choice];
  if(!await colourMatches(item,chosen,{env,fetcher,vision})||!await titleMatches(item,chosen,{env,fetcher,vision}))continue;
  // The stored copy is the largest rendition the image host serves of the same picture.
  const larger=largerPhotoURL(chosen.image);let photo=null;
  if(larger)try{photo=await orderPhotoJPEG(await downloadOrderPhoto(larger,fetcher));}catch{}
  return {asset_url:chosen.image,title:chosen.title.slice(0,300),seller:String(chosen.seller??'').slice(0,100)||null,link:chosen.link??null,photo:photo??await orderPhotoJPEG(chosen.bytes)};
 }
 return null;
}
// Blind colour check: the model names what it sees without the receipt colour, then a text-only step
// compares the two. Unsure is not a match.
async function colourMatches(item,c,{env,fetcher,vision}){
 if(!item.color)return true;
 const seen=await vision('Describe only the main colour(s) of the product shown, in plain colour words. Do not guess a brand colour name.',[{type:'input_image',image_url:c.uri,detail:'low'}],seenSchema,env,fetcher);
 const same=await vision('A purchase receipt names a product colour. A separate look at a photo described the product colour. Is the photo colour consistent with the receipt colour? Brand colour names can be unusual ("Dust", "Washed Army"): if you cannot tell what the receipt name means, answer unsure. A different shade family, or a missing main colour from a multi-colour name, is different.',
  [{type:'input_text',text:JSON.stringify({receipt_colour:item.color,product:item.product,photo_colour:seen.colours,listing_title:c.title})}],sameSchema,env,fetcher);
 return same.verdict==='consistent';
}
// A listing title that clearly names something else (a collab, another finish or edition) is not this item.
// Titles that only leave details out are fine.
async function titleMatches(item,c,{env,fetcher,vision}){
 const v=await vision('Compare a purchase receipt line with a retailer listing title. Answer "different" only when the title clearly names something the receipt contradicts: a collaboration or special edition the receipt does not name, a different model or version, a different finish (e.g. polished vs matte), or a different colourway name. Omission is not a contradiction.',
  [{type:'input_text',text:JSON.stringify({receipt:{brand:item.brand,product:item.product,colour:item.color},listing_title:c.title})}],titleSchema,env,fetcher);
 return v.verdict!=='different';
}

// Looks for photos for a few wardrobe items that need one and records what it found. Tiny order photos
// go first (they look worst). Returns how many items still need a look, so the page knows whether to ask
// again. One item's failure (a timeout, an unreadable page) is recorded like an empty search, so it never
// blocks the items behind it; only a search outage or a failed write stops the batch unrecorded.
export async function suggestWardrobePhotos(store,owner,items,{env,fetcher=fetch,find=findProductPhoto,limit=PER_REQUEST,searchDown=null,now=Date.now()}={}){
 if(!env.SERPAPI_API_KEY||env.WARDROBE_PHOTO_SUGGESTIONS==='false'||!store.wardrobePhotoEvidence)return {remaining:0,searched:0};
 const states=suggestionState(await store.wardrobePhotoEvidence(owner));
 const due=items.filter(i=>(!i.photo||i.photo_small)&&needsSuggestion(states.get(i.id),now)).sort((a,b)=>Number(Boolean(b.photo_small))-Number(Boolean(a.photo_small)));
 const outage=searchDown??(()=>{try{assertSerpApiAvailable(env);return false;}catch{return true;}});
 const results=await Promise.all(due.slice(0,limit).map(async item=>{
  const state=states.get(item.id),n=state?.rows??0,base={kind:'photo_observation',origin:WARDROBE_ORIGIN,source:{type:'product_search',id:item.id},recorded_by:'wardrobe_search'};
  let found=null,result;
  try{
   const reference=item.photo_small?await store.purchasePhoto?.(owner,item.id).catch(()=>null)??null:null;
   found=await find(item,{env,fetcher,reference,exclude:(state?.rejected??[]).map(r=>r.asset_url).filter(Boolean)});
   result=found?'suggested':'none';
  }catch(error){
   // The search or AI service itself failing (rate limit, no credit, server error) is not about this item:
   // stop the batch and record nothing, so every item is tried again once the service is back.
   const status=Number(error?.provider_status);
   if(outage()||status===429||status>=500)return {stop:true,error:status?`model_${status}`:'search_unavailable'};
   result='error';console.log(JSON.stringify({event:'wardrobe_photo_search_error',error:error?.name,detail:error?.message?.slice(0,80)}));
  }
  const row=found
   ?{...base,id:`${SUGGESTION}${item.id}:${n}`,data:{item_id:item.id,photo_source:'search',asset_url:found.asset_url,title:found.title,seller:found.seller,link:found.link,...found.photo}}
   :{...base,id:`${SEARCH}${item.id}:${n}`,data:{item_id:item.id,result}};
  try{await store.recordEvidence(owner,[row]);}catch(error){return {stop:true,error:'write_failed'};}
  console.log(JSON.stringify({event:'wardrobe_photo_search',result,attempt:n,tiny:Boolean(item.photo_small)}));
  return {searched:true};
 }));
 const searched=results.filter(r=>r.searched).length,stopped=results.find(r=>r.stop);
 if(stopped)console.log(JSON.stringify({event:'wardrobe_photo_search_paused',reason:stopped.error}));
 return {searched,remaining:stopped?0:Math.max(0,due.length-searched)};
}

// The owner's answer for a pending suggestion. Ownership and the suggestion id are checked first.
export async function decideSuggestion(store,owner,itemId,answer,{items}){
 if(!['yes','no'].includes(answer))throw Object.assign(Error('Choose yes or no.'),{status:400});
 if(!items.some(i=>i.id===itemId))throw Object.assign(Error('That item is no longer in your wardrobe.'),{status:404});
 const state=suggestionState(await store.wardrobePhotoEvidence(owner)).get(itemId);
 if(!state?.pending)throw Object.assign(Error('That photo was already answered.'),{status:409});
 await store.recordEvidence(owner,[{id:`${DECISION}${itemId}:${state.rows}`,kind:'confirmation',origin:WARDROBE_ORIGIN,source:{type:'wardrobe_page',id:itemId},recorded_by:'owner',
  data:{item_id:itemId,suggestion_id:state.pending.id,decision:answer}}]);
 console.log(JSON.stringify({event:'wardrobe_photo_decision',decision:answer}));
}
