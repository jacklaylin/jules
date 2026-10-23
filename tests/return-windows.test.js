import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReceipt,emptyReceiptState,projectReceiptEvidence,purchaseEvidence,returnRecords,RECEIPT_SCHEMA} from '../lib/receipt-extraction.js';
import {parseStatedDate,parseWindow,returnDeadline,reminderDecision,returnWindowCandidates,recordReturnDecisions,rereadQueue,logReturnWindows,rereadReturnTerms,returnWindowView,RETURNS_VERSION} from '../lib/return-windows.js';
import {applyReceiptFeedback} from '../lib/receipt-feedback.js';

// Return-window reminders, step 1 (read and log only). The deadline comes only from the evidence: a stated
// return-by date, or a stated window counted from a dated email. Never a policy, never an estimated delivery.
const OWNER='owner-1',DAY=86400000,ZONE='America/New_York';
const ORDERED=Date.parse('2026-10-01T15:00:00Z');
const fact=(value,quote=value)=>({value,quote}),none=fact(null);
const ORDER_TEXT='SUBJECT\nYour SSENSE order\nThank you for your order. Order number: 123456\nOur Legacy Jacket\nSize: 48\nReturns: you can return items within 30 days of delivery.\nReturn by November 14, 2026 for a full refund.\nThis item is final sale.';
const source=(id='order-1',text=ORDER_TEXT,date=ORDERED)=>({id,date,text});
const line=(kind='purchased',extra={})=>({kind,basis:{value:kind==='purchased'?'order_confirmation':'shipping_notice',quote:kind==='purchased'?'Thank you for your order':'Our Legacy Jacket'},category:'clothing',existing_item_id:null,evidence:'Our Legacy Jacket',
 merchant:fact('SSENSE','Your SSENSE order'),order_reference:fact('123456','Order number: 123456'),product:fact('Our Legacy Jacket'),sku:none,brand:fact('Our Legacy','Our Legacy Jacket'),color:none,size_label:fact('48','Size: 48'),size_system:none,
 quantity:none,units_per_pack:none,unit_price:none,currency:none,recipient:{value:'unknown',quote:null},photo_ref:null,link_ref:null,part_of_event:null,
 return_by:none,return_window:none,return_window_from:'not_stated',final_sale:none,...extra});
const read=(events,src=source())=>reconcileReceipt(emptyReceiptState(OWNER),src,{events});
// An item with the given return terms and dated events (days after the order).
const item=(terms,events={},extra={})=>({id:'jacket',brand:'Our Legacy',product:'Jacket',merchant:'SSENSE',outcome:{value:'unknown'},recipient:{value:'self'},field_provenance:{},return_terms:terms,
 source_events:[{kind:'purchased',at:ORDERED,source_id:'order-1'},...Object.entries(events).map(([kind,[days,src]])=>({kind,at:ORDERED+days*DAY,source_id:src??`${kind}-1`,evidence:`${kind} notice`}))],...extra});
const at=day=>Date.parse(`${day}T16:00:00Z`);// midday Eastern

test('the receipt schema asks for return terms on every line',()=>{
 for(const f of ['return_by','return_window','return_window_from','final_sale'])assert.ok(RECEIPT_SCHEMA.properties.events.items.required.includes(f),f);
});

test('dates and periods are parsed from the quoted text only, never guessed',()=>{
 assert.equal(parseStatedDate('Return by November 14, 2026'),'2026-11-14');
 assert.equal(parseStatedDate('eligible until Friday, Nov 14th',Date.parse('2026-10-20')),'2026-11-14');
 assert.equal(parseStatedDate('14 November 2026'),'2026-11-14');
 assert.equal(parseStatedDate('return by 2026-11-14'),'2026-11-14');
 assert.equal(parseStatedDate('14/11/2026'),'2026-11-14');
 assert.equal(parseStatedDate('03/04/2026'),null,'day and month could be either way round');
 assert.equal(parseStatedDate('Nov 14'),null,'no year and no email date to place it');
 assert.equal(parseStatedDate('February 30, 2026'),null);
 assert.deepEqual(parseWindow('within 30 days of delivery'),{days:30});
 assert.deepEqual(parseWindow('thirty (30) days'),{days:30});
 assert.deepEqual(parseWindow('a 14-day return window'),{days:14});
 assert.deepEqual(parseWindow('two weeks'),{days:14});
 assert.deepEqual(parseWindow('1 month'),{months:1});
 assert.equal(parseWindow('10 business days'),null,'business days need a holiday calendar');
 assert.equal(parseWindow('see our returns policy'),null);
});

