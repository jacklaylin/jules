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
  assert.deepEqual(HISTORY_ORIGINS,['gmail','shop','chat_screenshot','wishlist_purchase']);assert.equal(CONNECTED_SOURCES.shop,SHOP_SOURCE);
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
    list:async credential=>{assert.deepEqual(credential,{key:'k'});return {records:[{id:'example:R-9',date:1,text}],listing:null};}};
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
  assert.deepEqual(off.data.connections.shop,{seen:['shop:1'],reads:[],listing:null,status:'not_connected',error:null});assert.deepEqual(off.evidence,[]);
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

test('Shop records hide internal IDs from the model and keep a summary without personal details',()=>{
  const order={id:'gid://shopify/Order/9',name:'#1001',uuid:'01a0b556-2447-7954-a6f7-f403698ac46c',created_at:'2026-05-01T00:00:00Z',shop:{name:'Kith'},
    shipping_address:{name:'Pat Example',address1:'1 Main St'},customer:{email:'pat@example.test'},tracking_number:'1ZY24B160233958543',line_items:[{title:'LAX Tee',variant_title:'M',quantity:1}]};
  const record=orderSource(order,'orders');
  assert.equal(record.id,'shop:gid://shopify/Order/9');assert.equal(record.kind,'orders');
  assert.ok(!record.text.includes('01a0b556')&&!record.text.includes('gid://'));assert.match(record.text,/\[Shop internal ID\]/);assert.match(record.text,/#1001/);
  assert.match(record.summary,/LAX Tee/);assert.match(record.summary,/Kith/);
  for(const personal of ['Pat Example','1 Main St','pat@example.test','01a0b556','1ZY24B160233958543'])assert.ok(!record.summary.includes(personal),personal);
});

const gmailCoat=()=>{
  const text='FARFETCH order 5M7KZR confirmed: Our Legacy Slack trousers size 48 quantity 1';
  return reconcileReceipt(emptyReceiptState('owner'),{id:'email-1',date:Date.parse('2026-03-01'),text},{events:[{kind:'purchased',basis:{value:'order_confirmation',quote:'order 5M7KZR confirmed'},category:'clothing',existing_item_id:null,evidence:'Our Legacy Slack trousers',
    merchant:fact('FARFETCH'),order_reference:fact('5M7KZR'),product:fact('Slack trousers'),sku:fact(null),brand:fact('Our Legacy'),color:fact(null),size_label:fact('48'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),recipient:{value:'unknown',quote:null}}]}).state;
};
const shopCopy=(date,store='Farfetch')=>({id:'shop:o1',date:Date.parse(date),text:JSON.stringify({shop:{name:store},line_items:[{title:'Our Legacy Slack Trousers'}],id:'[Shop internal ID]'})});
const shopEvent=existing=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Farfetch'},category:'clothing',existing_item_id:existing,evidence:'Our Legacy Slack Trousers',
  merchant:fact('Farfetch'),order_reference:fact(null),product:fact('Our Legacy Slack Trousers'),sku:fact(null),brand:fact(null),color:fact(null),size_label:fact(null),size_system:fact(null),quantity:fact(null),units_per_pack:fact(null),recipient:{value:'unknown',quote:null}});

test('a Shop copy of a Gmail order links to the same item even without the store’s order number',async()=>{
  const state=gmailCoat(),existing=state.items[0].id,offered=[];
  const interpret=async({context,schema})=>{if(!schema.properties.events)return {questions:[]};offered.push(context.existing_items.map(i=>i.id));return {events:[shopEvent(context.existing_items[0]?.id??null)]};};
  const data={connections:{shop:{status:'extracting',credential:'sealed',queue:[{...shopCopy('2026-03-03'),kind:'orders',summary:'{}'}]}}};
  const next=await connectionAction(SHOP_SOURCE,'step',{...ctx(data,{interpret}),state});
  assert.deepEqual(offered,[[existing]],'the same store within the window is offered to the model');
  assert.equal(next.state.items.length,1,'no duplicate');assert.ok(next.state.items[0].source_ids.includes('shop:o1'));
  assert.deepEqual(next.data.connections.shop.reads.map(r=>[r.status,r.purchases,r.linked]),[['read',1,1]]);
});

