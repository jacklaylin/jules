import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptionCards,proactive,personAdoption} from '../lib/person-adoption.js';

const DAY=86400000,now=Date.parse('2026-10-22T18:00:00Z');
const ago=days=>new Date(now-days*DAY).toISOString();
let n=0;
// A sourcing turn as lib/turn-outcomes.js returns it; its asking message is in.<n>.
const turn=(days,headline,labels=[],extra={})=>({operation:`ai:in${++n}`,conversation_id:'c',at:ago(days),headline,labels,products_shown:4,new_request:true,...extra});
const inbound=(t,extra={})=>({conversation_id:'c',provider_id:t.operation.slice(3),direction:'inbound',created_at:t.at,...extra});

test('proactive texts are price alerts and the purchase nudges, never replies',()=>{
 assert.equal(proactive('price-alert:abc'),true);
 assert.equal(proactive('gmail:owner:purchases:2026-10-20'),true);
 assert.equal(proactive('gmail:owner:fit-check:2026-10-20'),true);
 assert.equal(proactive('ai:in1'),false);assert.equal(proactive('gmail:owner:ready:x'),false);
});

test('weeks with a win, the last positive request and requests they started',()=>{
 n=0;
 const turns=[turn(2,'positive',['saved','picked']),turn(5,'silent'),turn(9,'negative',['rejected']),turn(16,'positive',['clicked']),turn(17,'neutral',['refined'],{new_request:false}),
  turn(40,'positive',['saved']),turn(45,'neutral',['replied'])];
 const messages=turns.map(t=>inbound(t));
 const r=adoptionCards({turns,messages,costs:[{cost_usd:1.5},{cost_usd:'1.62'}]},now);
 assert.deepEqual(r.weeks.map(w=>w.status),['quiet','win','asked','win'],'oldest first; the current week last');
 assert.equal(r.weeks.at(-1).current,true);assert.equal(r.wins,2);
 assert.deepEqual(r.last_positive,{at:ago(2),did:'Saved one',products_shown:4});
 assert.deepEqual(r.requests,{started_per_week:1,before_per_week:0.5,replies_to_jules:0,total:4},'a refine is not a new request');
 assert.equal(r.lifetime_cost_usd,3.12);
});

test('a request answering one of Jules’s own texts is counted apart from ones they started',()=>{
 n=0;
 const threaded=turn(3,'positive',['saved']),after=turn(6,'silent'),own=turn(8,'neutral',['replied']),late=turn(12,'neutral',['replied']);
 const messages=[
  {conversation_id:'c',provider_id:'alert1',direction:'outbound',operation_id:'price-alert:a1',created_at:ago(4)},inbound(threaded,{reply_provider_id:'alert1'}),
  {conversation_id:'c',provider_id:'nudge1',direction:'outbound',operation_id:'gmail:o:purchases:d',created_at:new Date(Date.parse(after.at)-3600000).toISOString()},inbound(after),
  {conversation_id:'c',provider_id:'r1',direction:'outbound',operation_id:'ai:x',created_at:ago(8.1)},inbound(own),
  {conversation_id:'c',provider_id:'nudge2',direction:'outbound',operation_id:'gmail:o:fit-check:d',created_at:ago(14)},inbound(late)];
 const r=adoptionCards({turns:[threaded,after,own,late],messages},now);
 assert.equal(r.requests.replies_to_jules,2,'threaded to an alert, or within a day of a nudge');
 assert.equal(r.requests.started_per_week,0.5,'a reply two days after a nudge is their own request');
});

test('chat quality counts how settled requests ended; results under a day old wait',()=>{
 n=0;
 const turns=[turn(1,'positive',['saved']),turn(2,'positive',['picked']),turn(3,'neutral',['refined']),turn(4,'negative',['missed']),turn(5,'silent'),turn(0.2,'waiting'),turn(35,'positive',['saved'])];
 const r=adoptionCards({turns,messages:[]},now);
 assert.deepEqual(r.quality,{requests:5,positive:2,endings:{positive:2,neutral:1,negative:1,silent:1},waiting:1});
});

