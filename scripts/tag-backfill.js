// Tags every person's existing purchase history for the style report (lib/item-tags.js). New imports
// are tagged automatically; run this once for history imported before tags existed, or again after
// TAG_VERSION changes. Items already tagged are skipped, so re-running costs nothing extra.
//   node --env-file=<private env file> scripts/tag-backfill.js
import {createStore} from '../lib/store.js';
import {tagPurchaseHistory} from '../lib/item-tags.js';

const env=process.env;
if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.OPENAI_API_KEY)throw Error('Use node --env-file=<private env file> scripts/tag-backfill.js');
const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/gmail_imports?select=conversation_id`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
if(!response.ok)throw Error('Could not list purchase histories: '+response.status);
const owners=(await response.json()).map(r=>r.conversation_id),store=createStore(env);
let total=0;
for(const [n,owner] of owners.entries()){
 // Generous budget: one person's whole history in one go. A busy history (an import running) is skipped.
 const run=await tagPurchaseHistory(store,owner,env,{budgetMs:10*60000}).catch(error=>({error:error.message}));
 total+=run.tagged??0;
 console.log(`${n+1}/${owners.length}: ${run.error?'failed ('+run.error+')':run.busy?'busy, skipped':`${run.tagged} tagged, ${run.remaining??0} left`}`);
}
console.log(`Done: ${total} items tagged across ${owners.length} purchase histories.`);
