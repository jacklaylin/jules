import {createHmac,timingSafeEqual} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {importStep,newWorker} from './gmail-import.js';
import {loadReceipts} from './evidence.js';
import {withUsage} from './usage.js';
import {receiptNotification,nextReceiptQuestion} from './receipt-notifications.js';
import {json,uuid} from './http.js';
export const STEP_RETRIES=3,CLAIM_RETRIES=4,DISPATCH_ATTEMPTS=3;
// Vercel rejects a function that keeps calling its own URL (508 Loop Detected) after a few hops,
// so one invocation runs steps back to back and starts new ones only within this budget
// (api/wishlist.js maxDuration is 300 s; a slow step can take about two minutes).
export const WORK_BUDGET_MS=150000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const active=status=>['listing','extracting','questions'].includes(status);
const signature=(owner,at,worker,attempt,env)=>createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(`gmail-work:${owner}:${at}:${worker}:${attempt}`).digest('hex');
async function dispatch(owner,env,worker='',attempt,fetcher,wait){
 for(let n=1;;n++){
  const at=String(Date.now());
  try{
   const response=await fetcher(env.SITE_ORIGIN.replace(/\/$/,'')+'/api/wishlist?gmail=work',{method:'POST',headers:{'Content-Type':'application/json','x-jules-owner':owner,'x-jules-at':at,'x-jules-worker':worker,'x-jules-attempt':String(attempt),'x-jules-signature':signature(owner,at,worker,attempt,env)},signal:AbortSignal.timeout(15000)});
   if(response.ok)return;throw Object.assign(Error('Worker not accepted'),{status:response.status});
  }catch(error){
   console.log(JSON.stringify({event:'gmail_worker_dispatch_failed',attempt:n,status:error.status??null,error:error.status?null:error.name,retrying:n<DISPATCH_ATTEMPTS}));
   if(n>=DISPATCH_ATTEMPTS)return;await wait(2000*n);
  }
 }
}
export function scheduleGmail(owner,env,{worker,attempt=0}={},fetcher=fetch,wait=pause){
 waitUntil(dispatch(owner,env,worker,attempt,fetcher,wait));
}
export async function runGmailStep(owner,store,env,{worker,attempt=0,deadline=0}={},deps={}){
 // Keep working in this invocation while time remains; only then hand off to a new one.
 for(;;){
  const next=await runOneStep(owner,store,env,{worker,attempt},deps);
  if(!next)return;
  if(Date.now()>=deadline){(deps.schedule??scheduleGmail)(owner,env,next);return;}
  ({worker,attempt}=next);
 }
}
// Returns the chain to continue ({worker, attempt}) or null when this chain should stop.
async function runOneStep(owner,store,env,{worker,attempt=0},{step=importStep,notify=receiptNotification,question=nextReceiptQuestion,schedule=scheduleGmail,wait=pause}={}){
 let row;
 try{
  row=await store.claimGmailImport(owner);
  if(!row){
   // Another update (a chat correction, a resume) holds the lease briefly. Retry rather than
   // letting the chain end, unless a newer chain has taken over.
   const current=await store.gmailImport(owner),job=current?.data?.job;
   const retry=active(job?.status)&&(!job.worker||job.worker===worker)&&attempt<CLAIM_RETRIES;
   console.log(JSON.stringify({event:'gmail_worker_claim_busy',attempt,retrying:retry}));
   if(retry){await wait(5000*2**attempt);return {worker,attempt:attempt+1};}
   return null;
  }
  if(row.data.job?.worker&&row.data.job.worker!==worker){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);row=null;
   console.log(JSON.stringify({event:'gmail_worker_superseded'}));return null;
  }
  if(!row.token_ciphertext||!active(row.data.job?.status)){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);return null;}
  if(row.data.job.status==='listing'&&!row.data.job.page)await notify(store,owner,env,'started:'+row.data.job.started_at,'got it, i’m reading your shopping emails. this may take a few minutes. while you wait, send me photos, screenshots or links you like. tell me if you’d like something saved.');
  const next=await withUsage({store,env,conversation:owner,operation:'gmail:'+row.data.job.started_at,feature:'gmail_import'},async()=>step({...row,receipts:await loadReceipts(store,owner,row),profile:async()=>(await store.profile(owner)).facts},env));
  if(next.data.job){delete next.data.job.failures;delete next.data.job.sweep_retries;if(active(next.data.job.status))newWorker(next.data.job);}
  if(!await store.finishGmailImport(owner,row.revision,next.data,next.token_ciphertext,next.evidence??[]))throw Error('Import write conflict');
  row=null;
  if(active(next.data.job.status))return {worker:next.data.job.worker,attempt:0};
  else {
   const result=await notify(store,owner,env,'ready:'+next.data.job.started_at,`i’ve finished reading your shopping emails. you can see what i found here: ${env.SITE_ORIGIN.replace(/\/$/,'')}/onboarding\nany follow-up questions will stay here in our texts.`);
   if(result.status==='sent')await question(store,owner,env);
   return null;
  }
 }catch{
  // Transient Gmail/model failures retry with backoff; only repeated failure pauses for the user.
  let retry=false;
  if(row){const data=structuredClone(row.data),failures=(data.job.failures??0)+1;retry=failures<=STEP_RETRIES;
   if(retry)data.job.failures=failures;else {delete data.job.failures;data.job.error='Import paused after a failed step; retry preserves completed work.';}
   retry=await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).then(Boolean,()=>false)&&retry;
   console.log(JSON.stringify({event:'gmail_worker_step_failed',failures,retrying:retry}));
   if(retry){await wait(5000*2**(failures-1));return {worker:data.job.worker,attempt:0};}
  }else console.log(JSON.stringify({event:'gmail_worker_step_failed'}));
  return null;
 }
}
export function handleGmailWork(req,res,store,env){
 const owner=req.headers['x-jules-owner'],at=req.headers['x-jules-at'],worker=req.headers['x-jules-worker']??'',attempt=req.headers['x-jules-attempt']??'0',supplied=req.headers['x-jules-signature'];
 if(req.method!=='POST'||env.GMAIL_IMPORT_ENABLED!=='true'||!uuid(owner)||!/^\d{13}$/.test(at??'')||Math.abs(Date.now()-Number(at))>60000||!/^[a-f0-9]{0,64}$/.test(worker)||!/^\d$/.test(attempt)||!env.SUPABASE_SERVICE_ROLE_KEY||!/^[a-f0-9]{64}$/.test(supplied??'')||!timingSafeEqual(Buffer.from(supplied),Buffer.from(signature(owner,at,worker,attempt,env))))return json(res,401,{error:'Unauthorized.'});
 waitUntil(runGmailStep(owner,store,env,{worker:worker||undefined,attempt:Number(attempt),deadline:Date.now()+WORK_BUDGET_MS}));return json(res,202,{accepted:true});
}

