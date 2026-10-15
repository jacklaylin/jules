import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecheckHandler,judgeLabel} from '../lib/receipt-recheck.js';
import {purchaseEvidence,correctionEvidence} from '../lib/receipt-extraction.js';
import {sealToken} from '../lib/gmail-client.js';

const owner='00000000-0000-4000-8000-000000000001';
const env={GMAIL_IMPORT_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'c',GOOGLE_GMAIL_CLIENT_SECRET:'s',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const tokens={access_token:'a',refresh_token:'r',expires_at:Date.now()+3600000};
const values=v=>({merchant:'SSENSE',order_reference:null,sku:null,brand:'Our Legacy',color:'Black',size_label:'IT 48',size_system:null,quantity:1,units_per_pack:null,...v});
const purchase=(n,v)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1,evidence:v.product,values:values(v),item_id:'item-'+n});
const label=(n,reason,extra={})=>correctionEvidence({id:'operator:'+n,owner_id:owner,source:'operator_review',at:'2026-10-14T00:00:00Z',item_ids:['item-'+n],action:{not_a_purchase:'dispute_purchase',correct:'restore_purchase',duplicate:'mark_duplicate',wrong_details:'correct_fields'}[reason],review:{reason,note:null},...extra});
const texts={m1:'SSENSE: Still thinking about it? Black Slack Trousers Size: IT 48',m2:'Order confirmed #9 Blue Third Cut Jeans 32 SSENSE',m3:'Order confirmed #7 Jeans size 33'};
function store(rows){return {gmailImport:async()=>({conversation_id:owner,token_ciphertext:sealToken(tokens,owner,env),data:{questions:[]}}),evidence:async()=>rows};}
const fetcher=async url=>new Response(JSON.stringify({id:url.match(/messages\/([^?]+)/)[1],payload:{}}),{status:200,headers:{'Content-Type':'application/json'}});
const prepare=async m=>({id:m.id,text:texts[m.id],date:1,fingerprint:m.id,warnings:[]});
const fact=v=>({value:v,quote:v});
const event=(product,extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Order confirmed'},category:'clothing',existing_item_id:null,evidence:product,merchant:fact('SSENSE'),order_reference:fact(null),product:fact(product),sku:fact(null),brand:fact(null),color:fact(null),size_label:fact(null),size_system:fact(null),quantity:fact(null),units_per_pack:fact(null),recipient:{value:'unknown',quote:null},...extra});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.body=JSON.parse(b);}});
const post=body=>({method:'POST',url:'/api/wishlist?gmail=recheck',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({conversation:owner,...body}));}});
async function run(rows,item_id,interpret,admin=200){const res=response();await createRecheckHandler({env,storeFactory:()=>store(rows),admin:async()=>admin,fetcher,prepare,interpret})(post({item_id}),res);return res;}

test('re-check re-reads a labelled email with current rules and reports agreement without saving',async()=>{
 const rows=[purchase(1,{product:'Black Slack Trousers'}),label(1,'not_a_purchase'),purchase(2,{product:'Blue Third Cut Jeans',size_label:'32'}),label(2,'correct')];
 // The cart email is now classified as marketing and rejected; the real order is still found.
 const interpret=async r=>r.context.source.id==='m1'?{events:[event('Black Slack Trousers',{basis:{value:'cart_or_marketing',quote:'Still thinking about it?'}})]}:{events:[event('Blue Third Cut Jeans',{size_label:fact('32')})]};
 let res=await run(rows,'item-1',interpret);assert.equal(res.statusCode,200);assert.equal(res.body.match,true);assert.equal(res.body.found.length,0);assert.match(res.body.withheld[0].reason,/Not a buyer transaction/);
 res=await run(rows,'item-2',interpret);assert.equal(res.body.match,true);assert.equal(res.body.found[0].category,'clothing');
 // Old behavior (accepting the cart email) disagrees with the label.
 res=await run(rows,'item-1',async()=>({events:[event('Black Slack Trousers',{basis:{value:'order_confirmation',quote:'Still thinking about it?'}})]}));assert.equal(res.body.match,false);
});
test('re-check is owner-only and needs a labelled item',async()=>{
 const rows=[purchase(1,{product:'Black Slack Trousers'})];
 assert.equal((await run(rows,'item-1',()=>assert.fail(),403)).statusCode,403);
 const res=await run(rows,'item-1',()=>assert.fail());assert.equal(res.statusCode,400);
});
test('labels are judged by structured outcome: removal, duplicates and corrected details',()=>{
 const item={product:'Linen SS Cloak Button Up / Black',sku:null,confirmed_fields:['size_label'],size_label:'L'};
 assert.equal(judgeLabel({reason:'not_apparel'},item,[]).match,true);
 assert.equal(judgeLabel({reason:'not_apparel'},item,[{product:'Linen SS Cloak Button Up'}]).match,false);
 assert.equal(judgeLabel({reason:'duplicate'},item,[{product:'Linen SS Cloak Button Up / Black'}],{product:'Linen SS Cloak Button Up / Black - Linen SS Cloak Button Up / Black / 3'}).match,true);
 assert.equal(judgeLabel({reason:'duplicate'},item,[{product:'Linen SS Cloak Button Up / Black'},{product:'Linen SS Cloak Button Up / Black / 3'}]).match,false);
 assert.equal(judgeLabel({reason:'wrong_details'},item,[{product:'Linen SS Cloak Button Up / Black',size_label:'M'}]).match,false);
 assert.equal(judgeLabel({reason:'wrong_details'},item,[{product:'Linen SS Cloak Button Up / Black',size_label:'l'}]).match,true);
});