test('without a shared order number, matching never reaches another store, a distant date or Gmail-to-Gmail links',()=>{
  const state=gmailCoat(),existing=state.items[0].id;
  assert.throws(()=>reconcileReceipt(state,shopCopy('2026-06-01'),{events:[shopEvent(existing)]},{matchWindowDays:14}),/Order identity mismatch/);
  assert.throws(()=>reconcileReceipt(state,shopCopy('2026-03-03','Ssense'),{events:[{...shopEvent(existing),basis:{value:'order_confirmation',quote:'Ssense'},merchant:fact('Ssense')}]},{matchWindowDays:14}),/Order identity mismatch/);
  assert.throws(()=>reconcileReceipt(state,shopCopy('2026-03-03'),{events:[shopEvent(existing)]}),/Order identity mismatch/,'off by default (Gmail)');
  assert.equal(reconcileReceipt(state,shopCopy('2026-03-03'),{events:[shopEvent(existing)]},{matchWindowDays:14}).state.items.length,1);
});

test('re-reading lists everything again and asks for the source’s earlier evidence to be replaced',async()=>{
  const fetcher=async()=>({ok:true,status:200,json:async()=>({result:{structuredContent:{orders:[order],pagination:{has_next_page:false}}}})});
  const data={connections:{shop:{credential:sealToken({access_token:'a'},'owner',env),seen:[orderSource(order).id],status:'ready',reads:[{id:'x'}],withheld:2}}};
  assert.equal((await connectionAction(SHOP_SOURCE,'import',ctx(data,{fetcher}))).data.connections.shop.status,'ready','a plain import skips records already read');
  const next=await connectionAction(SHOP_SOURCE,'reread',ctx(data,{fetcher}));
  const c=next.data.connections.shop;
  assert.equal(next.clear_origin,'shop');assert.equal(c.status,'extracting');assert.equal(c.queue.length,1);assert.deepEqual(c.reads,[]);assert.equal(c.withheld,0);
  assert.equal(c.listing.stop,'no_more_pages');
});

test('the handler replaces a source’s evidence on re-read and keeps Gmail evidence',async()=>{
  let row={conversation_id:'owner',revision:1,token_ciphertext:null,data:{connections:{shop:{credential:sealToken({access_token:'a'},'owner',env),status:'ready'}}}},rows=[{id:'gmail:1',origin:'gmail'},{id:'shop:1',origin:'shop'}];
  const store={onboardingSession:async()=>({}),claimGmailImport:async()=>{row.revision++;return structuredClone(row);},finishGmailImport:async(_o,_r,data)=>{row={...row,data};return true;},
    deleteEvidence:async(_o,origin)=>{rows=rows.filter(r=>r.origin!==origin);},evidence:async()=>structuredClone(rows.filter(r=>r.kind)),profile:async()=>({facts:[]})};
  const fetcher=async()=>({ok:true,status:200,json:async()=>({result:{structuredContent:{orders:[order],pagination:{has_next_page:false}}}})});
  const handler=createGmailHandler({env,storeFactory:()=>store,auth:async()=>({status:200,conversation:'owner'}),fetcher});
  const response=res();await handler(req({action:'connection-reread',source:'shop'}),response);
  assert.equal(response.statusCode??200,200);assert.deepEqual(rows.map(r=>r.id),['gmail:1']);assert.equal(row.data.connections.shop.status,'extracting');
});

