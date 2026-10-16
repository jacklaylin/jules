import test from 'node:test';
import assert from 'node:assert/strict';
import {viewOf,periodOf,apiDate,pickerValue,serviceColumns,featureColumn,money,totalLine,coverageText,budgetText,basisLabel,serviceRow,featureRows,meteredText,entryBody} from '../public/costs-view.js';

const rows=[{id:'openai',name:'OpenAI API',url:'u',today:1.25,month:3,projected:31,basis:'billed+estimate',source:'OpenAI Costs API',updated:'2026-10-15T12:00:00Z',notes:['Other projects left out.'],complete:true},
 {id:'vercel',name:'Vercel',url:'u',today:null,month:null,projected:null,basis:'unknown',source:'Manual ledger',updated:null,notes:[],complete:false}];
const report=(over={})=>({date:'2026-10-15',rows,totals:{today:1.25,month:3,projected:31},incomplete:['Vercel'],budget:null,...over});

test('views are linkable and an unknown view falls back to By service',()=>{
 assert.equal(viewOf('?view=evals'),'evals');
 assert.equal(viewOf('?view=features'),'features');
 assert.equal(viewOf('?view=nope'),'');
 assert.equal(viewOf(''),'');
});

test('month is the default period; day is linkable',()=>{
 assert.equal(periodOf(''),'month');assert.equal(periodOf('?period=day&view=evals'),'day');assert.equal(periodOf('?period=week'),'month');
});

test('a month reports through today while running and through its last day once over; future days clamp to today',()=>{
 assert.equal(apiDate('month','2026-10','2026-10-16'),'2026-10-16');
 assert.equal(apiDate('month','2026-09','2026-10-16'),'2026-09-30');
 assert.equal(apiDate('month','2024-02','2026-10-16'),'2024-02-29');
 assert.equal(apiDate('month','2027-01','2026-10-16'),'2026-10-16');
 assert.equal(apiDate('day','2026-10-03','2026-10-16'),'2026-10-03');
 assert.equal(apiDate('day','2026-11-01','2026-10-16'),'2026-10-16');
 // Switching period keeps the month.
 assert.equal(pickerValue('month','2026-09-05','2026-10-16'),'2026-09');
 assert.equal(pickerValue('day','2026-09','2026-10-16'),'2026-09-30');
 assert.equal(pickerValue('day','2026-10','2026-10-16'),'2026-10-16');
});

test('columns follow the period: a running month projects, a finished month does not, a day shows the day',()=>{
 assert.deepEqual(serviceColumns('month',report()).map(([k])=>k),['month','projected']);
 assert.deepEqual(serviceColumns('month',report({date:'2026-09-30'})),[['month','Month']]);
 assert.deepEqual(serviceColumns('day',report()),[['today','Day']]);
 assert.deepEqual(featureColumn('month',report()),['month','Month to date']);
 assert.deepEqual(featureColumn('day',report()),['today','Day']);
});

test('the title shows the month by default, the day as an option; unknown is never $0',()=>{
 const line=totalLine(report());
 assert.equal(line.amount,'$3.00');
 assert.match(line.label,/^October 2026 to date, through 2026-10-15 \(UTC\) · projected month end \$31\.00 \(calculated\) · known part only$/);
 assert.match(totalLine(report({date:'2026-09-30'})).label,/^September 2026 \(UTC\), whole month/);
 const day=totalLine(report(),'day');
 assert.equal(day.amount,'$1.25');assert.match(day.label,/^2026-10-15 \(UTC\) · month to date \$3\.00 · known part only$/);
 assert.equal(totalLine(report({totals:{today:null,month:null,projected:null}})).amount,'Unknown');
 assert.doesNotMatch(totalLine(report({incomplete:[]})).label,/known part/);
 assert.equal(totalLine(null).amount,'—');
 assert.equal(money(null),'Unknown');assert.equal(money(0),'$0.00');assert.equal(money(0.01234),'$0.0123');assert.equal(money(31),'$31.00');
});