// Skipped-email review
import {storeDomain} from '../lib/receipt-recheck.js';
function mailbox({account='owner@example.test',labels=[]}={}){
 let row={conversation_id:owner,revision:1,token_ciphertext:sealToken(tokens,owner,env),data:{account,job:{after:1,before:2},sources:[{id:'s1',sender_domain:'m.ssense.com',shopping_evidence:true}],scanned_ids:['k1','k2','r1','r2','r3'],triage_labels:labels,questions:[]}},busy=false;
 return {get row(){return row;},gmailImport:async()=>structuredClone(row),evidence:async()=>[],claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,r,data,token)=>{if(r!==row.revision)return false;busy=false;row={...row,data,token_ciphertext:token};return true;}};
}
const ownerEnv={...env,ADMIN_EMAIL:'Owner@example.test'};
const gmail=async url=>{
 const json=v=>new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}});
 if(url.includes('messages?'))return json({messages:[{id:'k1'},{id:'s1'},{id:'k2'}]});
 const id=url.match(/messages\/([^?]+)/)[1];
 return json({id,internalDate:'1700000000000',snippet:'',payload:{headers:[{name:'From',value:`Store <orders@${id.startsWith('k')?'ssense.com':'news.example'}>`},{name:'Subject',value:`Subject ${id}`}]}});
};
async function skippedCall(store,body,{admin=200,interpret}={}){const res=response();await createRecheckHandler({env:ownerEnv,storeFactory:()=>store,admin:async()=>admin,fetcher:gmail,prepare,interpret})(post(body),res);return res;}
test('skipped-email sample lists skipped emails from known stores first, then a random sample, with subjects fetched on demand',async()=>{
 const store=mailbox();assert.equal(storeDomain('m.ssense.com'),'ssense.com');assert.equal(storeDomain('mail.shop.co.uk'),'shop.co.uk');
 const res=await skippedCall(store,{action:'skipped_list'});
 assert.equal(res.statusCode,200);assert.deepEqual(res.body.emails.filter(e=>e.group==='known_store').map(e=>e.id),['k1','k2']);
 assert.deepEqual(res.body.emails.filter(e=>e.group==='random').map(e=>e.id).sort(),['r1','r2','r3']);
 assert.equal(res.body.emails[0].subject,'Subject k1');assert.equal(res.body.skipped_total,5);
 assert.ok(!JSON.stringify(store.row.data).includes('Subject'),'subjects are never stored');
});
test('skipped-email review is limited to the owner’s own mailbox',async()=>{
 const res=await skippedCall(mailbox({account:'tester@example.test'}),{action:'skipped_list'});
 assert.equal(res.statusCode,403);assert.match(res.body.error,/own mailbox/);
 assert.equal((await skippedCall(mailbox(),{action:'skipped_list'},{admin:401})).statusCode,401);
});
test('labels keep only id, label and domain, can be changed or cleared, and must point at a skipped email',async()=>{
 const store=mailbox();
 assert.equal((await skippedCall(store,{action:'skipped_label',email_id:'k1',label:'missed_order',sender_domain:'ssense.com'})).body.labelled,1);
 await skippedCall(store,{action:'skipped_label',email_id:'k1',label:'not_order',sender_domain:'ssense.com'});
 assert.deepEqual(store.row.data.triage_labels.map(({id,label,sender_domain})=>({id,label,sender_domain})),[{id:'k1',label:'not_order',sender_domain:'ssense.com'}]);
 await skippedCall(store,{action:'skipped_label',email_id:'k1',label:null});assert.deepEqual(store.row.data.triage_labels,[]);
 assert.equal((await skippedCall(store,{action:'skipped_label',email_id:'s1',label:'missed_order'})).statusCode,400);
 assert.equal((await skippedCall(store,{action:'skipped_label',email_id:'k1',label:'maybe'})).statusCode,400);
});
test('re-checking a missed order reports whether triage now reads it and whether a purchase is found',async()=>{
 const store=mailbox({labels:[{id:'k1',label:'missed_order',sender_domain:'ssense.com'},{id:'r1',label:'not_order',sender_domain:'news.example'}]});
 texts.k1='SSENSE Order confirmed #9 Blue Third Cut Jeans 32';texts.r1='Newsletter';
 const reads=async r=>r.schema.properties.decisions?{decisions:r.context.emails.map(e=>({id:e.id,action:e.id==='k1'?'extract':'skip'}))}:{events:r.context.source.id==='k1'?[event('Blue Third Cut Jeans')]:[]};
 let res=await skippedCall(store,{action:'skipped_recheck',email_id:'k1'},{interpret:reads});
 assert.equal(res.body.triage,'extract');assert.equal(res.body.match,true);assert.equal(res.body.found[0].product,'Blue Third Cut Jeans');
 res=await skippedCall(store,{action:'skipped_recheck',email_id:'r1'},{interpret:reads});assert.equal(res.body.match,true);assert.equal(res.body.triage,'skip');
 // Triage still skipping a labelled order is a disagreement, even if reading alone would find it.
 res=await skippedCall(store,{action:'skipped_recheck',email_id:'k1'},{interpret:async r=>r.schema.properties.decisions?{decisions:[{id:'k1',action:'skip'}]}:{events:[event('Blue Third Cut Jeans')]}});
 assert.equal(res.body.match,false);assert.match(res.body.explanation,/Triage still skips/);
});
