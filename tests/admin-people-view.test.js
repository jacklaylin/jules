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

test('the chat quality strip shows six real figures with a verdict, and says when there is no data',()=>{
 const trend={moved:[
  {metric:'first_message_s.median',before:6,after:4,verdict:'better'},
  {metric:'final_result_s.p90',before:60,after:71,verdict:'worse'},
  {metric:'failure_rate',before:0.02,after:0.02,verdict:'unchanged'},
  {metric:'first_try_rate',before:null,after:0.613,verdict:'too few to tell'},
 ],current:{turns:40,timed_turns:31,fallbacks:2,stuck:0,named_accepted:5}};
 const cells=metricCells(trend);
 assert.equal(cells.length,6);
 assert.deepEqual(cells.map(c=>c.tone),['ok','plain','fail','plain','plain','plain']);
 assert.deepEqual(cells[0],{key:'first_message_s.median',label:'First message',value:'4s',tone:'ok',verdict:'Better',was:'Previous 7 days: 6s'});
 assert.equal(cells[1].value,'—');assert.equal(cells[1].verdict,'No data');
 assert.equal(cells[3].value,'2%');assert.equal(cells[3].verdict,'Unchanged');
 assert.equal(cells[5].value,'61%');assert.equal(cells[5].was,'No earlier data');assert.equal(cells[5].verdict,'Too few to tell');
 assert.match(metricsNote(trend.current),/^40 turns \(31 timed\), 2 fallbacks, 0 never delivered, 5 named-product/);
 assert.equal(metricsNote(undefined),'');
});