test('admin review labels each item’s sources and reports what each connected source returned',async()=>{
  const {purchaseReview}=await import('../lib/purchase-review.js');
  const state=gmailCoat();
  const linked=reconcileReceipt(state,shopCopy('2026-03-03'),{events:[shopEvent(state.items[0].id)]},{matchWindowDays:14});
  const evidence=[...linked.records].map(r=>r);
  const {purchaseEvidence,sourceEvidence}=await import('../lib/receipt-extraction.js');
  const first=reconcileReceipt(emptyReceiptState('owner'),{id:'email-1',date:Date.parse('2026-03-01'),text:'FARFETCH order 5M7KZR confirmed: Our Legacy Slack trousers size 48 quantity 1'},{events:[{kind:'purchased',basis:{value:'order_confirmation',quote:'order 5M7KZR confirmed'},category:'clothing',existing_item_id:null,evidence:'Our Legacy Slack trousers',merchant:fact('FARFETCH'),order_reference:fact('5M7KZR'),product:fact('Slack trousers'),sku:fact(null),brand:fact('Our Legacy'),color:fact(null),size_label:fact('48'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),recipient:{value:'unknown',quote:null}}]});
  const rows=[...first.records.map(r=>purchaseEvidence(r)),...evidence.map(r=>sourceEvidence('shop','shop_order',r))];
  const row={conversation_id:'owner',data:{sources:[{id:'email-1',date:1,sender_domain:'farfetch.com'}],connections:{shop:{status:'ready',found:18,processed:18,listing:{from:'2021-10-14',total:18,stop:'no_more_pages',pages:[{lists:{orders:18},has_next_page:false,cursor:false,pagination_keys:['has_next_page'],messages:[]}]},reads:[{id:'shop:o1',status:'read',purchases:1,linked:1}]}}}};
  const review=await purchaseReview({gmailImport:async()=>row,evidence:async()=>structuredClone(rows)},'owner');
  assert.equal(review.items.length,1);assert.deepEqual(review.items[0].sources,['gmail','shop']);
  assert.deepEqual(review.items[0].emails.map(e=>e.id),['email-1'],'only Gmail records are listed as emails');
  assert.deepEqual(review.items[0].events.map(e=>e.source),['gmail','shop']);
  assert.equal(review.connections[0].label,'Shop');assert.equal(review.connections[0].listing.stop,'no_more_pages');assert.equal(review.connections[0].reads[0].linked,1);
});
test('connecting Shop hands approval and reading to the background chain that already runs Gmail',async()=>{
  let row={conversation_id:'owner',revision:1,token_ciphertext:'gmail-sealed',data:{job:{status:'extracting',worker:'gmail-chain'},worker:'gmail-chain'}};const scheduled=[];
  const store={onboardingSession:async()=>({}),ensureGmailImport:async()=>{},claimGmailImport:async()=>{row.revision++;return structuredClone(row);},
    finishGmailImport:async(_o,_r,data)=>{row={...row,data};return true;},evidence:async()=>[],profile:async()=>({facts:[]})};
  const fetcher=async()=>({ok:true,json:async()=>({device_code:'secret-device',user_code:'WXYZ-1234',verification_uri_complete:'https://shop.app/activate?code=WXYZ',interval:5,expires_in:600})});
  const handler=createGmailHandler({env,storeFactory:()=>store,auth:async()=>({status:200,conversation:'owner'}),fetcher,schedule:(owner,worker)=>scheduled.push(worker)});
  const response=res();await handler(req({action:'connection-connect',source:'shop',consent:SHOP_CONSENT_VERSION}),response);
  assert.equal(response.statusCode,200);assert.equal(row.data.connections.shop.status,'awaiting_approval');
  assert.notEqual(row.data.worker,'gmail-chain','the older chain stops');assert.equal(row.data.job.worker,row.data.worker,'one chain carries Gmail and Shop');
  assert.deepEqual(scheduled,[row.data.worker]);assert.ok(JSON.parse(response.value).background);
});
test('the account page gets result counts and the date range Shop shared, without record details',()=>{
  const view=publicConnection({credential:'sealed',status:'ready',found:23,processed:23,reads:[
    {id:'a',date:Date.parse('2026-09-15'),purchases:0,linked:0,summary:'{"private":"x"}'},{id:'b',date:Date.parse('2026-10-07'),purchases:2,linked:1},{id:'c',date:null,purchases:0}]});
  assert.equal(view.purchases,2);assert.equal(view.linked,1);
  assert.equal(view.oldest.slice(0,10),'2026-09-15');assert.equal(view.newest.slice(0,10),'2026-10-07');
  assert.ok(!JSON.stringify(view).includes('private'),'summaries stay internal');
});
