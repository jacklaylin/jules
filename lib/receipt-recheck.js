import {accessToken,openToken,gmailGet,gmailLinked,recordGmailReconnect} from './gmail-client.js';
import {prepareReceiptEmail,triageCandidate} from './receipt-email.js';
import {RECEIPT_SCHEMA,RECEIPT_PROMPT,TRIAGE_SCHEMA,TRIAGE_PROMPT,receiptModel,reconcileReceipt,emptyReceiptState} from './receipt-extraction.js';
import {loadReceipts} from './evidence.js';
import {authorize} from './auth.js';
import {storeDomain,storeDomains} from './gmail-discovery.js';
export {storeDomain};
import {json,readJson,uuid} from './http.js';

// Owner-only measurement: re-read the emails behind one owner-labelled item with the current
// reading rules and say whether the result now agrees with the label. Nothing is saved; the
// emails are fetched read-only and analyzed the same way an import analyzes them.
const words=value=>typeof value==='string'?value.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
const sameProduct=(found,item)=>Boolean(found.sku&&(item.sku||item.original?.sku)&&words(found.sku)===words(item.sku??item.original.sku))||
 [item.product,item.original?.product].some(p=>{const a=words(found.product),b=words(p);return a&&b&&(a.includes(b)||b.includes(a));});
const MAX_EMAILS=6;
const fail=(status,message)=>Object.assign(Error(message),{status});

export function judgeLabel(label,item,found,target=null){
 const matching=found.filter(f=>sameProduct(f,item));
 switch(label.reason){
  case 'not_a_purchase':case 'not_apparel':
   return {match:!matching.length,explanation:matching.length?'Still read as a purchase.':'No longer read as a purchase.'};
  case 'duplicate':{
   const same=found.filter(f=>sameProduct(f,item)||target&&sameProduct(f,target));
   return {match:same.length===1,explanation:same.length===1?'Read as one item.':`Read as ${same.length} items.`};
  }
  case 'part_of_item':{
   if(!target)return {match:!matching.some(f=>f.part_of),explanation:matching.some(f=>f.part_of)?'Still read as part of another item.':'Read as its own item.'};
   const part=matching.some(f=>f.part_of&&sameProduct(f.part_of,target));
   return {match:part,explanation:part?'Read as part of that item.':'Not read as part of that item.'};
  }
  case 'wrong_details':{
   if(!matching.length)return {match:false,explanation:'Item not found.'};
   const wrong=(item.confirmed_fields??[]).filter(f=>!matching.some(m=>f==='quantity'?Number(m[f])===Number(item[f]):words(m[f])===words(item[f])));
   return {match:!wrong.length,explanation:wrong.length?`Still differs: ${wrong.join(', ')}.`:'Corrected details now read correctly.'};
  }
  default:
   return {match:matching.length>0,explanation:matching.length?'Still found.':'No longer found.'};
 }
}

// Reads emails into a fresh, unsaved history exactly as an import would, returning the purchases
// found and the events the current rules rejected.
async function readEmails(owner,ids,token,{fetcher,prepare,interpret}){
 let fresh=emptyReceiptState(owner);const withheld=[];
 for(const id of ids){
  const source=await prepare(await gmailGet('messages/'+encodeURIComponent(id)+'?format=full',token,fetcher),token,{fetcher});
  const existing=fresh.items.filter(i=>i.order_reference&&source.text.includes(i.order_reference)).map(i=>({id:i.id,merchant:i.merchant,order_reference:i.order_reference,product:i.product,sku:i.sku,size_label:i.size_label,color:i.color}));
  const proposal=await interpret({schema:RECEIPT_SCHEMA,instructions:RECEIPT_PROMPT,context:{source,existing_items:existing}});
  for(const [index,event] of (Array.isArray(proposal.events)?proposal.events.slice(0,40):[]).entries()){
   try{fresh=reconcileReceipt(fresh,source,{events:[event]},{eventOffset:index}).state;}
   catch(error){withheld.push({reason:error.message.slice(0,120),product:typeof event?.product?.value==='string'?event.product.value.slice(0,120):null,basis:event?.basis?.value??null,category:event?.category??null});}
  }
 }
 const parent=i=>fresh.items.find(p=>p.id===i.part_of);
 const purchased=fresh.items.filter(i=>i.source_events.some(e=>e.kind==='purchased')).map(i=>({product:i.product,brand:i.brand,merchant:i.merchant,size_label:i.size_label,color:i.color,quantity:i.quantity,sku:i.sku,
  part_of:parent(i)?{product:parent(i).product,brand:parent(i).brand,merchant:parent(i).merchant,size_label:parent(i).size_label,color:parent(i).color,sku:parent(i).sku}:null,
  basis:i.source_events.find(e=>e.kind==='purchased')?.basis??null,category:i.source_events.find(e=>e.kind==='purchased')?.category??null}));
 return {purchased,withheld};
}
// A sign-in Google refused is recorded on the import (shown as "reconnect Gmail") and never retried.
async function signIn(store,owner,row,env,fetcher){
 try{return await accessToken(openToken(row.token_ciphertext,owner,env),env,fetcher);}
 catch(error){if(!error?.reconnect)throw error;await recordGmailReconnect(store,owner,error,'admin_recheck');throw fail(409,'Google refused the stored Gmail sign-in (expired or removed). The person needs to connect Gmail again.');}
}
export async function recheckItem(store,owner,itemId,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher)}={}){
 const row=await store.gmailImport(owner);
 if(!row)throw fail(404,'No Gmail import for this person.');
 if(!gmailLinked(row))throw fail(409,'Gmail is disconnected or its sign-in expired. Reconnect it from onboarding to re-check emails.');
 const {state}=await loadReceipts(store,owner,row),item=state.items.find(i=>i.id===itemId);
 const label=[...state.feedback].reverse().find(e=>e.source==='operator_review'&&e.item_ids?.includes(itemId)&&e.review);
 if(!item||!label)throw fail(400,'That item has no admin label to check.');
 const target=['mark_duplicate','mark_part_of'].includes(label.action)?state.items.find(i=>i.id===label.target_item_id):null;
 const ids=[...new Set([...item.source_ids,...(target?.source_ids??[])])].slice(0,MAX_EMAILS);
 const token=await signIn(store,owner,row,env,fetcher);
 const {purchased,withheld}=await readEmails(owner,ids,token,{fetcher,prepare,interpret});
 return {item_id:itemId,reason:label.review.reason,emails:ids.length,found:purchased,withheld,...judgeLabel(label.review,item,purchased,target)};
}

