import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {readCoverage} from './coverage.js';

// Gap-filling taste interview (design/cold-start-taste-brief.md, step 2). Jules asks short questions
// only about the parts of someone's taste that coverage marks missing or weak, one text at a time,
// at most BATCH per round before offering the rest. Code chooses which gap to ask about; the chat
// agent reads each reply (style_interview tool) and saves any lasting facts with update_profile as
// usual. Progress lives in taste_interviews (db/040); each question is sent once through the ledger.
export const BATCH=3;
export const OUTCOMES=['answered','partial','skipped','declined_interview','changed_topic'];
// Outcomes after which the next question follows the reply.
const CONTINUES=['answered','partial','skipped'];
const SIZED=['tops','bottoms','dresses','outerwear','suits','swimwear','shoes'];

// Starting wording in Jules's voice; the reply composer adapts it to the conversation.
const QUESTIONS={
 wear_most:{dimensions:['silhouettes','palette','categories','brands'],
  text:()=>'quick one so i can shop like i know you: what are 3 things you wear all the time? photos are perfect (a mirror pic or the item on your bed), but a quick description works too.'},
 inspo:{dimensions:['silhouettes','palette','brands'],
  text:()=>'want to show me what you’re into? screenshots of your depop or poshmark likes, pinterest saves, or someone whose style you’d steal all work. no need to explain them.'},
 regret:{dimensions:['silhouettes','palette'],
  text:()=>'and one thing you bought but barely wear? what was off: the fit, the color, or it just didn’t go with anything?'},
 fit_anchor:{dimensions:['sizes'],
  text:({category,bought})=>category==='general'?'what sizes do you usually take? tops, bottoms and shoes are a great start. if a brand runs differently for you, tell me that too.'
   :bought?`your orders show mostly ${bought} in ${category}. is that your usual size? if a brand runs differently for you, tell me that too.`
   :`what size do you usually take in ${category}? if a brand runs differently for you, tell me that too.`},
 channel:{dimensions:['channel','stores'],
  text:()=>'do you mostly buy secondhand, new, or a mix? and any apps or shops you always end up on?'},
 stores:{dimensions:['stores'],
  text:()=>'where do you usually end up shopping? and anywhere you avoid?'},
 spend:{dimensions:['price_band'],
  text:()=>'last one: roughly what do you usually spend on a piece like a jacket? just for me, so i don’t show you stuff way outside it.'},
};
const ORDER=['wear_most','inspo','regret','fit_anchor','channel','stores','spend'];
const CLOSE={
 more:'that helps a lot. i’ve got a couple more questions that would sharpen this. want them now, or another time?',
 done:'got it, that’s really useful. i’ll keep all of this in mind when i shop for you. tell me anytime if something’s off.',
};

export const interviewEnabled=(store,env)=>env?.INTERVIEW_ENABLED==='true'&&typeof store?.interview==='function'&&typeof store?.writeInterview==='function';
const batchOf=state=>state.batches?.at(-1)??null;
const asked=state=>state.asked??[];
const waiting=state=>{const b=batchOf(state);return b&&!b.closed_at?asked(state).find(a=>a.batch===b.n&&!a.outcome)??null:null;};
// An interview round is open: questions are still to come or one is waiting for an answer.
export const interviewOpen=state=>Boolean(!state?.declined_at&&!state?.paused_at&&batchOf(state??{})&&!batchOf(state).closed_at);