test('receipt reading keeps only quoted return terms, and a window start only when its quote names it',()=>{
 const {records}=read([line('purchased',{return_by:fact('November 14, 2026','Return by November 14, 2026 for a full refund.'),return_window:fact('30 days','within 30 days of delivery'),return_window_from:'delivery'})]);
 assert.deepEqual(records[0].return_terms,{return_by:'2026-11-14',return_by_quote:'Return by November 14, 2026 for a full refund.',window:{days:30},window_quote:'within 30 days of delivery',window_from:'delivery'});
 // The model claims "from delivery" but the quote does not say so: the start stays unknown.
 const loose=read([line('purchased',{return_window:fact('30 days','within 30 days'),return_window_from:'delivery'})]).records[0];
 assert.equal(loose.return_terms.window_from,'not_stated');
 // A date the email does not contain is withheld, not kept.
 const made=read([line('purchased',{return_by:fact('December 1, 2026','Return by December 1, 2026')})]).records[0];
 assert.equal(made.return_terms,undefined);assert.ok(made.withheld_fields.includes('return_terms'));
 const sale=read([line('purchased',{final_sale:fact('final sale','This item is final sale.')})]).records[0];
 assert.equal(sale.return_terms.final_sale,'This item is final sale.');
 // No terms in the email: nothing is recorded.
 assert.equal(read([line()]).records[0].return_terms,undefined);
});

test('return terms replay from evidence onto the item, once per email',()=>{
 const {records}=read([line('purchased',{return_window:fact('30 days','within 30 days of delivery'),return_window_from:'delivery'})]);
 const {state}=projectReceiptEvidence(OWNER,records.map(r=>purchaseEvidence(r)));
 assert.equal(state.items.length,1);assert.equal(state.items[0].return_terms.length,1);
 assert.equal(state.items[0].return_terms[0].source_id,'order-1');
 // The re-read attaches terms to the existing item from the same email, never a new item, and not twice.
 const plain=projectReceiptEvidence(OWNER,read([line()]).records.map(r=>purchaseEvidence(r))).state;
 const proposal={events:[line('purchased',{return_by:fact('November 14, 2026','Return by November 14, 2026 for a full refund.')})]};
 const first=returnRecords(plain,source(),proposal);
 assert.equal(first.records.length,1);assert.equal(first.state.items.length,1);assert.equal(first.state.items[0].return_terms[0].return_by,'2026-11-14');
 assert.equal(returnRecords(first.state,source(),proposal).records.length,0);
 const replayed=projectReceiptEvidence(OWNER,[...read([line()]).records,...first.records].map(r=>purchaseEvidence(r))).state;
 assert.equal(replayed.items[0].return_terms[0].return_by,'2026-11-14');
 assert.equal(replayed.items[0].source_events.length,1,'the re-read adds no purchase or shipping event');
});

test('evidence rule: a stated date, or a stated window from a dated email; otherwise no deadline',()=>{
 const stated={source_id:'order-1',return_by:'2026-11-14',return_by_quote:'Return by November 14, 2026'};
 assert.deepEqual(returnDeadline(item([stated])),{deadline:'2026-11-14',basis:'stated_date',evidence:{source_id:'order-1',quote:'Return by November 14, 2026'}});
 const fromDelivery={source_id:'order-1',window:{days:30},window_quote:'within 30 days of delivery',window_from:'delivery'};
 const delivered=returnDeadline(item([fromDelivery],{shipped:[2],delivered:[5]}));
 assert.equal(delivered.deadline,'2026-11-05');assert.equal(delivered.basis,'window_from_delivery');assert.equal(delivered.evidence.from.source_id,'delivered-1');
 // Shipped but no delivery email: never "shipped plus a few days"; the order date is a floor ("at least until").
 const floor=returnDeadline(item([fromDelivery],{shipped:[2]}));
 assert.equal(floor.deadline,'2026-10-31');assert.equal(floor.basis,'order_date_floor');assert.equal(floor.at_least,true);
 // A Shop order or screenshot does not date a parcel: still the floor.
 assert.equal(returnDeadline(item([fromDelivery],{delivered:[5,'shop:abc']})).basis,'order_date_floor');
 const fromOrder={source_id:'order-1',window:{days:14},window_quote:'14 days from your order date',window_from:'order'};
 assert.equal(returnDeadline(item([fromOrder])).deadline,'2026-10-15');
 // A period with no stated start: the order date is still a floor, since no start can come before the order.
 assert.equal(returnDeadline(item([{source_id:'order-1',window:{days:30},window_quote:'30 days',window_from:'not_stated'}])).at_least,true);
 assert.deepEqual(returnDeadline(item([])),{deadline:null,reason:'no_terms'});
 assert.equal(returnDeadline(item([stated,{source_id:'order-1',final_sale:'final sale'}])).reason,'final_sale');
 // Two stated deadlines: the earlier one wins.
 assert.equal(returnDeadline(item([stated,fromOrder])).deadline,'2026-10-15');
 // The delivery day is the person's local day: 2am UTC on Oct 6 is still Oct 5 in Los Angeles.
 const late={...item([fromDelivery]),source_events:[{kind:'purchased',at:ORDERED,source_id:'order-1'},{kind:'delivered',at:Date.parse('2026-10-06T02:00:00Z'),source_id:'delivered-1'}]};
 assert.equal(returnDeadline(late,'America/Los_Angeles').deadline,'2026-11-04');
 assert.equal(returnDeadline(late,'Europe/London').deadline,'2026-11-05');
});