// Skipped-email review: the owner checks a sample of emails the import judged irrelevant and marks
// any that were actually orders. Only for the owner's own mailbox: other people's subject lines stay
// private. Subjects are fetched on demand and never stored; labels keep only id, label and domain.
export const SKIPPED_LABELS=['missed_order','not_order'];
const SAMPLE_KNOWN=60,SAMPLE_RANDOM=30,LABEL_LIMIT=2000;
const ownMailbox=(row,env)=>Boolean(row?.data?.account&&env.ADMIN_EMAIL&&row.data.account.toLowerCase()===env.ADMIN_EMAIL.toLowerCase());
async function ownRow(store,owner,env){
 const row=await store.gmailImport(owner);
 if(!row)throw fail(404,'No Gmail import for this person.');
 if(!ownMailbox(row,env))throw fail(403,'Skipped-email review is only available for your own mailbox.');
 if(!gmailLinked(row))throw fail(409,'Gmail is disconnected or its sign-in expired. Reconnect it from onboarding first.');
 return row;
}
export async function skippedSample(store,owner,env,{fetcher=fetch,random=Math.random}={}){
 const row=await ownRow(store,owner,env),data=row.data,scanned=new Set(data.scanned_ids??[]);
 const labels=new Map((data.triage_labels??[]).map(l=>[l.id,l.label]));
 const token=await signIn(store,owner,row,env,fetcher);
 const domains=storeDomains(data);
 const known=[];
 if(domains.length&&data.job?.after){
  let page=null;
  for(let n=0;n<4&&known.length<SAMPLE_KNOWN;n++){
   const params=new URLSearchParams({q:`after:${data.job.after} before:${data.job.before} {${domains.map(d=>'from:'+d).join(' ')}}`,maxResults:'100',...(page?{pageToken:page}:{})});
   const list=await gmailGet('messages?'+params,token,fetcher);
   for(const m of list.messages??[])if(scanned.has(m.id)&&!known.includes(m.id))known.push(m.id);
   page=list.nextPageToken;if(!page)break;
  }
 }
 const rest=[...scanned].filter(id=>!known.includes(id));
 for(let i=rest.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}
 const chosen=[...known.slice(0,SAMPLE_KNOWN).map(id=>[id,'known_store']),...rest.slice(0,SAMPLE_RANDOM).map(id=>[id,'random'])];
 const emails=[];
 for(let i=0;i<chosen.length;i+=10)emails.push(...await Promise.all(chosen.slice(i,i+10).map(async([id,group])=>{
  try{const c=triageCandidate({...await gmailGet('messages/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject',token,fetcher),id});
   return {id,group,date:c.date,sender_domain:c.sender_domain,from_name:c.from_name,subject:c.subject,label:labels.get(id)??null};}
  catch{return {id,group,date:null,sender_domain:null,from_name:null,subject:null,label:labels.get(id)??null,unavailable:true};}
 })));
 return {emails,skipped_total:scanned.size,known_store_total:known.length,labelled:data.triage_labels?.length??0};
}
export async function labelSkipped(store,owner,env,input){
 if(typeof input.email_id!=='string'||input.email_id.length>200||![...SKIPPED_LABELS,null].includes(input.label??null))throw fail(400,'Choose a label.');
 const current=await ownRow(store,owner,env);
 if(!(current.data.scanned_ids??[]).includes(input.email_id))throw fail(400,'That email is not one the import skipped.');
 const row=await store.claimGmailImport(owner);if(!row)throw fail(409,'Purchase history is busy. Try again in a moment.');
 const kept=(row.data.triage_labels??[]).filter(l=>l.id!==input.email_id);
 const labels=input.label?[...kept,{id:input.email_id,label:input.label,sender_domain:typeof input.sender_domain==='string'?input.sender_domain.slice(0,120):null,at:new Date().toISOString()}]:kept;
 if(!await store.finishGmailImport(owner,row.revision,{...row.data,triage_labels:labels.slice(-LABEL_LIMIT)},row.token_ciphertext))throw fail(409,'Purchase history is busy. Try again in a moment.');
 console.log(JSON.stringify({event:'skipped_email_labelled',label:input.label??'cleared'}));
 return {labelled:labels.length};
}
// Re-check one labelled skipped email: would triage read it now, and does reading find a purchase?
export async function recheckSkipped(store,owner,emailId,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher)}={}){
 const row=await ownRow(store,owner,env),label=(row.data.triage_labels??[]).find(l=>l.id===emailId);
 if(!label)throw fail(400,'That email has no label to check.');
 const token=await signIn(store,owner,row,env,fetcher);
 const candidate=triageCandidate({...await gmailGet('messages/'+encodeURIComponent(emailId)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject',token,fetcher),id:emailId});
 let triage='extract';
 try{const d=(await interpret({schema:TRIAGE_SCHEMA,instructions:TRIAGE_PROMPT,context:{emails:[candidate]}})).decisions;if(Array.isArray(d)&&d.find(x=>x?.id===emailId)?.action==='skip')triage='skip';}catch{}
 const {purchased,withheld}=triage==='extract'||label.label==='missed_order'?await readEmails(owner,[emailId],token,{fetcher,prepare,interpret}):{purchased:[],withheld:[]};
 const read=triage==='extract'&&purchased.length>0;
 const match=label.label==='missed_order'?read:!read;
 const explanation=label.label==='missed_order'?(read?'Now read as a purchase.':triage==='skip'?(purchased.length?'Triage still skips it (reading alone would find it).':'Triage still skips it.'):'Read, but no purchase found.'):(read?'Now read as a purchase.':'Still not read as a purchase.');
 return {email_id:emailId,reason:label.label,sender_domain:label.sender_domain,triage,found:purchased,withheld,match,explanation};
}
export function createRecheckHandler({env=process.env,storeFactory,admin=authorize,fetcher=fetch,interpret,prepare}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
   const access=await admin(req.headers,env,fetcher);
   if(access!==200)return json(res,access,{error:'Please sign in with the owner account.'});
   if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
   if(env.GMAIL_IMPORT_ENABLED!=='true')return json(res,503,{error:'Gmail import is not enabled.'});
   const input=await readJson(req,4000);
   if(!uuid(input.conversation))return json(res,400,{error:'Choose a person.'});
   const store=storeFactory(env),deps={fetcher,...(interpret?{interpret}:{}),...(prepare?{prepare}:{})};
   if(input.action==='skipped_list')return json(res,200,await skippedSample(store,input.conversation,env,{fetcher}));
   if(input.action==='skipped_label')return json(res,200,await labelSkipped(store,input.conversation,env,input));
   if(input.action==='skipped_recheck'){
    if(typeof input.email_id!=='string'||input.email_id.length>200)return json(res,400,{error:'Choose a labelled email.'});
    const result=await recheckSkipped(store,input.conversation,input.email_id,env,deps);
    console.log(JSON.stringify({event:'skipped_recheck',reason:result.reason,match:result.match,triage:result.triage,found:result.found.length}));
    return json(res,200,result);
   }
   if(typeof input.item_id!=='string'||input.item_id.length>200)return json(res,400,{error:'Choose a labelled item.'});
   const result=await recheckItem(store,input.conversation,input.item_id,env,deps);
   console.log(JSON.stringify({event:'receipt_recheck',reason:result.reason,match:result.match,emails:result.emails,withheld:result.withheld.length}));
   return json(res,200,result);
  }catch(error){
   console.log(JSON.stringify({event:'receipt_recheck_failed',status:error.status??null,error:error.message?.slice(0,80)??null}));
   return json(res,[400,403,404,409].includes(error.status)?error.status:503,{error:[400,403,404,409].includes(error.status)?error.message:'Could not re-check this item. Gmail access may have expired; reconnect from onboarding and try again.'});
  }
 };
}
