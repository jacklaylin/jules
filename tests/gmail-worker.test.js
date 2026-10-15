import test from 'node:test';import assert from 'node:assert/strict';
import {runGmailStep,handleGmailWork} from '../lib/gmail-worker.js';import {nextReceiptQuestion} from '../lib/receipt-notifications.js';
function fixture(){let row={conversation_id:'owner',revision:1,token_ciphertext:'sealed',data:{job:{status:'extracting',started_at:'synthetic'},feedback:{questions:[]}}};return {get row(){return row;},claimGmailImport:async()=>structuredClone(row),gmailImport:async()=>structuredClone(row),finishGmailImport:async(o,r,data,token)=>{row={...row,data,token_ciphertext:token};return true;},evidence:async()=>[],profile:async()=>({facts:[]})};}
test('background steps persist before scheduling further work and need no browser requests',async()=>{const store=fixture();let scheduled=0;await runGmailStep('owner',store,{},{},{step:async row=>({...row,data:{...row.data,processed:1}}),schedule:()=>{assert.equal(store.row.data.processed,1);scheduled++;}});assert.equal(scheduled,1);});
test('a completed import is announced by text only after it is persisted',async()=>{const store=fixture(),calls=[];await runGmailStep('owner',store,{SITE_ORIGIN:'https://jules.example'},{},{step:async row=>({...row,data:{...row.data,job:{...row.data.job,status:'ready'}}}),announce:async()=>{assert.equal(store.row.data.job.status,'ready');calls.push('announce');},schedule:()=>assert.fail()});assert.deepEqual(calls,['announce']);});
test('failed steps retry with backoff, then pause with an actionable failure without claiming completion',async()=>{const store=fixture(),waits=[];let scheduled=0;const options={step:async()=>{throw Error('failed');},notify:()=>assert.fail(),schedule:()=>scheduled++,wait:async ms=>waits.push(ms)};
 for(let i=0;i<3;i++){await runGmailStep('owner',store,{},{},options);assert.equal(store.row.data.job.error,undefined);}
 assert.deepEqual(waits,[5000,10000,20000]);assert.equal(scheduled,3);
 await runGmailStep('owner',store,{},{},options);assert.equal(scheduled,3);assert.equal(store.row.data.job.status,'extracting');assert.ok(store.row.data.job.error);assert.equal(store.row.data.job.failures,undefined);
});
test('a successful step clears the retry count',async()=>{const store=fixture();store.row.data.job.failures=2;await runGmailStep('owner',store,{},{},{step:async row=>row,schedule:()=>{}});assert.equal(store.row.data.job.failures,undefined);});
test('unsigned background requests never claim work',()=>{const res={setHeader(){},end(v){this.data=JSON.parse(v);}};handleGmailWork({method:'POST',headers:{}},res,{claimGmailImport:()=>assert.fail()},{GMAIL_IMPORT_ENABLED:'true'});assert.equal(res.statusCode,401);});
test('questions remain in text, reuse original delivery, and advance past resolved questions',async()=>{const operations=new Map(),sent=[];let questions=[{id:'first',status:'open',question:'Was the jacket for you?'},{id:'second',status:'open',question:'Did you keep the shoes?'}];const store={gmailImport:async()=>({data:{job:{status:'ready',started_at:'s'},questions}}),evidence:async()=>[],operation:async key=>operations.get(key),conversation:async()=>({id:'owner',line:'line',sender_id:'sender'}),reserve:async(o,key,body)=>{if(operations.has(key))return false;operations.set(key,{status:'sending',body,conversation_id:o});return true;},finish:async(key,status)=>operations.get(key).status=status};const send=async(d,body)=>{sent.push(body);};await nextReceiptQuestion(store,'owner',{},send);await nextReceiptQuestion(store,'owner',{},send);assert.equal(sent.length,1);questions[0].status='answered';await nextReceiptQuestion(store,'owner',{},send);assert.deepEqual(sent,['Was the jacket for you?','Did you keep the shoes?']);});

