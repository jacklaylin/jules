import test from 'node:test';
import assert from 'node:assert/strict';
import {filterPeople,ago,countLine,metricCells,metricsNote} from '../public/admin-people-view.js';

const people=[{id:'a',sender_id:'+14155550142'},{id:'b',sender_id:'+44 7700 900123'},{id:'c',sender_id:'Tester@Example.com'}];
const now=Date.UTC(2026,9,15,12);

test('search ignores spaces and case on both sides',()=>{
 assert.deepEqual(filterPeople(people,'+1 415').map(p=>p.id),['a']);
 assert.deepEqual(filterPeople(people,'7700900').map(p=>p.id),['b']);
 assert.deepEqual(filterPeople(people,'tester@').map(p=>p.id),['c']);
 assert.equal(filterPeople(people,'  ').length,3);
 assert.equal(filterPeople(people,'999').length,0);
});

test('last activity reads as time ago, and as a date once it is old',()=>{
 assert.equal(ago(now-20e3,now),'just now');
 assert.equal(ago(now-5*60e3,now),'5 min ago');
 assert.equal(ago(now-3600e3,now),'1 hour ago');
 assert.equal(ago(now-5*3600e3,now),'5 hours ago');
 assert.equal(ago(now-30*3600e3,now),'yesterday');
 assert.equal(ago(new Date(now-4*864e5).toISOString(),now),'4 days ago');
 assert.doesNotMatch(ago(now-40*864e5,now),/ago/);
 assert.equal(ago('not a date',now),'—');
});

test('the count says how many a search shows and when the list was refreshed',()=>{
 assert.equal(countLine(10,10,now-60e3,now),'10 people · refreshed 1 min ago');
 assert.equal(countLine(3,10,now,now),'3 of 10 people · refreshed just now');
 assert.equal(countLine(1,1,null,now),'1 person');
});

test('the chat quality strip shows each figure with a plain label, the week before, its sample and an explanation',()=>{
 const trend={moved:[
  {metric:'first_message_s.median',before:6,after:4,verdict:'better',before_n:30,after_n:31},
  {metric:'final_result_s.p90',before:60,after:71,verdict:'worse',before_n:30,after_n:31},
  {metric:'failure_rate',before:0.02,after:0.02,verdict:'unchanged',before_n:50,after_n:40},
  {metric:'first_try_rate',before:null,after:1,verdict:'too few to tell',before_n:0,after_n:1},
 ],current:{turns:40,timed_turns:31,fallbacks:2,stuck:1,named_searches:14,named_accepted:2}};
 const cells=metricCells(trend);
 assert.equal(cells.length,6);
 assert.deepEqual(cells.map(c=>c.label),['First reply','Full answer','Slowest 10%','Failed replies','Written by AI','Found first try']);
 assert.deepEqual(cells.map(c=>c.tone),['ok','plain','fail','plain','plain','plain']);
 assert.deepEqual([cells[0].value,cells[0].verdict,cells[0].was,cells[0].sample],['4s','Better','vs 6s','31 replies']);
 // No number for the period: a dash and "No data", never a figure beside it.
 assert.deepEqual([cells[1].value,cells[1].verdict,cells[1].was,cells[1].sample],['—','No data','nothing before','no replies']);
 assert.deepEqual([cells[3].value,cells[3].sample],['2%','40 messages']);
 assert.deepEqual([cells[5].value,cells[5].verdict,cells[5].was,cells[5].sample],['100%','Too few to tell','nothing before','1 pick']);
 // Every metric explains itself and says which way is good, matching the comparison's direction.
 assert.ok(cells.every(c=>c.explain.length>20));
 assert.deepEqual(cells.map(c=>c.better),['Lower is better.','Lower is better.','Lower is better.','Lower is better.','Higher is better.','Higher is better.']);
 assert.equal(metricsNote(trend.current),'Last 7 days: 40 tester messages, 3 failed (2 generic, 1 never sent), 2 of 14 named-product searches ended in a pick.');
 assert.equal(metricsNote({turns:1,fallbacks:0,stuck:0,named_searches:0}),'Last 7 days: 1 tester message, 0 failed (0 generic, 0 never sent).');
 assert.equal(metricsNote(undefined),'');
});

test('the strip and the comparison agree on which direction is better',async()=>{
 const {compareMetrics}=await import('../lib/chat-metrics.js');
 const summary={turns:9,timed_turns:9,first_timed:9,composed_known:9,named_accepted:9,first_message_s:{median:1},final_result_s:{median:1,p90:1},failure_rate:0.1,model_written_share:0.1,first_try_rate:0.1};
 const moved=compareMetrics(summary,summary);
 for(const cell of metricCells({moved})) assert.equal(cell.better,moved.find(m=>m.metric===cell.key).direction>0?'Higher is better.':'Lower is better.',cell.key);
});
