import {createHmac,timingSafeEqual} from 'node:crypto';
import {contextForImport} from './user-context.js';
import {waitUntil} from '@vercel/functions';
import {importStep,newWorker,chainWorker} from './gmail-import.js';
import {CONNECTED_SOURCES,connectionAction,nextSourceWork,sourcesActive,sourcesSettled} from './connected-sources.js';
import {receiptWrite} from './evidence.js';
import {receiptModel} from './receipt-extraction.js';
import {loadReceipts} from './evidence.js';
import {withUsage} from './usage.js';
import {checkCaps,logCapReached} from './cost-caps.js';
import {recordJobRun} from './jobs.js';
import {receiptNotification,announceImport,sendProfile,nextReceiptQuestion,importRound} from './receipt-notifications.js';
import {json,uuid} from './http.js';
import {gmailLinked,markGmailReconnect} from './gmail-client.js';
import {applyQueuedAnswers,dropReplaced} from './receipt-chat.js';
import {OUTFIT_ASK} from './outfit-photos.js';
import {withScreenshotNotes} from './order-screenshots.js';
import {tagPurchaseHistory} from './item-tags.js';
import {tagWardrobePhotos} from './photo-tags.js';
import {ensureClosetSummary} from './closet-summary.js';
import {buildReport,sendNewCardText,autoSendReport} from './style-report.js';
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
  // Only waiting for a source's approval: pause until its next poll is due.
  if(next.delay)await (deps.wait??pause)(next.delay);
  if(Date.now()>=deadline){(deps.schedule??scheduleGmail)(owner,env,{worker:next.worker,attempt:next.attempt});return;}
  ({worker,attempt}=next);
 }
}
// One chain advances the Gmail job and every connected source on the row, taking turns when both have
// work, so they read at the same time from the person's point of view. The completion text waits until
// all of them have finished (or a source's approval passes the cutoff); see announceImport.
// Once everything is read: tag new or corrected items, then build the style report so "Your style"
// opens straight away instead of building while the person waits. An import that just finished
// rebuilds it (earlier feedback and hidden lines are kept); otherwise only a missing report is built.
// Best effort: admin's "Tag purchases" and "Rebuild report" pick up anything left. A rebuild that
// turned a locked card real texts the person once that their report has a new card. A report built
// after the import settled (since) already has it all: the summary built it first (see autoSendReport).
// Then the first report link goes out if onboarding's texts are done (autoSendReport).
export async function prepareReport(store,owner,env,{tag,build,rebuild,newCard,since,autoSend=autoSendReport}={}){
 if(tag||env.OPENAI_API_KEY)await (tag??tagPurchaseHistory)(store,owner,env,{budgetMs:60000}).catch(()=>{});
 // Then read the wardrobe's own photos, so the report can count colours the receipts left out.
 if(env.OPENAI_API_KEY)await tagWardrobePhotos(store,owner,env,{budgetMs:60000}).catch(()=>{});
 // And keep the closet summary the stylist and search read ready, so a reply never has to build it.
 await ensureClosetSummary(store,owner).catch(()=>{});
 if(build||env.OPENAI_API_KEY){
  const report=(await store.gmailImport(owner).catch(()=>null))?.data?.style_report;
  if(!report||rebuild&&!(since&&report.built_at>=since)){
   const result=await (build??buildReport)(store,owner,env).catch(()=>({status:'failed'}));
   console.log(JSON.stringify({event:'style_report_background_build',status:result.status,rebuild}));
   if(result.unlocked?.length)await (newCard??sendNewCardText)(store,owner,env,result.unlocked).catch(()=>{});
  }
 }
 if(autoSend)await autoSend(store,owner,env).catch(()=>console.log(JSON.stringify({event:'style_report_auto_failed'})));
}
async function runOneStep(owner,store,env,{worker,attempt=0},{step=importStep,source=connectionAction,notify=receiptNotification,announce=announceImport,ask=nextReceiptQuestion,schedule=scheduleGmail,wait=pause,interpret,tag,build,newCard,now=Date.now}={}){
 let row,work=null;
 try{
  row=await store.claimGmailImport(owner);
  if(!row){
   // Another update (a chat correction, a resume) holds the lease briefly. Retry rather than
   // letting the chain end, unless a newer chain has taken over.
   const current=await store.gmailImport(owner),chain=chainWorker(current?.data);
   const retry=(active(current?.data?.job?.status)||sourcesActive(current?.data))&&(!chain||chain===worker)&&attempt<CLAIM_RETRIES;
   console.log(JSON.stringify({event:'gmail_worker_claim_busy',attempt,retrying:retry}));
   if(retry){await wait(5000*2**attempt);return {worker,attempt:attempt+1};}
   return null;
  }
  const chain=chainWorker(row.data);
  if(chain&&chain!==worker){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);row=null;
   console.log(JSON.stringify({event:'gmail_worker_superseded'}));return null;
  }
  // Chat answers and order screenshots that arrived while this chain held the lease are applied
  // first, as their own step.
  if(row.chat_answers?.length){
   const receipts=await loadReceipts(store,owner,row),ids=row.chat_answers.map(a=>a?.id).filter(Boolean);
   const {state,applied,evidence,notes,replaced}=applyQueuedAnswers(receipts.state,row.chat_answers,owner,row.data),written=receiptWrite(withScreenshotNotes(row.data,notes,replaced),receipts,state,evidence);
   await dropReplaced(store,owner,replaced);
   if(!await store.finishGmailImport(owner,row.revision,written.data,row.token_ciphertext,written.evidence))throw Error('Import write conflict');
   row=null;
   // If clearing fails the next holder applies them again, which changes nothing; stop this chain
   // rather than loop, and the sweep resumes it.
   const cleared=await store.clearHistoryAnswers(owner,ids).then(()=>true,()=>false);
   console.log(JSON.stringify({event:'purchase_history_queue_applied',answers:ids.length,applied,cleared}));
   if(applied)await ask(store,owner,env).catch(()=>console.log(JSON.stringify({event:'receipt_next_question_failed'})));
   return cleared?{worker,attempt:0}:null;
  }
  const gmail=gmailLinked(row)&&active(row.data.job?.status),due=nextSourceWork(row.data,now());
  work=gmail&&due?.action?(row.data.turn==='sources'?'source':'gmail'):gmail?'gmail':due?.action?'source':null;
  if(!work){
   // Nothing to do now: either a source is waiting for approval (poll again later) or all is finished.
   const data=structuredClone(row.data),announcing=settle(data,now());
   await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext);row=null;
   if(announcing)await announce(store,owner,env);
   if(!due?.delay)await prepareReport(store,owner,env,{tag,build,newCard,rebuild:false});
   return due?.delay?{worker,attempt:0,delay:due.delay}:null;
  }
  // Over a spending cap (lib/cost-caps.js): the import waits with nothing changed, and the sweep resumes it
  // once the cap resets. Not counted as a failed step, so it never pauses or abandons the import.
  const cap=await checkCaps(store,owner,env);
  if(cap.capped){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);row=null;
   logCapReached(cap,'gmail_import');return null;
  }
  let next,sourceDone=false;
  if(work==='gmail'){
   // The "reading your emails" text belongs to onboarding: only the first import, before any email was read.
   const firstImport=!(row.data.sources?.length||row.data.scanned_ids?.length);
   if(firstImport&&row.data.job.status==='listing'&&!row.data.job.page){
    await notify(store,owner,env,'started:'+row.data.job.started_at,'got it, i’m reading your shopping emails. this may take a few minutes.'+(env.STYLE_ENABLED==='true'?'':' while you wait, send me photos, screenshots or links you like. tell me if you’d like something saved.'));
    // Receipts show what someone buys; outfit photos show what they wear. Its own text, so the
    // interview knows photos were already asked for. Photos sent during the import go into the summary.
    if(env.STYLE_ENABLED==='true')await notify(store,owner,env,'outfits:'+row.data.job.started_at,OUTFIT_ASK);
   }
   next=await withUsage({store,env,conversation:owner,operation:'gmail:'+row.data.job.started_at,feature:'gmail_import'},async()=>step({...row,receipts:await loadReceipts(store,owner,row),profile:()=>contextForImport(store,owner,env)},env));
   delete next.data.job.failures;delete next.data.job.sweep_retries;next.data.turn='sources';
  }else{
   const name=due.source.name,before=row.data.connections[name].status,receipts=await loadReceipts(store,owner,row);
   const result=await withUsage({store,env,conversation:owner,operation:name+':'+(row.data.connections[name].imported_at??'connect'),feature:name+'_history'},()=>source(due.source,due.action,{data:row.data,state:receipts.state,pending:receipts.pending,owner,env,interpret:interpret??(request=>receiptModel(request,env)),profile:()=>contextForImport(store,owner,env)}));
   const written=receiptWrite(result.data,receipts,result.state,result.evidence);
   const c=written.data.connections[name];delete c.failures;sourceDone=before==='extracting'&&c.status==='ready';
   next={...row,data:{...written.data,turn:'gmail'},evidence:written.evidence};
  }
  const settledAt=new Date(now()).toISOString(),announcing=settle(next.data,now()),more=(gmailLinked(next)&&active(next.data.job?.status))||sourcesActive(next.data);
  if(more)newWorker(next.data);
  if(!await store.finishGmailImport(owner,row.revision,next.data,next.token_ciphertext,next.evidence??[]))throw Error('Import write conflict');
  row=null;
  if(announcing)await announce(store,owner,env);
  // A source that finished after its round was announced goes on to its questions.
  else if(sourceDone)await ask(store,owner,env);
  if(!more)await prepareReport(store,owner,env,{tag,build,newCard,rebuild:true,since:settledAt});
  return more?{worker:next.data.worker,attempt:0}:null;
 }catch(error){
  // Transient Gmail/model failures retry with backoff; only repeated failure pauses (Gmail) or stops
  // the source with a message to import again (a connected source).
  let retry=false;
  if(row&&work==='gmail'&&error?.reconnect){
   // Google refused the sign-in: retrying cannot help. The import pauses until Gmail is reconnected.
   const data=structuredClone(row.data);markGmailReconnect(data,error,'import');
   await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).catch(()=>{});
   return null;
  }
  if(row&&work){
   const data=structuredClone(row.data),name=work==='source'?nextSourceWork(data,now())?.source?.name:null;
   const target=name?data.connections[name]:data.job,failures=(target.failures??0)+1;retry=failures<=STEP_RETRIES;
   if(retry)target.failures=failures;
   else if(name){const label=CONNECTED_SOURCES[name].label;delete target.failures;delete target.pending;target.status=target.credential?'connected':'not_connected';target.error=`Couldn’t finish reading your ${label} history. Import it again from your account page.`;}
   else {delete target.failures;target.error='Import paused after a failed step; retry preserves completed work.';}
   const announcing=!retry&&name&&settle(data,now());
   retry=await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).then(Boolean,()=>false)&&retry;
   console.log(JSON.stringify({event:'gmail_worker_step_failed',work,failures,retrying:retry}));
   if(announcing)await announce(store,owner,env).catch(()=>{});
   if(retry){await wait(5000*2**(failures-1));return {worker:chainWorker(data),attempt:0};}
  }else{
   if(row)await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});
   console.log(JSON.stringify({event:'gmail_worker_step_failed'}));
  }
  return null;
 }
}
// Marks the round announced in the row being written and returns true the first time the round has
// settled: Gmail finished (or never started) and no source still reading or awaiting approval inside
// the cutoff. The caller sends the completion text after the write.
function settle(data,at){
 if(active(data.job?.status)||!sourcesSettled(data,at))return false;
 const round=importRound(data);
 if(!round?.done||data.announced===round.key)return false;
 data.announced=round.key;return true;
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
// A connected source still reading or awaiting approval restarts the same way (its failures stop the
// source with a message instead of pausing, so it has no backoff).
export function sweepDue(row,now=Date.now()){
 const job=row.job,quiet=now-Date.parse(row.updated_at),gmail=['listing','extracting','questions'].includes(job?.status);
 if((!gmail&&!sourcesActive({connections:row.connections}))||Date.parse(row.lease_until)>now||quiet<SWEEP_QUIET_MS)return false;
 if(!gmail||!job.error)return true;
 const retries=job.sweep_retries??0;
 return retries<SWEEP_RETRIES&&quiet>=300000*2**retries;
}
// Onboarding reminders due (lib/onboarding.js), metered and capped per person like the profile texts.
const onboardingReminders=(store,env)=>import('./onboarding.js').then(m=>m.sendOnboardingReminders(store,env,undefined,{wrap:async(owner,work)=>
 (await checkCaps(store,owner,env)).capped?{status:'capped'}:withUsage({store,env,conversation:owner,operation:'onboarding-reminder:'+owner,feature:'onboarding',job:'gmail_sweep',quiet:true},work)}));
// The summary now goes right after the count, so this is only a safety net: a summary still unsent a day
// after the count (the send was interrupted, or there was too little to say then and still is).
export async function sweepGmailImports(store,env,{schedule=scheduleGmail,now=Date.now(),profile=(s,o,e)=>sendProfile(s,o,e),reminders=onboardingReminders}={}){
 // Profile summaries not sent 24 hours after the last import text (db/024_gmail_profile_due.sql).
 let profiles=0;
 for(const owner of await store.gmailProfilesDue?.()??[]){if((await checkCaps(store,owner,env)).capped)continue;try{if((await withUsage({store,env,conversation:owner,operation:'gmail-profile:'+owner,feature:'gmail_import',job:'gmail_sweep',quiet:true},()=>profile(store,owner,env)))?.status==='sent')profiles++;}catch{console.log(JSON.stringify({event:'gmail_profile_send_failed'}));}}
 const rows=await store.quietGmailImports(new Date(now-SWEEP_QUIET_MS).toISOString());
 let restarted=0,abandoned=0;
 for(const candidate of rows){
  if(!sweepDue(candidate,now)){if(candidate.job?.error&&(candidate.job.sweep_retries??0)>=SWEEP_RETRIES)abandoned++;continue;}
  const row=await store.claimGmailImport(candidate.conversation_id);if(!row)continue;
  const data=structuredClone(row.data);
  if(data.job?.error){data.job.sweep_retries=(data.job.sweep_retries??0)+1;delete data.job.error;}
  newWorker(data);
  if(await store.finishGmailImport(candidate.conversation_id,row.revision,data,row.token_ciphertext)){schedule(candidate.conversation_id,env,{worker:data.worker});restarted++;}
 }
 const reminded=(await reminders(store,env).catch(()=>{console.log(JSON.stringify({event:'onboarding_reminder_failed',step:'sweep'}));return null;}))?.reminders??0;
 if(rows.length||profiles||reminded)console.log(JSON.stringify({event:'gmail_sweep',quiet:rows.length,restarted,abandoned,profiles,reminders:reminded}));
 return {quiet:rows.length,restarted,abandoned,profiles,reminders:reminded};
}
// The shared secret is generated inside Supabase Vault by db/023_gmail_sweep.sql and read here with
// the server's database access, so nobody has to copy it between services.
let sweepSecret=null;
export async function handleGmailSweep(req,res,store,env){
 const received=Buffer.from(req.headers.authorization??'');
 try{sweepSecret??=await store.gmailSweepSecret();}catch{return json(res,503,{error:'Sweep not configured.'});}
 const expected=typeof sweepSecret==='string'&&sweepSecret.length>=32?Buffer.from('Bearer '+sweepSecret):null;
 if(!expected||received.length!==expected.length||!timingSafeEqual(received,expected))return json(res,401,{error:'Unauthorized.'});
 if(env.GMAIL_IMPORT_ENABLED!=='true')return json(res,503,{error:'Gmail import is not enabled.'});
 const started=Date.now();
 try{const result=await sweepGmailImports(store,env);await recordJobRun(store,'gmail_sweep',started,'ok',result);return json(res,200,result);}
 catch{console.log(JSON.stringify({event:'gmail_sweep_failed'}));await recordJobRun(store,'gmail_sweep',started,'failed');return json(res,503,{error:'Sweep failed.'});}
}
export const resetSweepSecret=()=>{sweepSecret=null;};
