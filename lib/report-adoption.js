// Admin › Style report (Engagement view): how style reports are opened, shared, opened by friends and voted on,
// across testers. Pure; the reads are in reportAdoptionData. Events come from lib/report-events.js (db/049, db/050),
// votes from each report's feedback, signups from public_signups credited through a person's referral code.
// No message text, viewer identity or phone number leaves this module (phones are only counted).
import {weekStart} from './adoption.js';
import {referralRef} from './referral.js';
import {REPORT_CARDS,SHARE_CHANNELS} from './report-events.js';

const DAY=86400000;
// When each kind of event started being recorded: earlier windows say "not tracked", never 0.
export const TRACKED_FROM={opens:Date.parse('2026-10-22T00:00:00Z'),cards:Date.parse('2026-10-22T22:00:00Z')};
const ms=at=>Date.parse(at??'');
const inWindow=(at,[from,to])=>{const t=ms(at);return t>=from&&t<to;};
const pct=(part,whole)=>whole?part/whole:null;

// The two Compare choices: this week (Monday, UTC) against last week; the last 28 days against the 28 before.
export function windows(now=Date.now()){
 const monday=weekStart(now).getTime();
 return {
  week:{label:'This week vs last week',current:[monday,now+1],previous:[monday-7*DAY,monday]},
  month:{label:'Last 4 weeks vs the 4 before',current:[now-28*DAY,now+1],previous:[now-56*DAY,now-28*DAY]},
 };
}

// The latest vote per card per report among votes cast in the window.
function votesIn(reports,range){
 const latest=new Map();
 for(const r of reports)for(const f of Array.isArray(r.feedback)?r.feedback:[])
  if(['up','down'].includes(f?.vote)&&inWindow(f.at,range))latest.set(`${f.report_id}|${f.card}`,f);
 return [...latest.values()];
}

function figures({reports,events,signups},range){
 const of=kind=>events.filter(e=>e.kind===kind&&inWindow(e.created_at,range));
 const viewed=of('report_viewed'),shared=of('report_shared'),friends=of('report_share_opened'),votes=votesIn(reports,range);
 return {
  built:reports.filter(r=>inWindow(r.first_built_at??r.built_at,range)).length,
  reports:reports.filter(r=>ms(r.first_built_at??r.built_at)<range[1]).length,
  opened:new Set(viewed.map(e=>e.conversation_id)).size,opens:viewed.length,
  shared:new Set(shared.map(e=>e.conversation_id)).size,shares:shared.length,
  friends:friends.length,
  signups:new Set(signups.filter(s=>inWindow(s.at,range)).map(s=>s.phone)).size,
  up:votes.filter(v=>v.vote==='up').length,down:votes.filter(v=>v.vote==='down').length,
 };
}

// A change badge: counts in percent, the vote share in points. Higher is better for every figure here.
function change(now,before,tracked,{points=false}={}){
 if(!tracked)return {change:'New',tone:'plain'};
 if(now==null||before==null)return {change:null,tone:''};
 if(points){const d=Math.round((now-before)*100);return d?{change:`${d>0?'↑':'↓'} ${Math.abs(d)} pts`,tone:d>0?'ok':'fail'}:{change:'No change',tone:'plain'};}
 if(now===before)return {change:'No change',tone:'plain'};
 if(!before)return {change:'New',tone:'plain'};
 const d=Math.round((now-before)/before*100);
 return {change:`${d>0?'↑':'↓'} ${Math.abs(d)}%`,tone:d>0?'ok':'fail'};
}
const share=v=>v==null?'—':`${Math.round(v*100)}%`;
const per=(a,b)=>b?(Math.round(a/b*10)/10).toString():'—';
const plural=(n,one,many=one+'s')=>`${n} ${n===1?one:many}`;

// The MetricStrip cells for one Compare choice.
export function stripCells(data,win){
 const now=figures(data,win.current),was=figures(data,win.previous);
 const tracked=win.previous[0]>=TRACKED_FROM.opens,earlier=tracked?null:'not tracked before Oct 22';
 const votes=now.up+now.down,votesBefore=was.up+was.down;
 const upShare=pct(now.up,votes),upBefore=pct(was.up,votesBefore);
 return [
  {key:'built',label:'Reports built',value:String(now.built),detail:`${plural(now.reports,'tester')} with a report`,...change(now.built,was.built,true),was:`was ${was.built}`},
  {key:'opened',label:'Opened',value:plural(now.opened,'tester'),detail:`unique · ${share(pct(now.opened,now.reports))} of testers with a report · ${plural(now.opens,'visit')}`,...change(now.opened,was.opened,tracked),was:earlier??`was ${was.opened}`},
  {key:'shared',label:'Shared',value:plural(now.shared,'tester'),detail:`unique · ${share(pct(now.shared,now.opened))} of openers · ${plural(now.shares,'share')}`,...change(now.shared,was.shared,tracked),was:earlier??`was ${was.shared}`},
  {key:'friends',label:'Friends opened',value:plural(now.friends,'friend'),detail:`unique browsers · ${per(now.friends,now.shares)} per share`,...change(now.friends,was.friends,tracked),was:earlier??`was ${was.friends}`},
  {key:'signups',label:'Signups',value:plural(now.signups,'person','people'),detail:`${share(pct(now.signups,now.friends))} of friends`,...change(now.signups,was.signups,true),was:`was ${was.signups}`},
  {key:'votes',label:'Votes up',value:votes?share(upShare):'—',detail:votes?`${now.up} up · ${now.down} down`:'no votes',
   ...(votes&&votesBefore?change(upShare,upBefore,true,{points:true}):{change:null,tone:''}),was:votesBefore?`was ${share(upBefore)}`:null},
 ];
}

