import test from 'node:test';
import assert from 'node:assert/strict';
import {startInterview,continueInterview,recordAnswer,planNext,candidates,interviewContext,interviewOpen,questionsLeft,adminStartInterview,BATCH} from '../lib/interview.js';
import {coverage} from '../lib/coverage.js';
import {announceImport,nextReceiptQuestion,sendProfile} from '../lib/receipt-notifications.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {tagFingerprint,TAG_VERSION} from '../lib/item-tags.js';

const owner='owner',env={INTERVIEW_ENABLED:'true'},quiet=()=>{};
const buy=(n,v={})=>purchaseEvidence({event_id:`m${n}:purchased`,kind:'purchased',source_id:`m${n}`,at:n,evidence:'x',basis:'order_confirmation',category:'clothing',
 values:{merchant:'Depop',order_reference:'O'+n,sku:null,brand:null,color:null,size_label:null,size_system:null,quantity:1,units_per_pack:null,product:'Item '+n,...v},item_id:'item-'+n,recipient:{value:'self',quote:'x'}});
const tagsFor=(rows,tag=()=>({}))=>Object.fromEntries(projectReceiptEvidence(owner,rows).state.items.map(i=>[i.id,{fp:tagFingerprint(i),v:TAG_VERSION,item_type:'jacket',group:'tops',color_family:'unknown',resale:true,...tag(i)}]));

// The ledger, interview row and evidence of one person, in memory. sent holds every text in order.
function fakeStore({facts=[],rows=[],job=null,questions=[],tags={},outfits=0}={}){
 let row={revision:0,state:{}};const operations=new Map(),sent=[],recorded=[];
 return {sent,recorded,operations,get state(){return row.state;},questions,
  send:async(delivery,body)=>{sent.push(body);},
  interview:async()=>structuredClone(row),
  writeInterview:async(o,revision,state)=>{if(revision!==row.revision)return false;row={revision:revision+1,state:structuredClone(state)};return true;},
  recordEvidence:async(o,list)=>{recorded.push(...list);},
  conversation:async()=>({id:owner,line:'l',sender_id:'p'}),
  reserve:async(o,k,body)=>{if(operations.has(k))return false;operations.set(k,{status:'sending',body,conversation_id:o});return true;},
  operation:async k=>operations.get(k)??null,finish:async(k,status)=>{operations.get(k).status=status;},
  profile:async()=>({facts}),evidence:async origins=>origins==='chat'?[]:rows,
  gmailImport:async()=>job?{data:{job,questions,item_tags:tags}}:null,
  styleSources:async()=>Array.from({length:outfits},(_,i)=>({id:'o'+i,kind:'outfit'})),
  styleSession:async()=>({data:outfits?{outfit_reading:{photos:outfits,observations:[{text:'wide-leg trousers, cropped jackets',source_ids:['o0','o1']}]}}:{}})};
}
const asked=store=>store.state.asked.map(a=>a.qid);
const answer=(store,qid,outcome,id,text='')=>recordAnswer(store,owner,{questionId:qid,outcome,messageId:id,messageText:text,log:quiet});
const next=store=>continueInterview(store,owner,env,{send:store.send,log:quiet});

test('Gmail skipped (case B): taste first, three questions, then the offer of more; a request continues without repeats',async()=>{
 const store=fakeStore();
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 assert.deepEqual(asked(store),['wear_most']);assert.match(store.sent[0],/3 things you wear all the time/);
 // "i don't take outfit pics": partial; the inspiration ask follows instead of asking for photos again.
 assert.equal((await answer(store,'wear_most','partial','m1')).next,true);await next(store);
 assert.deepEqual(asked(store),['wear_most','inspo']);
 await answer(store,'inspo','answered','m2');await next(store);
 assert.equal(asked(store).length,BATCH);
 await answer(store,asked(store)[2],'answered','m3');await next(store);
 assert.match(store.sent.at(-1),/want them now, or another time/);
 assert.equal(interviewOpen(store.state),false,'the round is closed');
 assert.equal(await next(store),null,'nothing more until they ask');
 await startInterview(store,owner,env,'request',{send:store.send,log:quiet});
 const second=asked(store).slice(BATCH);
 assert.equal(second.length,1);assert.ok(!asked(store).slice(0,BATCH).includes(second[0]),'never asks a question twice');
 assert.equal(store.recorded.length,3);
 assert.deepEqual(store.recorded.map(e=>[e.kind,e.origin,e.source.question_id]),[['stated_answer','interview','wear_most'],['stated_answer','interview','inspo'],['stated_answer','interview',asked(store)[2]]]);
});

