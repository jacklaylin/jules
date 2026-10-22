import test from 'node:test';
import assert from 'node:assert/strict';
import {kindOf,profileRows,textNow,personSummary} from '../lib/person-summary.js';
import {coverage} from '../lib/coverage.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {tagFingerprint,TAG_VERSION} from '../lib/item-tags.js';

const owner='owner';
const buy=(n,v={},price=null)=>purchaseEvidence({event_id:`m${n}:purchased`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',basis:'order_confirmation',category:'clothing',
 ...(price?{price:{amount:price,currency:'USD',text:'$'+price}}:{}),
 values:{merchant:'COS',order_reference:'O'+n,sku:null,brand:'COS',color:null,size_label:null,size_system:null,quantity:1,units_per_pack:null,product:'Item '+n,...v},item_id:'item-'+n,recipient:{value:'self',quote:'x'}});
const stateOf=rows=>projectReceiptEvidence(owner,rows).state;
const tagged=(state,tag=()=>({}))=>Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),v:TAG_VERSION,item_type:'shirt',group:'tops',color_family:'black',resale:false,...tag(i)}]));
const fact=(field,key,value,basis='stated')=>({field,key,value,basis,evidence_ids:['chat:'+field+key]});
const rowsFor=input=>profileRows({...input,coverage:coverage({...input,liked:0})});
const rowOf=(rows,topic)=>rows.find(r=>r.topic===topic);

test('kinds: what they said, what they did, and what Jules read into it',()=>{
 assert.equal(kindOf(fact('size','tops/us','M')),'said');
 assert.equal(kindOf(fact('style','palette','black','confirmed')),'said');
 assert.equal(kindOf(fact('occasion','work','office wear','inferred')),'inferred','a fact picked up without being told');
 assert.equal(kindOf({field:'brand_taste',key:'summary',value:'{}',basis:'inferred'}),'inferred');
 assert.equal(kindOf({field:'shopping_history',key:'summary',value:'{}',basis:'inferred'}),'seen');
 assert.equal(kindOf({field:'wishlist',key:'summary',value:'{}',basis:'inferred'}),'seen');
});

test('an empty profile: every dimension missing, with what would fill it',()=>{
 const rows=rowsFor({});
 assert.deepEqual(rows.map(r=>r.topic),['range','sizes','brands','categories','stores','price_band','channel','silhouettes','palette']);
 assert.equal(rowOf(rows,'range').status,null,'clothing range is not a coverage dimension');
 for(const r of rows.slice(1)){assert.equal(r.status,'missing',r.topic);assert.equal(r.summary,null,r.topic);assert.ok(r.detail,r.topic);}
 assert.match(rowOf(rows,'silhouettes').detail,/outfit photo/);
});

test('rows summarise what was said and seen, and count where it came from',()=>{
 const rows=[1,2,3,4].map(n=>buy(n,{size_label:'M'},100+n*10)),state=stateOf(rows),tags=tagged(state);
 const facts=[fact('shopping_range','department','men'),fact('gender','identity','man'),fact('size','suits/eu','50R'),fact('size','bottoms/waist/levis','31'),
  fact('inspiration','look','japanese workwear'),fact('budget','all/usd','$150–300'),fact('avoid','acne studios','too logo-y'),fact('occasion','work','office wear','inferred')];
 const result=rowsFor({facts,state,tags});
 assert.equal(rowOf(result,'range').summary,'Men’s · man');
 assert.deepEqual(rowOf(result,'range').from,{said:2,seen:0,inferred:0});
 const sizes=rowOf(result,'sizes');
 assert.match(sizes.summary,/suits 50R \(eu\) · bottoms at levis 31 \(waist\)/);
 assert.equal(sizes.status,'weak');assert.match(sizes.detail,/No size stated for tops \(bought in M\)/);
 assert.deepEqual(sizes.from,{said:2,seen:4,inferred:0});
 assert.match(rowOf(result,'brands').detail,/Said to avoid acne studios/);
 assert.equal(rowOf(result,'silhouettes').status,'weak','a style reference alone is weak');
 assert.match(rowOf(result,'silhouettes').summary,/A style reference only: japanese workwear/);
 assert.equal(rowOf(result,'price_band').summary,'$150–300');
 assert.match(rowOf(result,'price_band').detail,/Receipts: \$120–\$130 an item/);
 assert.equal(rowOf(result,'channel').summary,'Mostly new');
});

