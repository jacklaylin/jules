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
export function validWishlistPreview(url,env){
 if(!uuid(url.searchParams.get('item'))||!['photo','pending'].includes(url.searchParams.get('v')))return false;
 const expected=signature(url.searchParams.get('item'),url.searchParams.get('v'),env),actual=url.searchParams.get('sig');
 return Boolean(expected&&typeof actual==='string'&&/^[A-Za-z0-9_-]{43}$/.test(actual)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)));
}
export function splitWishlistPreview(body,env){
 const lines=body.split('\n');let url;try{url=new URL(lines.at(-1));}catch{return {body};}
 if(!env.SITE_ORIGIN||url.origin!==new URL(env.SITE_ORIGIN).origin||(url.pathname!=='/api/image'||url.searchParams.get('preview')!=='1')||!validWishlistPreview(url,env))return {body};
 return {body:lines.slice(0,-1).join('\n').trim(),preview:url.href};
}
export async function readPreviewProduct(item,env,fetcher=fetch){
 const response=await fetcher(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/wishlist_items?id=eq.${item}&select=product&limit=1`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Preview lookup failed');return (await response.json())[0]?.product??null;
}
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
