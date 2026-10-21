import test from 'node:test';
import assert from 'node:assert/strict';
import {announceImport,nextReceiptQuestion,sendProfile} from '../lib/receipt-notifications.js';
import {prepareReport,sweepGmailImports} from '../lib/gmail-worker.js';
import {sendReportLink,autoSendReport,READ_ASK} from '../lib/style-report.js';
import {purchaseEvidence} from '../lib/receipt-extraction.js';

// The first style report link goes out on its own after onboarding's summary (REPORT_AUTO_SEND_ENABLED).
const owner='owner',env={REPORT_AUTO_SEND_ENABLED:'true',SITE_ORIGIN:'https://jules.example'};
const buy=n=>purchaseEvidence({event_id:`m${n}:purchased`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',values:{merchant:'SSENSE',order_reference:'O'+n,sku:null,brand:'Our Legacy',color:null,size_label:'32',size_system:null,quantity:1,units_per_pack:null,product:'Jeans '+n},item_id:'item-'+n});
const report=id=>({id,built_at:new Date().toISOString(),cards:[{type:'receipt'}]});
function fixture({questions=[],style_report=null}={}){
 const operations=new Map(),sent=[],data={job:{status:'ready',started_at:'s1'},questions,...(style_report?{style_report}:{})};
 return {sent,data,operations,gmailImport:async()=>({data}),evidence:async()=>[1,2,3,4].map(buy),operation:async k=>operations.get(k)??null,
  conversation:async()=>({id:owner,line:'l',sender_id:'p'}),createSignInLink:async()=>'tok',
  reserve:async(o,k,body)=>{if(operations.has(k))return false;operations.set(k,{conversation_id:o,status:'sending',body});return true;},
  finish:async(k,status)=>{operations.get(k).status=status;},
  send:async(d,body)=>{sent.push(body);return {id:'m'+sent.length};}};
}
const links=store=>store.sent.filter(b=>/style report is ready.*\/report#signin=tok/.test(b));
// The worker's background build (lib/gmail-worker.js prepareReport), with a stand-in for buildReport.
const built=(store,{id='r1',on=env,status='built'}={})=>prepareReport(store,owner,on,{tag:async()=>{},build:async()=>{if(status==='built')store.data.style_report=report(id);return {status,unlocked:[]};},autoSend:(s,o,e)=>autoSendReport(s,o,e,{send:store.send})});

test('report built first: the summary goes after the count, the link once the last question is answered',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the jeans for you?',item_ids:['item-1']}];
 const store=fixture({questions});
 await announceImport(store,owner,env,store.send);await built(store);
 assert.equal(store.sent.length,3,'completion, summary and the question; no link while a question is open');
 assert.match(store.sent[1],/what your purchases show so far/);
 questions[0].status='answered';await nextReceiptQuestion(store,owner,env,store.send);
 assert.equal(links(store).length,1);assert.equal(store.sent.indexOf(links(store)[0]),3,'the link comes once the question is answered');
 await nextReceiptQuestion(store,owner,env,store.send);
 store.data.style_report.linked=true;await built(store,{id:'r2'});
 assert.equal(links(store).length,1,'only the first link, even after a rebuild');
});

test('summary first: the link goes out when the report finishes building',async()=>{
 const store=fixture();
 await announceImport(store,owner,env,store.send);
 assert.equal(store.sent.length,2);assert.match(store.sent[1],/what your purchases show so far/);
 assert.equal(links(store).length,0,'no report yet, nothing to link');
 await built(store);
 assert.equal(store.sent.length,3);assert.equal(links(store).length,1);
});

test('never before the summary, and never while a question waits after it, even with the report ready',async()=>{
 const questions=[{id:'q1',status:'open',question:'Q?',item_ids:['item-1']}];
 const store=fixture({questions,style_report:report('r1')});
 assert.equal(await autoSendReport(store,owner,env,{send:store.send}),null,'no summary yet');
 await announceImport(store,owner,env,store.send);await built(store,{status:'busy'});
 assert.match(store.sent[1],/what your purchases show so far/);assert.equal(links(store).length,0,'the question is still open');
 // A sweep finds nothing to send and does not release the link either.
 const sweep={...store,gmailProfilesDue:async()=>[owner],quietGmailImports:async()=>[]};
 await sweepGmailImports(sweep,env,{profile:(s,o,e)=>sendProfile(s,o,e,store.send)});
 assert.equal(links(store).length,0);
 questions[0].status='answered';await nextReceiptQuestion(store,owner,env,store.send);
 assert.equal(links(store).length,1,'sent once the question closes');
});

test('with the style interview on, the link waits for the round to close and comes after it',async()=>{
 const {recordAnswer,continueInterview,BATCH}=await import('../lib/interview.js');
 const store=fixture({style_report:report('r1')}),on={...env,INTERVIEW_ENABLED:'true'};
 let row={revision:0,state:{}};
 Object.assign(store,{interview:async()=>structuredClone(row),writeInterview:async(o,revision,state)=>{if(revision!==row.revision)return false;row={revision:revision+1,state:structuredClone(state)};return true;},
  recordEvidence:async()=>{},profile:async()=>({facts:[]})});
 await announceImport(store,owner,on,store.send);await built(store,{on,status:'busy'});
 assert.match(store.operations.get('gmail:owner:profile:s1')?.body??'',/early read|purchases show/,'the summary went after the count');
 assert.ok([...store.operations.keys()].some(k=>k.startsWith('interview:')),'then a style question');
 assert.equal(links(store).length,0,'no link while the round is open');
 for(let i=0;i<BATCH;i++){
  const waiting=row.state.asked.at(-1);if(!waiting||waiting.outcome)break;
  await recordAnswer(store,owner,{questionId:waiting.qid,outcome:'answered',messageId:'a'+i,log:()=>{}});
  await continueInterview(store,owner,on,{send:store.send,log:()=>{}});
 }
 assert.equal(links(store).length,1,'sent once the round closes');
 const offer=store.sent.findIndex(t=>/want them now, or another time/.test(t));
 if(offer>=0)assert.ok(store.sent.indexOf(links(store)[0])<offer,'the link before the offer of more questions');
});

test('fewer than 3 purchase lines: no report, so nothing is sent after the summary',async()=>{
 const store=fixture();
 await announceImport(store,owner,env,store.send);
 await built(store,{status:'not_enough'});await nextReceiptQuestion(store,owner,env,store.send);
 assert.equal(store.sent.length,2);assert.equal(links(store).length,0);
});

test('Admin’s Send report and the automatic send never both text the link',async()=>{
 const store=fixture();
 await announceImport(store,owner,env,store.send);await built(store);
 const count=store.sent.length;
 const again=await sendReportLink(store,owner,env,store.send);
 assert.equal(again.duplicate,true);assert.equal(store.sent.length,count,'Admin after the automatic send');
 const first=fixture({style_report:report('r1')}),off={...env,REPORT_AUTO_SEND_ENABLED:'false'};
 await announceImport(first,owner,off,first.send);
 await sendReportLink(first,owner,env,first.send);
 const before=first.sent.length;
 await nextReceiptQuestion(first,owner,env,first.send);await built(first,{status:'busy'});
 assert.equal(first.sent.length,before,'the automatic send after Admin');assert.equal(links(first).length,1);
});

test('the link is followed by the fit-photo ask while the Read is locked',async()=>{
 const store=fixture(),style={...env,STYLE_ENABLED:'true'};
 await announceImport(store,owner,env,store.send);await built(store,{on:style});
 assert.equal(store.sent.at(-1),READ_ASK);assert.equal(links(store).length,1);
});

test('a person who texted STOP gets no link',async()=>{
 const store=fixture();
 await announceImport(store,owner,env,store.send);
 // STOP: the ledger refuses every new send (lib/store.js reserve).
 store.reserve=async(o,k,body)=>{if(store.operations.has(k))return false;store.operations.set(k,{conversation_id:o,status:'blocked',body});return false;};
 await built(store);
 assert.equal(links(store).length,0);assert.equal(store.operations.get('report:owner:r1').status,'blocked');
});

test('switch off: the first link stays with Admin',async()=>{
 const store=fixture(),off={...env,REPORT_AUTO_SEND_ENABLED:'false'};
 await announceImport(store,owner,off,store.send);await built(store,{on:off});
 assert.equal(store.sent.length,2);assert.equal(links(store).length,0);
});

test('a report the summary already built after the import settled is not rebuilt by the worker',async()=>{
 const store=fixture({style_report:report('r1')});let builds=0;
 const build=async()=>{builds++;return {status:'built',unlocked:[]};};
 await prepareReport(store,owner,{},{tag:async()=>{},build,rebuild:true,since:new Date(Date.now()-60000).toISOString(),autoSend:null});
 assert.equal(builds,0);
 await prepareReport(store,owner,{},{tag:async()=>{},build,rebuild:true,since:new Date(Date.now()+60000).toISOString(),autoSend:null});
 assert.equal(builds,1,'an older report is rebuilt with the new import');
});
