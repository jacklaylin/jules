import sharp from 'sharp';
import {downloadOrderPhoto,orderPhotoJPEG} from './order-photos.js';
import {downloadProductAsset,productAssetJPEG} from './product-photos.js';
import {largerPhotoURL} from './photo-sizes.js';

// One-off repair for product photos stored before transparent pixels were flattened onto white
// (they were saved with a black backdrop). A stored JPEG cannot show whether its black was once
// transparent, so each original is downloaded again and replaced only when it really has
// transparent pixels. Photos with a genuine black backdrop, dead links and failed downloads are
// left exactly as they are. Re-running is harmless: a replaced photo is converted the same way.
export async function hasTransparency(bytes){
 const image=sharp(bytes,{limitInputPixels:25000000});
 if(!(await image.metadata()).hasAlpha)return false;
 return !(await image.stats()).isOpaque;
}

// Returns the replacement (from convert) for a transparent original, or the reason it was kept.
async function refresh(url,download,convert){
 let bytes;
 try{bytes=await download(url);}catch{return {kept:'download_failed'};}
 try{if(!await hasTransparency(bytes))return {kept:'not_transparent'};return {replacement:await convert(bytes)};}
 catch{return {kept:'unreadable'};}
}

// db: orderPhotos() and wishlistPhotos() are async iterables of stored rows;
// replaceOrderPhoto(row,data) and saveWishlistPhotos(row,update) write only when write is true.
export async function backfillPhotoBackgrounds(db,{write=false,fetcher=fetch,log=()=>{}}={}){
 const counts={checked:0,fixed:0,not_transparent:0,download_failed:0,unreadable:0};
 const tally=(kind,result,where)=>{counts.checked++;if(result.kept)counts[result.kept]++;else counts.fixed++;log({kind,where,result:result.kept??(write?'replaced':'would_replace')});};

 for await(const row of db.orderPhotos()){
  if(!row.data?.url)continue;
  const result=await refresh(row.data.url,url=>downloadOrderPhoto(url,fetcher),orderPhotoJPEG);
  tally('wardrobe',result,row.id);
  if(result.replacement&&write)await db.replaceOrderPhoto(row,{...row.data,...result.replacement});
 }

 for await(const row of db.wishlistPhotos()){
  const update={};
  if(row.image_kind==='product'&&row.image?.asset_url){
   const result=await refresh(row.image.asset_url,url=>downloadProductAsset(url,fetcher),productAssetJPEG);
   tally('wishlist',result,row.id);
   if(result.replacement)update.image={...row.image,data:result.replacement.toString('base64')};
  }
  const extras=Array.isArray(row.additional_images)?row.additional_images:[];
  let extrasChanged=false;
  const additional_images=[];
  for(const image of extras){
   if(!image?.asset_url){additional_images.push(image);continue;}
   const result=await refresh(image.asset_url,url=>downloadProductAsset(url,fetcher),productAssetJPEG);
   tally('wishlist_extra',result,row.id);
   if(result.replacement){extrasChanged=true;additional_images.push({...image,data:result.replacement.toString('base64')});}
   else additional_images.push(image);
  }
  if(extrasChanged)update.additional_images=additional_images;
  if(Object.keys(update).length&&write)await db.saveWishlistPhotos(row,update);
 }
 return counts;
}

// One-off repair for order photos stored as small email thumbnails (lib/photo-sizes.js): each one on a
// known image host is downloaded again at a large size and replaced only when the new copy is clearly
// bigger. The picture is the same asset; the address the source gave stays in `url`.
export async function sharpenOrderPhotos(db,{write=false,fetcher=fetch,log=()=>{},below=500}={}){
 const counts={checked:0,sharpened:0,unsupported_host:0,download_failed:0,not_larger:0};
 for await(const row of db.orderPhotos()){
  const side=Math.max(Number(row.data?.width)||0,Number(row.data?.height)||0);
  if(!row.data?.url||side>=below)continue;
  counts.checked++;
  const larger=largerPhotoURL(row.data.url);
  if(!larger){counts.unsupported_host++;log({where:row.id,result:'unsupported_host'});continue;}
  let photo;try{photo=await orderPhotoJPEG(await downloadOrderPhoto(larger,fetcher));}catch{counts.download_failed++;log({where:row.id,result:'download_failed'});continue;}
  if(Math.max(photo.width,photo.height)<side*1.5){counts.not_larger++;log({where:row.id,result:'not_larger'});continue;}
  counts.sharpened++;log({where:row.id,result:`${write?'replaced':'would_replace'} ${side}px -> ${Math.max(photo.width,photo.height)}px`});
  if(write)await db.replaceOrderPhoto(row,{...row.data,...photo,asset_url:larger});
 }
 return counts;
}