// The questions that would fill a gap now, best first. Never one already asked.
export function candidates(cov,state={},{outfitAsked=false}={}){
 const status=d=>cov.dimensions.find(x=>x.dimension===d)?.status??'missing',open=d=>status(d)!=='known';
 const done=new Set(asked(state).map(a=>a.qid)),taste=open('silhouettes')||open('palette'),out=[];
 const add=(qid,key=qid,extra={})=>{if(!done.has(key))out.push({qid:key,base:qid,dimensions:QUESTIONS[qid].dimensions,extra});};
 if(cov.level!=='rich'){
  if(taste&&!outfitAsked)add('wear_most');
  // Inspiration comes after own clothes (or after the import already asked for outfit photos).
  if(taste&&(outfitAsked||done.has('wear_most')))add('inspo');
  if(cov.level==='thin'&&(status('silhouettes')==='weak'||status('palette')==='weak'))add('regret');
 }
 // One size question per round: the category bought most without a stated size, or a general one
 // when nothing has been bought or stated yet.
 const sizes=cov.dimensions.find(d=>d.dimension==='sizes');
 const weak=Object.entries(sizes?.categories??{}).filter(([c,s])=>s==='weak'&&SIZED.includes(c)).sort((a,b)=>(sizes.purchases?.[b[0]]??0)-(sizes.purchases?.[a[0]]??0));
 const sizeAsked=asked(state).some(a=>a.qid.startsWith('fit_anchor:')&&a.batch===batchOf(state)?.n);
 if(!sizeAsked){
  const next=weak.find(([c])=>!done.has('fit_anchor:'+c));
  if(next)add('fit_anchor','fit_anchor:'+next[0],{category:next[0],bought:sizes.bought?.[next[0]]??null});
  else if(status('sizes')==='missing'&&status('categories')==='missing')add('fit_anchor','fit_anchor:general',{category:'general'});
 }
 if(cov.level!=='rich'){
  if(status('channel')==='missing'&&open('stores'))add('channel');
  if(open('stores')&&!out.some(q=>q.base==='channel')&&!done.has('channel'))add('stores');
  if(open('price_band'))add('spend');
 }
 // More open dimensions first; taste dimensions count double, since the style reading needs them.
 const score=q=>q.dimensions.reduce((n,d)=>n+(open(d)?(['silhouettes','palette'].includes(d)?2:1):0),0);
 return out.map((q,i)=>({...q,i})).sort((a,b)=>(a.base==='spend')-(b.base==='spend')||score(b)-score(a)||ORDER.indexOf(a.base)-ORDER.indexOf(b.base)||a.i-b.i)
  .map(({i,...q})=>({...q,text:QUESTIONS[q.base].text(q.extra)}));
}

// What happens next in the open round: a question, a close, or nothing (waiting, stopped).
export function planNext(cov,state={},options={}){
 const batch=batchOf(state);
 if(!interviewOpen(state)||waiting(state))return null;
 const next=candidates(cov,state,{outfitAsked:Boolean(batch.outfit_asked),...options});
 if(!next.length)return {close:'done'};
 if(asked(state).filter(a=>a.batch===batch.n).length>=BATCH)return {close:'more'};
 return next[0];
}

// Compare-and-set update of the interview row. change returns the new state, or null for no write.
async function update(store,owner,change){
 for(let attempt=0;attempt<3;attempt++){
  const {revision,state}=await store.interview(owner),next=change(structuredClone(state??{}));
  if(!next)return {state,written:false};
  if(await store.writeInterview(owner,revision,next))return {state:next,written:true};
 }
 throw Error('Interview busy');
}

async function deliverText(store,owner,env,operation,body,send){
 const conversation=await store.conversation(owner);
 return deliverReply({store,send,conversation,operation,body,source:'operator',env});
}

// Starts a round. import/declined start one only for someone who has never had an interview; a
// request ("ask me your questions") clears a decline or pause and opens a new round when needed.
// admin (the owner's button) opens a round like a request but never overrides the person's decline.
export async function startInterview(store,owner,env,trigger,{send=sendGreeting,outfitAsked=false,log=console.log,deliver=true}={}){
 if(!interviewEnabled(store,env))return null;
 const at=new Date().toISOString();
 const {written}=await update(store,owner,state=>{
  const batch=batchOf(state);
  if(!['request','admin'].includes(trigger)){
   if(batch||state.declined_at)return null;
  }else{
   if(trigger==='admin'&&state.declined_at)return null;
   if(trigger==='request')delete state.declined_at;
   delete state.paused_at;
   // A question left without a reply (the person moved on and the agent recorded nothing) stops
   // holding the round, so asking to continue sends the next one.
   for(const a of asked(state))if(!a.outcome)a.outcome='unanswered';
   if(batch&&!batch.closed_at)return state;
  }
  state.batches=[...(state.batches??[]),{n:(batch?.n??0)+1,trigger,started_at:at,outfit_asked:Boolean(outfitAsked)}];
  state.asked??=[];
  return state;
 });
 if(written)log(JSON.stringify({event:'interview_started',trigger}));
 return continueInterview(store,owner,env,{send,log,deliver});
}