test('the spend question is always last, and a size question offers the size bought most',()=>{
 const rows=[1,2,3].map(n=>buy(n,{size_label:'M'})),state=projectReceiptEvidence(owner,rows).state;
 const cov=coverage({state,tags:tagsFor(rows)});
 const list=candidates(cov,{});
 assert.equal(list.at(-1).qid,'spend');
 const size=list.find(q=>q.qid==='fit_anchor:tops');
 assert.match(size.text,/mostly M in tops/);
 assert.equal(list[0].qid,'wear_most','taste gaps come first');
});

test('a rich profile gets no taste questions, only a size question for a category still unstated',()=>{
 const rows=[1,2,3,4,5,6].map(n=>buy(n,{merchant:'COS',color:'black',brand:'COS',size_label:n<4?'M':null}));
 const state=projectReceiptEvidence(owner,rows).state,tags=tagsFor(rows,()=>({color_family:'black',resale:false}));
 const facts=[{field:'style',key:'palette',value:'black',basis:'stated',evidence_ids:['c1']},{field:'store',key:'cos',value:'basics',basis:'stated',evidence_ids:['c2']},{field:'budget',key:'tops/usd',value:'100',basis:'stated',evidence_ids:['c3']}];
 const cov=coverage({facts,state,tags,outfits:{kept:3,reading_photos:3,observations:2}});
 assert.equal(cov.level,'rich');
 assert.deepEqual(candidates(cov,{}).map(q=>q.qid),['fit_anchor:tops']);
});

test('a topic change pauses the questions (case D); a later request resumes from what is still open',async()=>{
 const store=fakeStore();
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 const result=await answer(store,'wear_most','changed_topic','m1','actually can you find me a black wool coat under 300?');
 assert.equal(result.next,false);
 assert.equal(await next(store),null,'no question while paused');
 assert.equal(await startInterview(store,owner,env,'import',{send:store.send,log:quiet}),null,'an import does not restart a paused interview');
 assert.equal(store.sent.length,1);
 await startInterview(store,owner,env,'request',{send:store.send,log:quiet});
 assert.equal(store.sent.length,2);
 assert.equal(asked(store).filter(q=>q==='wear_most').length,1,'the paused question is not asked again');
});

test('declining ends the round quietly (case H) and nothing restarts it except the person asking',async()=>{
 const store=fakeStore();
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 await answer(store,'wear_most','declined_interview','m1','not now, i’ll just ask when i need something');
 await next(store);
 assert.equal(store.sent.length,1,'no close text after a decline');
 assert.equal(interviewOpen(store.state),false);
 await startInterview(store,owner,env,'import',{send:store.send,log:quiet});await next(store);
 assert.equal(store.sent.length,1,'still nothing');
 await startInterview(store,owner,env,'request',{send:store.send,log:quiet});
 assert.equal(store.sent.length,2);assert.equal(store.state.declined_at,undefined);
});

test('a reply to an older question is recorded against that question (case E)',async()=>{
 const store=fakeStore();
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 await answer(store,'wear_most','partial','m1');await next(store);
 const late=await answer(store,'wear_most','answered','m2','baggy jeans and a grey hoodie, basically every day');
 assert.equal(late.ok,true);
 assert.equal(store.state.asked.find(a=>a.qid==='wear_most').outcome,'answered');
 assert.equal(store.state.asked.find(a=>a.qid==='inspo').outcome,null,'the newer question stays open');
});

test('answers are checked: unknown questions are refused, replays record once, quotes must be in the message',async()=>{
 const store=fakeStore();
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 const unknown=await answer(store,'spend','answered','m1');
 assert.equal(unknown.ok,false);assert.equal(store.recorded.length,0);
 await recordAnswer(store,owner,{questionId:'wear_most',outcome:'answered',messageId:'m2',messageText:'black jeans every day',quote:'black jeans',log:quiet});
 const replay=await recordAnswer(store,owner,{questionId:'wear_most',outcome:'answered',messageId:'m2',messageText:'black jeans every day',quote:'black jeans',log:quiet});
 assert.equal(replay.next,false,'a replayed delivery does not send another question');
 assert.equal(store.recorded.length,1);assert.equal(store.recorded[0].data.answer_quote,'black jeans');
 await recordAnswer(store,owner,{questionId:'wear_most',outcome:'partial',messageId:'m3',messageText:'mostly jeans',quote:'invented words',log:quiet});
 assert.equal(store.recorded.at(-1).data.answer_quote,null,'a quote not in the message is dropped');
});

