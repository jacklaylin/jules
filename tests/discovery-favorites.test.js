import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidateSignals,fallbackOrder,rankDiscoveryProducts} from '../lib/discovery-ranking.js';
import {searchPlan,textWishlistAction} from '../lib/text-wishlist.js';

// Discovery favors the user's own brands and stores (founder decision, October 19). Code finds which
// saved facts and purchases name a candidate's brand or store; the ranker reads them and decides.
const p=(id,brand,url,match='likely_match')=>({brand,name:'Tee '+id,url,match,sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:'Tee '+id,product_brand:brand,url},price_snapshot:{amount:120,currency:'USD'}});
const liked=p('liked','Satisfy','https://satisfyrunning.com/products/tee');
const unknown=p('unknown','Example Basics','https://example-basics.example/products/tee','similar');
const curated=p('curated','Studio Nicholson','https://www.ssense.com/en-us/men/product/studio-nicholson/tee/1');
const avoided=p('avoided','Fast Fashion Co','https://fastfashionco.example/products/tee');
const depop=p('depop','Vintage Band','https://www.depop.com/products/seller-vintage-band-tee/');
const bought=p('bought','Our Legacy','https://www.mrporter.com/en-us/mens/product/our-legacy/tee/1');
const facts=[
 {field:'store',key:'depop',value:'buys vintage tees there'},
 {field:'avoid',key:'fast fashion co',value:'falls apart'},
 {field:'brand',key:'Lemaire',value:'loves it'},
 {field:'shopping_history',key:'i1',value:JSON.stringify({brand:'Our Legacy',merchant:'MR PORTER'})},
 {field:'size',key:'tops/letter',value:'M'},
];

test('signals name what links a candidate to the user, without reading what the facts say',()=>{
 const s=candidateSignals(liked,{facts,referenceBrands:['satisfy']});
 assert.equal(s.reference_brand,true);assert.deepEqual(s.saved_facts,[]);assert.equal(s.store_reputation,'official brand store');
 assert.deepEqual(candidateSignals(depop,{facts}).saved_facts,[{field:'store',key:'depop',value:'buys vintage tees there'}]);
 assert.equal(candidateSignals(depop,{facts}).store_reputation,'resale marketplace');
 assert.deepEqual(candidateSignals(avoided,{facts}).saved_facts.map(f=>f.field),['avoid']);
 const b=candidateSignals(bought,{facts});assert.equal(b.bought_brand,true);assert.equal(b.bought_from_store,true);assert.equal(b.store_reputation,'curated retailer');
 const u=candidateSignals(unknown,{facts,referenceBrands:['satisfy']});
 assert.deepEqual([u.reference_brand,u.saved_facts.length,u.bought_brand,u.bought_from_store,u.store_reputation,u.match],[false,0,false,false,'unreviewed store','similar']);
 // A deleted fact no longer counts.
 assert.deepEqual(candidateSignals(depop,{facts:facts.map(f=>({...f,deleted:true}))}).saved_facts,[]);
});

test('the ranker receives each candidate\'s signals and is told to favor the user\'s brands and stores',async()=>{
 let body;
 const fetcher=async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({indices:[1,0],rejected_indices:[]})}]}]})};};
 const ranked=await rankDiscoveryProducts([unknown,liked],{query:'distressed tees',facts,referenceBrands:['Satisfy'],env:{OPENAI_API_KEY:'test'},fetcher});
 assert.deepEqual(ranked,[liked,unknown]);
 const candidates=JSON.parse(body.input[0].content).candidates;
 assert.equal(candidates[1].signals.reference_brand,true);assert.equal(candidates[0].signals.store_reputation,'unreviewed store');
 assert.match(body.instructions,/favor the user.s own brands and stores/);assert.match(body.instructions,/avoids last/);
});

test('without a ranking, the user\'s brands and stores come first, avoided ones last, then reputable stores and close matches',async()=>{
 const input={facts,referenceBrands:['Satisfy']};
 assert.deepEqual(fallbackOrder([avoided,unknown,curated,bought,depop,liked],input).map(x=>x.name),['Tee liked','Tee depop','Tee bought','Tee curated','Tee unknown','Tee avoided']);
 for(const failure of [async()=>({ok:false}),async()=>{throw Error('offline');},async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"indices":[0],"rejected_indices":[]}'}]}]})})]){
  const ranked=await rankDiscoveryProducts([avoided,unknown,liked],{query:'tees',...input,env:{OPENAI_API_KEY:'test'},fetcher:failure});
  assert.deepEqual(ranked.map(x=>x.name),['Tee liked','Tee unknown','Tee avoided']);
 }
});

test('multi-turn: the search plan\'s reference brands reach the ranker, first search and follow-up alike',async()=>{
 const raw={continuation:'new_request',mode:'discover',named_model:null,brands:[{name:'Satisfy',role:'reference'}],hard_constraints:[],guidance:['worn look'],keep_option_indices:[],exclude_option_indices:[]};
 const seen=[];let recorded;
 const rank=async(products,input)=>{seen.push(input.referenceBrands);return products;};
 const run=(plan,state)=>textWishlistAction({action:'start',query:'distressed tees',search_plan:plan},{state,env:{},facts,record:async r=>{recorded=r;},search:async()=>({products:[unknown,liked],refinement_attempted:true}),rank});
 await run(searchPlan(raw),null);
 await run(searchPlan({...raw,continuation:'same_request',guidance:['more like the first']}),recorded.text_wishlist_state);
 assert.deepEqual(seen,[['Satisfy'],['Satisfy']]);
});