// Sends the next question or the close for the open round, once. Returns what was sent, or null.
// deliver false: a question is recorded as asked and returned as {question, text, status:'joined'} for
// the caller to send at the end of its own reply (the chat turn's acknowledgment and the question go
// out as one text). A close is left untouched ({deferred:true}) for a later call to send.
export async function continueInterview(store,owner,env,{send=sendGreeting,log=console.log,coverage=null,deliver=true}={}){
 if(!interviewEnabled(store,env))return null;
 const cov=coverage??await readCoverage(store,owner,{log});
 let plan=null;
 const {written,state}=await update(store,owner,state=>{
  const batch=batchOf(state);
  // A decline ends the open round quietly; the import summary it was holding back can follow.
  plan=state.declined_at&&batch&&!batch.closed_at?{close:'declined'}:planNext(cov,state);
  if(!plan)return null;
  // Nothing was asked this round (no gaps left): close it without a "got it".
  if(plan.close==='done'&&!asked(state).some(a=>a.batch===batch.n))plan={close:'empty'};
  if(plan.close&&!deliver)return null;
  if(plan.close){batch.closed_at=new Date().toISOString();batch.close=plan.close;return state;}
  state.asked.push({qid:plan.qid,batch:batch.n,dimensions:plan.dimensions,text:plan.text,sent_at:new Date().toISOString(),outcome:null});
  return state;
 });
 if(!deliver&&plan?.close)return {deferred:true};
 if(!written||!plan)return null;
 const batch=batchOf(state);
 if(plan.close){
  const close=`interview:${owner}:close:${batch.n}`;
  let result={status:'not_sent'};
  if(batch.trigger==='import'){
   // The import's summary waited for the round: it goes first (the early read when coverage is thin),
   // then the offer of more questions. A plain "got it" only when no summary could be sent.
   const summary=await import('./receipt-notifications.js').then(m=>m.sendProfile(store,owner,env,send)).catch(()=>{log(JSON.stringify({event:'interview_profile_failed'}));return null;});
   if(plan.close==='more'||plan.close==='done'&&summary?.status!=='sent')result=await deliverText(store,owner,env,close,CLOSE[plan.close],send);
  }else if(CLOSE[plan.close]){
   // Outside an import the round ends with the early read, when there is something honest to say.
   const early=await import('./early-read.js').then(m=>m.earlyReadFor(store,owner,env,{log})).catch(()=>null);
   const body=early?(plan.close==='more'?early.text+'\n\n'+CLOSE.more:early.text):CLOSE[plan.close];
   result=await deliverText(store,owner,env,close,body,send);
   if(early)log(JSON.stringify({event:'early_read_sent',batch:batch.n,level:early.level,sources:early.sources,status:result.status}));
  }
  log(JSON.stringify({event:'interview_closed',batch:batch.n,close:plan.close,level:cov.level,status:result.status}));
  return {close:plan.close,...result};
 }
 if(!deliver){
  log(JSON.stringify({event:'interview_question_sent',question:plan.qid,batch:batch.n,trigger:batch.trigger,level:cov.level,status:'joined'}));
  return {question:plan.qid,text:plan.text,status:'joined'};
 }
 const result=await deliverText(store,owner,env,`interview:${owner}:${plan.qid}`,plan.text,send).catch(error=>({status:'failed',error}));
 log(JSON.stringify({event:'interview_question_sent',question:plan.qid,batch:batch.n,trigger:batch.trigger,level:cov.level,status:result.status}));
 if(result.status==='failed'||result.status==='blocked'){
  // Not delivered: the question is closed, so the round does not wait on an answer that cannot come.
  await update(store,owner,s=>{const a=asked(s).find(x=>x.qid===plan.qid&&!x.outcome);if(!a)return null;a.outcome='unsent';return s;}).catch(()=>{});
 }
 return {question:plan.qid,...result};
}

