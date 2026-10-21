import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
import {textWishlistAction} from '../lib/text-wishlist.js';

// October 21: in a search for a chunky, bright red half-zip, a cream crewneck was shown first. The ranker
// saw only the one-line brief. It now also gets the plan's stated requirements and preferences, and is told
// that a candidate of another garment type or a clearly different colour than asked for is a contradiction.
const p=(id,name,color)=>({brand:'Brand '+id,name,url:`https://${id}.example/products/knit`,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:name,product_brand:'Brand '+id,color},price_snapshot:{amount:250,currency:'USD'}});
const crew=p('crew','Fisherman Cable Jumper','Aran'),zip=p('zip','Boiled Half-Zip Sweater','Terra Red'),alpaca=p('alpaca','Half-Zip Alpaca Sweater','Oatmeal');
const reply=answer=>async(_url,options)=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}),body:options.body});

test('the ranker reads the stated requirements and preferences, and its rejections are left out',async()=>{
 for(const requested of [{hard_constraints:['half-zip','bright red'],guidance:['chunky knit']},{hard_constraints:['price max 800'],guidance:['chunky knit','bright red color','half zip']}]){
  let body;
  const out=await rankDiscoveryProducts([crew,zip,alpaca],{query:'chunky bright red half zip sweater',requested,env:{OPENAI_API_KEY:'test'},
   fetcher:async(u,o)=>{body=JSON.parse(o.body);return reply({indices:[1],rejected_indices:[0,2],unlike_references_indices:[]})(u,o);}});
  const input=JSON.parse(body.input[0].content);
  assert.deepEqual(input.requested,requested);
  assert.deepEqual(input.candidates.map(c=>c.color),['Aran','Terra Red','Oatmeal']);
  assert.match(body.instructions,/different garment type/);
  assert.deepEqual(out.map(x=>x.name),['Boiled Half-Zip Sweater']);
 }
 // No plan: an empty reading, never invented requirements.
 let body;
 await rankDiscoveryProducts([crew,zip],{query:'knit',env:{OPENAI_API_KEY:'test'},fetcher:async(u,o)=>{body=JSON.parse(o.body);return reply({indices:[0,1],rejected_indices:[],unlike_references_indices:[]})(u,o);}});
 assert.deepEqual(JSON.parse(body.input[0].content).requested,{hard_constraints:[],guidance:[]});
});

test('a discovery search hands its plan to the ranker',async()=>{
 const plan={continuation:true,mode:'discover',required_brands:[],reference_brands:[],level:'premium',hard_constraints:['price max 800'],guidance:['chunky knit','bright red color'],keep_option_indices:[],exclude_option_indices:[]};
 let seen;
 await textWishlistAction({action:'start',query:'chunky bright red half zip sweater',search_plan:plan},{env:{},facts:[],record:async()=>{},stylist:async()=>[],
  search:async()=>({status:'found',products:[crew,zip]}),rank:async(list,o)=>{seen=o.requested;return list;},owned:async()=>[]});
 assert.deepEqual([seen.hard_constraints,seen.guidance],[plan.hard_constraints,plan.guidance]);
});
