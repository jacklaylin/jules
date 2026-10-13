import {createHmac,timingSafeEqual} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {importStep,newWorker} from './gmail-import.js';
import {loadReceipts} from './evidence.js';
import {withUsage} from './usage.js';
import {receiptNotification,nextReceiptQuestion} from './receipt-notifications.js';
import {json,uuid} from './http.js';
export const STEP_RETRIES=3,CLAIM_RETRIES=4,DISPATCH_ATTEMPTS=3;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const active=status=>['listing','extracting','questions'].includes(status);
const signature=(owner,at,worker,attempt,env)=>createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(`gmail-work:${owner}:${at}:${worker}:${attempt}`).digest('hex');
async function dispatch(owner,env,worker='',attempt,fetcher,wait){
 for(let n=1;;n++){
  const at=String(Date.now());
  try{
   const response=await fetcher(env.SITE_ORIGIN.replace(/\/$/,'')+'/api/wishlist?gmail=work',{method:'POST',headers:{'Content-Type':'application/json','x-jules-owner':owner,'x-jules-at':at,'x-jules-worker':worker,'x-jules-attempt':String(attempt),'x-jules-signature':signature(owner,at,worker,attempt,env)},signal:AbortSignal.timeout(15000)});
   if(response.ok)return;throw Error('Worker not accepted');
  }catch{
   console.log(JSON.stringify({event:'gmail_worker_dispatch_failed',attempt:n,retrying:n<DISPATCH_ATTEMPTS}));
   if(n>=DISPATCH_ATTEMPTS)return;await wait(2000*n);
  }
 }
}
export function scheduleGmail(owner,env,{worker,attempt=0}={},fetcher=fetch,wait=pause){
 waitUntil(dispatch(owner,env,worker,attempt,fetcher,wait));
}
export async function runGmailStep(owner,store,env,{worker,attempt=0}={},{step=importStep,notify=receiptNotification,question=nextReceiptQuestion,schedule=scheduleGmail,wait=pause}={}){
 let row;
 try{
  row=await store.claimGmailImport(owner);
  if(!row){
   // Another update (a chat correction, a resume) holds the lease briefly. Retry rather than
   // letting the chain end, unless a newer chain has taken over.
   const current=await store.gmailImport(owner),job=current?.data?.job;
   const retry=active(job?.status)&&(!job.worker||job.worker===worker)&&attempt<CLAIM_RETRIES;
   console.log(JSON.stringify({event:'gmail_worker_claim_busy',attempt,retrying:retry}));
   if(retry){await wait(5000*2**attempt);schedule(owner,env,{worker,attempt:attempt+1});}
   return;
  }
  if(row.data.job?.worker&&row.data.job.worker!==worker){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);row=null;
   console.log(JSON.stringify({event:'gmail_worker_superseded'}));return;
  }
  if(!row.token_ciphertext||!active(row.data.job?.status)){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);return;}
  if(row.data.job.status==='listing'&&!row.data.job.page)await notify(store,owner,env,'started:'+row.data.job.started_at,'got it, i’m reading your shopping emails. this may take a few minutes. while you wait, send me photos, screenshots or links you like. tell me if you’d like something saved.');
  const next=await withUsage({store,env,conversation:owner,operation:'gmail:'+row.data.job.started_at,feature:'gmail_import'},async()=>step({...row,receipts:await loadReceipts(store,owner,row),profile:async()=>(await store.profile(owner)).facts},env));
  if(next.data.job){delete next.data.job.failures;if(active(next.data.job.status))newWorker(next.data.job);}
  if(!await store.finishGmailImport(owner,row.revision,next.data,next.token_ciphertext,next.evidence??[]))throw Error('Import write conflict');
  row=null;
  if(active(next.data.job.status))schedule(owner,env,{worker:next.data.job.worker});
  else {
   const result=await notify(store,owner,env,'ready:'+next.data.job.started_at,`i’ve finished reading your shopping emails. you can see what i found here: ${env.SITE_ORIGIN.replace(/\/$/,'')}/onboarding\nany follow-up questions will stay here in our texts.`);
   if(result.status==='sent')await question(store,owner,env);
  }
 }catch{
  // Transient Gmail/model failures retry with backoff; only repeated failure pauses for the user.
  let retry=false;
  if(row){const data=structuredClone(row.data),failures=(data.job.failures??0)+1;retry=failures<=STEP_RETRIES;
   if(retry)data.job.failures=failures;else {delete data.job.failures;data.job.error='Import paused after a failed step; retry preserves completed work.';}
   retry=await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).then(Boolean,()=>false)&&retry;
   console.log(JSON.stringify({event:'gmail_worker_step_failed',failures,retrying:retry}));
   if(retry){await wait(5000*2**(failures-1));schedule(owner,env,{worker:data.job.worker});}
  }else console.log(JSON.stringify({event:'gmail_worker_step_failed'}));
 }
}
export function handleGmailWork(req,res,store,env){
 const owner=req.headers['x-jules-owner'],at=req.headers['x-jules-at'],worker=req.headers['x-jules-worker']??'',attempt=req.headers['x-jules-attempt']??'0',supplied=req.headers['x-jules-signature'];
 if(req.method!=='POST'||env.GMAIL_IMPORT_ENABLED!=='true'||!uuid(owner)||!/^\d{13}$/.test(at??'')||Math.abs(Date.now()-Number(at))>60000||!/^[a-f0-9]{0,64}$/.test(worker)||!/^\d$/.test(attempt)||!env.SUPABASE_SERVICE_ROLE_KEY||!/^[a-f0-9]{64}$/.test(supplied??'')||!timingSafeEqual(Buffer.from(supplied),Buffer.from(signature(owner,at,worker,attempt,env))))return json(res,401,{error:'Unauthorized.'});
 waitUntil(runGmailStep(owner,store,env,{worker:worker||undefined,attempt:Number(attempt)}));return json(res,202,{accepted:true});
}
