import {accessToken,openToken,gmailGet} from './gmail-client.js';
import {prepareReceiptEmail} from './receipt-email.js';
import {RECEIPT_SCHEMA,RECEIPT_PROMPT,receiptModel,reconcileReceipt,emptyReceiptState} from './receipt-extraction.js';
import {loadReceipts} from './evidence.js';
import {authorize} from './auth.js';
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
  case 'wrong_details':{
   if(!matching.length)return {match:false,explanation:'Item not found.'};
   const wrong=(item.confirmed_fields??[]).filter(f=>!matching.some(m=>f==='quantity'?Number(m[f])===Number(item[f]):words(m[f])===words(item[f])));
   return {match:!wrong.length,explanation:wrong.length?`Still differs: ${wrong.join(', ')}.`:'Corrected details now read correctly.'};
  }
  default:
   return {match:matching.length>0,explanation:matching.length?'Still found.':'No longer found.'};
 }
}

export async function recheckItem(store,owner,itemId,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher)}={}){
 const row=await store.gmailImport(owner);
 if(!row)throw fail(404,'No Gmail import for this person.');
 if(!row.token_ciphertext)throw fail(409,'Gmail is disconnected. Reconnect it from onboarding to re-check emails.');
 const {state}=await loadReceipts(store,owner,row),item=state.items.find(i=>i.id===itemId);
 const label=[...state.feedback].reverse().find(e=>e.source==='operator_review'&&e.item_ids?.includes(itemId)&&e.review);
 if(!item||!label)throw fail(400,'That item has no admin label to check.');
 const target=label.action==='mark_duplicate'?state.items.find(i=>i.id===label.target_item_id):null;
 const ids=[...new Set([...item.source_ids,...(target?.source_ids??[])])].slice(0,MAX_EMAILS);
 const token=await accessToken(openToken(row.token_ciphertext,owner,env),env,fetcher);
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
 const found=fresh.items.map(i=>({product:i.product,brand:i.brand,merchant:i.merchant,size_label:i.size_label,color:i.color,quantity:i.quantity,sku:i.sku,
  basis:i.source_events.find(e=>e.kind==='purchased')?.basis??null,category:i.source_events.find(e=>e.kind==='purchased')?.category??null}));
 const purchased=found.filter((f,n)=>fresh.items[n].source_events.some(e=>e.kind==='purchased'));
 return {item_id:itemId,reason:label.review.reason,emails:ids.length,found:purchased,withheld,...judgeLabel(label.review,item,purchased,target)};
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
   if(!uuid(input.conversation)||typeof input.item_id!=='string'||input.item_id.length>200)return json(res,400,{error:'Choose a labelled item.'});
   const result=await recheckItem(storeFactory(env),input.conversation,input.item_id,env,{fetcher,...(interpret?{interpret}:{}),...(prepare?{prepare}:{})});
   console.log(JSON.stringify({event:'receipt_recheck',reason:result.reason,match:result.match,emails:result.emails,withheld:result.withheld.length}));
   return json(res,200,result);
  }catch(error){
   console.log(JSON.stringify({event:'receipt_recheck_failed',status:error.status??null}));
   return json(res,[400,404,409].includes(error.status)?error.status:503,{error:[400,404,409].includes(error.status)?error.message:'Could not re-check this item. Gmail access may have expired; reconnect from onboarding and try again.'});
  }
 };
}
