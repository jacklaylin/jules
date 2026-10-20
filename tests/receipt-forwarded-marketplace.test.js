import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareReceiptEmail,triageCandidate} from '../lib/receipt-email.js';
import {reconcileReceipt,emptyReceiptState,projectReceiptState,receiptShoppingFacts} from '../lib/receipt-extraction.js';
import {receiptLearningView} from '../lib/receipt-feedback.js';
import {discoveryPlan,storeDomains} from '../lib/gmail-discovery.js';
import {newImportJob,importStep} from '../lib/gmail-import.js';
import {sealToken} from '../lib/gmail-client.js';
import {loadReceipts} from '../lib/evidence.js';

// A resale-marketplace order confirmation that someone else received and forwarded to the account
// holder from a personal mailbox. The fixture is synthetic: names, addresses and order data are invented.
const html=readFileSync(new URL('./fixtures/depop-forward.html',import.meta.url),'utf8');
const withoutFee=html.replace(/<tr data-fee>.*\n/,'').replace('$82.65','$80.00');
const TITLE='Vintage Carhartt Detroit chore coat faded brown canvas blanket lin...';
const message=(body=html,id='fwd1')=>({id,internalDate:String(Date.parse('2026-10-06T12:00:00Z')),snippet:'see below, can you keep an eye out for something like this for me too?',
 payload:{mimeType:'multipart/alternative',headers:[{name:'Subject',value:'Fwd: Your Depop order is confirmed'},{name:'From',value:'"Jordan Forwarder" <forwarder.synthetic@gmail.com>'},{name:'To',value:'Alex Owner <alex.owner@example.test>'}],
  parts:[{mimeType:'text/html',body:{size:body.length,data:Buffer.from(body).toString('base64url')}}]}});
const tokens={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000};
const prepare=body=>prepareReceiptEmail(message(body),tokens);
const fact=(value,quote=value)=>({value,quote});
const none=fact(null);
// Stubbed model output for the purchased line, shaped as RECEIPT_SCHEMA requires.
const purchase=(extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Your order is confirmed'},category:'clothing',existing_item_id:null,evidence:'Item: '+TITLE,
 merchant:fact('Depop'),order_reference:fact('SYN-0000-4471','Order number: SYN-0000-4471'),product:fact(TITLE,'Item: '+TITLE),sku:none,brand:fact('Carhartt','Item: '+TITLE),color:none,
 size_label:fact('M','Size: M'),size_system:none,quantity:none,units_per_pack:none,unit_price:fact('$65.00','Item price: $65.00'),currency:fact('$','$65.00'),
 recipient:{value:'other',quote:'shipped to Sam Example'},photo_ref:null,link_ref:null,part_of_event:null,...extra});
const learned=state=>receiptLearningView(projectReceiptState(state));

test('a forwarded marketplace order is found by the order-subject search even though a personal mailbox sent it',async()=>{
 const subject=message().payload.headers[0].value.toLowerCase().split(/[^a-z]+/);
 const terms=[...discoveryPlan(Date.parse('2026-10-20T12:00:00Z'))[0].query.matchAll(/subject:(\w+)/g)].map(m=>m[1]);
 assert.ok(terms.some(t=>subject.includes(t)),'the first search stage matches on subject words, not on the sender');
 const candidate=triageCandidate(message());
 assert.equal(candidate.sender_domain,'gmail.com');assert.equal(candidate.subject,'Fwd: Your Depop order is confirmed');assert.equal(candidate.from_name,'Jordan Forwarder');
 // Finding the forward does not turn the forwarder's mailbox into a store whose mail is all searched.
 assert.deepEqual(storeDomains({sources:[{id:'fwd1',sender_domain:'gmail.com',shopping_evidence:true}]}),[]);
});

test('preparation shows the account holder as addressee and keeps the original ship-to, without any email address',async()=>{
 const source=await prepare();
 assert.match(source.text,/FROM\nJordan Forwarder \(gmail\.com\)\nTO\nAlex Owner/);
 assert.ok(source.text.includes('Sam Example'),'the other person named in the ship-to block reaches analysis');
 assert.ok(!/@/.test(source.text.replace(/\[email removed\]/g,'')),'every address is redacted, including the original recipient');
 assert.equal(source.sender_domain,'gmail.com');
});

