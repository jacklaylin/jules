import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {GMAIL_SCOPE,sealToken,accessToken,gmailLinked,markGmailReconnect,recordGmailReconnect} from '../lib/gmail-client.js';
import {createGmailHandler,publicImport,CONSENT_VERSION} from '../lib/gmail-import.js';
import {runGmailStep,sweepDue} from '../lib/gmail-worker.js';
import {refreshStep,runDailyRefresh} from '../lib/purchase-texts.js';
import {createReceiptFeedback} from '../lib/receipt-feedback.js';
import {compareEmail} from '../lib/extract-compare.js';

// A stored Gmail sign-in that Google refuses to renew (expired, revoked, or the app's 7-day Testing
// limit) is recorded once as "reconnect needed", shown as not connected, and never retried.
const env={GMAIL_IMPORT_ENABLED:'true',SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'synthetic-client',GOOGLE_GMAIL_CLIENT_SECRET:'synthetic-secret',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const expired={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:0};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const refused=()=>Object.assign(Error('Reconnect Gmail'),{status:401,http:400,reconnect:true,google_error:'invalid_grant'});
const quiet=async work=>{const log=console.log,lines=[];console.log=line=>lines.push(line);try{await work();}finally{console.log=log;}return lines.map(l=>{try{return JSON.parse(l);}catch{return {line:l};}});};

function storage(seed){let row=structuredClone(seed),busy=false,nonce=null;return {
 get row(){return row;},set row(v){row=v;},
 onboardingSession:async()=>({state:'accepted'}),wishlistMember:async email=>email==='tester@example.test'?{conversation_id:'owner'}:null,
 gmailImport:async()=>structuredClone(row),evidence:async()=>[],profile:async()=>({facts:[]}),
 beginGmailOAuth:async(owner,hash)=>{nonce=hash;return true;},consumeGmailOAuth:async hash=>{if(hash!==nonce)return null;nonce=null;return row.conversation_id;},
 claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
 finishGmailImport:async(owner,revision,data,token)=>{if(revision!==row.revision)return false;row={...row,data:structuredClone(data),token_ciphertext:token};busy=false;return true;},
 gmailConnections:async()=>[row.conversation_id]};}
const seed=(data={})=>({conversation_id:'owner',revision:1,token_ciphertext:sealToken(expired,'owner',env),data:{account:'tester@example.test',consent:{version:CONSENT_VERSION},feedback:createReceiptFeedback('owner',[],[]),...data}});
async function request(handler,{method='GET',body,cookie,url='/api/wishlist?gmail=1'}={}){
 const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method,url,headers:{origin:env.SITE_ORIGIN,'content-type':'application/json',...(cookie?{cookie}:{})}});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};await handler(req,res);return {...res,data:res.body?JSON.parse(res.body):null};
}
const auth=async()=>({status:200,conversation:'owner'});

test('a renewal Google refuses for good is a reconnect; anything else stays a retryable failure',async()=>{
 const grant=await accessToken(expired,env,async()=>reply(400,{error:'invalid_grant',error_description:'Token has been expired or revoked.'})).catch(e=>e);
 assert.equal(grant.reconnect,true);assert.equal(grant.http,400);assert.equal(grant.google_error,'invalid_grant');assert.ok(!JSON.stringify(grant).includes('synthetic'));
 assert.equal((await accessToken(expired,env,async()=>reply(401,{error:'invalid_client'})).catch(e=>e)).reconnect,true);
 for(const [status,body] of [[400,{error:'invalid_request'}],[503,{}],[500,{error:'internal'}]]){const e=await accessToken(expired,env,async()=>reply(status,body)).catch(e=>e);assert.ok(e instanceof Error);assert.notEqual(e.reconnect,true);}
 // A still-valid access token never calls Google.
 assert.equal((await accessToken({...expired,expires_at:Date.now()+3600000},env,()=>assert.fail())).access_token,'synthetic-access');
});

test('the mark is recorded once, pauses a running import, and makes the connection read as not connected',async()=>{
 const data={job:{status:'extracting',failures:2,started_at:'s'}};
 const lines=await quiet(async()=>{assert.equal(markGmailReconnect(data,refused(),'import',new Date('2026-10-20T17:00:00Z')),true);assert.equal(markGmailReconnect(data,refused(),'purchase_check'),false);});
 assert.deepEqual(data.gmail_auth,{status:'reconnect',at:'2026-10-20T17:00:00.000Z',http:400,google_error:'invalid_grant',where:'import'});
 assert.equal(data.job.status,'paused');assert.equal(data.job.failures,undefined);
 assert.deepEqual(lines.map(l=>l.event),['gmail_reconnect_needed']);
 assert.equal(markGmailReconnect({},Error('timeout'),'import'),false);
 assert.equal(gmailLinked({token_ciphertext:'sealed',data}),false);assert.equal(gmailLinked({token_ciphertext:'sealed',data:{}}),true);
 const view=publicImport({token_ciphertext:'sealed',data});assert.equal(view.connected,false);assert.equal(view.reconnect_needed,true);assert.equal(view.reconnect_since,'2026-10-20T17:00:00.000Z');
 assert.equal(publicImport({token_ciphertext:null,data}).reconnect_needed,false);
});

