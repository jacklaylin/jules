import {HISTORY_YEARS,RECENT_YEARS,EMAIL_LIMIT,yearsAgo,discoveryPlan,relatedOrderQuery,discoveryQuery,admitPage,advanceSearch,captureYield} from './gmail-discovery.js';
import {randomBytes} from 'node:crypto';
import {json,readJson} from './http.js';
import {wishlistUser} from './wishlist.js';
import {gmailConfiguration,digest,authorizationURL,exchangeCode,accessToken,sealToken,openToken,gmailGet,revokeToken} from './gmail-client.js';
import {prepareReceiptEmail,triageCandidate} from './receipt-email.js';
import {RECEIPT_SCHEMA,RECEIPT_PROMPT,TRIAGE_SCHEMA,TRIAGE_PROMPT,receiptModel,reconcileReceipt,relinkPending,projectReceiptState,projectReceiptEvidence,purchaseEvidence} from './receipt-extraction.js';
import {loadReceipts,receiptWrite} from './evidence.js';
import {withUsage} from './usage.js';
import {effectiveRecipient,receiptLearningView,proposeReceiptQuestions,replaceReceiptQuestions,addReceiptQuestions,MAX_RECEIPT_QUESTIONS,interpretReceiptAnswer,applyReceiptAnswer,applyReceiptFeedback} from './receipt-feedback.js';

