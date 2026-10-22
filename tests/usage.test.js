import test from 'node:test';
import assert from 'node:assert/strict';
// The meter wraps the global fetch, so the stub must be in place first.
const calls=[],bodies=[];
globalThis.fetch=async (url,init)=>{calls.push(String(url));bodies.push(init?.body??null);
  if(String(url).startsWith('https://api.openai.com/'))return new Response(JSON.stringify({model:'gpt-4.1-mini-2025-04-14',status:'completed',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:400},output_tokens:200},output:[{type:'web_search_call'},{type:'message'}]}));
  if(String(url).startsWith('https://serpapi.com/'))return new Response('{"organic_results":[]}');
  if(String(url).startsWith('https://openrouter.ai/'))return new Response(JSON.stringify({model:JSON.parse(init.body).model,status:'completed',usage:{input_tokens:1000,output_tokens:100,cost:0.0042},output:[]}));
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
  // (600*0.40 + 400*0.10 + 200*1.60)/1e6 + one web search call at 0.010
  assert.equal(ai.cost_usd,0.0106);assert.equal(serp.provider,'serpapi');assert.equal(serp.model,'google');assert.equal(serp.cost_usd,0.015);
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
  assert.deepEqual(seen.map(r=>[r.feature,r.operation,r.conversation_id,r.cost_usd]),[['eval_agent','eval:run',null,0.0106]]);
});
test('a scheduled job tags its calls, nested actions inherit the job, and costs survive a database without the job column',async()=>{
  const recorded=[];const store={recordUsage:async rows=>recorded.push(...rows)};
  await withUsage({store,env:{},conversation:'c1',operation:'price-check:a',feature:'price_alerts',job:'price_checks',quiet:true},async()=>{
    await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();
    await withUsage({store,env:{},conversation:'c1',operation:'price-discovery:a',feature:'price_alerts',quiet:true},()=>fetch('https://serpapi.com/search?engine=google'));
  });
  assert.deepEqual(recorded.map(r=>[r.provider,r.job]),[['serpapi','price_checks'],['openai','price_checks']]);
  const kept=[];let tries=0;
  await withUsage({store:{recordUsage:async rows=>{tries++;if(rows.some(r=>'job' in r))throw Error('column usage_events.job does not exist');kept.push(...rows);}},env:{},conversation:'c',operation:'o',feature:'chat',job:'reply_watchdog',quiet:true},async()=>{await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();});
  assert.equal(tries,2);assert.equal(kept.length,1);assert.equal(kept[0].job,undefined);assert.equal(kept[0].cost_usd,0.0106);
  // Calls by people (no job) are written without the column, as before.
  recorded.length=0;await withUsage({store,env:{},conversation:'c',operation:'ai:m',feature:'chat',quiet:true},()=>fetch('https://serpapi.com/search'));
  assert.equal('job' in recorded[0],false);
});
test('gpt-5.5 and its dated snapshots are priced at the standard list rate',()=>{
  // (1M uncached input * $5 + 1M cached * $0.50 + 1M output * $30) / 1M
  assert.equal(priceFor({provider:'openai',model:'gpt-5.5-2026-04-23',input_tokens:2e6,cached_tokens:1e6,output_tokens:1e6,web_search_calls:0}),35.5);
});
test('a billable call outside any metered action is recorded as unattributed with the line that made it',async()=>{
  const {flushUnattributed}=await import('../lib/usage.js');
  const sent=[];const original=globalThis.fetch;
  process.env.SUPABASE_URL='https://db.test.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-test';
  try{
    // The meter wrapped the stub at import; the store's own write goes to the (local, .invalid) database.
    const before=calls.length;
    await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();
    await flushUnattributed();
    const at=calls.findIndex((u,i)=>i>=before&&u.startsWith('https://db.test.invalid/rest/v1/usage_events'));
    assert.ok(at>=0,'usage row written');
    const [row]=JSON.parse(bodies[at]);
    assert.deepEqual([row.feature,row.provider,row.conversation_id,row.cost_usd],['unattributed','openai',null,0.0106]);
    assert.match(row.operation,/^unmetered:(tests\/usage\.test\.js|unknown)/);
  }finally{delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;globalThis.fetch=original;}
});
test('every API entry point loads the meter before anything else, so no handler keeps an unmetered fetch',async()=>{
  const {readdirSync,readFileSync}=await import('node:fs');
  const dir=new URL('../api/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.js'))){
    const first=readFileSync(new URL(file,dir),'utf8').split('\n').find(l=>/^import\b/.test(l));
    assert.equal(first,"import '../lib/usage.js';",`api/${file} imports lib/usage.js first`);
  }
});

