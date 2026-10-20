import sharp from 'sharp';
import { structuredJSON } from './structured-product.js';
import {SOURCE_DOMAINS} from './retailers.js';
import {renderListing} from './rendered-listing.js';
import {publicURL} from './public-url.js';
import {publicFetch} from './public-fetch.js';

export function productPhotoURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^encrypted-tbn\d*\.gstatic\.com$/.test(url.hostname) && url.href.length <= 1200 ? url.href : null;
  } catch { return null; }
}

// Only already-compared Lens thumbnails, never model-generated or arbitrary retailer URLs.
export async function fetchProductPhoto(url, fetcher = fetch) {
  const safe = productPhotoURL(url);
  if (!safe) throw new Error('Unsupported product photo');
  const response = await fetcher(safe, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid product photo');
  if (Number(response.headers.get('content-length')) > 1000000) throw new Error('Product photo too large');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1000000) throw new Error('Product photo too large');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 10000000 })
    .rotate().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  if (bytes.length > 1000000) throw new Error('Product photo too large');
  return bytes;
}


// Read only a selected merchant's structured Product data, never a search/category image.
const assetDomains = [...SOURCE_DOMAINS,'farfetch-contents.com','nordstrommedia.com','img.ssensemedia.com'];
function trustedURL(value, domains) {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))?u.href:null;}catch{return null;}
}
export async function listingBytes(response, limit) {
  if(!response.ok||Number(response.headers.get('content-length'))>limit)throw new Error('Listing unavailable');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('Listing too large');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
}
export const merchantURL=publicURL;
export const productAssetURL=publicURL;
// Existing store fetches retain their behavior; newly supported hosts use DNS-pinned HTTPS.
// The founder's requested market is US. Shopify otherwise picks the server's location.
// Limit this storefront context to the confirmed Satisfy integration; do not convert prices.
export function listingRequestOptions(url,options={}){
 const u=new URL(url),headers=new Headers(options.headers);
 if(u.hostname.replace(/^www\./,'')==='satisfyrunning.com'&&!/^\/[a-z]{2}(?:-[a-z]{2})?\//i.test(u.pathname)&&!['country','currency','market'].some(key=>u.searchParams.has(key))&&!headers.has('Cookie'))headers.set('Cookie','localization=US');
 return {...options,headers};
}
export const listingFetch=(url,options,fetcher=fetch)=>{
 const request=listingRequestOptions(url,options);
 return fetcher===fetch&&!trustedURL(url,assetDomains)?publicFetch(url,request):fetcher(url,request);
};
export function listingProduct(html, name, pageURL,{minimumMatch=0.6}={}) {
  const products=[],groups=[];let collection=false;
  const walk=value=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object'){if([].concat(value['@type']??[]).some(t=>['CollectionPage','ItemList'].includes(t)))collection=true;if([].concat(value['@type']??[]).includes('Product'))products.push(value);if([].concat(value['@type']??[]).includes('ProductGroup'))groups.push(value);if(value['@graph'])walk(value['@graph']);}};
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(structuredJSON(match[1]));}catch{}}
  const normalized=value=>String(value??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const matches=p=>{
    const stem=w=>w.length>3&&w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w;
    const brand=normalized(typeof p.brand==='string'?p.brand:p.brand?.name).split(' ').map(stem);
    // Connecting words, a company suffix and the brand's own words ("Thursday Boot Company" for the
    // brand "Thursday Boots") never identify a product.
    const words=value=>normalized(value).split(' ').filter(w=>(w.length>=2||/^\d+$/.test(w))&&!['men','mens','women','womens','for','the','and','by','in','of','with','co','company'].includes(w)&&!brand.includes(stem(w)));
    if(!name)return true;
    const expected=words(name),title=words(p.name);
    let path=[];try{path=pageURL&&title.length?words(decodeURIComponent(new URL(pageURL).pathname.split('/').filter(Boolean).at(-1)??'')):[];}catch{}
    // Retailers join or split model tokens (XT-6 / XT6, Speed Rock /
    // Speedrock). Compare whole adjacent token groups, never substrings.
    const covered=(actual,plural=false)=>{
      const key=w=>plural?stem(w):w;
      const joined=new Set();
      for(const list of actual)for(let i=0;i<list.length;i++)for(let n=1;n<=3;n++)if(i+n<=list.length)joined.add(key(list.slice(i,i+n).join('')));
      const matched=new Set();
      for(let i=0;i<expected.length;i++)for(let n=1;n<=3;n++)if(i+n<=expected.length&&joined.has(key(expected.slice(i,i+n).join(''))))for(let j=i;j<i+n;j++)matched.add(j);
      return {ratio:expected.length?matched.size/expected.length:0,numbers:expected.every((w,i)=>! /\d/.test(w)||matched.has(i))};
    };
    const enough=({ratio,numbers},minimum)=>expected.length>0&&numbers&&ratio>=minimum;
    if(enough(covered([title]),minimumMatch))return true;
    // A short store title ("Desperado | Black Matte") can be described more fully by its own page path
    // (/products/mens-desperado-square-toe-cowboy-boots-black-matte). The path's words count when every
    // word of the store's title is in the requested name, so the title still agrees with it, or, when
    // the title only refines it ("matte"), when the title and path together hold every requested word
    // (plural or singular), so a different colour or model on the page still fails.
    if(!path.length)return false;
    if(title.every(w=>expected.includes(w))&&enough(covered([title,path]),minimumMatch))return true;
    return title.every(w=>expected.includes(w)||path.includes(w))&&enough(covered([title,path],true),1);
  };
  const bound=value=>{try{const u=new URL(value,pageURL),page=new URL(pageURL);return u.origin===page.origin&&u.pathname.replace(/\/$/,'')===page.pathname.replace(/\/$/,'')&&[...page.searchParams].filter(([k])=>! /^(?:utm_|country$)/i.test(k)).every(([k,v])=>u.searchParams.get(k)===v);}catch{return false;}};
  if(pageURL){
    const candidates=groups.flatMap(group=>{
      if(!matches(group)&&![].concat(group.hasVariant??[]).some(matches))return [];
      if(!new URL(pageURL).searchParams.has('variant')&&new Set([].concat(group.hasVariant??[]).map(p=>p.color).filter(Boolean)).size>1&&[group.url,group['@id']].filter(Boolean).some(bound))return [{...group,'@type':'Product',url:pageURL,color:null,offers:[]}];
      const variants=[].concat(group.hasVariant??[]).filter(p=>[p.url,p['@id'],...[].concat(p.offers??[]).map(o=>o?.url)].filter(Boolean).some(bound));
      const colors=[...new Set(variants.map(p=>p.color).filter(Boolean))];
      if(!variants.length||colors.length>1)return [];
      const selected=new URL(pageURL).searchParams.has('variant');
      return [{...group,...(selected&&variants.length===1?variants[0]:{}),'@type':'Product',url:pageURL,color:colors[0]??null,offers:variants.flatMap(p=>[].concat(p.offers??[])),image:variants[0].image??group.image}];
    });
    if(candidates.length===1)return candidates[0];
    if(groups.length&&new URL(pageURL).searchParams.has('variant'))return null;
  }
  if(pageURL){
    const specific=products.filter(p=>[p.url,p['@id'],...[].concat(p.offers??[]).map(o=>o?.url)].filter(Boolean).some(bound));
    if(specific.length===1&&matches(specific[0]))return specific[0];
    if(new URL(pageURL).searchParams.has('variant'))return null;
  }
  if(!collection&&products.length===1&&matches(products[0]))return products[0];
  // Product metadata can establish a link even when commerce data is unavailable.
  // Require an exact canonical page, explicit product type, and a matching page title.
  if(!products.length&&!collection&&pageURL){
    const meta={};let canonical;
    for(const tag of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)){
      const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2]]));
      if(attrs.rel==='canonical')canonical=attrs.href;
      if(attrs.property||attrs.name)meta[attrs.property??attrs.name]=attrs.content;
    }
    if(meta['og:type']==='product'&&canonical&&bound(canonical)&&meta['og:title']){
      const candidate={name:meta['og:title'],url:pageURL,gender:meta['product:gender']};
      if(matches(candidate))return candidate;
    }
  }
  return null;
}
export function listingPhotos(html,name,pageURL){
  const product=listingProduct(html,name,pageURL);if(!product)return [];
  const images=[].concat(product.image??[]).map(i=>typeof i==='string'?i:i?.url??i?.contentUrl).filter(Boolean);
  // The exact product has already been validated. Its Open Graph image can
  // replace an unresolved CDN template in structured Product metadata.
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
    const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2]]));
    if(!pageURL||!new URL(pageURL).searchParams.has('variant'))if(['og:image','og:image:secure_url'].includes(attrs.property))images.push(attrs.content);
  }
  return [...new Set(images.map(u=>{try{return new URL(u,pageURL).href;}catch{return null;}}).filter(u=>typeof u==='string'&&!u.includes('__IMAGE_PARAMS__')&&productAssetURL(u)))].slice(0,3);
}
export async function fetchListingPhotos(url, name, fetcher=fetch,render=renderListing) {
  const safe=merchantURL(url);if(!safe)throw new Error('Unsupported merchant');
  let html,rendered=false;try{const response=await listingFetch(safe,{redirect:'error',signal:AbortSignal.timeout(6000)},fetcher);if(!/text\/html/i.test(response.headers.get('content-type')??''))throw Error('Invalid listing');html=(await listingBytes(response,1500000)).toString('utf8');}catch{html=(await render(safe)).html;rendered=true;}
  let urls=listingPhotos(html,name,safe);
  if(!urls.length&&!rendered){const page=await render(safe);if(merchantURL(page.url)!==safe)throw Error('Listing changed');urls=listingPhotos(page.html,name,safe);}
  if(!urls.length)throw new Error('Product images unavailable');
  return fetchProductAssets(urls,safe,fetcher);
}
export async function downloadProductAsset(imageURL,fetcher=fetch){
  let current=productAssetURL(imageURL),photo;if(!current)throw Error('Unsupported photo URL');
  for(let hops=0;hops<=3;hops++){photo=await listingFetch(current,{redirect:'manual',signal:AbortSignal.timeout(5000)},fetcher);if(photo.status>=300&&photo.status<400){current=productAssetURL(new URL(photo.headers.get('location'),current).href);if(!current||hops===3)throw Error('Invalid photo redirect');continue;}break;}
  if(!/^image\/(jpeg|png|webp)(;|$)/i.test(photo.headers.get('content-type')??''))throw new Error('Invalid image');
  return listingBytes(photo,3000000);
}
export const productAssetJPEG=bytes=>sharp(bytes,{limitInputPixels:25000000}).rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();
// Asset URLs must have come from an exact-page data observation, never model output.
export async function fetchProductAssets(urls,sourceURL,fetcher=fetch){
  if(!merchantURL(sourceURL))throw Error('Unsupported merchant');
  const images=[];
  for(const imageURL of [...new Set(urls)].filter(productAssetURL).slice(0,3)){try{
    const data=await productAssetJPEG(await downloadProductAsset(imageURL,fetcher));
    images.push({mime_type:'image/jpeg',data:data.toString('base64'),source_url:sourceURL,asset_url:imageURL});
  }catch{}}
  if(!images.length)throw new Error('Product images unavailable');return images;
}
