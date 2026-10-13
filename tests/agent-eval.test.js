import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_EVAL_CASES,runAgentEval,scoreAgentEval} from '../lib/agent-eval.js';
import {agentTurn,tool} from './helpers/agent.js';

test('every labeled case offers its expected tools in its own context, and runs with all tools stubbed',async()=>{
  assert.ok(AGENT_EVAL_CASES.length>=50);assert.equal(new Set(AGENT_EVAL_CASES.map(c=>c.id)).size,AGENT_EVAL_CASES.length);
  for(const c of AGENT_EVAL_CASES){
    let offered;
    const report=await runAgentEval(c,{OPENAI_API_KEY:'test'},{fetcher:async(url,options)=>{
      assert.equal(url,'https://api.openai.com/v1/responses','Eval turns never reach search providers');
      offered=JSON.parse(options.body).tools.map(t=>t.name);return agentTurn(tool('conversation_reply',{response:'ok'}));}});
    const expected=[...[].concat(c.expect.tool??[]).filter(Boolean),...Object.keys(c.expect.also??{})];
    assert.ok(expected.some(name=>offered.includes(name))||!expected.length,`${c.id}: none of ${expected} offered`);
    for(const name of expected.filter(n=>n!=='conversation_reply'))assert.ok(offered.includes(name),`${c.id}: ${name} not offered`);
    assert.equal(report.id,c.id);
  }
});
test('scoring checks tool, nested arguments, set-valued indices, forbidden tools and profile side calls',()=>{
  const c=AGENT_EVAL_CASES.find(x=>x.id==='someone-elses-size');
  assert.equal(scoreAgentEval(c,[{name:'find_products',args:{for_someone_else:true}}]).passed,true);
  assert.match(scoreAgentEval(c,[{name:'find_products',args:{for_someone_else:true}},{name:'update_profile',args:{changes:[{field:'size'}]}}]).failures[0],/unexpected update_profile/);
  const subset=AGENT_EVAL_CASES.find(x=>x.id==='subset-interest');
  assert.equal(scoreAgentEval(subset,[{name:'respond_to_options',args:{decision:'interest',option_indices:[1,0]}}]).passed,true);
  assert.match(scoreAgentEval(subset,[{name:'save_to_wishlist',args:{option_indices:[0,1]}}]).failures[0],/tool/);
  const details=AGENT_EVAL_CASES.find(x=>x.id==='details-arrive');
  assert.equal(scoreAgentEval(details,[{name:'find_products',args:{search_plan:{continuation:true,mode:'identify',guidance:[]}}}]).passed,true);
  const statement=AGENT_EVAL_CASES.find(x=>x.id==='size-statement');
  assert.equal(scoreAgentEval(statement,[{name:'update_profile',args:{changes:[{action:'remember',field:'size'}]}}]).passed,true);
});
