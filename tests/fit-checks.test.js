import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptFeedback,applyReceiptAnswer,applyReceiptFeedback,receiptLearningView} from '../lib/receipt-feedback.js';
import {reconcileReceipt,emptyReceiptState,projectReceiptState} from '../lib/receipt-extraction.js';
import {loadReceipts,purchaseSummary} from '../lib/evidence.js';
import {wardrobeView} from '../lib/wardrobe.js';
import {deliveryOf,fitCheckCandidates,fitCheckDraft,sendFitCheck,PROACTIVE} from '../lib/fit-checks.js';
import {announcePurchases,refreshOwner} from '../lib/purchase-texts.js';
import {updatePurchaseHistory} from '../lib/receipt-chat.js';

const OWNER='owner-1',DAY=86400000,NOW=Date.parse('2026-10-18T17:00:00Z'),TODAY='2026-10-18';
const event=(kind,daysAgo,id,source=`${kind}-${id}`)=>({id:`${source}:0`,kind,at:NOW-daysAgo*DAY,source_id:source});
// A purchase ten days ago (unless days says otherwise); delivered/shipped say how many days ago those emails came.
const bought=(id,{days=10,delivered=null,shipped=null,events=[],...extra}={})=>({id,source_ids:[`order-${id}`],brand:'Acne Studios',product:`Item ${id}`,merchant:'SSENSE',size_label:'32',color:null,
 source_events:[event('purchased',days,id,`order-${id}`),...(shipped===null?[]:[event('shipped',shipped,id)]),...(delivered===null?[]:[event('delivered',delivered,id)]),...events],...extra});
const jeans=bought('jeans',{product:'1996 Jeans',delivered:4,shipped:6});

// The purchase-history row and the message ledger, in the shape the application uses them.
function storage({items=[jeans],feedback=createReceiptFeedback(OWNER,items,[]),data={},recent=[]}={}){
 let row={conversation_id:OWNER,revision:1,token_ciphertext:'sealed',data:{job:{status:'ready'},feedback,...data}},rows=[],busy=false;
 const operations=new Map(),sent=[];
 return {sent,operations,get row(){return row;},get rows(){return rows;},
  gmailImport:async()=>structuredClone(row),profile:async()=>({facts:[]}),
  evidence:async()=>structuredClone(rows),
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(owner,revision,next,token,evidence=[])=>{busy=false;if(revision!==row.revision)return false;row={...row,data:structuredClone(next),token_ciphertext:token};for(const e of evidence)if(!rows.some(r=>r.id===e.id))rows.push(structuredClone(e));return true;},
  operation:async key=>operations.get(key)??null,conversation:async()=>({id:OWNER,line:'line',sender_id:'sender'}),recent:async()=>recent,
  reserve:async(o,key,body)=>{if(operations.has(key))return false;operations.set(key,{status:'sending',body,conversation_id:o});return true;},
  finish:async(key,status)=>{operations.get(key).status=status;}};
}
const send=store=>async(target,body)=>{store.sent.push(body);return {id:'msg'};};
const stateOf=async store=>(await loadReceipts(store,OWNER,store.row)).state;
const candidates=async(store,now=NOW)=>{const state=await stateOf(store);return fitCheckCandidates(state,wardrobeView(state),new Set((store.row.data.refresh?.fit_checks??[]).map(c=>c.item_id)),now);};

test('delivery comes from a delivery email, else about five days after shipping, and is never invented',()=>{
 assert.deepEqual(deliveryOf(jeans),{at:NOW-4*DAY,basis:'delivery_email'});
 assert.deepEqual(deliveryOf(bought('tee',{shipped:9})),{at:NOW-4*DAY,basis:'shipped_plus_five_days'});
 // An in-store receipt or a pre-order says nothing about a parcel arriving.
 assert.equal(deliveryOf(bought('tee')),null);
 // Screenshots and connected stores are dated by the order, so they never date a delivery.
 assert.equal(deliveryOf(bought('tee',{events:[event('delivered',4,'tee','screenshot:m1'),event('shipped',9,'tee','shop:o1')]})),null);
});