test('each step hands the job to a fresh chain id, and the next step carries it',async()=>{const store=fixture();let next;await runGmailStep('owner',store,{},{},{step:async row=>row,schedule:(o,e,info)=>next=info});assert.ok(store.row.data.job.worker);assert.deepEqual(next,{worker:store.row.data.job.worker,attempt:0});});
test('a busy lease retries with backoff instead of ending the chain, up to a bound',async()=>{const store=fixture();store.row.data.job.worker='chain';store.claimGmailImport=async()=>null;const waits=[],next=[];const options={step:()=>assert.fail(),schedule:(o,e,info)=>next.push(info),wait:async ms=>waits.push(ms)};
 for(let attempt=0;attempt<=4;attempt++)await runGmailStep('owner',store,{},{worker:'chain',attempt},options);
 assert.deepEqual(waits,[5000,10000,20000,40000]);assert.deepEqual(next.map(n=>n.attempt),[1,2,3,4]);assert.ok(next.every(n=>n.worker==='chain'));});
test('superseded chains stop without changing the job or retrying',async()=>{const store=fixture();store.row.data.job.worker='newer';const before=structuredClone(store.row.data);let scheduled=0;
 await runGmailStep('owner',store,{},{worker:'older'},{step:()=>assert.fail(),schedule:()=>scheduled++});assert.deepEqual(store.row.data,before);
 store.claimGmailImport=async()=>null;await runGmailStep('owner',store,{},{worker:'older'},{step:()=>assert.fail(),schedule:()=>scheduled++,wait:async()=>{}});assert.equal(scheduled,0);});
test('finished or paused jobs never retry a busy lease',async()=>{const store=fixture();store.row.data.job.status='ready';store.claimGmailImport=async()=>null;let scheduled=0;await runGmailStep('owner',store,{},{},{schedule:()=>scheduled++,wait:async()=>{}});assert.equal(scheduled,0);});
test('a failed dispatch is retried before giving up',async()=>{const {scheduleGmail}=await import('../lib/gmail-worker.js');let calls=0;const done=[];
 const fetcher=async(url,init)=>{calls++;assert.equal(init.headers['x-jules-worker'],'chain');if(calls<3)throw Error('network');return {ok:true};};
 globalThis[Symbol.for('@vercel/request-context')]={get:()=>({waitUntil:p=>done.push(p)})};
 try{scheduleGmail('owner',{SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'k'},{worker:'chain'},fetcher,async()=>{});await Promise.all(done);}finally{delete globalThis[Symbol.for('@vercel/request-context')];}
 assert.equal(calls,3);});
test('one invocation runs steps back to back until its time budget, then hands off once',async()=>{const store=fixture();let steps=0,scheduled=0;
 await runGmailStep('owner',store,{},{deadline:Date.now()+60000},{step:async row=>{steps++;return {...row,data:{...row.data,job:{...row.data.job,status:steps<5?'extracting':'ready'}}};},notify:async()=>({status:'sent'}),question:async()=>{},schedule:()=>scheduled++});
 assert.equal(steps,5);assert.equal(scheduled,0);
 const timed=fixture();steps=0;await runGmailStep('owner',timed,{},{deadline:0},{step:async row=>{steps++;return row;},schedule:()=>scheduled++});assert.equal(steps,1);assert.equal(scheduled,1);});

// Restart sweep (Supabase scheduler)
import {sweepGmailImports,sweepDue,handleGmailSweep} from '../lib/gmail-worker.js';
const minutes=n=>new Date(Date.now()-n*60000).toISOString();
function sweepStore(rows){const finished=[];return {finished,quietGmailImports:async before=>{assert.ok(Date.parse(before)<=Date.now()-59000);return rows.map(r=>({conversation_id:r.id,updated_at:r.updated_at,lease_until:r.lease_until??null,job:r.job}));},
 claimGmailImport:async id=>{const r=rows.find(x=>x.id===id);return r.busy?null:{revision:1,token_ciphertext:'sealed',data:{job:structuredClone(r.job)}};},
 finishGmailImport:async(id,rev,data)=>{finished.push({id,job:data.job});return true;}};}
