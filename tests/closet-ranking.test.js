import test from 'node:test';
import assert from 'node:assert/strict';
import {closetRank,validClosetRanking,applyClosetRanking,withClosetMarks,goesWithLine} from '../lib/closet-ranking.js';
import {closetSummary,closetFact} from '../lib/closet-summary.js';
import {tagFingerprint} from '../lib/item-tags.js';
import {PHOTO_TAG_VERSION} from '../lib/photo-tags.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {textWishlistAction,spreadPick} from '../lib/text-wishlist.js';

const owned=[
 {id:'tee-1',name:'black John Elliott t-shirt',group:'tops',type:'t-shirt',colour:'black',pattern:'solid',fit:'regular'},
 {id:'jeans-1',name:'black Dries Van Noten jeans',group:'denim',type:'jeans',colour:'black'},
 {id:'jacket-1',name:'brown Dries Van Noten jacket',group:'outerwear',type:'jacket',colour:'brown'},
];
const p=(id,over={})=>({brand:'Label',name:'Item '+id,url:'https://shop.example/products/'+id,match:'similar',sourcing_status:'store_found',listing_check:{status:'verified',product_name:'Item '+id},...over});
const env={OPENAI_API_KEY:'k'};
const answer=value=>{const calls=[];const call=async request=>{calls.push(request);return value;};call.calls=calls;return call;};

test('ids are checked against the wardrobe: a "goes with" or duplicate that isn’t owned is dropped and counted',()=>{
 const products=[p('a'),p('b')];
 const r=validClosetRanking(products,owned,{asks_for_owned_kind:false,candidates:[
  {index:0,duplicate_of:'tee-1',goes_with:['jeans-1','tee-1','made-up','jacket-1']},
  {index:1,duplicate_of:'not-in-wardrobe',goes_with:['jeans-1','jeans-1']},
  {index:7,duplicate_of:null,goes_with:['jeans-1']},{index:0,duplicate_of:null,goes_with:[]}]});
 assert.deepEqual(r.byIndex.get(0),{duplicate_of:'tee-1',goes_with:['jeans-1','jacket-1']},'never pairs an item with what it duplicates');
 assert.deepEqual(r.byIndex.get(1),{duplicate_of:null,goes_with:['jeans-1']});
 assert.equal(r.rejected,4,'the duplicate-as-pair, the made-up id, the unknown duplicate and the repeat');
 const list=applyClosetRanking(products,owned,r);
 assert.deepEqual(list.map(x=>x.url),[p('b').url,p('a').url],'the near-duplicate goes after the rest');
 assert.deepEqual(list[1].goes_with,[{id:'jeans-1',name:'black Dries Van Noten jeans'},{id:'jacket-1',name:'brown Dries Van Noten jacket'}]);
 assert.equal(goesWithLine(list[1]),'could go with your black Dries Van Noten jeans or your brown Dries Van Noten jacket.');
 assert.equal(goesWithLine(p('c')),null);
});

test('a near-duplicate is pushed down, not removed; asking for another of something owned keeps it in place',async()=>{
 const products=[p('dupe'),p('new')];
 const proposal=asks=>({asks_for_owned_kind:asks,candidates:[{index:0,duplicate_of:'tee-1',goes_with:[]},{index:1,duplicate_of:null,goes_with:['jeans-1']}]});
 const down=await closetRank(products,{query:'black tees',owned,env,call:answer(proposal(false))});
 assert.equal(down.outcome.status,'ok');assert.deepEqual(down.products.map(x=>x.url),[p('new').url,p('dupe').url]);
 assert.deepEqual(down.outcome.duplicates,[{url:p('dupe').url,item_id:'tee-1'}]);assert.equal(down.outcome.demoted,1);
 assert.deepEqual(down.outcome.goes_with,[{url:p('new').url,item_ids:['jeans-1']}]);
 const again=await closetRank(products,{query:'another black tee like mine',owned,env,call:answer(proposal(true))});
 assert.deepEqual(again.products.map(x=>x.url),[p('dupe').url,p('new').url]);assert.equal(again.outcome.demoted,0);
 // Applied to the ranker's own order, in the turn.
 assert.deepEqual(withClosetMarks([p('dupe'),p('new')],down).map(x=>x.url),[p('new').url,p('dupe').url]);
 const kept=withClosetMarks([p('dupe'),p('new')],again);
 assert.deepEqual(kept.map(x=>x.url),[p('dupe').url,p('new').url]);assert.equal(kept[0].closet_duplicate_of,undefined);
 // One pick per stylist direction never lifts a near-duplicate back up.
 const marked=withClosetMarks([p('dupe',{concept:'A'}),p('a2',{concept:'A'}),p('b1',{concept:'B'})].reverse().reverse(),{products:[{...p('dupe'),closet_duplicate_of:'tee-1'}],outcome:{status:'ok'}});
 assert.deepEqual(spreadPick(marked).map(x=>x.url),[p('a2').url,p('b1').url,p('dupe').url]);
});

