import test from 'node:test';
import assert from 'node:assert/strict';
import {nudgeDecision,sendingHours,localDay,recordNudge,nudgeTimezone,NUDGE_OPERATIONS,LIMITS} from '../lib/nudges.js';

const OWNER='owner-1',HOUR=3600000,DAY=24*HOUR;
// 1pm Eastern on a Tuesday (17:00 UTC in daylight time): inside every sending window.
const NOW=Date.parse('2026-10-20T17:00:00Z');
const sent=(operation_id,at,status='sent')=>({operation_id,status,created_at:new Date(at).toISOString()});
const goesWith=at=>sent(NUDGE_OPERATIONS.goes_with(OWNER,new Date(at).toISOString().slice(0,10)),at);
const fitCheck=at=>sent(NUDGE_OPERATIONS.fit_check(OWNER,new Date(at).toISOString().slice(0,10)),at);

test('with no unprompted text yet, a nudge may go out',()=>{
 assert.deepEqual(nudgeDecision({now:NOW}),{send:true,reason:null,zone:'America/New_York'});
 assert.equal(LIMITS.day,1);assert.equal(LIMITS.week,3);
});

test('quiet hours: 9am to 8pm in their own time zone',()=>{
 const at=(iso,tz)=>nudgeDecision({now:Date.parse(iso),timezone:tz});
 assert.equal(at('2026-10-20T15:59:00Z','America/Los_Angeles').reason,'quiet_hours'); // 8:59am
 assert.equal(at('2026-10-20T16:00:00Z','America/Los_Angeles').send,true); // 9am
 assert.equal(at('2026-10-21T02:59:00Z','America/Los_Angeles').send,true); // 7:59pm
 assert.equal(at('2026-10-21T03:00:00Z','America/Los_Angeles').reason,'quiet_hours'); // 8pm
 assert.equal(at('2026-10-20T08:00:00Z','Europe/London').send,true); // 9am in London
 assert.equal(at('2026-10-20T22:00:00Z','Asia/Tokyo').reason,'quiet_hours'); // 7am in Tokyo
});

test('without a known time zone: noon to 8pm Eastern, daytime across the US, in both summer and winter time',()=>{
 assert.equal(nudgeDecision({now:Date.parse('2026-10-20T15:00:00Z')}).reason,'quiet_hours'); // 11am EDT = 8am PT
 assert.equal(nudgeDecision({now:Date.parse('2026-10-20T16:00:00Z')}).send,true); // noon EDT = 9am PT
 assert.equal(nudgeDecision({now:Date.parse('2026-12-15T17:00:00Z')}).send,true); // noon EST: the daily run's hour in winter
 assert.equal(nudgeDecision({now:Date.parse('2026-12-16T01:00:00Z')}).reason,'quiet_hours'); // 8pm EST
 // An invalid stored time zone is treated as unknown.
 assert.deepEqual([sendingHours(NOW,'Mars/Olympus').known,sendingHours(NOW,'Mars/Olympus').zone],[false,'America/New_York']);
 assert.equal(nudgeTimezone({style_report:{timezone:'Europe/Paris'}}),'Europe/Paris');
 assert.equal(nudgeTimezone({style_report:{timezone:'not a zone'}}),null);
 assert.equal(nudgeTimezone(null),null);
});

test('at most one nudge a day, counted in their local day, whatever kind it was',()=>{
 assert.equal(nudgeDecision({now:NOW,sent:[goesWith(NOW-3*HOUR)]}).reason,'daily_cap');
 assert.equal(nudgeDecision({now:NOW,sent:[fitCheck(NOW-3*HOUR)]}).reason,'daily_cap');
 // Yesterday's nudge, a failed or uncertain send, or a test text does not use up today.
 assert.equal(nudgeDecision({now:NOW,sent:[goesWith(NOW-DAY)]}).send,true);
 assert.equal(nudgeDecision({now:NOW,sent:[{...goesWith(NOW-HOUR),status:'uncertain'}]}).send,true);
 assert.equal(nudgeDecision({now:NOW,sent:[sent(`nudge-test:${OWNER}:x`,NOW-HOUR)]}).send,true);
 // 11pm yesterday in Los Angeles is already today in UTC; it is still yesterday for them.
 const lateYesterday=Date.parse('2026-10-20T06:00:00Z'),la='America/Los_Angeles';
 assert.equal(localDay(lateYesterday,la),'2026-10-19');
 assert.equal(nudgeDecision({now:NOW,timezone:la,sent:[goesWith(lateYesterday)]}).send,true);
});

test('no nudge on a day a price alert went out; the alert itself is never held',()=>{
 assert.equal(nudgeDecision({now:NOW,sent:[sent('price-alert:a1:2:fp',NOW-4*HOUR)]}).reason,'price_alert_today');
 assert.equal(nudgeDecision({now:NOW,sent:[sent('price-alert:a1:2:fp',NOW-DAY)]}).send,true);
 // Rehearsal alerts go to the test conversation and do not count.
 assert.equal(nudgeDecision({now:NOW,sent:[sent('price-alert-test:a1:x',NOW-HOUR)]}).send,true);
});

test('at most three nudges in any seven days',()=>{
 const two=[goesWith(NOW-DAY),fitCheck(NOW-3*DAY)];
 assert.equal(nudgeDecision({now:NOW,sent:two}).send,true);
 assert.equal(nudgeDecision({now:NOW,sent:[...two,goesWith(NOW-6*DAY)]}).reason,'weekly_cap');
 assert.equal(nudgeDecision({now:NOW,sent:[...two,goesWith(NOW-8*DAY)]}).send,true);
});

test('STOP and turning purchase texts off in chat stop every nudge, before any other rule',()=>{
 assert.equal(nudgeDecision({now:NOW,optedOut:true}).reason,'opted_out');
 assert.equal(nudgeDecision({now:NOW,textsOn:false}).reason,'texts_off');
 assert.equal(nudgeDecision({now:Date.parse('2026-10-20T04:00:00Z'),optedOut:true}).reason,'opted_out');
});

test('each decision is kept on the row, newest last, at most fifty',()=>{
 const data={};
 for(let n=0;n<55;n++)recordNudge(data,{kind:'goes_with',status:n%2?'held':'sent',reason:n%2?'quiet_hours':null,item_ids:['a','b','c','d','e','f']},NOW+n);
 assert.equal(data.nudges.log.length,50);
 assert.deepEqual(data.nudges.log.at(-1),{at:new Date(NOW+54).toISOString(),kind:'goes_with',status:'sent',reason:null,item_ids:['a','b','c','d','e']});
 assert.equal(recordNudge({},{kind:'goes_with',status:'sent',item_ids:[],test:true}).test,true);
});
