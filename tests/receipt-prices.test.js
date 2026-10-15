import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrice,priceCurrency,reconcileReceipt,priceRecords,emptyReceiptState,projectReceiptEvidence,purchaseEvidence} from '../lib/receipt-extraction.js';
import {priceRange,profileText} from '../lib/receipt-notifications.js';

const fact=v=>({value:v,quote:v});
const line=(product,extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Order confirmed'},category:'clothing',existing_item_id:null,evidence:product,merchant:fact('Shop'),order_reference:fact('O1'),product:fact(product),sku:fact(null),brand:fact(null),color:fact(null),size_label:fact('M'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),recipient:{value:'unknown',quote:null},...extra});
const email=text=>({id:'m1',date:1,fingerprint:'f',text:'Shop Order confirmed O1 '+text});

test('prices parse common receipt formats without guessing',()=>{
 assert.equal(parsePrice('$1,234.50'),1234.5);assert.equal(parsePrice('2.450,00 DKK'),2450);assert.equal(parsePrice('€ 98'),98);
 assert.equal(parsePrice('USD 120'),120);assert.equal(parsePrice('1.234'),1234);assert.equal(parsePrice('12,5 €'),12.5);assert.equal(parsePrice("CHF 1'250.00"),1250);
 assert.equal(parsePrice('free'),null);assert.equal(parsePrice('0.00'),null);
 assert.equal(priceCurrency('2.450,00 DKK'),'DKK');assert.equal(priceCurrency('€98'),'EUR');assert.equal(priceCurrency('£40'),'GBP');
 assert.equal(priceCurrency('$298.00'),'$','an ambiguous dollar sign stays as written');assert.equal(priceCurrency('298.00'),null);
});
test('a purchase keeps a price only when the receipt line quotes it',()=>{
 let r=reconcileReceipt(emptyReceiptState('o'),email('Jeans M 2.450,00 DKK'),{events:[line('Jeans',{unit_price:{value:'2.450,00 DKK',quote:'Jeans M 2.450,00 DKK'},currency:fact(null)})]});
 assert.deepEqual(r.state.items[0].price,{amount:2450,currency:'DKK',text:'2.450,00 DKK'});
 r=reconcileReceipt(emptyReceiptState('o'),email('Jeans M $298.00 USD'),{events:[line('Jeans',{unit_price:fact('$298.00'),currency:fact('USD')})]});
 assert.equal(r.state.items[0].price.currency,'USD');
 // An invented or unprinted price is withheld; the purchase stands.
 r=reconcileReceipt(emptyReceiptState('o'),email('Jeans M'),{events:[line('Jeans',{unit_price:fact('$150'),currency:fact(null)})]});
 assert.equal(r.state.items[0].price,undefined);assert.ok(r.records[0].withheld_fields.includes('unit_price'));
 // A price with no currency printed anywhere is withheld rather than assumed.
 r=reconcileReceipt(emptyReceiptState('o'),email('Jeans M 298.00'),{events:[line('Jeans',{unit_price:fact('298.00'),currency:fact(null)})]});
 assert.equal(r.state.items[0].price,undefined);
});
test('re-reading an email already in the history adds prices to its items and never creates items',()=>{
 const text=email('Linen Shirt / Black - Large $298.00 Mug $20.00');
 const first=reconcileReceipt(emptyReceiptState('o'),text,{events:[line('Linen Shirt / Black',{size_label:fact('Large')})]}).state;
 const proposal={events:[line('Linen Shirt / Black - Large',{size_label:fact('Large'),unit_price:fact('$298.00'),currency:fact(null)}),line('Mug',{unit_price:fact('$20.00'),currency:fact(null),size_label:fact(null)})]};
 const priced=priceRecords(structuredClone(first),text,proposal);
 assert.equal(priced.state.items.length,1);assert.deepEqual(priced.state.items[0].price,{amount:298,currency:'$',text:'$298.00'});
 assert.equal(priced.records.length,1);assert.equal(priced.records[0].event_id,'m1:price:0');
 // Replaying the stored records rebuilds the same price.
 const rows=[...first.items.flatMap(i=>i.source_events.map(e=>purchaseEvidence({event_id:e.id,kind:e.kind,source_id:e.source_id,at:e.at,evidence:e.evidence,values:i.original,item_id:i.id}))),...priced.records.map(r=>purchaseEvidence(r))];
 assert.deepEqual(projectReceiptEvidence('o',rows).state.items[0].price,priced.state.items[0].price);
 // An item that already has a price keeps it.
 assert.equal(priceRecords(priced.state,text,proposal).records.length,0);
});
test('the profile summary gives the typical spend in the most common currency, never converting',()=>{
 const items=amounts=>amounts.map(([amount,currency])=>({price:{amount,currency}}));
 assert.equal(priceRange(items([[120,'USD'],[180,'USD'],[260,'USD'],[300,'USD'],[90,'EUR']])),'$170–$250','amounts over 200 round to the nearest 50');
 assert.equal(priceRange(items([[2300,'DKK'],[2450,'DKK'],[2450,'DKK']])),'2,400 DKK–2,450 DKK');
 assert.equal(priceRange(items([[100,'USD'],[100,'USD']])),null,'needs at least three priced purchases');
 assert.equal(priceRange(items([[100,'$'],[100,'$'],[100,'$']])),'around $100');
});
test('the who-you-are text includes typical spend only with enough quoted prices',()=>{
 const rows=[1,2,3].map(n=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',values:{merchant:'SSENSE',order_reference:'O'+n,sku:null,brand:'Our Legacy',color:null,size_label:'32',size_system:null,quantity:1,units_per_pack:null,product:'Jeans '+n},item_id:'i'+n,price:{amount:[150,250,300][n-1],currency:'USD',text:'$'}}));
 assert.match(profileText(projectReceiptEvidence('o',rows).state),/what you usually spend: \$200–\$300 per item/);
 assert.ok(!/spend/.test(profileText(projectReceiptEvidence('o',rows.slice(0,2)).state)));
});
