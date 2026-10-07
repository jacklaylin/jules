import {merchantURL} from './product-photos.js';
import {verifyListing} from './listings.js';
import {relevantProducts} from './relevance.js';
import {retailerFor} from './retailers.js';

// Direct result retrieval is a bounded alternative to model-selected sources.
// Search snippets never establish product identity, department or commerce facts.
export async function recoverTextSources(query,env,fetcher,constraints,verify=verifyListing) {
 const name=query.split('. Find an individual')[0].replace(/^(?:men[’']s|women[’']s) department:\s*/i,'').replace(/^(?:find|source|search for)\s+(?:me\s+)?/i,'').trim().slice(0,300);
 const params=new URLSearchParams({engine:'google',q:`${name} ${constraints.range==='men'?"men's":constraints.range==='women'?"women's":''} product`,api_key:env.SERPAPI_API_KEY,gl:'us',hl:'en'});
 const response=await fetcher('https://serpapi.com/search?'+params,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Direct search unavailable');
 const data=await response.json();if(data.error)throw Error('Direct search unavailable');
 const urls=[...new Set((data.organic_results??[]).map(r=>merchantURL(r.link)).filter(Boolean))].filter(url=>! /\/(?:c|categories?|search)\//i.test(new URL(url).pathname)).slice(0,6);
 const checks=await Promise.all(urls.map(async url=>({url,check:await verify(url,name,fetcher)})));
 const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const products=checks.filter(({check})=>check.status==='verified'&&check.product_brand&&normalize(name).includes(normalize(check.product_brand))).map(({check})=>({brand:check.product_brand,name:check.product_name,url:check.url,match:'likely_match',role:'primary',reason:'',sourcing_status:'store_found',listing_check:check,price_snapshot:check.price_snapshot,merchant_options:[],retailer:retailerFor(check.url,check.product_brand)}));
 const result=relevantProducts({status:products.length?'found':'needs_review',products,sources:urls,checked_at:new Date().toISOString(),intro:'I found these options.',identification_policy:'text_search',source_provider:'serpapi_google',direct_checks:checks},constraints);
 result.products.sort((a,b)=>a.retailer.rank-b.retailer.rank);result.products=result.products.slice(0,3);
 return result;
}
