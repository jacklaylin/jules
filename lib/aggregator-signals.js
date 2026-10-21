import {Parser} from 'htmlparser2';

// Aggregator detection, log-only (October 21, step 1 of 3). An aggregator's product page describes an
// item but sells it elsewhere: it has no checkout of its own and its buy button sends the shopper to
// another store. Real marketplaces (Farfetch, Grailed, eBay) show other sellers' items too, but check
// out on their own site, so a page is suspect only when both are true. These are checks on the page's
// links, buttons and product data, never on its wording. Nothing is blocked yet: the verdict rides
// along on the listing check and in search diagnostics for the founder to review.

// The site a host belongs to: its last two labels, or three for a country domain like shop.co.uk.
export function siteOf(host){
 const labels=String(host??'').toLowerCase().replace(/^www\./,'').split('.');
 return labels.slice(labels.length>=3&&['co','com','net','org','ac'].includes(labels.at(-2))&&labels.at(-1).length===2?-3:-2).join('.');
}
// A store's own cart or checkout, by path or by its add-to-cart control. Shopify stores always have one.
const CART_PATH=/^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?(?:cart|basket|bag|shopping-?bag|checkout)\b/i;
const ADD_CONTROL=/add[-_]?to[-_]?(?:cart|bag|basket)|addto(?:cart|bag|basket)/i;
// An outbound click-through on the page's own site (Lyst's /track/lead/), opened in a new tab.
const REDIRECT_PATH=/^\/(?:track|out|go|redirect|click|exit|outbound)\//i;
// Affiliate networks' redirect hosts: a link through one leaves for another store.
const AFFILIATE_HOSTS=['skimresources.com','redirectingat.com','linksynergy.com','shareasale.com','awin1.com','rstyle.me','shopstyle.it','prf.hn','anrdoezrs.net','jdoqocy.com','tkqlhce.com','dpbolvw.net','kqzyfj.com','howl.me','narrativ.com','sjv.io','pxf.io'];
// Share buttons and social profiles carry other sites' addresses without being a place to buy.
const NOT_A_STORE=/(?:^|\.)(?:google|facebook|instagram|tiktok|pinterest|twitter|x|youtube|whatsapp|linkedin|reddit|snapchat|threads|apple|schema|w3)\.(?:com|net|org)$/i;
const ASSET=/\.(?:jpe?g|png|webp|avif|gif|svg|css|js|woff2?|mp4|webm)$/i;

function storeLink(value,own){
 let u;try{u=new URL(value);}catch{return null;}
 if(!/^https?:$/.test(u.protocol)||u.pathname.length<2||ASSET.test(u.pathname))return null;
 const site=siteOf(u.hostname);
 // The full host is kept for review: a store on a platform domain (x.myshopify.com) is that store.
 return site&&site!==own&&!NOT_A_STORE.test(site)?u.hostname.replace(/^www\./,''):null;
}
// A store address hidden in an attribute value: plain, percent-encoded or base64 (Stylight's data-go).
function decoded(value){
 const out=[value];
 try{out.push(decodeURIComponent(value));}catch{}
 const b64=value.replace(/%3D/gi,'=').split('&')[0];
 if(/^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(b64))try{out.push(Buffer.from(b64.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));}catch{}
 return out;
}

export function aggregatorSignals(html,url,offers=[]){
 let page;try{page=new URL(url);}catch{return null;}
 const own=siteOf(page.hostname),sameSite=href=>{try{const u=new URL(href,page);return siteOf(u.hostname)===own?u:null;}catch{return null;}};
 let ownCheckout=/Shopify\.country\s*=|id=["']shopify-features/.test(html),redirects=0;
 const embedded=new Set();
 const parser=new Parser({onopentag(name,attrs){
  if(!['a','form','button','input'].includes(name)&&!Object.keys(attrs).some(k=>k.startsWith('data-')))return;
  const target=attrs.href??attrs.action;
  if((name==='a'||name==='form')&&target){
   const same=sameSite(target);
   if(same&&CART_PATH.test(same.pathname))ownCheckout=true;
   if(name==='a'&&same&&REDIRECT_PATH.test(same.pathname)&&(attrs.target==='_blank'||/sponsored/i.test(attrs.rel??''))){redirects++;}
   if(name==='a'&&!same){try{const host=new URL(target,page).hostname;if(AFFILIATE_HOSTS.includes(siteOf(host)))redirects++;}catch{}}
   // A store's address passed along in the link's query (an affiliate or tracking hop).
   if(name==='a')try{for(const v of new URL(target,page).searchParams.values()){const site=storeLink(v,own);if(site)embedded.add(site);}}catch{}
  }
  const controls=Object.entries(attrs).filter(([k])=>/^(?:id|name|class|action)$/.test(k)||k.startsWith('data-'));
  if(['button','input','form'].includes(name)&&controls.some(([,v])=>ADD_CONTROL.test(v)))ownCheckout=true;
  for(const [k,v] of controls){
   if(!k.startsWith('data-')||/image|img|src|poster|video|font|bg|background/i.test(k)||v.length>2000)continue;
   for(const d of decoded(v)){const site=storeLink(d,own);if(site)embedded.add(site);}
  }
 }},{decodeEntities:true});
 parser.write(html);parser.end();
 // Product data that names another site as where the offer is (its link or its seller's site).
 const offsite=new Set();
 for(const o of offers)for(const v of [o?.url,o?.seller?.url,o?.offeredBy?.url])if(typeof v==='string'){const site=storeLink(v,own);if(site)offsite.add(site);}
 const leaves=redirects>0||embedded.size>0||offsite.size>0;
 return {suspect:!ownCheckout&&leaves,own_checkout:ownCheckout,outbound_redirects:redirects,embedded_store_link:embedded.size>0,offsite_offer:offsite.size>0,other_stores:[...new Set([...embedded,...offsite])].slice(0,5)};
}
