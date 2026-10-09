import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validWishlistPreview,readPreviewProduct,escapeHTML} from './wishlist-preview.js';
const images=new Map();
export function createPreviewHandler({env=process.env,read=readPreviewProduct}={}){
 return async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
  const fail=status=>{res.statusCode=status;res.setHeader('Cache-Control','no-store');res.end('Preview unavailable');};
  if(!['GET','HEAD'].includes(req.method))return fail(405);
  let url;try{url=new URL(req.url,env.SITE_ORIGIN);}catch{return fail(404);}
  if(!validWishlistPreview(url,env))return fail(404);
  try{
   const item=url.searchParams.get('item'),product=await read(item,env);
   if(!product||product.wishlist_removed===true||product.wishlist_removed==='true')return fail(404);
   if(url.searchParams.get('image')==='1'){
    // Never publish inspiration photos, outfit crops or profile evidence.
    const photo=product.image_kind==='product'&&product.image?.mime_type==='image/jpeg'?product.image:null;
    const key=item+':'+createHash('sha256').update(photo?.data??'brand').digest('hex');let bytes=images.get(key);
    if(!bytes){
     const source=photo?Buffer.from(photo.data,'base64'):await readFile(new URL('../public/brand/wordmark.svg',import.meta.url));
     bytes=await sharp(source,{limitInputPixels:25000000}).rotate().resize(1200,630,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).jpeg({quality:80}).toBuffer();
     images.set(key,bytes);if(images.size>50)images.delete(images.keys().next().value);
    }
    res.statusCode=200;res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control',photo?'public, max-age=300, s-maxage=86400':'public, max-age=60, s-maxage=60');res.setHeader('Content-Length',bytes.length);return res.end(req.method==='HEAD'?undefined:bytes);
   }
   const name=String(product.name??'Your saved find');
   const title=escapeHTML(`Saved: ${name.toLowerCase().startsWith(String(product.brand??'').toLowerCase())?name:[product.brand,name].filter(Boolean).join(' ')}`.slice(0,210));
   const canonical=new URL('/api/image?preview=1',env.SITE_ORIGIN);for(const field of ['item','v','sig'])canonical.searchParams.set(field,url.searchParams.get(field));
   const image=new URL(canonical);image.searchParams.set('image','1');const destination='/wishlist?item='+item;
   const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="Your finds, saved by Jules."><meta property="og:type" content="website"><meta property="og:url" content="${escapeHTML(canonical.href)}"><meta property="og:image" content="${escapeHTML(image.href)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/jpeg"><meta name="robots" content="noindex,nofollow"><script src="/wishlist-preview-redirect.js" defer></script></head><body><a href="${destination}">Open this item in your private wishlist</a></body></html>`;
   res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(req.method==='HEAD'?undefined:html);
  }catch{return fail(503);}
 };
}
export default createPreviewHandler();