test('an order shipped to someone else stays in history but never teaches the account holder a size',async()=>{
 const source=await prepare();
 for(const recipient of [{value:'other',quote:'shipped to Sam Example'},{value:'unknown',quote:null}]){
  const {state}=reconcileReceipt(emptyReceiptState('owner'),source,{events:[purchase({recipient})]});
  const view=learned(state);
  assert.equal(view.purchase_history.length,1);assert.equal(view.purchase_history[0].size_label,'M');
  assert.equal(view.learning_observations.length,0,recipient.value+' recipient must not set the owner\'s sizes');
  assert.deepEqual(receiptShoppingFacts(state,view),[]);
 }
 // A "self" claim whose quote the email does not contain is withheld.
 const {state}=reconcileReceipt(emptyReceiptState('owner'),source,{events:[purchase({recipient:{value:'self',quote:'Ship to: Alex Owner'}})]});
 assert.equal(learned(state).learning_observations.length,0);
});

// Known gap: a "self" claim is accepted whenever its quote appears anywhere in the email, so a model
// that reads the inner greeting of the forwarded original as the addressee teaches the owner size M.
// Fix proposed in the PR; this flips to a passing test once that lands.
test('a self claim that quotes only the original recipient\'s greeting does not teach the owner a size',{todo:'needs the proposed addressee check'},async()=>{
 const source=await prepare();
 const {state}=reconcileReceipt(emptyReceiptState('owner'),source,{events:[purchase({recipient:{value:'self',quote:'Hi Sam Example'}})]});
 assert.equal(learned(state).learning_observations.length,0);
});

test('a truncated listing title is kept as printed and a brand is kept only when the title states it',async()=>{
 const source=await prepare();
 const kept=reconcileReceipt(emptyReceiptState('owner'),source,{events:[purchase()]});
 assert.equal(kept.state.items[0].product,TITLE);assert.equal(kept.state.items[0].brand,'Carhartt');
 // A completed title is not in the email: the product is withheld, so no item is invented from it.
 const completed=TITLE.replace('lin...','lined');
 const guessed=reconcileReceipt(emptyReceiptState('owner'),source,{events:[purchase({product:fact(completed,'Item: '+completed)})]});
 assert.equal(guessed.state.items.length,0);assert.ok(guessed.records[0].withheld_fields.includes('product'));
 // A listing that does not name the brand keeps the brand unknown even when the model supplies one.
 const unbranded=TITLE.replace('Carhartt ','');
 const plain=await prepare(html.replace(TITLE,unbranded));
 const inferred=reconcileReceipt(emptyReceiptState('owner'),plain,{events:[purchase({evidence:'Item: '+unbranded,product:fact(unbranded,'Item: '+unbranded),brand:fact('Carhartt','Item: '+unbranded)})]});
 assert.equal(inferred.state.items[0].product,unbranded);assert.equal(inferred.state.items[0].brand,null);
});

test('the unit price is the printed item price, with or without a marketplace fee; nothing is added or computed',async()=>{
 for(const body of [html,withoutFee]){
  const {state}=reconcileReceipt(emptyReceiptState('owner'),await prepare(body),{events:[purchase()]});
  assert.equal(state.items[0].price.amount,65);assert.equal(state.items[0].price.currency,'$');
 }
 // Item price plus shipping is not printed anywhere in the email, so it cannot become the price.
 const computed=reconcileReceipt(emptyReceiptState('owner'),await prepare(),{events:[purchase({unit_price:fact('$80.00','$80.00')})]});
 assert.equal(computed.state.items[0].price,undefined);assert.ok(computed.records[0].withheld_fields.includes('unit_price'));
});

test('an import of the forward records the bought item only; the personalised edit never becomes a purchase',async()=>{
 const env={GMAIL_IMPORT_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'synthetic-client',GOOGLE_GMAIL_CLIENT_SECRET:'synthetic-secret',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
 const source=await prepare();
 const recommended=(product,size)=>purchase({basis:{value:'cart_or_marketing',quote:'Your personalised edit'},evidence:product,product:fact(product),brand:none,size_label:fact(size,product),
  order_reference:none,unit_price:none,currency:none,recipient:{value:'unknown',quote:null}});
 const row={conversation_id:'owner',token_ciphertext:sealToken(tokens,'owner',env),data:{feedback:emptyReceiptState('owner'),job:{...newImportJob(),status:'extracting',ids:['fwd1']}}};
 const store={evidence:async()=>[]};
 const next=await importStep({...row,receipts:await loadReceipts(store,'owner',row)},env,{fetcher:async()=>new Response(JSON.stringify(message()),{status:200,headers:{'Content-Type':'application/json'}}),
  prepare:async()=>source,interpret:async()=>({events:[purchase(),recommended("Levi's 501 straight leg jeans W32 L32",'W32 L32'),recommended('Patagonia Synchilla snap-T fleece size M','M')]})});
 const items=next.receipts.state.items;
 assert.equal(items.length,1);assert.equal(items[0].product,TITLE);assert.equal(items[0].price.amount,65);
 assert.equal(receiptLearningView(next.receipts.state).learning_observations.length,0);
});