test('the agent sees what was asked and which question is waiting',async()=>{
 const store=fakeStore();
 assert.equal(interviewContext(store.state),null);
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 const context=interviewContext(store.state);
 assert.equal(context.waiting_for,'wear_most');assert.equal(context.round_open,true);
 assert.match(context.asked[0].text,/wear all the time/);
});

test('with INTERVIEW_ENABLED off nothing is sent or written',async()=>{
 const store=fakeStore();
 assert.equal(await startInterview(store,owner,{},'declined',{send:store.send,log:quiet}),null);
 assert.equal(store.sent.length,0);assert.deepEqual(store.state,{});
});

test('a thin import (case A): completion, then the questions, and the summary only after the round closes',async()=>{
 const rows=[1,2,3,4,5,6,7].map(n=>buy(n,{color:n<=3?'brown':null,size_label:n<=5?'M':null}));
 const store=fakeStore({rows,job:{status:'ready',started_at:'s1'},tags:tagsFor(rows,i=>({group:['item-1','item-2'].includes(i.id)?'trousers':'tops',color_family:i.color?'brown':'unknown'}))});
 await announceImport(store,owner,env,store.send);
 assert.match(store.sent[0],/found 7 clothing purchases/);
 assert.equal(store.sent.length,2);assert.equal(asked(store)[0],'wear_most');
 assert.equal(await sendProfile(store,owner,env,store.send),null,'the summary waits while a round is open');
 for(let i=0;i<BATCH;i++){await answer(store,asked(store).at(-1),'answered','a'+i);await next(store);}
 // A thin profile's summary is the early read; it goes first, then the offer of more questions.
 assert.match(store.sent.at(-2),/early read/);
 assert.match(store.sent.at(-1),/want them now, or another time/);
 await nextReceiptQuestion(store,owner,env,store.send);
 assert.equal(store.sent.filter(t=>/early read/.test(t)).length,1,'and is sent once');
});

test('the 24-hour sweep still sends the summary while questions wait',async()=>{
 const rows=[buy(1),buy(2)];
 const store=fakeStore({rows,job:{status:'ready',started_at:'s1'},tags:tagsFor(rows)});
 await announceImport(store,owner,env,store.send);
 assert.ok(interviewOpen(store.state));
 await sendProfile(store,owner,env,store.send,null,{force:true});
 assert.match(store.sent.at(-1),/early read/);
});

test('asking for questions when nothing is left says so instead of sending an empty round',async()=>{
 const rows=[1,2,3,4,5,6].map(n=>buy(n,{merchant:'COS',color:'black',brand:'COS'}));
 const facts=[{field:'style',key:'palette',value:'black',basis:'stated',evidence_ids:['c1']},{field:'store',key:'cos',value:'basics',basis:'stated',evidence_ids:['c2']},{field:'budget',key:'tops/usd',value:'100',basis:'stated',evidence_ids:['c3']}];
 const store=fakeStore({facts,rows,job:{status:'ready',started_at:'s1'},tags:tagsFor(rows,()=>({color_family:'black',resale:false})),outfits:3});
 assert.equal(await questionsLeft(store,owner,{log:quiet}),0);
 await startInterview(store,owner,env,'request',{send:store.send,log:quiet});
 assert.equal(store.sent.length,0,'no "got it" for a round with no questions');
});

test('planNext waits for the open question',()=>{
 const cov=coverage();
 const state={batches:[{n:1,trigger:'declined'}],asked:[{qid:'wear_most',batch:1,outcome:null}]};
 assert.equal(planNext(cov,state),null);
 state.asked[0].outcome='skipped';
 assert.equal(planNext(cov,state).qid,'inspo');
});

