import {splitWishlistPreview} from './wishlist-preview.js';

// Format validated outgoing URLs, never interpret the user's conversational intent.
export function splitLinkPreview(body,env){
 const saved=splitWishlistPreview(body,env);
 if(saved.preview)return {...saved,kind:'wishlist'};
 let origin;try{origin=new URL(env.SITE_ORIGIN).origin;}catch{return {body};}
 const candidates=[];
 for(const match of body.matchAll(/https?:\/\/[^\s<>"']+/g)){
  try{
   const url=new URL(match[0].replace(/[.,!;:)]+$/,''));
   if(url.origin!==origin||url.username||url.password||url.search||url.hash)continue;
   const kind=new Map([['/style','style'],['/wishlist','collection'],['/','general']]).get(url.pathname);
   if(kind)candidates.push({url:url.href,kind});
  }catch{/* Leave malformed or unsupported links as ordinary text. */}
 }
 const unique=[...new Map(candidates.map(entry=>[entry.url,entry])).values()];
 // Keep the original text and clickable URL if the best-effort card fails.
 // Multiple destinations stay in text rather than arbitrarily choosing one.
 return unique.length===1?{body,preview:unique[0].url,kind:unique[0].kind}:{body};
}
