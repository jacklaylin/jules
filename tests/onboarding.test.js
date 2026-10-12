import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {welcomeTester,onboardingReply,interpretOnboarding,createOnboardingHandler} from '../lib/onboarding.js';
const env={ONBOARDING_ENABLED:'true',SITE_ORIGIN:'https://jules.example'};
const conversation={id:'tester-id',sender_id:'synthetic-tester',line:'synthetic-line'};
function fixture(state='invited'){
 const operations=new Map(),sent=[];let current=state;
 const store={onboardingInvite:async()=>conversation,onboardingSession:async()=>({state:current}),advanceOnboarding:async(id,from,to)=>{if(current!==from)return false;current=to;return true;},conversation:async()=>conversation,context:async()=>[],operation:async id=>operations.get(id),reserve:async(id,key,body)=>{if(operations.has(key))return false;operations.set(key,{conversation_id:id,body,status:'sending'});return true;},finish:async(key,status)=>{operations.get(key).status=status;}};
 const send=async(delivery,body)=>{sent.push(body);return {};};
 return {store,send,sent,operations,state:()=>current};
}
const response=()=>({setHeader(){},end(value){this.data=JSON.parse(value);}});
function request(action){return Object.assign(Readable.from(action?[JSON.stringify({action})]:[]),{method:action?'POST':'GET',headers:{origin:env.SITE_ORIGIN,'content-type':'application/json'}});}
const api=(f,overrides={})=>createOnboardingHandler({env,storeFactory:()=>f.store,auth:async()=>({status:200,conversation:conversation.id}),send:f.send,...overrides});
const delivery={space:{phone:conversation.line},message:{id:'incoming-1',sender:{id:conversation.sender_id},content:{text:'yes'}}};
test('welcome is invite-only, feature-gated and idempotent across concurrent submissions',async()=>{
 const f=fixture();await Promise.all(Array.from({length:4},()=>welcomeTester('synthetic',f.store,env,f.send)));assert.equal(f.sent.length,1);assert.equal(f.state(),'offered');
 f.store.onboardingInvite=async()=>null;assert.equal((await welcomeTester('other',f.store,env,f.send)).message_sent,false);
 assert.equal((await welcomeTester('synthetic',{}, {},f.send)).message_sent,false);
});
test('ambiguous welcome delivery is never automatically resent',async()=>{
 const f=fixture();const send=async()=>{f.sent.push('attempt');throw Error('timeout');};
 assert.equal((await welcomeTester('synthetic',f.store,env,send)).message_status,'uncertain');
 await welcomeTester('synthetic',f.store,env,send);assert.equal(f.sent.length,1);
});
test('model consent advances invitation but unrelated yes, products and uncertainty do not',async()=>{
 for(const action of ['other','accept','decline']){
  const f=fixture('offered');const outcome=await onboardingReply(delivery,conversation.id,f.store,env,{send:f.send,interpret:async()=>action});
  assert.equal(f.state(),{other:'offered',accept:'accepted',decline:'declined'}[action]);assert.equal(Boolean(outcome),action!=='other');
 }
});
test('topic changes and declines preserve shopping; acceptance after correction is possible',async()=>{
 const f=fixture('offered');
 for(const [action,state] of [['other','offered'],['decline','declined'],['other','declined'],['accept','accepted']]){
  await onboardingReply({...delivery,message:{...delivery.message,id:crypto.randomUUID()}},conversation.id,f.store,env,{send:f.send,interpret:async()=>action});assert.equal(f.state(),state);
 }
 assert.ok(f.sent.at(-1).includes('/onboarding'));
});
test('interpreter sends context and strictly validates structured actions',async()=>{
 let body;const context=[{direction:'outbound',body:'save both?',status:'sent'},{direction:'inbound',body:'sounds good',reply_provider_id:'original'}];
 const fetcher=async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"action":"other","focus":"shopping"}'}]}]})};};
 assert.equal(await interpretOnboarding(context,'offered',env,fetcher),'other');assert.deepEqual(JSON.parse(body.input).conversation,context);assert.equal(body.text.format.strict,true);
 await assert.rejects(()=>interpretOnboarding(context,'offered',env,async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"action":"invented"}'}]}]})})));
});
test('demo requires auth, invitation, accepted state and same origin',async()=>{
 const f=fixture('offered');let res=response();await api(f)(request('connect-demo'),res);assert.equal(res.statusCode,409);assert.equal(f.sent.length,0);
 res=response();await api(f,{auth:async()=>({status:401})})(request(),res);assert.equal(res.statusCode,401);
 f.store.onboardingSession=async()=>null;res=response();await api(f)(request(),res);assert.equal(res.statusCode,403);
 const accepted=fixture('accepted'),req=request('connect-demo');req.headers.origin='https://other.example';res=response();await api(accepted)(req,res);assert.equal(res.statusCode,403);assert.equal(accepted.sent.length,0);
});
test('connect completes server-side, sends two honest texts once, and survives refresh/retry',async()=>{
 const f=fixture('accepted');const run=api(f);
 await Promise.all(Array.from({length:3},async()=>{await run(request('connect-demo'),response());}));
 assert.equal(f.state(),'ready');assert.equal(f.sent.length,2);assert.ok(f.sent[0].includes('no email'));assert.ok(f.sent[1].includes('/onboarding?view=ready'));
 const res=response();await run(request(),res);assert.equal(res.data.state,'ready');await run(request('connect-demo'),response());assert.equal(f.sent.length,2);
});
test('failed starter text does not claim readiness; repeated posts do not send it again',async()=>{
 const f=fixture('accepted');let attempts=0;const run=api(f,{send:async()=>{attempts++;throw Error('timeout');}});
 for(let i=0;i<2;i++){const res=response();await run(request('connect-demo'),res);assert.equal(res.statusCode,503);}
 assert.equal(attempts,1);assert.equal(f.state(),'accepted');
});
test('skipping declines the demo without messages or changing a wishlist',async()=>{
 const f=fixture('accepted'),res=response();await api(f)(request('skip'),res);assert.equal(f.state(),'declined');assert.equal(res.data.destination,'/wishlist');assert.equal(f.sent.length,0);
});
test('failed completion text reports actual uncertainty while retaining completed demo',async()=>{
 const f=fixture('accepted');let count=0;const run=api(f,{send:async()=>{if(++count===2)throw Error('timeout');return {};}}),res=response();await run(request('connect-demo'),res);assert.equal(res.data.state,'ready');assert.equal(res.data.notification_status,'uncertain');await run(request('connect-demo'),response());assert.equal(count,2);
});
test('signup delivery failure preserves saved consent and reports uncertainty',async()=>{
 const {createSignupHandler}=await import('../lib/public-signup.js');
 const {SIGNUP_VERSION}=await import('../public/signup-consent.js');
 const req=Object.assign(Readable.from([JSON.stringify({phone:'+12025550123',consent:true,consent_version:SIGNUP_VERSION,request_id:'00000000-0000-4000-8000-000000000001'})]),{method:'POST',headers:{origin:env.SITE_ORIGIN,'content-type':'application/json'}});
 const res=response();let saved=false;
 await createSignupHandler({env:{...env,PUBLIC_SIGNUP_ENABLED:'true',SUPABASE_SERVICE_ROLE_KEY:'synthetic'},storeFactory:()=>({signup:async()=>{saved=true;return 'saved';}}),welcome:async()=>{throw Error('unavailable');},log:()=>{}})(req,res);
 assert.equal(saved,true);assert.equal(res.statusCode,200);assert.equal(res.data.saved,true);assert.equal(res.data.message_sent,false);assert.equal(res.data.message_status,'uncertain');
});
test('onboarding API remains unavailable when disabled',async()=>{
 const res=response();await createOnboardingHandler({env:{},storeFactory:()=>assert.fail('no private access')})(request(),res);assert.equal(res.statusCode,503);
});

test('newest shopping turn is explicit and cannot dispatch an onboarding status classification',async()=>{
 const history=[{direction:'outbound',status:'sent',body:'view your Gmail connection here'},{direction:'inbound',body:'old reply'}];
 const current={direction:'inbound',body:'Can you find fitted white henleys with a little stretch?'};
 const action=await interpretOnboarding(history,'ready',env,async(_url,options)=>{assert.deepEqual(JSON.parse(JSON.parse(options.body).input).newest_message,current);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"action":"status","focus":"shopping"}'}]}]})};},current);
 assert.equal(action,'other');
 const f=fixture('ready');await onboardingReply({...delivery,message:{...delivery.message,content:{text:current.body}}},conversation.id,f.store,env,{send:f.send,interpret:async(_context,_state,_env,_fetch,message)=>{assert.equal(message.body,current.body);return action;}});assert.equal(f.sent.length,0);
});
