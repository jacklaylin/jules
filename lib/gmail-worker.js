import {createHmac,timingSafeEqual} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {importStep} from './gmail-import.js';
import {loadReceipts} from './evidence.js';
import {withUsage} from './usage.js';
import {receiptNotification,nextReceiptQuestion} from './receipt-notifications.js';
import {json,uuid} from './http.js';
const active=status=>['listing','extracting','questions'].includes(status);
const signature=(owner,at,env)=>createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(`gmail-work:${owner}:${at}`).digest('hex');
export function scheduleGmail(owner,env,fetcher=fetch){
 const at=String(Date.now());
 waitUntil(fetcher(env.SITE_ORIGIN.replace(/\/$/,'')+'/api/wishlist?gmail=work',{method:'POST',headers:{'Content-Type':'application/json','x-jules-owner':owner,'x-jules-at':at,'x-jules-signature':signature(owner,at,env)},signal:AbortSignal.timeout(15000)}).then(response=>{if(!response.ok)throw Error('Worker not accepted');}).catch(()=>console.log(JSON.stringify({event:'gmail_worker_dispatch_failed'}))));
}
export async function runGmailStep(owner,store,env,{step=importStep,notify=receiptNotification,question=nextReceiptQuestion,schedule=scheduleGmail}={}){
 let row;
 try{
  row=await store.claimGmailImport(owner);if(!row)return;
  if(!row.token_ciphertext||!active(row.data.job?.status)){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);return;}
  if(row.data.job.status==='listing'&&!row.data.job.page)await notify(store,owner,env,'started:'+row.data.job.started_at,'got it, i’m reading your shopping emails. this may take a few minutes. while you wait, send me photos, screenshots or links you like. tell me if you’d like something saved.');
  const next=await withUsage({store,env,conversation:owner,operation:'gmail:'+row.data.job.started_at,feature:'gmail_import'},async()=>step({...row,receipts:await loadReceipts(store,owner,row),profile:async()=>(await store.profile(owner)).facts},env));
  if(!await store.finishGmailImport(owner,row.revision,next.data,next.token_ciphertext,next.evidence??[]))throw Error('Import write conflict');
  row=null;
  if(active(next.data.job.status))schedule(owner,env);
  else {
   const result=await notify(store,owner,env,'ready:'+next.data.job.started_at,`i’ve finished reading your shopping emails. you can see what i found here: ${env.SITE_ORIGIN.replace(/\/$/,'')}/onboarding\nany follow-up questions will stay here in our texts.`);
   if(result.status==='sent')await question(store,owner,env);
  }
 }catch{
  if(row){const data=structuredClone(row.data);data.job.error='Import paused after a failed step; retry preserves completed work.';await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).catch(()=>{});}
  console.log(JSON.stringify({event:'gmail_worker_step_failed'}));
 }
}
export function handleGmailWork(req,res,store,env){
 const owner=req.headers['x-jules-owner'],at=req.headers['x-jules-at'],supplied=req.headers['x-jules-signature'];
 if(req.method!=='POST'||env.GMAIL_IMPORT_ENABLED!=='true'||!uuid(owner)||!/^\d{13}$/.test(at??'')||Math.abs(Date.now()-Number(at))>60000||!env.SUPABASE_SERVICE_ROLE_KEY||!/^[a-f0-9]{64}$/.test(supplied??'')||!timingSafeEqual(Buffer.from(supplied),Buffer.from(signature(owner,at,env))))return json(res,401,{error:'Unauthorized.'});
 waitUntil(runGmailStep(owner,store,env));return json(res,202,{accepted:true});
}
