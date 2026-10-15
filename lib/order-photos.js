import sharp from 'sharp';
import {publicURL} from './public-url.js';
import {listingFetch,listingBytes} from './product-photos.js';
import {MIN_PHOTO_SIDE} from './receipt-email.js';

// Stores the order photo a purchase source pointed at (lib/order-media.js), privately, once per item.
// Downloads one chosen photo with the safe public fetch (no private addresses, bounded size and
// redirects) and stores a resized JPEG. A decoded image that is tiny or banner-shaped is not a
// product photo (tracking pixel, spacer, logo strip) and is rejected.
export async function fetchOrderPhoto(url,fetcher=fetch){
 let current=publicURL(url),response;
 if(!current)throw Error('Unsupported photo URL');
 for(let hops=0;;hops++){
  response=await listingFetch(current,{redirect:'manual',signal:AbortSignal.timeout(5000)},fetcher);
  if(response.status<300||response.status>=400)break;
  current=publicURL(new URL(response.headers.get('location')??'',current).href);
  if(!current||hops===3)throw Error('Invalid photo redirect');
 }
 if(!/^image\/(jpeg|png|webp|gif)(;|$)/i.test(response.headers.get('content-type')??''))throw Error('Invalid image');
 const input=sharp(await listingBytes(response,3000000),{limitInputPixels:25000000});
 const {width,height}=await input.metadata();
 if(!(width>=MIN_PHOTO_SIDE&&height>=MIN_PHOTO_SIDE))throw Error('Image too small');
 if(Math.max(width,height)/Math.min(width,height)>2.5)throw Error('Not a product photo shape');
 const {data,info}=await input.rotate().resize(900,900,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer({resolveWithObject:true});
 return {mime_type:'image/jpeg',data:data.toString('base64'),width:info.width,height:info.height};
}

export const PHOTO_PREFIX='order_photo:';
export const PHOTO_KIND='photo_observation';
// Photos for items that gained an order photo in this step (had: ids that already had one, from photoItems). Each is stored once, as one private
// evidence row keyed to the item: a later import inserting the same id is a no-op, so a re-import
// never duplicates or replaces a photo. Failures leave the item on its outline.
export const photoItems=state=>new Set(state.items.filter(i=>i.order_photo).map(i=>i.id));
export async function orderPhotoEvidence(had,state,{origin,source_type,fetcher=fetch,limit=12,log='history'}){
 const due=state.items.filter(i=>i.order_photo&&!had.has(i.id)).slice(0,limit);
 const results=await Promise.allSettled(due.map(item=>fetchOrderPhoto(item.order_photo.url,fetcher)));
 const evidence=[];let failed=0;
 for(const [n,result]of results.entries()){
  const item=due[n];
  if(result.status==='rejected'){failed++;continue;}
  evidence.push({id:PHOTO_PREFIX+item.id,kind:PHOTO_KIND,origin,source:{type:source_type,id:item.order_photo.source_id??item.source_ids[0]},
   data:{item_id:item.id,photo_source:item.order_photo.source,url:item.order_photo.url,...result.value},recorded_by:'import'});
 }
 if(due.length)console.log(JSON.stringify({event:log+'_order_photos',due:due.length,stored:evidence.length,failed}));
 return evidence;
}

