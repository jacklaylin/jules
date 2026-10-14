import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../api/admin.js';
import {reviewEvent} from '../lib/purchase-review.js';
import {purchaseEvidence} from '../lib/receipt-extraction.js';

const owner='00000000-0000-4000-8000-000000000001';
const record=(n,values)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1700000000000+n,evidence:`${values.product} M`,values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:'Brand',color:'Black',size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+n});
function fixture(){
 let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',lease_until:null,data:{job:{status:'ready'},sources:[{id:'m1',date:1700000000001,sender_domain:'shop.example',shopping_evidence:true}],questions:[]}},rows=[record(1,{product:'Jeans'}),record(2,{product:'Jeans copy'}),record(3,{product:'Mug'})],busy=false;
 return {get rows(){return rows;},get row(){return row;},set busy(v){busy=v;},
  conversation:async id=>id===owner?{id}:null,gmailImport:async()=>structuredClone(row),evidence:async()=>structuredClone(rows),
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,data,token,evidence=[])=>{if(revision!==row.revision)return false;busy=false;row={...row,data:structuredClone(data),token_ciphertext:token};rows.push(...evidence.filter(e=>!rows.some(r=>r.id===e.id)));return true;}};
}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
const post=input=>({method:'POST',url:'/api/admin',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({conversation:owner,...input}));}});
const call=async(store,req,auth=200)=>{const res=response();await createAdminHandler({auth:async()=>auth,storeFactory:()=>store})(req,res);return res;};
const item=(res,id)=>res.body.items.find(i=>i.id===id);

test('the owner browses purchase history with evidence, email metadata and review status',async()=>{
 const store=fixture(),res=await call(store,{method:'GET',url:`/api/admin?view=purchases&conversation=${owner}`,headers:{}});
 assert.equal(res.statusCode,200);assert.equal(res.body.items.length,3);
 const jeans=item(res,'item-1');assert.equal(jeans.events[0].evidence,'Jeans M');assert.deepEqual(jeans.emails,[{id:'m1',date:1700000000001,sender_domain:'shop.example'}]);
 assert.equal(jeans.removed,false);assert.deepEqual(jeans.reviews,[]);
 assert.equal((await call(store,{method:'GET',url:`/api/admin?view=purchases&conversation=${owner}`,headers:{}},401)).statusCode,401);
});
test('labelled corrections become operator evidence and change only the chosen items',async()=>{
 const store=fixture();
 let res=await call(store,post({action:'review',item_ids:['item-3'],reason:'not_apparel',note:'A coffee mug'}));
 assert.equal(res.statusCode,200);assert.equal(item(res,'item-3').removed,true);assert.equal(item(res,'item-1').removed,false);
 const correction=store.rows.find(r=>r.kind==='correction');
 assert.equal(correction.recorded_by,'operator');assert.equal(correction.source.type,'operator_review');assert.deepEqual(correction.data.review,{reason:'not_apparel',note:'A coffee mug'});
 res=await call(store,post({action:'review',item_ids:['item-1'],reason:'wrong_details',values:{size_label:'L',quantity:'2'}}));
 assert.equal(item(res,'item-1').size_label,'L');assert.equal(item(res,'item-1').quantity,2);assert.equal(item(res,'item-1').original.size_label,'M');
 res=await call(store,post({action:'review',item_ids:['item-2'],reason:'duplicate',target_item_id:'item-1'}));
 assert.equal(item(res,'item-2').duplicate_of,'item-1');
 res=await call(store,post({action:'review',item_ids:['item-1'],reason:'recipient',recipient:'other',recipient_label:'Partner'}));
 assert.deepEqual(item(res,'item-1').recipient,{value:'other',label:'Partner',basis:'user'});
 res=await call(store,post({action:'review',item_ids:['item-3'],reason:'correct'}));
 assert.equal(item(res,'item-3').removed,false);assert.equal(item(res,'item-3').confirmed,true);
 assert.deepEqual(item(res,'item-3').reviews.map(r=>r.reason),['not_apparel','correct']);
});
test('invalid or conflicting reviews are refused without changing history',async()=>{
 const store=fixture(),before=store.rows.length;
 for(const input of [{reason:'love_it'},{reason:'wrong_details',values:{}},{reason:'wrong_details',values:{merchant:'Other'}},{reason:'duplicate',target_item_id:'item-1'},{reason:'recipient',recipient:'everyone'},{reason:'correct',item_ids:['foreign']},{reason:'correct',note:'x'.repeat(501)}]){
  const res=await call(store,post({action:'review',item_ids:['item-1'],...input}));assert.equal(res.statusCode,400,JSON.stringify(input));assert.ok(res.body.error);
 }
 assert.equal(store.rows.length,before);assert.equal(store.row.lease_until,null);
 store.busy=true;const res=await call(store,post({action:'review',item_ids:['item-1'],reason:'correct'}));assert.equal(res.statusCode,409);assert.match(res.body.error,/busy/);
});
test('missed purchases are recorded with the import for measuring what reading misses',async()=>{
 const store=fixture();
 let res=await call(store,post({action:'missed',store:'SSENSE',when:'March 2025',description:'Our Legacy jeans, 32'}));
 assert.equal(res.statusCode,200);assert.equal(res.body.missed.length,1);assert.equal(res.body.missed[0].store,'SSENSE');
 res=await call(store,post({action:'missed',store:'',description:'x'}));assert.equal(res.statusCode,400);
});
test('review events are built from structured choices, never from note wording',()=>{
 const event=reviewEvent(owner,{item_ids:['a'],reason:'not_a_purchase',note:'actually this was a duplicate, for my partner'},'2026-10-14T00:00:00.000Z');
 assert.equal(event.action,'dispute_purchase');assert.equal(event.value,undefined);assert.equal(event.target_item_id,undefined);
});
