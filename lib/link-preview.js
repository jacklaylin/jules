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

// A site page that gets its own card (wishlist, style) leaves the text, as a product with a card does
// (founder, October 21): only that exact link is taken out, a line left empty goes with it, and a message
// that is only the link stays as it is. The caller sends the link as text if the card fails.
export function withoutPageLink(body,href){
 const lines=String(body??'').split('\n').map(line=>line.replace(/https?:\/\/[^\s<>"']+/g,match=>{
  const link=match.replace(/[.,!;:)]+$/,'');let same=false;try{same=new URL(link).href===href;}catch{/* not a link */}
  return same?match.slice(link.length).replace(/^[.,!;]+/,''):match;
 }).replace(/[ \t]{2,}/g,' ').trimEnd());
 const out=lines.filter((line,i)=>line.trim()||String(body).split('\n')[i].trim()==='').join('\n').replace(/\n{3,}/g,'\n\n').trim();
 return out||body;
}