test('the agent is offered style_interview only with the interview on, sees the questions, and its reading reaches the action',async()=>{
 const {generateReply}=await import('../lib/ai.js');const {agentTurn,tool,toolNames}=await import('./helpers/agent.js');
 const messages=[{direction:'outbound',status:'sent',body:'what size do you usually take in tops?'},{direction:'inbound',status:'received',body:'M mostly'}],ai={OPENAI_API_KEY:'synthetic'};
 const context={asked:[{question_id:'fit_anchor:tops',text:'what size do you usually take in tops?',asked_at:'2026-10-20T10:00:00Z',outcome:null}],waiting_for:'fit_anchor:tops',declined:false,paused:false,round_open:true};
 let names,input,got=null;
 const fetcher=async(_url,options)=>{names=toolNames(options);input=JSON.parse(options.body).input;
  return agentTurn(tool('style_interview',{action:'answer',question_id:'fit_anchor:tops',outcome:'answered',quote:'M mostly'}));};
 await generateReply(messages,ai,fetcher,{interview:context,interviewAction:async args=>{got=args;return 'Recorded.';}}).catch(()=>{});
 assert.ok(names.includes('style_interview'));
 assert.match(JSON.stringify(input),/style_interview\\":\{\\"asked/);
 assert.deepEqual(got,{action:'answer',questionId:'fit_anchor:tops',outcome:'answered',quote:'M mostly'});
 await generateReply(messages,ai,async(_url,options)=>{names=toolNames(options);return agentTurn(tool('conversation_reply',{response:'ok'}));},{});
 assert.ok(!names.includes('style_interview'));
});

test('asking to continue after an unrecorded topic change sends the next question',async()=>{
 const store=fakeStore();
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 assert.equal(await next(store),null,'the open question holds the round');
 await startInterview(store,owner,env,'request',{send:store.send,log:quiet});
 assert.equal(store.sent.length,2);
 assert.equal(store.state.asked[0].outcome,'unanswered');
 assert.notEqual(store.state.asked[1].qid,'wear_most');
});

test('the owner’s button sends a question, and says why not when it shouldn’t',async()=>{
 const store=fakeStore(),opts={send:store.send,log:quiet};
 assert.deepEqual(await adminStartInterview(store,owner,{},opts),{status:'off'});
 assert.deepEqual(await adminStartInterview(store,owner,env,opts),{status:'sent',question:'wear_most'});
 assert.equal((await adminStartInterview(store,owner,env,opts)).status,'waiting','one question at a time');
 await answer(store,'wear_most','declined_interview','m1','no thanks');
 const declined=await adminStartInterview(store,owner,env,opts);
 assert.equal(declined.status,'declined','never overrides their no');
 assert.equal(store.sent.length,1);
 // After a topic change the owner can resume: the dropped question no longer holds the round.
 const other=fakeStore();
 await startInterview(other,owner,env,'declined',{send:other.send,log:quiet});
 await answer(other,'wear_most','changed_topic','m1','find me a coat');
 assert.equal((await adminStartInterview(other,owner,env,{send:other.send,log:quiet})).status,'sent');
 assert.equal(other.sent.length,2);
});

test('the owner’s button reports nothing left to ask for a complete profile',async()=>{
 const rows=[1,2,3,4,5,6].map(n=>buy(n,{merchant:'COS',color:'black',brand:'COS'}));
 const facts=[{field:'style',key:'palette',value:'black',basis:'stated',evidence_ids:['c1']},{field:'store',key:'cos',value:'basics',basis:'stated',evidence_ids:['c2']},{field:'budget',key:'tops/usd',value:'100',basis:'stated',evidence_ids:['c3']}];
 const store=fakeStore({facts,rows,job:{status:'ready',started_at:'s1'},tags:tagsFor(rows,()=>({color_family:'black',resale:false})),outfits:3});
 assert.deepEqual(await adminStartInterview(store,owner,env,{send:store.send,log:quiet}),{status:'nothing_left'});
 assert.equal(store.sent.length,0);
});

test('a round outside an import ends with the early read and the offer, in one text',async()=>{
 const store=fakeStore({facts:[{field:'size',key:'tops/us',value:'M',basis:'stated',evidence_ids:['c1']}]});
 await startInterview(store,owner,env,'declined',{send:store.send,log:quiet});
 for(let i=0;i<BATCH;i++){await answer(store,asked(store).at(-1),'answered','a'+i);await next(store);}
 const last=store.sent.at(-1);
 assert.match(last,/early read, from what you told me/);
 assert.match(last,/sizes you told me: M in tops/);
 assert.match(last,/want them now, or another time/);
 assert.equal(store.sent.length,BATCH+1,'the read and the offer are one text');
});