test('no closet step for someone else, without a closet, switched off or without time; a failure keeps the order',async()=>{
 const products=[p('a'),p('b')],never=async()=>assert.fail('no model call');
 assert.equal((await closetRank(products,{query:'q',owned,forSomeoneElse:true,env,call:never})).outcome.status,'someone_else');
 assert.equal((await closetRank(products,{query:'q',owned:[],env,call:never})).outcome.status,'no_closet');
 assert.equal((await closetRank(products,{query:'q',owned,env:{...env,CLOSET_RANKING:'false'},call:never})).outcome.status,'off');
 const late=await closetRank(products,{query:'q',owned,timeLeft:1500,env,call:never});
 assert.equal(late.outcome.status,'no_time');assert.deepEqual(late.products,products);
 const slow=await closetRank(products,{query:'q',owned,env,call:async()=>{throw Object.assign(Error('slow'),{name:'TimeoutError'});}});
 assert.equal(slow.outcome.status,'timeout');assert.deepEqual(slow.products,products);
 const call=answer({asks_for_owned_kind:false,candidates:[]});
 await closetRank(products,{query:'q',owned,timeLeft:5000,env,call});
 assert.equal(call.calls[0].timeout,5000,'the call never outlasts the turn');
});

test('the owned list keeps only wardrobe pieces, named from receipts and tags, and stays out of the summary text',()=>{
 const owner='00000000-0000-4000-8000-000000000001';
 const record=(n,values)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1700000000000+n,evidence:`${values.product} M`,category:'clothing',
  values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:'Dries Van Noten',color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+n});
 const state=projectReceiptEvidence(owner,[record(1,{product:'Jeans',color:'Black'}),record(2,{product:'Gift Scarf'}),record(3,{product:'Boxer Briefs'})]).state;
 state.items[1].recipient_evidence={value:'other'};
 const group={1:['jeans','denim'],2:['scarf','accessories'],3:['boxer briefs','underwear_basics']};
 const tags=Object.fromEntries(state.items.map(i=>{const n=i.id.split('-')[1];return [i.id,{fp:tagFingerprint(i),v:1,item_type:group[n][0],group:group[n][1],color_family:n==='1'?'black':'unknown',resale:null}];}));
 const s=closetSummary(state,tags,{'item-1':{v:PHOTO_TAG_VERSION,visible:'clear',pattern:'solid',fit:'relaxed',formality:'casual',details:['five pockets']}});
 assert.deepEqual(s.owned,[{id:'item-1',name:'black Dries Van Noten jeans',group:'denim',type:'jeans',colour:'black',pattern:'solid',fit:'relaxed',formality:'casual',details:['five pockets']}]);
 assert.ok(!closetFact(s).value.includes('owned'),'the stylist and search read the summary, not the list');
});