test('the receipt reader accepts a quoted delivery notice as a delivered event',()=>{
 const text='SSENSE Order 123 1996 Jeans size 32 has been delivered';
 const fact=value=>({value,quote:value}),values={merchant:fact('SSENSE'),order_reference:fact('123'),product:fact('1996 Jeans'),sku:fact(null),brand:fact(null),color:fact(null),size_label:fact('32'),size_system:fact(null),quantity:fact(null),units_per_pack:fact(null)};
 const line=(kind,basis,source)=>({kind,basis:{value:basis,quote:kind==='purchased'?'Order 123':'has been delivered'},category:'clothing',existing_item_id:null,evidence:'1996 Jeans',...values,unit_price:null,currency:null,recipient:null,photo_ref:null,link_ref:null,part_of_event:null});
 let {state}=reconcileReceipt(emptyReceiptState(OWNER),{id:'m1',text,date:NOW-10*DAY},{events:[line('purchased','order_confirmation')]});
 const id=state.items[0].id;
 ({state}=reconcileReceipt(state,{id:'m2',text,date:NOW-4*DAY},{events:[{...line('delivered','shipping_notice'),existing_item_id:id}]}));
 assert.deepEqual(deliveryOf(state.items[0]),{at:NOW-4*DAY,basis:'delivery_email'});
});

test('only the person\'s own sized items, a few days after delivery and within the window, are due',async()=>{
 const items=[jeans,bought('early',{delivered:1}),bought('old',{days:45,delivered:40}),bought('gift',{delivered:5}),
  bought('returned',{delivered:5,events:[event('returned',1,'returned')]}),bought('returning',{delivered:5,events:[event('return_requested',1,'returning')]}),
  bought('cancelled',{delivered:5,events:[event('cancelled',8,'cancelled')]}),bought('nosize',{delivered:5,size_label:null}),bought('instore')];
 // The person said the gift was for someone else.
 const feedback=applyReceiptFeedback(createReceiptFeedback(OWNER,items,[]),{id:'closet:1',owner_id:OWNER,source:'closet_edit',at:new Date(NOW).toISOString(),item_ids:['gift'],action:'set_recipient',value:'other',label:null});
 const {due,skipped}=await candidates(storage({feedback}));
 assert.deepEqual(due.map(i=>i.id),['jeans']);
 assert.deepEqual(skipped,{too_early:1,gift:1,returned:1,return_requested:1,cancelled:1,no_size:1,no_delivery:1});
});

test('a fit check names the item and its size as recorded, goes out once, and is marked before sending',async()=>{
 const store=storage();
 const result=await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW});
 assert.deepEqual([result.status,result.item_id,result.delivery_basis],['sent','jeans','delivery_email']);
 assert.equal(store.sent.length,1);assert.ok(store.sent[0].includes('1996 Jeans')&&store.sent[0].includes('32'));
 assert.deepEqual(store.row.data.refresh.fit_checks.map(c=>c.item_id),['jeans']);
 assert.equal(store.operations.get(PROACTIVE.fit_check(OWNER,TODAY)).status,'sent');
 // Once per item: tomorrow it is not asked again.
 const next=await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW+DAY});
 assert.equal(next.status,'nothing_due');assert.equal(next.skipped.already_asked,1);assert.equal(store.sent.length,1);
 // A failed send still counts as asked: a check can be missed, never repeated.
 const failing=storage();
 assert.equal((await sendFitCheck(failing,OWNER,{},{send:async()=>{throw Error('down');},now:NOW})).status,'uncertain');
 assert.deepEqual(failing.row.data.refresh.fit_checks.map(c=>c.item_id),['jeans']);
});

test('a person who turned purchase texts off in chat gets no fit check, and gets one again once they turn them back on',async()=>{
 const store=storage({data:{purchase_texts:{enabled:false}}});
 assert.deepEqual(await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW}),{status:'skipped',reason:'texts_off'});
 assert.equal(store.sent.length,0);assert.equal(store.row.data.refresh,undefined);
 store.row.data.purchase_texts.enabled=true;
 assert.equal((await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW})).status,'sent');
});