// How they shared: each method's shares, the testers who used it, the friends who opened its links and the signups
// that came from them. Opens and signups can only be split for links that carry their method (from Oct 22).
export function methods({events,signups},range){
 const of=kind=>events.filter(e=>e.kind===kind&&inWindow(e.created_at,range));
 const shared=of('report_shared'),opened=of('report_share_opened'),signed=signups.filter(s=>inWindow(s.at,range));
 const total=shared.length;
 const rows=SHARE_CHANNELS.map(channel=>{
  const mine=shared.filter(e=>e.detail===channel),friends=opened.filter(e=>e.detail===channel).length;
  return {channel,shares:mine.length,share:pct(mine.length,total),testers:new Set(mine.map(e=>e.conversation_id)).size,friends,
   per_share:mine.length?Math.round(friends/mine.length*10)/10:null,signups:new Set(signed.filter(s=>s.medium===channel).map(s=>s.phone)).size};
 }).sort((a,b)=>b.shares-a.shares);
 return {total,testers:new Set(shared.map(e=>e.conversation_id)).size,rows,
  unknown:{friends:opened.filter(e=>!SHARE_CHANNELS.includes(e.detail)).length,signups:new Set(signed.filter(s=>!SHARE_CHANNELS.includes(s.medium)).map(s=>s.phone)).size}};
}

// By card: who reached it, the latest vote per report, why people voted it down, and how often its image went out.
export const MIN_VOTES=5;
export function cards({reports,events},range){
 const of=kind=>events.filter(e=>e.kind===kind&&inWindow(e.created_at,range));
 const seen=of('report_card_viewed'),images=of('report_card_shared'),votes=votesIn(reports,range);
 const rows=REPORT_CARDS.map(card=>{
  const mine=votes.filter(v=>v.card===card),down=mine.filter(v=>v.vote==='down'),reasons={};
  for(const v of down)if(v.reason)reasons[v.reason]=(reasons[v.reason]??0)+1;
  return {card,seen:new Set(seen.filter(e=>e.detail===card).map(e=>e.conversation_id)).size,up:mine.length-down.length,down:down.length,
   up_share:mine.length>=MIN_VOTES?pct(mine.length-down.length,mine.length):null,reasons,images:images.filter(e=>e.detail===card).length};
 }).filter(r=>r.seen||r.up||r.down||r.images);
 // Weakest first: cards with enough votes by their share of ups, then the rest by how many voted.
 rows.sort((a,b)=>(a.up_share==null)-(b.up_share==null)||(a.up_share??0)-(b.up_share??0)||(b.up+b.down)-(a.up+a.down));
 const up=votes.filter(v=>v.vote==='up').length;
 return {rows,up,down:votes.length-up,tracked:range[0]>=TRACKED_FROM.cards};
}

// The last eight weeks (Monday, UTC), newest first.
export function weeks(data,now=Date.now()){
 const monday=weekStart(now).getTime();
 return Array.from({length:8},(_,i)=>{
  const from=monday-i*7*DAY,range=[from,from+7*DAY],f=figures(data,range);
  return {week_of:new Date(from).toISOString().slice(0,10),current:i===0,tracked:range[1]>TRACKED_FROM.opens,...f};
 });
}

export function reportAdoption(data,now=Date.now()){
 const periods=Object.fromEntries(Object.entries(windows(now)).map(([key,w])=>[key,{label:w.label,totals:figures(data,w.current),strip:stripCells(data,w),methods:methods(data,w.current),cards:cards(data,w.current)}]));
 return {generated_at:new Date(now).toISOString(),periods,weeks:weeks(data,now)};
}

// Reads: every built report's dates and votes, the report events of the last eight weeks, and signups credited to a
// report owner's referral code (or the generic shared-report code). The report and style card share one code.
export async function reportAdoptionData(store,env,now=Date.now()){
 const since=new Date(Math.min(weekStart(now).getTime()-7*7*DAY,now-56*DAY)).toISOString();
 const [reports,events,refSignups]=await Promise.all([store.reportSummaries(),store.reportEventsSince(since),store.referralSignups()]);
 const owners=new Set(reports.map(r=>referralRef(r.conversation_id,env)).filter(Boolean));
 const signups=refSignups.filter(s=>owners.has(s.ref)||s.ref==='shared-report').map(s=>({phone:s.phone_number,at:s.consent_at,medium:s.utm_medium??null}));
 return reportAdoption({reports,events,signups},now);
}
