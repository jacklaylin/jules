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
 // Shipped but no delivery email: never "shipped plus a few days".
 assert.deepEqual(returnDeadline(item([fromDelivery],{shipped:[2]})),{deadline:null,reason:'no_delivered_date'});
 // A Shop order or screenshot does not date a parcel.
 assert.equal(returnDeadline(item([fromDelivery],{delivered:[5,'shop:abc']})).deadline,null);
 const fromOrder={source_id:'order-1',window:{days:14},window_quote:'14 days from your order date',window_from:'order'};
 assert.equal(returnDeadline(item([fromOrder])).deadline,'2026-10-15');
 assert.deepEqual(returnDeadline(item([{source_id:'order-1',window:{days:30},window_quote:'30 days',window_from:'not_stated'}])),{deadline:null,reason:'window_start_not_stated'});
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
