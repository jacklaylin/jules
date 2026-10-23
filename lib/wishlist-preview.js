import {createHmac,timingSafeEqual} from 'node:crypto';
import {uuid} from './http.js';
function signature(item,version,env){
 const key=env.SUPABASE_SERVICE_ROLE_KEY;if(!key||key.startsWith('replace-with'))return null;
 return createHmac('sha256',key).update(`jules-product-preview:v1:${item}:${version}`).digest('base64url');
}
export function wishlistPreviewURL(item,hasImage,env){
 if(!uuid(item)||!env.SITE_ORIGIN)return null;
 const v=hasImage?'photo':'pending',sig=signature(item,v,env);if(!sig)return null;
 const url=new URL('/api/image',env.SITE_ORIGIN);url.search=new URLSearchParams({preview:'1',item,v,sig}).toString();return url.href;
}
// A save of several items: one signed link for the first three, so the preview can show each of them.
const SET_MAX=3;
function setSignature(items,env){
 const key=env.SUPABASE_SERVICE_ROLE_KEY;if(!key||key.startsWith('replace-with'))return null;
 return createHmac('sha256',key).update(`jules-product-set-preview:v1:${items}`).digest('base64url');
}
export function wishlistSetPreviewURL(items,env){
 const ids=items.slice(0,SET_MAX);
 if(ids.length<2||!ids.every(uuid)||new Set(ids).size!==ids.length||!env.SITE_ORIGIN)return null;
 const sig=setSignature(ids.join(','),env);if(!sig)return null;
 const url=new URL('/api/image',env.SITE_ORIGIN);url.search=new URLSearchParams({preview:'1',items:ids.join(','),sig}).toString();return url.href;
}
export const previewItems=url=>url.searchParams.has('items')?url.searchParams.get('items').split(','):[url.searchParams.get('item')];
export function validWishlistPreview(url,env){
 if(url.searchParams.has('items')){
  const ids=previewItems(url),expected=setSignature(url.searchParams.get('items'),env),actual=url.searchParams.get('sig');
  return ids.length>=2&&ids.length<=SET_MAX&&ids.every(uuid)&&!url.searchParams.has('item')&&Boolean(expected&&typeof actual==='string'&&/^[A-Za-z0-9_-]{43}$/.test(actual)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)));
 }
 if(!uuid(url.searchParams.get('item'))||!['photo','pending'].includes(url.searchParams.get('v')))return false;
 const expected=signature(url.searchParams.get('item'),url.searchParams.get('v'),env),actual=url.searchParams.get('sig');
 return Boolean(expected&&typeof actual==='string'&&/^[A-Za-z0-9_-]{43}$/.test(actual)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)));
}
// The signed preview link is sent as a picture card, never as text: it is taken out wherever a writer
// put it (the save draft ends with it; a rewritten message may move it), together with a line that only
// introduced it (ending in a colon). Only a link this site signed is taken; anything else stays text.
export function splitWishlistPreview(body,env){
 let origin;try{origin=new URL(env.SITE_ORIGIN).origin;}catch{return {body};}
 const lines=String(body??'').split('\n');
 for(let i=lines.length-1;i>=0;i--){
  for(const match of lines[i].matchAll(/https?:\/\/[^\s<>"']+/g)){
   const link=match[0].replace(/[.,!;:)]+$/,'');let url;try{url=new URL(link);}catch{continue;}
   if(url.origin!==origin||url.pathname!=='/api/image'||url.searchParams.get('preview')!=='1'||!validWishlistPreview(url,env))continue;
   const rest=lines[i].replace(match[0],'').replace(/ {2,}/g,' ').trim(),kept=[...lines];
   if(rest&&!rest.endsWith(':'))kept[i]=rest;
   else{kept.splice(i,1);if(!rest&&i>0&&kept[i-1].trim().endsWith(':'))kept.splice(i-1,1);}
   return {body:kept.join('\n').replace(/\n{3,}/g,'\n\n').trim(),preview:url.href};
  }
 }
 return {body};
}
// Writers never see the preview link; it is put back as the message's last line, where delivery
// turns it into the card.
export function withPreview(body,preview){return preview?`${String(body??'').trim()}\n${preview}`:body;}
export async function readPreviewProduct(item,env,fetcher=fetch){
 const response=await fetcher(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/wishlist_items?id=eq.${item}&select=product&limit=1`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Preview lookup failed');return (await response.json())[0]?.product??null;
}
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
