import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {generateReply} from '../lib/ai.js';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[]};
const p=(id,brand='New brand')=>({brand,name:'Sneaker '+id,url:'https://www.ssense.com/products/'+id,match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',product_name:'Sneaker '+id}});
const model=value=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
test('broad clarification is a recorded pending brief without search, save or alerts',async()=>{
 let result;
 const reply=await generateReply([{direction:'inbound',body:'Saw some cool Rick Owenns sneakers today, help me find them?'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},model({action:'clarify_search',query:'Rick Owens sneakers seen today',search_plan:{...plan,mode:'identify'},response:'Were they high tops or low tops?'}),{wishlistAction:args=>textWishlistAction(args,{text:'',env:{},record:async r=>{result=r;},search:()=>assert.fail('Premature search')})});
 assert.ok(reply);assert.equal(result.text_wishlist_state.stage,'search_clarification');assert.equal(result.text_wishlist_state.search_plan.mode,'identify');assert.equal(result.user_confirmed,undefined);assert.deepEqual(result.products,[]);
});
test('discovery ranks verified options without filtering unfamiliar brands and retains current brief',async()=>{
 let result,queries=[];const facts=[{field:'brand',key:'old brand',value:'favorite'},{field:'budget',key:'shoes',value:'usually 100'}];
 const products=[p('a','Old brand'),p('b'),p('c'),{...p('unverified'),listing_check:{status:'check_failed'}}];
 await textWishlistAction({action:'start',query:'Low sneakers with a substantial sole, open to other brands',search_plan:plan},{state:{search_brief:'Rick Owens sneakers'},text:'low ones, open to others',env:{},facts,record:async r=>{result=r;},search:async query=>{queries.push(query);return {products};},rank:async (eligible,input)=>{assert.deepEqual(input.facts,facts);return eligible.toReversed();}});
 assert.equal(queries.length,1);assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[products[2].url,products[1].url,products[0].url]);assert.equal(result.text_wishlist_state.search_brief,'Low sneakers with a substantial sole, open to other brands');assert.equal(result.user_confirmed,undefined);assert.deepEqual(facts,[{field:'brand',key:'old brand',value:'favorite'},{field:'budget',key:'shoes',value:'usually 100'}]);
});
test('feedback excludes referenced products across batches; a new topic clears temporary exclusions',async()=>{
 let result;const first={stage:'choice',options:[p('a'),p('b')],search_brief:'Black low tops',excluded_urls:[p('earlier').url]};
 const act=(args,state,products)=>textWishlistAction(args,{state,text:'feedback',env:{},record:async r=>{result=r;},search:async()=>({products,refinement_attempted:true}),rank:async x=>x});
 await act({action:'start',query:'Black low tops, less chunky',search_plan:{...plan,continuation:true,guidance:['less chunky'],exclude_option_indices:[0,1]}},first,[p('a'),p('c')]);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('c').url]);assert.equal(result.text_wishlist_state.excluded_urls.length,3);
 const next=result.text_wishlist_state;await act({action:'start',query:'More black low tops, less chunky',search_plan:{...plan,continuation:true,exclude_option_indices:[0]}},next,[p('a'),p('d')]);assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('d').url]);
 await act({action:'start',query:'A bag for a friend',search_plan:plan},result.text_wishlist_state,[p('a')]);assert.deepEqual(result.text_wishlist_state.excluded_urls,[]);
 await assert.rejects(act({action:'start',query:'More',search_plan:{...plan,exclude_option_indices:[99]}},first,[]));
});
test('failed discovery preserves retry brief but never resurrects rejected choices',async()=>{
 let result;await textWishlistAction({action:'start',query:'Less chunky black sneakers',search_plan:{...plan,guidance:['less chunky']}},{state:{options:[p('old')]},text:'',env:{},record:async r=>{result=r;},search:async()=>{throw Error('Provider down');}});
 assert.equal(result.text_wishlist_state.search_brief,'Less chunky black sneakers');assert.deepEqual(result.text_wishlist_state.options,[]);assert.equal(result.user_confirmed,undefined);
});
test('model ranking is a permutation only; malformed/provider failure preserves every option',async()=>{
 const products=[p('a'),p('b'),p('c')],env={OPENAI_API_KEY:'test'};
 assert.deepEqual(await rankDiscoveryProducts(products,{env,fetcher:model({indices:[2,0,1]})}),[products[2],products[0],products[1]]);
 for(const indices of [[0,0,1],[0,1],[0,1,99]])assert.deepEqual(await rankDiscoveryProducts(products,{env,fetcher:model({indices})}),products);
 assert.deepEqual(await rankDiscoveryProducts(products,{env,fetcher:async()=>{throw Error('offline');}}),products);
});

test('accepting a discovery subset is interest only and carries the brief into later feedback',async()=>{
 let result;const state={stage:'choice',query:'Understated sneakers',search_brief:'Understated sneakers',search_plan:plan,options:[p('a'),p('b'),p('c')],constraints:{}};
 await textWishlistAction({action:'selection',decision:'interest',option_indices:[0,2],consent:'none',consent_context:'none'},{state,text:'first and third are closer',env:{},record:async r=>{result=r;},search:()=>assert.fail('Selection must not restart search')});
 assert.deepEqual(result.text_wishlist_state.selected_set.map(o=>o.url),[p('a').url,p('c').url]);assert.equal(result.text_wishlist_state.search_brief,state.search_brief);assert.equal(result.user_confirmed,undefined);assert.equal(result.alert_request,undefined);
});

test('keep a subset while seeking more preserves its reference and separate new results without consent',async()=>{
 let result;const first={options:[p('a'),p('b')],search_brief:'Low sneakers'};
 await textWishlistAction({action:'start',query:'Low sneakers, more like the first',search_plan:{...plan,continuation:true,keep_option_indices:[0],exclude_option_indices:[1]}},{state:first,text:'first is good, show other options',env:{},record:async r=>{result=r;},search:async()=>({products:[p('a'),p('b'),p('c')]}),rank:async x=>x});
 assert.deepEqual(result.text_wishlist_state.kept_options.map(o=>o.url),[p('a').url]);assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a').url,p('c').url]);assert.equal(result.user_confirmed,undefined);
});

test('an exhausted discovery batch never returns excluded links or unverified shopping candidates',async()=>{
 let result;const reply=await textWishlistAction({action:'start',query:'Different black sneakers',search_plan:{...plan,continuation:true,exclude_option_indices:[0]}},{state:{options:[p('a')]},text:'more',env:{},record:async r=>{result=r;},search:async()=>({products:[p('a'),{...p('unsafe'),listing_check:{status:'check_failed'}}],refinement_attempted:true})});
 assert.ok(!reply.includes('https://'));assert.deepEqual(result.text_wishlist_state.options,[]);assert.equal(result.text_wishlist_state.search_brief,'Different black sneakers');
});
