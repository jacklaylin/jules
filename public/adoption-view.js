// Admin › Adoption formatting: plain-text cells for the tester grid and the weekly ladder (lib/adoption.js).
// Pure functions so the page logic is testable without a browser.
import {ago} from './admin-people-view.js';

const STAGE_TONE={joined:'plain',messaged:'plain',results:'plain',saved:'ok',watching:'ok'};
export const pct=(n,total)=>total?`${Math.round(n/total*100)}%`:'—';

// "45 min", "6 hours", "3 days": how long from a tester's first message to their first product results.
export function duration(hours){
 if(hours===null||hours===undefined)return '—';
 if(hours<1)return `${Math.max(1,Math.round(hours*60))} min`;
 if(hours<48){const h=Math.round(hours);return `${h} ${h===1?'hour':'hours'}`;}
 return `${Math.round(hours/24)} days`;
}
export const money=v=>v===null||v===undefined?'—':`$${v.toFixed(2)}`;

// One tester row: the identifier, the furthest ladder step as a badge, then activity and counts.
export function testerCells(tester,steps,now=Date.now()){
 const step=steps.find(s=>s.key===tester.stage);
 return {
  stage:{label:step?.label??tester.stage,tone:STAGE_TONE[tester.stage]??'plain'},
  last_active:tester.last_active_at?ago(tester.last_active_at,now):'never',
  active_days:`${tester.active_days_7} of 7`,
  results:String(tester.results),saves:String(tester.saves),
  alerts:tester.alerts_total?`${tester.alerts_active} on · ${tester.alerts_total} set`:'0',
  first_results:duration(tester.hours_to_results),
  cost:money(tester.cost_usd),
 };
}

// One week row: new and active testers, then each ladder step as "count · share of everyone who had joined".
export function weekCells(week,steps){
 const total=week.reached.joined;
 return {
  week:`${new Date(week.week_of+'T00:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})}${week.current?' (this week)':''}`,
  joined:String(week.joined),active:`${week.active} · ${pct(week.active,total)}`,
  steps:steps.map(s=>({key:s.key,label:s.label,value:s.key==='joined'?String(total):`${week.reached[s.key]} · ${pct(week.reached[s.key],total)}`})),
 };
}

// The metric strip across the top.
export function summaryCells(summary){
 const of=n=>`${pct(n,summary.testers)} of testers`;
 return [
  {label:'Testers',value:String(summary.testers),note:'with a conversation'},
  {label:'Active this week',value:String(summary.active_7),note:of(summary.active_7)},
  {label:'Got results',value:String(summary.results),note:of(summary.results)},
  {label:'Saved an item',value:String(summary.saved),note:of(summary.saved)},
  {label:'Watching now',value:String(summary.watching_now),note:of(summary.watching_now)},
 ];
}
