import test from 'node:test';
import assert from 'node:assert/strict';
import {viewOf,money,totalLine,coverageText,budgetText,providerLines,serviceRow,featureRows,meteredText,entryBody} from '../public/costs-view.js';

const rows=[{id:'openai',name:'OpenAI API',url:'u',usage:1.25,daily:0,monthly:0,total:1.25,source:'OpenAI billing',complete:true,note:null},
 {id:'vercel',name:'Vercel',url:'u',usage:0.5,daily:null,monthly:null,total:null,source:'Manual',complete:false,note:'Team plan'}];

test('views are linkable and an unknown view falls back to By service',()=>{
 assert.equal(viewOf('?view=evals'),'evals');
 assert.equal(viewOf('?view=features'),'features');
 assert.equal(viewOf('?view=nope'),'');
 assert.equal(viewOf(''),'');
});

test('the title total never shows unknown costs as zero, and says when it is only a subtotal',()=>{
 assert.deepEqual(totalLine({total:null,missing:2,rows}),{amount:'Unknown',label:'costs unknown'});
 assert.deepEqual(totalLine({total:1.75,missing:1,rows}),{amount:'$1.75',label:'known subtotal'});
 assert.deepEqual(totalLine({total:1.75,missing:0,rows}),{amount:'$1.75',label:'recorded'});
 assert.equal(totalLine(null).amount,'—');
 assert.equal(money(null),'Unknown');assert.equal(money(0),'$0.00');assert.equal(money(0.01234),'$0.0123');
});

test('coverage and budget go in the status line, with over-budget flagged',()=>{
 assert.match(coverageText({missing:1,rows}),/^1 of 2 services .* incomplete$/);
 assert.match(coverageText({missing:0,rows}),/^All services/);
 assert.deepEqual(budgetText({budget:null,total:3,missing:0}),{text:'No daily warning budget set',over:false});
 assert.deepEqual(budgetText({budget:2,total:3,missing:0}),{text:'Daily warning budget $2.00: over budget',over:true});
 assert.equal(budgetText({budget:5,total:3,missing:1}).text,'Daily warning budget $5.00: coverage incomplete, actual costs may exceed it');
 assert.equal(budgetText({budget:5,total:3,missing:0}).text,'Daily warning budget $5.00: within budget');
 assert.equal(budgetText({budget:5,total:null,missing:2}).over,false);
});

test('service rows keep every ledger column',()=>{
 assert.deepEqual(serviceRow(rows[0]),{id:'openai',name:'OpenAI API',url:'u',note:'',usage:'$1.25',subscription:'$0.00 ($0.00/mo)',total:'$1.25',source:'OpenAI billing',complete:true});
 assert.deepEqual([serviceRow(rows[1]).subscription,serviceRow(rows[1]).total,serviceRow(rows[1]).note],['Unknown','Unknown','Team plan']);
});

test('By feature and Evals split the metered estimate',()=>{
 const metered={features:[{label:'Chat replies',calls:40,cost:0.8,eval:false},{label:'Evals · agent routing (test runs)',calls:200,cost:2,eval:true}],total:2.8,evals:2};
 assert.deepEqual(featureRows(metered,false),[{label:'Chat replies',calls:'40',cost:'$0.80'}]);
 assert.deepEqual(featureRows(metered,true).map(f=>f.label),['Evals · agent routing (test runs)']);
 assert.equal(meteredText(metered,false),'$0.80 estimated from people using Jules · $2.80 including evals');
 assert.equal(meteredText(metered,true),'$2.00 estimated from eval test runs');
 assert.equal(meteredText(null,true),'Metered usage is unavailable');
 assert.equal(meteredText({features:[],total:0,evals:0},false),'No metered calls on this day');
 assert.deepEqual(featureRows(null,false),[]);
});

test('connected billing reports what each provider returned; a disconnected one says only its message',()=>{
 const lines=providerLines({openai:{status:'connected',message:'Connected.',periodStart:'2026-10-01',periodEnd:'2026-10-15',periodTotal:12.5,checkedAt:0},
  serpapi:{status:'missing',message:'Add SERPAPI_KEY to connect.'},vercel:{status:'connected',message:'Connected.',daily:0.4,unallocated:1,checkedAt:0}});
 assert.deepEqual(lines.map(([name])=>name),['OpenAI','SerpApi','Vercel']);
 assert.match(lines[0][1],/2026-10-01 through 2026-10-15 \(UTC\): \$12\.50/);
 assert.equal(lines[1][1],'Add SERPAPI_KEY to connect.');
 assert.match(lines[2][1],/Reported daily charges: \$0\.40\. Excluded unallocated team charges: \$1\.00\./);
});

test('saving an amount: usage is for the day, subscriptions and the budget for that month',()=>{
 assert.deepEqual(entryBody({kind:'usage',service:'vercel',date:'2026-10-15',amount:'1.5',note:''}),{service:'vercel',kind:'usage',date:'2026-10-15',amount:1.5,note:''});
 assert.equal(entryBody({kind:'subscription',service:'vercel',date:'2026-10-15',amount:'20',note:''}).date,'2026-10-01');
 assert.deepEqual(entryBody({kind:'budget',service:'vercel',date:'2026-10-15',amount:'10',note:''}),{service:'openai',kind:'budget',date:'2026-10-01',amount:10,note:''});
});
