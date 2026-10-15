import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceFrom,ordersFrom,applyScreenshotRead,screenshotSourceId,screenshotReads,screenshotReport,ORDER_SCREENSHOT_TOOL} from '../lib/order-screenshots.js';
import {importOrderScreenshots,applyQueuedAnswers,updatePurchaseHistory} from '../lib/receipt-chat.js';
import {reconcileReceipt,emptyReceiptState,purchaseEvidence} from '../lib/receipt-extraction.js';
import {loadReceipts,purchaseSummary,storeOrders} from '../lib/evidence.js';
import {HISTORY_ORIGINS,SCREENSHOT_ORIGIN} from '../lib/connected-sources.js';
import {recordSource} from '../lib/purchase-review.js';
import {generateReply} from '../lib/ai.js';
import {receiveInInbox} from '../lib/inbox.js';
import {agentTurn,tool,toolNames,toolOutputs,agentContext} from './helpers/agent.js';

const owner='owner',env={OPENAI_API_KEY:'test',GMAIL_IMPORT_ENABLED:'true'};
const fact=value=>({value,quote:value}),none={value:null,quote:null};
const shot=n=>({mime_type:'image/png',data:Buffer.from('screenshot'+n).toString('base64')});
// A retailer app's order details screen. No price is shown for the shirt.
const DETAIL={text:'ZARA\nORDER DETAILS\nOrder 51234\nDelivered\nOrdered on 3 Sep 2026\nWIDE-LEG JEANS\nEcru | 38\n39,95 EUR\nLINEN SHIRT\nWhite | M',retailer:fact('ZARA'),
 orders:[{kind:'order',status:fact('Delivered'),reference:fact('51234'),date:{value:'2026-09-03',quote:'3 Sep 2026'},total:none}]};
// The SSENSE order list and returns list as read in production on October 15: no store name, no items.
const LIST={text:'ORDER HISTORY\nORDERS RETURNS\nSHIPPED\nJune 17, 2026 9:23 PM\n$414.50 USD\n#28788495082242\nSHIPPED\nJune 1, 2026 2:52 PM\n$1116.83 USD\n#86340723664099',retailer:none,orders:[
 {kind:'order',status:fact('SHIPPED'),reference:fact('#28788495082242'),date:{value:'2026-06-17',quote:'June 17, 2026'},total:fact('$414.50 USD')},
 {kind:'order',status:fact('SHIPPED'),reference:fact('#86340723664099'),date:{value:'2026-06-01',quote:'June 1, 2026'},total:fact('$1116.83 USD')}]};
const RETURNS={text:'ORDER HISTORY\nRETURN PROCESSED\nJanuary 2, 2026 12:41 PM\nRMA00704529\n$-293.96 USD',retailer:none,orders:[
 {kind:'return',status:fact('RETURN PROCESSED'),reference:fact('RMA00704529'),date:{value:'2026-01-02',quote:'January 2, 2026'},total:fact('$-293.96 USD')}]};
// An order details page cut off after the first item, then the scrolled rest.
const TOP={text:'ORDER DETAILS\nSHIPPED\n#28788495082242\nPlaced on June 17, 2026 6:23 PM\nITEMS 02 DESCRIPTION PRICE\nOAKLEY $176.00\nBlue Eye Jacket Redux\nSunglasses',retailer:none,
 orders:[{kind:'order',status:fact('SHIPPED'),reference:fact('#28788495082242'),date:{value:'2026-06-17',quote:'June 17, 2026'},total:none}]};
const BOTTOM={text:'OUR LEGACY $395.00\nBorrowed Shirt\nWhite\nSize 48',retailer:none,orders:[]};
const line=(extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Delivered'},category:'clothing',existing_item_id:null,evidence:'Order 51234',
 merchant:fact('ZARA'),order_reference:fact('51234'),product:fact('LINEN SHIRT'),sku:fact(null),brand:fact(null),color:fact('White'),size_label:fact('M'),size_system:fact(null),
 quantity:fact(null),units_per_pack:fact(null),unit_price:fact(null),currency:fact(null),recipient:{value:'unknown',quote:null},...extra});
