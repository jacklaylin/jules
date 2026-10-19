import {fetchListingPhotos,fetchProductAssets} from './product-photos.js';
import {lookupIndexedProduct} from './indexed-product.js';
import {enrichWishlistItem} from './wishlist-details.js';

// Recover imports and interrupted saves using the same listing-photo reader as
// ordinary saves. Failed downloads remain retryable without blocking the item.
// Retailers that block page reads (e.g. Mr Porter) fall back to images Google has
// indexed for that exact page. After a few failures the card says the image is
// unavailable instead of pending, and retries slow to once a day.
export const PHOTO_ATTEMPTS=3;
const RETRY_MS=300000,GIVE_UP_MS=86400000;
export async function repairWishlistPhotos(rows,{conversation,store,photos=fetchListingPhotos,verify,assets=fetchProductAssets,indexed=(url,name)=>lookupIndexedProduct(url,name,{env,siteSearch:true}),now=Date.now(),env=process.env}={}){
 if(!store.wishlistItem||!store.saveWishlistPhotos)return rows;
 const cooling=r=>Number(r.photo_attempted_revision??r.details_revision??6)===6&&now-Date.parse(r.photo_attempted_at??'1970-01-01')<(r.photo_status==='unavailable'?GIVE_UP_MS:RETRY_MS);
 const needsDetails=r=>store.correctWishlistProduct&&(Number(r.details_revision??0)<6||r.market_country!==(env.SHOPPING_COUNTRY??'US')||(r.links??[]).some(l=>l.user_saved&&l.verification_status==='unverified'));
 const missing=[...new Map(rows.filter(r=>(!r.has_image||needsDetails(r))&&!cooling(r)).map(r=>[r.item_id,r])).values()].slice(0,2);
 const updates=new Map();
 // The exact saved page first, then Google's index of that same page.
 const listingImages=async product=>{
  const url=product.photo_source_url??product.url;
  try{const images=await photos(url,product.name);if(images[0]?.data)return {images,source:'listing'};}catch{}
  // Paid search: only while the item is still pending, never on the daily retry after giving up.
  if(Number(product.photo_attempts??0)>=PHOTO_ATTEMPTS)throw Error('No photo');
  const found=await indexed(url,product.name);
  if(!found?.product_images?.length)throw Error('No photo');
  const images=await assets(found.product_images,url);
  if(!images[0]?.data)throw Error('No photo');
  return {images,source:'search_index'};
 };
 await Promise.all(missing.map(async row=>{
  try{
   const item=await store.wishlistItem(conversation,row.item_id);if(!item)return;
   const product=item.product;
   if((!product.image||needsDetails(product))&&cooling(product))return;
   if(needsDetails(row)){
    const result=await enrichWishlistItem(store,conversation,row.item_id,{verify,photos,assets,now,env});
    console.log(JSON.stringify({event:'wishlist_details_recovery',item_id:row.item_id,status:result.status,check_status:result.check?.status,retrieval:result.retrieval}));
    // Unverified details still leave the exact saved page to take a photo from.
    if(product.image||result.update?.photo_status==='ready'){updates.set(row.item_id,result.update??{photo_status:'ready',photo_attempted_at:new Date(now).toISOString()});return;}
   }
   let update,source=null;
   if(product.image){update={image:product.image,image_kind:product.image_kind??'product',additional_images:product.additional_images??[],photo_count:product.photo_count??0,photo_status:'ready'};}
   else{
    try{
     const found=await listingImages(product);source=found.source;
     update={image:found.images[0],image_kind:'product',additional_images:found.images.slice(1,3),photo_count:Math.min(2,found.images.length-1),photo_status:'ready',photo_attempts:0};
    }catch{const attempts=Number(product.photo_attempts??0)+1;update={photo_status:attempts>=PHOTO_ATTEMPTS?'unavailable':'retry_pending',photo_attempts:attempts};}
   }
   update.photo_attempted_revision=6;update.photo_attempted_at=new Date(now).toISOString();
   await store.saveWishlistPhotos(conversation,row.item_id,update);
   updates.set(row.item_id,update);
   console.log(JSON.stringify({event:'wishlist_photo_recovery',item_id:row.item_id,status:update.photo_status,source,attempts:update.photo_attempts??null}));
  }catch(error){
   await store.saveWishlistPhotos(conversation,row.item_id,{photo_attempted_revision:6,photo_attempted_at:new Date(now).toISOString()}).catch(()=>{});
   console.log(JSON.stringify({event:'wishlist_photo_recovery_failed',item_id:row.item_id,error_type:error?.name,database_error:error?.message==='Database request failed'}));
  }
 }));
 return rows.map(row=>{const update=updates.get(row.item_id);if(!update)return row;const {image,additional_images,...fields}=update;return {...row,...fields,has_image:Object.hasOwn(update,'image')?image?.mime_type??null:row.has_image};});
}
