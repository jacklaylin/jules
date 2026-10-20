import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {welcomeTester,onboardingAction,createOnboardingHandler} from '../lib/onboarding.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,agentContext,toolNames,toolOutputs, agentTurns } from './helpers/agent.js';
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
const act=(f,action,state=f.state())=>onboardingAction(action,{conversationId:conversation.id,session:{state},store:f.store,env});
test('onboarding actions advance only from valid states; an unrelated turn changes nothing',async()=>{
 for(const action of ['accept','decline']){
  const f=fixture('offered');assert.ok(await act(f,action));assert.equal(f.state(),{accept:'accepted',decline:'declined'}[action]);
 }
 const ready=fixture('ready');assert.equal(await act(ready,'accept'),null);assert.equal(ready.state(),'ready');
 assert.equal(await onboardingAction('style',{conversationId:conversation.id,session:null,store:fixture().store,env}),null);
 assert.match(await onboardingAction('style',{conversationId:conversation.id,session:null,store:fixture().store,env:{...env,STYLE_ENABLED:'true'}}),/\/style/);
});
test('declines preserve shopping; acceptance after a decline is possible',async()=>{
 const f=fixture('offered');
 for(const [action,state] of [['decline','declined'],['accept','accepted']]){await act(f,action);assert.equal(f.state(),state);}
 assert.ok((await act(f,'status')).includes('/onboarding'));
});
test('the agent sees the onboarding state, chooses the tool, and re-reads a non-applicable action',async()=>{
 const f=fixture('ready');let calls=0;
 const reply=await generateReply([{direction:'outbound',status:'sent',body:'save both?'},{direction:'inbound',body:'sounds good'}],{OPENAI_API_KEY:'test'},async(_url,options)=>{
  calls++;assert.equal(agentContext(options).onboarding.state,'ready');assert.ok(toolNames(options).includes('onboarding'));
  if(calls===2)assert.match(toolOutputs(options)[0].error,/does not apply to the current onboarding state/);
  return agentTurn(calls===1?tool('onboarding',{action:'accept'}):tool('conversation_reply',{response:'Which ones?'}));
 },{onboarding:{state:'ready'},onboardingAction:action=>act(f,action,'ready')});
 assert.equal(calls,2);assert.equal(reply,'Which ones?');assert.equal(f.state(),'ready');
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

test('the newest shopping turn is the one interpreted, and choosing a search leaves onboarding untouched',async()=>{
 const f=fixture('ready');const current={direction:'inbound',body:'Can you find fitted white henleys with a little stretch?'};let searched;
 const reply=await generateReply([{direction:'outbound',status:'sent',body:'view your Gmail connection here'},{direction:'inbound',body:'old reply'},current],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(_url,options)=>{
  const input=agentTurns(JSON.parse(options.body).input);assert.equal(input.at(-1).content,current.body);assert.ok(toolNames(options).includes('onboarding'));
  return agentTurn(tool('find_products',{query:'fitted white henley with stretch'}));
 },{onboarding:{state:'ready'},onboardingAction:()=>assert.fail('No onboarding action'),wishlistAction:async intent=>{searched=intent;return 'options';}});
 assert.equal(reply,'options');assert.equal(searched.action,'start');assert.equal(f.state(),'ready');
});
test('onboarding links are signed only in the delivered text, never in the ledger',async()=>{
 const {signInLinks}=await import('../lib/onboarding.js');const site={SITE_ORIGIN:'https://jules.example'};let minted=0;const store={createSignInLink:async()=>{minted++;return '00000000-0000-4000-8000-00000000000a';}};
 assert.equal(await signInLinks('go: https://jules.example/onboarding.',{store,conversationId:'c',env:site}),'go: https://jules.example/onboarding#signin=00000000-0000-4000-8000-00000000000a.');
 assert.equal(await signInLinks('https://jules.example/onboarding?view=ready and https://jules.example/wishlist',{store,conversationId:'c',env:site}),'https://jules.example/onboarding?view=ready and https://jules.example/wishlist');assert.equal(minted,1);
 assert.equal(await signInLinks('https://jules.example/onboarding',{store:{createSignInLink:async()=>{throw Error('down');}},conversationId:'c',env:site}),'https://jules.example/onboarding');
 const f=fixture();f.store.createSignInLink=store.createSignInLink;await welcomeTester('synthetic',f.store,{...env,GMAIL_IMPORT_ENABLED:'true'},f.send);
 assert.match(f.sent.at(-1),/onboarding#signin=0000/);assert.ok([...f.operations.values()].every(o=>!o.body.includes('signin')));
});
test('the onboarding page greets testers by the first name they signed up with, when there is one',async()=>{
 const f=fixture();f.store.signupFirstName=async id=>{assert.equal(id,conversation.id);return 'Ada';};
 let res=response();await api(f)(request(),res);assert.equal(res.data.first_name,'Ada');
 f.store.signupFirstName=async()=>{throw Error('down');};res=response();await api(f)(request(),res);assert.equal(res.statusCode,200);assert.equal(res.data.first_name,null);
});
