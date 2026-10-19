import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stylistConcepts,shopperWords,conceptQuery,interleaveConcepts,STYLIST_MODEL} from '../lib/stylist.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
const plan={continuation:false,mode:'discover',hard_constraints:['going-out top'],guidance:['more visual intrigue'],reference_brands:['Emily Dawn Long'],required_brands:[],keep_option_indices:[],exclude_option_indices:[]};
const model=value=>async(url,options)=>{model.last=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})};};
const concepts=[
 {label:'airbrushed mesh tops',search_query:'airbrushed print mesh long sleeve top',brands:['Emily Dawn Long','Maisie Wilen'],resale:false},
 {label:'archive diesel prints',search_query:'vintage Diesel printed mesh top',brands:['Diesel'],resale:true},
];
const p=(id,brand='Label')=>({brand,name:'Top '+id,url:'https://shop.example/products/'+id,match:'similar',sourcing_status:'store_found',listing_check:{status:'verified',product_name:'Top '+id}});

test('the stylist reads the shopper’s own words and saved taste, and returns clean directions only for discovery',async()=>{
 const recent=shopperWords([{direction:'inbound',body:'Kate Moss at a festival, a little grungy but put together'},{direction:'outbound',body:'got it'},{direction:'inbound',body:' I am very tall and particular about inseams '}]);
 assert.deepEqual(recent,['Kate Moss at a festival, a little grungy but put together','I am very tall and particular about inseams']);
 const facts=[{field:'style',key:'style',value:'The Row inspired'},{field:'budget',key:'special',value:'up to 500'},{field:'size',key:'shoe',value:'9',deleted:true}];
 const fetcher=model({concepts:[{...concepts[0],label:'  airbrushed   mesh tops ',search_query:'airbrushed mesh top https://spam.example/x'},...concepts.slice(1),{label:'',search_query:'empty label dropped',brands:[],resale:false}]});
 const out=await stylistConcepts({query:'going out top with visual intrigue',plan,facts,recent,env:{OPENAI_API_KEY:'k'},fetcher});
 assert.equal(model.last.model,STYLIST_MODEL);
 const input=JSON.parse(model.last.input);
 assert.deepEqual(input.shopper_recent_messages,recent);assert.deepEqual(input.reference_brands,['Emily Dawn Long']);
 assert.deepEqual(input.saved_profile.map(f=>f.field),['style','budget']);
 assert.deepEqual(out.map(c=>c.label),['airbrushed mesh tops','archive diesel prints']);
 assert.ok(!out[0].search_query.includes('http'));assert.equal(out[1].resale,true);
 // Identification, no key, a switched-off stylist or a failed call all fall back to the single search.
 assert.deepEqual(await stylistConcepts({query:'x',plan:{...plan,mode:'identify'},env:{OPENAI_API_KEY:'k'},fetcher:()=>assert.fail('No call for identify')}),[]);
 assert.deepEqual(await stylistConcepts({query:'x',plan,env:{}}),[]);
 assert.deepEqual(await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k',STYLIST_ENABLED:'false'},fetcher:()=>assert.fail('Disabled')}),[]);
 assert.deepEqual(await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k'},fetcher:async()=>({ok:false})}),[]);
});

test('each direction becomes its own search carrying the request’s constraints; resale is invited only where it fits',()=>{
 const base='Women\'s department: going-out top. current explicit constraints: ["going-out top"]';
 const a=conceptQuery(concepts[0],{base}),b=conceptQuery(concepts[1],{base}),c=conceptQuery(concepts[0],{base,brands:['diesel'],brandNames:'Diesel'});
 for(const q of [a,b])assert.ok(q.startsWith(base));
 assert.ok(a.includes('airbrushed print mesh long sleeve top')&&a.includes('Maisie Wilen'));
 assert.ok(!a.includes('resale')&&b.includes('resale'));
 assert.ok(c.includes('only products from Diesel qualify'));
});

test('discovery shows one option per stylist direction before repeating one, and records the directions',async()=>{
 let result;const queries=[];
 const byConcept={'airbrushed mesh tops':[p('a1'),p('a2'),p('a3')],'archive diesel prints':[p('d1','Diesel')]};
 await textWishlistAction({action:'start',query:'going out top with visual intrigue',search_plan:plan},{env:{},facts:[],recent:['Kate Moss vibes'],record:async r=>{result=r;},
  stylist:async input=>{assert.deepEqual(input.recent,['Kate Moss vibes']);assert.equal(input.plan.mode,'discover');return concepts;},
  search:async query=>{queries.push(query);const c=concepts.find(c=>query.includes(c.label));return {status:'found',products:byConcept[c.label]};},
  rank:async x=>x});
 assert.equal(queries.length,2);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a1').url,p('d1').url,p('a2').url]);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.concept),['airbrushed mesh tops','archive diesel prints','airbrushed mesh tops']);
 assert.deepEqual(result.text_wishlist_diagnostics.stylist_concepts.map(c=>c.label),concepts.map(c=>c.label));
 assert.equal(result.user_confirmed,undefined);
});

test('a failed direction leaves the others; without directions the single search runs as before',async()=>{
 let result,calls=0;
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},stylist:async()=>concepts,
  search:async query=>{calls++;if(query.includes('archive diesel prints'))throw Error('timeout');return {status:'found',products:[p('a1')]};},rank:async x=>x});
 assert.equal(calls,2);assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a1').url]);
 const queries=[];
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},stylist:async()=>[],search:async q=>{queries.push(q);return {products:[p('x')]};},rank:async x=>x});
 assert.equal(queries.length,1);assert.ok(!queries[0].includes('stylist direction'));assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('x').url]);
});

