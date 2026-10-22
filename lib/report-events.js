// Style report engagement (db/049, Admin › Adoption): the person opening their own report, sharing it,
// and friends opening the share link. Rows hold the owner's conversation, the report id and a fixed
// channel only: no viewer identity, link or text. Best effort like every adoption event: before the
// migration runs (or if a write fails) it logs and the page works as before.
import {recordAdoptionEvent} from './adoption-events.js';

export const SHARE_CHANNELS=['story','download','copy','share_sheet'];
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
export async function recordReportShared(store,owner,report,channel){
 if(!report?.id||!SHARE_CHANNELS.includes(channel))return;
 await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_shared',ref:report.id,detail:channel});
}

// Someone opened a share link, credited to the person who shared it. The page asks to count only a
// browser's first open of that link (and never the owner's own browser or a Story-image render);
// preview fetchers and bots are left out here.
export async function recordShareOpened(store,owner,report,{first=false,agent=''}={}){
 if(!first||!personAgent(agent)||!report?.id)return;
 await recordAdoptionEvent(store,{conversation_id:owner,kind:'report_share_opened',ref:report.id});
}
