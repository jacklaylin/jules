import { listingProduct, merchantURL, listingBytes } from './product-photos.js';

// All shopping links pass this check after identification and before display/delivery.
export async function verifyListing(url, name, fetcher=fetch) {
  let current=merchantURL(url);
  const checked_at=new Date().toISOString();
  if(!current)return {status:'unsupported',checked_at};
  try {
    let response;
    for(let hops=0;hops<=3;hops++){
      response=await fetcher(current,{redirect:'manual',signal:AbortSignal.timeout(6000)});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        current=location&&merchantURL(new URL(location,current).href);
        if(!current||hops===3)return {status:'invalid_redirect',checked_at};
        continue;
      }
      break;
    }
    if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')??''))return {status:'unavailable',checked_at};
    const html=(await listingBytes(response,1500000)).toString('utf8');
    if(/isBotPage\s*=\s*true|<title>[^<]*(?:access denied|just a moment)/i.test(html))return {status:'check_failed',checked_at};
    const product=listingProduct(html,name);
    if(!product)return {status:'not_product',checked_at};
    const offers=[].concat(product.offers??[]).flatMap(o=>o?.offers?[].concat(o.offers):[o]);
    const snapshots=offers.map(o=>{
      const value=o?.price??o?.priceSpecification?.price,currency=o?.priceCurrency??o?.priceSpecification?.priceCurrency;
      if(!['string','number'].includes(typeof value)||!/^\d+(?:\.\d+)?$/.test(String(value))||!Number.isFinite(Number(value))||!/^[A-Z]{3}$/.test(currency??''))return null;
      return {amount:Number(value),currency,source_url:current,checked_at};
    }).filter(Boolean);
    const unique=[...new Map(snapshots.map(p=>[`${p.currency}:${p.amount}`,p])).values()];
    const availability=[...new Set(offers.map(o=>String(o?.availability??'').split('/').pop()).filter(Boolean))];
    return {status:'verified',url:current,checked_at,price_status:unique.length===1?'found':unique.length?'variant_prices':'unavailable',price_snapshot:unique.length===1?unique[0]:null,availability:availability.length===1?availability[0]:null};
  }catch{return {status:'check_failed',checked_at};}
}
export async function verifySearchMerchants(result,fetcher=fetch,verify=verifyListing){
  const products=await Promise.all(result.products.map(async p=>{
    if(p.sourcing_status==='store_not_found')return p;
    const sources=[{url:p.url,retailer:p.retailer},...(p.merchant_options??[])];
    const checked=await Promise.all(sources.map(async m=>({...m,listing_check:await verify(m.url,p.name,fetcher)})));
    const eligible=checked.filter(m=>m.listing_check.status==='verified').map(m=>({...m,url:m.listing_check.url,price_snapshot:m.listing_check.price_snapshot}));
    if(!eligible.length)return {...p,sourcing_status:'store_not_found',merchant_options:[],identity_sources:p.identity_sources??[{url:p.url,name:p.name}],listing_checks:checked.map(m=>({url:m.url,...m.listing_check}))};
    const [best,...others]=eligible;
    return {...p,url:best.url,retailer:best.retailer,sourcing_status:'store_found',listing_check:best.listing_check,price_snapshot:best.price_snapshot,merchant_options:others};
  }));
  return {...result,products,status:products.length&&products.every(p=>p.sourcing_status==='store_not_found')?'identified_no_store':products.some(p=>p.sourcing_status==='store_not_found')?'needs_review':result.status};
}

export async function verifyWishlistRows(rows,fetcher=fetch,verify=verifyListing){
  return Promise.all(rows.map(async row=>{
    const checks=await Promise.all((row.links??[]).map(async link=>({link,check:await verify(link.url,link.name??row.name,fetcher)})));
    const links=checks.filter(({check})=>check.status==='verified').map(({link,check})=>({...link,url:check.url,price_snapshot:check.price_snapshot,availability:check.availability}));
    return {...row,links,price_snapshot:null,sourcing_status:links.length?'store_found':'store_not_found'};
  }));
}