test('timing: from 3 days before the last return day to the day before, never on or after it',()=>{
 const it=item([{source_id:'order-1',return_by:'2026-10-24',return_by_quote:'Return by October 24, 2026'}]);
 const on=day=>reminderDecision(it,{now:at(day),zone:ZONE});
 assert.equal(on('2026-10-20').reason,'too_early');
 assert.equal(on('2026-10-21').status,'would_send');assert.equal(on('2026-10-21').days_left,3);
 assert.equal(on('2026-10-23').status,'would_send');
 assert.equal(on('2026-10-24').reason,'deadline_passed');
 assert.equal(on('2026-10-30').reason,'deadline_passed');
 assert.equal(reminderDecision(it,{now:at('2026-10-22'),zone:ZONE,reminded:true}).reason,'already_reminded');
});

test('items the person kept, returned, gave away or never bought are skipped with the reason',()=>{
 const terms=[{source_id:'order-1',return_by:'2026-10-24',return_by_quote:'Return by October 24, 2026'}],now=at('2026-10-22');
 assert.equal(reminderDecision(item(terms,{},{outcome:{value:'kept'}}),{now}).reason,'kept');
 assert.equal(reminderDecision(item(terms,{},{outcome:{value:'returned'}}),{now}).reason,'returned');
 assert.equal(reminderDecision(item(terms,{},{outcome:{value:'return_requested'}}),{now}).reason,'return_requested');
 assert.equal(reminderDecision(item(terms,{},{recipient:{value:'other',label:null},field_provenance:{recipient:{}}}),{now}).reason,'gift');
 assert.equal(reminderDecision(item(terms,{},{purchase_disputed:true}),{now}).reason,'never_bought');
});

// The purchase-history row and evidence rows, shaped as the application stores them.
function storage(records,data={}){
 let row={conversation_id:OWNER,revision:1,token_ciphertext:null,data:{job:{status:'ready'},sources:[{id:'order-1',shopping_evidence:true}],...data}},busy=false;
 const rows=records.map(r=>purchaseEvidence(r));
 return {get row(){return row;},rows,gmailImport:async()=>structuredClone(row),evidence:async()=>structuredClone(rows),
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(owner,revision,next,token,evidence=[])=>{busy=false;if(revision!==row.revision)return false;row={...row,data:structuredClone(next),token_ciphertext:token};for(const e of evidence)if(!rows.some(r=>r.id===e.id))rows.push(structuredClone(e));return true;}};
}
const statedOrder=()=>read([line('purchased',{return_by:fact('October 24, 2026','Return by October 24, 2026')})],source('order-1',ORDER_TEXT+'\nReturn by October 24, 2026')).records;

test('the daily log records each recent item once per change, and sends nothing',async()=>{
 const store=storage(statedOrder());
 const first=await logReturnWindows(store,OWNER,{now:at('2026-10-20')});
 assert.deepEqual([first.items,first.would_send,first.changed],[1,0,1]);
 assert.equal(store.row.data.returns.log[0].reason,'too_early');
 assert.equal((await logReturnWindows(store,OWNER,{now:at('2026-10-20')+3600000})).changed,0,'an unchanged decision adds nothing');
 const due=await logReturnWindows(store,OWNER,{now:at('2026-10-21')});
 assert.deepEqual([due.would_send,due.changed],[1,1]);
 assert.equal(store.row.data.returns.log.at(-1).status,'would_send');assert.equal(store.row.data.returns.log.at(-1).deadline,'2026-10-24');
 assert.equal(store.row.data.nudges,undefined,'no nudge or text is recorded');
 // An item with no stated terms is logged as no_terms.
 const quiet=storage(read([line()]).records);
 await logReturnWindows(quiet,OWNER,{now:at('2026-10-20')});
 assert.equal(quiet.row.data.returns.log[0].reason,'no_terms');
});

test('recordReturnDecisions keeps the log to the newest 50 entries',()=>{
 const data={};
 for(let n=0;n<60;n++)recordReturnDecisions(data,[{id:'i'+n,status:'skip',reason:'no_terms'}],at('2026-10-20'));
 assert.equal(data.returns.log.length,50);assert.equal(data.returns.log.at(-1).item_id,'i59');
});

test('the re-read queue covers recent purchases\' emails not yet read for return terms',()=>{
 const records=read([line()]).records,state=projectReceiptEvidence(OWNER,records.map(r=>purchaseEvidence(r))).state;
 const row={data:{sources:[{id:'order-1'}]}};
 assert.deepEqual(rereadQueue(row,state,at('2026-10-20')),['order-1']);
 assert.deepEqual(rereadQueue({data:{sources:[{id:'order-1',returns_version:RETURNS_VERSION}]}},state,at('2026-10-20')),[]);
 assert.deepEqual(rereadQueue(row,state,ORDERED+46*DAY),[],'older than 45 days');
});

