import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stylistConcepts,shopperWords,conceptQuery,interleaveConcepts,savedBrands,requestReferenceBrands,STYLIST_MODEL} from '../lib/stylist.js';
import {textWishlistAction,settleWithin} from '../lib/text-wishlist.js';
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
 assert.deepEqual(input.shopper_recent_messages,recent);assert.deepEqual(input.brands_named_in_request,['Emily Dawn Long']);
 assert.deepEqual(input.saved_profile.map(f=>f.field),['style','budget']);
 assert.deepEqual(out.map(c=>c.label),['airbrushed mesh tops','archive diesel prints']);
 assert.ok(!out[0].search_query.includes('http'));assert.equal(out[1].resale,true);
 // Identification, no key, a switched-off stylist or a failed call all fall back to the single search.
 assert.deepEqual(await stylistConcepts({query:'x',plan:{...plan,mode:'identify'},env:{OPENAI_API_KEY:'k'},fetcher:()=>assert.fail('No call for identify')}),[]);
 assert.deepEqual(await stylistConcepts({query:'x',plan,env:{}}),[]);
 assert.deepEqual(await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k',STYLIST_ENABLED:'false'},fetcher:()=>assert.fail('Disabled')}),[]);
 assert.deepEqual(await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k'},fetcher:async()=>({ok:false})}),[]);
});

test('saved favorite brands reach the stylist as taste, not as brands named in the request',async()=>{
 const facts=[{field:'brand',key:'st laurent',value:'favorite brand'},{field:'brand',key:'style-pack/prada',value:'favorite brand'},{field:'brand',key:'prada',value:'favorite brand'},{field:'brand',key:'oakley',value:'purchased',deleted:true}];
 const copied={...plan,reference_brands:['Saint Laurent','Prada','Our Legacy']};
 assert.deepEqual(requestReferenceBrands(copied,facts),['Our Legacy']);
 assert.deepEqual(savedBrands(facts),[{name:'st laurent',saved_as:'favorite brand'},{name:'prada',saved_as:'favorite brand'}]);
 await stylistConcepts({query:'ribbed base layers',plan:copied,facts,env:{OPENAI_API_KEY:'k'},fetcher:model({concepts})});
 const input=JSON.parse(model.last.input);
 assert.deepEqual(input.brands_named_in_request,['Our Legacy']);assert.deepEqual(input.saved_brands.map(b=>b.name),['st laurent','prada']);
 assert.ok(model.last.instructions.includes('Saved brands')&&model.last.instructions.includes('discover something new'));
 // The search brief no longer says the user named their favorites.
 const queries=[];
 await textWishlistAction({action:'start',query:'ribbed base layers',search_plan:copied},{env:{},facts,record:async()=>{},stylist:async()=>[],search:async q=>{queries.push(q);return {products:[p('x')]};},rank:async x=>x});
 assert.ok(queries[0].includes('["Our Legacy"]')&&!queries[0].includes('Prada'));
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

test('once results are enough, slower directions get only a short grace period',async()=>{
 const started=Date.now(),never=new Promise(()=>{});
 const out=await settleWithin([Promise.resolve(3),never],60000,{enough:o=>o.some(s=>s.status==='fulfilled'),grace:50});
 assert.ok(Date.now()-started<1000);assert.deepEqual(out.map(s=>s.status),['fulfilled','timed_out']);assert.equal(typeof out[0].ms,'number');
 // Without enough, everything that settles in time is waited for.
 const all=await settleWithin([Promise.resolve(1),new Promise(r=>setTimeout(()=>r(2),30))],1000,{enough:()=>false,grace:0});
 assert.deepEqual(all.map(s=>s.value),[1,2]);
});

test('discovery records where sourcing spent its time',async()=>{
 let result;
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},stylist:async()=>concepts,
  search:async query=>({status:'found',products:[p(query.includes('archive')?'d1':'a1')]}),rank:async x=>x});
 const t=result.text_wishlist_diagnostics.timing;
 for(const key of ['stylist_ms','directions_ms','rank_ms','sourcing_ms'])assert.equal(typeof t[key],'number',key);
 assert.equal(t.direction_ms.length,concepts.length);
});

test('without room in the turn the stylist is skipped and one search runs',async()=>{
 let result;const queries=[];
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{},facts:[],turnLeft:()=>30000,record:async r=>{result=r;},stylist:()=>assert.fail('No stylist without time'),
  search:async q=>{queries.push(q);return {products:[p('x')]};},rank:async x=>x});
 assert.equal(queries.length,1);assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('x').url]);
});