const ssense=(extra={})=>line({basis:{value:'order_confirmation',quote:'Placed on June 17, 2026'},evidence:'#28788495082242',merchant:none,order_reference:fact('#28788495082242'),
 product:fact('Blue Eye Jacket Redux'),brand:fact('OAKLEY'),color:none,size_label:none,category:'eyewear',...extra});
// The same jeans as the order confirmation email already imported from Gmail.
const emailSource={id:'gmail-m1',date:Date.parse('2026-09-03T08:00:00Z'),text:'Zara order confirmation. Order number: 51234. Wide-leg jeans, colour Ecru, size 38, 39,95 EUR. Thank you for your order'};
const emailLine={...line({basis:{value:'order_confirmation',quote:'Thank you for your order'},evidence:'Thank you for your order',merchant:fact('Zara'),product:fact('Wide-leg jeans'),color:fact('Ecru'),size_label:fact('38'),unit_price:fact('39,95 EUR'),currency:fact('EUR')})};
const gmailRows=()=>reconcileReceipt(emptyReceiptState(owner),emailSource,{events:[emailLine]}).records.map(r=>purchaseEvidence(r));

// The purchase-history row and evidence as the database keeps them, with the lease and the chat queue.
function storage({row=null,rows=[]}={}){
 let busy=false;const calls={ensure:0,deleted:[]};
 const self={calls,
  gmailImport:async()=>row?structuredClone(row):null,
  ensureGmailImport:async o=>{calls.ensure++;row??={conversation_id:o,revision:0,data:{},token_ciphertext:null,chat_answers:[]};},
  claimGmailImport:async()=>{if(busy||!row)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,data,token,evidence=[])=>{if(revision!==row.revision)return false;
   if(evidence.some(e=>!['gmail','shop','chat_screenshot'].includes(e.origin)))throw Error('evidence_origin_fkey');
   row={...row,data:structuredClone(data),token_ciphertext:token};busy=false;for(const e of evidence)if(!rows.some(r=>r.id===e.id))rows.push(structuredClone(e));return true;},
  deleteEvidence:async(o,origin,sourceId)=>{assert.ok(sourceId,'never the whole origin');calls.deleted.push(sourceId);rows=rows.filter(r=>!(r.origin===origin&&r.source.id===sourceId));},
  queueHistoryAnswer:async(o,answer)=>{row.chat_answers??=[];if(row.chat_answers.some(a=>a.id===answer.id))return null;row.chat_answers.push(structuredClone(answer));return true;},
  clearHistoryAnswers:async(o,ids)=>{row.chat_answers=(row.chat_answers??[]).filter(a=>!ids.includes(a.id));},
  evidence:async(_o,origin)=>structuredClone(rows.filter(r=>!origin||[].concat(origin).includes(r.origin))),
  context:async()=>[],
  hold(){busy=true;},release(){busy=false;},get row(){return row;},get rows(){return rows;},
 };
 return self;
}
const receiptsOf=store=>loadReceipts(store,owner,store.row);
const itemsOf=async store=>(await receiptsOf(store)).state.items;
// Model stubs: each image's transcript in order, and the receipt reader's events for the combined text.
function models(transcripts,events){
 const seen={transcribe:0,interpret:0,contexts:[]};let n=0;
 return {seen,transcribe:async()=>{seen.transcribe++;return transcripts[n++%transcripts.length];},interpret:async request=>{seen.interpret++;seen.contexts.push(request.context);return {events:events(request.context)};}};
}
const run=(store,ids,m,extra={})=>importOrderScreenshots({store,owner,messageIds:ids,images:ids.map((_,i)=>shot(i)),env,...m,wait:async()=>{},...extra});

