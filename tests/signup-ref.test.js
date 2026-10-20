import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSignupHandler} from '../lib/public-signup.js';
import {SIGNUP_VERSION} from '../public/signup-consent.js';
import {signupRef,refFromSearch,carryRef,signupArrival,arrivalFrom,rememberArrival} from '../public/signup-ref.js';

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

// How someone arrived (db/041): referring host and utm_ tags.
const memory=(initial={})=>{const data={...initial};return {getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=v;},data};};
test('an arrival keeps the referring host and utm tags, and drops our own host and bad values',()=>{
 assert.deepEqual(arrivalFrom('https://www.perplexity.ai/search?q=jules','?utm_source=ChatGPT.com&utm_medium=referral&utm_campaign=has%20space','textjules.com'),
  {referrer_host:'perplexity.ai',utm_source:'chatgpt.com',utm_medium:'referral',utm_campaign:null});
 assert.equal(arrivalFrom('https://textjules.com/','','textjules.com'),null,'our own page is not an arrival');
 assert.equal(arrivalFrom('','',''),null);assert.equal(arrivalFrom('not a url','?utm_source=<x>','textjules.com'),null);
 assert.equal(signupArrival({referrer_host:'localhost'},'x.com'),null,'a host needs a dot');
 assert.equal(signupArrival('chatgpt.com','x.com'),null);
});
test('the first outside arrival in a tab survives the hop to /signup, which sends no referrer',()=>{
 const storage=memory();
 const first=rememberArrival(()=>storage,{referrer:'https://chatgpt.com/',search:'?utm_source=chatgpt.com',host:'textjules.com'});
 assert.equal(first.referrer_host,'chatgpt.com');
 assert.deepEqual(rememberArrival(()=>storage,{referrer:'',search:'',host:'textjules.com'}),first,'signup page reads it back');
 assert.deepEqual(rememberArrival(()=>storage,{referrer:'https://google.com/',search:'',host:'textjules.com'}),first,'first arrival wins');
 assert.equal(rememberArrival(()=>{throw new Error('blocked');},{referrer:'https://google.com/',search:'',host:'textjules.com'}).referrer_host,'google.com','blocked storage still reports this visit');
});
test('a saved signup records how it arrived; a bad or missing arrival records nothing',async()=>{
 const arrivals=[],store={signupArrival:async(id,a)=>{arrivals.push([id,a]);}};
 const {res,logs}=await run({...body,arrival:{referrer_host:'Chatgpt.com',utm_source:'chatgpt.com',utm_medium:'x y'}},store);
 assert.equal(res.statusCode,200);
 assert.deepEqual(arrivals,[[body.request_id,{referrer_host:'chatgpt.com',utm_source:'chatgpt.com',utm_medium:null,utm_campaign:null}]]);
 assert.equal(logs.find(l=>l.event==='public_signup_saved').arrival.utm_source,'chatgpt.com');
 for(const arrival of [undefined,{referrer_host:'jules.example'},'chatgpt.com']){arrivals.length=0;await run({...body,arrival},store);assert.deepEqual(arrivals,[]);}
});
test('before db/041 runs the signup still succeeds and the unsaved arrival is logged',async()=>{
 const {res,logs}=await run({...body,arrival:{utm_source:'perplexity'}},{signupArrival:async()=>{throw Object.assign(new Error('column does not exist'),{database_status:400});}});
 assert.equal(res.statusCode,200);assert.equal(res.data.saved,true);
 assert.deepEqual(logs.find(l=>l.event==='signup_arrival_unsaved'),{event:'signup_arrival_unsaved',status:400});
});
