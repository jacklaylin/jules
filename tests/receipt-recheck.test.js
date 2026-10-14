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