const fold=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
// The person's answer to a question Jules asked, as evidence: the question kept with the reply.
export function statedAnswerEvidence(entry,{messageId,outcome,quote=null,at}){
 return {id:`interview:${messageId}:${entry.qid}`,kind:'stated_answer',origin:'interview',recorded_by:'user',
  source:{type:'message',id:messageId,question_id:entry.qid},
  data:{question:entry.text,dimensions:entry.dimensions,outcome,answer_quote:quote,at}};
}

// Records the agent's reading of a reply to an interview question. Code checks the question was
// asked and the quote is in the message; it does not decide what the reply means.
// Returns {ok, body, next}: next is true when the following question should go out after the reply.
export async function recordAnswer(store,owner,{questionId,outcome,messageId,messageText='',quote=null,log=console.log}){
 if(!OUTCOMES.includes(outcome))return {ok:false,body:'Unknown outcome.',next:false};
 const at=new Date().toISOString(),checked=quote&&fold(messageText).includes(fold(quote))?String(quote).trim().slice(0,300):null;
 let entry=null,replay=false;
 const {written}=await update(store,owner,state=>{
  entry=asked(state).find(a=>a.qid===questionId)??null;
  if(!entry)return null;
  if(entry.message_id===messageId&&entry.outcome===outcome){replay=true;return null;}
  entry.outcome=outcome;entry.answered_at=at;entry.message_id=messageId;
  if(outcome==='declined_interview')state.declined_at=at;
  if(outcome==='changed_topic')state.paused_at=at;
  return state;
 });
 if(!entry)return {ok:false,body:`Jules did not ask the question ${questionId}. Use a question_id from style_interview.asked, or do not call this tool.`,next:false};
 if(written)await store.recordEvidence(owner,[statedAnswerEvidence(entry,{messageId,outcome,quote:checked,at})]);
 log(JSON.stringify({event:'interview_answer',question:questionId,outcome,quoted:Boolean(checked),replay}));
 const body=outcome==='declined_interview'?'Recorded: Jules will not send more style questions unless the user asks for them.'
  :outcome==='changed_topic'?'Recorded: the style questions are paused. Help with what they asked for now; do not repeat the question.'
  :INTERVIEW_ACK;
 return {ok:true,body,next:CONTINUES.includes(outcome)&&!replay};
}

// The owner's "Ask style questions" button (Admin › People). Says plainly why nothing was sent: the
// feature is off, the person said no to more questions, a question is still waiting for their reply,
// or there is nothing left to ask. Otherwise the next question goes out as it would on request.
export async function adminStartInterview(store,owner,env,{send=sendGreeting,log=console.log}={}){
 if(!interviewEnabled(store,env))return {status:'off'};
 const {state}=await store.interview(owner),w=waiting(state);
 if(state.declined_at)return {status:'declined',at:state.declined_at};
 if(w&&!state.paused_at)return {status:'waiting',question:w.qid,asked_at:w.sent_at};
 if(!await questionsLeft(store,owner,{log}))return {status:'nothing_left'};
 // A question left hanging by a topic change no longer holds the round.
 if(w)await update(store,owner,s=>{for(const a of asked(s))if(!a.outcome)a.outcome='unanswered';return s;});
 const result=await startInterview(store,owner,env,'admin',{send,log});
 log(JSON.stringify({event:'interview_admin_start',status:result?.status??'not_sent',question:result?.question??null}));
 return result?.question?{status:result.status,question:result.question}:{status:'not_sent'};
}
// What the chat agent sees: the questions asked, which one is waiting, and whether it stopped.
// Whether a request to be asked questions would find any: used to answer "ask me" honestly.
export async function questionsLeft(store,owner,{log=console.log}={}){
 const [cov,{state}]=await Promise.all([readCoverage(store,owner,{log}),store.interview(owner)]);
 return candidates(cov,{...state,batches:[...(state.batches??[]),{n:(batchOf(state)?.n??0)+1}]}).length;
}
export function interviewContext(state){
 if(!batchOf(state??{}))return null;
 const w=waiting(state);
 return {asked:asked(state).slice(-8).map(a=>({question_id:a.qid,text:a.text,asked_at:a.sent_at,outcome:a.outcome})),
  waiting_for:w?.qid??null,declined:Boolean(state.declined_at),paused:Boolean(state.paused_at),round_open:interviewOpen(state)};
}

