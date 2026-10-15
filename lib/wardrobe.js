import {randomUUID} from 'node:crypto';
import {json,readJson} from './http.js';
import {loadReceipts,receiptWrite} from './evidence.js';
import {projectReceiptState} from './receipt-extraction.js';
import {applyReceiptFeedback,effectiveRecipient} from './receipt-feedback.js';
import {tagFingerprint} from './item-tags.js';
import {normalizeSignupPhone} from './public-signup.js';

// The wardrobe (PRD section 29) is a view of the purchase history: what Jules counts as the person's
// own. It stores nothing of its own. Every change is a structured `closet_edit` correction on the same
// feedback path as text answers, so it replays from evidence and rebuilds dependent learning.

// Item-tag groups (lib/item-tags.js) shown as a handful of wardrobe categories.
export const CATEGORY_FOR={tops:'tops',shirts:'tops',knitwear:'tops',activewear:'tops',trousers:'bottoms',denim:'bottoms',shorts:'bottoms',skirts:'bottoms',
 dresses:'dresses',outerwear:'outerwear',suits_tailoring:'suits',shoes:'shoes',bags:'bags',accessories:'accessories',jewelry_watches:'accessories',eyewear:'accessories',
 underwear_basics:'other',swimwear:'other',other:'other'};
export const CATEGORIES=['tops','bottoms','dresses','outerwear','suits','shoes','bags','accessories','other'];
export const REMOVE_REASONS=['returned','gift','gone','never_bought'];
const QUESTION_LIMIT=5;
const EDITABLE=['brand','product','size_label','color'];

const fail=(status,message)=>Object.assign(Error(message),{status});
const purchasedAt=item=>{const at=(item.source_events??[]).filter(e=>e.kind==='purchased'&&Number.isFinite(e.at)).map(e=>e.at);return at.length?Math.min(...at):null;};

// Why an item is not in the wardrobe, or null when it is. Duplicates are folded into their target.
export function removalReason(item){
 if(item.outcome?.value==='cancelled')return 'cancelled';
 if(item.purchase_disputed)return 'never_bought';
 if(item.outcome?.value==='returned')return 'returned';
 if(effectiveRecipient(item).value==='other')return 'gift';
 if(item.owned===false)return 'gone';
 return null;
}

// photos: item id -> where its stored photo came from ('order_email' | 'shop_order'). Only a photo the
// purchase source itself contained is shown; anything else keeps the category outline.
function itemView(item,tags,photos){
 const tag=tags[item.id],current=tag&&tag.fp===tagFingerprint(item)?tag:null,at=purchasedAt(item),photo=photos.get(item.id)??null;
 return {id:item.id,brand:item.brand??null,product:item.product??null,merchant:item.merchant??null,size:item.size_label??null,color:item.color??null,
  category:current?CATEGORY_FOR[current.group]??'other':null,bought_at:at===null?null:new Date(at).toISOString(),photo:Boolean(photo),photo_source:photo};
}

// The answers a person can give with one tap, per question topic. Each maps to one structured
// action; "Not sure" defers the question and never records a guess.
export const ANSWERS={
 recipient:{mine:{action:'set_recipient',value:'self'},gift:{action:'set_recipient',value:'other'}},
 purchase:{bought:{action:'restore_purchase'},not_bought:{action:'dispute_purchase'}},
 return:{kept:{action:'report_kept'},returned:{action:'report_return'}},
 duplicate:{same:{action:'mark_duplicate'}},
 details:{}
};

export function wardrobeView(state,{tags={},job=null,connections={},textLine=null,photos=new Map()}={}){
 const view=projectReceiptState(state),wardrobe=[],removed=[];
 for(const item of view.items){
  if(item.duplicate_of)continue;
  const reason=removalReason(item),entry=itemView(item,tags,photos);
  (reason?removed:wardrobe).push(reason?{...entry,reason}:entry);
 }
 const newest=(a,b)=>(b.bought_at??'').localeCompare(a.bought_at??'');
 wardrobe.sort(newest);removed.sort(newest);
 const visible=new Set(wardrobe.map(i=>i.id));
 const questions=view.questions.filter(q=>q.status==='open'&&ANSWERS[q.topic]&&q.item_ids.some(id=>visible.has(id))).slice(0,QUESTION_LIMIT)
  .map(q=>({id:q.id,topic:q.topic,question:q.question,item_ids:q.item_ids.filter(id=>visible.has(id)||q.topic==='duplicate'),answers:Object.keys(ANSWERS[q.topic])}));
 return {items:wardrobe,removed,questions,status:job?.status??'not_started',connections,text_url:textLine?`sms:${textLine}`:null};
}

