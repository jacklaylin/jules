import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {GMAIL_SCOPE,sealToken,openToken,authorizationURL,digest} from '../lib/gmail-client.js';
import {receiptHTML,prepareReceiptEmail,receiptPDF,triageCandidate} from '../lib/receipt-email.js';
import {receiptModel,RECEIPT_SCHEMA,TRIAGE_SCHEMA,merchantKey,reconcileReceipt,emptyReceiptState,projectReceiptState,relinkPending,receiptShoppingFacts} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback,receiptLearningView} from '../lib/receipt-feedback.js';
import {newImportJob,importStep,createGmailHandler,publicImport,CONSENT_VERSION,SCAN_VERSION,PRICE_VERSION,PHOTO_VERSION} from '../lib/gmail-import.js';
import {loadReceipts} from '../lib/evidence.js';
const env={GMAIL_IMPORT_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'synthetic-client',GOOGLE_GMAIL_CLIENT_SECRET:'synthetic-secret',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const tokens={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000};
const text='Shop Order O1 Jeans Blue 31 Brand quantity 1 purchased';
const source={id:'m1',text,date:1000,fingerprint:'synthetic'};
const fact=value=>({value,quote:value});
// Events carry the transaction basis and category the model classifies; by default the basis
// quote is the event's own evidence text.
const withBasis=e=>({basis:{value:e.kind==='purchased'?'order_confirmation':e.kind==='shipped'?'shipping_notice':'return_or_refund_notice',quote:e.evidence},category:'clothing',...e});
const receipt=(extra={})=>withBasis({kind:'purchased',existing_item_id:null,evidence:'purchased',merchant:fact('Shop'),order_reference:fact('O1'),product:fact('Jeans'),sku:fact(null),brand:fact('Brand'),color:fact('Blue'),size_label:fact('31'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),...extra});
const jsonResponse=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
function storage(){let row=null,nonce=null,busy=false,rows=[];const self={
 onboardingSession:async()=>({state:'accepted'}),wishlistMember:async email=>email==='tester@example.test'?{conversation_id:'owner'}:null,
 gmailImport:async()=>row?structuredClone(row):null,
 beginGmailOAuth:async(owner,hash)=>{row??={conversation_id:owner,revision:0,data:{},token_ciphertext:null};nonce=hash;return true;},
 consumeGmailOAuth:async hash=>{if(hash!==nonce)return null;nonce=null;return row.conversation_id;},
 claimGmailImport:async()=>{if(busy||!row)return null;busy=true;row.revision++;return structuredClone(row);},
 finishGmailImport:async(owner,revision,data,token,evidence=[],clear=false)=>{if(owner!==row.conversation_id||revision!==row.revision)return false;row.data=structuredClone(data);row.token_ciphertext=token;busy=false;
  if(clear)rows=rows.filter(r=>r.origin!=='gmail');for(const e of evidence)if(!rows.some(r=>r.id===e.id))rows.push(structuredClone(e));return true;},
 evidence:async(_owner,origin)=>structuredClone(rows.filter(r=>!origin||[].concat(origin).includes(r.origin))),get rows(){return rows;},
 profile:async()=>({facts:[]}),
 seed(value){row=structuredClone(value);},get row(){return row;},get busy(){return busy;}
};return self;}
// Receipt history is a view over evidence; tests read it the way the application does.
async function receiptsOf(store){return (await loadReceipts(store,'owner',store.row)).state;}
// Drives importStep the way the handler does: project evidence, step, persist new rows.
async function step(row,options){
 const rows=row.rows??[],store={evidence:async()=>structuredClone(rows)},next=await importStep({...row,receipts:await loadReceipts(store,'owner',row)},env,options);
 return {...next,rows:[...rows,...next.evidence.filter(e=>!rows.some(r=>r.id===e.id))]};
}
const itemsOf=row=>row.receipts.state.items;
async function request(handler,{method='GET',action,body,cookie,origin=env.SITE_ORIGIN,url='/api/wishlist?gmail=1'}={}){
 const req=Readable.from(body||action?[JSON.stringify(body??{action,...(action==='start'?{consent:CONSENT_VERSION}:{})})]:[]);Object.assign(req,{method,url,headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})}});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};await handler(req,res);return {...res,data:res.body?JSON.parse(res.body):null};
}
const auth=async()=>({status:200,conversation:'owner'});
test('OAuth tokens are authenticated and bound to their owner; permission is read-only',()=>{
 const sealed=sealToken(tokens,'owner',env);assert.deepEqual(openToken(sealed,'owner',env),tokens);assert.throws(()=>openToken(sealed,'other',env));assert.throws(()=>openToken(sealed.slice(0,-4)+'xxxx','owner',env));
 const url=new URL(authorizationURL('nonce',env));assert.equal(url.searchParams.get('scope'),GMAIL_SCOPE);assert.equal(url.searchParams.get('redirect_uri'),'https://jules.example/api/wishlist?gmail=callback');assert.equal(url.searchParams.get('state'),'nonce');
});
test('email preparation keeps HTML tables, unnamed PDF and reference evidence without duplicating the plain alternative',async()=>{
 const m={id:'m',internalDate:'1000',payload:{headers:[{name:'From',value:'Shop <sales@shop.example>'},{name:'Subject',value:'Order O1'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Jeans size 31').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<script>ignore me</script><table><tr><td>Blue</td><td>32</td></tr></table><a href="https://shop.example/?order_id=O1&amp;token=secret">Order</a>').toString('base64url')}},{mimeType:'application/pdf',body:{data:Buffer.from('%PDF-synthetic').toString('base64url')}}]}};
 const prepared=await prepareReceiptEmail(m,tokens,{pdf:async()=> 'Receipt O1 Brand'});assert.ok(!prepared.text.includes('Jeans size 31'));assert.ok(prepared.text.includes('Blue | 32'));assert.ok(prepared.text.includes('Receipt O1 Brand'));assert.ok(!prepared.text.includes('ignore me'));assert.ok(!prepared.text.includes('secret'));assert.equal(prepared.pdf_count,1);
});
test('unreadable attachments preserve readable results and disclose a warning',async()=>{
 const p=await prepareReceiptEmail({id:'m',payload:{headers:[],parts:[{mimeType:'text/plain',body:{data:Buffer.from(text).toString('base64url')}},{mimeType:'application/pdf',body:{data:'YQ'}}]}},tokens,{pdf:async()=>{throw Error('bad');}});assert.ok(p.text.includes('Jeans'));assert.equal(p.warnings.length,1);
});
test('purchases deduplicate exact variants; return requests do not imply a refund',()=>{
 let result=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt(),receipt()]});assert.equal(result.state.items.length,1);const id=result.state.items[0].id;
 result=reconcileReceipt(result.state,{...source,id:'m2'},{events:[receipt({kind:'return_requested',existing_item_id:id})]});assert.equal(result.state.items.length,1);assert.deepEqual(projectReceiptState(result.state).items[0].outcome,{value:'return_requested',refund:'unknown'});
 result=reconcileReceipt(result.state,{...source,id:'m3'},{events:[receipt({kind:'returned',existing_item_id:id})]});assert.deepEqual(projectReceiptState(result.state).items[0].outcome,{value:'returned',refund:'unknown'});
});
test('foreign targets, mismatched orders/sizes and fabricated fields cannot mutate history',()=>{
 const state=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state,id=state.items[0].id;
 for(const change of [{existing_item_id:'foreign'},{existing_item_id:id,size_label:fact('32')},{existing_item_id:id,order_reference:fact('O2')},{evidence:'invented',product:fact('invented'),order_reference:fact('invented')}])assert.throws(()=>reconcileReceipt(state,{...source,text:text+' 32 O2'},{events:[receipt(change)]}));assert.equal(state.items.length,1);
 // An unverifiable detail is left unknown instead of being stored or discarding the purchase.
 const partial=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt({brand:fact('invented'),color:{value:'Blue',quote:'Navy Blue'}})]});
 assert.equal(partial.state.items[0].brand,null);assert.equal(partial.state.items[0].color,null);assert.deepEqual(partial.records[0].withheld_fields,['brand','color']);
});
test('quotes tolerate HTML whitespace and table separators but not different content',()=>{
 const html={...source,text:'Shop Order O1\n  Jeans |  Blue | 31\nBrand quantity 1 purchased'};
 const ok=reconcileReceipt(emptyReceiptState('owner'),html,{events:[receipt({product:{value:'Jeans',quote:'Jeans Blue 31'},color:{value:'Blue',quote:'Jeans  Blue'}})]});
 assert.equal(ok.state.items[0].product,'Jeans');assert.equal(ok.state.items[0].color,'Blue');
 assert.equal(reconcileReceipt(emptyReceiptState('owner'),html,{events:[receipt({color:{value:'Red',quote:'Red'}})]}).state.items[0].color,null);
});
test('quotes ignore letter case, and a verified order reference proves an order when the transaction quote does not match',()=>{
 const caps={...source,text:'THOM BROWNE THANK YOU FOR YOUR ORDER Order QVGSTS Classic Pique 4-Bar Polo'};
 const polo=extra=>receipt({merchant:{value:'Thom Browne',quote:'THOM BROWNE'},brand:{value:'Thom Browne',quote:'THOM BROWNE'},order_reference:fact('QVGSTS'),product:fact('Classic Pique 4-Bar Polo'),color:fact(null),size_label:fact(null),quantity:fact(null),evidence:'Classic Pique 4-Bar Polo',...extra});
 let result=reconcileReceipt(emptyReceiptState('owner'),caps,{events:[polo({basis:{value:'order_confirmation',quote:'Thank you for your order'}})]});
 assert.equal(result.state.items[0].brand,'Thom Browne');assert.equal(result.records[0].withheld_fields,undefined);
 result=reconcileReceipt(emptyReceiptState('owner'),caps,{events:[polo({basis:{value:'order_confirmation',quote:'Your order is confirmed'}})]});
 assert.equal(result.state.items.length,1);assert.ok(result.records[0].withheld_fields.includes('basis'));
 // Without a verified order reference an unmatched transaction quote is still refused.
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),caps,{events:[polo({order_reference:fact(null),basis:{value:'order_confirmation',quote:'Your order is confirmed'}})]}),/Unverified transaction basis/);
 // Folding case never lets different letters through.
 assert.equal(reconcileReceipt(emptyReceiptState('owner'),caps,{events:[polo({basis:{value:'order_confirmation',quote:'THANK YOU'},color:{value:'Navy',quote:'NAVY'}})]}).state.items[0].color,null);
});
test('receipt reading turns sampling off where the model allows it',async()=>{
 const bodies=[],fetcher=async(url,init)=>{bodies.push(JSON.parse(init.body));return jsonResponse({status:'completed',output:[{content:[{type:'output_text',text:'{"events":[]}'}]}]});};
 await receiptModel({schema:RECEIPT_SCHEMA,context:{},instructions:'x'},{OPENAI_API_KEY:'k'},fetcher);
 await receiptModel({schema:RECEIPT_SCHEMA,context:{},instructions:'x'},{OPENAI_API_KEY:'k',OPENAI_MODEL:'o4-mini'},fetcher);
 assert.equal(bodies[0].temperature,0);assert.equal('temperature' in bodies[1],false);
});
test('purchases without a labeled order reference become items scoped to their email',()=>{
 const noOrder=receipt({order_reference:fact(null)});
 const first=reconcileReceipt(emptyReceiptState('owner'),source,{events:[noOrder,noOrder]});assert.equal(first.state.items.length,1);assert.equal(first.pending.length,0);
 const second=reconcileReceipt(first.state,{...source,id:'m2'},{events:[noOrder]});assert.equal(second.state.items.length,2);
 assert.equal(reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt({order_reference:fact(null),product:fact(null)})]}).pending.length,1);
});
test('receipt-stated recipients teach softly, gifts teach nothing, and user answers or conflicts take precedence',()=>{
 const shipped={...source,text:text+' Hi Sam, Ship to: Sam Lee. Gift message: happy birthday'};
 const self=reconcileReceipt(emptyReceiptState('owner'),shipped,{events:[receipt({recipient:{value:'self',quote:'Ship to: Sam Lee'}})]}).state;
 let view=receiptLearningView(projectReceiptState(self));assert.equal(view.learning_observations.length,1);assert.equal(view.learning_observations[0].recipient_basis,'receipt_evidence');
 assert.equal(JSON.parse(receiptShoppingFacts(self,view)[0].value).confirmed_fit,null);
 const gift=reconcileReceipt(emptyReceiptState('owner'),shipped,{events:[receipt({recipient:{value:'other',quote:'Gift message: happy birthday'}})]}).state;
 assert.equal(receiptLearningView(gift).learning_observations.length,0);assert.equal(receiptLearningView(gift).purchase_history.length,1);
 assert.equal(receiptLearningView(reconcileReceipt(emptyReceiptState('owner'),shipped,{events:[receipt({recipient:{value:'self',quote:'Ship to: Someone Else'}})]}).state).learning_observations.length,0);
 const conflict=reconcileReceipt(self,{...shipped,id:'m2'},{events:[receipt({existing_item_id:self.items[0].id,kind:'shipped',recipient:{value:'other',quote:'Gift message: happy birthday'}})]}).state;
 assert.equal(conflict.items[0].recipient_evidence.value,'conflicting');assert.equal(receiptLearningView(conflict).learning_observations.length,0);
 const answered=applyReceiptFeedback(self,{id:'gift',owner_id:'owner',source:'chat_answer',at:'2026-10-12',item_ids:[self.items[0].id],action:'set_recipient',value:'other'});
 assert.equal(receiptLearningView(answered).learning_observations.length,0);
});
test('shipping-only and ambiguous returns stay pending; a later exact purchase can link safely',()=>{
 const pending=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt({kind:'returned'})]});assert.equal(pending.state.items.length,0);assert.equal(pending.pending.length,1);
 const purchase=reconcileReceipt(pending.state,{...source,id:'m2'},{events:[receipt()]}).state;
 const linked=relinkPending(purchase,pending.pending);assert.equal(linked.pending.length,0);assert.equal(projectReceiptState(linked.state).items[0].outcome.value,'returned');
 assert.equal(relinkPending(purchase,[{...pending.pending[0],size_label:'32'}]).pending.length,1);
});
test('corrections survive new receipt evidence, and gifts remove learning without losing history',()=>{
 let state=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;const id=state.items[0].id;
 const event=(action,extra={})=>({id:action,owner_id:'owner',source:'closet_edit',at:'2026-10-10',item_ids:[id],action,...extra});
 state=applyReceiptFeedback(state,event('set_recipient',{value:'self'}));state=applyReceiptFeedback(state,event('correct_fields',{values:{brand:'Correct brand'}}));
 state=reconcileReceipt(state,{...source,id:'m2'},{events:[receipt({existing_item_id:id})]}).state;assert.equal(state.items[0].brand,'Correct brand');
 assert.equal(receiptShoppingFacts(state,receiptLearningView(state)).length,1);
 state=applyReceiptFeedback(state,{...event('set_recipient',{value:'other'}),id:'gift'});assert.equal(receiptLearningView(state).purchase_history.length,1);assert.equal(receiptShoppingFacts(state,receiptLearningView(state)).length,0);
});
test('cancelled purchases stop contributing to history and personal learning',()=>{
 let state=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;const id=state.items[0].id;
 state=applyReceiptFeedback(state,{id:'self',owner_id:'owner',source:'chat_answer',at:'2026-10-10',item_ids:[id],action:'set_recipient',value:'self'});
 state=reconcileReceipt(state,{...source,id:'cancel'},{events:[receipt({kind:'cancelled',existing_item_id:id})]}).state;assert.equal(receiptLearningView(projectReceiptState(state)).learning_observations.length,0);assert.equal(state.items.length,1);
});
test('resumable import accounts for sources and repeat imports skip previously extracted evidence',async()=>{
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:newImportJob()}};let analyses=0;
 const fetcher=async url=>url.includes('messages?')?jsonResponse({messages:[{id:'m1'}]}):jsonResponse({id:'m1',payload:{}});
 const prepare=async()=>source;
 const interpret=async r=>{if(r.schema===RECEIPT_SCHEMA){analyses++;return {events:[receipt()]};}return {questions:[]};};
 for(let i=0;i<60&&row.data.job.status!=='ready';i++)row=await step(row,{fetcher,prepare,interpret});assert.equal(row.data.job.status,'ready');assert.equal(row.data.job.processed.length,1);assert.equal(itemsOf(row).length,1);
 row.data.job=newImportJob();for(let i=0;i<60&&row.data.job.status!=='ready';i++)row=await step(row,{fetcher,prepare,interpret});assert.equal(analyses,1);assert.equal(itemsOf(row).length,1);
});
test('listing cap is explicit and failed extraction does not mark a source completed',async()=>{
 const job={status:'listing',query:'legacy-query',ids:[],page:null,processed:[],limit:200};job.ids=Array.from({length:190},(_,i)=>'old'+i);
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job}};
 row=await step(row,{fetcher:async()=>jsonResponse({messages:Array.from({length:50},(_,i)=>({id:'new'+i})),nextPageToken:'more'})});assert.equal(row.data.job.ids.length,200);assert.equal(row.data.job.limited,true);
 const prior=structuredClone(row);await assert.rejects(step(row,{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>source,interpret:async()=>{throw Error('timeout');}}));assert.deepEqual(row,prior);
});
test('connect requires invitation, matching origin and explicit analysis consent',async()=>{
 const store=storage(),handler=createGmailHandler({env,storeFactory:()=>store,auth});
 assert.equal((await request(handler,{method:'POST',body:{action:'connect',consent:CONSENT_VERSION},origin:'https://evil.example'})).statusCode,403);
 assert.equal((await request(handler,{method:'POST',action:'connect'})).statusCode,400);
 const res=await request(handler,{method:'POST',body:{action:'connect',consent:CONSENT_VERSION}});assert.equal(res.statusCode,200);assert.ok(res.headers['Set-Cookie'].includes('HttpOnly; Secure; SameSite=Lax'));assert.ok(res.data.url.startsWith('https://accounts.google.com/'));
 const blocked=createGmailHandler({env,storeFactory:()=>({...store,onboardingSession:async()=>null}),auth});assert.equal((await request(blocked)).statusCode,403);
});
test('callback binds browser state and invited Gmail account; state is single-use and tokens stay server-side',async()=>{
 const store=storage();const fetcher=async url=>url.includes('/token')?jsonResponse({...tokens,scope:GMAIL_SCOPE,expires_in:3600}):jsonResponse({emailAddress:'tester@example.test'});
 const handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher});const connect=await request(handler,{method:'POST',body:{action:'connect',consent:CONSENT_VERSION}});
 const state=new URL(connect.data.url).searchParams.get('state'),url='/api/wishlist?gmail=callback&state='+state+'&code=synthetic',cookie=connect.headers['Set-Cookie'].split(';')[0];
 assert.equal((await request(handler,{url})).statusCode,403);
 const callback=await request(handler,{url,cookie});assert.equal(callback.statusCode,303);assert.equal(callback.headers.Location,'/onboarding?gmail=connected');assert.ok(store.row.token_ciphertext);assert.ok(!JSON.stringify(store.row).includes('synthetic-refresh'));
 assert.equal((await request(handler,{url,cookie})).statusCode,403);assert.ok(!JSON.stringify((await request(handler)).data).includes('token'));
});
test('wrong Gmail account is revoked and cannot connect to another user',async()=>{
 const store=storage();let revoked=false;const fetcher=async url=>url.includes('/token')?jsonResponse({...tokens,scope:GMAIL_SCOPE,expires_in:3600}):url.includes('/revoke')?(revoked=true,new Response('',{status:200})):jsonResponse({emailAddress:'other@example.test'});
 const handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher}),res=await request(handler,{method:'POST',body:{action:'connect',consent:CONSENT_VERSION}}),state=new URL(res.data.url).searchParams.get('state');
 await request(handler,{url:'/api/wishlist?gmail=callback&state='+state+'&code=synthetic',cookie:res.headers['Set-Cookie'].split(';')[0]});assert.equal(revoked,true);assert.equal(store.row.token_ciphertext,null);assert.equal(store.busy,false);
});
test('history corrections are owned, persisted, revocable and public output excludes raw evidence',async()=>{
 const store=storage(),feedback=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;store.seed({conversation_id:'owner',revision:0,token_ciphertext:sealToken(tokens,'owner',env),data:{feedback,sources:[source]}});
 const handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher:async()=>new Response('',{status:200})});const item_id=feedback.items[0].id;
 assert.equal((await request(handler,{method:'POST',body:{action:'edit',event:{action:'set_recipient',item_ids:[item_id],value:'self'}}})).statusCode,200);
 assert.equal((await request(handler)).data.learning_count,1);assert.ok(!JSON.stringify((await request(handler)).data).includes('fingerprint'));
 assert.equal((await request(handler,{method:'POST',body:{action:'edit',event:{action:'report_return',item_ids:['foreign']}}})).statusCode,503);assert.equal(store.busy,false);
 assert.equal((await request(handler,{method:'POST',action:'disconnect'})).data.connected,false);assert.equal((await receiptsOf(store)).items.length,1);
 assert.equal((await request(handler,{method:'POST',body:{action:'delete-history',confirm:true}})).data.items.length,0);
});
test('real PDF parser reads a small digital receipt without remote fetches',async()=>{
 const content='BT /F1 12 Tf 20 70 Td (Receipt O1 Jeans size 31) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
 let file='%PDF-1.4\n',offsets=[0];for(const [i,o]of objects.entries()){offsets.push(Buffer.byteLength(file));file+=`${i+1} 0 obj\n${o}\nendobj\n`;}const xref=Buffer.byteLength(file);file+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 assert.ok((await receiptPDF(Buffer.from(file))).includes('Receipt O1 Jeans size 31'));
});
test('pilot acceptance: connect, import, answer, rerun and correct through the same learning loop',async()=>{
 const store=storage();await store.beginGmailOAuth('owner',digest('synthetic'));const initial=store.row;initial.token_ciphertext=sealToken(tokens,'owner',env);initial.data={feedback:emptyReceiptState('owner')};store.seed(initial);
 const fetcher=async url=>url.includes('messages?')?jsonResponse({messages:[{id:'m1'}]}):jsonResponse({id:'m1',payload:{}});
 const interpret=async r=>r.schema===RECEIPT_SCHEMA?{events:[receipt()]}:r.schema.properties.questions?{questions:[]}:{actions:[{action:'set_recipient',item_ids:[r.context.state.items[0].id],recipient:'self',recipient_label:null,corrections:[],target_item_id:null,question_id:null}]};
 const handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher,prepare:async()=>source,interpret});
 const run=async()=>{assert.equal((await request(handler,{method:'POST',action:'start'})).statusCode,200);for(let i=0;i<60&&store.row.data.job.status!=='ready';i++)assert.equal((await request(handler,{method:'POST',action:'step'})).statusCode,200);};
 await run();assert.equal((await receiptsOf(store)).items.length,1);
 assert.equal((await request(handler,{method:'POST',body:{action:'answer',message:'Those jeans were for me'}})).data.learning_count,1);
 await run();assert.equal((await receiptsOf(store)).items.length,1);assert.equal((await receiptsOf(store)).items[0].recipient.value,'self');
 const id=(await receiptsOf(store)).items[0].id;const edited=await request(handler,{method:'POST',body:{action:'edit',event:{action:'set_recipient',item_ids:[id],value:'other',label:'sister'}}});assert.equal(edited.data.learning_count,0);assert.equal(edited.data.items.length,1);
});
test('a purchase-history answer with an unresolvable part saves the clear part and asks about the rest',async()=>{
 const {updatePurchaseHistory}=await import('../lib/receipt-chat.js');const store=storage();const feedback=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;
 store.seed({conversation_id:'owner',revision:0,data:{feedback},token_ciphertext:null});store.context=async()=>[{provider_id:'in2',direction:'inbound',body:'answer',created_at:'2026-10-14'}];
 const delivery={space:{phone:'synthetic-line'},message:{id:'in2',sender:{id:'synthetic-sender'},content:{text:'answer'}}};
 const id=feedback.items[0].id,act=(action,item_ids,recipient=null)=>({action,item_ids,recipient,recipient_label:null,corrections:[],target_item_id:null,question_id:null});
 const mixed=await updatePurchaseHistory(delivery,'owner',store,env,{interpret:async()=>({actions:[act('set_recipient',[id],'self'),act('report_return',[])]})});
 assert.equal(mixed.updated,true);assert.match(mixed.body,/\?$/);
 assert.equal((await receiptsOf(store)).items[0].recipient.value,'self');assert.equal((await receiptsOf(store)).items[0].outcome?.value??'unknown','unknown');
 const store2=storage();store2.seed({conversation_id:'owner',revision:0,data:{feedback},token_ciphertext:null});store2.context=store.context;
 const nothing=await updatePurchaseHistory(delivery,'owner',store2,env,{interpret:async()=>({actions:[act('report_return',['foreign'])]})});
 assert.equal(nothing.updated,false);assert.equal(store2.rows.length,0);assert.match(nothing.body,/\?$/);
});
test('the purchase-history skill uses model context, records correction evidence, and replays without reinterpreting',async()=>{
 const {updatePurchaseHistory}=await import('../lib/receipt-chat.js');const store=storage();const feedback=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;
 store.seed({conversation_id:'owner',revision:0,data:{feedback},token_ciphertext:null});store.context=async()=>[{provider_id:'in1',direction:'inbound',body:'The jeans were for my sister',created_at:'2026-10-10',reply_provider_id:'old1'}];
 const delivery={space:{phone:'synthetic-line'},message:{id:'in1',sender:{id:'synthetic-sender'},content:{text:'The jeans were for my sister'}}};let interpreted=0;
 const unmatched=await updatePurchaseHistory(delivery,'owner',store,env,{interpret:async()=>({actions:[]})});assert.equal(unmatched.updated,false);assert.equal(store.rows.length,0);
 const interpret=async r=>{interpreted++;assert.equal(r.context.state.conversation[0].reply_provider_id,'old1');return {actions:[{action:'set_recipient',item_ids:[feedback.items[0].id],recipient:'other',recipient_label:'sister',corrections:[],target_item_id:null,question_id:null}]};};
 assert.equal((await updatePurchaseHistory(delivery,'owner',store,env,{interpret})).updated,true);assert.equal((await updatePurchaseHistory(delivery,'owner',store,env,{interpret})).updated,true);
 assert.equal(interpreted,1);assert.equal((await receiptsOf(store)).items[0].recipient.label,'sister');
 // The legacy import migrated on that write: proof now lives only in evidence rows.
 assert.equal(store.row.data.feedback,undefined);assert.ok(store.rows.some(r=>r.kind==='correction'&&r.data.action==='set_recipient'));assert.ok(store.rows.some(r=>r.kind==='purchase_event'));
});
test('the one agent offers the purchase-history skill whenever history exists, including while a wishlist offer is pending',async()=>{
 const {generateReply}=await import('../lib/ai.js');const {agentTurn,tool,toolNames}=await import('./helpers/agent.js');
 const messages=[{direction:'inbound',status:'received',body:'Actually I returned those jeans'}],ai={OPENAI_API_KEY:'synthetic',SEARCH_ENABLED:'true'};let names;
 const fetcher=async(_url,options)=>{names=toolNames(options);return agentTurn(tool('update_purchase_history'));};
 const action=async()=>'updated';
 assert.equal(await generateReply(messages,ai,fetcher,{purchaseHistoryAction:action}),'updated');assert.ok(names.includes('update_purchase_history'));
 assert.equal(await generateReply(messages,ai,fetcher,{purchaseHistoryAction:action,wishlistAction:async()=>assert.fail(),wishlistState:{stage:'offer_set',options:[{url:'https://shop.example/p'}]}}),'updated');
 assert.ok(names.includes('update_purchase_history')&&names.includes('save_to_wishlist'));
 await generateReply(messages,ai,async(_url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'ok'}));},{});assert.ok(!names.includes('update_purchase_history'));
});
test('receipt observations reach ranking as history, never a size default or favorite declaration',async()=>{
 const {shoppingConstraints}=await import('../lib/relevance.js');let state=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;
 state=applyReceiptFeedback(state,{id:'self',owner_id:'owner',source:'chat_answer',at:'2026-10-10',item_ids:[state.items[0].id],action:'set_recipient',value:'self'});
 const facts=receiptShoppingFacts(state,receiptLearningView(state)),constraints=shoppingConstraints(facts,'find jeans');assert.equal(constraints.taste[0].field,'shopping_history');assert.deepEqual(constraints.size_facts,[]);assert.equal(JSON.parse(facts[0].value).explicit_preference,false);
});
test('changed sources preserve old evidence and corrections while allowing the remaining import to progress',async()=>{
 const feedback=reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state;
 const row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback,sources:[source],job:{...newImportJob(),status:'extracting',ids:['m1']}}};
 const next=await step(row,{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>({...source,fingerprint:'changed',text:'Changed receipt'}),interpret:async()=>{throw Error('Changed evidence must not overwrite items');}});
 assert.equal(itemsOf(next).length,1);assert.deepEqual(next.data.changed_sources,[{id:'m1',fingerprint:'changed',date:1000}]);assert.deepEqual(next.data.job.processed,['m1']);assert.equal(publicImport(next,next.receipts).changed_sources,1);
 // Email text is not retained; the shopping source keeps only metadata.
 assert.ok(!JSON.stringify(next.data).includes(text));assert.equal(next.data.sources[0].shopping_evidence,true);
});
test('irrelevant emails keep only their id and are never fetched again; shopping emails keep metadata without text',async()=>{
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['shop','news','skip']}}};
 const fetched=[],texts={shop:text,news:'Weekly newsletter',skip:'Ride receipt'};
 const fetcher=async url=>{const id=url.match(/messages\/([^?/]+)/)[1];if(url.includes('format=full'))fetched.push(id);return jsonResponse({id,payload:{headers:[{name:'Subject',value:id}]}});};
 const prepare=async m=>({id:m.id,text:texts[m.id],date:1000,fingerprint:m.id,sender_domain:m.id+'.example',warnings:[]});
 const interpret=async r=>r.schema===TRIAGE_SCHEMA?{decisions:r.context.emails.map(e=>({id:e.id,action:e.id==='skip'?'skip':'extract'}))}:r.context.source.id==='shop'?{events:[receipt()]}:{events:[]};
 row=await step(row,{fetcher,prepare,interpret});
 assert.deepEqual(fetched.sort(),['news','shop']);assert.deepEqual(row.data.job.processed.sort(),['news','shop','skip']);
 assert.deepEqual(row.data.sources.map(s=>s.id),['shop']);assert.equal(row.data.sources[0].text,undefined);assert.deepEqual(row.data.scanned_ids.sort(),['news','skip']);
 assert.equal(row.data.job.quality.triage_skip,1);assert.ok(!JSON.stringify(row.data).includes('Weekly newsletter'));
 fetched.length=0;row.data.job={...newImportJob(),status:'extracting',ids:['shop','news','skip']};row=await step(row,{fetcher,prepare,interpret});
 assert.deepEqual(fetched,['shop']);assert.equal(itemsOf(row).length,1);
});
test('emails an older analysis version judged irrelevant are read again, including ones the running job already passed',async()=>{
 const shop={id:'shop',date:1000,fingerprint:'shop',shopping_evidence:true};
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),sources:[shop],scanned_ids:['old','passed'],job:{...newImportJob(),status:'extracting',ids:['shop','passed','old'],processed:['shop','passed'],triage:{old:'skip'}}}};
 const fetched=[],fetcher=async url=>{const id=url.match(/messages\/([^?/]+)/)[1];if(url.includes('format=full'))fetched.push(id);return jsonResponse({id,payload:{headers:[]}});};
 const prepare=async m=>({id:m.id,text,date:1000,fingerprint:m.id,sender_domain:'shop.example',warnings:[]});
 const interpret=async r=>r.schema===TRIAGE_SCHEMA?{decisions:r.context.emails.map(e=>({id:e.id,action:'extract'}))}:{events:r.context.source.id==='passed'?[receipt()]:[]};
 row=await step(row,{fetcher,prepare,interpret});
 assert.deepEqual(fetched.sort(),['old','passed']);assert.equal(row.data.scan_version,SCAN_VERSION);assert.equal(row.data.job.quality.rescanned,1);
 assert.equal(itemsOf(row).length,1);assert.deepEqual(row.data.scanned_ids,['old']);
 // Same version: the irrelevant email stays skipped on the next import.
 fetched.length=0;row.data.job={...newImportJob(),status:'extracting',ids:['old']};row=await step(row,{fetcher,prepare,interpret});assert.deepEqual(fetched,[]);
});
test('sender domains fall back to other sender headers and backfill a stored shopping email that lacked one',async()=>{
 const message=headers=>({id:'m',internalDate:'1000',payload:{mimeType:'text/plain',headers,body:{data:Buffer.from(text).toString('base64url')}}});
 assert.equal((await prepareReceiptEmail(message([{name:'From',value:'Shop Orders'},{name:'Reply-To',value:'Care <care@shop.example>'}]),tokens)).sender_domain,'shop.example');
 assert.equal((await prepareReceiptEmail(message([{name:'From',value:'"Shop" <orders@mail.shop.example>'}]),tokens)).sender_domain,'mail.shop.example');
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),scan_version:SCAN_VERSION,sources:[{id:'m',date:1000,fingerprint:'same',sender_domain:null,shopping_evidence:true,price_version:PRICE_VERSION,photo_version:PHOTO_VERSION}],job:{...newImportJob(),status:'extracting',ids:['m']}}};
 row=await step(row,{fetcher:async()=>jsonResponse({id:'m',payload:{}}),prepare:async()=>({id:'m',text,date:1000,fingerprint:'same',sender_domain:'shop.example',warnings:[]}),interpret:()=>assert.fail()});
 assert.equal(row.data.sources[0].sender_domain,'shop.example');assert.equal(row.data.changed_sources,undefined);
});
test('opening the page resumes a background import that stopped without an error, but not one paused after failures',async()=>{
 const store=storage(),scheduled=[];const handler=createGmailHandler({env,storeFactory:()=>store,auth:async()=>({status:200,conversation:'owner'}),schedule:(owner,worker)=>scheduled.push(worker)});
 store.seed({conversation_id:'owner',revision:1,token_ciphertext:sealToken(tokens,'owner',env),updated_at:new Date(Date.now()-600000).toISOString(),lease_until:null,data:{job:{...newImportJob(),status:'extracting',worker:'lost'}}});
 let response=await request(handler);assert.equal(response.data.failed,false);assert.equal(scheduled.length,1);assert.notEqual(scheduled[0],'lost');assert.equal(store.row.data.job.worker,scheduled[0]);
 store.seed({...store.row,updated_at:new Date(Date.now()-600000).toISOString(),data:{...store.row.data,job:{...store.row.data.job,error:'paused'}}});
 response=await request(handler);assert.equal(response.data.failed,true);assert.equal(scheduled.length,1);
});
test('question selection drops invalid proposals and never blocks a finished import',async()=>{
 const base=await step({conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['m1']}}},{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>({...source,warnings:[]}),interpret:async r=>r.schema===TRIAGE_SCHEMA?{decisions:[]}:{events:[receipt()]}});
 const item=itemsOf(base)[0].id,good={item_ids:[item],topic:'recipient',fields:[],question:'Were these jeans for you?',reason:'Decides whether they teach your sizes.',evidence_ids:['m1']};
 const atQuestions={...base,data:{...base.data,job:{...base.data.job,status:'questions'}}};
 let next=await step(atQuestions,{interpret:async()=>({questions:[good,{...good,item_ids:['unknown-item']},{...good,question:'Other?',evidence_ids:['foreign-email']}]})});
 assert.equal(next.data.job.status,'ready');assert.deepEqual(next.receipts.state.questions.filter(q=>q.status==='open').map(q=>q.question),['Were these jeans for you?']);
 next=await step({...next,data:{...next.data,job:{...next.data.job,status:'questions'}}},{interpret:async()=>{throw Error('model down');}});
 assert.equal(next.data.job.status,'ready');assert.equal(next.data.job.quality.questions_failed,true);assert.equal(next.receipts.state.questions.filter(q=>q.status==='open').length,1);
});
test('emails already in the history are re-read once for prices, unless their content changed',async()=>{
 const priced={...source,text:text+' $120.00'};
 const base=reconcileReceipt(emptyReceiptState('owner'),priced,{events:[receipt()]}).state;
 const meta=extra=>({id:'m1',date:1000,fingerprint:'synthetic',shopping_evidence:true,...extra});
 let calls=0;const interpret=async r=>{if(r.schema===TRIAGE_SCHEMA)return {decisions:[]};calls++;return {events:[receipt({unit_price:fact('$120.00'),currency:fact(null)})]};};
 let row=await step({conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:base,scan_version:SCAN_VERSION,sources:[meta()],job:{...newImportJob(),status:'extracting',ids:['m1']}}},{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>priced,interpret});
 assert.equal(calls,1);assert.equal(itemsOf(row).length,1);assert.equal(itemsOf(row)[0].price.amount,120);assert.equal(row.data.sources[0].price_version,PRICE_VERSION);assert.equal(row.data.job.quality.repriced,1);
 row=await step({...row,data:{...row.data,job:{...newImportJob(),status:'extracting',ids:['m1']}}},{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>priced,interpret});
 assert.equal(calls,1,'re-read only once');
 // A changed email is never re-read over its existing evidence.
 const changed=await step({conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:base,scan_version:SCAN_VERSION,sources:[meta()],job:{...newImportJob(),status:'extracting',ids:['m1']}}},{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>({...priced,fingerprint:'changed'}),interpret:()=>assert.fail()});
 assert.equal(itemsOf(changed)[0].price,undefined);assert.equal(changed.data.changed_sources.length,1);
});
test('a failed triage analyzes every email, and one failing email cannot stall the rest of the batch',async()=>{
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['bad','m1']}}};
 const fetcher=async url=>jsonResponse({id:url.match(/messages\/([^?/]+)/)[1],payload:{}});
 const interpret=async r=>{if(r.schema===TRIAGE_SCHEMA)throw Error('triage down');if(r.context.source.id==='bad')throw Error('bad email');return {events:[receipt()]};};
 const prepare=async m=>({...source,id:m.id});
 row=await step(row,{fetcher,prepare,interpret});assert.deepEqual(row.data.job.processed,['m1']);assert.equal(row.data.job.attempts.bad,1);
 row=await step(row,{fetcher,prepare,interpret});assert.deepEqual(row.data.job.processed,['m1','bad']);assert.equal(row.data.job.quality.failed,1);assert.ok(!(row.data.scanned_ids??[]).includes('bad'));
 await assert.rejects(step({...row,data:{...row.data,job:{...row.data.job,ids:['m2','m3'],processed:[]}}},{fetcher,prepare,interpret:async()=>{throw Error('outage');}}));
});
test('contact redaction preserves long receipt/order identities and omits raw credential links',async()=>{
 const {redactReceiptText}=await import('../lib/receipt-email.js');const redacted=redactReceiptText('Order: 1234567890123456\nPhone: +1 555 123 4567\ncard: 4111 1111 1111 1111\npassword: secretvalue\nhttps://shop.example/login?token=private');
 assert.ok(redacted.includes('Order: 1234567890123456'));assert.ok(!redacted.includes('555'));assert.ok(!redacted.includes('4111'));assert.ok(!redacted.includes('secretvalue'));assert.ok(!redacted.includes('token=private'));
});
test('typographic quote differences still verify, and a verified product quote can stand in for a mismatched event quote',()=>{
 const email={...source,text:'Order O1 \u2014 Men\u2019s \u201cRanger\u201d Boot\u00a0Size 10 purchased'};
 const boot={kind:'purchased',basis:{value:'order_confirmation',quote:'Order O1'},category:'footwear',existing_item_id:null,evidence:'Men\'s "Ranger" Boot Size 10',merchant:fact(null),order_reference:fact('O1'),product:{value:'Men\'s "Ranger" Boot',quote:'Men\'s "Ranger" Boot'},sku:fact(null),brand:fact(null),color:fact(null),size_label:fact('10'),size_system:fact(null),quantity:fact(null),units_per_pack:fact(null)};
 let result=reconcileReceipt(emptyReceiptState('owner'),email,{events:[boot]});assert.equal(result.records[0].values.product,'Men\'s "Ranger" Boot');assert.equal(result.records[0].withheld_fields,undefined);
 result=reconcileReceipt(emptyReceiptState('owner'),email,{events:[{...boot,evidence:'Bought the Ranger boot in size ten'}]});
 assert.equal(result.records[0].evidence,'Men\'s "Ranger" Boot');assert.ok(result.records[0].withheld_fields.includes('evidence'));
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),email,{events:[{...boot,evidence:'invented',product:fact('Loafer'),order_reference:fact('O9')}]}));
});
test('only quoted buyer transactions for clothing and accessories become purchases',()=>{
 const cart={...source,text:'Still thinking about it? Black Slack Trousers Size: IT 48 in your bag'};
 const item={merchant:fact(null),order_reference:fact(null),product:fact('Black Slack Trousers'),size_label:fact('IT 48'),brand:fact(null),color:fact(null),quantity:fact(null)};
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),cart,{events:[receipt({...item,evidence:'Black Slack Trousers',basis:{value:'cart_or_marketing',quote:'Still thinking about it?'}})]}),/Not a buyer transaction/);
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),cart,{events:[receipt({...item,evidence:'Black Slack Trousers',basis:{value:'seller_notification',quote:'in your bag'}})]}),/Not a buyer transaction/);
 // A purchase must cite an order or receipt; a basis quote the email does not contain is refused.
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),cart,{events:[receipt({...item,evidence:'Black Slack Trousers',basis:{value:'order_confirmation',quote:'Thank you for your order'}})]}),/Unverified transaction basis/);
 const classes={...source,text:'Order 45059480 confirmed SERIES-SOULRENEW-NYC 4 classes'};
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),classes,{events:[receipt({merchant:fact(null),order_reference:fact('45059480'),product:fact('SERIES-SOULRENEW-NYC'),brand:fact(null),color:fact(null),size_label:fact('4'),quantity:fact(null),evidence:'SERIES-SOULRENEW-NYC',basis:{value:'order_confirmation',quote:'Order 45059480 confirmed'},category:'service'})]}),/Outside clothing/);
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt({category:'other_goods'})]}),/Outside clothing/);
 // A shipping notice can still support a shipped event, never a purchase.
 assert.throws(()=>reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt({basis:{value:'shipping_notice',quote:'purchased'}})]}),/Not a buyer transaction/);
 assert.equal(reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt({kind:'shipped',basis:{value:'shipping_notice',quote:'purchased'}})]}).records.length,1);
});
test('a date is never an order reference, and one line written twice in an email is one item',()=>{
 const email={...source,text:'Order confirmed 06/23/2024 Linen SS Cloak Button Up / Black - Linen SS Cloak Button Up / Black / 3 / Large 1 $298.00'};
 const line=product=>receipt({merchant:fact(null),order_reference:fact(null),brand:fact(null),color:fact(null),quantity:fact('1'),size_label:fact('Large'),product:fact(product),evidence:product,basis:{value:'order_confirmation',quote:'Order confirmed'}});
 const result=reconcileReceipt(emptyReceiptState('owner'),{...email,text:'Shop '+email.text},{events:[{...line('Linen SS Cloak Button Up / Black'),merchant:fact('Shop')},{...line('Linen SS Cloak Button Up / Black - Linen SS Cloak Button Up / Black / 3'),merchant:fact('Shop'),order_reference:fact('06/23/2024')}]});
 assert.equal(result.state.items.length,1);assert.equal(result.state.items[0].source_events.length,2);assert.ok(result.records[1].withheld_fields.includes('order_reference'));
 // Different sizes of the same product in one email stay separate items.
 const two=reconcileReceipt(emptyReceiptState('owner'),{...source,text:text+' 32'},{events:[receipt(),receipt({size_label:fact('32')})]});assert.equal(two.state.items.length,2);
});
test('an order-level refund that names no item stays unlinked when the order has several items',()=>{
 const email={...source,text:text+' 32 your refund has been processed'};
 let result=reconcileReceipt(emptyReceiptState('owner'),email,{events:[receipt(),receipt({size_label:fact('32')})]});
 const [a]=result.state.items;
 const refund=receipt({kind:'refunded',existing_item_id:a.id,product:fact(null),sku:fact(null),brand:fact(null),color:fact(null),size_label:fact(null),quantity:fact(null),evidence:'your refund has been processed',basis:{value:'return_or_refund_notice',quote:'your refund has been processed'}});
 result=reconcileReceipt(result.state,{...email,id:'m2'},{events:[refund]});
 assert.equal(result.pending.length,1);assert.ok(result.state.items.every(i=>i.source_events.length===1));
 // With a single item in the order, the same refund links to it.
 const single=reconcileReceipt(emptyReceiptState('owner'),email,{events:[receipt()]});
 const linked=reconcileReceipt(single.state,{...email,id:'m2'},{events:[{...refund,existing_item_id:single.state.items[0].id}]});
 assert.equal(linked.pending.length,0);assert.equal(linked.state.items[0].source_events.length,2);
});
test('subject, sender name and addressee name reach analysis and triage regardless of header case',async()=>{
 const message={id:'m',internalDate:'1000',snippet:'Thanks for your order',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Your order QVGSTS'},{name:'From',value:'"Thom Browne" <orders@mail-thombrowne.com>'},{name:'To',value:'Pat Doe <pat@example.test>'}],body:{data:Buffer.from(text).toString('base64url')}}};
 const prepared=await prepareReceiptEmail(message,tokens);
 assert.match(prepared.text,/SUBJECT\nYour order QVGSTS\nFROM\nThom Browne \(mail-thombrowne\.com\)\nTO\nPat Doe/);assert.ok(!prepared.text.includes('pat@example.test'));
 const candidate=triageCandidate(message);assert.equal(candidate.subject,'Your order QVGSTS');assert.equal(candidate.from_name,'Thom Browne');
});
test('a malformed event is withheld without dropping supported purchase evidence from the same email',async()=>{
 const row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['m1']}}};
 const next=await step(row,{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>({...source,warnings:[]}),interpret:async()=>({events:[receipt({evidence:'invented',product:fact('invented'),order_reference:fact('invented')}),receipt()]})});
 assert.equal(itemsOf(next).length,1);assert.equal(itemsOf(next)[0].source_events[0].id,'m1:1');assert.equal(next.data.sources[0].warnings.length,1);assert.deepEqual(next.data.job.processed,['m1']);
});
test('expanding an existing connection requires new consent and leaves its saved evidence intact',async()=>{
 const store=storage();store.seed({conversation_id:'owner',revision:0,token_ciphertext:sealToken(tokens,'owner',env),data:{consent:{version:'gmail-receipts-90d-v1'},feedback:reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state,sources:[source]}});
 const handler=createGmailHandler({env,storeFactory:()=>store,auth});
 const rejected=await request(handler,{method:'POST',body:{action:'start'}});assert.equal(rejected.statusCode,400);assert.equal(store.busy,false);assert.equal(store.row.data.sources.length,1);assert.equal(store.row.data.job,undefined);
 const accepted=await request(handler,{method:'POST',body:{action:'start',consent:CONSENT_VERSION}});assert.equal(accepted.statusCode,200);assert.equal(store.row.data.job.limit,1000);assert.equal(store.row.data.consent.version,CONSENT_VERSION);assert.equal(store.row.data.sources.length,1);
});
test('legacy jobs retain their original history scope after the importer is upgraded',()=>{
 const result=publicImport({data:{consent:{version:'gmail-receipts-90d-v1'},job:{status:'extracting',ids:['old'],processed:[]}}});
 assert.equal(result.period_days,90);assert.equal(result.period_years,null);assert.equal(result.limit,200);assert.equal(result.consent_required,true);
});
test('an authorization initiated under the old consent cannot become a five-year import after deployment',async()=>{
 const store=storage();await store.beginGmailOAuth('owner',digest('legacy-nonce'));
 const handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher:()=>assert.fail('old consent cannot exchange or read Gmail')});
 const res=await request(handler,{url:'/api/wishlist?gmail=callback&state=legacy-nonce&code=old-code',cookie:'__Host-jules-gmail-state=legacy-nonce'});
 assert.equal(res.statusCode,403);assert.equal(store.row.token_ciphertext,null);
});
test('historical purchase observations stay available without becoming current ownership or a size default',()=>{
 let state=reconcileReceipt(emptyReceiptState('owner'),{...source,date:Date.parse('2022-01-01')},{events:[receipt()]}).state;
 state=applyReceiptFeedback(state,{id:'self',owner_id:'owner',source:'chat_answer',at:'2026-10-12',item_ids:[state.items[0].id],action:'set_recipient',value:'self'});
 const facts=receiptShoppingFacts(state,receiptLearningView(projectReceiptState(state)),Date.parse('2026-10-12'));
 const evidence=JSON.parse(facts[0].value);assert.equal(evidence.recency,'historical');assert.equal(evidence.still_owned,null);assert.equal(evidence.confirmed_fit,null);assert.equal(facts[0].field,'shopping_history');
});