test('the admin re-read saves only return terms, marks the email read, and refuses without Gmail',async()=>{
 const store=storage(read([line()]).records);
 await assert.rejects(rereadReturnTerms(store,OWNER,{}),/Gmail is disconnected/);
 store.row.token_ciphertext='sealed';
 const proposal={events:[line('purchased',{return_by:fact('October 24, 2026','Return by October 24, 2026')})]},fetched=[];
 const options={now:at('2026-10-20'),signIn:async()=>({access_token:'t'}),fetcher:async url=>{fetched.push(url);return new Response(JSON.stringify({id:'order-1'}),{status:200});},
  prepare:async()=>source('order-1',ORDER_TEXT+'\nReturn by October 24, 2026'),interpret:async()=>proposal};
 const result=await rereadReturnTerms(store,OWNER,{},options);
 assert.deepEqual(result,{read:1,failed:0,found:1,remaining:0});
 assert.equal(fetched.length,1);assert.match(fetched[0],/messages\/order-1\?format=full/);
 assert.equal(store.rows.length,2);assert.equal(store.rows[1].data.attach_only,true);assert.equal(store.rows[1].data.return_terms.return_by,'2026-10-24');
 assert.equal(store.row.data.sources[0].returns_version,RETURNS_VERSION);
 const view=await returnWindowView(store,OWNER,{now:at('2026-10-22')});
 assert.equal(view.items.length,1,'still one item');assert.equal(view.items[0].status,'would_send');assert.equal(view.reread.remaining,0);
 // Nothing left: a second call reads nothing.
 assert.deepEqual(await rereadReturnTerms(store,OWNER,{},options),{read:0,remaining:0,found:0});
});

test('the admin view lists recent purchases with their stated terms and the decision',async()=>{
 const store=storage(statedOrder());
 const view=await returnWindowView(store,OWNER,{now:at('2026-10-22')});
 assert.equal(view.items.length,1);assert.equal(view.with_terms,1);assert.equal(view.with_deadline,1);
 assert.equal(view.items[0].status,'would_send');assert.equal(view.items[0].terms[0].return_by,'2026-10-24');
 assert.equal(view.reread.remaining,1);
});

test('a person saying they kept it moves the item out of the reminder set',async()=>{
 const state=projectReceiptEvidence(OWNER,statedOrder().map(r=>purchaseEvidence(r))).state;
 const kept=applyReceiptFeedback(state,{id:'chat:1',owner_id:OWNER,source:'chat_answer',at:'2026-10-22T16:00:00Z',item_ids:[state.items[0].id],action:'report_kept'});
 assert.equal(returnWindowCandidates(kept,{now:at('2026-10-22'),zone:ZONE})[0].reason,'kept');
 const returned=applyReceiptFeedback(state,{id:'chat:2',owner_id:OWNER,source:'chat_answer',at:'2026-10-22T16:00:00Z',item_ids:[state.items[0].id],action:'report_return'});
 assert.equal(returnWindowCandidates(returned,{now:at('2026-10-22'),zone:ZONE})[0].reason,'returned');
});

// ---------- Step 2: in-store purchases, the floor, sending, opt-out, replies ----------
import {harmonizeEmail} from '../lib/receipt-extraction.js';
import {sendReturnReminders,reminderDraft,reminderItem,manageReturnReminders,sendTestReminder,openReminder,TEST_LABEL,RETURN_OPERATION} from '../lib/return-windows.js';
import {nudgeDecision} from '../lib/nudges.js';
import {runDailyRefresh} from '../lib/purchase-texts.js';
import {updatePurchaseHistory} from '../lib/receipt-chat.js';
import {applyReceiptAnswerPartially,receiptLearningView} from '../lib/receipt-feedback.js';
import {projectReceiptState} from '../lib/receipt-extraction.js';

const STORE_TEXT='SUBJECT\nYour receipt from CHERRY LA\nCHERRY LA Melrose Ave store\nIn-store purchase\nWide Leg Cargo Pants × 1 32 $368.00\nReturns must be initiated within 14 days of receiving your item(s).';
const BOUGHT=Date.parse('2026-10-17T20:00:00Z');
const pantsLine=(extra={})=>line('purchased',{basis:{value:'receipt_or_invoice',quote:'Your receipt from CHERRY LA'},merchant:fact('CHERRY LA','Your receipt from CHERRY LA'),order_reference:none,
 product:fact('Wide Leg Cargo Pants','Wide Leg Cargo Pants × 1 32 $368.00'),brand:fact('CHERRY LA','Your receipt from CHERRY LA'),size_label:fact('32','Wide Leg Cargo Pants × 1 32 $368.00'),evidence:'Wide Leg Cargo Pants × 1 32 $368.00',
 return_window:fact('14 days','Returns must be initiated within 14 days of receiving your item(s).'),return_window_from:'delivery',...extra});
const storeReceipt=(extra={})=>read([pantsLine(extra)],source('receipt-1',STORE_TEXT,BOUGHT)).records;

