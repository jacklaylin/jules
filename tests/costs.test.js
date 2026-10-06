import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,validateEntry,validDate} from '../lib/costs.js';
import {createCostsHandler} from '../api/costs.js';
test('missing services remain unknown; leap month allocation and explicit zero',()=>{
 const report=summarize('2024-02-05',[{service:'openai',kind:'usage',date:'2024-02-05',amount:2},{service:'openai',kind:'subscription',date:'2024-02-01',amount:29},{service:'github',kind:'usage',date:'2024-02-05',amount:0}]);
 assert.equal(report.total,3);assert.equal(report.rows[0].daily,1);assert.equal(report.missing,6);assert.equal(report.rows[5].usage,0);assert.equal(report.rows[1].usage,null);
});
test('reject invalid dates, amounts, services and subscription dates',()=>{
 const entry={service:'openai',kind:'usage',date:'2026-10-06',amount:0,note:''};assert.deepEqual(validateEntry(entry),entry);
 for(const change of [{date:'2026-02-30'},{amount:-1},{amount:NaN},{amount:'2'},{service:'unknown'},{kind:'subscription'}])assert.throws(()=>validateEntry({...entry,...change}));
 assert.equal(validDate(null),false);
});
test('unauthenticated cost access never touches database',async()=>{
 const handler=createCostsHandler({auth:async()=>403,storeFactory:()=>{throw new Error('must not run');}});
 const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
 await handler({headers:{},method:'GET',url:'/api/costs?date=2026-10-06'},res);assert.equal(res.statusCode,403);
});

import {openaiCosts,serpapiCredits,billingSnapshot} from '../lib/billing.js';
const billingEnv={OPENAI_BILLING_ADMIN_KEY:'private-test-key',OPENAI_BILLING_PROJECT_ID:'proj_test'};
const bucket=(date,value)=>({start_time:Date.parse(date+'T00:00:00Z')/1000,results:[{amount:{currency:'usd',value}}]});
test('empty ledger total is unknown',()=>assert.equal(summarize('2026-10-06',[]).total,null));
test('OpenAI uses UTC project filter and paginates, separating daily from period total',async()=>{
 let calls=0;
 const result=await openaiCosts('2026-10-06',billingEnv,async(url,options)=>{
  const u=new URL(url);assert.equal(u.searchParams.get('project_ids[]'),'proj_test');assert.equal(u.searchParams.get('end_time'),String(Date.parse('2026-10-07T00:00:00Z')/1000));assert.equal(options.headers.Authorization,'Bearer private-test-key');
  calls++;
  return {ok:true,json:async()=>calls===1?{data:[bucket('2026-10-05',.1)],has_more:true,next_page:'next'}:{data:[bucket('2026-10-06',.02)],has_more:false}};
 });
 assert.equal(calls,2);assert.equal(result.daily,.02);assert.ok(Math.abs(result.periodTotal-.12)<1e-10);assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('missing credentials never call provider; missing daily bucket remains unknown',async()=>{
 assert.equal((await openaiCosts('2026-10-06',{},()=>{throw new Error('must not fetch');})).status,'not_connected');
 const result=await openaiCosts('2026-10-06',billingEnv,async()=>({ok:true,json:async()=>({data:[],has_more:false})}));assert.equal(result.daily,null);
});
test('unsupported currencies and incomplete pages fail rather than reporting zero',async()=>{
 await assert.rejects(openaiCosts('2026-10-06',billingEnv,async()=>({ok:true,json:async()=>({data:[{...bucket('2026-10-06',1),results:[{amount:{currency:'eur',value:1}}]}],has_more:false})})));
 const report=await billingSnapshot('2026-10-06',billingEnv,async()=>({ok:false,status:403}));assert.equal(report.openai.status,'error');
});
test('SerpApi returns safe account counters without secret or email',async()=>{
 const result=await serpapiCredits({SERPAPI_API_KEY:'private-test'},async()=>({ok:true,json:async()=>({api_key:'private-test',account_email:'private@example.com',this_month_usage:35,total_searches_left:215,searches_per_month:250})}));
 assert.equal(result.used,35);assert.equal(result.remaining,215);assert.ok(!JSON.stringify(result).includes('private-test'));assert.ok(!JSON.stringify(result).includes('private@example.com'));
});
test('billing sync overlays manual OpenAI usage without double counting',async()=>{
 const handler=createCostsHandler({auth:async()=>200,storeFactory:()=>({costEntries:async()=>[{service:'openai',kind:'usage',date:'2026-10-06',amount:9}]}),billing:async()=>({openai:{status:'connected',daily:.12},serpapi:{status:'not_connected'}})});
 const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
 await handler({headers:{},method:'GET',url:'/api/costs?date=2026-10-06'},res);assert.equal(res.body.total,.12);assert.equal(res.body.rows[1].total,null);
});

import {githubCosts,vercelCosts} from '../lib/billing.js';
test('GitHub filters repository and day and sums net charges including discounts',async()=>{
 const result=await githubCosts('2026-10-06',{GITHUB_BILLING_TOKEN:'secret',GITHUB_BILLING_USER:'founder',GITHUB_BILLING_REPOSITORY:'founder/jules'},async url=>{
 const params=new URL(url).searchParams;assert.equal(params.get('repository'),'founder/jules');assert.equal(params.get('day'),'6');
 return {ok:true,json:async()=>({usageItems:[{netAmount:.2},{netAmount:-.05}]})};});assert.ok(Math.abs(result.daily-.15)<1e-10);
});
const vercelEnv={VERCEL_BILLING_TOKEN:'secret',VERCEL_BILLING_TEAM_SLUG:'jules',VERCEL_BILLING_PROJECT_ID:'prj_jules'};
const charge={BillingCurrency:'USD',BilledCost:'0.12',Tags:{ProjectId:'prj_jules'},ChargePeriodStart:'2026-10-06T00:00:00Z',ChargePeriodEnd:'2026-10-07T00:00:00Z'};
test('Vercel attributes exact project and separates unallocated team charges',async()=>{
 const rows=[charge,{...charge,BilledCost:'8',Tags:{ProjectId:'prj_other'}},{...charge,BilledCost:'2',Tags:{}}];
 const result=await vercelCosts('2026-10-06',vercelEnv,async url=>{assert.equal(new URL(url).searchParams.get('slug'),'jules');return {ok:true,text:async()=>rows.map(JSON.stringify).join('\n')};});assert.equal(result.daily,.12);assert.equal(result.unallocated,2);
});
test('Vercel rejects malformed money and ambiguous multi-day costs',async()=>{
 for(const row of [{...charge,BilledCost:'oops'},{...charge,ChargePeriodStart:'2026-10-01T00:00:00Z'}])await assert.rejects(vercelCosts('2026-10-06',vercelEnv,async()=>({ok:true,text:async()=>JSON.stringify(row)})));
});
test('unavailable provider billing stays unknown',async()=>{
 const report=await billingSnapshot('2026-10-06',vercelEnv,async()=>({ok:false,status:403}));assert.equal(report.vercel.status,'error');assert.equal(report.github.status,'not_connected');
});
