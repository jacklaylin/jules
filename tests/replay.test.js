import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REPLAY_CASES,runReplay,scoreReplay} from '../lib/replay.js';
import {agentTurn,tool,restating} from './helpers/agent.js';
const sample=REPLAY_CASES[0];
const url='https://www.nike.com/t/air-max-90-shoes/EXAMPLE';
const p={brand:'Nike',name:'Air Max 90 sneakers',url,match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',shopping_range:'men',color:'Black',product_name:'Air Max 90'}};
test('shoe acceptance requires supported product links or a meaningful variant clarification',()=>{
 assert.equal(scoreReplay(sample,{body:'Here is Air Max 90.\n'+url,result:{products:[p]}}).passed,true);
 assert.equal(scoreReplay(sample,{body:'Do you want the leather or mesh version?'}).passed,true);
 for(const body of ['I couldn’t verify one in your shopping range.','Which budget do you have?','Done.'])assert.equal(scoreReplay(sample,{body}).passed,false);
 assert.equal(scoreReplay(sample,{body:url,result:{products:[{...p,listing_check:{status:'verified',shopping_range:'women'}}]}}).passed,false);
 assert.equal(scoreReplay(sample,{body:'https://www.nike.com/c/shoes',result:{products:[{...p,url:'https://www.nike.com/c/shoes'}]}}).passed,false);
 assert.equal(scoreReplay(sample,{body:url,result:{products:[{...p,brand:'Other'}]}}).passed,false);
 assert.equal(scoreReplay(sample,{body:url,result:{products:[{...p,name:'Wrong model',listing_check:{...p.listing_check,product_name:'Wrong model'},url:'https://www.nike.com/t/other'}]}}).passed,false);
});
test('actual reply dispatcher and wishlist actions run without a persistence or delivery dependency',async()=>{
 let calls=0;
 const report=await runReplay(sample,{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true',WISHLIST_ENABLED:'true'},{fetcher:restating(async(endpoint,options)=>{
  calls++;const request=JSON.parse(options.body);assert.equal(request.tool_choice,'required');
  return agentTurn(tool('find_products',{query:'Nike Air Max 90',department:'men'}));
 }),search:async()=>({products:[p]})});
 assert.equal(calls,1);assert.equal(report.tool,'text_wishlist');assert.equal(report.passed,true);assert.equal(report.result.user_confirmed,undefined);assert.equal(report.result.text_wishlist_state.stage,'choice');
});
test('replay errors and unsupported links are failures; unavailable prices do not invalidate a valid page',async()=>{
 assert.equal((await runReplay(sample,{}, {generate:async()=>{throw Error();}})).passed,false);
 assert.equal(scoreReplay(sample,{body:url}).passed,false);
 assert.equal(scoreReplay(sample,{body:url,result:{products:[{...p,price_snapshot:null}]}}).passed,true);
 assert.equal(scoreReplay(sample,{body:'Saved to your wishlist.\n'+url,result:{products:[p]}}).passed,false);
});
test('unknown models and ambiguous families have separate expectations',()=>{
 const unknown=REPLAY_CASES.find(c=>c.unknown),variants=REPLAY_CASES.find(c=>c.requireQuestion);
 assert.equal(scoreReplay(unknown,{body:'Can you send the product link or a photo of the label?'}).passed,true);
 assert.equal(scoreReplay(unknown,{body:'Try again.'}).passed,false);
 assert.equal(scoreReplay(variants,{body:'Which version, v5 or v6, do you mean?'}).passed,true);
 assert.equal(scoreReplay(variants,{body:'Here you go.'}).passed,false);
 assert.equal(scoreReplay(variants,{body:'The 990 has several versions. Are you looking for something retro, runner-style, or fashion-focused?'}).passed,true);
 assert.equal(scoreReplay(variants,{body:'The 990 has several versions. What is your budget?'}).passed,false);
});
test('named-item replay cases fail when the item was found only on a retry, across varied wording',()=>{
 const cases=REPLAY_CASES.filter(c=>c.first_attempt);
 assert.ok(cases.length>=6);assert.ok(new Set(cases.map(c=>c.brand)).size>=4);
 const peyter=cases.find(c=>c.id==='named-dries-peyter-casual'),url='https://shop-us.doverstreetmarket.com/products/dries-van-noten-peyter-4302-pants-black';
 const option={url,brand:'Dries Van Noten',name:'Peyter Pants',listing_check:{status:'verified',shopping_range:'men'}};
 const run=first=>scoreReplay(peyter,{body:'dries van noten peyter pants\n'+url,result:{text_wishlist_state:{options:[option]},text_wishlist_diagnostics:{sourcing:{first:{exact_found_first_attempt:first}}}}});
 assert.equal(run(true).passed,true);
 assert.deepEqual(run(false).failures,['not_found_on_first_search']);
 assert.ok(scoreReplay(peyter,{body:'i couldn’t find it.',result:{}}).failures.includes('named_item_not_found'));
});
