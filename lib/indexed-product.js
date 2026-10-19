import {serpApiJSON,assertSerpApiAvailable} from './serpapi.js';
import {merchantURL,listingProduct,productAssetURL} from './product-photos.js';

const cache=new Map();
// A market-neutral user link can redirect to a locale of the same product.
// Explicit markets and every variant parameter remain part of its identity.
export function sameReferenceProductURL(saved,retrieved){
 if(sameProductURL(saved,retrieved))return true;
 try{const a=new URL(saved),b=new URL(retrieved);if(/^[A-Z]{2}$/.test(b.searchParams.get('country')??'')&&!a.searchParams.has('country')){b.searchParams.delete('country');if(sameReferenceProductURL(saved,b.href))return true;}}catch{}
 try{const a=new URL(saved),b=new URL(retrieved);if(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i.test(a.pathname))return false;b.pathname=b.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'');return sameProductURL(a.href,b.href);}catch{return false;}
}
// Match a specific merchant/market/variant URL, ignoring only tracking parameters.
export function sameProductURL(a,b){
 const key=value=>{try{const u=new URL(value);if(!merchantURL(u.href))return null;u.hash='';u.hostname=u.hostname.replace(/^www\./,'');for(const k of [...u.searchParams.keys()])if(/^(utm_|gclid$|fbclid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href.replace(/\/$/,'');}catch{return null;}};
 const first=key(a);return Boolean(first&&first===key(b));
}
// Descriptive words from a product URL's path, e.g. /lemaire/wide-leg-organic-jeans/123 -> lemaire wide leg organic jeans.
export function urlWords(url){
 const skip=new Set(['www','html','htm','aspx','php','products','product','shop','item','items','mens','womens','men','women','clothing','en','us','gb','p','pr','dp']);
 return [...new Set(new URL(url).pathname.split(/[^A-Za-z0-9]+/).map(w=>w.toLowerCase()).filter(w=>/^[a-z]{3,}$/.test(w)&&!skip.has(w)))].slice(0,10).join(' ');
}
const text=value=>typeof value==='string'&&value.trim().length<=500?value.trim():null;
export function indexedPrice(value,url,provider,checked_at){
 if(value.installments||value.installments_description)return null;
 const amount=value.extracted_price??value.price;
 const currency=value.currency??(typeof value.price==='string'?value.price.match(/(?:USD|EUR|GBP|CAD|AUD|US\$|\$|€|£)/)?.[0]:null);
 const iso={USD:'USD',EUR:'EUR',GBP:'GBP',CAD:'CAD',AUD:'AUD','US$':'USD','$':'USD','€':'EUR','£':'GBP'}[currency];
 const number=typeof amount==='number'?amount:typeof amount==='string'&&/^\d+(?:\.\d+)?$/.test(amount)?Number(amount):NaN;
 return iso&&Number.isFinite(number)&&number>0?{amount:number,currency:iso,source_url:url,checked_at,provider,evidence_level:'indexed',market:null}:null;
}
async function search(params,env,fetcher){
 const query=new URLSearchParams({...params,api_key:env.SERPAPI_API_KEY,gl:(env.SHOPPING_COUNTRY??'US').toLowerCase(),hl:'en'});
 return serpApiJSON('https://serpapi.com/search.json?'+query,{redirect:'error',signal:AbortSignal.timeout(15000)},env,fetcher);
}
// Searches Google for one exact product page: 1 search, 2 when a site search is needed, +1 for photos.
export async function lookupIndexedProduct(url,name,{env=process.env,fetcher=fetch,siteSearch=false,photos=false}={}){
 if(!merchantURL(url)||!env.SERPAPI_API_KEY||env.SERPAPI_API_KEY.startsWith('replace-with'))return null;
 try{assertSerpApiAvailable(env);}catch{return null;}
 const key=url+'\n'+(name??'')+'\n'+(env.SHOPPING_COUNTRY??'US')+'\n'+siteSearch+'\n'+photos;const prior=cache.get(key);if(fetcher===fetch&&prior&&Date.now()-prior.at<900000)return prior.value;
 const checked_at=new Date().toISOString(),observations=[],sources=[];
 const record=(provider,data,rows)=>{sources.push({provider,source_url:url,checked_at,status:'completed',results:rows.length});for(const row of rows)observations.push({...row,provider,source_url:url,checked_at});};
 const run=async(provider,params,read)=>{try{const data=await search(params,env,fetcher);const rows=read(data);record(provider,data,rows);return data;}catch{sources.push({provider,source_url:url,checked_at,status:'unavailable'});return null;}};
await Promise.all([
  run('google_index',{engine:'google',q:url},data=>(data.organic_results??[]).filter(r=>sameProductURL(r.link,url)).map(r=>({name:text(r.title),description:text(r.snippet),images:[r.thumbnail].filter(productAssetURL),prices:[r.rich_snippet?.bottom?.detected_extensions,r.rich_snippet?.top?.detected_extensions].filter(Boolean).map(p=>indexedPrice(p,url,'google_index',checked_at)).filter(Boolean)}))),
  ...(photos?[run('google_images',{engine:'google_images',q:url},data=>(data.images_results??[]).filter(r=>r.unsafe!==true&&sameProductURL(r.link,url)).map(r=>({name:text(r.title),images:[r.original,r.thumbnail].filter(productAssetURL),prices:[]})))]:[]),
 ]);
 // Google rarely indexes a query that is a bare URL. A site-scoped search for the product's name
 // (or the words in its URL) finds the same page; only a result for this exact page is used.
 if(siteSearch&&!observations.some(o=>o.provider==='google_index'&&o.name)){
  const q=`site:${new URL(url).hostname.replace(/^www\./,'')} ${String(name??'').trim().slice(0,150)||urlWords(url)}`.trim();
  if(q.includes(' '))await run('google_index',{engine:'google',q},data=>(data.organic_results??[]).filter(r=>sameReferenceProductURL(url,r.link)).map(r=>({name:text(r.title),description:text(r.snippet),images:[r.thumbnail].filter(productAssetURL),prices:[r.rich_snippet?.bottom?.detected_extensions,r.rich_snippet?.top?.detected_extensions].filter(Boolean).map(p=>indexedPrice(p,url,'google_index',checked_at)).filter(Boolean)})));
 }
 const usable=observations.filter(o=>o.name||o.images?.length||o.prices?.length);
 // Validate a named search against the retrieved title; URL saves use their exact source.
 const brands=[...new Set(usable.map(o=>o.brand).filter(Boolean))];
 const named=usable.filter(o=>!name||o.name&&listingProduct('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:o.name,brand:o.brand??(brands.length===1?brands[0]:null),url})+'</script>',name,url,{minimumMatch:1}));
 const preferred=named.find(o=>o.provider==='google_index'&&o.name)??named.find(o=>o.name);
 const images=[...new Set(named.flatMap(o=>o.images??[]))].slice(0,6);
 const prices=named.flatMap(o=>o.prices??[]),unique=[...new Map(prices.map(p=>[p.currency+':'+p.amount,p])).values()];
 const value={product_name:preferred?.name??null,product_brand:named.find(o=>o.brand)?.brand??null,description:named.find(o=>o.description)?.description??null,product_images:images,price_snapshot:unique.length===1?unique[0]:null,price_conflicts:unique.length>1?unique:[],observations:named,sources,checked_at};
 console.log(JSON.stringify({event:'product_sources_collected',host:new URL(url).hostname,sources:sources.map(s=>({provider:s.provider,status:s.status,results:s.results})),images:images.length,prices:unique.length}));
 if(fetcher===fetch){cache.set(key,{at:Date.now(),value});if(cache.size>100)cache.delete(cache.keys().next().value);}
 return value;
}
