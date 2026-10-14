import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {connectionAction,publicConnection,HISTORY_ORIGINS,CONNECTED_SOURCES} from '../lib/connected-sources.js';
import {SHOP_SOURCE,SHOP_CONSENT_VERSION,orderSource} from '../lib/shop-orders.js';
import {sealToken,openToken} from '../lib/gmail-client.js';
import {emptyReceiptState,reconcileReceipt,sourceEvidence,purchaseEvidence} from '../lib/receipt-extraction.js';
import {createGmailHandler} from '../lib/gmail-import.js';

const env={GMAIL_IMPORT_ENABLED:'true',SHOP_ORDERS_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'synthetic',GOOGLE_GMAIL_CLIENT_SECRET:'synthetic',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const fact=value=>({value,quote:value});
const event=(extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'#1001'},category:'clothing',existing_item_id:null,evidence:'Kith LAX Tee',merchant:fact('Kith'),order_reference:fact('#1001'),product:fact('Kith LAX Tee'),sku:fact(null),brand:fact('Kith'),color:fact('White'),size_label:fact('M'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),recipient:{value:'unknown',quote:null},...extra});
const order={id:'gid://shop/Order/1',created_at:'2026-05-01T00:00:00Z',shop:{name:'Kith'},name:'#1001',line_items:[{title:'Kith LAX Tee',variant:'White / M',quantity:1}]};
const ctx=(data,extra={})=>({data,state:emptyReceiptState('owner'),pending:[],owner:'owner',env,...extra});

test('history origins come from the registered sources, and Gmail evidence keeps its existing IDs',()=>{
  assert.deepEqual(HISTORY_ORIGINS,['gmail','shop']);assert.equal(CONNECTED_SOURCES.shop,SHOP_SOURCE);
  const record={event_id:'m1:0',source_id:'m1',evidence:'quote'};
  assert.deepEqual(purchaseEvidence(record,'model:x'),{id:'gmail:m1:0',kind:'purchase_event',origin:'gmail',source:{type:'gmail_message',id:'m1',quote:'quote'},data:record,recorded_by:'model:x'});
  assert.equal(sourceEvidence('shop','shop_order',record).id,'shop:m1:0');
});

test('a new source needs only an adapter: sign-in, listing, extraction and evidence run on the shared rails',async()=>{
  // A made-up order source, to show nothing Shop-specific is needed.
  const text='Order R-9 from Example Store: Wool Coat, Navy, size 50, quantity 1';
  const other={name:'example',origin:'example',source_type:'example_order',label:'Example',consent:'v1',enabled:()=>true,instructions:'Read the order.',
    start:async()=>({secret:'private',user_code:'CODE',verification_url:'https://example.test/approve',interval:1,expires_at:Date.now()+60000}),
    poll:async secret=>{assert.equal(secret,'private');return {status:'approved',credential:{key:'k'}};},
    list:async credential=>{assert.deepEqual(credential,{key:'k'});return [{id:'example:R-9',date:1,text}];}};
  let next=await connectionAction(other,'connect',ctx({}));
  assert.ok(!JSON.stringify(next.data).includes('private'));
  next=await connectionAction(other,'poll',ctx(next.data));
  assert.equal(next.data.connections.example.status,'extracting');
  const v=value=>({value,quote:value});
  next=await connectionAction(other,'step',ctx(next.data,{interpret:async({schema})=>schema.properties.events?{events:[{kind:'purchased',basis:{value:'order_confirmation',quote:'Order R-9'},category:'clothing',existing_item_id:null,evidence:'Wool Coat',merchant:v('Example Store'),order_reference:v('R-9'),product:v('Wool Coat'),sku:v(null),brand:v(null),color:v('Navy'),size_label:v('50'),size_system:v(null),quantity:v('1'),units_per_pack:v(null),recipient:{value:'unknown',quote:null}}]}:{questions:[]}}));
  assert.equal(next.state.items.length,1);assert.equal(next.evidence[0].origin,'example');assert.equal(next.evidence[0].source.type,'example_order');
  assert.equal(publicConnection(next.data.connections.example).status,'ready');
});

test('Shop sign-in seals the device code and only the public code reaches the page',async()=>{
  const fetcher=async()=>({ok:true,json:async()=>({device_code:'secret-device',user_code:'WXYZ-1234',verification_uri_complete:'https://shop.app/activate?code=WXYZ',interval:5,expires_in:600})});
  const next=await connectionAction(SHOP_SOURCE,'connect',ctx({},{fetcher}));
  const c=next.data.connections.shop;
  assert.equal(c.status,'awaiting_approval');assert.equal(c.consent.version,SHOP_CONSENT_VERSION);
  assert.ok(!JSON.stringify(next.data).includes('secret-device'));assert.equal(openToken(c.pending.secret,'owner',env),'secret-device');
  const visible=publicConnection(c);assert.equal(visible.user_code,'WXYZ-1234');assert.ok(!JSON.stringify(visible).includes('secret'));
});