test('new GPT-5 family and luna models are priced, and an unknown model is logged and never free',()=>{
  const m=model=>priceFor({provider:'openai',model,input_tokens:1e6,cached_tokens:0,output_tokens:1e6,web_search_calls:0});
  assert.deepEqual(['gpt-5-nano','gpt-5.4-nano','gpt-5.4-mini','gpt-5.6-luna','gpt-6-luna'].map(m),[0.45,1.45,5.25,1.4,0.6]);
  const logs=[];const log=console.log;console.log=line=>logs.push(line);
  try{assert.equal(m('gpt-7-nova'),35);}finally{console.log=log;}
  assert.match(logs.join(''),/usage_unpriced_model.*gpt-7-nova/);
});
test('a role pointed at OpenRouter is sent there and metered at the reported or listed price',async()=>{
  process.env.OPENROUTER_API_KEY='or-test';
  const recorded=[];
  try{
    await withUsage({store:{recordUsage:async rows=>recorded.push(...rows)},env:{},conversation:'c',operation:'o',feature:'chat',quiet:true},async()=>{
      for(const model of ['openrouter:anthropic/claude-haiku-5.5','openrouter:openai/gpt-oss-120b@groq'])
        await (await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer sk-openai'},body:JSON.stringify({model,input:'hi'})})).json();
    });
  }finally{delete process.env.OPENROUTER_API_KEY;}
  assert.equal(calls.filter(u=>u==='https://openrouter.ai/api/v1/responses').length,2);
  assert.doesNotMatch(String(bodies.at(-1)),/sk-openai/);
  // Haiku from the table: (1000*0.10 + 100*0.50)/1e6; gpt-oss from OpenRouter's reported cost.
  assert.deepEqual(recorded.map(r=>[r.provider,r.model,r.cost_usd,'reported_cost' in r]),[['openrouter','anthropic/claude-haiku-5.5',0.00015,false],['openrouter','openai/gpt-oss-120b',0.0042,false]]);
});
test('an unattributed call names the feature code that made it, not the shared model transport',async()=>{
  const {callSite}=await import('../lib/usage.js');
  const stack=['Error','    at globalThis.fetch (file:///var/task/lib/usage.js:118:17)','    at modelResponse (file:///var/task/lib/model-call.js:44:26)',
    '    at callModel (file:///var/task/lib/model-call.js:71:26)','    at continuesReport (file:///var/task/lib/developer-feedback.js:54:24)','    at continueDeveloperReport (file:///var/task/lib/inbox.js:152:16)'].join('\n');
  assert.equal(callSite(stack),'lib/developer-feedback.js:54');
  // A real call through the transport never reports it either (this test file itself is outside lib/api/scripts).
  const {modelResponse}=await import('../lib/model-call.js');
  let site;
  await modelResponse({env:{OPENAI_API_KEY:'test'},fetcher:async()=>{site=callSite();return new Response('{}');}});
  assert.ok(!/model-call\.js/.test(site),site);
});
test('the #dev follow-up check is metered to the tester as developer feedback',async()=>{
  const {receiveInInbox}=await import('../lib/inbox.js');
  const rows=[],now=Date.parse('2026-10-21T00:28:30Z');
  const store={receive:async()=>'conversation-1',claimAI:async()=>true,recordUsage:async r=>{rows.push(...r);},
    inboundBefore:async()=>[{provider_id:'report-1',developer_feedback:'the third store looks fake:',created_at:new Date(now-5000).toISOString()}],
    saveFeedback:async()=>{},reserve:async()=>true,prepareAI:async()=>{},finish:async()=>{}};
  const delivery={space:{phone:'test-line'},message:{id:'follow-1',sender:{id:'test-sender'},content:{type:'text',text:'https://store.example/'},attachments:[]}};
  const event=await receiveInInbox(delivery,{AI_ENABLED:'true',OPENAI_API_KEY:'test'},{store,now:()=>now,send:async()=>{},
    continuationCheck:async()=>{await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();return true;}});
  assert.equal(event,'developer_feedback_continued');
  assert.deepEqual(rows.map(r=>[r.feature,r.conversation_id,r.operation,r.provider]),[['developer_feedback','conversation-1','feedback-check:follow-1','openai']]);
});

// usage_events rejects a whole batch when one row's provider fails its check, so every provider the
// meter writes must be allowed by the latest migration that sets that check.
test('the database accepts every provider the meter records',async()=>{
  const {readdirSync,readFileSync}=await import('node:fs');
  const dir=new URL('../db/',import.meta.url);
  let allowed=null;
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
    const sql=readFileSync(new URL(file,dir),'utf8').replace(/--.*$/gm,'');
    if(!/usage_events/.test(sql))continue;
    for(const m of sql.matchAll(/provider\s+in\s*\(([^)]*)\)/gi))allowed=[...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
  }
  const recorded=[];const store={recordUsage:async rows=>recorded.push(...rows)};
  await withUsage({store,env:{},conversation:'c1',operation:'ai:m9',feature:'chat'},async()=>{
    await (await fetch('https://api.openai.com/v1/responses',{method:'POST'})).json();
    await fetch('https://serpapi.com/search?engine=google&q=x');
    await (await fetch('https://openrouter.ai/api/v1/responses',{method:'POST',body:JSON.stringify({model:'anthropic/claude-haiku-5.5'})})).json();
  });
  assert.deepEqual([...new Set(recorded.map(r=>r.provider))].sort(),['openai','openrouter','serpapi']);
  for(const r of recorded)assert.ok(allowed?.includes(r.provider),`usage_events check does not allow ${r.provider}`);
});
