import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REPLAY_CASES,runReplay,scoreReplay} from '../lib/replay.js';
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
 const report=await runReplay(sample,{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true',WISHLIST_ENABLED:'true'},{fetcher:async(endpoint,options)=>{
  calls++;const request=JSON.parse(options.body);assert.equal(request.tools.some(t=>t.name==='text_wishlist'),true);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'function_call',name:'text_wishlist',arguments:JSON.stringify({action:'start',query:'Nike Air Max 90',choice:''})}]})};
 },search:async()=>({products:[p]})});
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
