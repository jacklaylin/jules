import test from 'node:test';
import assert from 'node:assert/strict';
import {windows,change} from '../lib/compare.js';
import {periodStrips} from '../lib/adoption.js';
import {metricCells,periodRanges} from '../public/scorecard-view.js';

const DAY=86400000,now=Date.parse('2026-10-22T18:00:00Z'); // a Thursday
const ago=d=>new Date(now-d*DAY).toISOString();

test('the two Compare windows: this week against last, and 28 days against the 28 before',()=>{
 const w=windows(now);
 assert.deepEqual(w.week.current,[Date.parse('2026-10-19T00:00:00Z'),now+1]);
 assert.deepEqual(w.week.previous,[Date.parse('2026-10-12T00:00:00Z'),Date.parse('2026-10-19T00:00:00Z')]);
 assert.deepEqual(w.month.previous,[now-56*DAY,now-28*DAY]);
 assert.deepEqual(periodRanges('month',now),{current:w.month.current,previous:w.month.previous},'Scorecard uses the same windows');
 assert.deepEqual(periodRanges('week',now),{current:w.week.current,previous:w.week.previous});
});

test('the change badge: percent, points, New before tracking, and which way is better',()=>{
 assert.deepEqual(change(12,10),{change:'↑ 20%',tone:'ok'});
 assert.deepEqual(change(8,10,{lowerIsBetter:true}),{change:'↓ 20%',tone:'ok'});
 assert.deepEqual(change(0.4,0.5,{points:true}),{change:'↓ 10 pts',tone:'fail'});
 assert.deepEqual(change(5,5),{change:'No change',tone:'plain'});
 assert.deepEqual(change(3,0),{change:'New',tone:'plain'});
 assert.deepEqual(change(3,1,{tracked:false}),{change:'New',tone:'plain'});
});

test('Adoption strips: steps reached by the end of each window, activity within it, New before tracking',()=>{
 const conversations=[{id:'a',created_at:ago(40)},{id:'b',created_at:ago(10)},{id:'c',created_at:ago(2)}];
 const testers=[{id:'a',reached:{results:ago(39),saved:ago(30)}},{id:'b',reached:{results:ago(9)}},{id:'c',reached:{}}];
 const inbound=[{conversation_id:'a',created_at:ago(1)},{conversation_id:'b',created_at:ago(3)},{conversation_id:'a',created_at:ago(9)}];
 const events=[{kind:'results_shown',created_at:ago(20),quantity:4},{kind:'results_shown',created_at:ago(1),quantity:5},{kind:'link_click',conversation_id:'a',created_at:ago(1)}];
 const saves=[{saved_at:ago(1)},{saved_at:ago(19)}];
 const strips=periodStrips({conversations,inbound,saves,events,testers,trackedSince:ago(20),summary:{watching_now:1,testers:3}},now);
 const cell=(p,label)=>strips[p].cells.find(c=>c.label===label);
 assert.deepEqual(strips.week.cells.map(c=>c.label),['Testers','Active','Got results','Saved an item','Watching now','Save rate','Link clicks','Purchase intent']);
 assert.equal(cell('week','Testers').value,'3');assert.equal(cell('week','Testers').detail,'1 new');assert.equal(cell('week','Testers').was,'was 2');
 assert.equal(cell('week','Active').value,'2');assert.equal(cell('week','Active').was,'was 1');
 assert.equal(cell('month','Got results').value,'2');assert.equal(cell('month','Got results').was,'was 1');
 assert.equal(cell('month','Save rate').value,'22%','2 saved of 9 shown');
 assert.equal(cell('month','Save rate').change,'New','the month before predates tracking');assert.equal(cell('month','Save rate').was,null);
 assert.equal(cell('week','Watching now').change,null,'today only, no comparison');
});

test('Scorecard compares the last 4 weeks when asked, and says what it compares against',()=>{
 const turn=(d,result)=>({at:ago(d),result,request_type:'text',products_shown:1,headline:'positive',labels:['saved']});
 const turns=[...Array.from({length:6},(_,i)=>turn(2+i,'verified')),...Array.from({length:6},(_,i)=>turn(30+i,'nothing_found'))];
 const month=metricCells(turns,{now,period:'month'}).find(c=>c.key==='verified_rate');
 assert.equal(month.value,'100%');assert.equal(month.was,'vs 0%');assert.equal(month.verdict,'Better');
 const week=metricCells(turns.filter(t=>Date.parse(t.at)>now-3.5*DAY),{now,period:'week'}).find(c=>c.key==='verified_rate');
 assert.equal(week.was,'nothing last week');
});