// Builds the structured correction for one wardrobe action. Ownership and references are checked by
// applyReceiptFeedback; this only turns a labelled button into an event.
export function wardrobeEvent(owner,state,input,now=new Date().toISOString()){
 const id='closet:'+randomUUID(),base={id,owner_id:owner,source:'closet_edit',at:now};
 const item=state.items.find(i=>i.id===input.item_id);
 if(input.action==='answer'){
  const question=state.questions.find(q=>q.id===input.question_id&&q.status==='open');
  if(!question)throw fail(409,'That question was already answered.');
  if(input.answer==='not_sure')return {...base,item_ids:question.item_ids,action:'defer_question',question_id:question.id};
  const answer=ANSWERS[question.topic]?.[input.answer];
  if(!answer)throw fail(400,'Choose one of the answers.');
  if(answer.action==='mark_duplicate'){
   const [target,...rest]=question.item_ids;
   if(!rest.length)throw fail(400,'Choose one of the answers.');
   return {...base,item_ids:rest,action:'mark_duplicate',target_item_id:target,question_id:question.id};
  }
  return {...base,item_ids:question.item_ids,...answer,...(answer.value==='other'?{label:null}:{}),question_id:question.id};
 }
 if(!item)throw fail(404,'That item is no longer in your history.');
 if(input.action==='remove'){
  if(!REMOVE_REASONS.includes(input.reason))throw fail(400,'Choose why you are removing it.');
  const action={returned:{action:'report_return'},gift:{action:'set_recipient',value:'other',label:null},gone:{action:'set_owned',value:false},never_bought:{action:'dispute_purchase'}}[input.reason];
  return {...base,item_ids:[item.id],...action};
 }
 if(input.action==='restore'){
  const reason=removalReason(projectReceiptState({...state,items:[item]}).items[0]);
  const action={returned:{action:'report_kept'},cancelled:{action:'report_kept'},gift:{action:'set_recipient',value:'self'},gone:{action:'set_owned',value:true},never_bought:{action:'restore_purchase'}}[reason];
  if(!action)throw fail(409,'That item is already in your wardrobe.');
  return {...base,item_ids:[item.id],...action};
 }
 if(input.action==='fix'){
  const values={};
  for(const [field,value] of Object.entries(input.values??{})){
   if(!EDITABLE.includes(field))throw fail(400,'That detail cannot be edited.');
   const clean=value==null?null:String(value).trim().slice(0,300)||null;
   if(clean!==(item[field]??null))values[field]=clean;
  }
  if(!Object.keys(values).length)throw fail(400,'Change at least one detail.');
  return {...base,item_ids:[item.id],action:'correct_fields',values};
 }
 throw fail(400,'Unknown action.');
}

async function load(store,owner,env){
 const row=await store.gmailImport(owner);
 const textLine=normalizeSignupPhone(env.JULES_PUBLIC_LINE)||null;
 if(!row)return {row:null,view:wardrobeView({items:[],questions:[],feedback:[]},{textLine})};
 const receipts=await loadReceipts(store,owner,row);
 const connections={gmail:Boolean(row.token_ciphertext),shop:Boolean(row.data.connections?.shop)};
 const photos=new Map((await store.purchasePhotos?.(owner)??[]).map(p=>[p.item_id,p.photo_source]));
 return {row,receipts,view:wardrobeView(receipts.state,{tags:row.data.item_tags??{},job:row.data.job,connections,textLine,photos})};
}

export async function wardrobeAction(store,owner,input,env){
 const row=await store.claimGmailImport(owner);if(!row)throw fail(409,'Your history is being updated. Try again in a moment.');
 try{
  const receipts=await loadReceipts(store,owner,row),event=wardrobeEvent(owner,receipts.state,input);
  let state;try{state=applyReceiptFeedback(receipts.state,event);}catch(error){throw fail(400,error.message);}
  const write=receiptWrite(row.data,receipts,state);
  if(!await store.finishGmailImport(owner,row.revision,write.data,row.token_ciphertext,write.evidence))throw fail(409,'Your history changed. Try again.');
  console.log(JSON.stringify({event:'wardrobe_edit',action:event.action,input:input.action,reason:input.reason??input.answer??null}));
 }catch(error){
  await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});
  console.log(JSON.stringify({event:'wardrobe_edit_failed',input:input.action,status:error.status??500}));
  throw error;
 }
 return (await load(store,owner,env)).view;
}

export async function handleWardrobe(req,res,{store,env,auth,fetcher}){
 res.setHeader('Cache-Control','no-store');
 const access=await auth(req.headers,env,store,fetcher);
 if(access.status!==200)return json(res,access.status,{error:'Please sign in to see your wardrobe.'});
 try{
  const photo=new URL(req.url,'https://jules.invalid').searchParams.get('photo');
  if(req.method==='GET'&&photo!==null){
   if(!/^[\w:.-]{1,200}$/.test(photo))return json(res,400,{error:'Invalid photo.'});
   const stored=await store.purchasePhoto?.(access.conversation,photo);
   if(!stored||stored.mime_type!=='image/jpeg'||!stored.data)return json(res,404,{error:'Photo unavailable.'});
   res.statusCode=200;res.setHeader('Content-Type','image/jpeg');res.setHeader('X-Content-Type-Options','nosniff');return res.end(Buffer.from(stored.data,'base64'));
  }
  if(req.method==='GET')return json(res,200,(await load(store,access.conversation,env)).view);
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
  const input=await readJson(req,4096);
  if(!await store.gmailImport(access.conversation))return json(res,404,{error:'There is no purchase history yet.'});
  return json(res,200,await wardrobeAction(store,access.conversation,input,env));
 }catch(error){
  if([400,404,409].includes(error.status))return json(res,error.status,{error:error.message});
  throw error;
 }
}
