import {authorize} from '../lib/auth.js';
import {createStore} from '../lib/store.js';
import {json,readJson,uuid} from '../lib/http.js';
import {publicURL} from '../lib/search.js';
import {imageType,MAX_IMAGE_BYTES} from '../lib/images.js';
import sharp from 'sharp';

export const config={api:{bodyParser:false}};
export function createCorrectionHandler({env=process.env,auth=authorize,storeFactory=createStore}={}){
 return async(req,res)=>{
  try{
   const access=await auth(req.headers,env);if(access!==200)return json(res,access,{error:'Owner sign-in required.'});
   if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
   const input=await readJson(req,4300000),url=publicURL(input.url);
   if(!uuid(input.item)||!url||input.verified!==true||typeof input.name!=='string'||!input.name.trim()||input.name.length>180||typeof input.brand!=='string'||input.brand.length>100||!Number.isFinite(input.amount)||input.amount<0||!/^[A-Z]{3}$/.test(input.currency??'')||typeof input.image!=='string'||input.image.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))return json(res,400,{error:'Provide verified listing details and a product image.'});
   const bytes=Buffer.from(input.image,'base64');if(bytes.length>MAX_IMAGE_BYTES)return json(res,413,{error:'Image must be under 3 MB.'});imageType(bytes);
   const image=await sharp(bytes,{limitInputPixels:25000000}).rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
   const store=storeFactory(env),member=await store.wishlistMember(env.ADMIN_EMAIL.toLowerCase());
   if(!member||!await store.wishlistItem(member.conversation_id,input.item))return json(res,404,{error:'Item not found.'});
   const checked_at=new Date().toISOString();
   await store.correctWishlistProduct(member.conversation_id,input.item,{brand:input.brand.trim(),name:input.name.trim(),display_name:null,match:'similar',reason:'Retailer listing supplied and checked; fit and exact variant are not confirmed.',image:{mime_type:'image/jpeg',data:image.toString('base64')},image_kind:'product',links:[{url,retailer:new URL(url).hostname}],price_snapshot:{amount:input.amount,currency:input.currency,source_url:url,checked_at},checked_at,correction_source:'owner_verified_listing'});
   return json(res,200,{ok:true});
  }catch{return json(res,503,{error:'Could not save correction.'});}
 };
}
export default createCorrectionHandler();
