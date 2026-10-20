// Reads the confirmed photos on every person's wardrobe items (lib/photo-tags.js). New imports and the
// daily purchase check read new photos automatically; run this once for wardrobes from before photo tags,
// or again after PHOTO_TAG_VERSION changes. Photos already read are skipped, so re-running costs nothing extra.
//   node --env-file=<private env file> scripts/photo-tags-backfill.js [conversation id]
import {createStore} from '../lib/store.js';
import {tagWardrobePhotos,photoTagStatus} from '../lib/photo-tags.js';
import {loadWardrobe} from '../lib/wardrobe.js';

const env=process.env;
if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.OPENAI_API_KEY)throw Error('Use node --env-file=<private env file> scripts/photo-tags-backfill.js');
let owners=process.argv[2]?[process.argv[2]]:null;
if(!owners){
 const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/gmail_imports?select=conversation_id`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!response.ok)throw Error('Could not list purchase histories: '+response.status);
 owners=(await response.json()).map(r=>r.conversation_id);
}
const store=createStore(env);let read=0,cost=0;
for(const [n,owner] of owners.entries()){
 const run=await tagWardrobePhotos(store,owner,env,{budgetMs:10*60000}).catch(error=>({error:error.message}));
 read+=run.read??0;cost+=run.cost_usd??0;
 const {row,view}=await loadWardrobe(store,owner,env);
 const status=row?photoTagStatus(view.items,row.data.photo_tags??{}):null;
 console.log(`${n+1}/${owners.length}: ${run.error?'failed ('+run.error+')':`${run.read} read, ${run.unreadable} not showing the item, ${run.failed} failed, ${run.remaining??0} left${run.busy?' (history busy)':''}; $${(run.cost_usd??0).toFixed(4)}`}${status?` · wardrobe: ${status.read} read, ${status.without_photo} without a photo`:''}`);
}
console.log(`Done: ${read} photos read across ${owners.length} wardrobes, $${cost.toFixed(4)}${read?` ($${(cost/read).toFixed(5)} per photo)`:''}.`);
