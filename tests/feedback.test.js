import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { createStore } from '../lib/store.js';
import { createAdminHandler } from '../api/admin.js';
import { generateReply } from '../lib/ai.js';
import { agentTurn, tool } from './helpers/agent.js';
const delivery = text => ({space:{phone:'test-line'},message:{id:'test-message',sender:{id:'test-sender'},content:{text}}});
// Feedback for the developer is one of the agent's tools; no message prefix is matched.
function fixture(turn) {
  const reports = new Map(), sent = [];let claimed=false;
  return { reports, sent, store: {
    receive: async () => 'conversation', claimAI: async () => { if (claimed) return false; claimed = true; return true; },
    context: async () => [{ id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body:'replies are long', status:'received' }],
    saveFeedback: async (id, body) => reports.set(id, body), prepareAI: async () => {}, finish: async () => {},
  }, send: async (_delivery,body) => sent.push(body), generate: (m,e,_f,memory) => generateReply(m,e,async()=>agentTurn(turn),memory) };
}
const env = { AI_ENABLED:'true', OPENAI_API_KEY:'test' };
test('the agent routes developer feedback to its tool; it is saved once and acknowledged once', async () => {
  const options = fixture(tool('send_developer_feedback',{feedback:'replies are long'}));
  await receiveInInbox(delivery('DM replies are long'),env,options);
  assert.equal(await receiveInInbox(delivery('DM replies are long'),env,options),'imessage_ai_duplicate');
  assert.equal(options.reports.size,1); assert.equal(options.reports.get('test-message'),'replies are long');
  assert.deepEqual(options.sent,['Feedback saved for the developer. Thank you.']);
});
test('a message mentioning DM is interpreted like any other message, not prefix-matched',async()=>{
  const options=fixture(tool('conversation_reply',{response:'Want me to look for DMV-friendly shoes?'}));
  await receiveInInbox(delivery('DM: shopping near the DMV'),env,options);
  assert.equal(options.reports.size,0);assert.deepEqual(options.sent,['Want me to look for DMV-friendly shoes?']);
});
test('failed feedback persistence does not acknowledge success',async()=>{
  const options=fixture(tool('send_developer_feedback',{feedback:'bug'})); options.store.saveFeedback=async()=>{throw new Error('offline');};
  await receiveInInbox(delivery('DM bug'),env,options);assert.equal(options.sent.length,1);assert.doesNotMatch(options.sent[0],/Feedback saved/);
});
test('feedback reads and history filters use private database requests',async()=>{
  const paths=[];
  const store=createStore({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake'},async(url)=>{
    paths.push(url); return {ok:true,text:async()=>JSON.stringify(url.includes('provider_id=')?[{id:'id',created_at:'2026-10-06T00:00:00Z'}]:[])};
  });
  await store.saveFeedback('provider','bug');await store.feedback();await store.context('conversation','provider');await store.historyForMemory('conversation');
  assert.match(paths[1],/developer_feedback=not.is.null/);
  assert.match(paths[3],/developer_feedback=is.null/);
  assert.match(paths[4],/developer_feedback=is.null/);
  assert.match(paths[3],/operation_id.is.null,operation_id.not.like.feedback/);
});
test('owner can retrieve feedback through admin',async()=>{
  const handler=createAdminHandler({auth:async()=>200,storeFactory:()=>({feedback:async()=>[{developer_feedback:'bug'}]})});
  const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await handler({method:'GET',url:'/api/admin?view=feedback',headers:{}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.feedback[0].developer_feedback,'bug');
});
