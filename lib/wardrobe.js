import {randomUUID} from 'node:crypto';
import {json,readJson} from './http.js';
import {gmailLinked} from './gmail-client.js';
import {photoCaching} from './wishlist.js';
import {loadReceipts,receiptWrite} from './evidence.js';
import {projectReceiptState,cleanBrand} from './receipt-extraction.js';
import {applyReceiptFeedback,effectiveRecipient,folded,itemParts} from './receipt-feedback.js';
import {tagFingerprint,CATEGORY_FOR,CATEGORIES} from './item-tags.js';
// Item-tag groups shown as a handful of wardrobe categories (lib/item-tags.js).
export {CATEGORY_FOR,CATEGORIES};
import {normalizeSignupPhone} from './public-signup.js';
import {suggestionState,suggestWardrobePhotos,decideSuggestion,TINY_PHOTO} from './wardrobe-photos.js';
import {withUsage} from './usage.js';

// The wardrobe (PRD section 29) is a view of the purchase history: what Jules counts as the person's
// own. It stores nothing of its own. Every change is a structured `closet_edit` correction on the same
// feedback path as text answers, so it replays from evidence and rebuilds dependent learning.

export const REMOVE_REASONS=['returned','gift','gone','never_bought'];
const QUESTION_LIMIT=5;
const EDITABLE=['brand','product','size_label','color','wardrobe_category'];

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

// photos: item id -> {source: where its stored photo came from ('order_email' | 'shop_order'), version}. The photo
// the purchase source itself contained comes first; otherwise a searched photo the owner confirmed ('search_confirmed').
// A searched photo still waiting for the owner's answer is a suggestion, never the item's photo.
// tiny: items whose order photo is a thumbnail too small to show well (lib/wardrobe-photos.js TINY_PHOTO);
// a sharper searched photo the owner confirms replaces it, and a pending one is offered over it.
// Each version names exactly one stored photo, so the browser may keep a photo while its version is unchanged.
function itemView(item,tags,photos,parts=[],suggestions=new Map(),tiny=new Set()){
 const tag=tags[item.id],current=tag&&tag.fp===tagFingerprint(item)?tag:null,at=purchasedAt(item),found=suggestions.get(item.id);
 const order=photos.get(item.id)??null,small=Boolean(order)&&tiny.has(item.id);
 const photo=found?.confirmed&&(!order||small)?{source:'search_confirmed',version:found.confirmed.id}:order;
 return {id:item.id,brand:cleanBrand(item.brand)??null,product:item.product??null,merchant:item.merchant??null,size:item.size_label??null,color:item.color??null,
  // The owner's own category wins over the tag; a tag made before their correction is never shown.
  category:CATEGORIES.includes(item.wardrobe_category)?item.wardrobe_category:current?CATEGORY_FOR[current.group]??'other':null,bought_at:at===null?null:new Date(at).toISOString(),photo:Boolean(photo),photo_source:photo?.source??null,...(photo?.item?{photo_item:photo.item}:{}),photo_version:photo?.version??null,
  photo_small:small&&photo===order,
  suggestion:(!photo||small&&photo===order)&&found?.pending?{seller:found.pending.seller,version:found.pending.id}:null,
  parts:parts.map(p=>({product:p.product,color:p.color})),
  // The saved wishlist item this purchase came from, when the person marked it as bought there.
  from_wishlist:(item.source_ids??[]).find(s=>s.startsWith('wishlist:'))?.slice(9)??null,
  // A piece Jules saw in an outfit photo the person texted, not a purchase (lib/outfit-closet.js).
  from_photo:(item.source_ids??[]).length>0&&item.source_ids.every(s=>s.startsWith('outfit:'))};
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

// How Jules names an item in a text: color and brand when the product name does not already say them.
// The brand is shown without a company suffix ("MFPEN Retail ApS" is MFPEN), even when a correction stored it that way.
export const itemName=i=>{const brand=cleanBrand(i.brand);return [i.color&&!(i.product??'').toLowerCase().includes(i.color.toLowerCase())?i.color:null,brand&&!(i.product??'').toLowerCase().includes(brand.toLowerCase())?brand:null,i.product??'purchase'].filter(Boolean).join(' ');};

export function wardrobeView(state,{tags={},job=null,connections={},textLine=null,photos=new Map(),suggestions=new Map(),tiny=new Set()}={}){
 const view=projectReceiptState(state),wardrobe=[],removed=[];
 for(const item of view.items){
  if(folded(item))continue;
  const reason=removalReason(item),entry=itemView(item,tags,photos,itemParts(view,item),suggestions,tiny);
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
   // A category is chosen from the wardrobe's own list; it can be changed but not cleared.
   if(field==='wardrobe_category'&&!CATEGORIES.includes(clean))throw fail(400,'Choose a category.');
   if(clean!==(item[field]??null))values[field]=clean;
  }
  if(!Object.keys(values).length)throw fail(400,'Change at least one detail.');
  return {...base,item_ids:[item.id],action:'correct_fields',values};
 }
 throw fail(400,'Unknown action.');
}

