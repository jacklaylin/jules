// Style report engagement (db/049, db/050; Admin › Style report): the person opening their own report, sharing it,
// and friends opening the share link. Rows hold the owner's conversation, the report id and a fixed
// channel only: no viewer identity, link or text. Best effort like every adoption event: before the
// migration runs (or if a write fails) it logs and the page works as before.
import {recordAdoptionEvent} from './adoption-events.js';

export const SHARE_CHANNELS=['story','download','copy','share_sheet'];
// The cards a person can reach and share (locked cards are neither).
export const REPORT_CARDS=['receipt','gatekeeper','inout','emoji','spectrum','match','read','judges'];
const EVER='1970-01-01T00:00:00.000Z';
const DAY_MS=24*60*60*1000;
// Link-preview fetchers, crawlers and the headless browser that renders Story images open links without a person.
const NOT_A_PERSON=/bot|crawler|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|node-fetch|axios/i;
export const personAgent=agent=>Boolean(agent)&&!NOT_A_PERSON.test(agent);

// The owner opened their report: at most once per report a day, so reloads and tapping back in don't count twice.
export async function recordReportViewed(store,owner,report,now=()=>new Date()){
 if(!report?.id||!store?.hasAdoptionEvent)return;
 try{
  if(await store.hasAdoptionEvent({conversation_id:owner,kind:'report_viewed',ref:report.id,since:new Date(now().getTime()-DAY_MS).toISOString()}))return;
 }catch(error){return console.log(JSON.stringify({event:'adoption_event_failed',kind:'report_viewed',status:error?.database_status??null}));}
 await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_viewed',ref:report.id});
}

// The owner shared, copied or downloaded their report. Every share counts.
// A Story share or download also says which cards' images went with it, one row per card in this report.
export async function recordReportShared(store,owner,report,channel,cards=[]){
 if(!report?.id||!SHARE_CHANNELS.includes(channel))return;
 await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_shared',ref:report.id,detail:channel});
 if(!['story','download'].includes(channel))return;
 const inReport=new Set(report.cards?.map(c=>c.type));
 for(const card of new Set(Array.isArray(cards)?cards:[]))if(REPORT_CARDS.includes(card)&&inReport.has(card))
  await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_card_shared',ref:report.id,detail:card});
}

// The owner reached a card: once per card per report, however often they come back to it.
export async function recordCardViewed(store,owner,report,card){
 if(!report?.id||!REPORT_CARDS.includes(card)||!report.cards?.some(c=>c.type===card)||!store?.hasAdoptionEvent)return;
 const ref=`${report.id}:${card}`;
 try{if(await store.hasAdoptionEvent({conversation_id:owner,kind:'report_card_viewed',ref,since:EVER}))return;}
 catch(error){return console.log(JSON.stringify({event:'adoption_event_failed',kind:'report_card_viewed',status:error?.database_status??null}));}
 await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_card_viewed',ref,detail:card});
}

// Someone opened a share link, credited to the person who shared it. The page asks to count only a
// browser's first open of that link (and never the owner's own browser or a Story-image render);
// preview fetchers and bots are left out here.
// via: how the link was shared (it rides on the link as ?via=), when it says.
export async function recordShareOpened(store,owner,report,{first=false,agent='',via=null}={}){
 if(!first||!personAgent(agent)||!report?.id)return;
 await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_share_opened',ref:report.id,...(SHARE_CHANNELS.includes(via)?{detail:via}:{})});
}
