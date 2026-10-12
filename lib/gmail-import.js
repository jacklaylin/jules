import {randomBytes} from 'node:crypto';
import {json,readJson} from './http.js';
import {wishlistUser} from './wishlist.js';
import {gmailConfiguration,digest,authorizationURL,exchangeCode,accessToken,sealToken,openToken,gmailGet,revokeToken} from './gmail-client.js';
import {prepareReceiptEmail} from './receipt-email.js';
import {RECEIPT_SCHEMA,RECEIPT_PROMPT,receiptModel,reconcileReceipt,relinkPending,emptyReceiptState,projectReceiptState} from './receipt-extraction.js';
import {receiptLearningView,proposeReceiptQuestions,replaceReceiptQuestions,interpretReceiptAnswer,applyReceiptAnswer,applyReceiptFeedback} from './receipt-feedback.js';

export const IMPORT_LIMIT=200;
export const CONSENT_VERSION='gmail-receipts-90d-v1';
export function newImportJob(now=Date.now()){
 // Gmail query syntax is retrieval filtering, never conversational intent routing.
 const after=Math.floor((now-90*86400000)/1000),before=Math.floor(now/1000);
 return {status:'listing',query:`after:${after} before:${before} -in:spam -in:trash {receipt invoice "order confirmation" "order confirmed" "your order" "return confirmation" "return received" "return accepted" refund refunded cancelled canceled "return label" "collection booking" "shipping confirmation" "purchase confirmation" "commande" "facture" "retour"}`,after,before,ids:[],page:null,processed:[],limited:false,started_at:new Date(now).toISOString()};
}
export function publicImport(row){
 const data=row?.data??{},state=data.feedback?projectReceiptState(data.feedback):null,view=state?receiptLearningView(state):{questions:[],purchase_history:[],learning_observations:[]};
 return {connected:Boolean(row?.token_ciphertext),account:data.account??null,revision:row?.revision??0,status:data.job?.status??'not_started',processed:data.job?.processed?.length??0,total:data.job?.ids?.length??0,limited:data.job?.limited??false,period_days:90,limit:IMPORT_LIMIT,
  failed:Boolean(data.job?.error),changed_sources:(data.changed_sources??[]).length,warnings:(data.sources??[]).filter(s=>s.warnings?.length).length,pending_events:(data.pending??[]).length,
  questions:view.questions.map(({id,question})=>({id,question})),items:view.purchase_history.map(i=>({id:i.id,brand:i.brand,product:i.product,merchant:i.merchant,size_label:i.size_label,color:i.color,quantity:i.quantity,recipient:i.recipient,outcome:i.outcome})),learning_count:view.learning_observations.length};
}
export async function importStep(row,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher)}={}){
 const data=structuredClone(row.data),job=data.job;if(!job||!['listing','extracting','questions'].includes(job.status))return row;
 let token=await accessToken(openToken(row.token_ciphertext,row.conversation_id,env),env,fetcher);
 if(job.status==='listing'){
  const params=new URLSearchParams({q:job.query,maxResults:'50',...(job.page?{pageToken:job.page}:{})});
  const page=await gmailGet('messages?'+params,token,fetcher);
  job.ids=[...new Set([...job.ids,...(page.messages??[]).map(m=>m.id)])].slice(0,IMPORT_LIMIT);
  job.page=page.nextPageToken??null;
  if(job.ids.length>=IMPORT_LIMIT){job.limited=Boolean(job.page);job.page=null;}
  if(!job.page)job.status='extracting';
 }else if(job.status==='extracting'){
  const id=job.ids.find(id=>!job.processed.includes(id));
  if(!id)job.status='questions';
  else {
   const message=await gmailGet('messages/'+encodeURIComponent(id)+'?format=full',token,fetcher);
   const source=await prepare(message,token,{fetcher});
   const previous=(data.sources??[]).find(s=>s.id===id);
   if(!previous||previous.fingerprint!==source.fingerprint){
    if(previous){
     data.changed_sources=[...(data.changed_sources??[]).filter(s=>s.id!==id),source];job.processed.push(id);
     return {...row,data,token_ciphertext:sealToken(token,row.conversation_id,env)};
    }
    const proposal=await interpret({schema:RECEIPT_SCHEMA,instructions:RECEIPT_PROMPT,context:{source,existing_items:data.feedback.items.map(i=>({id:i.id,merchant:i.merchant,order_reference:i.order_reference,product:i.product,sku:i.sku,size_label:i.size_label,color:i.color,original:i.original}))}});
    if(!Array.isArray(proposal.events)||proposal.events.length>40)throw Error('Invalid receipt analysis');
    const pending=[];
    for(const [index,event]of proposal.events.entries()){
     try{const merged=reconcileReceipt(data.feedback,source,{events:[event]},{eventOffset:index});data.feedback=merged.state;pending.push(...merged.pending);}
     catch{source.warnings=[...(source.warnings??[]),'Proposed shopping event could not be validated; withheld'];}
    }
    data.sources=[...(data.sources??[]),source];data.pending=[...(data.pending??[]),...pending];
   }
   job.processed.push(id);
  }
 }else {
  const linked=relinkPending(data.feedback,data.pending??[]);data.feedback=linked.state;data.pending=linked.pending;
  // Only one question selection per import, not an automatic refill after each answer.
  const proposed=await proposeReceiptQuestions({items:projectReceiptState(data.feedback).items,previous_feedback:data.feedback.feedback,previous_questions:data.feedback.questions,pending_events:data.pending??[],profile:(await row.profile?.())??[],question_selection:'This is a new explicitly requested import. Select the combined top five unresolved questions again, including existing open questions only when still unanswered by new evidence and consequential. The selected set replaces previous open questions; resolved and deferred questions must not be repeated.'},interpret);
  data.feedback=replaceReceiptQuestions(data.feedback,proposed.questions);job.status='ready';job.completed_at=new Date().toISOString();
 }
 delete job.error;
 return {...row,data,token_ciphertext:sealToken(token,row.conversation_id,env)};
}
const cookieName='__Host-jules-gmail-state';
const cookieValue=req=>(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
const cookie=value=>`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value?600:0}`;
function redirect(res,location){res.statusCode=303;res.setHeader('Location',location);res.end();}
export function createGmailHandler({env=process.env,storeFactory,auth=wishlistUser,fetcher=fetch,interpret,prepare}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');let store,row,owner;
  try{
   if(env.GMAIL_IMPORT_ENABLED!=='true')return json(res,503,{error:'Gmail import is not enabled yet.'});
   const config=gmailConfiguration(env);store=storeFactory(env);const query=new URL(req.url,'https://jules.invalid').searchParams;
   if(query.get('gmail')==='callback'){
    if(req.method!=='GET')return json(res,405,{error:'Use GET.'});
    const state=query.get('state');if(!state||state.length>100||state!==cookieValue(req))return json(res,403,{error:'Connection expired. Open onboarding and connect again.'});
    res.setHeader('Set-Cookie',cookie(''));owner=await store.consumeGmailOAuth(digest(state));
    if(!owner)return json(res,403,{error:'Connection expired or already used.'});
    if(query.has('error'))return redirect(res,'/onboarding?gmail=declined');
    const code=query.get('code');if(!code||code.length>4096)throw Error('Missing authorization code');
    row=await store.claimGmailImport(owner);if(!row)return json(res,409,{error:'Import is busy. Try connecting again.'});
    const tokens=await exchangeCode(code,env,fetcher);const account=await gmailGet('profile',tokens,fetcher);
    // Bind the Gmail account to an existing invited member of this exact conversation.
    const member=typeof account.emailAddress==='string'?await store.wishlistMember(account.emailAddress.toLowerCase()):null;
    if(member?.conversation_id!==owner){await revokeToken(tokens,fetcher);throw Error('Use the Gmail account invited to this conversation');}
    const data={...row.data,account:account.emailAddress,consent:{version:CONSENT_VERSION,at:new Date().toISOString()},feedback:row.data.feedback??emptyReceiptState(owner)};
    if(!await store.finishGmailImport(owner,row.revision,data,sealToken(tokens,owner,env)))throw Error('Connection write conflict');row=null;
    return redirect(res,'/onboarding?gmail=connected');
   }
   if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Use GET or POST.'});
   const access=await auth(req.headers,env,store,fetcher);if(access.status!==200)return json(res,access.status,{error:'Sign in with your invited email to continue.'});owner=access.conversation;
   if(!await store.onboardingSession(owner))return json(res,403,{error:'This account is not invited to the Gmail pilot.'});
   if(req.method==='GET')return json(res,200,publicImport(await store.gmailImport(owner)));
   if(req.headers.origin!==config.origin)return json(res,403,{error:'Continue from the Jules website.'});
   const input=await readJson(req,24000);
   if(input.action==='connect'){
    if(input.consent!==CONSENT_VERSION)return json(res,400,{error:'Confirm receipt analysis consent first.'});
    const state=randomBytes(32).toString('base64url');if(!await store.beginGmailOAuth(owner,digest(state)))return json(res,409,{error:'Import is busy. Try again shortly.'});
    res.setHeader('Set-Cookie',cookie(state));return json(res,200,{url:authorizationURL(state,env)});
   }
   if(!['start','step','answer','edit','disconnect','delete-history'].includes(input.action))return json(res,400,{error:'Unknown import action.'});
   row=await store.claimGmailImport(owner);if(!row)return json(res,409,{error:'Another import update is running. Try again shortly.'});
   let data=structuredClone(row.data),token=row.token_ciphertext,feedbackApplied;const model=interpret??(request=>receiptModel(request,env,fetcher));
   if(input.action==='disconnect'){
    if(token)await revokeToken(openToken(token,owner,env),fetcher);token=null;if(data.job&&data.job.status!=='ready')data.job.status='paused';
   }else if(input.action==='delete-history'){
    if(input.confirm!==true)throw Error('Confirm deletion of imported history');
    if(token)await revokeToken(openToken(token,owner,env),fetcher);token=null;data={feedback:emptyReceiptState(owner)};
   }else if(input.action==='start'){
    if(!token)throw Error('Connect Gmail first');if(['listing','extracting','questions'].includes(data.job?.status))throw Error('Import already running');
    data.job=newImportJob();data.feedback??=emptyReceiptState(owner);
   }else if(input.action==='step'){
    if(!token)throw Error('Connect Gmail first');
    const next=await importStep({...row,profile:async()=>(await store.profile(owner)).facts},env,{fetcher,interpret:model,...(prepare?{prepare}:{})});data=next.data;token=next.token_ciphertext;
   }else if(input.action==='answer'){
    if(input.question_id!=null&&(typeof input.question_id!=='string'||!data.feedback?.questions.some(q=>q.id===input.question_id&&q.status==='open')))throw Error('Question already answered or unavailable');
    const context=structuredClone(data.feedback);context.answer_target=input.question_id;
    const proposal=await interpretReceiptAnswer(context,input.message,model);
    if(input.question_id!=null&&proposal.actions.some(a=>a.question_id!==input.question_id))throw Error('Answer scope needs clarification');
    feedbackApplied=proposal.actions.length;
    data.feedback=applyReceiptAnswer(data.feedback,proposal,{id:randomBytes(16).toString('hex'),owner_id:owner,source:'chat_answer',at:new Date().toISOString()});
   }else {
    // Future closet controls reuse these validated structured actions; no UI is built here.
    if(!input.event||typeof input.event!=='object')throw Error('Missing correction');
    data.feedback=applyReceiptFeedback(data.feedback,{...input.event,id:randomBytes(16).toString('hex'),owner_id:owner,source:'closet_edit',at:new Date().toISOString()});
   }
   if(!await store.finishGmailImport(owner,row.revision,data,token))throw Error('Import changed; reload');row=null;
   return json(res,200,{...publicImport({data,token_ciphertext:token}),...(feedbackApplied===undefined?{}:{feedback_applied:feedbackApplied})});
  }catch(error){
   if(row){const data=structuredClone(row.data);if(data.job)data.job.error='Import paused after a failed step; retry preserves completed work.';await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).catch(()=>{});}
   console.log(JSON.stringify({event:'gmail_import_failed',status:error.status??503}));
   return json(res,error.status??503,{error:'Could not complete this step. Your saved history and corrections are preserved. Retry, or reconnect Gmail if access expired.'});
  }
 };
}
