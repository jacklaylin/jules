import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceFrom,applyScreenshotReads,screenshotSourceId,ORDER_SCREENSHOT_TOOL} from '../lib/order-screenshots.js';
import {importOrderScreenshots,applyQueuedAnswers,updatePurchaseHistory} from '../lib/receipt-chat.js';
import {reconcileReceipt,emptyReceiptState,purchaseEvidence} from '../lib/receipt-extraction.js';
import {loadReceipts} from '../lib/evidence.js';
import {HISTORY_ORIGINS,SCREENSHOT_ORIGIN} from '../lib/connected-sources.js';
import {recordSource} from '../lib/purchase-review.js';
import {generateReply} from '../lib/ai.js';
import {receiveInInbox} from '../lib/inbox.js';
import {agentTurn,tool,toolNames,toolOutputs} from './helpers/agent.js';

const owner='owner',env={OPENAI_API_KEY:'test',GMAIL_IMPORT_ENABLED:'true'};
const fact=value=>({value,quote:value});
const shot=n=>({mime_type:'image/png',data:Buffer.from('screenshot'+n).toString('base64')});
// What a retailer app's order screen reads as. No prices are shown for the shirt.
const TRANSCRIPT={text:'ZARA\nMy orders\nOrder 51234\nDelivered\nOrdered on 3 Sep 2026\nWIDE-LEG JEANS\nEcru | 38\n39,95 EUR\nLINEN SHIRT\nWhite | M',order_dates:[{date:'2026-09-03',quote:'3 Sep 2026'}]};
const line=(extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Delivered'},category:'clothing',existing_item_id:null,evidence:'Order 51234',
 merchant:fact('ZARA'),order_reference:fact('51234'),product:fact('LINEN SHIRT'),sku:fact(null),brand:fact(null),color:fact('White'),size_label:fact('M'),size_system:fact(null),
 quantity:fact(null),units_per_pack:fact(null),unit_price:fact(null),currency:fact(null),recipient:{value:'unknown',quote:null},...extra});
// The same jeans as the order confirmation email already imported from Gmail.
const emailSource={id:'gmail-m1',date:Date.parse('2026-09-03T08:00:00Z'),text:'Zara order confirmation. Order number: 51234. Wide-leg jeans, colour Ecru, size 38, 39,95 EUR. Thank you for your order'};
const emailLine={kind:'purchased',basis:{value:'order_confirmation',quote:'Thank you for your order'},category:'clothing',existing_item_id:null,evidence:'Thank you for your order',
 merchant:fact('Zara'),order_reference:fact('51234'),product:fact('Wide-leg jeans'),sku:fact(null),brand:fact(null),color:fact('Ecru'),size_label:fact('38'),size_system:fact(null),
 quantity:fact(null),units_per_pack:fact(null),unit_price:fact('39,95 EUR'),currency:fact('EUR'),recipient:{value:'unknown',quote:null}};
const gmailRows=()=>reconcileReceipt(emptyReceiptState(owner),emailSource,{events:[emailLine]}).records.map(r=>purchaseEvidence(r));

// The purchase-history row and evidence as the database keeps them, with the lease and the chat queue.
function storage({row=null,rows=[]}={}){
 let busy=false;const calls={ensure:0,finish:0};
 const self={calls,
  gmailImport:async()=>row?structuredClone(row):null,
  ensureGmailImport:async o=>{calls.ensure++;row??={conversation_id:o,revision:0,data:{},token_ciphertext:null,chat_answers:[]};},
  claimGmailImport:async()=>{if(busy||!row)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,data,token,evidence=[])=>{if(revision!==row.revision)return false;calls.finish++;
   if(evidence.some(e=>!['gmail','shop','chat_screenshot'].includes(e.origin)))throw Error('evidence_origin_fkey');
   row={...row,data:structuredClone(data),token_ciphertext:token};busy=false;for(const e of evidence)if(!rows.some(r=>r.id===e.id))rows.push(structuredClone(e));return true;},
  queueHistoryAnswer:async(o,answer)=>{row.chat_answers??=[];if(row.chat_answers.some(a=>a.id===answer.id))return null;row.chat_answers.push(structuredClone(answer));return true;},
  clearHistoryAnswers:async(o,ids)=>{row.chat_answers=(row.chat_answers??[]).filter(a=>!ids.includes(a.id));},
  evidence:async(_o,origin)=>structuredClone(rows.filter(r=>!origin||[].concat(origin).includes(r.origin))),
  context:async()=>[],
  hold(){busy=true;},release(){busy=false;},get row(){return row;},get rows(){return rows;},
 };
 return self;
}
const itemsOf=async store=>(await loadReceipts(store,owner,store.row)).state.items;
// Counts model calls so a replay can show nothing was read again.
function models(events){
 const seen={transcribe:0,interpret:0,contexts:[]};
 return {seen,transcribe:async()=>{seen.transcribe++;return TRANSCRIPT;},interpret:async request=>{seen.interpret++;seen.contexts.push(request.context);return {events:events(request.context)};}};
}