test('the draft keeps the size label exactly as recorded',()=>{
 assert.equal(fitCheckDraft({product:'Loafers',brand:'G.H. Bass',merchant:null,size:'EU 42.5'}),'how is the G.H. Bass Loafers fitting in size EU 42.5? tell me if the size is right, if it runs big or small, or if you sent it back.');
});

test('one proactive text a day: a purchase text and a fit check never go out on the same day',async()=>{
 // A purchase text today takes the day; the fit check waits for tomorrow.
 const store=storage({items:[jeans,bought('cargo',{events:[]})],data:{refresh:{pending:['cargo'],announced:[]}}});
 store.row.data.feedback.items[1].source_events[0].at=NOW-DAY;
 const pick=async()=>({send:true,angle:'just_added',lead_item_id:'cargo',similar_owned_item_ids:[],related_item_ids:[],hook:''});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:pick,send:send(store),now:NOW})).status,'sent');
 const held=await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW});
 assert.deepEqual([held.status,held.reason],['skipped','texted_today']);
 assert.equal(store.row.data.refresh.fit_checks,undefined);
 assert.equal((await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW+DAY})).status,'sent');
 assert.equal(store.sent.length,2);
 // A fit check today also takes the day from a new purchase text.
 const other=storage({items:[jeans,bought('cargo')],data:{refresh:{pending:['cargo'],announced:[]}}});
 assert.equal((await sendFitCheck(other,OWNER,{},{send:send(other),now:NOW})).status,'sent');
 assert.equal((await announcePurchases(other,OWNER,{},{interpret:pick,send:send(other),now:NOW})).status,'already_sent_today');
 assert.deepEqual(other.row.data.refresh.pending,['cargo']);
});

test('the daily run sends the fit check only when no purchase text went out',async()=>{
 // Today's check already ran, so the run goes straight to the texts.
 const checked=()=>storage({data:{refresh:{pending:[],announced:[],checked_on:TODAY}}});
 const quiet=checked(),run=(store,announce)=>refreshOwner(store,OWNER,{},{announce,now:()=>NOW,deadline:NOW,
  fitCheck:(s,o,e)=>sendFitCheck(s,o,e,{send:send(s),now:NOW})});
 assert.deepEqual(await run(quiet,async()=>({status:'nothing_new'})),{check:'done',text:'nothing_new',fit_check:'sent'});
 assert.equal(quiet.sent.length,1);
 const texted=checked();
 assert.deepEqual(await run(texted,async()=>({status:'sent'})),{check:'done',text:'sent',fit_check:'not_checked'});
 assert.equal(texted.sent.length,0);
});

test('a fit check is held while the person is mid-conversation and stays due',async()=>{
 const store=storage({recent:[{direction:'outbound',body:'here you go',created_at:new Date(NOW-5*60000).toISOString()}]});
 const held=await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW});
 assert.deepEqual([held.status,held.reason,held.waiting],['held','mid_conversation',1]);
 assert.equal(store.sent.length,0);assert.equal(store.row.data.refresh,undefined);
 assert.equal((await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW+20*60000})).status,'sent');
});

test('fit check switch off sends nothing',async()=>{
 const store=storage();
 assert.equal((await sendFitCheck(store,OWNER,{FIT_CHECKS_ENABLED:'false'},{send:send(store),now:NOW})).reason,'disabled');
 assert.equal(store.sent.length,0);
});

// Structured fit reports: what the model's reading of a reply becomes in the purchase history.
const act=(action,item_ids,fit=null)=>({action,item_ids,recipient:null,recipient_label:null,fit,corrections:[],target_item_id:null,question_id:null});
const provenance=id=>({id,owner_id:OWNER,source:'chat_answer',at:new Date(NOW).toISOString()});

