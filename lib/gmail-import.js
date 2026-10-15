import {HISTORY_YEARS,RECENT_YEARS,EMAIL_LIMIT,yearsAgo,discoveryPlan,relatedOrderQuery,nextStoreQuery,admitStorePage,discoveryQuery,admitPage,advanceSearch,captureYield} from './gmail-discovery.js';
import {randomBytes} from 'node:crypto';
import {json,readJson} from './http.js';
import {wishlistUser} from './wishlist.js';
import {gmailConfiguration,digest,authorizationURL,exchangeCode,accessToken,sealToken,openToken,gmailGet,revokeToken} from './gmail-client.js';
import {prepareReceiptEmail,triageCandidate} from './receipt-email.js';
import {mediaRecords,priceRecords,RECEIPT_SCHEMA,RECEIPT_PROMPT,TRIAGE_SCHEMA,TRIAGE_PROMPT,receiptModel,relinkPending,projectReceiptState,projectReceiptEvidence,purchaseEvidence} from './receipt-extraction.js';
import {loadReceipts,receiptWrite} from './evidence.js';
import {withUsage} from './usage.js';
import {modelSource,mediaCounts} from './order-media.js';
import {orderPhotoEvidence,photoItems} from './order-photos.js';
import {existingItems,applyProposal,refreshQuestions} from './purchase-sources.js';
import {CONNECTION_ACTIONS,CONNECTED_SOURCES,enabledSources,connectionAction,publicConnection,sourcesActive} from './connected-sources.js';
import {nextReceiptQuestion} from './receipt-notifications.js';
import {effectiveRecipient,receiptLearningView,interpretReceiptAnswer,applyReceiptAnswer,applyReceiptFeedback} from './receipt-feedback.js';

