// The Compare control on admin dashboards (design system › Admin › MetricStrip): this week (Monday, UTC) against
// last week, or the last 28 days against the 28 before. Every page's strip uses these windows and this badge, so
// "↑ 12%" means the same thing everywhere. Pure.
import {weekStart} from './adoption.js';

const DAY=86400000;
export function windows(now=Date.now()){
 const monday=weekStart(now).getTime();
 return {
  week:{label:'This week vs last week',current:[monday,now+1],previous:[monday-7*DAY,monday]},
  month:{label:'Last 4 weeks vs the 4 before',current:[now-28*DAY,now+1],previous:[now-56*DAY,now-28*DAY]},
 };
}
export const inWindow=(at,[from,to])=>{const t=Date.parse(at??'');return t>=from&&t<to;};

// The change badge for one figure. tracked false: the earlier window predates the figure, so "New", never 0.
// points: a share, shown in percentage points. lowerIsBetter flips which way is green.
export function change(now,before,{tracked=true,points=false,lowerIsBetter=false}={}){
 if(!tracked)return {change:'New',tone:'plain'};
 if(now==null||before==null)return {change:null,tone:''};
 const tone=d=>(d>0)!==lowerIsBetter?'ok':'fail';
 if(points){const d=Math.round((now-before)*100);return d?{change:`${d>0?'↑':'↓'} ${Math.abs(d)} pts`,tone:tone(d)}:{change:'No change',tone:'plain'};}
 if(now===before)return {change:'No change',tone:'plain'};
 if(!before)return {change:'New',tone:'plain'};
 const d=Math.round((now-before)/before*100);
 return {change:`${d>0?'↑':'↓'} ${Math.abs(d)}%`,tone:tone(d)};
}