test('an in-store purchase is received the day it was bought: a quoted fulfillment dates the window',()=>{
 const records=storeReceipt({fulfillment:{value:'in_store',quote:'In-store purchase'}});
 assert.deepEqual(records[0].fulfillment,{value:'in_store',quote:'In-store purchase'});
 const state=projectReceiptEvidence(OWNER,records.map(r=>purchaseEvidence(r))).state,pants=projectReceiptState(state).items[0];
 const d=returnDeadline(pants,'America/Los_Angeles');
 assert.equal(d.deadline,'2026-10-31');assert.equal(d.basis,'window_from_in_store_purchase');assert.equal(d.at_least,undefined);
 assert.equal(d.evidence.in_store,'In-store purchase');
 // A fulfillment quote the receipt does not contain is withheld: the window falls back to the floor.
 const unquoted=storeReceipt({fulfillment:{value:'in_store',quote:'Bought at the store'}});
 assert.equal(unquoted[0].fulfillment,undefined);assert.ok(unquoted[0].withheld_fields.includes('fulfillment'));
 const floor=returnDeadline(projectReceiptState(projectReceiptEvidence(OWNER,unquoted.map(r=>purchaseEvidence(r))).state).items[0],'America/Los_Angeles');
 assert.equal(floor.basis,'order_date_floor');assert.equal(floor.deadline,'2026-10-31');assert.equal(floor.at_least,true);
});

test('lines quoting the same return sentence share its start, and the email\'s fulfillment applies to every line',()=>{
 const q='Returns must be initiated within 14 days of receiving your item(s).';
 const out=harmonizeEmail({events:[{return_window:fact('14 days',q),return_window_from:'delivery',fulfillment:{value:'in_store',quote:'In-store purchase'}},{return_window:fact('14 days',q),return_window_from:'not_stated',fulfillment:{value:'unknown',quote:null}}]});
 assert.equal(out.events[1].return_window_from,'delivery');assert.equal(out.events[1].fulfillment.value,'in_store');
 // Disagreeing lines share nothing.
 const mixed=harmonizeEmail({events:[{return_window:fact('14 days',q),return_window_from:'delivery'},{return_window:fact('14 days',q),return_window_from:'order'},{return_window:fact('14 days',q),return_window_from:'not_stated'}]});
 assert.equal(mixed.events[2].return_window_from,'not_stated');
});

test('the text names the date and why, and says "at least until" for a floor',()=>{
 const pants={id:'p',brand:'CHERRY LA',product:'Wide Leg Cargo Pants',merchant:'CHERRY LA',fulfillment:{value:'in_store',quote:'In-store purchase'},return_terms:[{source_id:'r',window:{days:14},window_quote:'within 14 days',window_from:'delivery'}],
  source_events:[{kind:'purchased',at:BOUGHT,source_id:'r'}],outcome:{value:'unknown'},recipient:{value:'self'},field_provenance:{}};
 const exact=reminderItem(pants,returnDeadline(pants,'America/Los_Angeles'));
 assert.equal(reminderDraft([exact]),'heads up: for your CHERRY LA Wide Leg Cargo Pants, the return window closes saturday, oct 31 (14 days, and you bought it in store on oct 17). keeping it?');
 const shipped={...pants,fulfillment:null};
 const floor=reminderItem(shipped,returnDeadline(shipped,'America/Los_Angeles'));
 assert.match(reminderDraft([floor]),/you have at least until saturday, oct 31 to return it \(their email says 14 days from when it arrives, and you ordered oct 17\)/);
 const stated=reminderItem(item([{source_id:'order-1',return_by:'2026-10-24',return_by_quote:'Return by October 24'}]),returnDeadline(item([{source_id:'order-1',return_by:'2026-10-24',return_by_quote:'Return by October 24'}])));
 assert.match(reminderDraft([stated,floor]),/^heads up, a few return windows are closing: your SSENSE Our Legacy Jacket: the return window closes saturday, oct 24 \(going by your order email\); your CHERRY LA .*keeping them\?$/);
});

// The purchase-history row, evidence rows and message ledger, shaped as the application stores them.
function ledger(records,{data={},optedOut=false,sent=[]}={}){
 const store=storage(records,data),operations=new Map(sent.map(([k,at])=>[k,{status:'sent',conversation_id:OWNER,created_at:at}])),texts=[];
 return Object.assign(store,{operations,texts,conversation:async()=>({id:OWNER,line:'line',sender_id:'sender'}),recent:async()=>[],smsOptedOut:async()=>optedOut,
  operation:async key=>operations.get(key)??null,reserve:async(o,key,body)=>{if(operations.has(key))return false;operations.set(key,{status:'sending',body,conversation_id:o,created_at:new Date().toISOString()});return true;},
  finish:async(key,status)=>{operations.get(key).status=status;},prepareAI:async()=>{},
  unpromptedSince:async()=>[...operations].map(([operation_id,m])=>({operation_id,status:m.status,created_at:m.created_at}))});
}
const send=store=>async(target,body)=>{store.texts.push(body);return {id:'msg'};};
const compose=async({draft})=>({body:draft,composed:false});
const DUE=Date.parse('2026-10-28T19:00:00Z');// noon in Los Angeles, 3 days before Oct 31
const LA={style_report:{timezone:'America/Los_Angeles'}};