test('the brand row reads the brand reading, marked as Jules’s interpretation',()=>{
 const context=[fact('brand','our legacy','love their trousers'),{field:'brand_taste',key:'summary',basis:'inferred',
  value:JSON.stringify({brands:[{brand:'Our Legacy',said:{value:'love their trousers'},bought:7,wishlisted:1,liked:2},{brand:'Auralee',bought:4,wishlisted:3},{brand:'Lemaire',wishlisted:2},{brand:'Kapital',bought:2}]})}];
 const brands=rowOf(rowsFor({facts:context.slice(0,1),context}),'brands');
 assert.equal(brands.summary,'Our Legacy, Auralee, Lemaire lead');
 assert.equal(brands.reading,true);
 assert.deepEqual(brands.from,{said:1,seen:21,inferred:1});
 assert.match(brands.detail,/Top 3 of 4 brands/);
});

test('fabric likes and dislikes get their own row, apart from silhouettes',()=>{
 const rows=rowsFor({facts:[fact('style','material/silk','too hot, harder to wear'),fact('style','material/linen','loves it in summer'),fact('avoid','material/polyester','never breathes'),fact('style','silhouette','ideally cropped')]});
 const materials=rowOf(rows,'materials');
 assert.equal(materials.status,'known');
 assert.equal(materials.summary,'silk: too hot, harder to wear · linen: loves it in summer · polyester: never breathes','one fact per fabric, so a new fabric never replaces another');
 assert.deepEqual(materials.from,{said:3,seen:0,inferred:0});
 assert.doesNotMatch(rowOf(rows,'brands').detail??'',/polyester/,'a fabric dislike is not a brand to avoid');
 assert.doesNotMatch(rowOf(rows,'silhouettes').summary,/silk/);
 assert.equal(rowOf(rowsFor({}),'materials'),undefined,'no row until a fabric preference is stated');
});

test('text now: the early read while thin, the purchase summary when rich, nothing without an import',()=>{
 const thin=textNow({facts:[fact('fit','tops','cropped, boxy')],coverage:coverage({facts:[fact('fit','tops','cropped, boxy')]})});
 assert.equal(thin.kind,'early_read');assert.match(thin.text,/tops: cropped, boxy/);
 const rows=[1,2,3,4,5,6].map(n=>buy(n,{color:'black'},50)),state=stateOf(rows),tags=tagged(state);
 const facts=[fact('style','palette','black'),fact('fit','tops','relaxed'),fact('store','cos','basics'),fact('budget','tops/usd','100')];
 const outfits={kept:3,reading_photos:3,observations:1,texts:['black wide-leg trousers']};
 const cov=coverage({facts,state,tags,outfits});
 assert.equal(cov.level,'rich');
 const rich=textNow({facts,state,tags,outfits,coverage:cov});
 assert.equal(rich.kind,'purchases');assert.match(rich.text,/brands you buy most: COS/);assert.match(rich.text,/black wide-leg trousers/);
 assert.deepEqual(textNow({facts,outfits,coverage:{...cov,level:'rich'}}),{kind:'none',text:null});
});

test('personSummary reads every source, sends nothing and never calls a model',async()=>{
 const sent=[];
 const store={profile:async()=>({facts:[fact('size','shoes/us_men','10')]}),gmailImport:async()=>null,evidence:async()=>[],styleSources:async()=>[],styleSession:async()=>({data:{}}),
  wishlistEntries:async()=>[],send:async m=>sent.push(m)};
 const summary=await personSummary(store,owner);
 assert.equal(summary.coverage.level,'thin');assert.equal(summary.coverage.total,8);
 assert.equal(summary.rows.length,9);
 assert.equal(summary.text_now.kind,'early_read');assert.match(summary.text_now.text,/10 in shoes \(us men\)/);
 assert.equal(sent.length,0);
});