test('the agent is offered the screenshot tool only with images, and its result line always reaches the user',async()=>{
 let offered,got=null,context;
 const memory={images:[shot(1)],recentImageMessages:[{id:'m0',caption:'',created_at:'t0'}],orderScreenshotAction:async(ids,store)=>{got={ids,store};return {body:'Added 2 purchases from ZARA to their purchase history from the screenshot.',user:'got those. added 2 purchases from zara to your history.'};}};
 const fetcher=async(_url,options)=>{
  if(!toolOutputs(options).length){offered=toolNames(options);context=agentContext(options);return agentTurn(tool('add_order_screenshot',{image_message_ids:['m0'],store_named_by_user:'Zara'}));}
  assert.match(toolOutputs(options)[0].result,/already sent to the user/);
  // The model answers something else and leaves the screenshot out: the line is still sent.
  return agentTurn(tool('conversation_reply',{response:'for the romi glasses, want me to look for the best price again?'}));
 };
 const body=await generateReply([{direction:'inbound',status:'received',body:'[Inspiration images]'}],env,fetcher,memory);
 assert.ok(offered.includes('add_order_screenshot'));assert.deepEqual(got,{ids:['m0'],store:'Zara'});
 assert.deepEqual(context.recent_image_messages,[{id:'m0',caption:'',created_at:'t0'}]);
 assert.equal(body,'got those. added 2 purchases from zara to your history.\n\nfor the romi glasses, want me to look for the best price again?');
 let names;
 await generateReply([{direction:'inbound',status:'received',body:'my zara orders'}],env,async(_url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'hey'}));},{orderScreenshotAction:async()=>assert.fail()});
 assert.ok(!names.includes('add_order_screenshot'),'no image, no tool');
 await generateReply([{direction:'inbound',status:'received',body:'[Inspiration images]'}],env,async(_url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'hey'}));},{images:[shot(1)]});
 assert.ok(!names.includes('add_order_screenshot'),'no tool without the purchase-history feature');
 assert.deepEqual(ORDER_SCREENSHOT_TOOL.parameters.required,['image_message_ids','store_named_by_user']);
});

test('if the model fails after the screenshot was read, the result line is still the reply',async()=>{
 let calls=0;
 const body=await generateReply([{direction:'inbound',status:'received',body:'[Inspiration images]'}],env,async()=>{if(calls++)return {ok:false,status:500,json:async()=>({})};return agentTurn(tool('add_order_screenshot'));},
  {images:[shot(1)],orderScreenshotAction:async()=>({body:'Added 1 purchase.',user:'got those. added 1 purchase from ssense to your history.'})});
 assert.equal(body,'got those. added 1 purchase from ssense to your history.');
});

test('transcripts become one source; dates and order rows are kept only when quoted',()=>{
 const source=sourceFrom(screenshotSourceId(['m1','m2']),[TOP,BOTTOM],{caption:'my order',store:'SSENSE'});
 assert.equal(source.id,'screenshot:m1+m2');assert.match(source.text,/Sunglasses\n--- next screenshot ---\nOUR LEGACY/);
 assert.match(source.text,/Message sent with the screenshot: my order\nStore named by the user: SSENSE$/);
 assert.equal(source.date,Date.parse('2026-06-17T12:00:00Z'));
 assert.equal(sourceFrom('x',[LIST]).date,null,'several orders: the purchase date stays unknown');
 assert.equal(sourceFrom('x',[{...DETAIL,orders:[{...DETAIL.orders[0],date:{value:'2026-09-03',quote:'3 September'}}]}]).date,null,'an unquoted date is not used');
 assert.equal(sourceFrom('x',[{text:'  '}]),null);
 const orders=ordersFrom([LIST,{...RETURNS,orders:[...RETURNS.orders,{kind:'order',status:none,reference:fact('#999'),date:none,total:fact('$5')}]}],sourceFrom('s',[LIST,RETURNS]));
 assert.deepEqual(orders.map(o=>[o.kind,o.reference,o.merchant,o.total?.amount??null,o.at&&new Date(o.at).toISOString().slice(0,10)]),
  [['order','#28788495082242',null,414.5,'2026-06-17'],['order','#86340723664099',null,1116.83,'2026-06-01'],['return','RMA00704529',null,293.96,'2026-01-02']],'a reference not in the screenshot is dropped');
 assert.equal(ordersFrom([LIST],sourceFrom('s',[LIST],{store:'SSENSE'}),{store:'SSENSE'})[0].merchant,'SSENSE');
 assert.equal(ordersFrom([DETAIL],sourceFrom('s',[DETAIL]))[0].merchant,'ZARA','the store written in the screenshot');
});