test('the agent is offered the screenshot tool only when there is an image, and the tool gets that image',async()=>{
 let offered,told,got=null;
 const memory={images:[shot(1)],orderScreenshotAction:async(images,ref)=>{got={count:images.length,ref};return 'Added 2 purchases from ZARA to their purchase history from the screenshot.';}};
 const fetcher=async(_url,options)=>{
  if(!toolOutputs(options).length){offered=toolNames(options);return agentTurn(tool('add_order_screenshot'));}
  told=toolOutputs(options)[0];return agentTurn(tool('conversation_reply',{response:'got those, added 2 purchases from zara.'}));
 };
 const body=await generateReply([{direction:'inbound',status:'received',body:'[Inspiration images]'}],env,fetcher,memory);
 assert.ok(offered.includes('add_order_screenshot'));assert.deepEqual(got,{count:1,ref:null});
 assert.equal(told.status,'done');assert.match(body,/added 2 purchases/);
 let names;
 await generateReply([{direction:'inbound',status:'received',body:'my zara orders'}],env,async(_url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'hey'}));},{orderScreenshotAction:async()=>assert.fail()});
 assert.ok(!names.includes('add_order_screenshot'),'no image, no tool');
 await generateReply([{direction:'inbound',status:'received',body:'[Inspiration images]'}],env,async(_url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'hey'}));},{images:[shot(1)]});
 assert.ok(!names.includes('add_order_screenshot'),'no tool without the purchase-history feature');
 assert.equal(ORDER_SCREENSHOT_TOOL.parameters.required.join(),'image_message_id');
});

test('a transcript becomes a source dated only by one quoted full date, with the caption kept as user text',()=>{
 const source=sourceFrom('screenshot:m1:0',TRANSCRIPT,'my zara orders');
 assert.equal(source.date,Date.parse('2026-09-03T12:00:00Z'));assert.match(source.text,/Message sent with the screenshot: my zara orders$/);
 assert.equal(sourceFrom('x',{...TRANSCRIPT,order_dates:[{date:'2026-09-03',quote:'3 September'}]}).date,null,'a date quote not in the screenshot is not used');
 assert.equal(sourceFrom('x',{...TRANSCRIPT,order_dates:[{date:'2026-09-03',quote:'3 Sep 2026'},{date:'2026-08-01',quote:'Order 51234'}]}).date,null,'several orders: the date stays unknown');
 assert.equal(sourceFrom('x',{...TRANSCRIPT,order_dates:[]}).date,null);
 assert.equal(sourceFrom('x',{text:'   ',order_dates:[]}),null);
});

test('screenshot reading keeps only quoted facts: no invented price, size or non-purchase',()=>{
 const source=sourceFrom(screenshotSourceId('m1',0),TRANSCRIPT);
 const read=applyScreenshotReads(emptyReceiptState(owner),[],[{source,proposal:{events:[
  line(),
  line({product:fact('WIDE-LEG JEANS'),color:fact('Ecru'),size_label:fact('38'),unit_price:fact('39,95 EUR'),currency:fact('EUR')}),
  line({product:fact('CARGO TROUSERS'),size_label:{value:'L',quote:'size L'}}),
  line({product:fact('LINEN SHIRT'),basis:{value:'cart_or_marketing',quote:'My orders'},size_label:fact('M')}),
  line({product:fact('WIDE-LEG JEANS'),color:fact('Ecru'),size_label:fact('38'),unit_price:{value:'$49',quote:'$49'}}),
 ]}}],{model:'model:test'});
 const items=read.state.items;
 assert.equal(items.length,2,'a cart/marketing basis and an unquoted product are not purchases');
 const shirt=items.find(i=>i.product==='LINEN SHIRT'),jeans=items.find(i=>i.product==='WIDE-LEG JEANS');
 assert.equal(shirt.price,undefined,'no price shown, no price kept');assert.equal(shirt.size_label,'M');
 assert.deepEqual(jeans.price,{amount:39.95,currency:'EUR',text:'39,95 EUR'});
 assert.equal(read.notes[0].added,2);assert.equal(read.notes[0].withheld,1);assert.equal(read.notes[0].dated,true);
 assert.ok(read.evidence.every(e=>e.origin===SCREENSHOT_ORIGIN&&e.source.type==='chat_screenshot'&&e.kind==='purchase_event'));
 assert.ok(HISTORY_ORIGINS.includes(SCREENSHOT_ORIGIN));assert.equal(recordSource(source.id),'screenshot');
});

