import test from 'node:test';
import assert from 'node:assert/strict';
import {nudgeDecision,sendingHours,localDay,recordNudge,nudgeTimezone,backoffUntil,nudgeSummary,NUDGE_OPERATIONS,LIMITS,BACKOFF} from '../lib/nudges.js';

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

test('back off: two nudges in a row with no reply for two days pause nudges for 14 days',()=>{
 const first=goesWith(NOW-5*DAY),second=fitCheck(NOW-3*DAY);
 // Both unanswered, the newer one for over two days: paused until 16 days after it.
 const paused=nudgeDecision({now:NOW,sent:[first,second],lastInbound:new Date(NOW-10*DAY).toISOString()});
 assert.deepEqual([paused.send,paused.reason,paused.until],[false,'ignored_backoff',new Date(NOW-3*DAY+16*DAY).toISOString()]);
 assert.equal(backoffUntil({sent:[first,second],now:NOW}),NOW-3*DAY+16*DAY,'never texted Jules counts as no reply');
 // Any message from them after either nudge resets it.
 assert.equal(nudgeDecision({now:NOW,sent:[first,second],lastInbound:new Date(NOW-4*DAY).toISOString()}).send,true);
 assert.equal(nudgeDecision({now:NOW,sent:[first,second],lastInbound:new Date(NOW-HOUR).toISOString()}).send,true);
 // The newer nudge is not ignored until two days have passed.
 assert.equal(backoffUntil({sent:[goesWith(NOW-5*DAY),goesWith(NOW-DAY)],now:NOW}),null);
 // One ignored nudge is not enough; failed sends, price alerts and test texts never count.
 assert.equal(backoffUntil({sent:[first],now:NOW}),null);
 assert.equal(backoffUntil({sent:[first,{...second,status:'uncertain'}],now:NOW}),null);
 assert.equal(backoffUntil({sent:[first,sent('price-alert:a:1:fp',NOW-3*DAY)],now:NOW}),null);
 assert.equal(backoffUntil({sent:[first,sent(`nudge-test:${OWNER}:x`,NOW-3*DAY)],now:NOW}),null);
 // After 14 days the pause ends.
 assert.equal(nudgeDecision({now:NOW+14*DAY,sent:[first,second],timezone:'America/New_York'}).send,true);
 assert.deepEqual([BACKOFF.ignored,BACKOFF.reply_ms/DAY,BACKOFF.pause_ms/DAY],[2,2,14]);
});

test('the admin summary counts offers, answers and holds per tester, leaving test sends out of the rates',()=>{
 const at=h=>new Date(NOW-h*HOUR).toISOString(),e=(h,kind,status,reason=null,test)=>({at:at(h),kind,status,reason,item_ids:['i'],...(test?{test:true}:{})});
 const rows=[
  {conversation_id:'a',nudges:{log:[e(200,'goes_with','sent'),e(190,'goes_with','replied','accepted'),e(100,'goes_with','sent'),e(99,'goes_with','replied','declined'),e(80,'goes_with','held','quiet_hours'),e(60,'goes_with','sent'),e(50,'fit_check','sent'),e(10,'goes_with','held','ignored_backoff')]}},
  {conversation_id:'b',nudges:{open:{kind:'goes_with',at:at(5)},log:[e(30,'goes_with','sent','x',true),e(29,'goes_with','replied','accepted',true),e(5,'goes_with','sent'),e(4,'goes_with','replied','unrelated')]}},
  {conversation_id:'c',nudges:{log:[]}},
 ];
 const s=nudgeSummary(rows,NOW);
 assert.deepEqual(s.people.map(p=>p.id),['b','a'],'newest decision first; nobody with nothing logged');
 const a=s.people.find(p=>p.id==='a');
 assert.deepEqual([a.offers,a.answered,a.yes,a.no,a.unrelated,a.no_reply,a.fit_checks,a.open],[3,2,1,1,0,1,1,false]);
 assert.deepEqual(a.held,{quiet_hours:1,ignored_backoff:1});
 assert.deepEqual(a.latest,{at:at(10),kind:'goes_with',status:'held',reason:'ignored_backoff'});
 const b=s.people.find(p=>p.id==='b');
 assert.deepEqual([b.offers,b.answered,b.unrelated,b.no_reply,b.tests],[1,0,1,0,2]);
 assert.deepEqual([s.totals.offers,s.totals.answered,s.totals.yes,s.totals.reply_rate,s.totals.yes_rate],[4,2,1,0.5,0.25]);
 assert.equal(s.recent[0].id,'b');assert.equal(s.recent.length,12);
 assert.deepEqual(nudgeSummary([]).totals.reply_rate,null);
});