test('lines the reader marks personal (name, address, card) never reach the kept text',()=>{
 const source=sourceFrom('s',[{lines:[{text:'ORDER DETAILS',personal:false},{text:'Jane Example',personal:true},{text:'1 Example Street',personal:true},{text:'$414.50 USD',personal:false},{text:'VISA •••• 0000',personal:true}],retailer:none,orders:[]}]);
 assert.equal(source.text,'ORDER DETAILS\n$414.50 USD');
});

test('screenshot reading keeps only quoted facts: no invented price, size or non-purchase',()=>{
 const source=sourceFrom(screenshotSourceId(['m1']),[DETAIL]);
 const read=applyScreenshotRead(emptyReceiptState(owner),[],{source,messages:['m1'],orders:ordersFrom([DETAIL],source),proposal:{events:[
  line(),
  line({product:fact('WIDE-LEG JEANS'),color:fact('Ecru'),size_label:fact('38'),unit_price:fact('39,95 EUR'),currency:fact('EUR')}),
  line({product:fact('CARGO TROUSERS'),size_label:{value:'L',quote:'size L'}}),
  line({product:fact('LINEN SHIRT'),basis:{value:'cart_or_marketing',quote:'ORDER DETAILS'}}),
  line({product:fact('WIDE-LEG JEANS'),color:fact('Ecru'),size_label:fact('38'),unit_price:{value:'$49',quote:'$49'}}),
 ]}},{model:'model:test'});
 const items=read.state.items;
 assert.equal(items.length,2,'a cart/marketing basis and an unquoted product are not purchases');
 const shirt=items.find(i=>i.product==='LINEN SHIRT'),jeans=items.find(i=>i.product==='WIDE-LEG JEANS');
 assert.equal(shirt.price,undefined,'no price shown, no price kept');assert.equal(shirt.size_label,'M');
 assert.deepEqual(jeans.price,{amount:39.95,currency:'EUR',text:'39,95 EUR'});
 assert.equal(read.note.added,2);assert.equal(read.note.withheld,1);assert.equal(read.note.orders,0,'the order is counted by its items');assert.equal(read.note.dated,true);
 assert.ok(read.evidence.every(e=>e.origin===SCREENSHOT_ORIGIN&&e.source.type==='chat_screenshot'));
 assert.deepEqual([...new Set(read.evidence.map(e=>e.kind))],['purchase_event','order_summary']);
 assert.ok(HISTORY_ORIGINS.includes(SCREENSHOT_ORIGIN));assert.equal(recordSource(source.id),'screenshot');
});

test('a screenshot of an order Gmail already found links to it instead of counting twice',async()=>{
 const store=storage({row:{conversation_id:owner,revision:0,data:{},token_ciphertext:'sealed',chat_answers:[]},rows:gmailRows()});
 const [existing]=await itemsOf(store);
 const m=models([DETAIL],context=>{assert.deepEqual(context.existing_items.map(i=>i.id),[existing.id],'the Gmail item is offered for linking');
  return [line({existing_item_id:existing.id,product:fact('WIDE-LEG JEANS'),color:fact('Ecru'),size_label:fact('38')}),line()];});
 const result=await run(store,['m1'],m);
 assert.equal(result.added,1);assert.equal(result.linked,1);
 assert.match(result.user,/^got those\. added 1 purchase from zara to your history\. 1 was already there\.$/);
 const items=await itemsOf(store);
 assert.equal(items.length,2,'jeans once, shirt new');
 assert.deepEqual(items.find(i=>i.id===existing.id).source_ids,['gmail-m1','screenshot:m1']);
 assert.equal(store.row.token_ciphertext,'sealed','the Gmail sign-in is kept');
 const after=await receiptsOf(store);
 assert.equal(storeOrders(after.state,after.orders)[0].orders,1,'the Gmail order and the screenshot row are one order');
});