test('interleaving takes turns across directions and never repeats a page',()=>{
 assert.deepEqual(interleaveConcepts([[p('a'),p('b')],[p('a'),p('c')],[]]).map(x=>x.url),[p('a').url,p('b').url,p('c').url]);
});

test('a slow direction is left behind at the cap and the finished ones are shown',async()=>{
 let result,calls=0;const started=Date.now();
 // Plenty of turn time when the stylist starts, then almost none: the directions get a ~200 ms cap.
 const left=[60000];const turnLeft=()=>left.length?left.shift():20000+3000+200;
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],turnLeft,record:async r=>{result=r;},stylist:async()=>concepts,
  search:async query=>{calls++;if(query.includes('archive diesel prints'))return new Promise(()=>{});return {status:'found',products:[p('a1')]};},rank:async x=>x});
 assert.ok(Date.now()-started<3000);assert.equal(calls,2);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a1').url]);
});

test('without room in the turn the stylist is skipped and one search runs',async()=>{
 let result;const queries=[];
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],turnLeft:()=>30000,record:async r=>{result=r;},stylist:()=>assert.fail('No stylist without time'),
  search:async q=>{queries.push(q);return {products:[p('x')]};},rank:async x=>x});
 assert.equal(queries.length,1);assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('x').url]);
});

test('Shop catalog results only fill gaps after every direction’s results',async()=>{
 let result;
 const shop=async()=>({products:[{...p('shop1'),source_provider:'shop_catalog'},{...p('shop2'),source_provider:'shop_catalog'}]});
 const run=byConcept=>textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{SHOP_CATALOG_ENABLED:'true'},facts:[],record:async r=>{result=r;},stylist:async()=>concepts,shop,
  search:async query=>({status:'found',products:byConcept[concepts.find(c=>query.includes(c.label)).label]}),rank:async x=>x});
 await run({'airbrushed mesh tops':[p('a1')],'archive diesel prints':[]});
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a1').url,p('shop1').url,p('shop2').url]);
 await run({'airbrushed mesh tops':[p('a1'),p('a2')],'archive diesel prints':[p('d1')]});
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a1').url,p('d1').url,p('a2').url]);
});

test('after stylist directions, no extra retry searches run when nothing qualifies',async()=>{
 let result,calls=0;
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},stylist:async()=>concepts,
  search:async()=>{calls++;return {status:'needs_review',products:[p('a1')]};},rank:async()=>[]});
 assert.equal(calls,concepts.length);assert.equal(result.text_wishlist_state.stage,'search_clarification');
});
