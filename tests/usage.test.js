import test from 'node:test';
import assert from 'node:assert/strict';
// The meter wraps the global fetch, so the stub must be in place first.
const calls=[];
globalThis.fetch=async url=>{calls.push(String(url));
  if(String(url).startsWith('https://api.openai.com/'))return new Response(JSON.stringify({model:'gpt-4.1-mini-2025-04-14',status:'completed',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:400},output_tokens:200},output:[{type:'web_search_call'},{type:'message'}]}));
  if(String(url).startsWith('https://serpapi.com/'))return new Response('{"organic_results":[]}');
  return new Response('<html>retailer page</html>');};
const {withUsage,priceFor,labelUsage}=await import('../lib/usage.js');

test('every billable call inside one user action is attributed to it, with an estimated cost',async()=>{
  const recorded=[];const store={recordUsage:async rows=>recorded.push(...rows)};
  const result=await withUsage({store,env:{},conversation:'c1',operation:'ai:m1',feature:'chat'},async()=>{
    labelUsage('find_products');
    await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();
    await fetch('https://serpapi.com/search?engine=google&q=x');
    await (await fetch('https://www.prada.com/p/1')).text();
    return 'reply';
  });
  assert.equal(result,'reply');assert.equal(recorded.length,2);
  const [ai,serp]=recorded;
  assert.deepEqual([ai.provider,ai.model,ai.input_tokens,ai.cached_tokens,ai.output_tokens,ai.web_search_calls,ai.action,ai.feature,ai.conversation_id],['openai','gpt-4.1-mini-2025-04-14',1000,400,200,1,'find_products','chat','c1']);
  // (600*0.40 + 400*0.10 + 200*1.60)/1e6 + one web search call at 0.025
  assert.equal(ai.cost_usd,0.0256);assert.equal(serp.provider,'serpapi');assert.equal(serp.model,'google');assert.equal(serp.cost_usd,0.015);
});
test('calls outside an action are not metered, and a failed write never fails the action',async()=>{
  await fetch('https://api.openai.com/v1/responses');
  let attempted=0;
  assert.equal(await withUsage({store:{recordUsage:async()=>{attempted++;throw Error('table missing');}},conversation:'c',operation:'o',feature:'chat'},async()=>{await fetch('https://serpapi.com/search');return 'ok';}),'ok');
  assert.equal(attempted,1);
  assert.equal(priceFor({provider:'serpapi',units:2},{SERPAPI_COST_PER_SEARCH:'0.01'}),0.02);
  assert.equal(priceFor({provider:'openai',model:'gpt-4.1-2025-04-14',input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0}),2);
});
test('onUsage receives the priced rows even with no store, so a script can keep a running total',async()=>{
  const seen=[];
  await withUsage({env:{},conversation:null,operation:'eval:run',feature:'eval_agent',onUsage:rows=>seen.push(...rows)},async()=>{await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();});
  assert.deepEqual(seen.map(r=>[r.feature,r.operation,r.conversation_id,r.cost_usd]),[['eval_agent','eval:run',null,0.0256]]);
});
