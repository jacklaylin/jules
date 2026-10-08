import {fetchListingPhotos} from './product-photos.js';

// Recover imports and interrupted saves using the same listing-photo reader as
// ordinary saves. Failed downloads remain retryable without blocking the item.
export async function repairWishlistPhotos(rows,{conversation,store,photos=fetchListingPhotos,now=Date.now()}={}){
 if(!store.wishlistItem||!store.saveWishlistPhotos)return rows;
 const missing=[...new Map(rows.filter(r=>!r.has_image&&!(now-Date.parse(r.photo_attempted_at??'1970-01-01')<86400000)).map(r=>[r.item_id,r])).values()].slice(0,2);
 const updates=new Map();
 await Promise.all(missing.map(async row=>{
  try{
   const item=await store.wishlistItem(conversation,row.item_id);if(!item)return;
   const product=item.product;
   if(!product.image&&now-Date.parse(product.photo_attempted_at??'1970-01-01')<86400000)return;
   let update;
   if(product.image){update={image:product.image,image_kind:product.image_kind??'product',additional_images:product.additional_images??[],photo_count:product.photo_count??0,photo_status:'ready'};}
   else{
    try{
     const images=await photos(product.photo_source_url??product.url,product.name);
     if(!images[0]?.data)throw Error('No photo');
     update={image:images[0],image_kind:'product',additional_images:images.slice(1,3),photo_count:Math.min(2,images.length-1),photo_status:'ready'};
    }catch{update={photo_status:'retry_pending'};}
   }
   update.photo_attempted_at=new Date(now).toISOString();
   await store.saveWishlistPhotos(conversation,row.item_id,update);
   updates.set(row.item_id,update);
   console.log(JSON.stringify({event:'wishlist_photo_recovery',item_id:row.item_id,status:update.photo_status}));
  }catch{console.log(JSON.stringify({event:'wishlist_photo_recovery_failed',item_id:row.item_id}));}
 }));
 return rows.map(row=>{const update=updates.get(row.item_id);return update?{...row,has_image:update.image?.mime_type??row.has_image,image_kind:update.image_kind??row.image_kind,photo_count:update.photo_count??row.photo_count,photo_status:update.photo_status,photo_attempted_at:update.photo_attempted_at}:row;});
}