export const IMPORT_LIMIT=EMAIL_LIMIT;
// Per step: triage this many upcoming emails from metadata, then fully analyze this many in parallel.
export const TRIAGE_WINDOW=24,EXTRACT_BATCH=6,EMAIL_ATTEMPTS=2;
export const CONSENT_VERSION='gmail-receipts-5y-1000-v3';
// 2026-10-14: triage and extraction now see subject and sender (header lookup was case-sensitive).
// Bump when triage or extraction changes materially: emails an older version judged irrelevant
// (scanned_ids) are then read again instead of being skipped forever.
// Bump when price reading changes: shopping emails already read are re-read once for prices only.
export const PRICE_VERSION=1;
// Bump when order photo/link reading changes: shopping emails already read are re-read once for those only.
export const PHOTO_VERSION=1;
const reread=s=>(s.price_version??0)<PRICE_VERSION||(s.photo_version??0)<PHOTO_VERSION;
export const SCAN_VERSION='2026-10-14';
export function newImportJob(now=Date.now()){
 const after=yearsAgo(now,HISTORY_YEARS),before=Math.floor(now/1000);
 return {status:'listing',after,before,recent_after:yearsAgo(now,RECENT_YEARS),period_years:HISTORY_YEARS,limit:IMPORT_LIMIT,search_plan:discoveryPlan(now),search_index:0,ids:[],processed:[],limited:false,started_at:new Date(now).toISOString()};
}
// Exactly one background chain may advance a row (the Gmail job and every connected source): the one
// whose id the row last recorded. Starting, resuming or finishing a step records a fresh id before
// dispatching, so older chains stop. The job keeps a copy for rows written before sources shared the chain.
export function newWorker(data){const id=randomBytes(12).toString('hex');data.worker=id;if(data.job)data.job.worker=id;return id;}
export const chainWorker=data=>data?.worker??data?.job?.worker;
// The background worker writes after every step, so a quiet minute with no lease means it stopped.
const STALL_MS=60000;
const stalled=row=>(['listing','extracting','questions'].includes(row?.data?.job?.status)||sourcesActive(row?.data))&&row.updated_at&&Date.now()-Date.parse(row.updated_at)>STALL_MS&&!(Date.parse(row.lease_until)>Date.now());
export function publicImport(row,receipts){
 const data=row?.data??{},view=receipts?receiptLearningView(projectReceiptState(receipts.state)):{questions:[],purchase_history:[],learning_observations:[]};
 return {connections:Object.fromEntries(Object.keys(CONNECTED_SOURCES).map(name=>[name,publicConnection(data.connections?.[name])])),connected:Boolean(row?.token_ciphertext),account:data.account??null,last_import_at:data.job?.completed_at??null,revision:row?.revision??0,status:data.job?.status??'not_started',processed:data.job?.processed?.length??0,already_read:data.job?.already_read??0,total:data.job?.ids?.length??0,limited:data.job?.limited??false,period_days:data.job?.search_plan?null:90,period_years:data.job?.period_years??null,limit:data.job?.limit??200,consent_required:data.consent?.version!==CONSENT_VERSION,consent_version:CONSENT_VERSION,search_pass:data.job?.search_plan?.[data.job.search_index]?.name??null,discovery_bounded:Boolean(data.job?.search_plan?.some(p=>p.truncated)),yield:data.job?.current_yield??null,first_100:data.job?.first_100??null,
  failed:Boolean(data.job?.error)||Boolean(stalled(row)),changed_sources:(data.changed_sources??[]).length,warnings:(data.sources??[]).filter(s=>s.warnings?.length).length+(data.job?.quality?.unanalyzed_warnings??0),pending_events:receipts?.pending.length??0,
  questions:view.questions.map(({id,question})=>({id,question})),items:view.purchase_history.map(i=>({id:i.id,brand:i.brand,product:i.product,merchant:i.merchant,size_label:i.size_label,color:i.color,quantity:i.quantity,recipient:effectiveRecipient(i),outcome:i.outcome})),learning_count:view.learning_observations.length};
}
// One bounded step. row.receipts is the receipt history projected from evidence; the step
// returns new purchase evidence for the caller to persist with the job update.
export async function importStep(row,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher)}={}){
 const data=structuredClone(row.data),job=data.job,receipts=row.receipts;
 if(!job||!['listing','extracting','questions'].includes(job.status))return {...row,evidence:[]};
 let state=structuredClone(receipts.state),pending=structuredClone(receipts.pending),token=await accessToken(openToken(row.token_ciphertext,row.conversation_id,env),env,fetcher);
 const records=[],photos=[],model='model:'+(env.OPENAI_MODEL||'gpt-4.1-mini');
 const done=(clearError=false)=>{
  if(clearError)delete job.error;
  const write=receiptWrite(data,receipts,state,[...records.map(r=>purchaseEvidence(r,model)),...photos]);
  return {...row,data:write.data,evidence:write.evidence,receipts:{state,pending},token_ciphertext:sealToken(token,row.conversation_id,env)};
 };
 if(job.status==='listing'){
  if(job.search_plan){
   job.baseline_items??=state.items.map(i=>i.id);
   const stage=job.search_plan[job.search_index];
   if(!stage){job.status='questions';return done();}
   if(stage.name==='related_orders'&&!stage.query)stage.query=relatedOrderQuery({...data,feedback:state},job);
   // Emails already read under the current rules (irrelevant ones, and purchase emails already priced)
   // are passed over without using the limit; the version checks reopen them when the rules change.
   const already=new Set(data.scan_version===SCAN_VERSION?[...data.scanned_ids??[],...(data.sources??[]).filter(s=>!reread(s)).map(s=>s.id)]:[]);
   // Gmail lists up to 500 ids per page; when many are skipped as already read, larger pages get past
   // them in a few steps instead of dozens.
   const size=remaining=>String(already.size?500:Math.max(1,Math.min(50,remaining)));
   if(stage.stores){
    const q=nextStoreQuery(stage,data,job);
    if(!q){stage.done=true;advanceSearch(job);return done();}
    const params=new URLSearchParams({q,maxResults:size(Math.min(stage.per_store-stage.store_admitted,stage.budget-stage.admitted,job.limit-job.ids.length)),...(stage.page?{pageToken:stage.page}:{})});
    admitStorePage(job,await gmailGet('messages?'+params,token,fetcher),already);
   }else{
    if(!stage.query){stage.done=true;advanceSearch(job);return done();}
    stage.executed_query??=discoveryQuery(stage,data);
    const params=new URLSearchParams({q:stage.executed_query,maxResults:size(Math.min(stage.budget-stage.admitted,job.limit-job.ids.length)),...(stage.page?{pageToken:stage.page}:{})});
    admitPage(job,await gmailGet('messages?'+params,token,fetcher),already);
   }
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
   const results=await Promise.allSettled(batch.map(async id=>{
    const source=await prepare(await gmailGet('messages/'+encodeURIComponent(id)+'?format=full',token,fetcher),token,{fetcher});
    if(known.has(id)){
     // Changed content is held separately (below), never re-read over existing evidence.
     if(!reread(known.get(id))||known.get(id).fingerprint!==source.fingerprint)return {source};
     return {source,proposal:await interpret({schema:RECEIPT_SCHEMA,instructions:RECEIPT_PROMPT,context:{source:modelSource(source),existing_items:[]}}),reprice:true};
    }
    const proposal=await interpret({schema:RECEIPT_SCHEMA,instructions:RECEIPT_PROMPT,context:{source:modelSource(source),existing_items:existingItems(state,source)}});
    if(!Array.isArray(proposal.events)||proposal.events.length>40)throw Error('Invalid receipt analysis');
    return {source,proposal};
   }));
   // A batch that fails entirely looks like a provider outage: fail the step (the worker retries
   // with backoff) so no email is skipped because of it. A lone remaining email, or emails that
   // already failed while others succeeded, are counted per email so one cannot stall the import.
   if(results.every(r=>r.status==='rejected')&&batch.length>1&&!batch.every(id=>job.attempts?.[id]))throw results[0].reason;
   const before=photoItems(state);
   for(const [n,result]of results.entries()){
    const id=batch[n];
    if(result.status==='rejected'){
     job.attempts??={};job.attempts[id]=(job.attempts[id]??0)+1;
     // An email that keeps failing while others succeed is skipped for this import, not marked scanned.
     if(job.attempts[id]>=EMAIL_ATTEMPTS){job.processed.push(id);delete job.attempts[id];delete job.triage[id];quality.failed++;}
     console.log(JSON.stringify({event:'gmail_email_analysis_failed',attempt:job.attempts[id]??EMAIL_ATTEMPTS}));
     continue;
    }
    const {source,proposal,reprice}=result.value;delete job.triage[id];job.processed.push(id);
    if(reprice){
     const known_source=known.get(id);
     if((known_source.price_version??0)<PRICE_VERSION){const priced=priceRecords(state,source,proposal);state=priced.state;records.push(...priced.records);quality.repriced=(quality.repriced??0)+priced.records.length;}
     if((known_source.photo_version??0)<PHOTO_VERSION){const media=mediaRecords(state,source,proposal);state=media.state;records.push(...media.records);quality.media_reread=(quality.media_reread??0)+media.records.length;}
     data.sources=data.sources.map(s=>s.id===id?{...s,price_version:PRICE_VERSION,photo_version:PHOTO_VERSION}:s);
    }
    if(!proposal||reprice){
     // Already analyzed: changed content is held separately and never overwrites evidence or corrections.
     if(!known.get(id).sender_domain&&source.sender_domain)data.sources=data.sources.map(s=>s.id===id?{...s,sender_domain:source.sender_domain}:s);
     if(known.get(id).fingerprint!==source.fingerprint)data.changed_sources=[...(data.changed_sources??[]).filter(s=>s.id!==id),{id,fingerprint:source.fingerprint,date:source.date}];
     continue;
    }
    const applied=applyProposal(state,source,proposal,{log:'gmail'}),found=applied.records.length;
    state=applied.state;pending.push(...applied.pending);records.push(...applied.records);
    quality.withheld_fields+=applied.withheld_fields;quality.withheld_events+=applied.withheld_events;
    if(applied.withheld_events)source.warnings=[...(source.warnings??[]),...Array(applied.withheld_events).fill('Proposed shopping event could not be validated; withheld')];
    const {text:_text,media:_media,...metadata}=source;
    if(found>0||state.items.some(i=>i.source_ids.includes(id)))data.sources=[...(data.sources??[]),{...metadata,shopping_evidence:true,price_version:PRICE_VERSION,photo_version:PHOTO_VERSION}];
    else {scanned.add(id);if(source.warnings?.length)quality.unanalyzed_warnings++;}
   }
   // Each item that gained an order photo in this step gets it stored once.
   photos.push(...await orderPhotoEvidence(before,state,{origin:'gmail',source_type:'gmail_message',fetcher,log:'gmail'}));
  }
  data.scanned_ids=[...scanned];
  const linked=relinkPending(state,pending);state=linked.state;pending=linked.pending;captureYield(job,state);
 }else {
  const linked=relinkPending(state,pending);state=linked.state;pending=linked.pending;
  // Only one question selection per import, not an automatic refill after each answer.
  // Questions are optional: a failed selection finishes the import with the existing open questions.
  const asked=await refreshQuestions(state,pending,{interpret,profile:(await row.profile?.())??[],reason:'This is a new explicitly requested import.',log:'gmail'});
  state=asked.state;if(asked.failed&&job.quality)job.quality.questions_failed=true;
  captureYield(job,state);job.status='ready';job.completed_at=new Date().toISOString();
  console.log(JSON.stringify({event:'gmail_order_media',...mediaCounts(state)}));
 }
 return done(true);
}
const cookieName='__Host-jules-gmail-state';
const cookieValue=req=>(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
const cookie=value=>`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value?600:0}`;
function redirect(res,location){res.statusCode=303;res.setHeader('Location',location);res.end();}
// Deleting imported history: revoke Gmail and empty the import; the write (clear) removes every
// purchase-history evidence row. Shared by the person's own delete and the owner's onboarding reset.
async function emptyHistory(owner,token,env,fetcher){
 if(token)await revokeToken(openToken(token,owner,env),fetcher);
 return {data:{questions:[]},token:null,evidence:[],clear:true,state:projectReceiptEvidence(owner,[]).state,pending:[]};
}
// The same delete outside a request: 'none' when nothing was ever imported, 'busy' while a step holds the lease.
export async function deleteImportedHistory(store,owner,env,fetcher=fetch){
 if(!await store.gmailImport(owner))return 'none';
 const row=await store.claimGmailImport(owner);if(!row)return 'busy';
 try{
  const next=await emptyHistory(owner,row.token_ciphertext,env,fetcher);
  return await store.finishGmailImport(owner,row.revision,next.data,next.token,next.evidence,next.clear)?'cleared':'busy';
 }catch(error){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});throw error;}
}
export function createGmailHandler({env=process.env,storeFactory,auth=wishlistUser,fetcher=fetch,interpret,prepare,schedule,ask=nextReceiptQuestion}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');let store,row,owner,connected=null;
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
    if(schedule)newWorker(data);
    if(!await store.finishGmailImport(owner,row.revision,data,sealToken(tokens,owner,env)))throw Error('Connection write conflict');row=null;
    if(schedule)schedule(owner,data.worker);
    return redirect(res,'/onboarding?gmail=connected');
   }
   if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Use GET or POST.'});
   const access=await auth(req.headers,env,store,fetcher);if(access.status!==200)return json(res,access.status,{error:'Sign in with your invited email to continue.'});owner=access.conversation;
   if(!await store.onboardingSession(owner))return json(res,403,{error:'This account is not invited to the Gmail pilot.'});
   if(req.method==='GET'){
    let current=await store.gmailImport(owner);
    // A background chain that stopped without recording an error (a lost dispatch) resumes when the page is open.
    if(schedule&&(current?.token_ciphertext||sourcesActive(current?.data))&&stalled(current)&&!current.data.job.error&&(row=await store.claimGmailImport(owner))){
     const data=structuredClone(row.data);newWorker(data);
     if(await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext)){current={...row,data,lease_until:null,updated_at:new Date().toISOString()};schedule(owner,data.worker);console.log(JSON.stringify({event:'gmail_import_stall_resumed'}));}
     row=null;
    }
    return json(res,200,{...publicImport(current,current?await loadReceipts(store,owner,current):null),background:Boolean(schedule),connections_available:enabledSources(env).map(s=>s.name)});
   }
   if(req.headers.origin!==config.origin)return json(res,403,{error:'Continue from the Jules website.'});
   const input=await readJson(req,24000);
   if(input.action==='connect'){
    if(input.consent!==CONSENT_VERSION)return json(res,400,{error:'Confirm receipt analysis consent first.'});
    const state='5y1000.'+randomBytes(32).toString('base64url');if(!await store.beginGmailOAuth(owner,digest(state)))return json(res,409,{error:'Import is busy. Try again shortly.'});
    res.setHeader('Set-Cookie',cookie(state));return json(res,200,{url:authorizationURL(state,env)});
   }
   // Connected sources (Shop, future MCPs): connection-<action> with the source's name.
   const connectionStep=typeof input.action==='string'&&input.action.startsWith('connection-')?input.action.slice(11):null;
   connected=connectionStep&&CONNECTION_ACTIONS.includes(connectionStep)?enabledSources(env).find(s=>s.name===input.source)??null:null;
   if(!connected&&!['start','resume','step','answer','edit','disconnect','delete-history'].includes(input.action))return json(res,400,{error:'Unknown import action.'});
   if(connectionStep==='connect'&&input.consent!==connected.consent)return json(res,400,{error:`Confirm ${connected.label} history analysis consent first.`});
   if(connectionStep==='connect')await store.ensureGmailImport(owner);
   row=await store.claimGmailImport(owner);if(!row)return json(res,409,{error:'Another import update is running. Try again shortly.'});
   let data=structuredClone(row.data),token=row.token_ciphertext,feedbackApplied,evidence=null,clear=false,sourceReady=false;const model=interpret??(request=>receiptModel(request,env,fetcher));
   let receipts=await loadReceipts(store,owner,row),state=receipts.state,pending=receipts.pending;
   if(connected){
    // Connected sources share this row, lease and evidence write with Gmail; a Gmail token is not required.
    const before=data.connections?.[connected.name]?.status;
    const next=await withUsage({store,env,conversation:owner,operation:connected.name+':'+(data.connections?.[connected.name]?.imported_at??'connect'),feature:connected.name+'_history'},()=>connectionAction(connected,connectionStep,{data,state,pending,owner,env,fetcher,interpret:model,profile:async()=>(await store.profile(owner)).facts}));
    sourceReady=connectionStep==='step'&&before==='extracting'&&next.data.connections[connected.name].status==='ready';
    ({state,pending}=next);
    // A re-read replaces this source's earlier evidence; history is rebuilt from what remains.
    if(next.clear_origin){await store.deleteEvidence(owner,next.clear_origin);receipts=await loadReceipts(store,owner,row);({state,pending}=receipts);}
    ({data,evidence}=receiptWrite(next.data,receipts,state,next.evidence));
    // With a background worker, approval polling and reading continue on the server, alongside Gmail.
    if(schedule&&sourcesActive(data))newWorker(data);
   }else if(input.action==='disconnect'){
    if(token)await revokeToken(openToken(token,owner,env),fetcher);token=null;if(data.job&&data.job.status!=='ready')data.job.status='paused';
   }else if(input.action==='delete-history'){
    if(input.confirm!==true)throw Error('Confirm deletion of imported history');
    ({data,token,evidence,clear,state,pending}=await emptyHistory(owner,token,env,fetcher));
   }else if(input.action==='start'){
    if(!token)throw Error('Connect Gmail first');if(['listing','extracting','questions'].includes(data.job?.status))throw Error('Import already running');
    if(data.consent?.version!==CONSENT_VERSION&&input.consent!==CONSENT_VERSION){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);row=null;return json(res,400,{error:'Review the expanded five-year import consent before starting.'});}
    data.consent={version:CONSENT_VERSION,at:new Date().toISOString()};
    data.job=newImportJob();if(schedule)newWorker(data);
   }else if(input.action==='resume'){
    if(!token)throw Error('Connect Gmail first');
    if(data.job){delete data.job.error;if(schedule)newWorker(data);}
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
   if(schedule&&((data.job&&['start','resume'].includes(input.action))||(connected&&sourcesActive(data))))schedule(owner,chainWorker(data));
   // Follow-up questions continue by text, as after a Gmail import. The send is keyed per question.
   if(sourceReady&&!schedule)await ask(store,owner,env).catch(()=>console.log(JSON.stringify({event:'connected_source_question_send_failed',source:connected.name})));
   return json(res,200,{background:Boolean(schedule),connections_available:enabledSources(env).map(s=>s.name),...publicImport({data,token_ciphertext:token},{state,pending}),...(feedbackApplied===undefined?{}:{feedback_applied:feedbackApplied})});
  }catch(error){
   if(row){const data=structuredClone(row.data);if(connected)data.connections={...data.connections,[connected.name]:{...data.connections?.[connected.name],error:`That ${connected.label} step didn’t finish. Try again; completed work is kept.`}};else if(data.job)data.job.error='Import paused after a failed step; retry preserves completed work.';await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).catch(()=>{});}
   console.log(JSON.stringify({event:'gmail_import_failed',status:error.status??503}));
   return json(res,error.status??503,{error:'Could not complete this step. Your saved history and corrections are preserved. Retry, or reconnect Gmail if access expired.'});
  }
 };
}
