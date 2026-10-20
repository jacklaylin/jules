import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,spreadPick} from '../lib/text-wishlist.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,agentContext} from './helpers/agent.js';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
import {rangeFailure,relevanceCheck} from '../lib/relevance.js';
const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[]};
const p=(id,brand='New brand')=>({brand,name:'Sneaker '+id,url:'https://www.ssense.com/products/'+id,match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',product_name:'Sneaker '+id}});
const model=value=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
test('broad clarification is a recorded pending brief without search, save or alerts',async()=>{
 let result;
 const reply=await generateReply([{direction:'inbound',body:'Saw some cool Rick Owenns sneakers today, help me find them?'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async()=>agentTurn(tool('ask_shopping_question',{query:'Rick Owens sneakers seen today',search_plan:{...plan,mode:'identify'},response:'Were they high tops or low tops?'})),{wishlistAction:args=>textWishlistAction(args,{env:{},record:async r=>{result=r;},search:()=>assert.fail('Premature search')})});
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
 // A position that names no shown option is dropped; the search still runs and nothing else is excluded.
 await act({action:'start',query:'More',search_plan:{...plan,exclude_option_indices:[99],keep_option_indices:[7]}},first,[p('e')]);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('e').url]);assert.deepEqual(result.text_wishlist_state.excluded_urls,[]);
 await act({action:'start',query:'Find these cheaper',search_plan:{...plan,keep_option_indices:[0]}},null,[p('f')]);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('f').url]);
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

test('jacket clarification continues the jacket brief despite earlier shoe context, retaining unknown department candidates',async()=>{
 let result,brief;const facts=[{field:'gender',key:'identity',value:'man'},{field:'size',key:'shoes/eu',value:'45'}];
 const state={stage:'search_clarification',options:[],search_brief:'Saint Laurent jacket worn by Connor Stores',search_plan:{...plan,mode:'identify'}};
 const candidate={...p('jacket','Saint Laurent'),name:'Sporty jacket',listing_check:{status:'verified',product_name:'Sporty jacket',shopping_range:null}};
 const messages=[{direction:'inbound',body:'Turn on an alert for my Satisfy shoes'},{direction:'outbound',status:'sent',body:'The shoe alert is on.'},{direction:'inbound',body:'There’s a saint Laurent jacket I saw Connor stores wearing, can you find it?'},{direction:'outbound',status:'sent',body:'Could you describe the jacket?'},{direction:'inbound',body:'Connor storrie* the actor. I think it was beige and navy and sort of sporty looking. Had a logo on it'}];
 const reply=await generateReply(messages,{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(_url,request)=>{
  assert.equal(agentContext(request).pending_shopping.search_brief,state.search_brief);
  return agentTurn(tool('find_products',{query:'Saint Laurent beige and navy sporty logo jacket worn by Connor Storrie',search_plan:{...plan,continuation:true,mode:'identify'},department:'men'}));
 },{facts,wishlistState:state,wishlistAction:args=>textWishlistAction(args,{state,text:messages.at(-1).body,facts,env:{},record:async r=>{result=r;},search:async query=>{brief=query;return {products:[candidate],refinement_attempted:true};}})});
 assert.ok(brief.includes('jacket'));assert.equal(result.text_wishlist_state.options[0].name,'Sporty jacket');assert.equal(result.text_wishlist_state.options[0].listing_check.shopping_range,null);assert.ok(!reply.includes('shoes'));assert.ok(!reply.includes('department'));assert.equal(result.user_confirmed,undefined);
 assert.equal(relevanceCheck({...candidate,listing_check:{shopping_range:'women'}},{range:'men',allow_unknown_range:true}).eligible,false);
 assert.ok(!rangeFailure([{reason:'range_unverified'}],{range:'men'}).includes('shoes'));
});

 test('planned discovery searches the wider web without requiring registry membership',async()=>{
 let scope;const candidate=p('new');const reply=await textWishlistAction({action:'start',query:'Jacques Marie Mage Romi sunglasses',search_plan:{...plan,mode:'identify'}},{env:{},text:'find them',record:async()=>{},search:async(_query,_images,_env,_fetch,_constraints,_refined,sourceScope)=>{scope=sourceScope;return {products:[candidate],refinement_attempted:true};}});
 assert.equal(scope,'web');assert.ok(reply.includes(candidate.url));
 });

test('current-request contradictions can be rejected without treating unfamiliar brands as exclusions',async()=>{
 const products=[p('wrong'),p('new','Unfamiliar Brand')];
 const ranked=await rankDiscoveryProducts(products,{query:'New black track jacket with white stripes',facts:[{field:'brand',key:'lemaire',value:'favorite'},{field:'size',key:'tops/general',value:'L'}],env:{OPENAI_API_KEY:'test'},fetcher:async(_url,options)=>{const input=JSON.parse(JSON.parse(options.body).input[0].content);assert.equal(input.size_facts[0].value,'L');return model({indices:[1],rejected_indices:[0]})();}});
 assert.deepEqual(ranked,[products[1]]);
});
test('rejected discovery results trigger a bounded replacement search before asking the user to change the brief',async()=>{
 let calls=0,result;const reply=await textWishlistAction({action:'start',query:'New black track jacket',search_plan:plan},{env:{},text:'find new options',record:async r=>{result=r;},search:async query=>{calls++;if(calls===2)assert.ok(query.includes(p('wrong').url));return {products:[p(calls===1?'wrong':'right')],refinement_attempted:true};},rank:async products=>products.filter(p=>p.name!=='Sneaker wrong')});
 assert.equal(calls,2);assert.ok(reply.includes(p('right').url));assert.ok(!reply.includes(p('wrong').url));assert.equal(result.text_wishlist_state.stage,'choice');
});

test('search before asking: real candidates shape the question and become selectable options, with no web search',async()=>{
 let result;const found=[p('geobasket','Rick Owens'),p('ramones','Rick Owens')].map((x,i)=>({...x,listing_check:{...x.listing_check,color:['Black','Milk'][i]}}));
 const args={action:'clarify_search',query:'Rick Owens sneakers seen today',search_plan:{...plan,mode:'identify'},response:'Were they high tops or low tops?'};
 const body=await textWishlistAction(args,{env:{},record:async r=>{result=r;},search:()=>assert.fail('No web search to ask a question'),
  candidates:async brief=>{assert.equal(brief,args.query);return found;},discriminate:async(_b,draft,products)=>{assert.equal(products.length,2);assert.equal(draft,args.response);return 'Was it the chunkier Geobasket or the lower Ramones?';}});
 assert.match(body,/Geobasket or the lower Ramones/);assert.ok(body.includes(found[0].url));
 assert.equal(result.text_wishlist_state.stage,'choice');assert.equal(result.text_wishlist_state.options.length,2);assert.equal(result.text_wishlist_state.search_plan.mode,'identify');assert.equal(result.user_confirmed,undefined);
 // Candidate lookup failure keeps the agent's question and the brief.
 await textWishlistAction(args,{env:{},record:async r=>{result=r;},candidates:async()=>{throw Error('down');},discriminate:()=>assert.fail()});
 assert.equal(result.text_wishlist_state.stage,'search_clarification');assert.equal(result.text_wishlist_state.search_brief,args.query);
 // Unverified candidates are never shown.
 const unverified=await textWishlistAction(args,{env:{},record:async r=>{result=r;},candidates:async()=>[{...found[0],listing_check:{status:'check_failed'}}],discriminate:()=>assert.fail()});
 assert.equal(unverified,args.response);
});

test('identified pages of a required brand that block verification are shown as unverified, not hidden',async()=>{
 let result;const page={brand:'ASICS',name:'GEL-KAYANO 14',url:'https://www.asics.com/us/en-us/gel-kayano-14/p/ANA_1202A105-700.html',match:'likely_match',sourcing_status:'store_not_found',listing_checks:[{status:'check_failed'}],merchant_options:[]};
 const body=await textWishlistAction({action:'start',query:'ASICS Gel-Kayano 14',search_plan:{...plan,required_brands:['ASICS']}},{env:{},record:async r=>{result=r;},search:async()=>({status:'identified_no_store',products:[page],refinement_attempted:true})});
 // Named honestly with its link, as a selectable option whose price and sizes are unknown.
 assert.match(body,/GEL-KAYANO 14/);assert.doesNotMatch(body,/couldn’t find a verified/);assert.ok(body.includes(page.url));assert.match(body,/can’t see its price or sizes/);assert.doesNotMatch(body,/couldn’t be (checked|read)|error/i);
 assert.equal(result.user_confirmed,undefined);assert.equal(result.text_wishlist_state.stage,'choice');assert.equal(result.text_wishlist_state.options[0].reference_provenance,'search_unverified');
});

test('when every verified match is sold out, one more search looks for in-stock listings elsewhere',async()=>{
 let result,calls=0,lastQuery='';const sold={...p('sold','ASICS'),listing_check:{status:'verified',product_name:'Sneaker sold',availability:'OutOfStock'}},stocked=p('stocked','ASICS');
 await textWishlistAction({action:'start',query:'ASICS Gel-Kayano 14',search_plan:{...plan,mode:'identify'}},{env:{},record:async r=>{result=r;},
  search:async q=>{calls++;lastQuery=q;return calls===1?{products:[sold],refinement_attempted:true}:{products:[stocked],refinement_attempted:true};}});
 assert.equal(calls,2);assert.ok(lastQuery.includes(sold.url));assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[stocked.url]);
 // If the retry finds nothing in stock, the sold-out matches are still reported honestly.
 calls=0;const body=await textWishlistAction({action:'start',query:'ASICS Gel-Kayano 14',search_plan:{...plan,mode:'identify'}},{env:{},record:async r=>{result=r;},search:async()=>{calls++;return {products:[sold],refinement_attempted:true};}});
 assert.equal(calls,2);assert.match(body,/sold out/i);
});

test('a candidate the ranker sets aside is replaced by the next eligible one, keeping directions spread',async()=>{
 let result,considered;
 const products=['a','b','c','d','e'].map(id=>p(id));
 await textWishlistAction({action:'start',query:'Casual cropped shirts',search_plan:plan},{env:{},text:'casual shirts',record:async r=>{result=r;},search:async()=>({products,refinement_attempted:true}),
  rank:async pool=>{considered=pool.map(x=>x.url);return pool.filter(x=>x.url!==p('b').url);}});
 assert.equal(considered.length,5);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[p('a').url,p('c').url,p('d').url]);
 assert.deepEqual(result.text_wishlist_diagnostics.rank,{considered:5,kept:4});
 // With directions, the best of each comes before a second from the same one; a link the user sent stays first.
 const tag=(id,concept)=>({...p(id),concept});
 assert.deepEqual(spreadPick([tag('a','x'),tag('b','x'),tag('c','y'),tag('d','z')]).map(o=>o.name),['Sneaker a','Sneaker c','Sneaker d']);
 assert.deepEqual(spreadPick([tag('a','x'),tag('b','x'),tag('c','y')],[tag('b','x')]).map(o=>o.name),['Sneaker b','Sneaker a','Sneaker c']);
});
