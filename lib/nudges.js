// Shared rules for every text Jules sends that nobody asked for (PRD "Proactive nudges", founder decision
// October 21): the "goes with your new purchase" offer and the fit check today, and any later nudge.
// - At most one a day (the person's local day) and three in any 7 days.
// - Never on a day a price alert or return reminder went out. Price alerts themselves are never held: the person asked
//   for them; return reminders follow their own rules (lib/return-windows.js).
// - Only 9am–8pm in the person's time zone; with no known time zone, only noon–8pm US Eastern (daytime
//   across the US).
// - Never after STOP, and never while texts about purchases are turned off in chat.
// - Back off when ignored: after 2 nudges in a row with no reply within 2 days, none for 14 days. Any
//   message from the person resets it. There is never a follow-up text to an unanswered nudge.
// Every decision is logged (event `nudge`) and kept on the person's history row (data.nudges.log).

export const LIMITS={day:1,week:3};
export const BACKOFF={ignored:2,reply_ms:2*86400000,pause_ms:14*86400000};
export const HOURS={start:9,end:20},FALLBACK={zone:'America/New_York',start:12,end:20};
const DAY=86400000,LOG_LIMIT=50;
const validTimezone=tz=>{if(typeof tz!=='string'||!tz||tz.length>64)return null;try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return tz;}catch{return null;}};

// Ledger operations of the unprompted texts, so every nudge counts toward the same limits.
export const NUDGE_OPERATIONS={goes_with:(owner,day)=>`gmail:${owner}:purchases:${day}`,fit_check:(owner,day)=>`gmail:${owner}:fit-check:${day}`};
const isNudge=op=>/^gmail:[^:]+:(?:purchases|fit-check):/.test(op??'');
// Alerts: price, restock and low-stock texts the person asked for, and return-window reminders (lib/return-windows.js).
// They are never held by the nudge limits, and a day with one has no nudge.
const isPriceAlert=op=>/^(?:price-alert|return-window):/.test(op??'');

