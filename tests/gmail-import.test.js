import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {GMAIL_SCOPE,sealToken,openToken,authorizationURL,digest} from '../lib/gmail-client.js';
import {receiptHTML,prepareReceiptEmail,receiptPDF} from '../lib/receipt-email.js';
import {RECEIPT_SCHEMA,reconcileReceipt,emptyReceiptState,projectReceiptState,relinkPending,receiptShoppingFacts} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback,receiptLearningView} from '../lib/receipt-feedback.js';
import {newImportJob,importStep,createGmailHandler,publicImport,CONSENT_VERSION} from '../lib/gmail-import.js';
import {loadReceipts} from '../lib/evidence.js';
const env={GMAIL_IMPORT_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'synthetic-client',GOOGLE_GMAIL_CLIENT_SECRET:'synthetic-secret',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const tokens={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000};
const text='Shop Order O1 Jeans Blue 31 Brand quantity 1 purchased';
const source={id:'m1',text,date:1000,fingerprint:'synthetic'};
const fact=value=>({value,quote:value});
const receipt=(extra={})=>({kind:'purchased',existing_item_id:null,evidence:'purchased',merchant:fact('Shop'),order_reference:fact('O1'),product:fact('Jeans'),sku:fact(null),brand:fact('Brand'),color:fact('Blue'),size_label:fact('31'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),...extra});
const jsonResponse=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
function storage(){let row=null,nonce=null,busy=false,rows=[];const self={
 onboardingSession:async()=>({state:'accepted'}),wishlistMember:async email=>email==='tester@example.test'?{conversation_id:'owner'}:null,
 gmailImport:async()=>row?structuredClone(row):null,
 beginGmailOAuth:async(owner,hash)=>{row??={conversation_id:owner,revision:0,data:{},token_ciphertext:null};nonce=hash;return true;},
 consumeGmailOAuth:async hash=>{if(hash!==nonce)return null;nonce=null;return row.conversation_id;},
 claimGmailImport:async()=>{if(busy||!row)return null;busy=true;row.revision++;return structuredClone(row);},
 finishGmailImport:async(owner,revision,data,token,evidence=[],clear=false)=>{if(owner!==row.conversation_id||revision!==row.revision)return false;row.data=structuredClone(data);row.token_ciphertext=token;busy=false;
  if(clear)rows=rows.filter(r=>r.origin!=='gmail');for(const e of evidence)if(!rows.some(r=>r.id===e.id))rows.push(structuredClone(e));return true;},
 evidence:async(_owner,origin)=>structuredClone(rows.filter(r=>!origin||r.origin===origin)),get rows(){return rows;},
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
test('email preparation preserves plain, HTML tables, unnamed PDF and reference evidence',async()=>{
 const m={id:'m',internalDate:'1000',payload:{headers:[{name:'From',value:'Shop <sales@shop.example>'},{name:'Subject',value:'Order O1'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Jeans size 31').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<script>ignore me</script><table><tr><td>Blue</td><td>32</td></tr></table><a href="https://shop.example/?order_id=O1&amp;token=secret">Order</a>').toString('base64url')}},{mimeType:'application/pdf',body:{data:Buffer.from('%PDF-synthetic').toString('base64url')}}]}};
 const prepared=await prepareReceiptEmail(m,tokens,{pdf:async()=> 'Receipt O1 Brand'});assert.ok(prepared.text.includes('Jeans size 31'));assert.ok(prepared.text.includes('Blue | 32'));assert.ok(prepared.text.includes('Receipt O1 Brand'));assert.ok(!prepared.text.includes('ignore me'));assert.ok(!prepared.text.includes('secret'));assert.equal(prepared.pdf_count,1);
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
 for(const change of [{existing_item_id:'foreign'},{existing_item_id:id,size_label:fact('32')},{existing_item_id:id,order_reference:fact('O2')},{brand:fact('invented')}])assert.throws(()=>reconcileReceipt(state,{...source,text:text+' 32 O2'},{events:[receipt(change)]}));assert.equal(state.items.length,1);
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
 assert.equal(next.data.sources[0].text,text);assert.equal(next.data.changed_sources[0].text,'Changed receipt');assert.deepEqual(next.data.job.processed,['m1']);assert.equal(publicImport(next,next.receipts).changed_sources,1);
});
test('contact redaction preserves long receipt/order identities and omits raw credential links',async()=>{
 const {redactReceiptText}=await import('../lib/receipt-email.js');const redacted=redactReceiptText('Order: 1234567890123456\nPhone: +1 555 123 4567\ncard: 4111 1111 1111 1111\npassword: secretvalue\nhttps://shop.example/login?token=private');
 assert.ok(redacted.includes('Order: 1234567890123456'));assert.ok(!redacted.includes('555'));assert.ok(!redacted.includes('4111'));assert.ok(!redacted.includes('secretvalue'));assert.ok(!redacted.includes('token=private'));
});
test('a malformed event is withheld without dropping supported purchase evidence from the same email',async()=>{
 const row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['m1']}}};
 const next=await step(row,{fetcher:async()=>jsonResponse({id:'m1',payload:{}}),prepare:async()=>({...source,warnings:[]}),interpret:async()=>({events:[receipt({brand:fact('invented')}),receipt()]})});
 assert.equal(itemsOf(next).length,1);assert.equal(itemsOf(next)[0].source_events[0].id,'m1:1');assert.equal(next.data.sources[0].warnings.length,1);assert.deepEqual(next.data.job.processed,['m1']);
});
test('expanding an existing connection requires new consent and leaves its saved evidence intact',async()=>{
 const store=storage();store.seed({conversation_id:'owner',revision:0,token_ciphertext:sealToken(tokens,'owner',env),data:{consent:{version:'gmail-receipts-90d-v1'},feedback:emptyReceiptState('owner'),sources:[source]}});
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
