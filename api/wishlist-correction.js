import {authorize} from '../lib/auth.js';
import {createStore} from '../lib/store.js';
import {json,readJson,uuid} from '../lib/http.js';
import {publicURL} from '../lib/search.js';
import {imageType,MAX_IMAGE_BYTES} from '../lib/images.js';
import sharp from 'sharp';
import {verifyListing} from '../lib/listings.js';
import {fetchListingPhotos} from '../lib/product-photos.js';

export const config={api:{bodyParser:false},maxDuration:120};
export function createCorrectionHandler({env=process.env,auth=authorize,storeFactory=createStore,verify=verifyListing}={}){
 return async(req,res)=>{
  try{
   const access=await auth(req.headers,env);if(access!==200)return json(res,access,{error:'Owner sign-in required.'});
   if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
   const input=await readJson(req,4300000),url=publicURL(input.url);
   if(input.action==='verify_listings'){
    const store=storeFactory(env),member=await store.wishlistMember(env.ADMIN_EMAIL.toLowerCase());if(!member)return json(res,404,{error:'Account not found.'});
    const items=await store.wishlist(member.conversation_id);let checked=0,removed=0;
    for(const item of items){
     const p=item.product;if(!p.links?.length)continue;
     const links=[];const checks=[];
     for(const link of p.links){const check=await verify(link.url,link.name??p.name);checks.push({url:link.url,...check});checked++;if(check.status==='verified')links.push({...link,url:check.url,price_snapshot:check.price_snapshot,availability:check.availability});else removed++;}
     await store.correctWishlistProduct(member.conversation_id,item.id,{links:p.links.map((link,i)=>checks[i].status==='verified'?{...link,url:checks[i].url,price_snapshot:checks[i].price_snapshot,availability:checks[i].availability}:{...link,price_snapshot:null,availability:null}),price_snapshot:null,sourcing_status:links.length?'store_found':'store_not_found',listing_checks:checks,identity_sources:links.length?[]:p.identity_sources??[{url:p.url??p.links[0].url,name:p.name}]});
    }
    return json(res,200,{ok:true,checked,removed});
   }
   if(input.action==='refresh_photo'){
    if(!uuid(input.item))return json(res,400,{error:'Choose a saved item.'});
    const store=storeFactory(env),member=await store.wishlistMember(env.ADMIN_EMAIL.toLowerCase());
    const item=member&&await store.wishlistItem(member.conversation_id,input.item);if(!item)return json(res,404,{error:'Item not found.'});
    const product=item.product,source=product.photo_source_url??product.links?.[0]?.url??product.url;
    const images=await fetchListingPhotos(source,product.name);
    await store.correctWishlistProduct(member.conversation_id,input.item,{image:images[0],image_kind:'product',additional_images:images.slice(1),photo_count:images.length-1,photo_source_url:source});
    return json(res,200,{ok:true});
   }
   if(!uuid(input.item)||!url||input.verified!==true||typeof input.name!=='string'||!input.name.trim()||input.name.length>180||typeof input.brand!=='string'||input.brand.length>100||!Number.isFinite(input.amount)||input.amount<0||!/^[A-Z]{3}$/.test(input.currency??'')||typeof input.image!=='string'||input.image.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))return json(res,400,{error:'Provide verified listing details and a product image.'});
   const bytes=Buffer.from(input.image,'base64');if(bytes.length>MAX_IMAGE_BYTES)return json(res,413,{error:'Image must be under 3 MB.'});imageType(bytes);
   const image=await sharp(bytes,{limitInputPixels:25000000}).rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
   const store=storeFactory(env),member=await store.wishlistMember(env.ADMIN_EMAIL.toLowerCase());
   if(!member||!await store.wishlistItem(member.conversation_id,input.item))return json(res,404,{error:'Item not found.'});
   const listing=await verify(url,input.name);if(listing.status!=='verified')return json(res,422,{error:'This URL could not be verified as a live matching product page.'});
   const checked_at=listing.checked_at;
   await store.correctWishlistProduct(member.conversation_id,input.item,{brand:input.brand.trim(),name:input.name.trim(),display_name:null,match:'similar',reason:'Retailer listing supplied and checked; fit and exact variant are not confirmed.',image:{mime_type:'image/jpeg',data:image.toString('base64')},image_kind:'product',sourcing_status:'store_found',links:[{url:listing.url,retailer:new URL(listing.url).hostname,price_snapshot:listing.price_snapshot,availability:listing.availability}],price_snapshot:listing.price_snapshot,listing_check:listing,checked_at,correction_source:'owner_verified_listing'});
   return json(res,200,{ok:true});
  }catch{return json(res,503,{error:'Could not save correction.'});}
 };
}
export default createCorrectionHandler();
