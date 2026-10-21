import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSignupHandler} from '../lib/public-signup.js';
import {signupAlert,signupAlertText} from '../lib/signup-alert.js';
import {SIGNUP_VERSION} from '../public/signup-consent.js';

const OWNER='00000000-0000-4000-8000-0000000000a1',TESTER='00000000-0000-4000-8000-0000000000b2';
const env={PUBLIC_SIGNUP_ENABLED:'true',SITE_ORIGIN:'https://jules.example/',SUPABASE_SERVICE_ROLE_KEY:'test-secret',OWNER_ALERT_CONVERSATION_ID:OWNER};
const profile={first_name:'Sam',last_name:'rivera',birthday:'1990-01-01',gender:'woman'};
const body={phone:'(415) 555-0123',consent:true,consent_version:SIGNUP_VERSION,request_id:'00000000-0000-4000-8000-000000000001',profile,ref:'podcast'};
const request=(input=body)=>Object.assign(Readable.from([JSON.stringify(input)]),{method:'POST',headers:{'content-type':'application/json',origin:'https://jules.example'},socket:{remoteAddress:'test-connection'}});
const response=()=>({setHeader(){},end(value){this.data=JSON.parse(value);}});

// A message ledger like reserve_reply: one row per operation; a STOPped conversation records it as blocked.
function ledgerStore({access=null,optedOut=false}={}){
 const rows=new Map();
 return {rows,
  signup:async()=> 'saved',
  conversationForPhone:async()=>access?TESTER:null,
  accessFor:async ids=>new Map(ids.map(id=>[id,{access}])),
  conversation:async id=>id===OWNER?{id,sender_id:'+15550000000',line:'+15550000001'}:null,
  reserve:async(conversation,operation,text,source)=>{if(rows.has(operation))return false;rows.set(operation,{conversation_id:conversation,body:text,source,status:optedOut?'blocked':'sending'});return !optedOut;},
  operation:async operation=>rows.get(operation)??null,
  finish:async(operation,status)=>{rows.get(operation).status=status;},
 };
}
async function submit({store,overrides={},send,input=body,welcome=async()=>({message_sent:false})}){
 const logs=[],pending=[],res=response();
 const alert=args=>signupAlert({...args,send});
 await createSignupHandler({env:{...env,...overrides},storeFactory:()=>store,log:line=>logs.push(JSON.parse(line)),welcome,waitlisted:async()=>false,alert,defer:p=>pending.push(p)})(request(input),res);
 await Promise.all(pending);
 return {res,logs:logs.filter(l=>String(l.event).startsWith('signup_alert'))};
}
const sender=()=>{const sent=[];const send=async(target,text)=>{sent.push({target,text});return {id:'photon-1'};};return {sent,send};};

test('a saved signup texts the owner once, as written, from the operator, to their own conversation',async()=>{
 const store=ledgerStore(),{sent,send}=sender();
 const {res,logs}=await submit({store,send});
 assert.equal(res.statusCode,200);assert.equal(res.data.saved,true);
 assert.equal(sent.length,1);assert.equal(sent[0].target.message.sender.id,'+15550000000');
 assert.equal(sent[0].text,'new signup: Sam R., •••-0123, from podcast. set them up: https://jules.example/admin');
 assert.doesNotMatch(sent[0].text,/555-?0123|4155550123/);
 const row=store.rows.get('signup-alert:'+body.request_id);
 assert.equal(row.source,'operator');assert.equal(row.status,'sent');assert.equal(row.conversation_id,OWNER);
 assert.deepEqual(logs,[{event:'signup_alert',status:'sent',duplicate:false}]);
});

test('without the setting nothing is sent and the skip is logged',async()=>{
 for(const value of [undefined,'','not-a-uuid']){
  const store=ledgerStore(),{sent,send}=sender();
  const {res,logs}=await submit({store,send,overrides:{OWNER_ALERT_CONVERSATION_ID:value}});
  assert.equal(res.statusCode,200);assert.equal(sent.length,0);assert.equal(store.rows.size,0);
  assert.equal(logs[0].event,'signup_alert_skipped');
 }
});

test('a retried submit of the same signup never alerts twice; a new signup does',async()=>{
 const store=ledgerStore(),{sent,send}=sender();
 await submit({store,send});const {logs}=await submit({store,send});
 assert.equal(sent.length,1);assert.deepEqual(logs,[{event:'signup_alert',status:'sent',duplicate:true}]);
 await submit({store,send,input:{...body,request_id:'00000000-0000-4000-8000-000000000002'}});
 assert.equal(sent.length,2);
});

test('an approved number or an invited tester (welcome sent) needs no setup, so no alert',async()=>{
 const approved=ledgerStore({access:'approved'}),one=sender();
 assert.deepEqual((await submit({store:approved,send:one.send})).logs,[{event:'signup_alert_skipped',reason:'approved'}]);
 assert.equal(one.sent.length,0);
 const invited=ledgerStore(),two=sender();
 const {res,logs}=await submit({store:invited,send:two.send,welcome:async()=>({message_sent:true,onboarding_started:true})});
 assert.equal(res.data.message_sent,true);assert.deepEqual(logs,[{event:'signup_alert_skipped',reason:'invited'}]);assert.equal(two.sent.length,0);
 // Someone with a conversation still on the waitlist does need Approve.
 const waiting=ledgerStore({access:'waitlisted'}),three=sender();
 await submit({store:waiting,send:three.send});assert.equal(three.sent.length,1);
});

test('a failed alert never changes the signup; an owner who texted STOP gets nothing',async()=>{
 const down=ledgerStore();
 const failed=await submit({store:down,send:async()=>{throw Error('photon down');}});
 assert.equal(failed.res.statusCode,200);assert.equal(failed.res.data.saved,true);
 assert.equal(down.rows.get('signup-alert:'+body.request_id).status,'uncertain');
 const broken={...ledgerStore(),conversation:async()=>{throw Object.assign(Error('db'),{status:503});}},{sent,send}=sender();
 const errored=await submit({store:broken,send});
 assert.equal(errored.res.statusCode,200);assert.equal(sent.length,0);assert.deepEqual(errored.logs,[{event:'signup_alert_failed',status:503}]);
 // The alert is deferred: the response is already sent when it runs, and a rejection goes nowhere.
 const res=response();let answered=null,pending;
 await createSignupHandler({env,storeFactory:()=>ledgerStore(),log:()=>{},welcome:async()=>({message_sent:false}),waitlisted:async()=>false,alert:async()=>{answered=res.data?.saved;throw Error('boom');},defer:p=>{pending=p;}})(request(),res);
 await pending;assert.equal(res.statusCode,200);assert.equal(answered,true);
 const stopped=ledgerStore({optedOut:true}),quiet=sender();
 assert.deepEqual((await submit({store:stopped,send:quiet.send})).logs,[{event:'signup_alert',status:'blocked',duplicate:false}]);
 assert.equal(quiet.sent.length,0);
});

test('alert text uses the arrival when there is no ref, and never more than a first name and initial',()=>{
 assert.equal(signupAlertText({phone:'+447700900123',profile:{first_name:'Ana'},arrival:{referrer_host:'tiktok.com'},env}),'new signup: Ana, •••-0123, from tiktok.com. set them up: https://jules.example/admin');
 assert.equal(signupAlertText({phone:'+14155550199',env}),'new signup: (no name), •••-0199. set them up: https://jules.example/admin');
});