test('an order list without a store name asks which store, and the answer re-reads the same screenshots',async()=>{
 const store=storage();
 const first=await run(store,['m1','m2'],models([LIST,RETURNS],()=>[]));
 assert.match(first.user,/which store/);assert.match(first.body,/store_named_by_user/);
 assert.equal(store.rows.length,0,'no store, no order rows');
 const named=await run(store,['m1','m2'],models([LIST,RETURNS],()=>[]),{storeName:'SSENSE'});
 assert.match(named.user,/added 2 orders and 1 return from ssense/);
 const {state,orders}=await receiptsOf(store);
 assert.deepEqual(storeOrders(state,orders),[{store:'SSENSE',orders:2,returns:1,first_order:'2026-01-02',last_order:'2026-06-17',order_totals:[{currency:'USD',orders:2,median:765.67,max:1116.83}]}]);
 assert.equal(store.row.data.screenshots.length,1,'the read without a store was replaced');
 assert.deepEqual(store.row.data.history_summary.store_orders.map(s=>s.store),['SSENSE'],'the agent sees store frequency and spend');
 const again=await run(store,['m1','m2'],models([LIST,RETURNS],()=>assert.fail()),{storeName:'ssense'});
 assert.equal(again.replayed,true,'same screenshots, same store: a replay');
});

test('the store the user named fills an item whose store the reader left unquoted',async()=>{
 const store=storage();
 const result=await run(store,['m1'],models([TOP],()=>[ssense({merchant:{value:'SSENSE',quote:null}})]),{storeName:'SSENSE'});
 assert.equal(result.added,1);assert.doesNotMatch(result.user,/which store/);
 assert.equal((await itemsOf(store))[0].merchant,'SSENSE');
});

test('an order cut across two screenshots is read as one: the second item keeps the order of the first',async()=>{
 const store=storage();
 // The first screenshot arrives alone; its item has no store yet.
 const alone=await run(store,['m1'],models([TOP],()=>[ssense()]));
 assert.match(alone.user,/which store/);assert.equal((await itemsOf(store)).length,0);
 // The next message: the agent reads both together, with the store the user named.
 const both=models([TOP,BOTTOM],context=>{assert.match(context.source.text,/--- next screenshot ---/);
  return [ssense({merchant:fact('SSENSE')}),ssense({merchant:fact('SSENSE'),product:fact('Borrowed Shirt'),brand:fact('OUR LEGACY'),color:fact('White'),size_label:fact('48'),category:'clothing',unit_price:fact('$395.00'),currency:{value:'$',quote:'$395.00'}})];});
 const result=await run(store,['m1','m2'],both,{storeName:'SSENSE'});
 assert.equal(result.added,2);assert.match(result.user,/added 2 purchases from ssense/);
 const items=await itemsOf(store);
 assert.deepEqual(items.map(i=>[i.brand,i.product,i.order_reference]),[['OAKLEY','Blue Eye Jacket Redux','#28788495082242'],['OUR LEGACY','Borrowed Shirt','#28788495082242']]);
 assert.deepEqual(store.calls.deleted,['screenshot:m1'],'the earlier single read is replaced');
 assert.equal((await receiptsOf(store)).pending.length,0,'no orphaned event from the first read');
 assert.deepEqual(store.row.data.screenshots.map(n=>n.id),['screenshot:m1+m2']);
 // A slower delivery of the first message alone arrives after: it is covered, nothing is read.
 assert.equal((await run(store,['m1'],models([TOP],()=>assert.fail()))).replayed,true);
});

