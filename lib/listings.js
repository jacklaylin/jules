import {pageMarket,marketAlternates,alternateFor,shipsTo,marketRank,urlMarket} from './store-market.js';
import {storeShipping} from './store-shipping.js';
import {shopifyColorOptions,colorOptionsFromProduct,retailerColorSwatches,structuredColorOptions} from './product-variants.js';
import { listingProduct, listingPhotos, merchantURL, listingBytes,listingFetch } from './product-photos.js';
import {lookupIndexedProduct} from './indexed-product.js';
import {renderListing} from './rendered-listing.js';
import {isSuppressedStore,isLookalikeStore} from './retailers.js';
import { pradaProductDetails,productShoppingRange } from './structured-product.js';
const checks=new Map();
// schema.org states that mean no offer can be bought now; every offer must report one to call a listing sold out.
export const SOLD_OUT=['OutOfStock','SoldOut','Discontinued'];
export const soldOut=p=>SOLD_OUT.includes(p?.listing_check?.availability);

// All shopping links pass this check after identification and before display/delivery.
export async function verifyListing(url,name,fetcher=fetch,render=renderListing,env=process.env,{recoveryOnly=false}={}){
 const key=url+'\n'+(name??'')+'\n'+recoveryOnly+'\n'+(env.SHOPPING_COUNTRY??'US')+'\n'+(env.SHOPPING_CURRENCY??'USD');
 if(fetcher!==fetch||render!==renderListing)return collectListing(url,name,fetcher,render,env,recoveryOnly);
 const prior=checks.get(key);if(prior&&Date.now()-prior.at<60000)return prior.promise;
 const promise=collectListing(url,name,fetcher,render,env,recoveryOnly).catch(()=>({status:'check_failed',checked_at:new Date().toISOString()}));
 checks.set(key,{at:Date.now(),promise});if(checks.size>100)checks.delete(checks.keys().next().value);return promise;
}
async function collectListing(url,name,fetcher,render,env,recoveryOnly){
 const check=await verifyRetailerListing(url,name,fetcher,render,env);
 if(['unsupported','invalid_redirect','unavailable','not_product'].includes(check.status))return check;
 // A complete retailer result needs no slower index recovery.
 if(check.status==='verified'&&check.price_snapshot&&(check.product_images??[]).length)return check;
 const indexed=await lookupIndexedProduct(url,name,{env,fetcher,siteSearch:check.status!=='verified'});
 if(!indexed)return check;
 const direct=check.status==='verified'?[{provider:check.retrieval==='browser'?'retailer_browser':'retailer_http',source_url:check.url,checked_at:check.checked_at,name:check.product_name,brand:check.product_brand,images:check.product_images,prices:[check.price_snapshot].filter(Boolean)}]:[];
 const allPrices=[...direct.flatMap(o=>o.prices),...indexed.observations.flatMap(o=>o.prices??[])],distinct=[...new Map(allPrices.map(p=>[p.currency+':'+p.amount,p])).values()];
 const evidence={sources:[...(direct.length?[{provider:direct[0].provider,source_url:check.url,checked_at:check.checked_at,status:'completed'}]:[]),...indexed.sources],observations:[...direct,...indexed.observations],price_conflicts:distinct.length>1?distinct:[]};
 if(check.status==='verified')return {...check,product_images:[...new Set([...(check.product_images??[]),...(new URL(check.url).searchParams.has('variant')?[]:indexed.product_images)])].slice(0,6),description:check.description??indexed.description,price_snapshot:check.price_snapshot??(indexed.price_snapshot?.currency===(env.SHOPPING_CURRENCY??'USD')?indexed.price_snapshot:null),product_data:evidence};
 if(!indexed.product_name)return {...check,product_images:indexed.product_images,product_data:evidence};
 return indexedListing(url,{...indexed,product_data:evidence},check,env);
}
// A store page we could not read, described by a search provider's result for that exact URL. The
// name, photo and price are the provider's indexed observation; stock stays unknown.
export function indexedListing(url,indexed,retailerCheck,env=process.env){
 // Index results carry only what the URL declares about the store's market.
 const marketCountry=urlMarket(url),shopper=env.SHOPPING_COUNTRY??'US',currency=env.SHOPPING_CURRENCY??'USD';
 const price=indexed.price_snapshot?.currency===currency?indexed.price_snapshot:null;
 return {status:'verified',verification_basis:'search_index',retrieval:'search_index',url,checked_at:indexed.checked_at??new Date().toISOString(),market_country:shopper,store_market:{country:marketCountry,currency:indexed.price_snapshot?.currency??null,basis:marketCountry?'url':null},market_match:marketCountry?marketCountry===shopper:null,ships_to_shopper:null,product_name:indexed.product_name,product_brand:indexed.product_brand??null,product_images:indexed.product_images??[],description:indexed.description??null,shopping_range:productShoppingRange('',url,{}),price_snapshot:price,price_status:price?'indexed':'unavailable',availability:null,product_data:indexed.product_data??null,retailer_check:retailerCheck};
}
// The store's page exists but refused or failed our read (bot wall, rate limit, browser failure),
// as opposed to a missing page, a category page or a different product.
export const blockedCheck=check=>check?.status==='check_failed'||check?.status==='unavailable'&&[401,403,429,503].includes(check.http_status);
async function verifyRetailerListing(url, name, fetcher=fetch,render=renderListing,env=process.env,resolvedFrom=null) {
  let current=merchantURL(url);
  const checked_at=new Date().toISOString();
  if(!current)return {status:'unsupported',checked_at};
  const country=env.SHOPPING_COUNTRY??'US',currencyWanted=env.SHOPPING_CURRENCY??({US:'USD',CA:'CAD',GB:'GBP',AU:'AUD'}[country]??null);
  const path=new URL(current).pathname;
  if(/\/(?:c|categories?|search)\//i.test(path))return {status:'not_product',checked_at,reason:'category_page'};
  // A suppressed site is not a store, before or after any redirect or render; nothing on it is read.
  if(isSuppressedStore(current))return {status:'not_product',checked_at,reason:'suppressed_store'};
  // A copycat of a listed store, or a look-alike-alphabet domain, is never read.
  if(isLookalikeStore(current))return {status:'not_product',checked_at,reason:'lookalike_store'};
  let renderedAttempted=false;
  try {
    let response;
    for(let hops=0;hops<=3;hops++){
      response=await listingFetch(current,{redirect:'manual',headers:{'Accept-Language':'en-US,en;q=0.9',Cookie:`localization=${country};${currencyWanted?' cart_currency='+currencyWanted:''}`},signal:AbortSignal.timeout(6000)},fetcher);
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        current=location&&merchantURL(new URL(location,current).href);
        if(!current||hops===3)return {status:'invalid_redirect',checked_at};
        if(isSuppressedStore(current))return {status:'not_product',checked_at,reason:'suppressed_store'};
        continue;
      }
      break;
    }
    let html,retrieval='http';
    if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')??'')){
      if(![403,429,503].includes(response.status))return {status:'unavailable',checked_at,http_status:response.status};
      renderedAttempted=true;const rendered=await render(current);html=rendered.html;current=merchantURL(rendered.url);if(!current)return {status:'invalid_redirect',checked_at};if(isSuppressedStore(current))return {status:'not_product',checked_at,reason:'suppressed_store'};retrieval='browser';
    }else html=(await listingBytes(response,1500000)).toString('utf8');
    if(/isBotPage\s*=\s*true|<title>[^<]*(?:access denied|just a moment)/i.test(html))return {status:'check_failed',checked_at};
    // Shopify's country parameter selects its market independently of server geography.
    if(/Shopify\.country\s*=/.test(html)&&!html.includes('Shopify.country = '+JSON.stringify(country))){
      const us=new URL(current);us.pathname=us.pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/products\/)/i,'');us.searchParams.set('country',country);
      const localized=await listingFetch(us.href,{redirect:'manual',headers:{Cookie:`localization=${country};${currencyWanted?' cart_currency='+currencyWanted:''}`},signal:AbortSignal.timeout(6000)},fetcher);
      if(localized.ok&&/text\/html/i.test(localized.headers.get('content-type')??'')){html=(await listingBytes(localized,1500000)).toString('utf8');current=us.href;}
    }
    let product=listingProduct(html,name,current);
    if(!product&&retrieval==='http'){try{renderedAttempted=true;const rendered=await render(current);if(merchantURL(rendered.url)===current){html=rendered.html;product=listingProduct(html,name,current);retrieval='browser';}}catch{}}
    if(!product)return {status:'not_product',checked_at};
    // A copycat of the brand's own site (one typo from its name) is not a place to buy, whatever it shows.
    if(isLookalikeStore(current,typeof product.brand==='string'?product.brand:product.brand?.name??null))return {status:'not_product',checked_at,reason:'lookalike_store'};
    const details=pradaProductDetails(html,current,product);
    const offers=[].concat(product.offers??[]).flatMap(o=>o?.offers?[].concat(o.offers):[o]);
    // The store's own market, from what the page declares. A foreign page that names a version for
    // the shopper's country is checked there instead (one extra fetch, no guessing of URLs).
    const market=pageMarket(html,current,offers);
    if(!resolvedFrom&&market.country&&market.country!==country){
      const alternate=alternateFor(marketAlternates(html,current),country);
      if(alternate&&merchantURL(alternate.url)&&alternate.url!==current){
        try{
          const local=await verifyRetailerListing(alternate.url,name,fetcher,render,env,current);
          if(local.status==='verified'&&local.market_match!==false)return {...local,market_resolved_from:current};
        }catch{/* Keep the original page and label its market. */}
      }
    }
    const snapshots=offers.map(o=>{
      const specs=[].concat(o?.priceSpecification??[]).filter(s=>!String(s?.priceType??'').endsWith('StrikethroughPrice'));
      if(o?.price==null&&specs.length!==1)return null;
      const value=o?.price??specs[0]?.price,currency=o?.priceCurrency??specs[0]?.priceCurrency??details.currency;
      if(currencyWanted&&currency!==currencyWanted)return null;
      if(!['string','number'].includes(typeof value)||!/^\d+(?:\.\d+)?$/.test(String(value))||!Number.isFinite(Number(value))||!/^[A-Z]{3}$/.test(currency??''))return null;
      return {amount:Number(value),currency,source_url:current,checked_at};
    }).filter(Boolean);
    const unique=[...new Map(snapshots.map(p=>[`${p.currency}:${p.amount}`,p])).values()];
    // A price in the store's own currency is shown as such; it is never converted or used for alerts.
    const foreignPrices=unique.length?[]:[...new Map(offers.filter(o=>o?.priceCurrency&&o.priceCurrency!==currencyWanted&&/^\d+(?:\.\d+)?$/.test(String(o.price??''))).map(o=>[o.priceCurrency+':'+o.price,{amount:Number(o.price),currency:o.priceCurrency}])).values()];
    // Stock is known only when every offer reports it; a partial report stays unknown.
    const reported=offers.map(o=>String(o?.availability??'').split('/').pop()),availability=reported.every(Boolean)?[...new Set(reported)]:[];
    let colorOptions=structuredColorOptions(product,current);
    if(!colorOptions.length)colorOptions=shopifyColorOptions(html,current,product);
    if(!colorOptions.length)colorOptions=retailerColorSwatches(html,current);
    if(!colorOptions.length&&(/Shopify\.country|id=["']shopify-features/.test(html)||Array.isArray(product.hasVariant))&&/\/products\/[^/]+$/.test(new URL(current).pathname)){
      try{const dataURL=new URL(current);dataURL.pathname+='.js';dataURL.searchParams.delete('variant');
        const data=await listingFetch(dataURL.href,{redirect:'error',headers:{Accept:'application/json',Cookie:`localization=${country}`},signal:AbortSignal.timeout(6000)},fetcher);
        if(data.ok&&/json/i.test(data.headers.get('content-type')??''))colorOptions=colorOptionsFromProduct(JSON.parse((await listingBytes(data,500000)).toString('utf8')),current,product);
      }catch{}
    }
    const selectedOption=colorOptions.find(c=>c.variant_ids?c.variant_ids.includes(new URL(current).searchParams.get('variant')):new URL(c.url).pathname===new URL(current).pathname);
    const selectedColor=selectedOption?.color;
    const color=typeof product.color==='string'&&product.color.length<=100?product.color.trim():details.color??selectedColor??null;
    const marketMatch=market.country?market.country===country:null;
    // Shipping evidence: the page's structured data first, then a confirmed store policy.
    const pageShipping=marketMatch?null:shipsTo(offers,country),policy=marketMatch||pageShipping!==null?null:storeShipping(current,country);
    return {status:'verified',market_country:country,store_market:market,market_match:marketMatch,ships_to_shopper:pageShipping??policy?.ships_to_us??null,
      shipping_evidence:pageShipping!==null?'product_data':policy?{basis:'store_policy',duties:policy.duties,source:policy.source}:null,foreign_price:foreignPrices.length===1?foreignPrices[0]:null,retrieval,url:current,checked_at,shopping_range:productShoppingRange(html,current,product),color,color_options:details.color_options?.length?details.color_options:colorOptions,product_name:product.name,product_brand:typeof product.brand==='string'?product.brand:product.brand?.name??null,product_sku:product.sku??product.mpn??null,description:typeof product.description==='string'?product.description.slice(0,1000):null,product_images:selectedOption?.image&&new URL(current).searchParams.has('variant')?[selectedOption.image]:listingPhotos(html,name,current),price_status:unique.length===1?'found':unique.length?'variant_prices':'unavailable',price_snapshot:unique.length===1?unique[0]:null,availability:availability.length===1?availability[0]:availability.length&&availability.every(a=>SOLD_OUT.includes(a))?'OutOfStock':null};
  }catch{if(renderedAttempted)return {status:'check_failed',checked_at};try{renderedAttempted=true;const rendered=await render(current);const result=await verifyRetailerListing(rendered.url,name,async()=>new Response(rendered.html,{headers:{'content-type':'text/html'}}),async()=>{throw Error('Already rendered');},env);return {...result,retrieval:'browser'};}catch{return {status:'check_failed',checked_at};}}
}
export async function verifySearchMerchants(result,fetcher=fetch,verify=verifyListing){
  const products=await Promise.all(result.products.map(async p=>{
    if(p.sourcing_status==='store_not_found')return p;
    const sources=[{url:p.url,retailer:p.retailer},...(p.merchant_options??[])];
    const checked=await Promise.all(sources.map(async m=>({...m,listing_check:await verify(m.url,p.name,fetcher)})));
    // Among verified merchants for one product, the shopper's own market is preferred.
    const eligible=checked.filter(m=>m.listing_check.status==='verified').sort((a,b)=>marketRank(a.listing_check)-marketRank(b.listing_check)).map(m=>({...m,url:m.listing_check.url,price_snapshot:m.listing_check.price_snapshot}));
    if(!eligible.length)return {...p,sourcing_status:'store_not_found',merchant_options:[],identity_sources:p.identity_sources??[{url:p.url,name:p.name}],listing_checks:checked.map(m=>({url:m.url,...m.listing_check}))};
    const [best,...others]=eligible;
    return {...p,url:best.url,retailer:best.retailer,sourcing_status:'store_found',listing_check:best.listing_check,price_snapshot:best.price_snapshot,merchant_options:others};
  }));
  return {...result,products,status:products.length&&products.every(p=>p.sourcing_status==='store_not_found')?'identified_no_store':products.some(p=>p.sourcing_status==='store_not_found')?'needs_review':result.status};
}

export async function verifyWishlistRows(rows,fetcher=fetch,verify=verifyListing){
  return Promise.all(rows.map(async row=>{
    const checks=await Promise.all((row.links??[]).map(async link=>({link,check:await verify(link.url,link.name??row.name,fetcher)})));
    const links=checks.flatMap(({link,check})=>check.status==='verified'?[{...link,url:check.url,price_snapshot:check.price_snapshot,availability:check.availability,verification_status:check.verification_basis==='search_index'?'indexed':'verified'}]:link.user_saved===true?[{...link,price_snapshot:null,availability:null,verification_status:'unverified'}]:[]);
    return {...row,links,price_snapshot:null,sourcing_status:links.some(l=>l.verification_status==='verified')?'store_found':links.length?'saved_reference':'store_not_found'};
  }));
}