// What the agent writes when a style question follows its message (October 20: "i just sent you the first
// question" before it was sent, and "ready to keep going whenever you are" right before the next one).
// The inbox adds the question to the end of the same text, so the agent writes only what leads into it.
export const INTERVIEW_LEAD_IN='Jules adds its next style question to the end of your message, in the same text. Write only a short lead-in of a few words that fits what they said (for a request to talk about their style, something like "sure, let\'s talk about your style"). Do not ask a question yourself, do not say a question was sent or is coming, and do not ask whether they want to continue.';
export const INTERVIEW_ACK='Recorded. Jules sends the next style question (or, at the end of a round, the offer of more) itself, with or right after your message. Acknowledge their answer in a few words. Do not ask a question, do not say more is coming, and do not say you are ready whenever they are.';
// Agent skill. The chat model decides whether the newest message responds to an interview question
// (including skipping it, declining more, or moving on to something else) or asks to be asked.
export const STYLE_INTERVIEW_TOOL={type:'function',name:'style_interview',strict:true,
 description:'Jules\'s short style questions (style_interview in context). answer: the newest message responds to one of the questions Jules asked, by answering it, answering part of it, skipping it, declining more questions, or ignoring it to talk about something else. start: the user asks Jules to get to know their style, ask its questions, or ask the rest of them. It does not save facts: also call update_profile for lasting facts the user states, add_outfit_photos for photos of their own outfits, and add_liked_items for screenshots of things they liked.',
 parameters:{type:'object',additionalProperties:false,required:['action','question_id','outcome','quote'],properties:{
  action:{type:'string',enum:['answer','start']},
  question_id:{type:['string','null'],description:'answer: the question_id from style_interview.asked that the message responds to. When the message replies to an older question, use that question, not the newest one. null for start.'},
  outcome:{type:['string','null'],enum:[...OUTCOMES,null],description:'answer: answered (it answers the question), partial (answers some of it, or says they can\'t, e.g. no outfit photos), skipped (passes on this one question), declined_interview (does not want more questions), changed_topic (moves on to another request without answering). null for start.'},
  quote:{type:['string','null'],description:'answer: the exact words from the newest message that answer the question, or null.'}}}};
export const STYLE_INTERVIEW_GUIDE='\nSTYLE QUESTIONS: Jules texts short questions to learn the user\'s taste; style_interview.asked lists them and waiting_for is the one still open. When waiting_for is set, the newest message is almost always a reply to it, whatever it says: call style_interview once with action answer, that question_id (or the older question the message replies to) and the outcome. That includes a refusal or "not now" (declined_interview), passing on just this question (skipped), saying they can\'t answer it, e.g. no outfit photos (partial), and moving on to a different request (changed_topic, plus the tool for that request). In the same turn, save lasting facts the user states about themselves with update_profile (sizes, colors, fits, stores, a usual budget) and keep photos or screenshots with their tools. A refusal, a skip or a non-answer is not a fact: never save it with update_profile. Facts about someone else (a gift, a friend\'s style) are not the user\'s: do not save them to the user\'s profile. Code adds the next question to the end of your message (or sends it right after): never write it yourself, never say it was sent or is coming, and never sign off as if the questions were over ("ready whenever you are"); keep your message to a short lead-in. When the user asks to be asked questions or to continue them, call style_interview with action start.';
