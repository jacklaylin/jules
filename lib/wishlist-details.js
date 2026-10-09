import {verifyListing} from './listings.js';
import {fetchListingPhotos,fetchProductAssets} from './product-photos.js';
import {sameProductURL} from './indexed-product.js';
// Repair an owned saved reference using only that exact retailer page.
export async function enrichWishlistItem(store,conversation,id,{verify=verifyListing,photos=fetchListingPhotos,assets=fetchProductAssets,now=Date.now()}={}){
 const item=await store.wishlistItem(conversation,id);if(!item)throw Error('Item not found');
 const p=item.product,check=await verify(p.url,null);
 if(check.status!=='verified'||!sameProductURL(check.url,p.url)){
  let identity={};try{const saved=new URL(p.url),retrieved=new URL(check.url);identity={same_host:saved.hostname.replace(/^www\./,'')===retrieved.hostname.replace(/^www\./,''),same_path:saved.pathname===retrieved.pathname,same_query:saved.search===retrieved.search,locale_redirect:saved.pathname===retrieved.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'')};}catch{}
  console.log(JSON.stringify({event:'wishlist_details_check_rejected',status:check.status,...identity}));
  await store.saveWishlistPhotos?.(conversation,id,{photo_status:p.image?'ready':'retry_pending',photo_attempted_at:new Date(now).toISOString()});
  return {status:'retry_pending',check};
 }
 // Keep the saved URL and variant identity; www/tracking canonicalization is harmless.
 const price=check.price_snapshot&&sameProductURL(check.price_snapshot.source_url,p.url)?{...check.price_snapshot,source_url:p.url}:null;
 const links=(p.links??[]).map(l=>l.url===p.url?{...l,name:check.product_name,price_snapshot:price,availability:check.availability,verification_status:check.verification_basis==='search_index'?'indexed':'verified'}:l);
 const update={name:check.product_name,display_name:check.product_brand&&!check.product_name.toLowerCase().startsWith(check.product_brand.toLowerCase())?check.product_brand+' '+check.product_name:check.product_name,brand:check.product_brand??p.brand,description:check.description??p.description,links,listing_check:check,product_data:check.product_data,price_snapshot:price,sourcing_status:'store_found'};
 await store.correctWishlistProduct(conversation,id,update);
 let images=[];if(!p.image)try{images=check.product_images?.length?await assets(check.product_images,p.url):await photos(p.url,check.product_name);}catch{}
 const photoUpdate={...(images.length?{image:images[0],additional_images:images.slice(1,3),image_kind:'product',photo_count:Math.min(2,images.length-1)}:{}),photo_status:images.length||p.image?'ready':'retry_pending',photo_attempted_at:new Date(now).toISOString()};
 await store.saveWishlistPhotos(conversation,id,photoUpdate);
 return {status:photoUpdate.photo_status,name:check.product_name,price,retrieval:check.retrieval,update:{...update,...photoUpdate}};
}
