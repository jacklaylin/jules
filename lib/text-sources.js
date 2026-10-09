import {merchantURL,listingBytes,listingFetch} from './product-photos.js';
import {verifyListing} from './listings.js';
import {relevantProducts} from './relevance.js';
import {retailerFor,RETAILERS} from './retailers.js';

// Direct result retrieval is a bounded alternative to model-selected sources.
// Search snippets never establish product identity, department or commerce facts.
export async function recoverTextSources(query,env,fetcher,constraints,verify=verifyListing,identified) {
 const name=query.split('. Find an individual')[0].replace(/^(?:men[’']s|women[’']s) department:\s*/i,'').replace(/^(?:find|source|search for)\s+(?:me\s+)?/i,'').trim().slice(0,300);
 const official=RETAILERS.find(r=>r.tier==='official'&&r.brands.some(b=>b.toLowerCase()===identified?.brand?.toLowerCase()));
 const brief=identified?.name?[identified.brand,identified.name].join(' '):name;
 const params=new URLSearchParams({engine:'google',q:`${official?'site:'+official.domain+' ':''}${brief} ${constraints.range==='men'?"men's":constraints.range==='women'?"women's":''} product`,api_key:env.SERPAPI_API_KEY,gl:'us',hl:'en'});
 const response=await fetcher('https://serpapi.com/search?'+params,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Direct search unavailable');
 const data=await response.json();if(data.error)throw Error('Direct search unavailable');
 let urls=[...new Set((data.organic_results??[]).map(r=>merchantURL(r.link)).filter(Boolean))].filter(url=>! /\/(?:c|categories?|search)\//i.test(new URL(url).pathname)).slice(0,6);
 const collections=urls.filter(url=>/\/(?:collections?|categories?)\//i.test(new URL(url).pathname)&&! /\/(?:products?|p)\//i.test(new URL(url).pathname)).slice(0,2);
 const discovered=await Promise.all(collections.map(url=>collectionProductLinks(url,brief,fetcher)));
 urls=[...new Set([...discovered.flat(),...urls])].slice(0,6);
 const checks=await Promise.all(urls.map(async url=>({url,check:await verify(url,name,fetcher)})));
 const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const products=checks.filter(({check})=>check.status==='verified'&&check.product_brand&&normalize(name).includes(normalize(check.product_brand))).map(({check})=>({brand:check.product_brand,name:check.product_name,url:check.url,match:'likely_match',role:'primary',reason:'',sourcing_status:'store_found',listing_check:check,price_snapshot:check.price_snapshot,merchant_options:[],retailer:retailerFor(check.url,check.product_brand)}));
 const result=relevantProducts({status:products.length?'found':'needs_review',products,sources:urls,checked_at:new Date().toISOString(),intro:'I found these options.',identification_policy:'text_search',source_provider:'serpapi_google',direct_checks:checks},constraints);
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