test('the sweep restarts quiet imports with a fresh chain and leaves busy, recent or finished ones alone',async()=>{
 const store=sweepStore([{id:'quiet',updated_at:minutes(3),job:{status:'extracting',worker:'old'}},{id:'leased',updated_at:minutes(3),lease_until:new Date(Date.now()+60000).toISOString(),job:{status:'listing'}},
  {id:'recent',updated_at:minutes(0.5),job:{status:'extracting'}},{id:'busy',busy:true,updated_at:minutes(3),job:{status:'questions'}}]);
 const scheduled=[];const result=await sweepGmailImports(store,{},{schedule:(owner,env,info)=>scheduled.push([owner,info.worker])});
 assert.equal(result.restarted,1);assert.deepEqual(scheduled.map(s=>s[0]),['quiet']);assert.notEqual(scheduled[0][1],'old');assert.equal(store.finished[0].job.worker,scheduled[0][1]);
});
test('imports paused after failures are retried with growing gaps, then left for review',()=>{
 const row=(quietMinutes,retries)=>({updated_at:minutes(quietMinutes),lease_until:null,job:{status:'extracting',error:'paused',sweep_retries:retries}});
 assert.equal(sweepDue(row(4,0)),false);assert.equal(sweepDue(row(6,0)),true);
 assert.equal(sweepDue(row(15,2)),false);assert.equal(sweepDue(row(21,2)),true);
 assert.equal(sweepDue(row(10000,5)),false);
 assert.equal(sweepDue({updated_at:minutes(10),job:{status:'ready'}}),false);
});
test('a retried import counts the retry and clears the error before restarting',async()=>{
 const store=sweepStore([{id:'paused',updated_at:minutes(30),job:{status:'extracting',error:'paused',sweep_retries:1}}]);
 await sweepGmailImports(store,{},{schedule:()=>{}});assert.equal(store.finished[0].job.sweep_retries,2);assert.equal(store.finished[0].job.error,undefined);
});
test('the sweep endpoint requires the secret generated in Supabase Vault',async()=>{
 const {resetSweepSecret}=await import('../lib/gmail-worker.js');
 const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.body=JSON.parse(b);}});
 const env={GMAIL_IMPORT_ENABLED:'true'},secret='s'.repeat(64),store={gmailSweepSecret:async()=>secret,quietGmailImports:async()=>[]};
 resetSweepSecret();let r=res();await handleGmailSweep({headers:{}},r,store,env);assert.equal(r.statusCode,401);
 r=res();await handleGmailSweep({headers:{authorization:'Bearer wrong'}},r,store,env);assert.equal(r.statusCode,401);
 r=res();await handleGmailSweep({headers:{authorization:'Bearer '+secret}},r,store,env);assert.equal(r.statusCode,200);assert.deepEqual(r.body,{quiet:0,restarted:0,abandoned:0,profiles:0});
 // Not installed yet (no secret): refused, never open.
 resetSweepSecret();r=res();await handleGmailSweep({headers:{authorization:'Bearer null'}},r,{gmailSweepSecret:async()=>null},env);assert.equal(r.statusCode,401);
 resetSweepSecret();r=res();await handleGmailSweep({headers:{authorization:'Bearer x'}},r,{gmailSweepSecret:async()=>{throw Error('missing function');}},env);assert.equal(r.statusCode,503);
 resetSweepSecret();
});
test('a successful step clears sweep retries',async()=>{const store=fixture();store.row.data.job.sweep_retries=3;await runGmailStep('owner',store,{},{},{step:async row=>row,schedule:()=>{}});assert.equal(store.row.data.job.sweep_retries,undefined);});
test('the reading-your-emails text is sent on the first import only',async()=>{
 const run=async data=>{const store=fixture(),notes=[];store.row.data={...data,job:{status:'listing',started_at:'s'}};await runGmailStep('owner',store,{},{},{step:async row=>row,notify:async(s,o,e,stage)=>{notes.push(stage);return {status:'sent'};},schedule:()=>{}});return notes;};
 assert.deepEqual(await run({}),['started:s']);
 assert.deepEqual(await run({sources:[{id:'m1'}]}),[]);
 assert.deepEqual(await run({scanned_ids:['x']}),[]);
});

