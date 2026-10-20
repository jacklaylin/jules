// Replaces order photos stored as small email thumbnails with a large copy of the same picture from the
// same image host (lib/photo-sizes.js, lib/photo-backfill.js). Reports only by default; add --write.
//   node --env-file=<private env file> scripts/sharpen-order-photos.js
//   node --env-file=<private env file> scripts/sharpen-order-photos.js --write
import {sharpenOrderPhotos} from '../lib/photo-backfill.js';

const env=process.env,write=process.argv.includes('--write');
if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Use node --env-file=<private env file> scripts/sharpen-order-photos.js');
const base=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/',headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
async function request(path,options={}){
 const response=await fetch(base+path,{headers,...options});
 if(!response.ok)throw Error(`Database request failed (${response.status}): ${path.split('?')[0]}`);
 const text=await response.text();return text?JSON.parse(text):null;
}
async function* pages(path,size=10){
 for(let offset=0;;offset+=size){const rows=await request(`${path}&order=id.asc&limit=${size}&offset=${offset}`);yield* rows;if(rows.length<size)return;}
}
const eq=encodeURIComponent;
const db={
 orderPhotos:()=>pages('evidence?kind=eq.photo_observation&id=like.order_photo:*&select=id,conversation_id,data'),
 replaceOrderPhoto:(row,data)=>request(`evidence?conversation_id=eq.${eq(row.conversation_id)}&id=eq.${eq(row.id)}`,{method:'PATCH',body:JSON.stringify({data})}),
};
console.log(write?'Replacing small order photos…':'Report only — nothing will change. Add --write to replace photos.');
const counts=await sharpenOrderPhotos(db,{write,log:entry=>console.log(`${entry.where}: ${entry.result}`)});
console.log(`Done: checked ${counts.checked} small photos, ${write?'replaced':'would replace'} ${counts.sharpened}, host not supported ${counts.unsupported_host}, download failed ${counts.download_failed}, not larger ${counts.not_larger}.`);
