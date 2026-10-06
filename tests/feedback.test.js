import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { createStore } from '../lib/store.js';
import { createAdminHandler } from '../api/admin.js';
const delivery = text => ({space:{phone:'test-line'},message:{id:'test-message',sender:{id:'test-sender'},content:{text}}});
function fixture() {
  const reports = new Map(), replies = new Map(), sent = [];
  return { reports, sent, store: {
    receive: async () => 'conversation',
    saveFeedback: async (id, body) => reports.set(id, body),
    reserve: async (id, operation, body) => { if (replies.has(operation)) return false; replies.set(operation,{conversation_id:id,body,status:'sending'}); return true; },
    operation: async operation => replies.get(operation),
    finish: async (operation,status) => { replies.get(operation).status=status; },
  }, send: async (_delivery,body) => sent.push(body), generate: async () => assert.fail('Feedback must bypass AI'), updateMemory: async () => assert.fail('Feedback must bypass memory') };
}
test('DM feedback is saved without prefix, bypasses AI, and duplicate deliveries acknowledge once', async () => {
  for (const text of ['DM replies are long','dm: replies are long',' DM\nreplies are long']) {
    const options = fixture();
    await receiveInInbox(delivery(text),{AI_ENABLED:'true',MEMORY_ENABLED:'true'}, options);
    await receiveInInbox(delivery(text),{AI_ENABLED:'true'}, options);
    assert.equal(options.reports.size,1); assert.equal(options.reports.get('test-message'),'replies are long');
    assert.deepEqual(options.sent,['Feedback saved for the developer. Thank you.']);
  }
});
test('empty DM gives instructions and ordinary messages do not activate feedback',async()=>{
  const options=fixture();
  await receiveInInbox(delivery('DM'),{},options);
  assert.match(options.sent[0],/Send DM followed/);
  for(const text of ['DMV shopping','DMed you','I want DM feedback']) {
    assert.equal(await receiveInInbox(delivery(text),{},options),'imessage_received');
  }
  assert.equal(options.reports.size,1);
});
test('failed feedback persistence does not acknowledge success',async()=>{
  const options=fixture(); options.store.saveFeedback=async()=>{throw new Error('offline');};
  await assert.rejects(receiveInInbox(delivery('DM bug'),{},options)); assert.equal(options.sent.length,0);
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