test('a due reminder goes out once, as an alert in the ledger, and is never repeated',async()=>{
 const store=ledger(storeReceipt({fulfillment:{value:'in_store',quote:'In-store purchase'}}),{data:LA});
 assert.equal((await sendReturnReminders(store,OWNER,{},{send:send(store),compose,now:Date.parse('2026-10-27T19:00:00Z')})).status,'nothing_due','4 days before: too early');
 const result=await sendReturnReminders(store,OWNER,{},{send:send(store),compose,now:DUE});
 assert.equal(result.status,'sent');assert.equal(store.texts.length,1);
 assert.match(store.texts[0],/CHERRY LA Wide Leg Cargo Pants, the return window closes saturday, oct 31/);
 assert.ok(store.operations.has(RETURN_OPERATION(OWNER,'2026-10-28')));
 const data=store.row.data;
 assert.equal(data.returns.reminded.length,1);assert.equal(openReminder(data.returns,DUE).items[0].deadline,'2026-10-31');
 assert.equal(data.returns.log.at(-1).status,'sent');
 // Next day: already reminded, no second text.
 assert.equal((await sendReturnReminders(store,OWNER,{},{send:send(store),compose,now:DUE+DAY})).status,'nothing_due');
 assert.equal(store.texts.length,1);assert.equal(store.row.data.returns.log.at(-1).reason,'already_reminded');
});

test('quiet hours hold it for tomorrow; STOP and their own off switch skip it',async()=>{
 const records=storeReceipt({fulfillment:{value:'in_store',quote:'In-store purchase'}});
 const night=ledger(records,{data:LA});
 const held=await sendReturnReminders(night,OWNER,{},{send:send(night),compose,now:Date.parse('2026-10-29T06:00:00Z')});// 11pm on Oct 28 in LA
 assert.deepEqual([held.status,held.reason,night.texts.length],['held','quiet_hours',0]);
 assert.equal((night.row.data.returns.reminded??[]).length,0,'held items stay due');
 const stopped=ledger(records,{data:LA,optedOut:true});
 assert.equal((await sendReturnReminders(stopped,OWNER,{},{send:send(stopped),compose,now:DUE})).reason,'opted_out');
 const off=ledger(records,{data:{...LA,return_reminders:{enabled:false}}});
 assert.equal((await sendReturnReminders(off,OWNER,{},{send:send(off),compose,now:DUE})).reason,'reminders_off');
 assert.equal(stopped.texts.length+off.texts.length,0);
});

test('cap interaction: a nudge sent today does not hold a reminder, and a reminder takes the day\'s nudge slot',async()=>{
 const today=new Date(DUE-3600000).toISOString();
 const store=ledger(storeReceipt({fulfillment:{value:'in_store',quote:'In-store purchase'}}),{data:LA,sent:[[`gmail:${OWNER}:purchases:2026-10-28`,today],[`gmail:${OWNER}:fit-check:2026-10-26`,today]]});
 assert.equal((await sendReturnReminders(store,OWNER,{},{send:send(store),compose,now:DUE})).status,'sent','nudge limits do not apply to reminders');
 const reminder=[{operation_id:RETURN_OPERATION(OWNER,'2026-10-28'),status:'sent',created_at:today}];
 assert.equal(nudgeDecision({sent:reminder,now:DUE,timezone:'America/Los_Angeles'}).reason,'price_alert_today');
 // A reminder never counts toward the nudge back-off or the weekly cap.
 assert.equal(nudgeDecision({sent:reminder,now:DUE+DAY,timezone:'America/Los_Angeles'}).send,true);
});

test('several items closing together share one text, at most three',async()=>{
 const lines=['Cargo Pants','Work Shirt','Field Jacket','Wool Beanie'].map((name,n)=>pantsLine({product:fact(name),evidence:name,size_label:none,fulfillment:{value:'in_store',quote:'In-store purchase'}}));
 const text=STORE_TEXT+'\n'+['Cargo Pants','Work Shirt','Field Jacket','Wool Beanie'].join('\n');
 const store=ledger(read(lines,source('receipt-1',text,BOUGHT)).records,{data:LA});
 const result=await sendReturnReminders(store,OWNER,{},{send:send(store),compose,now:DUE});
 assert.deepEqual([result.status,result.items,store.texts.length],['sent',3,1]);
 assert.match(store.texts[0],/keeping them\?$/);
 assert.equal(store.row.data.returns.log.filter(e=>e.reason==='next_text').length,1,'the fourth waits for the next text');
});

test('the daily run sends reminders before the purchase check, for everyone with history',async()=>{
 const order=[];
 await runDailyRefresh({gmailConnections:async()=>{order.push('check');return [];}},{},{reminders:async()=>{order.push('reminders');return {sent:1};},now:()=>DUE});
 assert.deepEqual(order,['reminders','check']);
});

test('their own switch turns reminders off and on, and reports status',async()=>{
 const store=storage(read([line()]).records);
 assert.match(await manageReturnReminders(store,OWNER,'turn_off'),/no more return-window reminders/);
 assert.equal(store.row.data.return_reminders.enabled,false);
 assert.match(await manageReturnReminders(store,OWNER,'status'),/off/);
 assert.match(await manageReturnReminders(store,OWNER,'turn_on'),/done/);
 assert.equal(store.row.data.return_reminders.enabled,true);
});

