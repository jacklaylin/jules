import sharp from 'sharp';
import { structuredJSON } from './structured-product.js';

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
    .rotate().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  if (bytes.length > 1000000) throw new Error('Product photo too large');
  return bytes;
}


// Read only a selected merchant's structured Product data, never a search/category image.
const merchantDomains = ['prada.com','barbour.com','paulsmith.com','asics.com','jwanderson.com','farfetch.com','ssense.com','mrporter.com','net-a-porter.com','nordstrom.com','mytheresa.com','natalino.co'];
const assetDomains = ['prada.com','barbour.com','paulsmith.com','asics.com','jwanderson.com','farfetch-contents.com','ssense.com','mrporter.com','net-a-porter.com','nordstrommedia.com','mytheresa.com'];
function trustedURL(value, domains) {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))?u.href:null;}catch{return null;}
}
export async function listingBytes(response, limit) {
  if(!response.ok||Number(response.headers.get('content-length'))>limit)throw new Error('Listing unavailable');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('Listing too large');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
}
export const merchantURL=value=>trustedURL(value,merchantDomains);
export function listingProduct(html, name) {
  const products=[];let collection=false;
  const walk=value=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object'){if([].concat(value['@type']??[]).some(t=>['CollectionPage','ItemList'].includes(t)))collection=true;if([].concat(value['@type']??[]).includes('Product'))products.push(value);if(value['@graph'])walk(value['@graph']);}};
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(structuredJSON(match[1]));}catch{}}
  const words=value=>String(value).toLowerCase().match(/[a-z0-9]{3,}/g)??[];
  const expected=words(name), product=products.find(p=>expected.length&&expected.filter(w=>words(p.name).includes(w)).length/expected.length>=0.6);
  return !collection&&products.length===1?product:null;
}
export function listingPhotos(html,name){
  const product=listingProduct(html,name);if(!product)return [];
  return [].concat(product.image??[]).map(i=>typeof i==='string'?i:i?.url).filter(u=>trustedURL(u,assetDomains)).slice(0,3);
}
export async function fetchListingPhotos(url, name, fetcher=fetch) {
  const safe=trustedURL(url,merchantDomains);if(!safe)throw new Error('Unsupported merchant');
  const response=await fetcher(safe,{redirect:'error',signal:AbortSignal.timeout(6000)});
  if(!/text\/html/i.test(response.headers.get('content-type')??''))throw new Error('Invalid listing');
  const urls=listingPhotos((await listingBytes(response,1500000)).toString('utf8'),name);
  if(!urls.length)throw new Error('Product images unavailable');
  const images=[];
  for(const imageURL of urls){try{
    const photo=await fetcher(imageURL,{redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!/^image\/(jpeg|png|webp)(;|$)/i.test(photo.headers.get('content-type')??''))throw new Error('Invalid image');
    const data=await sharp(await listingBytes(photo,3000000),{limitInputPixels:25000000}).rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
    images.push({mime_type:'image/jpeg',data:data.toString('base64'),source_url:safe});
  }catch{}}
  if(!images.length)throw new Error('Product images unavailable');return images;
}