// October 19: a "more options" search ran past the turn deadline. Without stylist directions (no room,
// no directions returned, or a named item) the single search used a fixed 60 s deadline
// regardless of how much of the turn was left. Every path now fits in what the turn has left.
test('the single search never gets more time than the turn has left, in every mode and stylist outcome',async()=>{
 for(const [mode,turnLeft,stylist] of [['discover',30000,()=>assert.fail('No stylist without time')],['discover',60000,async()=>[]],['identify',50000,()=>assert.fail('No stylist for a named item')],['identify',200000,null]]){
  const deadlines=[],steps=[];let result;
  await textWishlistAction({action:'start',query:'waffle knit long sleeve',search_plan:{...plan,mode}},{env:{},facts:[],turnLeft:()=>turnLeft,step:s=>steps.push(s),record:async r=>{result=r;},
   ...(stylist?{stylist}:{}),search:async(q,_i,env)=>{deadlines.push(env.SEARCH_DEADLINE_MS);return {status:'found',products:[{...p('x'),match:'likely_match'}]};},rank:async x=>x});
  assert.equal(deadlines.length,1,mode+turnLeft);
  // 20 s stay reserved for the reply; the search also leaves itself 3 s, and never exceeds 60 s.
  assert.ok(deadlines[0]<=Math.min(60000,turnLeft-20000-3000),mode+' '+turnLeft+': '+deadlines[0]);assert.ok(deadlines[0]>=1000);
  assert.ok(result.text_wishlist_state.options.length,mode);
  // Each sourcing stage reaches the turn trace, so a turn that dies mid-search shows where it was.
  assert.ok(steps.includes('sourcing:search')&&steps.includes('sourcing:search_ms'),mode+' '+steps.join());
 }
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

test('stylist directions never run the shopper’s whole brief as an exact Google query; the single search still may',async()=>{
 // October 19: the brief typed into Google returned the same category pages for every direction and
 // answered (cancelled) each one. Each direction searches its own concept.
 const options=[];
 await textWishlistAction({action:'start',query:'going-out tops, mix in some minimal luxe',search_plan:plan},{env:{},facts:[],record:async()=>{},stylist:async()=>concepts,
  search:async(q,images,env,fetcher,opts)=>{options.push(opts);return {status:'found',products:[p('d'+options.length)]};},rank:async x=>x});
 assert.equal(options.length,concepts.length);
 for(const o of options){assert.equal(o.exact,false);assert.equal(o.search_mode,'discover');}
 const single=[];
 await textWishlistAction({action:'start',query:'going-out tops',search_plan:plan},{env:{},facts:[],record:async()=>{},stylist:async()=>[],
  search:async(q,images,env,fetcher,opts)=>{single.push(opts);return {products:[p('x')]};},rank:async x=>x});
 assert.equal(single.length,1);assert.notEqual(single[0].exact,false,'a named model read as discovery is still found by the exact search');
});

// October 20: the stylist inherited a slow long-form write model, timed out on every discovery and fell back silently.
test('the stylist has its own model role, unaffected by the write model',async()=>{
 const fetcher=model({concepts});
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k',MODEL_WRITE:'gpt-6-luna'},fetcher});
 assert.equal(model.last.model,STYLIST_MODEL);
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k',MODEL_WRITE:'gpt-6-luna',MODEL_STYLIST:'gpt-5.4-mini'},fetcher});
 assert.equal(model.last.model,'gpt-5.4-mini');
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k',STYLIST_MODEL:'gpt-5-mini'},fetcher});
 assert.equal(model.last.model,'gpt-5-mini','the older variable is still honoured');
});

test('every stylist outcome is reported: ok, off, timeout, provider error, unreadable output',async()=>{
 const seen=[],onOutcome=o=>seen.push(o.status==='ok'?`ok:${o.count}`:o.status);
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k'},fetcher:model({concepts}),onOutcome});
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k',STYLIST_ENABLED:'false'},onOutcome});
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k'},fetcher:async()=>{throw Object.assign(Error('slow'),{name:'TimeoutError'});},onOutcome});
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k'},fetcher:async()=>({ok:false,status:429}),onOutcome});
 await stylistConcepts({query:'x',plan,env:{OPENAI_API_KEY:'k'},fetcher:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}]})}),onOutcome});
 assert.deepEqual(seen,['ok:2','off','timeout','http_429','invalid']);
});

test('a discovery that falls back records why, and gets no taste-free catalog results',async()=>{
 let result,shopQueries=[];
 const shop=async query=>{shopQueries.push(query);return {products:[{...p('generic'),source_provider:'shop_catalog'}]};};
 await textWishlistAction({action:'start',query:'casual shirts',search_plan:plan},{env:{SHOP_CATALOG_ENABLED:'true'},facts:[],record:async r=>{result=r;},
  stylist:async({onOutcome})=>{onOutcome({status:'timeout',model:'m',ms:20000});return [];},shop,search:async()=>({status:'found',products:[p('web1')]}),rank:async x=>x});
 assert.deepEqual(shopQueries,[],'no catalog search on the bare request');
 assert.equal(result.text_wishlist_diagnostics.stylist.status,'timeout');
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('web1').url]);
});

test('with directions, Shop’s catalog searches each direction, and its results are tagged with it',async()=>{
 let result,shopQueries=[];
 const shop=async query=>{shopQueries.push(query);return {products:[{...p('shop-'+shopQueries.length),source_provider:'shop_catalog'}],diagnostics:{offers:1}};};
 await textWishlistAction({action:'start',query:'going out top',search_plan:plan},{env:{SHOP_CATALOG_ENABLED:'true'},facts:[],record:async r=>{result=r;},
  stylist:async({onOutcome})=>{onOutcome({status:'ok',count:2});return concepts;},shop,search:async()=>({status:'found',products:[]}),rank:async x=>x});
 assert.deepEqual(shopQueries.sort(),concepts.map(c=>c.search_query).sort());
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.concept).sort(),concepts.map(c=>c.label).sort());
 assert.equal(result.text_wishlist_diagnostics.stylist.status,'ok');
});

test('a named or pictured item still searches the catalog with the request itself',async()=>{
 const shopQueries=[];
 await textWishlistAction({action:'start',query:'Salomon XT-6',search_plan:{...plan,mode:'identify'}},{env:{SHOP_CATALOG_ENABLED:'true'},facts:[],record:async()=>{},
  stylist:async()=>assert.fail('no stylist for identify'),shop:async q=>{shopQueries.push(q);return null;},search:async()=>({status:'found',products:[p('xt6')]}),rank:async x=>x});
 assert.deepEqual(shopQueries,['Salomon XT-6']);
});