// Connected sources (Shop) in the background chain
function sourceFixture(connections,job=null){const store=fixture();store.row.data={connections,...(job?{job}:{})};if(!job)store.row.token_ciphertext=null;return store;}
const approved=(status='extracting')=>({status,credential:'sealed',imported_at:new Date().toISOString(),queue:[{id:'shop:1'}],processed:0});
test('a source waiting for approval is polled on the server at its interval, with no browser',async()=>{
 const store=sourceFixture({shop:{status:'awaiting_approval',pending:{interval:5,polled_at:Date.now(),started_at:new Date().toISOString()}}});const actions=[],waits=[];
 const source=async(s,action,{data,state,pending})=>{actions.push(action);return {data:{...data,connections:{shop:approved('ready')}},state,pending,evidence:[]};};
 let clock=Date.now();await runGmailStep('owner',store,{},{deadline:Date.now()+60000},{source,now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},announce:async()=>{},ask:async()=>{},schedule:()=>assert.fail()});
 assert.equal(waits.length,1);assert.ok(waits[0]>0&&waits[0]<=5000,'waits for the poll interval');assert.deepEqual(actions,['poll']);
});
test('Gmail and a source take turns in one chain, and the completion text waits for both',async()=>{
 const store=sourceFixture({shop:approved()},{status:'extracting',started_at:new Date(Date.now()-60000).toISOString()});let gmailSteps=0,shopSteps=0;const order=[],announced=[];
 const step=async row=>{gmailSteps++;order.push('gmail');return {...row,data:{...row.data,job:{...row.data.job,status:gmailSteps>=2?'ready':'extracting'}}};};
 const source=async(s,action,{data,state,pending})=>{shopSteps++;order.push('shop');return {data:{...data,connections:{shop:{...data.connections.shop,status:shopSteps>=2?'ready':'extracting'}}},state,pending,evidence:[]};};
 await runGmailStep('owner',store,{},{deadline:Date.now()+60000},{step,source,announce:async()=>{announced.push(structuredClone(store.row.data));},ask:async()=>{},schedule:()=>{}});
 assert.deepEqual(order,['gmail','shop','gmail','shop']);assert.equal(announced.length,1,'one completion text');
 assert.equal(announced[0].job.status,'ready');assert.equal(announced[0].connections.shop.status,'ready');
});
test('approval that never comes stops holding back the completion text after the cutoff',async()=>{
 const started=new Date(Date.now()-11*60000).toISOString();
 const store=sourceFixture({shop:{status:'awaiting_approval',pending:{interval:5,polled_at:Date.now(),started_at:started}}},{status:'ready',started_at:'s'});let announced=0;
 await runGmailStep('owner',store,{},{deadline:0},{announce:async()=>{announced++;},schedule:()=>{},wait:async()=>{}});
 assert.equal(announced,1);assert.equal(store.row.data.announced,'s');
 await runGmailStep('owner',store,{},{deadline:0},{announce:async()=>{announced++;},schedule:()=>{},wait:async()=>{}});assert.equal(announced,1,'announced once');
 const fresh=sourceFixture({shop:{status:'awaiting_approval',pending:{interval:5,polled_at:Date.now(),started_at:new Date().toISOString()}}},{status:'ready',started_at:'s'});
 await runGmailStep('owner',fresh,{},{deadline:0},{announce:async()=>assert.fail('inside the cutoff'),schedule:()=>{},wait:async()=>{}});
});
test('a source finishing after its round was announced goes on to its questions',async()=>{
 const store=sourceFixture({shop:approved()},{status:'ready',started_at:'s'});store.row.data.announced='s';const calls=[];
 const source=async(s,action,{data,state,pending})=>({data:{...data,connections:{shop:{...data.connections.shop,status:'ready'}}},state,pending,evidence:[]});
 await runGmailStep('owner',store,{},{},{source,announce:async()=>calls.push('announce'),ask:async()=>calls.push('ask'),schedule:()=>{}});
 assert.deepEqual(calls,['ask']);
});
test('a source that keeps failing stops with a message to import again, and does not hold back the text',async()=>{
 const store=sourceFixture({shop:approved()},{status:'ready',started_at:'s'});let announced=0;const options={source:async()=>{throw Error('down');},announce:async()=>{announced++;},schedule:()=>{},wait:async()=>{}};
 for(let i=0;i<4;i++)await runGmailStep('owner',store,{},{},options);
 assert.equal(store.row.data.connections.shop.status,'connected');assert.match(store.row.data.connections.shop.error,/Import it again/);assert.equal(announced,1);
});
test('the sweep restarts a quiet source that is still reading or waiting for approval',()=>{
 const quiet=new Date(Date.now()-120000).toISOString();
 assert.equal(sweepDue({updated_at:quiet,connections:{shop:{status:'awaiting_approval'}}}),true);
 assert.equal(sweepDue({updated_at:quiet,connections:{shop:{status:'ready'}}}),false);
 assert.equal(sweepDue({updated_at:new Date().toISOString(),connections:{shop:{status:'extracting'}}}),false);
});

