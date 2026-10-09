import {verifyListing} from './listings.js';
import {fetchListingPhotos,fetchProductAssets} from './product-photos.js';
// Repair an owned saved reference using only that exact retailer page.
export async function enrichWishlistItem(store,conversation,id,{verify=verifyListing,photos=fetchListingPhotos,assets=fetchProductAssets}={}){
 const item=await store.wishlistItem(conversation,id);if(!item)throw Error('Item not found');
 const p=item.product,check=await verify(p.url,null);
 if(check.status!=='verified'||check.url!==p.url)return {status:'retry_pending',check};
 const links=(p.links??[]).map(l=>l.url===p.url?{...l,name:check.product_name,price_snapshot:check.price_snapshot,availability:check.availability,verification_status:check.verification_basis==='search_index'?'indexed':'verified'}:l);
 const update={name:check.product_name,display_name:check.product_brand&&!check.product_name.toLowerCase().startsWith(check.product_brand.toLowerCase())?check.product_brand+' '+check.product_name:check.product_name,brand:check.product_brand??p.brand,description:check.description??p.description,links,listing_check:check,product_data:check.product_data,price_snapshot:check.price_snapshot,sourcing_status:'store_found'};
 await store.correctWishlistProduct(conversation,id,update);
 let images=[];try{images=check.product_images?.length?await assets(check.product_images,p.url):await photos(p.url,check.product_name);}catch{}
 if(images.length)await store.saveWishlistPhotos(conversation,id,{image:images[0],additional_images:images.slice(1,3),image_kind:'product',photo_count:Math.min(2,images.length-1),photo_status:'ready',photo_attempted_at:new Date().toISOString()});
 return {status:images.length?'ready':'photo_pending',name:check.product_name,price:check.price_snapshot,retrieval:check.retrieval};
}