export const IMPORT_LIMIT=EMAIL_LIMIT;
// Per step: triage this many upcoming emails from metadata, then fully analyze this many in parallel.
export const TRIAGE_WINDOW=24,EXTRACT_BATCH=6,EMAIL_ATTEMPTS=2;
export const CONSENT_VERSION='gmail-receipts-5y-1000-v2';
// Bump when triage or extraction changes materially: emails an older version judged irrelevant
// (scanned_ids) are then read again instead of being skipped forever.
export const SCAN_VERSION='2026-10-13b';
export function newImportJob(now=Date.now()){
 const after=yearsAgo(now,HISTORY_YEARS),before=Math.floor(now/1000);
 return {status:'listing',after,before,recent_after:yearsAgo(now,RECENT_YEARS),period_years:HISTORY_YEARS,limit:IMPORT_LIMIT,search_plan:discoveryPlan(now),search_index:0,ids:[],processed:[],limited:false,started_at:new Date(now).toISOString()};
}
// Exactly one background chain may advance a job: the one whose id the job last recorded.
// Starting, resuming or finishing a step records a fresh id before dispatching, so older chains stop.
export const newWorker=job=>job.worker=randomBytes(12).toString('hex');
// The background worker writes after every step, so a quiet minute with no lease means it stopped.
const STALL_MS=60000;
const stalled=row=>['listing','extracting','questions'].includes(row?.data?.job?.status)&&row.updated_at&&Date.now()-Date.parse(row.updated_at)>STALL_MS&&!(Date.parse(row.lease_until)>Date.now());
export function publicImport(row,receipts){
 const data=row?.data??{},view=receipts?receiptLearningView(projectReceiptState(receipts.state)):{questions:[],purchase_history:[],learning_observations:[]};
 return {connected:Boolean(row?.token_ciphertext),account:data.account??null,revision:row?.revision??0,status:data.job?.status??'not_started',processed:data.job?.processed?.length??0,total:data.job?.ids?.length??0,limited:data.job?.limited??false,period_days:data.job?.search_plan?null:90,period_years:data.job?.period_years??null,limit:data.job?.limit??200,consent_required:data.consent?.version!==CONSENT_VERSION,search_pass:data.job?.search_plan?.[data.job.search_index]?.name??null,discovery_bounded:Boolean(data.job?.search_plan?.some(p=>p.truncated)),yield:data.job?.current_yield??null,first_100:data.job?.first_100??null,
  failed:Boolean(data.job?.error)||Boolean(stalled(row)),changed_sources:(data.changed_sources??[]).length,warnings:(data.sources??[]).filter(s=>s.warnings?.length).length+(data.job?.quality?.unanalyzed_warnings??0),pending_events:receipts?.pending.length??0,
  questions:view.questions.map(({id,question})=>({id,question})),items:view.purchase_history.map(i=>({id:i.id,brand:i.brand,product:i.product,merchant:i.merchant,size_label:i.size_label,color:i.color,quantity:i.quantity,recipient:effectiveRecipient(i),outcome:i.outcome})),learning_count:view.learning_observations.length};
}
// One bounded step. row.receipts is the receipt history projected from evidence; the step
// returns new purchase evidence for the caller to persist with the job update.
export async function importStep(row,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher)}={}){
 const data=structuredClone(row.data),job=data.job,receipts=row.receipts;
 if(!job||!['listing','extracting','questions'].includes(job.status))return {...row,evidence:[]};
 let state=structuredClone(receipts.state),pending=structuredClone(receipts.pending),token=await accessToken(openToken(row.token_ciphertext,row.conversation_id,env),env,fetcher);
 const records=[],model='model:'+(env.OPENAI_MODEL||'gpt-4.1-mini');
 const done=(clearError=false)=>{
  if(clearError)delete job.error;
  const write=receiptWrite(data,receipts,state,records.map(r=>purchaseEvidence(r,model)));
  return {...row,data:write.data,evidence:write.evidence,receipts:{state,pending},token_ciphertext:sealToken(token,row.conversation_id,env)};
 };
 if(job.status==='listing'){
  if(job.search_plan){
   job.baseline_items??=state.items.map(i=>i.id);
   const stage=job.search_plan[job.search_index];
   if(!stage){job.status='questions';return done();}
   if(stage.name==='related_orders'&&!stage.query)stage.query=relatedOrderQuery({...data,feedback:state},job);
   if(!stage.query){stage.done=true;advanceSearch(job);return done();}
   stage.executed_query??=discoveryQuery(stage,data);
   const params=new URLSearchParams({q:stage.executed_query,maxResults:String(Math.min(50,stage.budget-stage.admitted,job.limit-job.ids.length)),...(stage.page?{pageToken:stage.page}:{})});
   const page=await gmailGet('messages?'+params,token,fetcher);admitPage(job,page);
  }else{
   // Existing jobs keep the scope previously approved; only new consent starts five years.
   const params=new URLSearchParams({q:job.query,maxResults:'50',...(job.page?{pageToken:job.page}:{})});
   const page=await gmailGet('messages?'+params,token,fetcher);
   job.ids=[...new Set([...job.ids,...(page.messages??[]).map(m=>m.id)])].slice(0,job.limit??200);
   job.page=page.nextPageToken??null;
   if(job.ids.length>=(job.limit??200)){job.limited=Boolean(job.page);job.page=null;}
   if(!job.page)job.status='extracting';
  }
 }else if(job.status==='extracting'){
  const quality=job.quality??={triage_extract:0,triage_skip:0,withheld_fields:0,withheld_events:0,failed:0,unanalyzed_warnings:0};
  if(data.scan_version!==SCAN_VERSION){
   // Reopen this job's emails that were skipped or found irrelevant under the older version.
   const shopping=new Set((data.sources??[]).map(s=>s.id)),before=job.processed.length;
   job.processed=job.processed.filter(id=>shopping.has(id));job.triage={};delete job.attempts;
   quality.rescanned=(quality.rescanned??0)+before-job.processed.length;
   data.scanned_ids=[];data.scan_version=SCAN_VERSION;
  }
  const scanned=new Set(data.scanned_ids??[]),known=new Map((data.sources??[]).map(s=>[s.id,s]));
  const open=()=>job.ids.filter(id=>!job.processed.includes(id));
  // Irrelevant emails from earlier imports are kept only as ids so they are never fetched again.
  for(const id of open())if(scanned.has(id))job.processed.push(id);
  job.triage??={};
  const untriaged=open().slice(0,TRIAGE_WINDOW).filter(id=>!job.triage[id]&&!known.has(id));
  if(untriaged.length){
   const candidates=await Promise.all(untriaged.map(async id=>triageCandidate({...await gmailGet('messages/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject',token,fetcher),id})));
   // Triage only saves work: if it fails or omits an email, that email is fully analyzed.
   let decisions=[];
   try{decisions=(await interpret({schema:TRIAGE_SCHEMA,instructions:TRIAGE_PROMPT,context:{emails:candidates}})).decisions;}catch{console.log(JSON.stringify({event:'gmail_triage_failed_open',emails:untriaged.length}));}
   for(const id of untriaged){const action=Array.isArray(decisions)&&decisions.find(d=>d?.id===id)?.action==='skip'?'skip':'extract';job.triage[id]=action;quality['triage_'+action]++;}
  }
  for(const id of open())if(job.triage[id]==='skip'){job.processed.push(id);scanned.add(id);delete job.triage[id];}
  const batch=open().filter(id=>job.triage[id]==='extract'||known.has(id)).slice(0,EXTRACT_BATCH);
  if(!open().length){if(job.search_plan)advanceSearch(job);else job.status='questions';}
  else if(batch.length){
   const existing=source=>state.items.filter(i=>[i.order_reference,i.original?.order_reference].some(r=>r&&source.text.includes(r))).slice(0,200).map(i=>({id:i.id,merchant:i.merchant,order_reference:i.order_reference,product:i.product,sku:i.sku,size_label:i.size_label,color:i.color,original:i.original}));
   const results=await Promise.allSettled(batch.map(async id=>{
    const source=await prepare(await gmailGet('messages/'+encodeURIComponent(id)+'?format=full',token,fetcher),token,{fetcher});
    if(known.has(id))return {source};
    const proposal=await interpret({schema:RECEIPT_SCHEMA,instructions:RECEIPT_PROMPT,context:{source,existing_items:existing(source)}});
    if(!Array.isArray(proposal.events)||proposal.events.length>40)throw Error('Invalid receipt analysis');
    return {source,proposal};
   }));
   // A batch that fails entirely looks like a provider outage: fail the step (the worker retries
   // with backoff) so no email is skipped because of it. A lone remaining email, or emails that
   // already failed while others succeeded, are counted per email so one cannot stall the import.
   if(results.every(r=>r.status==='rejected')&&batch.length>1&&!batch.every(id=>job.attempts?.[id]))throw results[0].reason;
   for(const [n,result]of results.entries()){
    const id=batch[n];
    if(result.status==='rejected'){
     job.attempts??={};job.attempts[id]=(job.attempts[id]??0)+1;
     // An email that keeps failing while others succeed is skipped for this import, not marked scanned.
     if(job.attempts[id]>=EMAIL_ATTEMPTS){job.processed.push(id);delete job.attempts[id];delete job.triage[id];quality.failed++;}
     console.log(JSON.stringify({event:'gmail_email_analysis_failed',attempt:job.attempts[id]??EMAIL_ATTEMPTS}));
     continue;
    }
    const {source,proposal}=result.value;delete job.triage[id];job.processed.push(id);
    if(!proposal){
     // Already analyzed: changed content is held separately and never overwrites evidence or corrections.
     if(!known.get(id).sender_domain&&source.sender_domain)data.sources=data.sources.map(s=>s.id===id?{...s,sender_domain:source.sender_domain}:s);
     if(known.get(id).fingerprint!==source.fingerprint)data.changed_sources=[...(data.changed_sources??[]).filter(s=>s.id!==id),{id,fingerprint:source.fingerprint,date:source.date}];
     continue;
    }
    let found=0;
    for(const [index,event]of proposal.events.entries()){
     try{const merged=reconcileReceipt(state,source,{events:[event]},{eventOffset:index});state=merged.state;pending.push(...merged.pending);records.push(...merged.records);found+=merged.records.length;quality.withheld_fields+=merged.records.reduce((n,r)=>n+(r.withheld_fields?.length??0),0);}
     catch(error){quality.withheld_events++;source.warnings=[...(source.warnings??[]),'Proposed shopping event could not be validated; withheld'];console.log(JSON.stringify({event:'gmail_event_withheld',reason:error.message,kind:typeof event?.kind==='string'?event.kind.slice(0,40):null}));}
    }
    const {text:_text,...metadata}=source;
    if(found>0||state.items.some(i=>i.source_ids.includes(id)))data.sources=[...(data.sources??[]),{...metadata,shopping_evidence:true}];
    else {scanned.add(id);if(source.warnings?.length)quality.unanalyzed_warnings++;}
   }
  }
  data.scanned_ids=[...scanned];
  const linked=relinkPending(state,pending);state=linked.state;pending=linked.pending;captureYield(job,state);
 }else {
  const linked=relinkPending(state,pending);state=linked.state;pending=linked.pending;
  // Only one question selection per import, not an automatic refill after each answer.
  // Questions are optional: an invalid proposal is dropped, and a failed selection finishes the
  // import with the existing open questions rather than pausing a completed history.
  try{
   const proposed=await proposeReceiptQuestions({items:projectReceiptState(state).items,previous_feedback:state.feedback,previous_questions:state.questions,pending_events:pending,profile:(await row.profile?.())??[],question_selection:'This is a new explicitly requested import. Select the combined top five unresolved questions again, including existing open questions only when still unanswered by new evidence and consequential. The selected set replaces previous open questions; resolved and deferred questions must not be repeated.'},interpret);
   const proposals=Array.isArray(proposed?.questions)?proposed.questions.slice(0,MAX_RECEIPT_QUESTIONS):[];
   const valid=proposals.filter(p=>{try{addReceiptQuestions(state,[p]);return true;}catch{return false;}});
   if(valid.length<proposals.length)console.log(JSON.stringify({event:'gmail_questions_dropped',proposed:proposals.length,dropped:proposals.length-valid.length}));
   state=replaceReceiptQuestions(state,valid);
  }catch(error){job.quality&&(job.quality.questions_failed=true);console.log(JSON.stringify({event:'gmail_question_selection_failed',error:error.message?.slice(0,80)??null}));}
  captureYield(job,state);job.status='ready';job.completed_at=new Date().toISOString();
 }
 return done(true);
}
const cookieName='__Host-jules-gmail-state';
const cookieValue=req=>(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
const cookie=value=>`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value?600:0}`;
function redirect(res,location){res.statusCode=303;res.setHeader('Location',location);res.end();}
export function createGmailHandler({env=process.env,storeFactory,auth=wishlistUser,fetcher=fetch,interpret,prepare,schedule}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');let store,row,owner;
  try{
   if(env.GMAIL_IMPORT_ENABLED!=='true')return json(res,503,{error:'Gmail import is not enabled yet.'});
   const config=gmailConfiguration(env);store=storeFactory(env);const query=new URL(req.url,'https://jules.invalid').searchParams;
   if(query.get('gmail')==='callback'){
    if(req.method!=='GET')return json(res,405,{error:'Use GET.'});
    const state=query.get('state');if(!state||!state.startsWith('5y1000.')||state.length>100||state!==cookieValue(req))return json(res,403,{error:'Connection expired. Open onboarding and connect again.'});
    res.setHeader('Set-Cookie',cookie(''));owner=await store.consumeGmailOAuth(digest(state));
    if(!owner)return json(res,403,{error:'Connection expired or already used.'});
    if(query.has('error'))return redirect(res,'/onboarding?gmail=declined');
    const code=query.get('code');if(!code||code.length>4096)throw Error('Missing authorization code');
    row=await store.claimGmailImport(owner);if(!row)return json(res,409,{error:'Import is busy. Try connecting again.'});
    const tokens=await exchangeCode(code,env,fetcher);const account=await gmailGet('profile',tokens,fetcher);
    // Bind the Gmail account to an existing invited member of this exact conversation.
    const member=typeof account.emailAddress==='string'?await store.wishlistMember(account.emailAddress.toLowerCase()):null;
    if(member?.conversation_id!==owner){await revokeToken(tokens,fetcher);throw Error('Use the Gmail account invited to this conversation');}
    const data={...row.data,account:account.emailAddress,consent:{version:CONSENT_VERSION,at:new Date().toISOString()},...(schedule?{job:['listing','extracting','questions'].includes(row.data.job?.status)?row.data.job:newImportJob()}: {})};
    if(schedule)newWorker(data.job);
    if(!await store.finishGmailImport(owner,row.revision,data,sealToken(tokens,owner,env)))throw Error('Connection write conflict');row=null;
    if(schedule)schedule(owner,data.job.worker);
    return redirect(res,'/onboarding?gmail=connected');
   }
   if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Use GET or POST.'});
   const access=await auth(req.headers,env,store,fetcher);if(access.status!==200)return json(res,access.status,{error:'Sign in with your invited email to continue.'});owner=access.conversation;
   if(!await store.onboardingSession(owner))return json(res,403,{error:'This account is not invited to the Gmail pilot.'});
   if(req.method==='GET'){
    let current=await store.gmailImport(owner);
    // A background chain that stopped without recording an error (a lost dispatch) resumes when the page is open.
    if(schedule&&current?.token_ciphertext&&stalled(current)&&!current.data.job.error&&(row=await store.claimGmailImport(owner))){
     const data=structuredClone(row.data);newWorker(data.job);
     if(await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext)){current={...row,data,lease_until:null,updated_at:new Date().toISOString()};schedule(owner,data.job.worker);console.log(JSON.stringify({event:'gmail_import_stall_resumed'}));}
     row=null;
    }
    return json(res,200,{...publicImport(current,current?await loadReceipts(store,owner,current):null),background:Boolean(schedule)});
   }
   if(req.headers.origin!==config.origin)return json(res,403,{error:'Continue from the Jules website.'});
   const input=await readJson(req,24000);
   if(input.action==='connect'){
    if(input.consent!==CONSENT_VERSION)return json(res,400,{error:'Confirm receipt analysis consent first.'});
    const state='5y1000.'+randomBytes(32).toString('base64url');if(!await store.beginGmailOAuth(owner,digest(state)))return json(res,409,{error:'Import is busy. Try again shortly.'});
    res.setHeader('Set-Cookie',cookie(state));return json(res,200,{url:authorizationURL(state,env)});
   }
   if(!['start','resume','step','answer','edit','disconnect','delete-history'].includes(input.action))return json(res,400,{error:'Unknown import action.'});
   row=await store.claimGmailImport(owner);if(!row)return json(res,409,{error:'Another import update is running. Try again shortly.'});
   let data=structuredClone(row.data),token=row.token_ciphertext,feedbackApplied,evidence=null,clear=false;const model=interpret??(request=>receiptModel(request,env,fetcher));
   const receipts=await loadReceipts(store,owner,row);let state=receipts.state,pending=receipts.pending;
   if(input.action==='disconnect'){
    if(token)await revokeToken(openToken(token,owner,env),fetcher);token=null;if(data.job&&data.job.status!=='ready')data.job.status='paused';
   }else if(input.action==='delete-history'){
    if(input.confirm!==true)throw Error('Confirm deletion of imported history');
    if(token)await revokeToken(openToken(token,owner,env),fetcher);token=null;data={questions:[]};evidence=[];clear=true;state=projectReceiptEvidence(owner,[]).state;pending=[];
   }else if(input.action==='start'){
    if(!token)throw Error('Connect Gmail first');if(['listing','extracting','questions'].includes(data.job?.status))throw Error('Import already running');
    if(data.consent?.version!==CONSENT_VERSION&&input.consent!==CONSENT_VERSION){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);row=null;return json(res,400,{error:'Review the expanded five-year import consent before starting.'});}
    data.consent={version:CONSENT_VERSION,at:new Date().toISOString()};
    data.job=newImportJob();if(schedule)newWorker(data.job);
   }else if(input.action==='resume'){
    if(!token)throw Error('Connect Gmail first');
    if(data.job){delete data.job.error;if(schedule)newWorker(data.job);}
   }else if(input.action==='step'){
    if(!token)throw Error('Connect Gmail first');
    const next=await withUsage({store,env,conversation:owner,operation:'gmail:'+(data.job?.started_at??'step'),feature:'gmail_import'},()=>importStep({...row,receipts,profile:async()=>(await store.profile(owner)).facts},env,{fetcher,interpret:model,...(prepare?{prepare}:{})}));data=next.data;token=next.token_ciphertext;evidence=next.evidence;({state,pending}=next.receipts??receipts);
   }else if(input.action==='answer'){
    if(input.question_id!=null&&(typeof input.question_id!=='string'||!state.questions.some(q=>q.id===input.question_id&&q.status==='open')))throw Error('Question already answered or unavailable');
    const context=structuredClone(state);context.answer_target=input.question_id;
    const proposal=await interpretReceiptAnswer(context,input.message,model);
    if(input.question_id!=null&&proposal.actions.some(a=>a.question_id!==input.question_id))throw Error('Answer scope needs clarification');
    feedbackApplied=proposal.actions.length;
    state=applyReceiptAnswer(state,proposal,{id:randomBytes(16).toString('hex'),owner_id:owner,source:'chat_answer',at:new Date().toISOString()});
   }else {
    // Future closet controls reuse these validated structured actions; no UI is built here.
    if(!input.event||typeof input.event!=='object')throw Error('Missing correction');
    state=applyReceiptFeedback(state,{...input.event,id:randomBytes(16).toString('hex'),owner_id:owner,source:'closet_edit',at:new Date().toISOString()});
   }
   if(evidence===null)({data,evidence}=receiptWrite(data,receipts,state));
   if(!await store.finishGmailImport(owner,row.revision,data,token,evidence,clear))throw Error('Import changed; reload');row=null;
   if(schedule&&data.job&&['start','resume'].includes(input.action))schedule(owner,data.job.worker);
   return json(res,200,{background:Boolean(schedule),...publicImport({data,token_ciphertext:token},{state,pending}),...(feedbackApplied===undefined?{}:{feedback_applied:feedbackApplied})});
  }catch(error){
   if(row){const data=structuredClone(row.data);if(data.job)data.job.error='Import paused after a failed step; retry preserves completed work.';await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).catch(()=>{});}
   console.log(JSON.stringify({event:'gmail_import_failed',status:error.status??503}));
   return json(res,error.status??503,{error:'Could not complete this step. Your saved history and corrections are preserved. Retry, or reconnect Gmail if access expired.'});
  }
 };
}