// Restart sweep, called once a minute by the Supabase scheduler (db/023_gmail_sweep.sql). Each call
// is a fresh request, so a restarted chain gets new hops under Vercel's loop protection. A chain that
// stopped without an error restarts after a quiet minute; one paused after repeated step failures
// retries after 5, 10, 20, 40 then 80 minutes and is then left for review.
export const SWEEP_QUIET_MS=60000,SWEEP_RETRIES=5;
export function sweepDue(row,now=Date.now()){
 const job=row.job,quiet=now-Date.parse(row.updated_at);
 if(!job||!['listing','extracting','questions'].includes(job.status)||Date.parse(row.lease_until)>now||quiet<SWEEP_QUIET_MS)return false;
 if(!job.error)return true;
 const retries=job.sweep_retries??0;
 return retries<SWEEP_RETRIES&&quiet>=300000*2**retries;
}
export async function sweepGmailImports(store,env,{schedule=scheduleGmail,now=Date.now()}={}){
 const rows=await store.quietGmailImports(new Date(now-SWEEP_QUIET_MS).toISOString());
 let restarted=0,abandoned=0;
 for(const candidate of rows){
  if(!sweepDue(candidate,now)){if(candidate.job?.error&&(candidate.job.sweep_retries??0)>=SWEEP_RETRIES)abandoned++;continue;}
  const row=await store.claimGmailImport(candidate.conversation_id);if(!row)continue;
  const data=structuredClone(row.data);
  if(data.job.error){data.job.sweep_retries=(data.job.sweep_retries??0)+1;delete data.job.error;}
  newWorker(data.job);
  if(await store.finishGmailImport(candidate.conversation_id,row.revision,data,row.token_ciphertext)){schedule(candidate.conversation_id,env,{worker:data.job.worker});restarted++;}
 }
 if(rows.length)console.log(JSON.stringify({event:'gmail_sweep',quiet:rows.length,restarted,abandoned}));
 return {quiet:rows.length,restarted,abandoned};
}
export async function handleGmailSweep(req,res,store,env){
 const expected=env.GMAIL_SWEEP_SECRET&&env.GMAIL_SWEEP_SECRET.length>=32?Buffer.from('Bearer '+env.GMAIL_SWEEP_SECRET):null,received=Buffer.from(req.headers.authorization??'');
 if(!expected||received.length!==expected.length||!timingSafeEqual(received,expected))return json(res,401,{error:'Unauthorized.'});
 if(env.GMAIL_IMPORT_ENABLED!=='true')return json(res,503,{error:'Gmail import is not enabled.'});
 try{return json(res,200,await sweepGmailImports(store,env));}
 catch{console.log(JSON.stringify({event:'gmail_sweep_failed'}));return json(res,503,{error:'Sweep failed.'});}
}
