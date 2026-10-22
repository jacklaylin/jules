import {turnOutcomes} from './turn-outcomes.js';
import {weekStart} from './adoption.js';

// Admin › person › Summary: is Jules working for this person? (design "Admin person: summary + knowledge", step 3).
// Built per person from the shopping-request outcomes Admin › Scorecard uses (lib/turn-outcomes.js): one sourcing
// turn per Jules reply that searched or asked a shopping question, labelled by what the person did next. Pure
// apart from personAdoption, which reads. No message text is read or returned.

const DAY=86400000,WEEKS=4,WINDOW=WEEKS*7*DAY,REPLY_WINDOW=DAY;
const ms=at=>Date.parse(at??'');
const inboundIdOf=operation=>String(operation??'').slice(String(operation??'').indexOf(':')+1);
// Texts Jules sends that nobody asked for (lib/nudges.js): price alerts and the purchase nudges.
export const proactive=operation=>/^price-alert:/.test(operation??'')||/^gmail:[^:]+:(?:purchases|fit-check):/.test(operation??'');
// What the person did with results, most telling first, as words for "Last positive request".
const DID=[['purchase_intent','Asked to buy one'],['saved','Saved one'],['alert_on','Turned on a price alert'],['picked','Picked one'],['clicked','Opened a store link'],['reacted','Reacted to the results']];
// The four ways a request ends, in the order the bar shows them. waiting (results under a day old) is left out.
export const ENDINGS=[['positive','positive: saved, picked, clicked, asked to buy or reacted'],['neutral','refined or moved on'],['negative','turned down, missed or flagged'],['silent','no reply']];

// turns: turnOutcomes for this person. messages: their messages (all directions) over the same period.
// costs: their usage_by_user_day rows (all time). now: the current time.
export function adoptionCards({turns=[],messages=[],costs=[]},now=Date.now()){
 const byProvider=new Map(messages.filter(m=>m.provider_id).map(m=>[m.provider_id,m]));
 const sorted=[...messages].sort((a,b)=>ms(a.created_at)-ms(b.created_at));
 // A request answering one of Jules's own texts: threaded to it, or sent within a day of it with nothing between.
 const answersJules=turn=>{
  const asked=byProvider.get(inboundIdOf(turn.operation));if(!asked)return false;
  if(asked.reply_provider_id&&proactive(byProvider.get(asked.reply_provider_id)?.operation_id))return true;
  const before=sorted.filter(m=>m.conversation_id===asked.conversation_id&&ms(m.created_at)<ms(asked.created_at)).at(-1);
  return Boolean(before&&before.direction==='outbound'&&proactive(before.operation_id)&&ms(asked.created_at)-ms(before.created_at)<=REPLY_WINDOW);
 };
 const requests=turns.filter(t=>t.new_request!==false);
 const recent=requests.filter(t=>now-ms(t.at)<WINDOW),earlier=requests.filter(t=>now-ms(t.at)>=WINDOW&&now-ms(t.at)<2*WINDOW);
 const started=list=>list.filter(t=>!answersJules(t)).length;
 const perWeek=n=>Math.round(n/WEEKS*10)/10;

 // The last four calendar weeks (Monday UTC), oldest first: a win (a request with a positive reaction), asked (requests,
 // none positive yet) or quiet.
 const current=weekStart(now).getTime(),weeks=[];
 for(let i=WEEKS-1;i>=0;i--){
  const from=current-i*7*DAY,to=from+7*DAY,inWeek=turns.filter(t=>ms(t.at)>=from&&ms(t.at)<to);
  weeks.push({week_of:new Date(from).toISOString().slice(0,10),current:i===0,status:inWeek.some(t=>t.headline==='positive')?'win':inWeek.length?'asked':'quiet'});
 }
 const positive=turns.filter(t=>t.headline==='positive').sort((a,b)=>ms(b.at)-ms(a.at))[0]??null;
 const last=positive?{at:positive.at,did:DID.find(([k])=>positive.labels.includes(k))?.[1]??'Liked the results',products_shown:positive.products_shown??0}:null;

 // Chat quality: how the last four weeks' shopping requests ended, once their follow-up is known.
 const settled=turns.filter(t=>now-ms(t.at)<WINDOW&&t.headline!=='waiting');
 const endings=Object.fromEntries(ENDINGS.map(([k])=>[k,settled.filter(t=>t.headline===k).length]));
 return {
  weeks,wins:weeks.filter(w=>w.status==='win').length,last_positive:last,
  requests:{started_per_week:perWeek(started(recent)),before_per_week:perWeek(started(earlier)),replies_to_jules:recent.length-started(recent),total:recent.length},
  quality:{requests:settled.length,positive:endings.positive,endings,waiting:turns.filter(t=>t.headline==='waiting').length},
  lifetime_cost_usd:Math.round(costs.reduce((n,r)=>n+Number(r.cost_usd??0),0)*100)/100,
 };
}

export async function personAdoption(store,conversation,{now=Date.now()}={}){
 const since=new Date(now-2*WINDOW).toISOString();
 const [rows,costs]=await Promise.all([store.outcomeRows(since,{conversation}),store.lifetimeCost?.(conversation).catch(()=>[])??[]]);
 return adoptionCards({turns:turnOutcomes(rows,{now}),messages:rows.messages,costs},now);
}
