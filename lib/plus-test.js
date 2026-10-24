// Jules+ fake-door test (/plus, db/053, PLUS-TEST.md): counts who opens the page and who taps Get Jules+.
// Nothing is sold or charged. Rows hold the signed-in tester's conversation (or none), the price shown and
// the kind only. Best effort like every adoption event: before the migration runs (or if a write fails) it logs.
import {personAgent} from './report-events.js';

// The monthly price the page shows, in dollars. Change it here and in public/plus.html together (tested).
export const PLUS_PRICE=7;
export const PLUS_EVENTS={view:'plus_viewed',interest:'plus_interest'};
const DAY_MS=24*60*60*1000,EVER='1970-01-01T00:00:00.000Z';

// owner: the signed-in tester's conversation, or null. A tester's view counts once a day and their tap once;
// a signed-out browser makes the same promise from its own storage (public/plus.js). Bots and previews are left out.
export async function recordPlusEvent(store,{owner=null,event,agent=''},now=()=>new Date()){
 const kind=PLUS_EVENTS[event];
 if(!kind||!personAgent(agent)||!store?.recordAdoptionEvent)return {recorded:false};
 const ref=String(PLUS_PRICE);
 try{
  if(owner&&await store.hasAdoptionEvent({conversation_id:owner,kind,ref,since:kind==='plus_viewed'?new Date(now().getTime()-DAY_MS).toISOString():EVER}))return {recorded:false};
  await store.recordAdoptionEvent({conversation_id:owner,kind,ref,quantity:1});
  return {recorded:true};
 }catch(error){console.log(JSON.stringify({event:'plus_event_failed',kind,signed_in:Boolean(owner),status:error?.database_status??null}));return {recorded:false};}
}
