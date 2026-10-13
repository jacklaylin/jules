// Measures Gmail import accuracy against emails the founder labeled by hand. Private data stays
// local: Gmail is read with the stored read-only token and nothing is sent anywhere else.
//   template OUTPUT  lists emails carrying the Gmail label "jules-eval" into a private file to fill in
//   score LABELS     compares the filled file with what the last import stored
// Keep OUTPUT/LABELS outside the repository (e.g. ~/jules-private/receipt-labels.json).
import {readFile,writeFile} from 'node:fs/promises';
import {createStore} from '../lib/store.js';
import {openToken,accessToken,gmailGet} from '../lib/gmail-client.js';
import {loadReceipts} from '../lib/evidence.js';
import {triageCandidate} from '../lib/receipt-email.js';

const [command,path]=process.argv.slice(2),env=process.env,conversation=env.EVAL_CONVERSATION_ID;
if(!['template','score'].includes(command)||!path||!conversation)throw Error('Use EVAL_CONVERSATION_ID=<id> node --env-file=<private env file> scripts/receipt-eval.js template|score <private file outside the repository>');
const store=createStore(env),row=await store.gmailImport(conversation);
if(!row)throw Error('No Gmail import for this conversation');

if(command==='template'){
 const tokens=await accessToken(openToken(row.token_ciphertext,conversation,env),env);
 const ids=[];let page=null;
 do{const result=await gmailGet('messages?'+new URLSearchParams({q:'label:jules-eval',maxResults:'100',...(page?{pageToken:page}:{})}),tokens);ids.push(...(result.messages??[]).map(m=>m.id));page=result.nextPageToken;}while(page&&ids.length<300);
 const emails=[];
 for(const id of ids){const m=triageCandidate({...await gmailGet('messages/'+id+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject',tokens),id});
  emails.push({gmail_id:id,subject:m.subject,from:m.from_name,date:m.date?new Date(m.date).toISOString().slice(0,10):null,
   expected:[{kind:'purchased',merchant:null,brand:null,product:null,size_label:null,color:null,order_reference:null,recipient:'unknown'}]});}
 await writeFile(path,JSON.stringify({instructions:'For each email list every clothing/footwear/accessory event (purchased, shipped, return_requested, returned, cancelled, refunded). Use expected: [] for emails with no such event. recipient is self, other or unknown.',emails},null,1),{flag:'wx'});
 console.log(`Wrote ${emails.length} labeled emails. Fill in "expected", then run score.`);
}else{
 const {emails}=JSON.parse(await readFile(path,'utf8'));
 const {state}=await loadReceipts(store,conversation,row),evidence=await store.evidence(conversation,'gmail');
 const job=row.data.job??{},scanned=new Set(row.data.scanned_ids??[]),sources=new Set((row.data.sources??[]).map(s=>s.id));
 const norm=v=>v==null?null:String(v).toLowerCase().replace(/\s+/g,' ').trim();
 const fields=['merchant','brand','product','size_label','color','order_reference'];
 const tally={emails:emails.length,not_retrieved:0,retrieved_no_evidence:0,false_positive_emails:0,expected_events:0,found_events:0,matched_events:0,fields:Object.fromEntries([...fields,'recipient'].map(f=>[f,{right:0,wrong:0,missing:0}]))},misses=[];
 for(const email of emails){
  const records=evidence.filter(r=>r.kind==='purchase_event'&&r.data.source_id===email.gmail_id).map(r=>r.data);
  const retrieved=(job.ids??[]).includes(email.gmail_id)||scanned.has(email.gmail_id)||sources.has(email.gmail_id);
  tally.expected_events+=email.expected.length;tally.found_events+=records.length;
  if(!email.expected.length){if(records.length)tally.false_positive_emails++;continue;}
  if(!retrieved){tally.not_retrieved++;misses.push({gmail_id:email.gmail_id,subject:email.subject,stage:'not retrieved by search'});continue;}
  if(!records.length){tally.retrieved_no_evidence++;misses.push({gmail_id:email.gmail_id,subject:email.subject,stage:scanned.has(email.gmail_id)?'skipped by triage or no events extracted':'no events extracted'});continue;}
  const open=[...records];
  for(const expected of email.expected){
   const score=r=>r.kind===expected.kind?1+fields.filter(f=>expected[f]!=null&&norm(r.values[f])===norm(expected[f])).length:0;
   const best=open.sort((a,b)=>score(b)-score(a))[0];
   if(!best||!score(best)){misses.push({gmail_id:email.gmail_id,subject:email.subject,stage:'event not extracted',expected});continue;}
   open.splice(open.indexOf(best),1);tally.matched_events++;
   for(const f of fields){if(expected[f]==null)continue;const got=best.values[f];tally.fields[f][got==null?'missing':norm(got)===norm(expected[f])?'right':'wrong']++;}
   const item=state.items.find(i=>i.id===best.item_id),recipient=['self','other'].includes(item?.recipient_evidence?.value)?item.recipient_evidence.value:'unknown';
   if(expected.recipient&&expected.recipient!=='unknown')tally.fields.recipient[recipient==='unknown'?'missing':recipient===expected.recipient?'right':'wrong']++;
  }
 }
 const rate=(a,b)=>b?Math.round(100*a/b)+'%':'n/a';
 console.log(JSON.stringify({summary:{event_recall:rate(tally.matched_events,tally.expected_events),event_precision:rate(tally.matched_events,tally.found_events),...tally,
  field_accuracy:Object.fromEntries(Object.entries(tally.fields).map(([f,t])=>[f,rate(t.right,t.right+t.wrong+t.missing)]))},
  import_quality:job.quality??null,misses},null,1));
}
