import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {sendOnboardingReminders,connectedAnything,createOnboardingHandler} from '../lib/onboarding.js';
import {sweepGmailImports} from '../lib/gmail-worker.js';

const env={ONBOARDING_ENABLED:'true',ONBOARDING_REMINDER_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GMAIL_IMPORT_ENABLED:'true'};
const conversation={id:'tester-id',sender_id:'synthetic-tester',line:'synthetic-line'};
const HOUR=3600000,NOW=Date.parse('2026-10-21T12:00:00Z');
const ago=hours=>new Date(NOW-hours*HOUR).toISOString();

// A synthetic store: one onboarding session, the message ledger (with STOP blocking) and an optional history row.
function fixture({state='offered',welcomeHours=25,history=null,optedOut=false}={}){
 const operations=new Map(),sent=[],logs=[];let current=state,notNow=null;
 operations.set(`onboarding:${conversation.id}:welcome`,{conversation_id:conversation.id,status:'sent'});
 const store={
  onboardingRemindersDue:async()=>[{conversation_id:conversation.id,not_now_at:notNow,welcome_sent_at:ago(welcomeHours)}],
  onboardingSession:async()=>({state:current}),advanceOnboarding:async(id,from,to)=>{if(current!==from)return false;current=to;return true;},
  gmailImport:async()=>history,conversation:async()=>conversation,
  recordOnboardingNotNow:async()=>{notNow=new Date(NOW).toISOString();return true;},
  operation:async id=>operations.get(id),
  reserve:async(id,key,body)=>{if(operations.has(key))return false;operations.set(key,{conversation_id:id,body,status:optedOut?'blocked':'sending'});return !optedOut;},
  finish:async(key,status)=>{operations.get(key).status=status;}};
 const send=async(_delivery,body)=>{sent.push(body);return {};};
 return {store,send,sent,operations,logs,state:()=>current,notNow:()=>notNow};
}
const remind=(f,options={})=>sendOnboardingReminders(f.store,env,f.send,{now:NOW,...options});
const reminderRow=f=>f.operations.get(`onboarding:${conversation.id}:reminder`);

test('a reminder goes once, about 24 hours after the welcome, with a link to /onboarding',async()=>{
 for(const state of ['offered','accepted']){
  const f=fixture({state});
  assert.deepEqual(await remind(f),{reminders:1});
  assert.equal(f.sent.length,1);assert.match(f.sent[0],/https:\/\/jules\.example\/onboarding/);
  assert.equal(reminderRow(f).status,'sent');assert.equal(f.state(),state);
 }
});
test('nothing is sent before 24 hours, or for a welcome older than two days',async()=>{
 for(const welcomeHours of [1,23.9,49]){const f=fixture({welcomeHours});assert.deepEqual(await remind(f),{reminders:0});assert.equal(f.sent.length,0);assert.equal(reminderRow(f),undefined);}
});
test('nothing is sent to someone who connected or started anything',async()=>{
 const rows=[{token_ciphertext:'x',data:{}},{data:{job:{status:'ready'}}},{data:{connections:{shop:{status:'awaiting_approval'}}}},{data:{connections:{shop:{status:'ready',credential:'c'}}}}];
 for(const history of rows){const f=fixture({history});assert.ok(connectedAnything(history));await remind(f);assert.equal(f.sent.length,0);}
 // A Gmail button tap that never came back from Google, or a disconnected Shop, still gets the reminder.
 for(const history of [{data:{}},{data:{connections:{shop:{status:'not_connected',error:'Shop sign-in was declined.'}}}}]){const f=fixture({history});assert.equal(connectedAnything(history),false);await remind(f);assert.equal(f.sent.length,1);}
});
test('nothing is sent to someone who declined in chat or is already past onboarding',async()=>{
 for(const state of ['declined','ready','invited']){const f=fixture({state});await remind(f);assert.equal(f.sent.length,0);assert.equal(reminderRow(f),undefined);}
});
test('an opted-out person is blocked by the ledger and never texted, then never retried',async()=>{
 const f=fixture({optedOut:true});
 assert.deepEqual(await remind(f),{reminders:0});assert.equal(f.sent.length,0);assert.equal(reminderRow(f).status,'blocked');
 await remind(f);assert.equal(f.sent.length,0);
});
test('repeated and concurrent sweeps send it only once; an uncertain send is never retried',async()=>{
 const f=fixture();
 await Promise.all(Array.from({length:4},()=>remind(f)));for(let i=0;i<3;i++)await remind(f);
 assert.equal(f.sent.length,1);
 const g=fixture();let attempts=0;const failing=async()=>{attempts++;throw Error('timeout');};
 await sendOnboardingReminders(g.store,env,failing,{now:NOW});await sendOnboardingReminders(g.store,env,failing,{now:NOW});
 assert.equal(attempts,1);assert.equal(reminderRow(g).status,'uncertain');
});
test('the switch keeps it off, and a capped person is skipped without a ledger entry',async()=>{
 const f=fixture();
 assert.deepEqual(await sendOnboardingReminders(f.store,{...env,ONBOARDING_REMINDER_ENABLED:'false'},f.send,{now:NOW}),{reminders:0});
 await remind(f,{wrap:async()=>({status:'capped'})});
 assert.equal(f.sent.length,0);assert.equal(reminderRow(f),undefined);
});
test('the once-a-minute sweep sends due reminders and reports them',async()=>{
 const f=fixture();
 const store={...f.store,gmailProfilesDue:async()=>[],quietGmailImports:async()=>[]};
 const result=await sweepGmailImports(store,env,{now:NOW,reminders:(s,e)=>sendOnboardingReminders(s,e,f.send,{now:NOW})});
 assert.equal(result.reminders,1);assert.equal(f.sent.length,1);
 // A failing reminder step never fails the sweep.
 assert.equal((await sweepGmailImports(store,env,{now:NOW,reminders:async()=>{throw Error('down');}})).reminders,0);
});

const response=()=>({setHeader(){},end(value){this.data=JSON.parse(value);}});
const post=action=>Object.assign(Readable.from([JSON.stringify({action})]),{method:'POST',headers:{origin:env.SITE_ORIGIN,'content-type':'application/json'}});
const api=f=>createOnboardingHandler({env,storeFactory:()=>f.store,auth:async()=>({status:200,conversation:conversation.id}),send:f.send});
test('Not now is recorded without changing state, sending a text or starting the interview',async()=>{
 for(const state of ['offered','accepted']){
  const f=fixture({state}),res=response();await api(f)(post('not-now'),res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.data,{state,recorded:true});
  assert.equal(f.state(),state);assert.ok(f.notNow());assert.equal(f.sent.length,0);
  // The reminder still goes to someone who tapped Not now.
  await remind(f);assert.equal(f.sent.length,1);
 }
 for(const state of ['declined','ready']){const f=fixture({state}),res=response();await api(f)(post('not-now'),res);assert.deepEqual(res.data,{state,recorded:false});assert.equal(f.notNow(),null);assert.equal(f.state(),state);}
 // Before db/046 the write fails; the tap still answers and nothing changes.
 const f=fixture();f.store.recordOnboardingNotNow=async()=>{throw Object.assign(Error('missing column'),{database_status:400});};
 const res=response();await api(f)(post('not-now'),res);assert.deepEqual(res.data,{state:'offered',recorded:false});assert.equal(f.state(),'offered');
});
test('Not now needs the Jules site origin like every other onboarding action',async()=>{
 const f=fixture(),req=post('not-now');req.headers.origin='https://other.example';const res=response();
 await api(f)(req,res);assert.equal(res.statusCode,403);assert.equal(f.notNow(),null);
});
