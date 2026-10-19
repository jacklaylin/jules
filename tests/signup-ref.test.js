import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSignupHandler} from '../lib/public-signup.js';
import {SIGNUP_VERSION} from '../public/signup-consent.js';
import {signupRef,refFromSearch,carryRef} from '../public/signup-ref.js';

const env={PUBLIC_SIGNUP_ENABLED:'true',SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'test-secret'};
const body={phone:'(415) 555-0123',consent:true,consent_version:SIGNUP_VERSION,request_id:'00000000-0000-4000-8000-000000000001'};
const request=input=>Object.assign(Readable.from([JSON.stringify(input)]),{method:'POST',headers:{'content-type':'application/json',origin:env.SITE_ORIGIN},socket:{remoteAddress:'test'}});
const response=()=>({setHeader(){},end(value){this.data=JSON.parse(value);}});
function run(input,store={}){
 const calls=[],logs=[];
 const handler=createSignupHandler({env,log:line=>logs.push(JSON.parse(line)),welcome:async()=>({message_sent:false}),
  storeFactory:()=>({signup:async()=> 'saved',signupRef:async(id,ref)=>{calls.push([id,ref]);},...store})});
 const res=response();
 return handler(request(input),res).then(()=>({res,calls,logs}));
}

test('a source code keeps only a short lower-case code; anything else is dropped',()=>{
 assert.equal(signupRef('Podcast'),'podcast');assert.equal(signupRef(' ig_story-2 '),'ig_story-2');
 for(const value of ['', 'a b', 'https://x.com', 'x'.repeat(41), '<script>', null, 7, undefined])assert.equal(signupRef(value),null);
});
test('the signup link uses ref, then utm_source',()=>{
 assert.equal(refFromSearch('?ref=friends&utm_source=ig'),'friends');
 assert.equal(refFromSearch('?utm_source=Instagram'),'instagram');
 assert.equal(refFromSearch('?ref=bad%20value&utm_source=ig'),'ig');
 assert.equal(refFromSearch(''),null);
});
test('the landing page passes its source on to the signup links',()=>{
 const links=[1,2].map(()=>({href:'/signup',setAttribute(k,v){this[k]=v;}}));
 assert.equal(carryRef(links,'?ref=newsletter'),'newsletter');
 assert.deepEqual(links.map(l=>l.href),['/signup?ref=newsletter','/signup?ref=newsletter']);
 const plain={href:'/signup',setAttribute(){throw new Error('unchanged without a source');}};
 assert.equal(carryRef([plain],'?ref=no%20good'),null);
});
test('a saved signup records its source against its own request',async()=>{
 const {res,calls,logs}=await run({...body,ref:'Podcast'});
 assert.equal(res.statusCode,200);assert.deepEqual(calls,[[body.request_id,'podcast']]);
 assert.equal(logs.find(l=>l.event==='public_signup_saved').ref,'podcast');
});
test('a missing or malformed source never blocks or changes a signup',async()=>{
 for(const ref of [undefined,'no good',{evil:true}]){const {res,calls}=await run({...body,ref});assert.equal(res.statusCode,200);assert.equal(res.data.saved,true);assert.deepEqual(calls,[]);}
});
test('before db/033 runs the signup still succeeds and the unsaved source is logged',async()=>{
 const {res,logs}=await run({...body,ref:'podcast'},{signupRef:async()=>{throw Object.assign(new Error('column ref does not exist'),{database_status:400});}});
 assert.equal(res.statusCode,200);assert.equal(res.data.saved,true);
 assert.deepEqual(logs.find(l=>l.event==='signup_ref_unsaved'),{event:'signup_ref_unsaved',status:400});
});
test('a rate-limited signup records no source',async()=>{
 const {res,calls}=await run({...body,ref:'podcast'},{signup:async()=> 'limited'});
 assert.equal(res.statusCode,429);assert.deepEqual(calls,[]);
});