test('test reminders go only to the test conversation, are labelled, and never count as the real one',async()=>{
 const env={PRICE_ALERT_TEST_CONVERSATION_ID:OWNER};
 const store=ledger(read([line()]).records,{data:LA});
 await assert.rejects(sendTestReminder(store,OWNER,'x',{PRICE_ALERT_TEST_CONVERSATION_ID:'someone-else'},{send:send(store),compose}),/designated test conversation/);
 const id=projectReceiptEvidence(OWNER,store.rows).state.items[0].id;
 await assert.rejects(sendTestReminder(store,OWNER,id,env,{send:send(store),compose}),/rehearsal date/);
 const first=await sendTestReminder(store,OWNER,id,env,{rehearsal:'2026-11-02',send:send(store),compose,now:DUE});
 assert.deepEqual([first.status,first.rehearsal],['sent',true]);
 assert.ok(store.texts[0].startsWith(TEST_LABEL));assert.match(store.texts[0],/closes monday, nov 2/);
 assert.equal(store.row.data.returns.open.test,true);assert.equal((store.row.data.returns.reminded??[]).length,0);
 await sendTestReminder(store,OWNER,id,env,{rehearsal:'2026-11-02',send:send(store),compose,now:DUE});
 assert.equal(store.texts.length,2,'can be sent again');
});

// Multi-turn replies: the model reads the reply (stubbed here with what it returns for each); code applies it.
async function reply(store,text,actions){
 let seen=null;
 const interpret=async request=>{seen=request.context.state;return {actions:actions(projectReceiptEvidence(OWNER,store.rows).state.items[0].id)};};
 const result=await updatePurchaseHistory({message:{id:'m-'+text.length,content:{text}}},OWNER,Object.assign(store,{context:async()=>[{provider_id:'m-'+text.length,created_at:new Date(DUE).toISOString()}]}),{},{interpret,wait:async()=>{}});
 return {result,seen,state:projectReceiptState(projectReceiptEvidence(OWNER,store.rows).state)};
}
const act=(action,extra={})=>id=>[{item_ids:[id],action,recipient:null,recipient_label:null,fit:null,corrections:[],target_item_id:null,question_id:null,...extra}];
async function reminded(){
 const store=ledger(storeReceipt({fulfillment:{value:'in_store',quote:'In-store purchase'}}),{data:LA});
 await sendReturnReminders(store,OWNER,{},{send:send(store),compose,now:DUE});
 return store;
}

test('reply "keeping it": the reader sees the reminder, the item is kept, and no more reminders',async()=>{
 const store=await reminded();
 const {result,seen,state}=await reply(store,'yep keeping them',act('report_kept'));
 assert.equal(seen.return_reminders[0].deadline,'2026-10-31','the open reminder reaches the reader');
 assert.equal(result.updated,true);assert.equal(state.items[0].outcome.value,'kept');
 assert.equal(returnWindowCandidates(state,{now:DUE+DAY,zone:'America/Los_Angeles'})[0].reason,'kept');
});

test('reply "returning it": the item leaves the wardrobe',async()=>{
 const store=await reminded();
 const {state}=await reply(store,'sending them back',act('report_return'));
 assert.equal(state.items[0].outcome.value,'returned');
 assert.equal(returnWindowCandidates(state,{now:DUE+DAY,zone:'America/Los_Angeles'})[0].reason,'returned');
});

test('reply "too short, going back": a return plus a fit note for that brand only, never a general size',async()=>{
 const store=await reminded();
 const {state}=await reply(store,'too short so they are going back',act('report_return',{fit:'runs_small'}));
 assert.equal(state.items[0].outcome.value,'returned');assert.equal(state.items[0].fit,'runs_small');
 assert.equal(receiptLearningView(state).profile_writes,false,'the purchase history never writes the profile');
 // A reason that is not about fit adds nothing.
 const other=await reminded();
 const {state:colour}=await reply(other,'didn\'t love the colour, returning',act('report_return'));
 assert.equal(colour.items[0].fit??null,null);
});

test('reply "not sure yet": nothing recorded and no "which item" question',async()=>{
 const store=await reminded();
 const before=store.rows.length;
 const {result}=await reply(store,'not sure yet',act('defer_question'));
 assert.equal(result.updated,false);assert.match(result.body,/haven’t decided/);assert.equal(store.rows.length,before);
});

test('a fit on a return becomes its own fit report, appended so earlier actions keep their ids',()=>{
 const state=projectReceiptEvidence(OWNER,storeReceipt().map(r=>purchaseEvidence(r))).state,id=state.items[0].id;
 const out=applyReceiptAnswerPartially(state,{actions:act('report_return',{fit:'runs_large'})(id)},{id:'imessage:1',owner_id:OWNER,source:'chat_answer',at:'2026-10-28T19:00:00Z'});
 assert.deepEqual(out.state.feedback.map(e=>[e.id,e.action]),[['imessage:1:0','report_return'],['imessage:1:1','report_fit']]);
});