// The person's time zone, as their browser reported it on a companion page (the style report saves it).
export const nudgeTimezone=data=>validTimezone(data?.style_report?.timezone)??null;
const parts=(at,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
export const localDay=(at,zone)=>{const p=parts(at,zone);return `${p.year}-${p.month}-${p.day}`;};
export function sendingHours(now,timezone){
 const zone=validTimezone(timezone),window=zone?{zone,...HOURS}:FALLBACK,hour=Number(parts(now,window.zone).hour);
 return {ok:hour>=window.start&&hour<window.end,zone:window.zone,hour,known:Boolean(zone)};
}

// The decision for one nudge, from what was already sent (ledger rows {operation_id, created_at, status}).
// Returns {send, reason}; reason names the first rule that holds it back.
// lastInbound: when the person last texted Jules (ISO), for the back-off.
export function backoffUntil({sent=[],lastInbound=null,now=Date.now()}){
 const replied=Date.parse(lastInbound??'')||0;
 const unanswered=sent.filter(m=>m.status==='sent'&&isNudge(m.operation_id)&&Date.parse(m.created_at)>replied).map(m=>Date.parse(m.created_at)).filter(Number.isFinite).sort((a,b)=>b-a);
 // The newest of them is ignored once two days pass without a reply; the pause runs from then.
 if(unanswered.length<BACKOFF.ignored||now-unanswered[0]<BACKOFF.reply_ms)return null;
 const until=unanswered[0]+BACKOFF.reply_ms+BACKOFF.pause_ms;
 return now<until?until:null;
}
export function nudgeDecision({sent=[],now=Date.now(),timezone=null,optedOut=false,textsOn=true,lastInbound=null}){
 if(optedOut)return {send:false,reason:'opted_out'};
 if(!textsOn)return {send:false,reason:'texts_off'};
 const hours=sendingHours(now,timezone);
 if(!hours.ok)return {send:false,reason:'quiet_hours',hour:hours.hour,zone:hours.zone};
 const delivered=sent.filter(m=>m.status==='sent'&&Number.isFinite(Date.parse(m.created_at))),today=localDay(now,hours.zone);
 const nudges=delivered.filter(m=>isNudge(m.operation_id)),sameDay=m=>localDay(Date.parse(m.created_at),hours.zone)===today;
 if(nudges.filter(sameDay).length>=LIMITS.day)return {send:false,reason:'daily_cap'};
 if(delivered.some(m=>isPriceAlert(m.operation_id)&&sameDay(m)))return {send:false,reason:'price_alert_today'};
 if(nudges.filter(m=>now-Date.parse(m.created_at)<7*DAY).length>=LIMITS.week)return {send:false,reason:'weekly_cap'};
 const paused=backoffUntil({sent:delivered,lastInbound,now});
 if(paused)return {send:false,reason:'ignored_backoff',until:new Date(paused).toISOString()};
 return {send:true,reason:null,zone:hours.zone};
}

// Reads what the decision needs. data is the person's history row data (time zone, purchase-texts setting).
export async function checkNudge(store,owner,data,{now=Date.now()}={}){
 // 20 days covers the back-off: two ignored nudges, two days to reply, then a 14-day pause.
 const [sent,optedOut,lastInbound]=await Promise.all([store.unpromptedSince(owner,new Date(now-20*DAY).toISOString()),store.smsOptedOut(owner),store.lastInbound(owner)]);
 return nudgeDecision({sent,now,timezone:nudgeTimezone(data),optedOut,textsOn:data?.purchase_texts?.enabled!==false,lastInbound});
}

// One log entry per decision about a real candidate: what was considered, and sent or why not.
// Kept on the row (newest last) so Admin can show it; also written to the Vercel log.
export function recordNudge(data,entry,now=Date.now()){
 const row={at:new Date(now).toISOString(),kind:entry.kind,status:entry.status,reason:entry.reason??null,item_ids:(entry.item_ids??[]).slice(0,5),...(entry.test?{test:true}:{})};
 data.nudges={...data.nudges,log:[...(data.nudges?.log??[]),row].slice(-LOG_LIMIT)};
 return row;
}
export const logNudge=(row,extra={})=>console.log(JSON.stringify({event:'nudge',kind:row.kind,status:row.status,reason:row.reason,items:row.item_ids.length,test:Boolean(row.test),...extra}));

// Admin › Adoption: per person, what each unprompted text did, from the decision logs (test sends left out
// of the rates). Offers: sent, answered (yes / no / not now / turned texts off), replied about something
// else, and no reply yet. Holds and skips are counted by reason; the latest decision says where they stand.
const ANSWERED=['accepted','declined','not_now','stopped'];
export function nudgeSummary(rows,now=Date.now()){
 const people=(rows??[]).map(({conversation_id,nudges})=>{
  const log=(nudges?.log??[]).filter(e=>!e.test),tests=(nudges?.log??[]).filter(e=>e.test).length;
  const sent=kind=>log.filter(e=>e.kind===kind&&e.status==='sent').length,replies=log.filter(e=>e.kind==='goes_with'&&e.status==='replied');
  const reasons=r=>replies.filter(e=>r.includes(e.reason)).length;
  const offers=sent('goes_with'),open=Boolean(nudges?.open&&!nudges.open.test&&now-Date.parse(nudges.open.at)<BACKOFF.reply_ms);
  const held={};for(const e of log.filter(e=>['held','skipped'].includes(e.status)))held[e.reason]=(held[e.reason]??0)+1;
  const latest=log.at(-1)??null;
  return {id:conversation_id,offers,fit_checks:sent('fit_check'),answered:reasons(ANSWERED),yes:reasons(['accepted']),no:reasons(['declined']),not_now:reasons(['not_now']),stopped:reasons(['stopped']),
   unrelated:reasons(['unrelated']),no_reply:Math.max(0,offers-replies.length-(open?1:0)),open,held,tests,
   latest:latest?{at:latest.at,kind:latest.kind,status:latest.status,reason:latest.reason}:null};
 }).filter(p=>p.offers||p.fit_checks||p.tests||Object.keys(p.held).length).sort((a,b)=>(b.latest?.at??'').localeCompare(a.latest?.at??''));
 const total=k=>people.reduce((n,p)=>n+p[k],0),offers=total('offers');
 return {people,totals:{offers,fit_checks:total('fit_checks'),answered:total('answered'),yes:total('yes'),unrelated:total('unrelated'),no_reply:total('no_reply'),
  reply_rate:offers?total('answered')/offers:null,yes_rate:offers?total('yes')/offers:null},
  recent:(rows??[]).flatMap(({conversation_id,nudges})=>(nudges?.log??[]).map(e=>({...e,id:conversation_id}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,40)};
}
