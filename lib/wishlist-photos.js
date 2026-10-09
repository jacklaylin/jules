import {fetchListingPhotos} from './product-photos.js';
import {enrichWishlistItem} from './wishlist-details.js';

// Recover imports and interrupted saves using the same listing-photo reader as
// ordinary saves. Failed downloads remain retryable without blocking the item.
export async function repairWishlistPhotos(rows,{conversation,store,photos=fetchListingPhotos,verify,assets,now=Date.now()}={}){
 if(!store.wishlistItem||!store.saveWishlistPhotos)return rows;
 const needsDetails=r=>store.correctWishlistProduct&&(r.links??[]).some(l=>l.user_saved&&l.verification_status==='unverified');
 const missing=[...new Map(rows.filter(r=>(!r.has_image||needsDetails(r))&&!(now-Date.parse(r.photo_attempted_at??'1970-01-01')<300000)).map(r=>[r.item_id,r])).values()].slice(0,2);
 const updates=new Map();
 await Promise.all(missing.map(async row=>{
  try{
   const item=await store.wishlistItem(conversation,row.item_id);if(!item)return;
   const product=item.product;
   if((!product.image||needsDetails(product))&&now-Date.parse(product.photo_attempted_at??'1970-01-01')<300000)return;
   if(needsDetails(row)){
    const result=await enrichWishlistItem(store,conversation,row.item_id,{verify,photos,assets,now});
    updates.set(row.item_id,result.update??{photo_status:product.image?'ready':'retry_pending',photo_attempted_at:new Date(now).toISOString()});
    console.log(JSON.stringify({event:'wishlist_details_recovery',item_id:row.item_id,status:result.status,check_status:result.check?.status,retrieval:result.retrieval}));
    return;
   }
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
 return rows.map(row=>{const update=updates.get(row.item_id);if(!update)return row;const {image,additional_images,...fields}=update;return {...row,...fields,has_image:image?.mime_type??row.has_image};});
}