test('a replayed message imports once, and a person without an email import gets a history row',async()=>{
 const store=storage(),m=models([DETAIL],()=>[line()]);
 const first=await run(store,['m1'],m);
 assert.equal(store.calls.ensure,1);assert.equal(first.added,1);
 const replay=await run(store,['m1'],m);
 assert.equal(replay.replayed,true);assert.equal(replay.user,first.user);
 assert.deepEqual([m.seen.transcribe,m.seen.interpret],[1,1],'nothing is read again');
 assert.equal((await itemsOf(store)).length,1);
 const again=await run(store,['m2'],m);
 assert.equal(again.added,0);assert.equal(again.linked,1,'the same order in a new screenshot links to the first');
 assert.equal((await itemsOf(store)).length,1);
});

test('notes written before combined reads still count as recorded',()=>{
 const data={screenshots:[{id:'screenshot:m1:0',added:0,linked:0,merchants:[]}]};
 assert.ok(screenshotReads(data,['m1']).recorded);
 assert.deepEqual(screenshotReads(data,['m1'],'SSENSE').replaced.map(n=>n.id),['screenshot:m1:0'],'naming the store replaces the old read');
 assert.match(screenshotReport({}).user,/couldn’t read any orders/);
});

test('while an import holds the history, the screenshot is queued and applied once by the next holder',async()=>{
 const store=storage({row:{conversation_id:owner,revision:0,data:{},token_ciphertext:null,chat_answers:[]},rows:gmailRows()});
 store.hold();
 const m=models([DETAIL],()=>[line()]);
 const queued=await run(store,['m1'],m);
 assert.equal(queued.queued,true);assert.match(queued.user,/as soon as/);assert.equal(store.row.chat_answers[0].kind,'order_screenshot');
 assert.equal((await run(store,['m1'],m)).queued,true,'a replay while queued does not read again');
 assert.equal(m.seen.transcribe,1);
 // The worker (lib/gmail-worker.js) applies queued entries the same way.
 const receipts=await receiptsOf(store);
 const applied=applyQueuedAnswers(receipts.state,store.row.chat_answers,owner,store.row.data);
 assert.equal(applied.notes[0].added,1);assert.equal(applied.applied,0,'a screenshot is not a question answer');
 assert.equal(applyQueuedAnswers(receipts.state,store.row.chat_answers,owner,{screenshots:applied.notes}).evidence.length,0,'already noted: skipped');
 // A chat answer that gets the lease applies the waiting screenshot first.
 store.release();
 const [jeans]=await itemsOf(store);
 const answer=await updatePurchaseHistory({message:{id:'p2',content:{text:'the jeans were a gift'}}},owner,store,env,{
  interpret:async()=>({actions:[{item_ids:[jeans.id],action:'set_recipient',recipient:'other',recipient_label:null,corrections:[],target_item_id:null,question_id:null}]}),wait:async()=>{}});
 assert.equal(answer.updated,true);
 assert.equal(store.row.chat_answers.length,0);assert.equal(store.row.data.screenshots.length,1);
 assert.equal((await itemsOf(store)).length,2);
});

test('an unreadable screenshot or a failed save adds nothing and says so',async()=>{
 const store=storage();
 const failing=await run(store,['m1'],{transcribe:async()=>{throw Error('down');},interpret:async()=>assert.fail()});
 assert.equal(failing.failure,'screenshot_read');assert.ok(failing.user);assert.equal(store.row,null,'nothing written');
 const empty=await run(store,['m2'],models([{text:'Settings\nNotifications',retailer:none,orders:[]}],()=>[]));
 assert.equal(empty.added,0);assert.match(empty.body,/nothing was added/);assert.ok(empty.user);
 const conflict=storage();conflict.finishGmailImport=async()=>{throw Error('evidence_kind_check');};
 await conflict.ensureGmailImport(owner);
 const unsaved=await run(conflict,['m3'],models([DETAIL],()=>[line()]));
 assert.equal(unsaved.failure,'screenshot_write');assert.ok(unsaved.user);
});