// The whole discovery turn: what the reply says, what is recorded, and that a gift reads no closet.
const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],reference_brands:[],required_brands:[],keep_option_indices:[],exclude_option_indices:[]};
const turn=async({forSomeoneElse=false,closet})=>{
 let result,reply,read=0;
 reply=await textWishlistAction({action:'start',query:'casual shirts',search_plan:plan,for_someone_else:forSomeoneElse},{env:{},facts:[],record:async r=>{result=r;},
  stylist:async()=>[],search:async()=>({status:'found',products:[p('dupe'),p('new')]}),rank:async x=>x,
  owned:async()=>{read++;return owned;},...(closet?{closet}:{})});
 return {result,reply,read};
};
test('in a discovery turn the reply suggests owned pairings, the duplicate goes last, and the outcome is recorded',async()=>{
 const closet=(products,input)=>closetRank(products,{...input,env,call:answer({asks_for_owned_kind:false,candidates:[{index:0,duplicate_of:'tee-1',goes_with:[]},{index:1,duplicate_of:null,goes_with:['jeans-1','ghost']}]})});
 const {result,reply}=await turn({closet});
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('new').url,p('dupe').url]);
 assert.match(reply,/could go with your black Dries Van Noten jeans\./);
 assert.ok(!/ghost|love|always wear/.test(reply));
 const recorded=result.text_wishlist_diagnostics.closet;
 assert.equal(recorded.status,'ok');assert.deepEqual(recorded.duplicates,[{url:p('dupe').url,item_id:'tee-1'}]);assert.equal(recorded.rejected_ids,1);
});
test('a request for someone else never reads the closet',async()=>{
 const {result,read,reply}=await turn({forSomeoneElse:true,closet:closetRank});
 assert.equal(read,0);assert.equal(result.text_wishlist_diagnostics.closet.status,'someone_else');assert.ok(!/could go with/.test(reply));
});

test('pairings are checked against the wardrobe’s own tags: not the same place, gym only with gym, no repeated names',()=>{
 const closet=[...owned,{id:'tank-1',name:'black lululemon tank',group:'activewear',type:'tank'},{id:'trousers-1',name:'brown Dries Van Noten trousers',group:'trousers'},{id:'trousers-2',name:'brown Dries Van Noten trousers',group:'trousers'}];
 const r=validClosetRanking([p('shirt'),p('leggings')],closet,{asks_for_owned_kind:false,candidates:[
  {index:0,group:'shirts',duplicate_of:null,goes_with:['tee-1','tank-1','trousers-1']},
  {index:1,group:'activewear',duplicate_of:null,goes_with:['tank-1','trousers-1','trousers-2']}]});
 assert.deepEqual(r.byIndex.get(0).goes_with,['trousers-1'],'a shirt never pairs with a tee or a gym tank');
 assert.deepEqual(r.byIndex.get(1).goes_with,['trousers-1'],'the same name twice reads as one piece');
 assert.equal(r.rejected,4);
});

test('owned pieces are named as a person would say them',async()=>{
 const {displayBrand}=await import('../lib/closet-summary.js');
 assert.equal(displayBrand('MFPEN Retail ApS'),'MFPEN');assert.equal(displayBrand('DRIES VAN NOTEN'),'Dries Van Noten');
 assert.equal(displayBrand('Our Legacy'),'Our Legacy');assert.equal(displayBrand('APC'),'APC');assert.equal(displayBrand('Acme Ltd.'),'Acme');assert.equal(displayBrand(null),null);
});

test('one owned piece is suggested for one pick at most in a reply',async()=>{
 let reply;
 const closet=(products,input)=>closetRank(products,{...input,env,call:answer({asks_for_owned_kind:false,candidates:[{index:0,group:'shirts',duplicate_of:null,goes_with:['jeans-1']},{index:1,group:'shirts',duplicate_of:null,goes_with:['jeans-1','jacket-1']}]})});
 reply=await textWishlistAction({action:'start',query:'casual shirts',search_plan:plan},{env:{},facts:[],record:async()=>{},stylist:async()=>[],search:async()=>({status:'found',products:[p('one'),p('two')]}),rank:async x=>x,owned:async()=>owned,closet});
 assert.equal(reply.match(/black Dries Van Noten jeans/g).length,1);
 assert.match(reply,/could go with your brown Dries Van Noten jacket\./);
});
