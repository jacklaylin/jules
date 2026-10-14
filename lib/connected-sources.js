import {sealToken,openToken} from './gmail-client.js';
import {sourceEvidence} from './receipt-extraction.js';
import {extractBatch,refreshQuestions} from './purchase-sources.js';
import {SHOP_SOURCE} from './shop-orders.js';

// Connected purchase-history sources: services the user signs in to (Shop today; other MCP or API
// order histories later). An adapter supplies only what differs per service:
//   name, origin, source_type, label, consent, enabled(env), instructions (extraction prompt),
//   start(fetcher) -> {secret, user_code, verification_url, interval, expires_at}   (device sign-in)
//   poll(secret, fetcher) -> {status: pending|slow_down|approved|denied|expired|failed, credential}
//   list(credential, {fetcher, from}) -> prepared records [{id, date, text}]  (auth_required on a rejected credential)
// Everything else (sealed credentials, a resumable queue, extraction, evidence, questions, status) is
// shared here. Records share the purchase-history row and lease with Gmail, so a source never
// duplicates an item another source already found. Adding a source: write its adapter, register it
// below, and add its origin to evidence_origins (see db/022_history_sources.sql).
export const CONNECTED_SOURCES=Object.fromEntries([SHOP_SOURCE].map(s=>[s.name,s]));
export const HISTORY_ORIGINS=['gmail',...Object.values(CONNECTED_SOURCES).map(s=>s.origin)];
export const CONNECTION_ACTIONS=['connect','poll','import','step','disconnect'];
export const BATCH=6,ATTEMPTS=2,LIMIT=100,YEARS=5;

export const enabledSources=env=>Object.values(CONNECTED_SOURCES).filter(s=>s.enabled(env));
export function publicConnection(c){
 return {status:c?.status??'not_connected',connected:Boolean(c?.credential),user_code:c?.pending?.user_code??null,verification_url:c?.pending?.verification_url??null,
  interval:c?.pending?.interval??5,queued:c?.queue?.length??0,processed:c?.processed??0,found:c?.found??0,imported_at:c?.imported_at??null,error:c?.error??null};
}
async function list(source,c,owner,env,fetcher){
 const from=new Date();from.setUTCFullYear(from.getUTCFullYear()-YEARS);
 try{
  const seen=new Set(c.seen??[]),records=(await source.list(openToken(c.credential,owner,env),{fetcher,from:from.toISOString().slice(0,10),limit:LIMIT})).filter(Boolean);
  const queue=records.filter(r=>!seen.has(r.id));
  return {...c,status:queue.length?'extracting':'ready',queue,found:records.length,processed:0,error:null,imported_at:new Date().toISOString()};
 }catch(error){
  // A rejected credential is not retried: the user approves the connection again.
  if(error.code==='auth_required')return {...c,credential:null,status:'reconnect',error:`${source.label} access expired. Connect ${source.label} again to import.`};
  console.log(JSON.stringify({event:'connected_source_list_failed',source:source.name,code:error.code??'failed'}));
  return {...c,status:'connected',error:`Couldn’t read your ${source.label} history. Try importing again.`};
 }
}
// One bounded action for one source. Returns the row data, receipt state and evidence to persist
// together; the caller holds the purchase-history lease.
export async function connectionAction(source,action,{data,state,pending,owner,env,fetcher=fetch,interpret,profile=async()=>[]}){
 let c=structuredClone(data.connections?.[source.name]??{});let records=[];
 if(action==='connect'){
  const started=await source.start(fetcher);
  // The sign-in secret is sealed at rest and never returned to the browser.
  c={...c,status:'awaiting_approval',error:null,consent:{version:source.consent,at:new Date().toISOString()},
   pending:{secret:sealToken(started.secret,owner,env),user_code:started.user_code,verification_url:started.verification_url,interval:started.interval,expires_at:started.expires_at}};
 }else if(action==='poll'){
  const p=c.pending;if(!p)throw Error('No sign-in in progress');
  const outcome=Date.now()>p.expires_at?{status:'expired'}:await source.poll(openToken(p.secret,owner,env),fetcher);
  if(outcome.status==='slow_down')c.pending={...p,interval:p.interval+5};
  else if(outcome.status==='approved'){delete c.pending;c=await list(source,{...c,credential:sealToken(outcome.credential,owner,env)},owner,env,fetcher);}
  else if(outcome.status!=='pending'){delete c.pending;c={...c,status:'not_connected',error:outcome.status==='denied'?`${source.label} sign-in was declined.`:`The ${source.label} sign-in code expired. Connect again.`};}
 }else if(action==='import'){
  if(!c.credential)throw Error('Connect first');
  c=await list(source,c,owner,env,fetcher);
 }else if(action==='disconnect'){
  c={seen:c.seen??[],status:'not_connected',error:null};
 }else if(action==='step'&&c.status==='extracting'){
  const batch=(c.queue??[]).slice(0,BATCH);
  const read=await extractBatch(state,pending,batch,{interpret,instructions:source.instructions,log:source.name});
  ({state,pending}=read);records=read.records;c.withheld=(c.withheld??0)+read.withheld_events;
  const done=new Set();
  for(const outcome of read.outcomes){
   const record=batch.find(r=>r.id===outcome.id);
   if(outcome.status==='done'){done.add(record.id);continue;}
   record.attempts=(record.attempts??0)+1;
   if(record.attempts>=ATTEMPTS){done.add(record.id);c.failed=(c.failed??0)+1;}
   console.log(JSON.stringify({event:'connected_source_record_failed',source:source.name,attempt:record.attempts}));
  }
  c.queue=c.queue.filter(r=>!done.has(r.id));
  c.seen=[...new Set([...(c.seen??[]),...done])];c.processed=(c.processed??0)+done.size;
  if(!c.queue.length){const asked=await refreshQuestions(state,pending,{interpret,profile:await profile(),reason:`${source.label} history was just imported.`,log:source.name});state=asked.state;c.questions_failed=asked.failed;c.status='ready';}
 }
 const model='model:'+(env.OPENAI_MODEL||'gpt-4.1-mini');
 return {data:{...data,connections:{...data.connections,[source.name]:c}},state,pending,evidence:records.map(r=>sourceEvidence(source.origin,source.source_type,r,model))};
}