test('a screenshot of an order Gmail already found links to it instead of counting twice',async()=>{
 const store=storage({row:{conversation_id:owner,revision:0,data:{},token_ciphertext:'sealed',chat_answers:[]},rows:gmailRows()});
 const [existing]=await itemsOf(store);
 const m=models(context=>{assert.deepEqual(context.existing_items.map(i=>i.id),[existing.id],'the Gmail item is offered for linking');
  return [line({existing_item_id:existing.id,product:fact('WIDE-LEG JEANS'),color:fact('Ecru'),size_label:fact('38')}),line()];});
 const result=await importOrderScreenshots({store,owner,messageId:'m1',caption:'',images:[shot(1)],env,...m,wait:async()=>{}});
 assert.equal(result.added,1);assert.equal(result.linked,1);assert.match(result.body,/Added 1 purchase from Zara.*1 purchase was already in their history/);
 assert.match(result.user,/added 1 purchase from zara/);
 const items=await itemsOf(store);
 assert.equal(items.length,2,'jeans once, shirt new');
 assert.deepEqual(items.find(i=>i.id===existing.id).source_ids,['gmail-m1',screenshotSourceId('m1',0)]);
 assert.equal(store.row.token_ciphertext,'sealed','the Gmail sign-in is kept');
 assert.equal(store.rows.filter(r=>r.origin==='chat_screenshot').length,2);
});

test('a replayed message imports once, and a person without an email import gets a history row',async()=>{
 const store=storage(),m=models(()=>[line()]);
 const first=await importOrderScreenshots({store,owner,messageId:'m1',images:[shot(1)],env,...m,wait:async()=>{}});
 assert.equal(store.calls.ensure,1);assert.equal(first.added,1);
 const replay=await importOrderScreenshots({store,owner,messageId:'m1',images:[shot(1)],env,...m,wait:async()=>{}});
 assert.equal(replay.replayed,true);assert.equal(replay.body,first.body);
 assert.deepEqual([m.seen.transcribe,m.seen.interpret],[1,1],'nothing is read again');
 assert.equal((await itemsOf(store)).length,1);assert.equal(store.rows.length,1);
 const again=await importOrderScreenshots({store,owner,messageId:'m2',images:[shot(1)],env,...m,wait:async()=>{}});
 assert.equal(again.added,0);assert.equal(again.linked,1,'the same order in a new screenshot links to the first');
 assert.equal((await itemsOf(store)).length,1);
});

