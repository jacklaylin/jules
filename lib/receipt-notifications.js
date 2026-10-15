import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {loadReceipts} from './evidence.js';
import {projectReceiptState,merchantKey} from './receipt-extraction.js';
import {effectiveRecipient} from './receipt-feedback.js';

// Texts after a Gmail import, in order: a completion count, then the open questions one at a time,
// then a short "who you are" summary once questions are done (or 24 hours after the last unanswered
// question, via the sweep). Each text is sent once per import through the message ledger.
export async function receiptNotification(store,owner,env,stage,body,send=sendGreeting){
 const operation=`gmail:${owner}:${stage}`,existing=await store.operation(operation);
 if(existing)return existing;
 const conversation=await store.conversation(owner);
 return deliverReply({store,send,conversation,operation,body,source:'operator',env});
}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
// Purchases that count: not removed, not a duplicate, not cancelled.
function activeItems(state){return projectReceiptState(state).items.filter(i=>!i.purchase_disputed&&!i.duplicate_of);}
export function completionText(state){
 const items=activeItems(state),returns=items.filter(i=>['returned','return_requested'].includes(i.outcome?.value)).length;
 const open=state.questions.some(q=>q.status==='open');
 if(!items.length)return 'done reading your shopping emails. i didn’t find any clothing purchases i could confirm. send me a photo or link anytime and i’ll learn your taste as we go.';
 return `done reading your shopping emails. i found ${plural(items.length,'clothing purchase')}${returns?` and ${plural(returns,'return')}`:''}.`+(open?' a few quick questions so i get the details right:':'');
}
// Display name for a brand or store: legal-entity and storefront suffixes are formatting, not part
// of the name ("MFPEN Retail ApS" -> "MFPEN").
const display=name=>name.replace(/\s*\((?:u\.?s\.?a\.?|uk|us)\)/gi,'').replace(/(?:,?\s+(?:retail|aps|a\/s|ab|ag|gmbh|inc\.?|llc|ltd\.?|limited|sas|s\.?a\.?|b\.?v\.?|co\.?))+\s*$/i,'').trim()||name;
function top(items,field,limit){
 const groups=new Map();
 for(const item of items){const name=item[field];const key=merchantKey(name);if(!key)continue;
  const g=groups.get(key)??{name:display(name),count:0};g.count++;if(display(name).length<g.name.length)g.name=display(name);groups.set(key,g);}
 return [...groups.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,limit).map(g=>g.name);
}
// Typical price per item from receipt-quoted prices: the middle half (25th to 75th percentile) in the
// currency with the most priced purchases, needing at least 3. Currencies are never converted.
const MONEY={USD:'$',$:'$',EUR:'€',GBP:'£'};
const nice=n=>n<20?Math.round(n):n<200?Math.round(n/10)*10:Math.round(n/50)*50;
export function priceRange(items){
 const byCurrency=new Map();
 for(const i of items)if(i.price?.amount>0&&i.price.currency)byCurrency.set(i.price.currency,[...(byCurrency.get(i.price.currency)??[]),i.price.amount]);
 const [currency,amounts]=[...byCurrency.entries()].sort((a,b)=>b[1].length-a[1].length)[0]??[];
 if(!amounts||amounts.length<3)return null;
 const sorted=[...amounts].sort((a,b)=>a-b),at=q=>{const pos=q*(sorted.length-1),i=Math.floor(pos);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(pos-i);};
 const low=nice(at(0.25)),high=nice(at(0.75)),money=n=>MONEY[currency]?`${MONEY[currency]}${n.toLocaleString('en-US')}`:`${n.toLocaleString('en-US')} ${currency}`;
 return low===high?`around ${money(low)}`:`${money(low)}–${money(high)}`;
}
// Purchased sizes are what they bought, not a confirmed fit; gifts and removed items don't count.
export function profileText(state){
 const items=activeItems(state).filter(i=>effectiveRecipient(i).value!=='other');
 if(items.length<2)return null;
 const brands=top(items,'brand',4),stores=top(items,'merchant',3);
 const sizes=Object.entries(items.reduce((m,i)=>{const s=i.size_label?.trim();if(s)m[s]=(m[s]??0)+1;return m;},{})).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([s])=>s);
 const spend=priceRange(items);
 const lines=[brands.length&&`brands you buy most: ${brands.join(', ')}`,stores.length&&`where you shop: ${stores.join(', ')}`,sizes.length&&`sizes you’ve bought: ${sizes.join(', ')}`,spend&&`what you usually spend: ${spend} per item`].filter(Boolean);
 if(!lines.length)return null;
 return `here’s what i’m learning about your style from your purchases:\n${lines.join('\n')}\ntell me anytime if something’s off.`;
}
async function importState(store,owner){
 const row=await store.gmailImport(owner);
 if(!row?.data?.job)return null;
 return {row,state:(await loadReceipts(store,owner,row)).state};
}
// The profile summary follows the completion text; never before it, and once per import.
export async function sendProfile(store,owner,env,send=sendGreeting,loaded=null){
 const current=loaded??await importState(store,owner);if(!current)return null;
 const {row,state}=current,job=row.data.job;
 if(job.status!=='ready'||(await store.operation(`gmail:${owner}:ready:${job.started_at}`))?.status!=='sent')return null;
 const body=profileText(state);if(!body)return null;
 return receiptNotification(store,owner,env,'profile:'+job.started_at,body,send);
}
export async function nextReceiptQuestion(store,owner,env,send=sendGreeting){
 const current=await importState(store,owner);if(!current)return null;
 const question=current.state.questions.find(q=>q.status==='open');
 // The persisted question ID and outbound message retain the original item scope.
 if(question)return receiptNotification(store,owner,env,'question:'+question.id,question.question,send);
 return sendProfile(store,owner,env,send,current);
}
// Completion: the count text, then the first question or the profile summary.
export async function announceImport(store,owner,env,send=sendGreeting){
 const current=await importState(store,owner);if(!current)return null;
 const result=await receiptNotification(store,owner,env,'ready:'+current.row.data.job.started_at,completionText(current.state),send);
 if(result.status==='sent')await nextReceiptQuestion(store,owner,env,send);
 return result;
}