test('approved Shop access queues orders, and an order already found in Gmail links to the same item',async()=>{
  const pending={secret:sealToken('secret-device','owner',env),user_code:'X',verification_url:'https://shop.app/a',interval:5,expires_at:Date.now()+60000};
  const fetcher=async url=>url.endsWith('/token')?{ok:true,json:async()=>({access_token:'shop-access'})}:{ok:true,status:200,json:async()=>({result:{structuredContent:{orders:[order],pagination:{has_next_page:false}}}})};
  const approved=await connectionAction(SHOP_SOURCE,'poll',ctx({connections:{shop:{pending}}},{fetcher}));
  const c=approved.data.connections.shop;
  assert.equal(c.status,'extracting');assert.equal(c.queue.length,1);
  assert.equal(openToken(c.credential,'owner',env).access_token,'shop-access');assert.ok(!JSON.stringify(publicConnection(c)).includes('shop-access'));
  // The same order was already imported from a Gmail receipt.
  const gmail=reconcileReceipt(emptyReceiptState('owner'),{id:'email-1',date:1,text:'Kith order #1001 Kith LAX Tee White M quantity 1 Kith LAX Tee'},{events:[event()]});
  const existing=gmail.state.items[0].id,seen=[];
  const step=await connectionAction(SHOP_SOURCE,'step',{...ctx(approved.data,{fetcher}),state:gmail.state,
    interpret:async({context,schema})=>{if(!schema.properties.events)return {questions:[]};seen.push(context.existing_items.map(i=>i.id));return {events:[event({existing_item_id:context.existing_items[0]?.id??null,size_label:fact(null),color:fact(null)})]};}});
  assert.deepEqual(seen,[[existing]]);
  assert.equal(step.state.items.length,1,'no duplicate item');assert.ok(step.state.items[0].source_ids.includes(orderSource(order).id));
  assert.equal(step.evidence[0].origin,'shop');assert.equal(step.data.connections.shop.status,'ready');assert.deepEqual(step.data.connections.shop.queue,[]);
});

test('a record that keeps failing is skipped after its attempts, without blocking the rest',async()=>{
  const data={connections:{shop:{status:'extracting',credential:'sealed',queue:[{id:'a',date:1,text:'A'},{id:'b',date:1,text:'Kith LAX Tee #1001'}]}}};
  const interpret=async({context,schema})=>{if(!schema.properties.events)return {questions:[]};if(context.source.id==='a')throw Error('model');return {events:[]};};
  let next=await connectionAction(SHOP_SOURCE,'step',ctx(data,{interpret}));
  assert.deepEqual(next.data.connections.shop.queue.map(r=>r.id),['a']);
  next=await connectionAction(SHOP_SOURCE,'step',ctx(next.data,{interpret}));
  assert.equal(next.data.connections.shop.status,'ready');assert.equal(next.data.connections.shop.failed,1);
});

test('a rejected credential asks to reconnect, and disconnect forgets it but keeps imported history',async()=>{
  const data={connections:{shop:{credential:sealToken({access_token:'old'},'owner',env),seen:['shop:1'],status:'ready'}}};
  const expired=await connectionAction(SHOP_SOURCE,'import',ctx(data,{fetcher:async()=>({ok:false,status:401})}));
  assert.equal(expired.data.connections.shop.status,'reconnect');assert.equal(expired.data.connections.shop.credential,null);
  const off=await connectionAction(SHOP_SOURCE,'disconnect',ctx(data));
  assert.deepEqual(off.data.connections.shop,{seen:['shop:1'],status:'not_connected',error:null});assert.deepEqual(off.evidence,[]);
});

function req(body){return Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST',url:'/api/wishlist?gmail=1',headers:{authorization:'Bearer test','content-type':'application/json',origin:'https://jules.example'}});}
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=value;}};}
test('a connected source needs its own consent and its flag, and its failure never pauses the Gmail import',async()=>{
  let row={conversation_id:'owner',revision:1,token_ciphertext:'gmail-sealed',data:{job:{status:'extracting'}}},ensured=false;
  const store={onboardingSession:async()=>({}),ensureGmailImport:async()=>{ensured=true;},claimGmailImport:async()=>{row.revision++;return structuredClone(row);},
    finishGmailImport:async(_o,_r,data)=>{row={...row,data};return true;},evidence:async()=>[],profile:async()=>({facts:[]})};
  const handler=(flags=env)=>createGmailHandler({env:flags,storeFactory:()=>store,auth:async()=>({status:200,conversation:'owner'}),fetcher:async()=>{throw Error('Shop down');}});
  let response=res();await handler({...env,SHOP_ORDERS_ENABLED:'false'})(req({action:'connection-connect',source:'shop',consent:SHOP_CONSENT_VERSION}),response);
  assert.equal(response.statusCode,400);
  response=res();await handler()(req({action:'connection-connect',source:'shop'}),response);
  assert.equal(response.statusCode,400);assert.equal(ensured,false);
  response=res();await handler()(req({action:'connection-connect',source:'shop',consent:SHOP_CONSENT_VERSION}),response);
  assert.equal(response.statusCode,503);assert.equal(ensured,true);
  assert.equal(row.data.job.error,undefined);assert.match(row.data.connections.shop.error,/didn’t finish/);
});