test('while an import holds the history, the screenshot is queued and applied once by the next holder',async()=>{
 const store=storage({row:{conversation_id:owner,revision:0,data:{},token_ciphertext:null,chat_answers:[]},rows:gmailRows()});
 store.hold();
 const m=models(()=>[line()]);
 const queued=await importOrderScreenshots({store,owner,messageId:'m1',images:[shot(1)],env,...m,wait:async()=>{}});
 assert.equal(queued.queued,true);assert.equal(store.row.chat_answers.length,1);assert.equal(store.row.chat_answers[0].kind,'order_screenshot');
 assert.equal((await importOrderScreenshots({store,owner,messageId:'m1',images:[shot(1)],env,...m,wait:async()=>{}})).queued,true,'a replay while queued does not read again');
 assert.equal(m.seen.transcribe,1);
 // The worker (lib/gmail-worker.js) applies queued entries the same way.
 const receipts=await loadReceipts(store,owner,store.row);
 const applied=applyQueuedAnswers(receipts.state,store.row.chat_answers,owner,store.row.data);
 assert.equal(applied.notes[0].added,1);assert.equal(applied.applied,0,'a screenshot is not a question answer');
 assert.equal(applyQueuedAnswers(receipts.state,store.row.chat_answers,owner,{screenshots:applied.notes}).evidence.length,0,'already noted: skipped');
 // A chat answer that gets the lease applies the waiting screenshot first.
 store.release();
 const [jeans]=await itemsOf(store);
 const answer=await updatePurchaseHistory({message:{id:'p2',content:{text:'the jeans were a gift'}}},owner,store,env,{
  interpret:async()=>({actions:[{item_ids:[jeans.id],action:'set_recipient',recipient:'other',recipient_label:null,corrections:[],target_item_id:null,question_id:null}]}),wait:async()=>{}}).catch(error=>({error}));
 assert.ok(!answer.error,String(answer.error));assert.equal(answer.updated,true);
 assert.equal(store.row.chat_answers.length,0);assert.equal(store.row.data.screenshots.length,1);
 assert.equal((await itemsOf(store)).length,2);
});

test('an unreadable screenshot or a failed save adds nothing and says so',async()=>{
 const store=storage();
 const failing=await importOrderScreenshots({store,owner,messageId:'m1',images:[shot(1)],env,transcribe:async()=>{throw Error('down');},interpret:async()=>assert.fail(),wait:async()=>{}});
 assert.equal(failing.failure,'screenshot_read');assert.equal(store.row,null,'nothing written');
 const empty=await importOrderScreenshots({store,owner,messageId:'m2',images:[shot(1)],env,...models(()=>[]),wait:async()=>{}});
 assert.equal(empty.added,0);assert.match(empty.body,/nothing was added/);
 const conflict=storage();conflict.finishGmailImport=async()=>{throw Error('evidence_origin_fkey');};
 await conflict.ensureGmailImport(owner);
 const unsaved=await importOrderScreenshots({store:conflict,owner,messageId:'m3',images:[shot(1)],env,...models(()=>[line()]),wait:async()=>{}});
 assert.equal(unsaved.failure,'screenshot_write');
});

test('in the inbox, the screenshot tool reads the image in the newest message, keyed by that message',async()=>{
 const rows=[],calls=[];
 const store={receive:async()=>'conversation',claimAI:async(_c,op)=>{rows.push({operation_id:op,status:'generating'});return true;},
  saveImages:async()=>{},claimGmailImport:async()=>null,
  context:async()=>[{id:'internal-1',direction:'inbound',provider_id:'p1',body:'here are my zara orders',status:'received',message_images:[{id:'img',position:0}]}],
  prepareAI:async(op,body,source)=>Object.assign(rows.find(r=>r.operation_id===op),{body,source,status:'sending'}),finish:async(op,status)=>{rows.find(r=>r.operation_id===op).status=status;},
  searchResult:async()=>{},replyDiagnostics:async()=>{}};
 const delivery={space:{phone:'line'},message:{id:'p1',sender:{id:'tester'},content:{type:'text',text:'here are my zara orders'},attachments:[{id:'a1'}]}};
 const generate=async(_m,_e,_f,memory)=>{assert.ok(memory.orderScreenshotAction);return memory.orderScreenshotAction(memory.images,null);};
 const screenshotImport=async args=>{calls.push({messageId:args.messageId,caption:args.caption,images:args.images.length});return {body:'Added 2 purchases from Zara to their purchase history from the screenshot.',user:'got those. added 2 purchases from zara to your history.',added:2,linked:0};};
 const sent=[];
 await receiveInInbox(delivery,{AI_ENABLED:'true',OPENAI_API_KEY:'fake',GMAIL_IMPORT_ENABLED:'true'},{store,send:async(_d,body)=>{sent.push(body);return {id:'s1'};},generate,screenshotImport,
  loadImages:async()=>[shot(1)],progress:async()=>async()=>{},writeFollowup:async()=>null});
 assert.deepEqual(calls,[{messageId:'internal-1',caption:'here are my zara orders',images:1}]);
 assert.equal(rows[0].status,'sent');assert.match(sent.join('\n'),/2 purchases/i);
});
