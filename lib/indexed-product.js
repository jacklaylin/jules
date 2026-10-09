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
const text=value=>typeof value==='string'&&value.trim().length<=500?value.trim():null;
function price(value,url,provider,checked_at){
 if(value.installments||value.installments_description)return null;
 const amount=value.extracted_price??value.price;
 const currency=value.currency??(typeof value.price==='string'?value.price.match(/(?:USD|EUR|GBP|CAD|AUD|US\$|\$|€|£)/)?.[0]:null);
 const iso={USD:'USD',EUR:'EUR',GBP:'GBP',CAD:'CAD',AUD:'AUD','US$':'USD','$':'USD','€':'EUR','£':'GBP'}[currency];
 const number=typeof amount==='number'?amount:typeof amount==='string'&&/^\d+(?:\.\d+)?$/.test(amount)?Number(amount):NaN;
 return iso&&Number.isFinite(number)&&number>0?{amount:number,currency:iso,source_url:url,checked_at,provider,evidence_level:'indexed',market:null}:null;
}
async function search(params,env,fetcher){
 const query=new URLSearchParams({...params,api_key:env.SERPAPI_API_KEY,gl:(env.SHOPPING_COUNTRY??'US').toLowerCase(),hl:'en'});
 const response=await fetcher('https://serpapi.com/search.json?'+query,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Search source unavailable');
 const data=await response.json();if(data.error)throw Error('Search source unavailable');return data;
}
export async function lookupIndexedProduct(url,name,{env=process.env,fetcher=fetch}={}){
 if(!merchantURL(url)||!env.SERPAPI_API_KEY||env.SERPAPI_API_KEY.startsWith('replace-with'))return null;
 const key=url+'\n'+(name??'')+'\n'+(env.SHOPPING_COUNTRY??'US');const prior=cache.get(key);if(fetcher===fetch&&prior&&Date.now()-prior.at<900000)return prior.value;
 const checked_at=new Date().toISOString(),observations=[],sources=[];
 const record=(provider,data,rows)=>{sources.push({provider,source_url:url,checked_at,status:'completed',results:rows.length});for(const row of rows)observations.push({...row,provider,source_url:url,checked_at});};
 const run=async(provider,params,read)=>{try{const data=await search(params,env,fetcher);const rows=read(data);record(provider,data,rows);return data;}catch{sources.push({provider,source_url:url,checked_at,status:'unavailable'});return null;}};
 const [organic]=await Promise.all([
  run('google_index',{engine:'google',q:url},data=>(data.organic_results??[]).filter(r=>sameProductURL(r.link,url)).map(r=>({name:text(r.title),description:text(r.snippet),images:[r.thumbnail].filter(productAssetURL),prices:[r.rich_snippet?.bottom?.detected_extensions,r.rich_snippet?.top?.detected_extensions].filter(Boolean).map(p=>price(p,url,'google_index',checked_at)).filter(Boolean)}))),
  run('google_images',{engine:'google_images',q:url},data=>(data.images_results??[]).filter(r=>r.unsafe!==true&&sameProductURL(r.link,url)).map(r=>({name:text(r.title),images:[r.original,r.thumbnail].filter(productAssetURL),prices:[]}))),
 ]);
 const title=observations.find(o=>o.provider==='google_index'&&o.name)?.name??name;
 if(title){
  const shopping=await run('google_shopping',{engine:'google_shopping',q:title},data=>(data.shopping_results??[]).filter(r=>sameProductURL(r.product_link??r.link,url)).map(r=>({name:text(r.title),images:[r.thumbnail,...(r.thumbnails??[])].filter(productAssetURL),prices:[price(r,url,'google_shopping',checked_at)].filter(Boolean)})));
  // A product title or Google catalog ID is not enough to merge another merchant's variant.
  const candidates=(shopping?.shopping_results??[]).filter(r=>r.immersive_product_page_token||r.product_id).slice(0,2);
  await Promise.all(candidates.map(r=>run('google_product',{engine:'google_product',...(r.immersive_product_page_token?{page_token:r.immersive_product_page_token}:{product_id:r.product_id})},data=>{
   const p=data.product_results??{},offers=(p.stores??[]).filter(s=>sameProductURL(s.link,url));
   return offers.map(s=>({name:text(s.title??p.title),brand:text(p.brand),images:(p.thumbnails??[]).filter(productAssetURL),prices:[price(s,url,'google_product',checked_at)].filter(Boolean)}));
  })));
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
