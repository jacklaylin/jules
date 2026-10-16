// Repairs product photos saved with a black backdrop before transparent pixels were flattened onto
// white (lib/photo-backfill.js). Reports only by default; add --write to replace photos.
//   node --env-file=<private env file> scripts/photo-background-backfill.js
//   node --env-file=<private env file> scripts/photo-background-backfill.js --write
import {createStore} from '../lib/store.js';
import {backfillPhotoBackgrounds} from '../lib/photo-backfill.js';

const env=process.env,write=process.argv.includes('--write');
if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Use node --env-file=<private env file> scripts/photo-background-backfill.js');
const base=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/',headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
async function request(path,options={}){
 const response=await fetch(base+path,{headers,...options});
 if(!response.ok)throw Error(`Database request failed (${response.status}): ${path.split('?')[0]}`);
 const text=await response.text();return text?JSON.parse(text):null;
}
// Small pages: each row carries its stored photo.
async function* pages(path,size=10){
 for(let offset=0;;offset+=size){const rows=await request(`${path}&order=id.asc&limit=${size}&offset=${offset}`);yield* rows;if(rows.length<size)return;}
}
const eq=encodeURIComponent,store=createStore(env);
const db={
 orderPhotos:()=>pages('evidence?kind=eq.photo_observation&id=like.order_photo:*&select=id,conversation_id,data'),
 replaceOrderPhoto:(row,data)=>request(`evidence?conversation_id=eq.${eq(row.conversation_id)}&id=eq.${eq(row.id)}`,{method:'PATCH',body:JSON.stringify({data})}),
 wishlistPhotos:()=>pages('wishlist_items?select=id,conversation_id,image_kind:product->>image_kind,image:product->image,additional_images:product->additional_images'),
 saveWishlistPhotos:(row,update)=>store.saveWishlistPhotos(row.conversation_id,row.id,update),
};
console.log(write?'Replacing transparent product photos…':'Report only — nothing will change. Add --write to replace photos.');
const counts=await backfillPhotoBackgrounds(db,{write,log:entry=>console.log(`${entry.kind} ${entry.where}: ${entry.result}`)});
console.log(`Done: checked ${counts.checked}, ${write?'replaced':'would replace'} ${counts.fixed}, real backdrop kept ${counts.not_transparent}, download failed ${counts.download_failed}, unreadable ${counts.unreadable}.`);
