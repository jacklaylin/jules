import { merchantURL, listingBytes } from './product-photos.js';

export const sizeKey = value => String(value).trim().replace(/\s+/g, ' ').toUpperCase();
const sizeLabel = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : String(value?.name ?? '').trim();
export function parseSizeOffers(html, expected, url, checked_at = new Date().toISOString()) {
  const products=[];
  const walk=value=>{
    if(Array.isArray(value))return value.forEach(walk);
    if(!value||typeof value!=='object')return;
    const types=[].concat(value['@type']??[]);
    if(types.includes('Product')||types.includes('ProductGroup'))products.push(value);
    if(value['@graph'])walk(value['@graph']);
  };
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(match[1]));}catch{}}
  const words=s=>String(s).toLowerCase().match(/[a-z0-9]{3,}/g)??[];
  const desired=words(expected);
  const root=products.find(p=>desired.length&&desired.filter(w=>words(p.name).includes(w)).length/desired.length>=0.6);
  if(!root||products.length!==1)return [];
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
  return rows;
}
export async function readSizeOffers(link,fetcher=fetch){
  let url=merchantURL(link.url);
  if(!url)return {url:link.url,offers:[],status:'unsupported'};
  try{
    let response;
    for(let n=0;n<4;n++){
      response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(6000)});
      if(response.status>=300&&response.status<400){const location=response.headers.get('location');url=location&&merchantURL(new URL(location,url).href);if(!url||n===3)throw new Error();continue;}break;
    }
    if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')??''))throw new Error();
    const html=(await listingBytes(response,1500000)).toString('utf8');
    return {url:link.url,offers:parseSizeOffers(html,link.name,url).map(o=>({...o,url:link.url})),status:'checked'};
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
    Number.isFinite(current.amount)&&current.amount>0&&baseline.amount>0&&current.amount<baseline.amount*0.9-1e-8;
}
export function lowestAvailable(offers){
  const lowest=new Map();
  for(const offer of offers){if(offer.available!==true||!Number.isFinite(offer.amount)||offer.amount<=0)continue;const key=`${offer.key}:${offer.currency}`;if(!lowest.has(key)||offer.amount<lowest.get(key).amount)lowest.set(key,offer);}
  return [...lowest.values()];
}