// A sharpened order photo replaces the stored bytes in the same row, at a new size, so the size is part of the version.
export const orderPhotoVersion=p=>`${p.version??'0'}:${p.width??''}x${p.height??''}`;
export async function loadWardrobe(store,owner,env){
 const row=await store.gmailImport(owner);
 const textLine=normalizeSignupPhone(env.JULES_PUBLIC_LINE)||null;
 if(!row)return {row:null,view:wardrobeView({items:[],questions:[],feedback:[]},{textLine})};
 const receipts=await loadReceipts(store,owner,row);
 const connections={gmail:gmailLinked(row),shop:Boolean(row.data.connections?.shop)};
 const [orderPhotos,searched]=await Promise.all([store.purchasePhotos?.(owner)??[],store.wardrobePhotoEvidence?.(owner).catch(()=>[])??[]]);
 const photos=new Map(orderPhotos.map(p=>[p.item_id,{source:p.photo_source,version:orderPhotoVersion(p)}])),suggestions=suggestionState(searched);
 // A piece from an outfit photo that the person said is the same as a wardrobe item folds into it; its
 // crop then shows for that item when the item has no photo of its own (lib/outfit-closet.js).
 for(const item of receipts.state.items)if(item.duplicate_of&&photos.has(item.id)&&!photos.has(item.duplicate_of))photos.set(item.duplicate_of,{...photos.get(item.id),item:item.id});
 const tiny=new Set(orderPhotos.filter(p=>Math.max(Number(p.width)||0,Number(p.height)||0)<TINY_PHOTO).map(p=>p.item_id));
 return {row,receipts,suggestions,view:wardrobeView(receipts.state,{tags:row.data.item_tags??{},job:row.data.job,connections,textLine,photos,suggestions,tiny})};
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
 return (await loadWardrobe(store,owner,env)).view;
}

export async function handleWardrobe(req,res,{store,env,auth,fetcher}){
 res.setHeader('Cache-Control','no-store');
 const access=await auth(req.headers,env,store,fetcher);
 if(access.status!==200)return json(res,access.status,{error:'Please sign in to see your wardrobe.'});
 try{
  const params=new URL(req.url,'https://jules.invalid').searchParams,photo=params.get('photo')??params.get('suggestion');
  if(req.method==='GET'&&photo!==null){
   if(!/^[\w:.-]{1,200}$/.test(photo))return json(res,400,{error:'Invalid photo.'});
   // The order's own photo, else a searched photo: the confirmed one for ?photo, the pending one for ?suggestion.
   // source=search asks for the confirmed searched photo first (it replaces a tiny order thumbnail).
   let stored=params.has('photo')&&params.get('source')!=='search'?await store.purchasePhoto?.(access.conversation,photo):null;
   if(!stored&&store.wardrobeSuggestionPhoto){
    const found=suggestionState(await store.wardrobePhotoEvidence(access.conversation)).get(photo);
    const id=params.has('photo')?found?.confirmed?.id:found?.pending?.id;
    if(id)stored=await store.wardrobeSuggestionPhoto(access.conversation,id);
   }
   if(!stored||stored.mime_type!=='image/jpeg'||!stored.data)return json(res,404,{error:'Photo unavailable.'});
   res.statusCode=200;res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control',photoCaching(params));res.setHeader('X-Content-Type-Options','nosniff');return res.end(Buffer.from(stored.data,'base64'));
  }
  if(req.method==='GET')return json(res,200,(await loadWardrobe(store,access.conversation,env)).view);
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
  const input=await readJson(req,4096);
  if(!await store.gmailImport(access.conversation))return json(res,404,{error:'There is no purchase history yet.'});
  // Suggested photos are their own evidence: no history lock, no purchase correction.
  if(input.action==='suggest_photos'){
   const {view}=await loadWardrobe(store,access.conversation,env);
   const result=await withUsage({store,env,conversation:access.conversation,operation:'wardrobe-photos:'+new Date().toISOString().slice(0,13),feature:'wardrobe_photos',quiet:true},
    ()=>suggestWardrobePhotos(store,access.conversation,view.items,{env,fetcher}));
   return json(res,200,{...(result.searched?(await loadWardrobe(store,access.conversation,env)).view:view),photo_search:{remaining:result.remaining}});
  }
  if(input.action==='photo'){
   const {view}=await loadWardrobe(store,access.conversation,env);
   await decideSuggestion(store,access.conversation,String(input.item_id??''),input.answer,{items:view.items});
   return json(res,200,(await loadWardrobe(store,access.conversation,env)).view);
  }
  return json(res,200,await wardrobeAction(store,access.conversation,input,env));
 }catch(error){
  if([400,404,409].includes(error.status))return json(res,error.status,{error:error.message});
  throw error;
 }
}
