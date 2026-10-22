// Admin › Adoption formatting: plain-text cells for the tester grid and the weekly ladder (lib/adoption.js).
// Pure functions so the page logic is testable without a browser.
import {ago} from './admin-people-view.js';

const STAGE_TONE={joined:'plain',messaged:'plain',results:'plain',saved:'ok',watching:'ok',intent:'ok'};
export const pct=(n,total)=>total?`${Math.round(n/total*100)}%`:'—';

// "45 min", "6 hours", "3 days": how long from a tester's first message to their first product results.
export function duration(hours){
 if(hours===null||hours===undefined)return '—';
 if(hours<1)return `${Math.max(1,Math.round(hours*60))} min`;
 if(hours<48){const h=Math.round(hours);return `${h} ${h===1?'hour':'hours'}`;}
 return `${Math.round(hours/24)} days`;
}
export const rate=v=>v===null||v===undefined?'—':`${Math.round(v*100)}%`;
export const money=v=>v===null||v===undefined?'—':`$${v.toFixed(2)}`;

// One tester row: the identifier, the furthest ladder step as a badge, then activity and counts.
export function testerCells(tester,steps,now=Date.now()){
 const step=steps.find(s=>s.key===tester.stage);
 return {
  stage:{label:step?.label??tester.stage,tone:STAGE_TONE[tester.stage]??'plain'},
  last_active:tester.last_active_at?ago(tester.last_active_at,now):'never',
  active_days:`${tester.active_days_7} of 7`,
  results:String(tester.results),saves:String(tester.saves),
  shown:String(tester.shown),save_rate:rate(tester.save_rate),clicks:String(tester.clicks),
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
  {label:'Save rate',value:rate(summary.save_rate),note:summary.shown?`${summary.saves_tracked} saved of ${summary.shown} shown`:'not tracked yet'},
  {label:'Link clicks',value:String(summary.clicks),note:summary.clicks?`from ${summary.clickers} ${summary.clickers===1?'tester':'testers'}`:'none yet'},
  {label:'Purchase intent',value:String(summary.intent),note:of(summary.intent)},
 ];
}

// ---------- Quality (lib/adoption-quality.js) ----------
const n=(count,[one,many])=>`${count} ${count===1?one:many}`;
export const shortDate=at=>new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
// Photos Jules searched for: everything except unreadable photos, no reply, and photos that weren't a product search.
const searched=o=>(o.identified??0)+(o.similar??0)+(o.none??0);

export function qualitySummaryCells(q){
 const s=searched(q.photos.outcomes);
 return [
  {label:'Misses',value:String(q.totals.misses),note:q.totals.results?`against ${n(q.totals.results,['reply','replies'])} with results`:'no results replies yet'},
  {label:'Flags',value:String(q.totals.flags),note:`${q.totals.thumbs} by 👎, the rest by #dev`},
  {label:'Photos identified',value:`${q.photos.outcomes.identified??0} of ${s}`,note:s?`${pct(q.photos.outcomes.identified??0,s)} of photo searches`:'no photo searches yet'},
  {label:'Saved from a photo',value:String(q.photos.saved),note:`of ${n(q.photos.total,['photo','photos'])} sent`},
 ];
}

// One row per tester: misses against their replies with results, flags, and photo outcomes.
export function qualityTesterCells(tester,row){
 return {
  results:String(tester.results),misses:String(row.misses),miss_rate:tester.results?pct(row.misses,tester.results):'—',
  flags:row.flags?`${row.flags}${row.thumbs?` (${row.thumbs} 👎)`:''}`:'0',
  photos:String(row.photos),identified:row.photos?String(row.photos_identified):'—',saved:row.photos?String(row.photos_saved):'—',
 };
}

// One week: replies with results, misses (and their share), each kind, flags, and a one-line photo summary.
export function qualityWeekCells(week,kinds,outcomes){
 const photos=outcomes.filter(o=>week.photos[o.key]).map(o=>`${week.photos[o.key]} ${o.label.toLowerCase()}`).join(' · ');
 return {
  week:`${shortDate(week.week_of+'T00:00:00Z')}${week.current?' (this week)':''}`,
  results:String(week.results),misses:week.results?`${week.misses} · ${pct(week.misses,week.results)}`:String(week.misses),
  kinds:kinds.map(k=>({key:k.key,label:k.label,value:String(week.by_kind[k.key]??0)})),
  flags:String(week.flags),photos:photos||'—',
 };
}

// Kinds that occur at least once, so the weekly table only has the columns it needs.
export const usedKinds=q=>q.kinds.filter(k=>q.weeks.some(w=>w.by_kind[k.key]));

