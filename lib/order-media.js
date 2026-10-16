import {folded} from './receipt-feedback.js';
import {publicURL} from './public-url.js';

// The product photo and product-page link a purchase source already contains (PRD section 29).
// Sources offer candidates ({ref, image?, alt, link?}) that code collected from the email HTML or the
// Shop record; the model only points at one by ref. Nothing here searches or guesses: an item without
// a validated candidate keeps its category outline.

// What the model sees: refs, the text near each candidate and the link's page path (no query string),
// never a URL it could copy back.
export function modelCandidates(source){
 return (source?.media?.candidates??[]).map(c=>({ref:c.ref,kind:c.image?'image':'link',text:c.alt||null,...(c.link?{link:pagePath(c.link)}:{})}));
}
const pagePath=url=>{try{const u=new URL(url);return (u.hostname+u.pathname).slice(0,160);}catch{return null;}};
// The source as sent to the model: candidate URLs replaced by modelCandidates.
export const modelSource=({media,...source})=>media?.candidates?.length?{...source,media_candidates:modelCandidates({media})}:source;

// Validates the refs one extracted event chose. Returns {photo, link, rejected}: photo is
// {url, source, source_id} only for an image candidate that exists in this source; link only for a candidate
// with a link. Every URL still passes the https/public check.
export function orderMedia(source,event){
 const candidates=source?.media?.candidates??[],rejected=[];
 const pick=(field,usable)=>{
  const ref=event?.[field];if(ref===null||ref===undefined)return null;
  const candidate=Number.isInteger(ref)?candidates.find(c=>c.ref===ref):null;
  const value=candidate&&usable(candidate);
  if(!value){rejected.push(field);return null;}
  return value;
 };
 const image=pick('photo_ref',c=>c.image?publicURL(c.image):null);
 const link=pick('link_ref',c=>c.link?publicURL(c.link):null);
 return {photo:image?{url:image,source:source.media.source,source_id:source.id}:null,link,rejected};
}

// One picture belongs to one line item. When the model points different line items at the same image
// (a logo or banner), none of them gets it. The same line repeated (purchased and shipped) may share it.
export function exclusiveMedia(proposal){
 const events=Array.isArray(proposal?.events)?proposal.events:[];
 const line=e=>JSON.stringify(['product','sku','color','size_label'].map(f=>String(e?.[f]?.value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()));
 const lines=new Map();
 for(const e of events)if(Number.isInteger(e?.photo_ref))lines.set(e.photo_ref,(lines.get(e.photo_ref)??new Set()).add(line(e)));
 const shared=new Set([...lines].filter(([,set])=>set.size>1).map(([ref])=>ref));
 if(!shared.size)return proposal;
 return {...proposal,events:events.map(e=>shared.has(e?.photo_ref)?{...e,photo_ref:null}:e)};
}

// Shop records are JSON from Shop's order search. A line item's picture is any image-like field
// (a URL string, or an object with url/src) next to its title; its link is a sibling url field.
const IMAGE_KEY=/image|photo|thumbnail|^img$/i,LINK_KEY=/(^|_)(url|link|href)$|Url$/;
const imageValue=value=>{
 const v=Array.isArray(value)?value[0]:value;
 if(typeof v==='string')return publicURL(v);
 if(v&&typeof v==='object')return publicURL(v.url??v.src??v.originalSrc??v.transformedSrc??'');
 return null;
};
export function shopCandidates(record){
 const candidates=[],seen=new Set();
 const walk=(node,depth=0)=>{
  if(depth>8||candidates.length>=30||!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const v of node)walk(v,depth+1);return;}
  const entries=Object.entries(node);
  const image=entries.filter(([k])=>IMAGE_KEY.test(k)).map(([,v])=>imageValue(v)).find(Boolean);
  if(image&&!seen.has(image)){
   seen.add(image);
   const title=['title','name','product_title','productTitle','product_name','productName'].map(k=>node[k]).find(v=>typeof v==='string');
   const link=entries.filter(([k,v])=>LINK_KEY.test(k)&&!IMAGE_KEY.test(k)&&typeof v==='string').map(([,v])=>publicURL(v)).find(Boolean)??null;
   candidates.push({ref:candidates.length,image,alt:(title??'').slice(0,120),link});
  }
  for(const [k,v] of entries)if(!IMAGE_KEY.test(k))walk(v,depth+1);
 };
 walk(record);
 return candidates;
}

// How many items the purchase sources gave a photo or a product link, for import logs.
export function mediaCounts(state){
 const items=state.items.filter(i=>!folded(i));
 return {items:items.length,order_photo:items.filter(i=>i.order_photo).length,product_link:items.filter(i=>i.product_link).length,neither:items.filter(i=>!i.order_photo&&!i.product_link).length};
}
