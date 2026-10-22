import test from 'node:test';
import assert from 'node:assert/strict';
import {closetSummary,closetFact,readClosetSummary,ensureClosetSummary,CLOSET_VERSION} from '../lib/closet-summary.js';
import {tagFingerprint,withoutCloset} from '../lib/item-tags.js';
import {PHOTO_TAG_VERSION} from '../lib/photo-tags.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {receiptWrite} from '../lib/evidence.js';
import {readUserContext,tasteView} from '../lib/user-context.js';
import {shoppingConstraints} from '../lib/relevance.js';
import {stylistConcepts} from '../lib/stylist.js';

const owner='00000000-0000-4000-8000-000000000001';
const record=(n,values)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1700000000000+n,evidence:`${values.product} M`,category:'clothing',
 values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:'Brand',color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+n});
const PRODUCTS=['Oxford Shirt','Linen Shirt','Flannel Shirt','Tee','Chinos','Jeans','Gift Scarf','Returned Coat','Gone Sweater','Never Bought Boots','Boxer Briefs'];
const rows=PRODUCTS.map((product,i)=>record(i+1,{product,color:i===0?'White':null}));
const state0=()=>projectReceiptEvidence(owner,rows).state;
// What a person did to some items: a gift, a return, one they no longer have, one they never bought.
function closet(){
 const state=state0(),by=id=>state.items.find(i=>i.id===id);
 Object.assign(by('item-7'),{recipient_evidence:{value:'other'}});
 Object.assign(by('item-8'),{outcome:{value:'returned'},field_provenance:{...by('item-8').field_provenance,outcome:{source:'closet_edit'}}});
 Object.assign(by('item-9'),{owned:false});
 Object.assign(by('item-10'),{purchase_disputed:true});
 return state;
}
const typeFor={1:['oxford shirt','shirts'],2:['linen shirt','shirts'],3:['flannel shirt','shirts'],4:['t-shirt','tops'],5:['chinos','trousers'],6:['jeans','denim'],7:['scarf','accessories'],8:['coat','outerwear'],9:['sweater','knitwear'],10:['boots','shoes'],11:['boxer briefs','underwear_basics']};
function tags(state,colour=()=> 'unknown'){
 return Object.fromEntries(state.items.map(i=>{const n=Number(i.id.split('-')[1]);return [i.id,{fp:tagFingerprint(i),v:1,item_type:typeFor[n][0],group:typeFor[n][1],color_family:colour(n),resale:null}];}));
}
const photo=over=>({fp:'x',v:PHOTO_TAG_VERSION,source:'order_email',visible:'clear',color_family:'navy',pattern:'solid',fit:'relaxed',silhouette:'boxy',fabric:'cotton',formality:'casual',details:['chest pocket'],...over});

test('only items in the wardrobe count: no gifts, returns, removed or never-bought items',()=>{
 const state=closet(),photos=Object.fromEntries(state.items.map(i=>[i.id,photo()]));
 const s=closetSummary(state,tags(state),photos);
 assert.equal(s.items,7);assert.equal(s.photos_read,7);
 const all=JSON.stringify(s);
 // Underwear and socks count as owned but say little about style, so they get no category line.
 for(const gone of ['scarf','coat','sweater','boots','accessories','outerwear','shoes','boxer','other'])assert.ok(!all.includes(gone),gone);
 // Grouped by item type: shirts apart from t-shirts, trousers apart from denim.
 assert.deepEqual(s.groups.map(c=>[c.group,c.items]),[['shirts',3],['denim',1],['tops',1],['trousers',1]]);
 assert.equal(s.about.includes('not wearing or liking'),true);
 // Each brand's owned items by group, for brand_taste; basics (the boxer briefs) are left out, and the
 // per-brand list stays off the fact the stylist and search read.
 assert.deepEqual(s.brands,[{brand:'Brand',items:6,groups:{shirts:3,denim:1,tops:1,trousers:1}}]);
 assert.ok(!closetFact(s).value.includes('"brands"'));
});

test('receipt colour wins; the photo fills an unknown; recurring details only',()=>{
 const state=closet();
 const photos={'item-1':photo({color_family:'blue',details:['button-down collar','chest pocket']}),'item-2':photo({color_family:'cream',silhouette:'boxy',details:['chest pocket']}),
  'item-3':photo({color_family:null,pattern:'checks',fit:null,silhouette:'oversized'}),'item-4':photo({visible:'not_visible',color_family:'red'}),
  'item-5':photo({v:PHOTO_TAG_VERSION+1,color_family:'green'})};
 const s=closetSummary(state,tags(state,n=>n===1?'white':'unknown'),photos),tops=s.groups.find(c=>c.group==='shirts');
 // White from the receipt (not the photo's blue), cream from a photo, nothing from a photo that doesn't show the item.
 assert.equal(tops.colours,'cream 1, white 1');
 assert.equal(tops.patterns,'solid 2, checks 1');
 assert.equal(tops.details,'chest pocket 3');
 assert.equal(tops.types,'flannel shirt 1, linen shirt 1, oxford shirt 1');
 // A reading from an older photo-tag version adds nothing.
 const bottoms=s.groups.find(c=>c.group==='trousers');
 assert.equal(bottoms.colours,undefined);assert.equal(bottoms.patterns,undefined);assert.equal(s.photos_read,3);
});