// Chat answers queued while this chain held the lease (lib/receipt-chat.js) are applied as a step of their own.
test('queued chat answers are applied with the lease, cleared, and followed by the next question before work continues',async()=>{
 const {createReceiptFeedback}=await import('../lib/receipt-feedback.js');
 const store=fixture(),cleared=[];let asked=0;
 store.row.data.feedback={...createReceiptFeedback('owner',[{id:'shirt',source_ids:['s1'],brand:'BODE',product_name:'Shirt'}]),questions:[]};
 const answer={id:'imessage:fake',at:'2026-10-15T04:18:21Z',proposal:{actions:[{item_ids:['shirt'],action:'set_recipient',recipient:'self',recipient_label:null,corrections:[],target_item_id:null,question_id:null}]}};
 const claim=store.claimGmailImport;store.claimGmailImport=async()=>({...await claim(),chat_answers:cleared.length?[]:[answer]});
 store.clearHistoryAnswers=async(_o,ids)=>{cleared.push(...ids);};
 const evidence=[],finish=store.finishGmailImport;store.finishGmailImport=async(o,r,data,token,rows=[])=>{evidence.push(...rows);return finish(o,r,data,token);};
 let steps=0;
 await runGmailStep('owner',store,{},{deadline:Date.now()+60000},{step:async row=>{steps++;return {...row,data:{...row.data,job:{...row.data.job,status:'ready'}}};},ask:async()=>{asked++;},announce:async()=>{},schedule:()=>{}});
 assert.deepEqual(cleared,['imessage:fake']);assert.ok(asked>=1);assert.equal(steps,1,'import work continues after the answers');
 assert.ok(evidence.some(e=>JSON.stringify(e).includes('imessage:fake')),'the answer is written as correction evidence');
});

test('once an import has finished, the chain tags purchases and builds the style report after announcing',async()=>{const store=fixture(),calls=[];
 await runGmailStep('owner',store,{},{},{step:async row=>({...row,data:{...row.data,job:{...row.data.job,status:'ready'}}}),announce:async()=>calls.push('announce'),tag:async(s,o)=>{assert.equal(o,'owner');calls.push('tag');return {tagged:0};},build:async(s,o)=>{assert.equal(o,'owner');calls.push('build');return {status:'built'};},schedule:()=>{}});
 assert.deepEqual(calls,['announce','tag','build'],'the report is ready before the person opens it');
 // With nothing left to read, only a missing report is built: an existing one is not rewritten on every wake.
 const idle=fixture(),built=[];idle.row.data.job.status='ready';idle.row.data.style_report={id:'r1'};
 await runGmailStep('owner',idle,{},{},{tag:async()=>({tagged:0}),build:async()=>{built.push('build');return {status:'built'};},schedule:()=>{}});assert.deepEqual(built,[]);
 delete idle.row.data.style_report;
 await runGmailStep('owner',idle,{},{},{tag:async()=>({tagged:0}),build:async()=>{built.push('build');return {status:'built'};},schedule:()=>{}});assert.deepEqual(built,['build']);
 // A failed tagging run never fails the import.
 const failing=fixture();failing.row.data.job.status='ready';
 await runGmailStep('owner',failing,{},{},{tag:async()=>{throw Error('model down');},build:async()=>{throw Error('model down');},schedule:()=>{}});assert.equal(failing.row.data.job.status,'ready');});