test('a background import step that Google refuses pauses without retrying; the sweep leaves it alone',async()=>{
 const store=storage(seed({job:{status:'extracting',started_at:'s',ids:['m1'],processed:[]}}));let scheduled=0;const waits=[];
 await quiet(()=>runGmailStep('owner',store,env,{},{step:async()=>{throw refused();},schedule:()=>scheduled++,wait:async ms=>waits.push(ms),notify:()=>assert.fail(),announce:()=>assert.fail()}));
 assert.equal(scheduled,0);assert.deepEqual(waits,[]);assert.equal(store.row.data.gmail_auth.status,'reconnect');assert.equal(store.row.data.job.status,'paused');assert.equal(store.row.data.job.error,undefined);
 assert.equal(sweepDue({job:store.row.data.job,connections:{},updated_at:new Date(0).toISOString(),lease_until:null}),false);
 // Even if something restarts the chain, a marked connection does no Gmail work.
 await quiet(()=>runGmailStep('owner',{...store,claimGmailImport:async()=>({...structuredClone(store.row),data:{...structuredClone(store.row.data),job:{status:'extracting',started_at:'s'}}})},env,{},{step:()=>assert.fail(),schedule:()=>scheduled++,tag:async()=>{},build:async()=>({status:'skipped'})}));
 assert.equal(scheduled,0);
});

test('the daily purchase check records the refusal once, then skips the person without calling Google',async()=>{
 const store=storage(seed({job:{status:'ready',started_at:'s',completed_at:new Date(Date.now()-86400000).toISOString()}}));
 let result;const lines=await quiet(async()=>{result=await refreshStep(store,'owner',env,{step:async()=>{throw refused();}});});
 assert.equal(result.status,'failed');assert.equal(result.reason,'reconnect');assert.equal(store.row.data.gmail_auth.where,'purchase_check');
 assert.ok(lines.some(l=>l.event==='gmail_reconnect_needed'));
 assert.deepEqual(await refreshStep(store,'owner',env,{step:()=>assert.fail()}),{status:'skipped',reason:'reconnect'});
 // The run's record counts people who need to reconnect, and real failures as failed, instead of neither.
 let summary;await quiet(async()=>{summary=await runDailyRefresh({...store,gmailConnections:async()=>['a','b','c']},{},{owner:async(s,id)=>({check:id==='a'?'skipped':id==='b'?'failed':'ready',reason:id==='a'?'reconnect':undefined,text:'nothing_new',fit_check:'not_checked'})});});
 assert.equal(summary.reconnect,1);assert.equal(summary.failed,1);assert.equal(summary.checked,1);
});

test('the web app shows reconnect, refuses to step a refused sign-in, and a fresh sign-in clears it',async()=>{
 const store=storage(seed({job:{status:'extracting',started_at:'s',ids:['m1'],processed:[]}}));let calls=0;
 const google=async url=>{calls++;return url.includes('/token')&&!url.includes('revoke')?reply(400,{error:'invalid_grant'}):reply(200,{});};
 let handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher:google});
 let step;await quiet(async()=>{step=await request(handler,{method:'POST',body:{action:'step'}});});
 assert.equal(step.statusCode,409);assert.equal(step.data.reconnect_needed,true);assert.match(step.data.error,/connect gmail again/i);
 assert.equal(store.row.data.gmail_auth.status,'reconnect');assert.equal(store.row.data.job.status,'paused');
 const view=(await request(handler)).data;assert.equal(view.connected,false);assert.equal(view.reconnect_needed,true);
 // No second call to Google: the mark answers first and releases the lease.
 const before=calls;for(const action of ['step','resume'])assert.equal((await request(handler,{method:'POST',body:{action}})).statusCode,409);
 assert.equal(calls,before);assert.equal((await store.claimGmailImport('owner'))!==null,true);await store.finishGmailImport('owner',store.row.revision,store.row.data,store.row.token_ciphertext);
 // Connecting again stores a new sign-in and clears the mark.
 const fresh=async url=>url.includes('/token')?reply(200,{access_token:'new-access',refresh_token:'new-refresh',expires_in:3600,scope:GMAIL_SCOPE}):reply(200,{emailAddress:'tester@example.test'});
 handler=createGmailHandler({env,storeFactory:()=>store,auth,fetcher:fresh});
 const connect=await request(handler,{method:'POST',body:{action:'connect',consent:CONSENT_VERSION}});
 const state=new URL(connect.data.url).searchParams.get('state');
 assert.equal((await request(handler,{url:'/api/wishlist?gmail=callback&state='+state+'&code=synthetic',cookie:connect.headers['Set-Cookie'].split(';')[0]})).statusCode,303);
 assert.equal(store.row.data.gmail_auth,undefined);const after=(await request(handler)).data;assert.equal(after.connected,true);assert.equal(after.reconnect_needed,false);
});

test('admin reads that hit a refused sign-in record it for the person page',async()=>{
 const store=storage(seed());
 const error=await quiet(()=>compareEmail({store,row:store.row,owner:'owner',env,id:'m1',models:[],fetcher:async()=>reply(400,{error:'invalid_grant'})})).then(()=>null,e=>e);
 assert.equal(store.row.data.gmail_auth?.where,'extract_compare');
 // Recording is a no-op for ordinary failures.
 await recordGmailReconnect(store,'owner',Error('timeout'),'x');assert.equal(store.row.data.gmail_auth.where,'extract_compare');
 assert.equal(error?.status,409);assert.match(error.message,/reconnecting/);
});
