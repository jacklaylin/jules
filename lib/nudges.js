// Shared rules for every text Jules sends that nobody asked for (PRD "Proactive nudges", founder decision
// October 21): the "goes with your new purchase" offer and the fit check today, and any later nudge.
// - At most one a day (the person's local day) and three in any 7 days.
// - Never on a day a price alert went out. Price alerts themselves are never held: the person asked for them.
// - Only 9am–8pm in the person's time zone; with no known time zone, only noon–8pm US Eastern (daytime
//   across the US).
// - Never after STOP, and never while texts about purchases are turned off in chat.
// Every decision is logged (event `nudge`) and kept on the person's history row (data.nudges.log).

export const LIMITS={day:1,week:3};
export const HOURS={start:9,end:20},FALLBACK={zone:'America/New_York',start:12,end:20};
const DAY=86400000,LOG_LIMIT=50;
const validTimezone=tz=>{if(typeof tz!=='string'||!tz||tz.length>64)return null;try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return tz;}catch{return null;}};

// Ledger operations of the unprompted texts, so every nudge counts toward the same limits.
export const NUDGE_OPERATIONS={goes_with:(owner,day)=>`gmail:${owner}:purchases:${day}`,fit_check:(owner,day)=>`gmail:${owner}:fit-check:${day}`};
const isNudge=op=>/^gmail:[^:]+:(?:purchases|fit-check):/.test(op??'');
const isPriceAlert=op=>/^price-alert:/.test(op??'');

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
export function nudgeDecision({sent=[],now=Date.now(),timezone=null,optedOut=false,textsOn=true}){
 if(optedOut)return {send:false,reason:'opted_out'};
 if(!textsOn)return {send:false,reason:'texts_off'};
 const hours=sendingHours(now,timezone);
 if(!hours.ok)return {send:false,reason:'quiet_hours',hour:hours.hour,zone:hours.zone};
 const delivered=sent.filter(m=>m.status==='sent'&&Number.isFinite(Date.parse(m.created_at))),today=localDay(now,hours.zone);
 const nudges=delivered.filter(m=>isNudge(m.operation_id)),sameDay=m=>localDay(Date.parse(m.created_at),hours.zone)===today;
 if(nudges.filter(sameDay).length>=LIMITS.day)return {send:false,reason:'daily_cap'};
 if(delivered.some(m=>isPriceAlert(m.operation_id)&&sameDay(m)))return {send:false,reason:'price_alert_today'};
 if(nudges.filter(m=>now-Date.parse(m.created_at)<7*DAY).length>=LIMITS.week)return {send:false,reason:'weekly_cap'};
 return {send:true,reason:null,zone:hours.zone};
}

// Reads what the decision needs. data is the person's history row data (time zone, purchase-texts setting).
export async function checkNudge(store,owner,data,{now=Date.now()}={}){
 const [sent,optedOut]=await Promise.all([store.unpromptedSince(owner,new Date(now-8*DAY).toISOString()),store.smsOptedOut(owner)]);
 return nudgeDecision({sent,now,timezone:nudgeTimezone(data),optedOut,textsOn:data?.purchase_texts?.enabled!==false});
}

// One log entry per decision about a real candidate: what was considered, and sent or why not.
// Kept on the row (newest last) so Admin can show it; also written to the Vercel log.
export function recordNudge(data,entry,now=Date.now()){
 const row={at:new Date(now).toISOString(),kind:entry.kind,status:entry.status,reason:entry.reason??null,item_ids:(entry.item_ids??[]).slice(0,5),...(entry.test?{test:true}:{})};
 data.nudges={...data.nudges,log:[...(data.nudges?.log??[]),row].slice(-LOG_LIMIT)};
 return row;
}
export const logNudge=(row,extra={})=>console.log(JSON.stringify({event:'nudge',kind:row.kind,status:row.status,reason:row.reason,items:row.item_ids.length,test:Boolean(row.test),...extra}));