test('coverage names incomplete services; the budget is compared with the day',()=>{
 assert.equal(coverageText(report()),'Incomplete: Vercel, so totals include only what is known');
 assert.equal(coverageText(report({incomplete:[]})),'Every service is covered');
 assert.deepEqual(budgetText(report()),{text:'No daily warning budget set',over:false});
 assert.deepEqual(budgetText(report({budget:1}),'month'),{text:'',over:false});
 assert.deepEqual(budgetText(report({budget:1,incomplete:[]})),{text:'Daily warning budget $1.00: over budget',over:true});
 assert.equal(budgetText(report({budget:5})).text,'Daily warning budget $5.00: coverage incomplete, actual costs may exceed it');
 assert.equal(budgetText(report({budget:5,incomplete:[]})).text,'Daily warning budget $5.00: within budget');
 assert.equal(budgetText(report({budget:5,totals:{today:null,month:null,projected:null}})).over,false);
});

test('service rows say how each number is known and when it was updated',()=>{
 const openai=serviceRow(rows[0]), vercel=serviceRow(rows[1]);
 assert.deepEqual([openai.today,openai.month,openai.projected,openai.basis,openai.badge],['$1.25','$3.00','$31.00','Billed + Estimate','']);
 assert.notEqual(openai.updated,'Never');assert.deepEqual(openai.notes,['Other projects left out.']);
 assert.deepEqual([vercel.today,vercel.basis,vercel.badge,vercel.updated],['Unknown','Not recorded · incomplete','warn','Never']);
 assert.equal(serviceRow({...rows[0],basis:'billed'}).badge,'ok');
 assert.equal(basisLabel('manual'),'Manual');
});

test('By feature and Evals split the metered estimate, with calls, searches and unpriced models',()=>{
 const features={features:[{label:'Chat replies',aiCalls:40,searches:12,today:.2,month:.8,eval:false,unpriced:false},{label:'Style report',aiCalls:2,searches:0,today:0,month:0,eval:false,unpriced:true},{label:'Evals · agent routing (test runs)',aiCalls:200,searches:0,today:0,month:2,eval:true,unpriced:false}],
  today:.2,month:2.8,evalsMonth:2,perSearch:{value:.015,basis:'plan'},unpriced:['gpt-5.5']};
 assert.deepEqual(featureRows(features,false),[{label:'Chat replies',aiCalls:'40',searches:'12',today:'$0.20',month:'$0.80'},{label:'Style report',aiCalls:'2',searches:'0',today:'$0.00',month:'$0.00 + unpriced'}]);
 assert.deepEqual(featureRows(features,true).map(f=>f.label),['Evals · agent routing (test runs)']);
 const text=meteredText({features},false);
 assert.match(text,/^\$0\.80 estimated from people using Jules this month · \$2\.80 including evals/);
 assert.match(text,/searches at \$0\.015 each \(SerpApi plan price/);assert.match(text,/gpt-5\.5/);
 assert.match(meteredText({features:{...features,perSearch:null}},false),/search costs unknown/);
 assert.match(meteredText({features},true),/^\$2\.00 estimated from eval test runs/);
 assert.match(meteredText({features},false,'day'),/^\$0\.20 estimated from people using Jules on this day · \$0\.20 including evals/);
 assert.equal(meteredText({features:null,featureNotice:'Run db/031.'},true),'Run db/031.');
 assert.equal(meteredText({features:{...features,features:[]}},false),'No metered calls this month');
 assert.deepEqual(featureRows(null,false),[]);
});

test('saving an amount: usage is for the day, subscriptions and the budget for that month',()=>{
 assert.deepEqual(entryBody({kind:'usage',service:'vercel',date:'2026-10-15',amount:'1.5',note:''}),{service:'vercel',kind:'usage',date:'2026-10-15',amount:1.5,note:''});
 assert.equal(entryBody({kind:'subscription',service:'vercel',date:'2026-10-15',amount:'20',note:''}).date,'2026-10-01');
 assert.deepEqual(entryBody({kind:'budget',service:'vercel',date:'2026-10-15',amount:'10',note:''}),{service:'openai',kind:'budget',date:'2026-10-01',amount:10,note:''});
});