test('store orders count an order seen in email and in a list once, and never convert currencies',()=>{
 const state=reconcileReceipt(emptyReceiptState(owner),emailSource,{events:[emailLine]}).state;
 const orders=[{kind:'order',merchant:'ZARA',reference:'#51234',at:Date.parse('2026-09-03'),total:{amount:59.9,currency:'EUR'}},{kind:'order',merchant:'Zara',reference:'60001',at:Date.parse('2026-10-01'),total:{amount:30,currency:'GBP'}},{kind:'order',merchant:null,reference:'x'}];
 const [zara]=storeOrders(state,orders);
 assert.equal(zara.orders,2);assert.deepEqual(zara.order_totals,[{currency:'GBP',orders:1,median:30,max:30}],'the email order total is not double counted');
 assert.equal(purchaseSummary(state,Date.now(),orders).store_orders[0].store,'Zara');
});

test('in the inbox, the tool reads the screenshots it is given, oldest first, keyed by their messages',async()=>{
 const rows=[],calls=[];
 const context=[{id:'internal-0',direction:'inbound',provider_id:'p0',body:'[Inspiration images]',created_at:'2026-10-15T18:02:00Z',message_images:[{id:'i0',position:0}]},
  {id:'internal-1',direction:'inbound',provider_id:'p1',body:'my ssense order, rest of it',created_at:'2026-10-15T18:03:00Z',message_images:[{id:'i1',position:0}]}];
 const store={receive:async()=>'conversation',claimAI:async(_c,op)=>{rows.push({operation_id:op,status:'generating'});return true;},
  saveImages:async()=>{},claimGmailImport:async()=>null,imagesForMessage:async id=>id==='internal-0'?[shot(0)]:assert.fail(),context:async()=>context,
  prepareAI:async(op,body,source)=>Object.assign(rows.find(r=>r.operation_id===op),{body,source,status:'sending'}),finish:async(op,status)=>{rows.find(r=>r.operation_id===op).status=status;},
  searchResult:async()=>{},replyDiagnostics:async()=>{}};
 const delivery={space:{phone:'line'},message:{id:'p1',sender:{id:'tester'},content:{type:'text',text:'my ssense order, rest of it'},attachments:[{id:'a1'}]}};
 const generate=async(_m,_e,_f,memory)=>{
  assert.deepEqual(memory.recentImageMessages.map(m=>m.id),['internal-0','internal-1']);assert.equal(memory.recentImageMessages[0].caption,'');
  const result=await memory.orderScreenshotAction(['internal-1','internal-0'],'SSENSE');return result.user;};
 const screenshotImport=async args=>{calls.push({messageIds:args.messageIds,storeName:args.storeName,caption:args.caption,images:args.images.map(i=>i.data)});return {body:'Added 2 purchases.',user:'got those. added 2 purchases from ssense to your history.',added:2,linked:0};};
 const sent=[];
 await receiveInInbox(delivery,{AI_ENABLED:'true',OPENAI_API_KEY:'fake',GMAIL_IMPORT_ENABLED:'true'},{store,send:async(_d,body)=>{sent.push(body);return {id:'s1'};},generate,screenshotImport,
  loadImages:async()=>[shot(1)],progress:async()=>async()=>{},writeFollowup:async()=>null});
 assert.deepEqual(calls,[{messageIds:['internal-0','internal-1'],storeName:'SSENSE',caption:'my ssense order, rest of it',images:[shot(0).data,shot(1).data]}]);
 assert.equal(rows[0].status,'sent');assert.match(sent.join('\n'),/2 purchases/);
});