test('nobody yet: quiet weeks, no positive request, no cost',()=>{
 const r=adoptionCards({},now);
 assert.deepEqual(r.weeks.map(w=>w.status),['quiet','quiet','quiet','quiet']);
 assert.equal(r.last_positive,null);assert.equal(r.quality.requests,0);assert.equal(r.lifetime_cost_usd,0);
});

test('personAdoption reads one person’s rows over eight weeks and their lifetime cost',async()=>{
 const calls=[];
 const store={outcomeRows:async(since,options)=>{calls.push([since,options]);return {messages:[],usage:[],events:[]};},lifetimeCost:async c=>{calls.push(['cost',c]);return [{cost_usd:2}];}};
 const r=await personAdoption(store,'c1',{now});
 assert.deepEqual(calls,[[ago(56),{conversation:'c1'}],['cost','c1']]);
 assert.equal(r.lifetime_cost_usd,2);
});

test('the Style report card: opens, shares by channel, friends’ opens, signups and the latest vote per card',async()=>{
 const {reportEngagement}=await import('../lib/report-engagement.js');
 assert.deepEqual(reportEngagement({report:null}),{built:false},'no report yet');
 const report={id:'r2',built_at:'2026-10-20T10:00:00Z',share_at:'2026-10-19T10:00:00Z',feedback:[
  {card:'receipt',vote:'down',report_id:'r1'},{card:'receipt',vote:'up',report_id:'r1'},// changed their mind: one up
  {card:'gatekeeper',vote:'down',reason:'not_funny',report_id:'r1'},{card:'receipt',vote:'up',report_id:'r2'}]};
 const events=[{kind:'report_viewed',created_at:'2026-10-19T09:00:00Z'},{kind:'report_viewed',created_at:'2026-10-21T09:00:00Z'},
  {kind:'report_shared',detail:'copy',created_at:'2026-10-19T09:01:00Z'},{kind:'report_shared',detail:'copy'},{kind:'report_shared',detail:'story'},
  {kind:'report_share_opened'},{kind:'link_click'}];
 assert.deepEqual(reportEngagement({report,events,signups:1}),{built:true,built_at:report.built_at,share_link_at:report.share_at,opened:2,last_opened_at:'2026-10-21T09:00:00Z',
  shared:3,channels:{copy:2,story:1},link_opened:1,signups:1,votes:{up:2,down:1}});
});

test('personAdoption reads the report summary, its events and signups through the person’s referral code alongside the rest',async()=>{
 const {referralRef}=await import('../lib/referral.js');const env={SUPABASE_SERVICE_ROLE_KEY:'secret'},asked=[];
 const base={outcomeRows:async()=>({messages:[],usage:[],events:[]}),lifetimeCost:async()=>[]};
 const store={...base,reportSummary:async c=>{asked.push(['summary',c]);return {id:'r1',built_at:'2026-10-20T10:00:00Z',feedback:[]};},
  reportEvents:async c=>{asked.push(['events',c]);return [{kind:'report_viewed',created_at:'2026-10-21T00:00:00Z'}];},signupsByRef:async ref=>{asked.push(['signups',ref]);return 2;}};
 const r=await personAdoption(store,'c1',{now,env});
 assert.deepEqual(asked,[['summary','c1'],['events','c1'],['signups',referralRef('c1',env)]]);
 assert.equal(r.report.opened,1);assert.equal(r.report.signups,2);assert.equal(r.wins,0,'the adoption cards are unchanged');
 // No history row: no report yet. A failed read marks only this card.
 assert.deepEqual((await personAdoption({...store,reportSummary:async()=>null},'c1',{now,env})).report,{built:false});
 const failed=await personAdoption({...store,reportEvents:async()=>{throw Object.assign(Error('x'),{database_status:500});}},'c1',{now,env});
 assert.deepEqual(failed.report,{error:true});assert.equal(failed.lifetime_cost_usd,0);
});