test('an answer whose question reference is not a waiting question is still recorded (founder\'s "Yeah I am", October 23)',()=>{
 const state=projectReceiptEvidence(OWNER,storeReceipt().map(r=>purchaseEvidence(r))).state,id=state.items[0].id;
 const out=applyReceiptAnswerPartially(state,{actions:act('report_kept',{question_id:id})(id)},{id:'imessage:2',owner_id:OWNER,source:'chat_answer',at:'2026-10-28T19:00:00Z'});
 assert.equal(out.applied,1);assert.deepEqual(out.withheld,[]);assert.equal(out.state.feedback[0].question_id,undefined);
 // A defer still needs a real question.
 const defer=applyReceiptAnswerPartially(state,{actions:act('defer_question',{question_id:'no-such-question'})(id)},{id:'imessage:3',owner_id:OWNER,source:'chat_answer',at:'2026-10-28T19:00:00Z'});
 assert.equal(defer.applied,0);
});

// ---------- Step 3: outcome rates ----------
import {reminderOutcome,returnReminderSummary,returnRemindersSummary} from '../lib/return-windows.js';
const REMINDED={item_id:'p',at:'2026-10-28T19:00:00.000Z',deadline:'2026-10-31',operation:'return-window:o:2026-10-28'};
const said=(value,at,extra={})=>({id:'p',brand:'CHERRY LA',product:'Cargo Pants',merchant:'CHERRY LA',outcome:{value},field_provenance:{outcome:{at}},source_events:[],...extra});

test('outcomes come from what was recorded after the reminder',()=>{
 const now=Date.parse('2026-11-05T12:00:00Z');
 assert.equal(reminderOutcome(REMINDED,said('kept','2026-10-28T20:00:00Z'),null,now).outcome,'kept');
 const back=reminderOutcome(REMINDED,said('returned','2026-10-29T10:00:00Z',{fit:'runs_small',field_provenance:{outcome:{at:'2026-10-29T10:00:00Z'},fit:{at:'2026-10-29T10:00:00Z'}}}),null,now);
 assert.deepEqual([back.outcome,back.in_time,back.fit],['returned',true,'runs_small']);
 assert.equal(reminderOutcome(REMINDED,said('returned','2026-11-02T10:00:00Z'),null,now).in_time,false,'after the last day');
 // A return email after the reminder counts too.
 const email=reminderOutcome(REMINDED,{...said('unknown',null),field_provenance:{},source_events:[{kind:'returned',at:Date.parse('2026-10-30T10:00:00Z')}]},null,now);
 assert.deepEqual([email.outcome,email.in_time,email.from],['returned',true,'email']);
 // Kept before the reminder is not an answer to it.
 assert.equal(reminderOutcome(REMINDED,said('kept','2026-10-20T00:00:00Z'),null,now).outcome,'no_reply');
 assert.equal(reminderOutcome(REMINDED,said('unknown',null),'2026-10-29T00:00:00Z',now).outcome,'other_reply');
 assert.equal(reminderOutcome(REMINDED,said('unknown',null),null,Date.parse('2026-10-30T00:00:00Z')).outcome,'open','still before the last day');
});

test('the summary counts real reminders per tester, leaves tests out of the rates, and says where other purchases stand',()=>{
 const now=Date.parse('2026-11-05T12:00:00Z');
 const people=[{conversation_id:'a',lastInbound:null,items:[said('kept','2026-10-28T20:00:00Z'),said('returned','2026-10-29T10:00:00Z',{id:'q'})],
  returns:{reminded:[REMINDED,{...REMINDED,item_id:'q'},{...REMINDED,item_id:'r'}],log:[{item_id:'z',status:'skip',reason:'no_terms'},{item_id:'y',status:'skip',reason:'too_early'},{item_id:'y',status:'skip',reason:'no_terms'},{item_id:'t',status:'sent',test:true}]}},
  {conversation_id:'b',items:[],lastInbound:null,returns:{log:[{item_id:'t',status:'sent',test:true}]}},
  {conversation_id:'c',items:[],lastInbound:null,returns:{log:[]}}];
 const s=returnReminderSummary(people,now);
 assert.deepEqual(s.people.map(p=>p.id),['a','b'],'nobody with nothing to show');
 const a=s.people[0];
 assert.deepEqual([a.sent,a.kept,a.returned,a.returned_in_time,a.no_reply,a.tests],[3,1,1,1,1,1]);
 assert.deepEqual(a.waiting,{no_terms:2},'each item\'s latest decision');
 assert.equal(s.people[1].tests,1);assert.equal(s.totals.sent,3);
 assert.equal(s.totals.answered_rate,2/3);
 assert.equal(s.recent.length,3);assert.equal(s.recent[0].name,'CHERRY LA Cargo Pants');
});

test('the admin read loads purchase history only for people who got a real reminder',async()=>{
 const store=await reminded(),loads=[];
 const reads=Object.assign(Object.create(store),{returnLogs:async()=>[{conversation_id:OWNER,returns:store.row.data.returns},{conversation_id:'quiet',returns:{log:[{item_id:'x',status:'skip',reason:'no_terms'}]}}],
  gmailImport:async id=>{loads.push(id);return store.gmailImport(id);},lastInbound:async()=>null});
 const s=await returnRemindersSummary(reads,{now:Date.parse('2026-11-05T12:00:00Z')});
 assert.deepEqual(loads,[OWNER]);
 assert.equal(s.totals.sent,1);assert.equal(s.recent[0].outcome,'no_reply');assert.equal(s.recent[0].merchant,'CHERRY LA');
});
