import {test} from 'node:test';
import assert from 'node:assert/strict';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {priceRange,profileText,withoutBasics} from '../lib/receipt-notifications.js';
import {earlyReadText} from '../lib/early-read.js';
import {tagFingerprint} from '../lib/item-tags.js';

// October 21 founder feedback on the "who you are" summary after an import: three brands were named twice
// (once as brands, again as the stores they sell through), sizes came as one list with no category, one
// expensive purchase was hidden inside the usual range, and underwear and sock restocks put basics brands
// at the top. Brands named once, sizes by category, the most they paid when it stands out, basics left out.

let n=0;
const buy=(brand,merchant,{size='L',price=null}={})=>{n++;return purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',basis:'order_confirmation',category:'clothing',recipient:{value:'self',quote:'x'},
 values:{merchant,order_reference:'O'+n,sku:null,brand,color:null,size_label:size,size_system:null,quantity:1,units_per_pack:null,product:`${brand} item ${n}`},item_id:'i'+n,
 ...(price?{price:{amount:price,currency:'USD',text:'$'}}:{})});};
const stateOf=rows=>projectReceiptEvidence('o',rows).state;
// Tags as the tagger stores them: a group, valid while the item's details match.
const tagged=(state,groups)=>Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),group:groups(i)}]).filter(([,t])=>t.group));

const rows=[
 buy('MAAP','MAAP',{size:'L',price:180}),buy('MAAP','MAAP',{size:'XL',price:220}),buy('John Elliott','John Elliott',{size:'L',price:250}),buy('John Elliott','John Elliott',{size:'32',price:300}),
 buy('Our Legacy','SSENSE',{size:'32',price:280}),buy('Our Legacy','SSENSE',{size:'31',price:700}),
 buy('Lululemon','Lululemon',{size:'M',price:40}),buy('Lululemon','Lululemon',{size:'M',price:40}),buy('Lululemon','Lululemon',{size:'M',price:40}),buy('CDLP','CDLP',{size:'M',price:35}),buy('CDLP','CDLP',{size:'M',price:35})];
const state=stateOf(rows);
const group=i=>/Lululemon|CDLP/.test(i.brand)?'underwear_basics':i.values?.size_label==='32'||/^3\d$/.test(i.size_label??'')?'trousers':'tops';
const tags=tagged(state,group);

test('basics are left out of brands, stores and spend; a brand’s own shop is not named again as a store',()=>{
 const text=profileText(state,[],{tags});
 assert.ok(!/Lululemon|CDLP/.test(text),text);
 const brands=text.match(/brands you buy most: (.*)/)[1];
 for(const b of ['MAAP','John Elliott','Our Legacy'])assert.ok(brands.includes(b),b);
 // Each store already named as a brand is not repeated; another store is.
 assert.match(text,/other stores you buy from: SSENSE/);
 for(const b of ['MAAP','John Elliott'])assert.equal(text.split(b).length-1,1,`${b} named once`);
 // Without tags nothing is assumed: the basics count as before.
 assert.match(profileText(state),/Lululemon/);
});

test('sizes are given by category, two per category, most bought first',()=>{
 const text=profileText(state,[],{tags});
 assert.match(text,/sizes you’ve bought: (tops L\/XL, bottoms 31\/32|bottoms 31\/32, tops L\/XL)/);
 assert.ok(!/\bM\b/.test(text.match(/sizes you’ve bought: (.*)/)[1]),'basics sizes stay out');
 // A stale tag (the item changed since it was tagged) is not used: the plain list comes back.
 const stale=Object.fromEntries(Object.entries(tags).map(([id,t])=>[id,{...t,fp:'old'}]));
 assert.match(profileText(state,[],{tags:stale}),/sizes you’ve bought: M, 32, L, 31/);
});

test('the most they paid is named when it stands well above the usual range',()=>{
 const items=amounts=>amounts.map(amount=>({price:{amount,currency:'USD'}}));
 assert.equal(priceRange(items([110,150,200,250,300,700]),{outlier:true}),'$160–$300, sometimes as much as $700');
 assert.equal(priceRange(items([110,150,200,250,300,320]),{outlier:true}),'$160–$300','close to the range is not an outlier');
 assert.equal(priceRange(items([110,150,200,250,300,700])),'$160–$300','other callers keep the plain range');
 assert.equal(priceRange(items([100,700]),{outlier:true}),null,'still needs three priced purchases');
 assert.match(profileText(state,[],{tags}),/what you usually spend: \$\d+–\$\d+, sometimes as much as \$700 per item/);
});

test('the early read also leaves basics out of brands and spend',()=>{
 const read=earlyReadText({state,tags,coverage:{dimensions:[]}});
 assert.ok(!/Lululemon|CDLP/.test(read.text),read.text);
 assert.match(read.text,/sometimes as much as \$700/);
 assert.equal(withoutBasics(state.items,tags).length,6);
});
