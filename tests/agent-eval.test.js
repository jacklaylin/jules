import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_EVAL_CASES,runAgentEval,scoreAgentEval,ranCalls} from '../lib/agent-eval.js';
import {agentTurn,tool,agentContext} from './helpers/agent.js';

test('every labeled case offers its expected tools in its own context, and runs with all tools stubbed',async()=>{
  assert.ok(AGENT_EVAL_CASES.length>=50);assert.equal(new Set(AGENT_EVAL_CASES.map(c=>c.id)).size,AGENT_EVAL_CASES.length);
  for(const c of AGENT_EVAL_CASES){
    let offered;
    const report=await runAgentEval(c,{OPENAI_API_KEY:'test'},{fetcher:async(url,options)=>{
      assert.equal(url,'https://api.openai.com/v1/responses','Eval turns never reach search providers');
      offered=JSON.parse(options.body).tools.map(t=>t.name);return agentTurn(tool('conversation_reply',{response:'ok'}));}});
    const expected=[...[].concat(c.expect.tool??[]).filter(Boolean),...Object.keys(c.expect.also??{}),...(c.expect.then??[])];
    assert.ok(expected.some(name=>offered.includes(name))||!expected.length,`${c.id}: none of ${expected} offered`);
    for(const name of expected.filter(n=>n!=='conversation_reply'))assert.ok(offered.includes(name),`${c.id}: ${name} not offered`);
    if(c.expect.signal!==undefined)assert.ok(offered.includes('record_quality_signal'),`${c.id}: record_quality_signal not offered`);
    assert.equal(report.id,c.id);
  }
});
test('scoring checks tool, nested arguments, set-valued indices, forbidden tools and profile side calls',()=>{
  const c=AGENT_EVAL_CASES.find(x=>x.id==='someone-elses-size');
  assert.equal(scoreAgentEval(c,[{name:'find_products',args:{for_someone_else:true}}]).passed,true);
  assert.match(scoreAgentEval(c,[{name:'find_products',args:{for_someone_else:true}},{name:'update_profile',args:{changes:[{field:'size'}]}}]).failures[0],/unexpected update_profile/);
  // A change the model marks as someone else's is dropped by the application, so it is not scored as saved.
  assert.equal(scoreAgentEval(c,[{name:'find_products',args:{for_someone_else:true}},{name:'update_profile',args:{changes:[{about:'someone_else',field:'size'}]}}]).passed,true);
  const mixed=AGENT_EVAL_CASES.find(x=>x.id==='own-size-sibling-style');
  assert.equal(scoreAgentEval(mixed,[{name:'conversation_reply',args:{}},{name:'update_profile',args:{changes:[{about:'user',field:'size'},{about:'someone_else',field:'style'}]}}]).passed,true);
  assert.match(scoreAgentEval(mixed,[{name:'conversation_reply',args:{}},{name:'update_profile',args:{changes:[{about:'user',field:'size'},{about:'user',field:'inspiration'}]}}]).failures[0],/unexpected update_profile/);
  const subset=AGENT_EVAL_CASES.find(x=>x.id==='subset-interest');
  assert.equal(scoreAgentEval(subset,[{name:'respond_to_options',args:{decision:'interest',option_indices:[1,0]}}]).passed,true);
  assert.match(scoreAgentEval(subset,[{name:'save_to_wishlist',args:{option_indices:[0,1]}}]).failures[0],/tool/);
  const details=AGENT_EVAL_CASES.find(x=>x.id==='details-arrive');
  assert.equal(scoreAgentEval(details,[{name:'find_products',args:{search_plan:{continuation:true,mode:'identify',guidance:[]}}}]).passed,true);
  const statement=AGENT_EVAL_CASES.find(x=>x.id==='size-statement');
  assert.equal(scoreAgentEval(statement,[{name:'update_profile',args:{changes:[{action:'remember',field:'size'}]}}]).passed,true);  const signal=AGENT_EVAL_CASES.find(x=>x.id==='signal-wrong-category'),quiet=AGENT_EVAL_CASES.find(x=>x.id==='no-signal-thinking-aloud');
  assert.equal(scoreAgentEval(signal,[{name:'find_products',args:{}},{name:'record_quality_signal',args:{kind:'wrong_results'}}]).passed,true);
  assert.match(scoreAgentEval(signal,[{name:'find_products',args:{}}]).failures[0],/missing record_quality_signal/);
  assert.match(scoreAgentEval(quiet,[{name:'respond_to_options',args:{}},{name:'record_quality_signal',args:{kind:'other'}}]).failures[0],/unexpected record_quality_signal/);
  assert.equal(scoreAgentEval(quiet,[{name:'respond_to_options',args:{}}]).passed,true);
});
test('eval scoring follows the loop: refused calls and the closing message do not count; multi-step cases need every step',async()=>{
  const call=(name,args,call_id)=>({type:'function_call',name,arguments:JSON.stringify(args),call_id});
  const output=(call_id,status)=>({type:'function_call_output',call_id,output:JSON.stringify({status})});
  // A refused save, then a search that ran, then the message: the search is the decision.
  const rounds=[{input:[call('save_to_wishlist',{},'a'),output('a','blocked'),call('find_products',{query:'x'},'b'),output('b','done')],output:[call('conversation_reply',{response:'ok'},'c')]}];
  assert.deepEqual(ranCalls(rounds).map(c=>c.name),['find_products']);
  assert.deepEqual(ranCalls([{input:[],output:[call('conversation_reply',{response:'hi'},'a')]}]).map(c=>c.name),['conversation_reply']);
  const multi=AGENT_EVAL_CASES.find(x=>x.id==='cheaper-and-alert');
  assert.equal(scoreAgentEval(multi,[{name:'find_products',args:{}},{name:'manage_price_alerts',args:{operation:'create'}}]).passed,true);
  assert.equal(scoreAgentEval(multi,[{name:'manage_price_alerts',args:{operation:'create'}},{name:'find_products',args:{}}]).passed,true);
  assert.match(scoreAgentEval(multi,[{name:'find_products',args:{}}]).failures[0],/missing follow-up manage_price_alerts/);
  // The eval runs the whole loop: a stubbed tool result goes back and the model's message closes the turn.
  const unverified=AGENT_EVAL_CASES.find(x=>x.id==='save-unverified-result');let requests=0;
  const report=await runAgentEval(unverified,{OPENAI_API_KEY:'test'},{fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.text?.format?.name==='consent')return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"newest_message_asks_for":["save_or_add_to_list","watch_price"],"newest_message_answers":"nothing_in_particular","asks_itself":true,"authorizes":true}'}]}]})};
    if(body.text?.format?.name==='profile_check')return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"changes":[]}'}]}]})};
    if(body.text?.format?.name==='quality')return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"verdict":"fine","kind":null,"about":null,"summary":null}'}]}]})};
    requests++;assert.equal(agentContext(options).pending_shopping.options[0].reference_provenance,'search_unverified');
    return requests===1?agentTurn(tool('save_to_wishlist',{option_indices:[0]})):agentTurn(tool('conversation_reply',{response:'saved.',claims:{saved_now:false,alerts_turned_on:false,alerts_turned_off:false}}));}});
  assert.equal(report.passed,true,report.failures.join());assert.equal(report.rounds,2);assert.equal(report.reply,'saved.');
});
