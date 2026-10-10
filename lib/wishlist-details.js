import {resolveSavedColor} from './saved-color.js';
import {verifyListing} from './listings.js';
import {fetchListingPhotos,fetchProductAssets} from './product-photos.js';
import {sameProductURL,sameReferenceProductURL} from './indexed-product.js';
// Repair an owned saved reference using only that exact retailer page.
export async function enrichWishlistItem(store,conversation,id,{verify=verifyListing,photos=fetchListingPhotos,assets=fetchProductAssets,now=Date.now(),env=process.env,resolveColor=resolveSavedColor}={}){
 const item=await store.wishlistItem(conversation,id);if(!item)throw Error('Item not found');
 const p=item.product,original=p.user_source_url??p.links?.find(l=>l.user_source_url)?.user_source_url??p.url;
 let check=await verify(original,null),selectedColor=null;
 if(check.status==='verified'&&sameReferenceProductURL(original,check.url)&&check.color_options?.length){
  if(p.selected_color)selectedColor=check.color_options.find(c=>c.color===p.selected_color);
  else if(store.messages||store.wishlistConversationContext){
   const replyIds=(item.wishlist_encounters??[]).map(e=>e.reply_id);
   const history=store.wishlistConversationContext?await store.wishlistConversationContext(conversation,replyIds):(await store.messages(conversation)).messages;
   const anchor=history.findIndex(m=>replyIds.includes(m.id));
   const relevant=store.wishlistConversationContext?history:anchor>=0?history.slice(Math.max(0,anchor-20),anchor+1):[];
   if(relevant.length)selectedColor=await resolveColor({product:p,options:check.color_options,messages:relevant,reply_ids:replyIds},env);
   console.log(JSON.stringify({event:'wishlist_color_recovery',has_original_context:relevant.length>0,color_selected:Boolean(selectedColor),retailer_colors:check.color_options.length}));
  }
  if(selectedColor){if(check.color===selectedColor.color&&new URL(check.url).searchParams.has('variant'))selectedColor={...selectedColor,url:check.url};const variant=await verify(selectedColor.url,null);if(variant.status!=='verified'||variant.color!==selectedColor.color)throw Error('Selected color unavailable');check={...variant,availability:null};}
 }

 if(check.status!=='verified'||!sameReferenceProductURL(original,check.url)&&!selectedColor){
  let identity={};try{const saved=new URL(p.url),retrieved=new URL(check.url);identity={same_host:saved.hostname.replace(/^www\./,'')===retrieved.hostname.replace(/^www\./,''),same_path:saved.pathname===retrieved.pathname,same_query:saved.search===retrieved.search,locale_redirect:saved.pathname===retrieved.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'')};}catch{}
  console.log(JSON.stringify({event:'wishlist_details_check_rejected',status:check.status,...identity}));
  await store.saveWishlistPhotos?.(conversation,id,{photo_status:p.image?'ready':'retry_pending',photo_attempted_revision:5,photo_attempted_at:new Date(now).toISOString()});
  return {status:'retry_pending',check};
 }
 // Keep the saved URL and variant identity; www/tracking canonicalization is harmless.
 const price=check.price_snapshot&&sameProductURL(check.price_snapshot.source_url,check.url)?check.price_snapshot:null;
 const links=(p.links??[]).map(l=>sameReferenceProductURL(p.url,l.url)?{...l,url:check.url,user_source_url:l.user_source_url??l.url,name:check.product_name,price_snapshot:price,availability:check.availability,verification_status:check.verification_basis==='search_index'?'indexed':'verified'}:l);
 const name=selectedColor?(check.product_name.split(' - ')[0]+' — '+selectedColor.color):check.product_name;
 const update={details_revision:5,market_country:env.SHOPPING_COUNTRY??'US',url:check.url,user_source_url:original,selected_color:selectedColor?.color??p.selected_color,requested_color:selectedColor?.requested_color??p.requested_color,name,display_name:check.product_brand&&!name.toLowerCase().startsWith(check.product_brand.toLowerCase())?check.product_brand+' '+name:name,brand:check.product_brand??p.brand,description:check.description??p.description,links,listing_check:check,product_data:check.product_data,price_snapshot:price,sourcing_status:'store_found'};
 await store.correctWishlistProduct(conversation,id,update);
 let images=[];if(!p.image||selectedColor)try{images=check.product_images?.length?await assets(check.product_images,check.url):await photos(check.url,check.product_name);}catch{}
 const photoUpdate={...(images.length?{image:images[0],additional_images:images.slice(1,3),image_kind:'product',photo_count:Math.min(2,images.length-1)}:{}),...(selectedColor&&!images.length?{image:null,additional_images:[],photo_count:0}:{}),photo_status:images.length||p.image&&!selectedColor?'ready':'retry_pending',photo_attempted_revision:5,photo_attempted_at:new Date(now).toISOString()};
 await store.saveWishlistPhotos(conversation,id,photoUpdate);
 return {status:photoUpdate.photo_status,name:check.product_name,price,retrieval:check.retrieval,update:{...update,...photoUpdate}};
}
