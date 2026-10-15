import {sealToken,openToken} from './gmail-client.js';
import {sourceEvidence} from './receipt-extraction.js';
import {extractBatch,refreshQuestions} from './purchase-sources.js';
import {SHOP_SOURCE} from './shop-orders.js';
import {mediaCounts} from './order-media.js';
import {orderPhotoEvidence,photoItems} from './order-photos.js';

// Connected purchase-history sources: services the user signs in to (Shop today; other MCP or API
// order histories later). An adapter supplies only what differs per service:
//   name, origin, source_type, label, consent, enabled(env), instructions (extraction prompt),
//   start(fetcher) -> {secret, user_code, verification_url, interval, expires_at}   (device sign-in)
//   poll(secret, fetcher) -> {status: pending|slow_down|approved|denied|expired|failed, credential}
//   list(credential, {fetcher, from, limit, stores}) -> {records: [{id, date, text, kind?, summary?}], listing}  (auth_required on a rejected credential)
//   match_window_days (optional): link to another source's item from the same store within this window
// Everything else (sealed credentials, a resumable queue, extraction, evidence, questions, status) is
// shared here. Records share the purchase-history row and lease with Gmail, so a source never
// duplicates an item another source already found. Adding a source: write its adapter, register it
// below, and add its origin to evidence_origins (see db/022_history_sources.sql).
export const CONNECTED_SOURCES=Object.fromEntries([SHOP_SOURCE].map(s=>[s.name,s]));
// Order screenshots sent in chat (lib/order-screenshots.js) are a history source without a connection.
export const SCREENSHOT_ORIGIN='chat_screenshot';
export const HISTORY_ORIGINS=['gmail',...Object.values(CONNECTED_SOURCES).map(s=>s.origin),SCREENSHOT_ORIGIN];
export const CONNECTION_ACTIONS=['connect','poll','import','reread','step','disconnect'];
export const BATCH=6,ATTEMPTS=2,LIMIT=100,YEARS=5;