test('a fit report is brand-scoped learning about that item and never changes its size',()=>{
 const base=createReceiptFeedback(OWNER,[{...jeans,recipient_evidence:{value:'self',quote:'Ship to Sam',source_id:'order-jeans'}},bought('tee',{brand:'Lemaire',size_label:'M',recipient_evidence:{value:'self',quote:'Ship to Sam',source_id:'order-tee'}})]);
 const state=applyReceiptAnswer(base,{actions:[act('report_fit',['jeans'],'runs_small')]},provenance('imessage:r1'));
 const jeansNow=state.items.find(i=>i.id==='jeans');
 assert.equal(jeansNow.fit,'runs_small');assert.equal(jeansNow.size_label,'32');
 const observations=receiptLearningView(projectReceiptState(state)).learning_observations;
 assert.equal(observations.find(o=>o.item_id==='jeans').confirmed_fit,'runs_small');
 assert.equal(observations.find(o=>o.item_id==='tee').confirmed_fit,null);
 assert.deepEqual(purchaseSummary(state,NOW).fit_notes,[{brand:'Acne Studios',product:'1996 Jeans',size:'32',system:null,fit:'runs_small'}]);
 assert.throws(()=>applyReceiptAnswer(base,{actions:[act('report_fit',['jeans'],'perfect')]},provenance('imessage:r2')),/Invalid fit/);
});

test('fit-check replies across turns: a fit, a correction, and a later return each update the right scope',async()=>{
 const store=storage();
 await sendFitCheck(store,OWNER,{},{send:send(store),now:NOW});
 const turns=[];
 store.context=async(_owner,id)=>[{provider_id:'fit',direction:'outbound',body:store.sent[0],created_at:new Date(NOW).toISOString()},...turns.filter(t=>t.provider_id<=id)];
 // The model's reading is stubbed; the test checks what it is given and what each reading changes.
 const reply=async(id,text,actions)=>{
  turns.push({provider_id:id,direction:'inbound',body:text,created_at:new Date(NOW+turns.length*60000).toISOString()});
  let seen=null;
  const result=await updatePurchaseHistory({message:{id,content:{text}}},OWNER,store,{},{interpret:async request=>{seen=request.context.state;return {actions};}});
  return {result,seen};
 };
 const first=await reply('r1','they fit like a dream',[act('report_fit',['jeans'],'true_to_size')]);
 assert.deepEqual(first.seen.fit_checks.map(c=>c.item_id),['jeans']);
 assert.ok(first.seen.conversation.some(m=>m.provider_id==='fit'));
 assert.equal(first.result.updated,true);
 let state=await stateOf(store);assert.equal(state.items[0].fit,'true_to_size');
 // A correction replaces the earlier report for the same item.
 await reply('r2','actually after a day they are a bit tight, runs small',[act('report_fit',['jeans'],'runs_small')]);
 state=await stateOf(store);assert.equal(state.items[0].fit,'runs_small');assert.equal(state.items[0].size_label,'32');
 // Uncertainty records nothing.
 const unsure=await reply('r3','not sure yet, only tried them on once',[]);
 assert.equal(unsure.result.updated,false);assert.equal((await stateOf(store)).items[0].fit,'runs_small');
 // A return leaves the wardrobe; a later fit check never asks about it.
 await reply('r4','sent them back in the end',[act('report_return',['jeans'])]);
 state=await stateOf(store);
 assert.equal(wardrobeView(state).removed[0].reason,'returned');
 assert.equal((await candidates(store,NOW+DAY)).due.length,0);
});

test('one reply can report a fit and a return together',async()=>{
 const store=storage({items:[jeans,bought('tee',{delivered:4,product:'Logo Tee',size_label:'M'})]});
 store.context=async()=>[];
 const result=await updatePurchaseHistory({message:{id:'r1',content:{text:'jeans are perfect, the tee was huge so it went back'}}},OWNER,store,{},
  {interpret:async()=>({actions:[act('report_fit',['jeans'],'true_to_size'),act('report_fit',['tee'],'runs_large'),act('report_return',['tee'])]})});
 assert.equal(result.updated,true);
 const state=await stateOf(store),view=wardrobeView(state);
 assert.deepEqual(view.items.map(i=>i.id),['jeans']);assert.equal(view.removed[0].id,'tee');
 assert.deepEqual(['jeans','tee'].map(id=>state.items.find(i=>i.id===id).fit),['true_to_size','runs_large']);
});
