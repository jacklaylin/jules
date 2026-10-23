import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validWishlistPreview,readPreviewProduct,previewItems,escapeHTML} from './wishlist-preview.js';
import {savedPhotoPreview,savedSetPreview} from './link-preview-photo.js';
const images=new Map();
const removed=product=>!product||product.wishlist_removed===true||product.wishlist_removed==='true';
// Never publish inspiration photos, outfit crops or profile evidence.
const productPhoto=product=>product.image_kind==='product'&&product.image?.mime_type==='image/jpeg'?product.image:null;
const productTitle=product=>{const name=String(product.name??'Your saved find');return name.toLowerCase().startsWith(String(product.brand??'').toLowerCase())?name:[product.brand,name].filter(Boolean).join(' ');};
const listed=names=>names.length<2?names.join(''):`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;

// A signed save link (one item, or a save of several): its preview page, or with image=1 its picture.
export function createPreviewHandler({env=process.env,read=readPreviewProduct}={}){
 return async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
  const fail=status=>{res.statusCode=status;res.setHeader('Cache-Control','no-store');res.end('Preview unavailable');};
  if(!['GET','HEAD'].includes(req.method))return fail(405);
  let url;try{url=new URL(req.url,env.SITE_ORIGIN);}catch{return fail(404);}
  if(!validWishlistPreview(url,env))return fail(404);
  try{
   const set=url.searchParams.has('items'),ids=previewItems(url);
   const found=(await Promise.all(ids.map(id=>read(id,env)))).map((product,i)=>({id:ids[i],product})).filter(({product})=>!removed(product));
   if(!found.length)return fail(404);
   if(url.searchParams.get('image')==='1'){
    const photos=found.map(({product})=>productPhoto(product));
    const key=found.map(({id},i)=>id+':'+createHash('sha256').update(photos[i]?.data??'brand').digest('hex')).join('|');let bytes=images.get(key);
    if(!bytes){
     // Each saved item's photo goes in its own LinkPreview card; one item without a photo gets the saved-item art.
     const raw=photos.map(photo=>photo?Buffer.from(photo.data,'base64'):null);
     bytes=found.length>1?await savedSetPreview(raw):raw[0]?await savedPhotoPreview(raw[0])
      :await sharp(await readFile(new URL('../public/brand/previews/saved-v2.png',import.meta.url))).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
     images.set(key,bytes);if(images.size>50)images.delete(images.keys().next().value);
    }
    res.statusCode=200;res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control',photos.every(Boolean)?'public, max-age=300, s-maxage=86400':'public, max-age=60, s-maxage=60');res.setHeader('Content-Length',bytes.length);return res.end(req.method==='HEAD'?undefined:bytes);
   }
   const title=escapeHTML(`Saved: ${listed(found.map(({product})=>productTitle(product)))}`.slice(0,210));
   const canonical=new URL('/api/image?preview=1',env.SITE_ORIGIN);for(const field of set?['items','sig']:['item','v','sig'])canonical.searchParams.set(field,url.searchParams.get(field));
   const image=new URL(canonical);image.searchParams.set('image','1');
   const [destination,label]=set?['/wishlist','Open these items in your private wishlist']:['/wishlist?item='+ids[0],'Open this item in your private wishlist'];
   const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="Your finds, saved by Jules."><meta property="og:type" content="website"><meta property="og:url" content="${escapeHTML(canonical.href)}"><meta property="og:image" content="${escapeHTML(image.href)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/jpeg"><meta name="robots" content="noindex,nofollow"><script src="/wishlist-preview-redirect.js" defer></script></head><body><a href="${destination}">${label}</a></body></html>`;
   res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(req.method==='HEAD'?undefined:html);
  }catch{return fail(503);}
 };
}
export default createPreviewHandler();
