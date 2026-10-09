import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSignupHandler,normalizeSignupPhone} from '../api/signup.js';
import {SIGNUP_VERSION,SIGNUP_CONSENT} from '../public/signup-consent.js';
import {demoState,DEMO_DURATION} from '../public/landing-timeline.js';
const env={PUBLIC_SIGNUP_ENABLED:'true',SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'test-secret'};
const body={phone:'(415) 555-0123',consent:true,consent_version:SIGNUP_VERSION,request_id:'00000000-0000-4000-8000-000000000001'};
function request(input=body,headers={}){return Object.assign(Readable.from([JSON.stringify(input)]),{method:'POST',headers:{'content-type':'application/json',origin:env.SITE_ORIGIN,...headers},socket:{remoteAddress:'test-connection'}});}
function response(){return {setHeader(){},end(value){this.data=JSON.parse(value);}};}
const handler=(signup=async()=> 'saved',overrides={})=>createSignupHandler({env:{...env,...overrides},storeFactory:()=>({signup}),log:()=>{}});
test('phone input normalizes domestic formatting and preserves explicit international codes',()=>{
 assert.equal(normalizeSignupPhone(body.phone),'+14155550123');assert.equal(normalizeSignupPhone('+44 7700 900123'),'+447700900123');
 for(const value of ['hello','7700900123 ext 5','++14155550123','123','447700900123',null])assert.equal(normalizeSignupPhone(value),null);
});
test('signup stores exact server consent and protected connection identity before returning success',async()=>{
 let saved;const res=response();await handler(async input=>{saved=input;return 'saved';})(request({...body,consent_text:'forged'}),res);
 assert.equal(res.statusCode,200);assert.equal(saved.p_consent_text,SIGNUP_CONSENT);assert.equal(saved.p_phone,'+14155550123');assert.equal(saved.p_connection_hash.length,64);assert.equal(res.data.message_sent,false);assert.equal(res.data.phone,undefined);
});
test('unchecked consent, stale disclosure, invalid phone, invalid request and cross-origin calls never write',async()=>{
 let writes=0;const run=handler(async()=>{writes++;return 'saved';});
 for(const [input,headers,code] of [[{...body,consent:false},{},400],[{...body,consent_version:'old'},{},409],[{...body,phone:'bad'},{},400],[{...body,request_id:'bad'},{},400],[body,{origin:'https://other.example'},403],[null,{},400]]){const res=response();await run(request(input,headers),res);assert.equal(res.statusCode,code);}
 assert.equal(writes,0);
});
test('disabled signup reports unavailable and does not persist',async()=>{const run=handler(()=>{throw new Error('unexpected write');},{PUBLIC_SIGNUP_ENABLED:'false'}),res=response();await run(request(),res);assert.equal(res.statusCode,503);const config=response();await run({method:'GET'},config);assert.equal(config.data.enabled,false);});
test('rate limits and database failures do not claim a saved signup',async()=>{for(const [save,status] of [[async()=> 'limited',429],[async()=>{throw new Error('private database error');},503],[async()=>null,503]]){const res=response();await handler(save)(request(),res);assert.equal(res.statusCode,status);assert.equal(res.data.saved,undefined);assert.ok(!res.data.error.includes('private'));}});
test('optional Messages link uses only the configured verified-format line',async()=>{const res=response();await handler(undefined,{JULES_PUBLIC_LINE:'+14155550124'})(request(),res);assert.equal(res.data.text_url,'sms:+14155550124');});
test('timeline scrubs forward and backward consistently and reduced motion shows final state',()=>{
 assert.equal(demoState(4).typing,true);assert.equal(demoState(5.2).typing,false);assert.equal(demoState(13).chapter,1);assert.equal(demoState(22.4).chapter,2);assert.equal(demoState(2).chapter,0);assert.equal(demoState(-100).time,0);assert.equal(demoState(999).time,DEMO_DURATION);assert.equal(demoState(0,true).progress,1);assert.equal(demoState(0,true).typing,false);
});