test('merchant spellings of the same store link, deduplicate and group; different stores stay apart',async()=>{
 assert.equal(merchantKey('MFPEN Retail ApS'),'mfpen');assert.equal(merchantKey('mfpen.com'),'mfpen');assert.equal(merchantKey('Nordstrom Inc.'),merchantKey('Nordstrom.com'));assert.notEqual(merchantKey('Acne Studios AB'),merchantKey('Studio Nicholson'));
 const legal={...source,text:'MFPEN Retail ApS Order O1 Jeans Blue 31 quantity 1 purchased'},short={...source,id:'m2',text:'MFPEN Order O1 Jeans Blue 31 purchased returned'};
 // The brand's own store: the brand is quoted from the legal entity name.
 const bought=reconcileReceipt(emptyReceiptState('owner'),legal,{events:[receipt({merchant:{value:'MFPEN Retail ApS',quote:'MFPEN Retail ApS'},brand:{value:'MFPEN',quote:'MFPEN Retail ApS'}})]}).state;
 assert.equal(bought.items[0].brand,'MFPEN');
 const again=reconcileReceipt(bought,short,{events:[receipt({merchant:fact('MFPEN'),brand:fact('MFPEN')})]}).state;assert.equal(again.items.length,1);
 const returned=reconcileReceipt(bought,short,{events:[receipt({kind:'returned',merchant:fact('MFPEN'),brand:fact(null)})]});assert.equal(returned.pending.length,1);
 assert.equal(projectReceiptState(relinkPending(returned.state,returned.pending).state).items[0].outcome.value,'returned');
 assert.equal(reconcileReceipt(bought,short,{events:[receipt({kind:'returned',existing_item_id:bought.items[0].id,merchant:fact('MFPEN')})]}).state.items[0].source_events.length,2);
 assert.throws(()=>reconcileReceipt(bought,{...short,text:short.text+' Other Shop'},{events:[receipt({kind:'returned',existing_item_id:bought.items[0].id,merchant:fact('Other Shop')})]}));
 const {purchaseSummary}=await import('../lib/evidence.js');
 let mixed=reconcileReceipt(bought,{...legal,id:'m3',text:'mfpen.com Order O2 Shirt purchased'},{events:[receipt({merchant:fact('mfpen.com'),order_reference:fact('O2'),product:fact('Shirt'),brand:fact(null),color:fact(null),size_label:fact(null),quantity:fact(null)})]}).state;
 for(const item of mixed.items)mixed=applyReceiptFeedback(mixed,{id:'self-'+item.id,owner_id:'owner',source:'chat_answer',at:'2026-10-12',item_ids:[item.id],action:'set_recipient',value:'self'});
 assert.deepEqual(purchaseSummary(mixed).top_merchants.map(m=>[m.name,m.count]),[['mfpen.com',2]]);
});
// Synthetic mailbox shaped like the founder's: a brand's own store sends store-platform order emails
// ("Order #CB1001 confirmed"), while the generic searches return mostly mail earlier imports already
// found irrelevant. The brand's older order is found through the known-store search, and the
// already-read mail is neither fetched again nor counted toward the limit.
test('repeat import passes over already-read mail and finds a brand store\'s older orders',async()=>{
 const noise=Array.from({length:30},(_,i)=>'noise'+i),queries=[],fetched=[];
 const mail={c1:'SUBJECT\nOrder #CB1001 confirmed\nFROM\nCycling Brand (cyclingbrand.example)\nOrder #CB1001\nThermal Jersey\nSize: M\nQuantity: 1',
  c2:'SUBJECT\nOrder #CB0042 confirmed\nFROM\nCycling Brand (cyclingbrand.example)\nOrder #CB0042\nBib Shorts\nSize: M\nQuantity: 1'};
 const fetcher=async url=>{
  const u=new URL(url);if(!u.pathname.endsWith('/messages'))return jsonResponse({id:u.pathname.split('/').pop(),payload:{headers:[]}});
  const q=u.searchParams.get('q');queries.push(q);
  if(q.includes('from:cyclingbrand.example'))return jsonResponse({messages:[{id:'c1'},{id:'c2'}]});
  if(q.includes('subject:order ')&&!q.includes(`before:${newImportJob().recent_after}`))return jsonResponse({messages:[{id:'c1'},...noise.map(id=>({id}))]});
  return jsonResponse({messages:noise.map(id=>({id}))});
 };
 const prepare=async message=>{fetched.push(message.id);return {id:message.id,text:mail[message.id]??'SUBJECT\nNewsletter',date:1000,fingerprint:message.id,sender_domain:mail[message.id]?'cyclingbrand.example':'news.example',warnings:[]};};
 const line=(order,product)=>withBasis({kind:'purchased',existing_item_id:null,evidence:'Order '+order+' confirmed',merchant:fact('Cycling Brand'),order_reference:fact(order),product:fact(product),sku:fact(null),brand:fact('Cycling Brand'),color:fact(null),size_label:fact('M'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),unit_price:fact(null),currency:fact(null),recipient:{value:'unknown',quote:null}});
 const interpret=async r=>r.schema===RECEIPT_SCHEMA?{events:r.context.source.id==='c1'?[line('#CB1001','Thermal Jersey')]:r.context.source.id==='c2'?[line('#CB0042','Bib Shorts')]:[]}:r.schema===TRIAGE_SCHEMA?{decisions:r.context.emails.map(e=>({id:e.id,action:e.id.startsWith('noise')?'skip':'extract'}))}:{questions:[]};
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),scan_version:SCAN_VERSION,scanned_ids:[...noise],job:newImportJob()}};
 for(let i=0;i<80&&row.data.job.status!=='ready';i++)row=await step(row,{fetcher,prepare,interpret});
 assert.equal(row.data.job.status,'ready');
 assert.deepEqual(itemsOf(row).map(i=>i.product).sort(),['Bib Shorts','Thermal Jersey']);
 assert.ok(queries.some(q=>q.includes('subject:order ')));
 assert.ok(!fetched.some(id=>id.startsWith('noise')),'already-read mail is not fetched again');
 assert.ok(!row.data.job.ids.some(id=>id.startsWith('noise')),'already-read mail does not use the limit');
 assert.ok(row.data.job.already_read>0);
 // When the reading rules change, mail found irrelevant under the old rules is read again.
 row.data.scan_version='older-rules';row.data.job=newImportJob();fetched.length=0;
 for(let i=0;i<80&&row.data.job.status!=='ready';i++)row=await step(row,{fetcher,prepare,interpret});
 assert.ok(row.data.job.ids.some(id=>id.startsWith('noise')));
});
// The account page's Import again sends the version the server reports, after the person agrees to the
// same consent text onboarding shows; an older agreement is never upgraded silently.
test('account re-import asks for the current consent and sends the version the server requires',async()=>{
 const {readFileSync}=await import('node:fs');
 const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
 const consent=html=>html.match(/<label class="check"><input type="checkbox" id="[^"]*consent[^"]*"><span>([\s\S]*?)<\/span><\/label>/)[1];
 assert.equal(consent(read('account.html')),consent(read('onboarding.html')),'account and onboarding show the same consent');
 assert.ok(read('onboarding.js').includes(`'${CONSENT_VERSION}'`),'onboarding sends the current consent version');
 const older=publicImport({token_ciphertext:'sealed',data:{consent:{version:'gmail-receipts-5y-1000-v2'},job:{status:'ready',ids:[],processed:[]}}});
 assert.equal(older.consent_required,true);assert.equal(older.consent_version,CONSENT_VERSION);
 assert.equal(publicImport({data:{consent:{version:CONSENT_VERSION}}}).consent_required,false);
 const js=read('account.js');assert.match(js,/api\('start',consentVersion\?\{consent:consentVersion\}:\{\}\)/);
});
// The founder's MAAP case: the store's first order email only turns up partway through the import
// (after the start-of-import store search ran), and its older orders must still be found in the same run.
test('a store first found partway through an import has its other orders found in the same import',async()=>{
 const queries=[];
 const mail={c1:'SUBJECT\nCycling Brand Order Summary\nOrder #CB1001\nThermal Jersey\nSize: M',c2:'SUBJECT\nCycling Brand Order Summary\nOrder #CB0042\nBib Shorts\nSize: M'};
 const fetcher=async url=>{
  const u=new URL(url);if(!u.pathname.endsWith('/messages'))return jsonResponse({id:u.pathname.split('/').pop(),payload:{headers:[]}});
  const q=u.searchParams.get('q');queries.push(q);
  if(q.includes('from:cyclingbrand.example'))return jsonResponse({messages:[{id:'c1'},{id:'c2'}]});
  if(q.includes('category:purchases')&&!q.includes('filename:pdf'))return jsonResponse({messages:[{id:'c1'}]});
  return jsonResponse({messages:[]});
 };
 const prepare=async message=>({id:message.id,text:mail[message.id],date:1000,fingerprint:message.id,sender_domain:'cyclingbrand.example',warnings:[]});
 const line=(order,product)=>withBasis({kind:'purchased',existing_item_id:null,evidence:'Order '+order,merchant:fact('Cycling Brand'),order_reference:fact(order),product:fact(product),sku:fact(null),brand:fact('Cycling Brand'),color:fact(null),size_label:fact('M'),size_system:fact(null),quantity:fact(null),units_per_pack:fact(null),unit_price:fact(null),currency:fact(null),recipient:{value:'unknown',quote:null}});
 const interpret=async r=>r.schema===RECEIPT_SCHEMA?{events:r.context.source.id==='c1'?[line('#CB1001','Thermal Jersey')]:[line('#CB0042','Bib Shorts')]}:r.schema===TRIAGE_SCHEMA?{decisions:r.context.emails.map(e=>({id:e.id,action:'extract'}))}:{questions:[]};
 let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),scan_version:SCAN_VERSION,job:newImportJob()}};
 for(let i=0;i<120&&row.data.job.status!=='ready';i++)row=await step(row,{fetcher,prepare,interpret});
 assert.equal(row.data.job.status,'ready');
 assert.deepEqual(itemsOf(row).map(i=>i.product).sort(),['Bib Shorts','Thermal Jersey']);
 assert.deepEqual(row.data.job.stores_searched,['cyclingbrand.example']);
 assert.equal(queries.filter(q=>q.includes('from:cyclingbrand.example')&&!q.includes('filename:pdf')).length,1,'searched once, not again by the later store stage');
});
test('searches ask Gmail for large pages when earlier imports read many emails, and progress reports them',async()=>{
 const sizes=[];const fetcher=async url=>{const u=new URL(url);sizes.push(u.searchParams.get('maxResults'));return jsonResponse({messages:[{id:'r1'}]});};
 const job=newImportJob();let row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),scan_version:SCAN_VERSION,scanned_ids:['r1'],job}};
 row=await step(row,{fetcher});assert.equal(sizes[0],'500');assert.equal(row.data.job.status,'listing');
 assert.equal(publicImport(row,row.receipts).already_read,1);
 const fresh={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:newImportJob()}};
 sizes.length=0;await step(fresh,{fetcher});assert.equal(sizes[0],'50');
});
test('an import stores the order photo the email contained, once, and re-reads older emails once for photos',async()=>{
 const {default:sharp}=await import('sharp');
 const photo=await sharp({create:{width:400,height:500,channels:3,background:'#eee'}}).png().toBuffer();
 const media={source:'order_email',candidates:[{ref:0,image:'https://cdn.shop.example/jeans.jpg',alt:'Jeans',link:'https://shop.example/products/jeans'}]};
 let images=0,seen=null;
 const fetcher=async url=>{if(String(url).startsWith('https://cdn.shop.example/')){images++;return new Response(photo,{status:200,headers:{'Content-Type':'image/png'}});}return jsonResponse({id:'m1',payload:{}});};
 const interpret=async r=>{if(r.schema===TRIAGE_SCHEMA)return {decisions:[]};seen=r.context.source;return {events:[receipt({photo_ref:0,link_ref:0})]};};
 const fresh={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['m1']}}};
 const row=await step(fresh,{fetcher,prepare:async()=>({...source,media,warnings:[]}),interpret});
 assert.deepEqual(seen.media_candidates,[{ref:0,kind:'image',text:'Jeans',link:'shop.example/products/jeans'}]);assert.equal(seen.media,undefined);
 assert.equal(itemsOf(row)[0].order_photo.url,media.candidates[0].image);assert.equal(itemsOf(row)[0].product_link,media.candidates[0].link);
 const stored=row.rows.filter(r=>r.kind==='photo_observation');
 assert.deepEqual(stored.map(r=>[r.id,r.data.item_id,r.data.photo_source,r.data.mime_type]),[['order_photo:'+itemsOf(row)[0].id,itemsOf(row)[0].id,'order_email','image/jpeg']]);
 assert.equal(images,1);assert.equal(row.data.sources[0].media,undefined);assert.equal(row.data.sources[0].photo_version,PHOTO_VERSION);
 // An email read before photos existed (prices already read) is re-read once, for photos only.
 const older={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:reconcileReceipt(emptyReceiptState('owner'),source,{events:[receipt()]}).state,scan_version:SCAN_VERSION,
  sources:[{id:'m1',date:1000,fingerprint:'synthetic',shopping_evidence:true,price_version:PRICE_VERSION}],job:{...newImportJob(),status:'extracting',ids:['m1']}}};
 const reread=await step(older,{fetcher,prepare:async()=>({...source,media,warnings:[]}),interpret});
 assert.equal(itemsOf(reread).length,1);assert.equal(itemsOf(reread)[0].order_photo.url,media.candidates[0].image);assert.equal(images,2);
 assert.equal(reread.data.sources[0].photo_version,PHOTO_VERSION);assert.equal(reread.data.job.quality.media_reread,1);
 const again=await step({...reread,data:{...reread.data,job:{...newImportJob(),status:'extracting',ids:['m1']}}},{fetcher,prepare:async()=>({...source,media,warnings:[]}),interpret:()=>assert.fail()});
 assert.equal(images,2);assert.equal(again.rows.filter(r=>r.kind==='photo_observation').length,1);
});