export const enabledSources=env=>Object.values(CONNECTED_SOURCES).filter(s=>s.enabled(env));
// Background work (lib/gmail-worker.js). A source waiting for the user's approval is polled at the
// service's interval; a source with a queue is read in steps. Approval that hasn't come after this
// long no longer holds back the completion text: Jules texts what the other sources found.
export const APPROVAL_CUTOFF_MS=10*60000;
const WORKING=['awaiting_approval','extracting'];
export const sourceActive=c=>WORKING.includes(c?.status);
export const sourcesActive=data=>Object.values(data?.connections??{}).some(sourceActive);
// The next source action due now ({source, action}), else how long until a poll is due ({delay}), else null.
export function nextSourceWork(data,now=Date.now()){
 let delay=null;
 for(const source of Object.values(CONNECTED_SOURCES)){
  const c=data?.connections?.[source.name];
  if(c?.status==='extracting')return {source,action:'step'};
  if(c?.status==='awaiting_approval'){
   const due=(c.pending?.polled_at??0)+(c.pending?.interval??5)*1000-now;
   if(due<=0)return {source,action:'poll'};
   delay=Math.min(delay??due,due);
  }
 }
 return delay===null?null:{delay};
}
// True once no source holds back the completion text: none reading, none waiting for approval
// for less than APPROVAL_CUTOFF_MS.
export function sourcesSettled(data,now=Date.now()){
 return Object.values(data?.connections??{}).every(c=>c?.status!=='extracting'&&!(c?.status==='awaiting_approval'&&now-Date.parse(c.pending?.started_at??0)<APPROVAL_CUTOFF_MS));
}
export function publicConnection(c){
 // Result counts for the last import, from per-record outcomes: purchases found, how many matched an
 // item another source already had, and the date range of what the service shared.
 const reads=c?.reads??[],dates=reads.map(r=>r.date).filter(Number.isFinite);
 return {status:c?.status??'not_connected',connected:Boolean(c?.credential),user_code:c?.pending?.user_code??null,verification_url:c?.pending?.verification_url??null,
  interval:c?.pending?.interval??5,queued:c?.queue?.length??0,processed:c?.processed??0,found:c?.found??0,imported_at:c?.imported_at??null,error:c?.error??null,
  purchases:reads.reduce((n,r)=>n+(r.purchases??0),0),linked:reads.reduce((n,r)=>n+(r.linked??0),0),
  oldest:dates.length?new Date(Math.min(...dates)).toISOString():null,newest:dates.length?new Date(Math.max(...dates)).toISOString():null};
}
// stores: merchants already in purchase history, which a service may need to search by name.
async function list(source,c,owner,env,fetcher,stores=[]){
 const from=new Date();from.setUTCFullYear(from.getUTCFullYear()-YEARS);
 try{
  const listed=await source.list(openToken(c.credential,owner,env),{fetcher,from:from.toISOString().slice(0,10),limit:LIMIT,stores});
  const seen=new Set(c.seen??[]),records=listed.records.filter(Boolean),queue=records.filter(r=>!seen.has(r.id));
  // What the service returned, page by page, so a short history can be explained.
  console.log(JSON.stringify({event:'connected_source_listed',source:source.name,records:records.length,new:queue.length,stop:listed.listing?.stop??null}));
  return {...c,status:queue.length?'extracting':'ready',queue,found:records.length,processed:0,error:null,imported_at:new Date().toISOString(),listing:listed.listing??null};
 }catch(error){
  // A rejected credential is not retried: the user approves the connection again.
  if(error.code==='auth_required')return {...c,credential:null,status:'reconnect',error:`${source.label} access expired. Connect ${source.label} again to import.`};
  console.log(JSON.stringify({event:'connected_source_list_failed',source:source.name,code:error.code??'failed'}));
  return {...c,status:'connected',error:`Couldn’t read your ${source.label} history. Try importing again.`};
 }
}
// One bounded action for one source. Returns the row data, receipt state and evidence to persist
// together; the caller holds the purchase-history lease.
// clear_origin in the result asks the caller to delete this source's earlier evidence (a re-read).
export async function connectionAction(source,action,{data,state,pending,owner,env,fetcher=fetch,interpret,profile=async()=>[]}){
 let c=structuredClone(data.connections?.[source.name]??{});let records=[],photos=[],clear_origin=null;
 // Stores this source already returned, most frequent first. Stores known only from other sources
 // (such as Gmail) are not sent to the service: its consent covers reading its own records.
 const own=i=>i.source_ids.some(id=>String(id).startsWith(source.name+':'));
 const counts=state.items.filter(own).reduce((m,i)=>{const k=i.merchant;if(k)m.set(k,(m.get(k)??0)+1);return m;},new Map());
 const stores=[...counts].sort((a,b)=>b[1]-a[1]).map(([name])=>name);
 if(action==='connect'){
  const started=await source.start(fetcher);
  // The sign-in secret is sealed at rest and never returned to the browser.
  c={...c,status:'awaiting_approval',error:null,consent:{version:source.consent,at:new Date().toISOString()},
   pending:{secret:sealToken(started.secret,owner,env),user_code:started.user_code,verification_url:started.verification_url,interval:started.interval,expires_at:started.expires_at,started_at:new Date().toISOString()}};
 }else if(action==='poll'){
  const p=c.pending;if(!p)throw Error('No sign-in in progress');
  const outcome=Date.now()>p.expires_at?{status:'expired'}:await source.poll(openToken(p.secret,owner,env),fetcher);
  if(['pending','slow_down'].includes(outcome.status))c.pending={...p,polled_at:Date.now(),...(outcome.status==='slow_down'?{interval:p.interval+5}:{})};
  else if(outcome.status==='approved'){delete c.pending;c=await list(source,{...c,credential:sealToken(outcome.credential,owner,env)},owner,env,fetcher,stores);}
  else if(outcome.status!=='pending'){delete c.pending;c={...c,status:'not_connected',error:outcome.status==='denied'?`${source.label} sign-in was declined.`:`The ${source.label} sign-in code expired. Connect again.`};}
 }else if(action==='import'){
  if(!c.credential)throw Error('Connect first');
  c=await list(source,c,owner,env,fetcher,stores);
 }else if(action==='reread'){
  // Reads every record again with the current reading rules, replacing this source's earlier results.
  if(!c.credential)throw Error('Connect first');
  c=await list(source,{...c,seen:[],reads:[],withheld:0,failed:0},owner,env,fetcher,stores);
  if(c.status!=='reconnect'&&!c.error)clear_origin=source.origin;
 }else if(action==='disconnect'){
  c={seen:c.seen??[],reads:c.reads??[],listing:c.listing??null,status:'not_connected',error:null};
 }else if(action==='step'&&c.status==='extracting'){
  const batch=(c.queue??[]).slice(0,BATCH);
  const before=photoItems(state);
  const read=await extractBatch(state,pending,batch,{interpret,instructions:source.instructions,log:source.name,matchWindowDays:source.match_window_days??0});
  ({state,pending}=read);records=read.records;c.withheld=(c.withheld??0)+read.withheld_events;
  photos=await orderPhotoEvidence(before,state,{origin:source.origin,source_type:source.source_type,fetcher,log:source.name});
  const done=new Set();
  for(const outcome of read.outcomes){
   const record=batch.find(r=>r.id===outcome.id);
   // A short per-record outcome for admin review; the record text itself is not kept.
   const note=status=>({id:record.id,kind:record.kind??null,date:record.date??null,summary:record.summary??null,status,purchases:outcome.records??0,linked:outcome.linked??0,withheld:outcome.withheld??0});
   if(outcome.status==='done'){done.add(record.id);c.reads=[...(c.reads??[]).filter(r=>r.id!==record.id),note('read')].slice(-300);continue;}
   record.attempts=(record.attempts??0)+1;
   if(record.attempts>=ATTEMPTS){done.add(record.id);c.failed=(c.failed??0)+1;c.reads=[...(c.reads??[]).filter(r=>r.id!==record.id),note('failed')].slice(-300);}
   console.log(JSON.stringify({event:'connected_source_record_failed',source:source.name,attempt:record.attempts}));
  }
  c.queue=c.queue.filter(r=>!done.has(r.id));
  c.seen=[...new Set([...(c.seen??[]),...done])];c.processed=(c.processed??0)+done.size;
  if(!c.queue.length){const asked=await refreshQuestions(state,pending,{interpret,profile:await profile(),reason:`${source.label} history was just imported.`,log:source.name});state=asked.state;c.questions_failed=asked.failed;c.status='ready';console.log(JSON.stringify({event:source.name+'_order_media',...mediaCounts(state)}));}
 }
 const model='model:'+(env.OPENAI_MODEL||'gpt-4.1-mini');
 return {data:{...data,connections:{...data.connections,[source.name]:c}},state,pending,clear_origin,evidence:[...records.map(r=>sourceEvidence(source.origin,source.source_type,r,model)),...photos]};
}
