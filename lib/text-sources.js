import {serpApiJSON} from './serpapi.js';
import {merchantURL,listingBytes,listingFetch} from './product-photos.js';
import {verifyListing} from './listings.js';
import {relevantProducts} from './relevance.js';
import {retailerFor,RETAILERS} from './retailers.js';
import {searchShop,shopifyStoreFor} from './shop.js';

// Direct result retrieval is a bounded alternative to model-selected sources.
// Search snippets never establish product identity, department or commerce facts.
export async function recoverTextSources(query,env,fetcher,constraints,verify=verifyListing,identified) {
 const name=query.split('. Find an individual')[0].replace(/^(?:men[’']s|women[’']s) department:\s*/i,'').replace(/^(?:find|source|search for)\s+(?:me\s+)?/i,'').trim().slice(0,300);
 const official=RETAILERS.find(r=>r.tier==='official'&&r.brands.some(b=>b.toLowerCase()===identified?.brand?.toLowerCase()));
 const brief=identified?.name?[identified.brand,identified.name].join(' '):name;
 const params=new URLSearchParams({engine:'google',q:`${official?'site:'+official.domain+' ':''}${brief} ${constraints.range==='men'?"men's":constraints.range==='women'?"women's":''} product`,api_key:env.SERPAPI_API_KEY,gl:(env.SHOPPING_COUNTRY??'US').toLowerCase(),hl:'en'});
 const data=await serpApiJSON('https://serpapi.com/search?'+params,{signal:AbortSignal.timeout(15000)},env,fetcher);
 let urls=[...new Set((data.organic_results??[]).map(r=>merchantURL(r.link)).filter(Boolean))].filter(url=>! /\/(?:c|categories?|search)\//i.test(new URL(url).pathname)).slice(0,6);
 const collections=urls.filter(url=>/\/(?:collections?|categories?)\//i.test(new URL(url).pathname)&&! /\/(?:products?|p)\//i.test(new URL(url).pathname)).slice(0,2);
 const discovered=await Promise.all(collections.map(url=>collectionProductLinks(url,brief,fetcher)));
 urls=[...new Set([...discovered.flat(),...urls])].slice(0,6);
 const checks=await Promise.all(urls.map(async url=>({url,check:await verify(url,name,fetcher)})));
 const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const products=checks.filter(({check})=>check.status==='verified'&&check.product_brand&&normalize(name).includes(normalize(check.product_brand))).map(({check})=>({brand:check.product_brand,name:check.product_name,url:check.url,match:'likely_match',role:'primary',reason:'',sourcing_status:'store_found',listing_check:check,price_snapshot:check.price_snapshot,merchant_options:[],retailer:retailerFor(check.url,check.product_brand)}));
 const result=relevantProducts({status:products.length?'found':'needs_review',products,sources:urls,checked_at:new Date().toISOString(),intro:'i found these options.',identification_policy:'text_search',source_provider:'serpapi_google',direct_checks:checks},constraints);
 result.products.sort((a,b)=>a.retailer.rank-b.retailer.rank);result.products=result.products.slice(0,3);
 return result;
}

export async function recoverCollectionSources(products,fetcher,constraints,verify=verifyListing,sources=[]) {
 const candidates=[...products];
 for(const url of sources){
  if(!merchantURL(url)||! /\/collections?\//i.test(new URL(url).pathname))continue;
  const host=new URL(url).hostname.replace(/^www\./,'');
  const identified=products.find(p=>RETAILERS.some(r=>r.tier==='official'&&r.domain===host&&r.brands.some(b=>b.toLowerCase()===p.brand?.toLowerCase())));
  if(identified&&!candidates.some(p=>p.url===url))candidates.push({...identified,url});
 }
 const pages=candidates.filter(p=>merchantURL(p.url)&&/\/collections?\//i.test(new URL(p.url).pathname)).slice(0,2);
 const checks=[];
 for(const p of pages){
  const urls=await collectionProductLinks(p.url,[p.brand,p.name].join(' '),fetcher);
  for(const url of urls)checks.push({candidate:p,url,check:await verify(url,p.name,fetcher)});
 }
 const normalized=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const recovered=checks.filter(({candidate,check})=>check.status==='verified'&&normalized(check.product_brand)&&normalized(check.product_brand)===normalized(candidate.brand)).map(({candidate,check})=>({...candidate,url:check.url,name:check.product_name,brand:check.product_brand,sourcing_status:'store_found',listing_check:check,price_snapshot:check.price_snapshot,merchant_options:[],retailer:retailerFor(check.url,check.product_brand)}));
 return relevantProducts({status:recovered.length?'found':'needs_review',products:recovered,sources:checks.map(c=>c.url),collection_checks:checks.map(({url,check})=>({url,check})),identification_policy:'text_search',source_provider:'retrieved_collection',checked_at:new Date().toISOString()},constraints);
}

// Share of a listing's product-name words (excluding its brand) found in the brief. Compares product
// data with the brief's product description; it does not interpret what the user wants.
export function nameOverlap(name,brand,brief){
 const words=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{3,}/g)??[];
 const own=new Set(words(brand)),text=words(brief).join(' ');
 const terms=[...new Set(words(name).filter(w=>!own.has(w)))];
 return terms.length?terms.filter(w=>text.includes(w)||text.includes(w.replace(/s$/,''))).length/terms.length:0;
}
// Shop's catalog as an additional source. Its results are candidate URLs only: each passes the same
// listing check as any other store, so Shopify stores gain no verification advantage. A required brand
// whose own store is on Shopify is searched inside that store.
export async function shopCandidates(brief,{env,constraints={},mode=null,requiredBrands=[],verify=verifyListing,fetcher=fetch,search=searchShop}={}){
 const shops=[...new Set(requiredBrands.map(b=>shopifyStoreFor(b)).filter(Boolean))];
 const department=constraints.range==='men'?"men's ":constraints.range==='women'?"women's ":'';
 const found=await search(department+brief,{env,fetcher,shops,limit:8});
 const perSeller=new Map(),picked=[];
 for(const offer of found.offers){
  if(offer.available===false||!merchantURL(offer.url))continue;
  const seller=offer.seller.domain??new URL(offer.url).hostname;
  if((perSeller.get(seller)??0)>=2)continue;
  perSeller.set(seller,(perSeller.get(seller)??0)+1);picked.push(offer);
  if(picked.length===4)break;
 }
 // Shop links carry attribution and variant parameters that the page's structured data doesn't
 // declare; the plain product page is checked and shown, like any other store's page.
 const page=url=>{const u=new URL(url);u.search='';u.hash='';return u.href;};
 const checks=await Promise.all(picked.map(async offer=>({offer,check:await verify(page(offer.url),offer.title,fetcher)})));
 const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const products=checks.filter(({check})=>check.status==='verified').flatMap(({offer,check})=>{
  // Shop ranks by its own relevance, so a match needs the page's brand and most of its product name
  // in the brief; otherwise it is only a discovery candidate for the taste ranking to judge.
  const named=Boolean(check.product_brand)&&normalize(brief).includes(normalize(check.product_brand))&&nameOverlap(check.product_name??offer.title,check.product_brand,brief)>=0.5;
  if(mode!=='discover'&&!named)return [];
  return [{brand:check.product_brand??null,name:check.product_name??offer.title,url:check.url,match:named?'likely_match':'similar',role:'primary',reason:'',sourcing_status:'store_found',
   listing_check:check,price_snapshot:check.price_snapshot,merchant_options:[],retailer:retailerFor(check.url,check.product_brand??''),source_provider:'shop_catalog',shop:{product_id:offer.product_id,variant_id:offer.variant_id}}];
 });
 return {products,diagnostics:{shops,ignored_filters:found.ignored_filters,next:found.next,offers:found.offers.length,checked:checks.map(({offer,check})=>({url:offer.url,seller:offer.seller.domain,status:check.status}))}};
}

// Follow a bounded set of links from a retrieved, supported collection page.
// URLs come from that page, not constructed slugs; product checks remain authoritative.
export async function collectionProductLinks(url,name,fetcher) {
 try {
  if(!merchantURL(url))return [];
  const response=await listingFetch(url,{redirect:'error',signal:AbortSignal.timeout(6000)},fetcher);
  if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')??''))return [];
  const html=(await listingBytes(response,1500000)).toString('utf8');
  const words=String(name).toLowerCase().match(/[a-z0-9]{3,}/g)??[];
  const seen=new Set(),links=[];
  for(const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
   const candidate=merchantURL(new URL(match[1].replace(/&amp;/g,'&'),url).href);
   if(!candidate||new URL(candidate).origin!==new URL(url).origin||! /\/(?:products?|p)\//i.test(new URL(candidate).pathname)||seen.has(candidate))continue;
   const text=(match[2].replace(/<[^>]+>/g,' ')+' '+new URL(candidate).pathname).toLowerCase();
   const score=new Set(words.filter(w=>text.includes(w))).size;
   if(score<2)continue;
   seen.add(candidate);links.push({url:candidate,score});
  }
  return links.sort((a,b)=>b.score-a.score).slice(0,3).map(l=>l.url);
 }catch{return [];}
}