test('stale item tags and an empty wardrobe add nothing',()=>{
 const state=closet(),stale=Object.fromEntries(Object.entries(tags(state)).map(([id,t])=>[id,{...t,fp:'old'}]));
 const s=closetSummary(state,stale,{});
 assert.equal(s.items,7);assert.ok(s.groups.every(c=>!c.types&&!c.colours));
 assert.equal(closetFact(closetSummary({items:[],questions:[],feedback:[]})),null);
});

test('the summary stays small for a big closet',()=>{
 const many=Array.from({length:400},(_,i)=>record(i+1,{product:'Item '+i}));
 const state=projectReceiptEvidence(owner,many).state,groups=['tops','shirts','trousers','denim','shorts','outerwear','shoes','bags','accessories','eyewear','swimwear','dresses','skirts'];
 const itemTags=Object.fromEntries(state.items.map((it,i)=>[it.id,{fp:tagFingerprint(it),v:1,item_type:'type '+(i%37),group:groups[i%groups.length],color_family:['black','navy','white','grey','green','brown'][i%6],resale:null}]));
 const photos=Object.fromEntries(state.items.map((it,i)=>[it.id,photo({silhouette:'shape '+(i%9),details:['detail '+(i%11),'detail '+(i%5)],pattern:['solid','stripes','checks','floral'][i%4]})]));
 const fact=closetFact(closetSummary(state,itemTags,photos));
 assert.ok(fact.value.length<2200,`closet fact is ${fact.value.length} chars`);
 assert.ok(JSON.parse(fact.value).groups.length<=8);
});

function fixture(data={}){
 let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',lease_until:null,data:{job:{status:'ready'},sources:[],questions:[],...data}},busy=false,loads=0;
 return {get row(){return row;},get loads(){return loads;},set busy(v){busy=v;},
  gmailImport:async()=>structuredClone(row),evidence:async()=>{loads++;return structuredClone(rows);},
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,next,token)=>{if(revision!==row.revision)return false;busy=false;row={...row,data:structuredClone(next),token_ciphertext:token};return true;}};
}

test('a cached summary is read without loading receipts; any history or tag write drops it',async()=>{
 const state=state0(),store=fixture({item_tags:tags(state)});
 // Nothing cached: built in memory for the reply, never written.
 const built=await readClosetSummary(store,owner);
 assert.equal(built.items,11);assert.equal(store.row.data.closet_summary,undefined);
 assert.equal((await ensureClosetSummary(store,owner)).status,'saved');
 assert.equal(store.row.data.closet_summary.v,CLOSET_VERSION);
 const before=store.loads;await readClosetSummary(store,owner);assert.equal(store.loads,before,'cached copy, no receipt load');
 assert.equal((await ensureClosetSummary(store,owner)).status,'current');
 // Writers that change what the summary is built from drop it.
 assert.equal(withoutCloset(store.row.data).closet_summary,undefined);
 const write=receiptWrite(store.row.data,{state,legacy:[],orders:[]},state);
 assert.equal(write.data.closet_summary,undefined);assert.ok(write.data.item_tags);
});

test('the stylist and search get the closet summary as taste; a gift gets none of it',async()=>{
 const state=closet(),store={...fixture({item_tags:tags(state)}),profile:async()=>({facts:[{field:'style',key:'aesthetic',value:'minimal',basis:'stated'}]})};
 const context=await readUserContext(store,owner,{GMAIL_IMPORT_ENABLED:'true',MEMORY_ENABLED:'true'},{log:()=>{}});
 const wardrobe=context.facts.find(f=>f.field==='wardrobe');
 assert.ok(wardrobe,'the wardrobe joins the context');assert.equal(JSON.parse(wardrobe.value).items,11);
 assert.ok(tasteView(context.facts).some(f=>f.field==='wardrobe'),'search and ranking taste');
 assert.ok(shoppingConstraints(context.facts,{}).taste.some(f=>f.field==='wardrobe'),'search constraints');
 assert.ok(!shoppingConstraints(context.facts,{for_someone_else:true}).taste.length,'a gift is searched without it');
 let input=null;
 const fetcher=async(_u,o)=>{input=JSON.parse(JSON.parse(o.body).input);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({concepts:[]})}]}]})};};
 await stylistConcepts({query:'a jacket',plan:{mode:'discover'},facts:context.facts,env:{OPENAI_API_KEY:'test'},fetcher});
 assert.equal(input.closet.items,11,'the stylist sees it whole, as its own field');assert.ok(!input.saved_profile.some(f=>f.field==='wardrobe'));
 await stylistConcepts({query:'a jacket for my brother',plan:{mode:'discover'},facts:context.facts,forSomeoneElse:true,env:{OPENAI_API_KEY:'test'},fetcher});
 assert.equal(input.closet,undefined);assert.ok(!input.saved_profile.some(f=>f.field==='wardrobe'));
});
