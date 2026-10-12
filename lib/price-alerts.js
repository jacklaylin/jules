import { merchantURL, listingBytes, listingProduct,listingFetch } from './product-photos.js';
import {renderListing} from './rendered-listing.js';
import { structuredJSON,pradaProductDetails } from './structured-product.js';

export const sizeKey = value => String(value).trim().replace(/\s+/g, ' ').toUpperCase();
const sizeLabel = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : String(value?.name ?? '').trim();
// Prada's Nuxt payload binds each size to a SKU and online inventory. Read data,
// never execute page scripts or treat a bare retailer size as a user's system.
export function pradaSizeOffers(html,url,product,checked_at){
 if(!['prada.com','www.prada.com'].includes(new URL(url).hostname))return [];
 try{
  const match=html.match(/<script\b[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const values=JSON.parse(match?.[1]??'null');if(!Array.isArray(values))return [];
  const value=ref=>Number.isInteger(ref)&&ref>=0?values[ref]:undefined;
  const sku=new URL(url).pathname.split('/').filter(Boolean).at(-1);
  const candidates=values.filter(v=>v&&typeof v==='object'&&!Array.isArray(v)&&value(v.partNumber)===sku&&Array.isArray(value(v.sizeCodes)));
  if(candidates.length!==1)return [];
  const payload=candidates[0],offer=[].concat(product.offers??[]);
  const amount=offer.length===1?Number(offer[0].price):NaN,currency=offer[0]?.priceCurrency??pradaProductDetails(html,url,product).currency;
  const price=Number.isFinite(amount)&&amount>0&&/^[A-Z]{3}$/.test(currency??'')?{amount,currency}:{};
  const systems=new Map();
  for(const v of values){if(v&&typeof v==='object'&&!Array.isArray(v)){
   const label=value(v.labelToShow),code=value(v.code);
   if(label==='prnux_sizepicker_uk')systems.set(code,'UK');
   if(label==='prnux_sizepicker_it')systems.set(code,'IT');
  }}
  return value(payload.sizeCodes).flatMap(ref=>{
   const row=value(ref);if(!row||Array.isArray(row)||typeof row!=='object')return [];
   const part=value(row.partNumberSize),identifier=value(row.identifier),number=value(row.value);
   const system=typeof identifier==='string'?systems.get(identifier.slice(0,2)):null;
   if(!system||typeof number!=='string'||!number||value(row.colorProductId)!==sku||part!==sku+'_'+identifier)return [];
   const size='Prada '+number.replace(',','.');
   return [{size,key:sizeKey(size),url,name:product.name,checked_at,...price,
    available:value(row.online)===true&&value(row.inventoryStatus)==='Available'&&Number(value(row.availableQuantity))>0,
    retailer_sku:part,size_source:'retailer_inventory'}];
  });
 }catch{return [];}
}
export function parseSizeOffers(html, expected, url, checked_at = new Date().toISOString()) {
  const products=[];
  const walk=value=>{
    if(Array.isArray(value))return value.forEach(walk);
    if(!value||typeof value!=='object')return;
    const types=[].concat(value['@type']??[]);
    if(types.includes('Product')||types.includes('ProductGroup'))products.push(value);
    if(value['@graph'])walk(value['@graph']);
  };
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(structuredJSON(match[1]));}catch{}}
  const single=products.length===1?products[0]:null;
  const identity=single&&'<script type="application/ld+json">'+JSON.stringify({...single,'@type':'Product',url})+'</script>';
  const root=identity&&listingProduct(identity,expected,url)?single:null;
  if(!root)return [];
  const rows=[];
  const read=(product,parentName)=>{
    const sizes=[].concat(product.size??[]).map(sizeLabel).filter(s=>s&&s.length<=80);
    for(const offer of [].concat(product.offers??[])){
      if(!offer||typeof offer!=='object'||offer.offers)continue; // Aggregate prices do not establish variant prices.
      const specific=sizeLabel(offer.itemOffered?.size);
      const labels=specific?[specific]:sizes;
      const raw=offer.price??offer.priceSpecification?.price;
      const currency=offer.priceCurrency??offer.priceSpecification?.priceCurrency;
      const amount=/^\d+(?:\.\d+)?$/.test(String(raw))?Number(raw):null;
      const price=Number.isFinite(amount)&&amount>0&&/^[A-Z]{3}$/.test(currency??'')?{amount,currency}:null;
      for(const size of labels)rows.push({size,key:sizeKey(size),url,name:product.name||parentName,checked_at,...price,
        // A shared offer for several sizes cannot prove that a particular size is available.
        available:(specific||sizes.length===1)&&String(offer.availability??'').split('/').pop()==='InStock'});
    }
    for(const size of sizes)if(!rows.some(r=>r.key===sizeKey(size)))rows.push({size,key:sizeKey(size),url,name:product.name||parentName,checked_at,available:false});
    for(const variant of [].concat(product.hasVariant??[]))if(variant&&typeof variant==='object')read(variant,product.name||parentName);
  };
  read(root,root.name);
  rows.push(...pradaSizeOffers(html,url,root,checked_at));
  if(['natalino.co','www.natalino.co'].includes(new URL(url).hostname)){
    // Natalino embeds Shopify's actual variant inventory in its stock-control script.
    const price=root.offers;
    const amount=Number(price?.price??(price?.lowPrice===price?.highPrice?price?.lowPrice:NaN));
    const currency=price?.priceCurrency;
    const sizeOption=html.match(/options:\s*(\[\{"name":"Size","position":1,"values":\[[^\]]*\]\}\])/);
    let allowed=[];try{allowed=JSON.parse(sizeOption?.[1]??'[]')[0]?.values??[];}catch{}
    for(const script of html.matchAll(/<script\b[^>]*data-app=["']esc-out-of-stock["'][^>]*>([\s\S]*?)<\/script>/gi)){
      let variants=[];try{variants=JSON.parse(script[1]);}catch{}
      if(!Array.isArray(variants))continue;
      for(const variant of variants){
        const size=sizeLabel(variant.option1);if(!allowed.includes(size)||variant.option2||variant.option3)continue;
        const exactPrice=Number.isFinite(amount)&&amount>0&&variant.price===Math.round(amount*100)&&/^[A-Z]{3}$/.test(currency??'');
        rows.push({size,key:sizeKey(size),url,name:root.name,checked_at,...(exactPrice?{amount,currency}:{}),available:variant.available===true});
      }
    }
  }
  // Barbour's Salesforce storefront publishes size/stock in its native selector,
  // separately from the one fixed product price in JSON-LD.
  if(new URL(url).hostname==='www.barbour.com'||new URL(url).hostname==='barbour.com'){
    const offers=[].concat(root.offers??[]);
    const raw=offers.length===1?offers[0]?.price:null,currency=offers[0]?.priceCurrency;
    const amount=/^\d+(?:\.\d+)?$/.test(String(raw))?Number(raw):null;
    const price=Number.isFinite(amount)&&amount>0&&/^[A-Z]{3}$/.test(currency??'')?{amount,currency}:{};
    for(const select of html.matchAll(/<select\b[^>]*class=["'][^"']*\bselect-size\b[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi)){
      for(const option of select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)){
        const size=option[1].match(/\bdata-attr-value=["']([^"']+)["']/i)?.[1];
        if(!size||size.length>80)continue;
        const disabled=/\bdisabled(?:\s|=|$)/i.test(option[1])||/aria-disabled=["']true["']/i.test(option[1]);
        const value=option[1].match(/(?:^|\s)value=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g,'&');
        let bound=false;
        try{const variant=new URL(value,url);const pid=variant.searchParams.get('pid');bound=variant.origin===new URL(url).origin&&variant.pathname.endsWith('/Product-Variation')&&pid&&variant.searchParams.get(`dwvar_${pid}_size`)===size&&url.toUpperCase().includes(pid.toUpperCase());}catch{}
        rows.push({size,key:sizeKey(size),url,name:root.name,checked_at,...price,available:!disabled&&Boolean(bound)&&String(offers[0]?.availability??'').split('/').pop()==='InStock'});
      }
    }
  }
  // SSENSE publishes stock per native size in its exact product selector.
  if(new URL(url).hostname.replace(/^www\./,'')==='ssense.com'){
   const offers=[].concat(root.offers??[]),offer=offers.length===1?offers[0]:null;
   const amount=/^\d+(?:\.\d+)?$/.test(String(offer?.price))?Number(offer.price):NaN;
   const currency=offer?.priceCurrency;
   if(Number.isFinite(amount)&&amount>0&&/^[A-Z]{3}$/.test(currency??'')){
    for(const selector of html.matchAll(/<select\b[^>]*id=["']size-dropdown["'][^>]*>([\s\S]*?)<\/select>/gi)){
     for(const option of selector[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)){
      const id=option[1].match(/\bvalue=["'](\d+)["']/)?.[1];
      const label=option[2].trim().match(/^((?:IT|EU|UK|US) \d+(?:\.\d+)?)(?:\s*-\s*[^<>]*)?$/);
      if(!id||!label)continue;
      const size=label[1];rows.push({size,key:sizeKey(size),url,name:root.name,checked_at,amount,currency,retailer_size_id:id,size_source:'retailer_selector',available:! /\bdisabled(?:\s|=|$)/i.test(option[1])&&String(offer.availability??'').split('/').pop()==='InStock'});
     }
    }
   }
  }
  // Satisfy's ProductGroup explicitly labels every system on each exact variant.
  // These are retailer-provided equivalences, never generic size conversions.
  if(new URL(url).hostname.replace(/^www\./,'')==='satisfyrunning.com'){
   const page=new URL(url),chosen=page.searchParams.get('variant');
   for(const variant of [].concat(root.hasVariant??[])){
    const offers=[].concat(variant?.offers??[]);if(offers.length!==1)continue;
    const offer=offers[0];let source;try{source=new URL(offer.url,url);}catch{continue;}
    if(source.origin!==page.origin||source.pathname!==page.pathname||!source.searchParams.get('variant')||chosen&&chosen!==source.searchParams.get('variant'))continue;
    const amount=/^\d+(?:\.\d+)?$/.test(String(offer.price))?Number(offer.price):NaN;
    if(!Number.isFinite(amount)||amount<=0||!/^[A-Z]{3}$/.test(offer.priceCurrency??''))continue;
    for(const match of String(variant.name??'').matchAll(/(?:^|\/)\s*(US M|US W|UK|EU|JP)\s*(\d+(?:[.,]\d+)?)([½¼¾]?)\s*(?=\/|$)/g)){
     const system={'US M':'US men','US W':'US women',UK:'UK',EU:'EU',JP:'JP'}[match[1]];
     const number=Number(match[2].replace(',','.'))+({'½':0.5,'¼':0.25,'¾':0.75}[match[3]]??0),size=system+' '+number;
     rows.push({size,key:sizeKey(size),url,name:root.name,checked_at,amount,currency:offer.priceCurrency,available:String(offer.availability??'').split('/').pop()==='InStock',retailer_sku:variant.sku,variant_url:source.href,size_source:'retailer_variant_labels'});
    }
   }
  }
  return rows;
}
export async function readSizeOffers(link,fetcher=fetch,{render=renderListing}={}){
  let url=merchantURL(link.url);
  if(!url)return {url:link.url,offers:[],status:'unsupported'};
  try{
    let response;
    for(let n=0;n<4;n++){
      response=await listingFetch(url,{redirect:'manual',signal:AbortSignal.timeout(6000),...(link.market_country?{headers:{Cookie:'localization='+link.market_country}}:{})},fetcher);
      if(response.status>=300&&response.status<400){const location=response.headers.get('location');url=location&&merchantURL(new URL(location,url).href);if(!url||n===3)throw new Error();continue;}break;
    }
    let html;
    if(!response.ok){
      if(![403,429,503].includes(response.status))throw Error('Listing unavailable');
      const page=await render(url);const source=new URL(page.url),wanted=new URL(url);
      if(source.origin!==wanted.origin||source.pathname!==wanted.pathname||source.search!==wanted.search)throw Error('Listing changed');html=page.html;
    }else{if(!/text\/html/i.test(response.headers.get('content-type')??''))throw Error('Listing unavailable');html=(await listingBytes(response,1500000)).toString('utf8');}

    if(link.color){
      const product=listingProduct(html,link.name,url);
      const normalize=value=>String(value??'').trim().toLowerCase();
      const variants=[].concat(product?.hasVariant??[]);
      if(!product||normalize(product.color??pradaProductDetails(html,url,product).color)!==normalize(link.color)||variants.some(v=>v?.color&&normalize(v.color)!==normalize(link.color)))return {url:link.url,offers:[],status:'color_unverified'};
    }
    const offers=parseSizeOffers(html,link.name,url).filter(o=>!link.market_currency||o.currency===link.market_currency).map(o=>({...o,url:link.url}));
    // Size mappings are explicit evidence from the product's official chart,
    // not generic conversions between the user's usual sizing systems.
    for(const mapping of link.verified_size_mappings??[]){
      if(mapping.source_url!==link.url||!mapping.checked_at||!mapping.requested_size||!mapping.retailer_size)continue;
      for(const row of offers.filter(o=>o.key===sizeKey(mapping.retailer_size)))offers.push({...row,size:mapping.requested_size,key:sizeKey(mapping.requested_size),retailer_size:row.size,size_chart_source:mapping.source_url});
    }
    return {url:link.url,offers,status:'checked'};
  }catch{return {url:link.url,offers:[],status:'unavailable'};}
}
export async function inspectAlertLinks(links,reader=readSizeOffers){
  const checks=await Promise.all(links.map(link=>reader(link)));
  const sizes=[...new Map(checks.flatMap(c=>c.offers).map(o=>[sizeKey(o.size),sizeLabel(o.size)])).values()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return {sizes,checks};
}
export function baselineOffers(checks,size){
  const key=sizeKey(size), rows=checks.flatMap(c=>c.offers).filter(o=>o.key===key&&Number.isFinite(o.amount)&&o.amount>0&&/^[A-Z]{3}$/.test(o.currency??''));
  // Conflicting prices for the same size/currency are ambiguous, not a cheapest-price opportunity.
  return rows.filter(o=>!rows.some(p=>p.url===o.url&&p.currency===o.currency&&p.amount!==o.amount))
    .filter((o,i,all)=>all.findIndex(p=>p.url===o.url&&p.currency===o.currency)===i);
}
export function priceDrop(baseline,current){
  return current.available===true&&baseline.key===current.key&&baseline.currency===current.currency&&
    Number.isFinite(current.amount)&&current.amount>0&&baseline.amount>0&&current.amount<baseline.amount*(baseline.drop_percent===0?1:0.9)-1e-8;
}
export function lowestAvailable(offers){
  const lowest=new Map();
  for(const offer of offers){if(offer.available!==true||!Number.isFinite(offer.amount)||offer.amount<=0)continue;const key=`${offer.key}:${offer.currency}`;if(!lowest.has(key)||offer.amount<lowest.get(key).amount)lowest.set(key,offer);}
  return [...lowest.values()];
}

export function initialPriceBaselines(offers){
 const available=lowestAvailable(offers);
 if(available.length)return available;
 // A verified size price can be the baseline while that size is out of stock.
 // Notifications still require verified current stock through priceDrop.
 const lowest=new Map();
 for(const offer of offers){
  if(!Number.isFinite(offer.amount)||offer.amount<=0)continue;
  const key=offer.key+':'+offer.currency;
  if(!lowest.has(key)||offer.amount<lowest.get(key).amount)lowest.set(key,offer);
 }
 return [...lowest.values()];
}
