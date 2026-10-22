import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport,priceMetered,validateEntry,validDate,lifetimeMonths,lifetimeTotal} from '../lib/costs.js';
import {createCostsHandler} from '../api/costs.js';
import {openaiCosts,serpapiAccount,githubCosts,vercelCosts,billingSnapshot} from '../lib/billing.js';
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

test('GitHub filters repository and day and sums net charges including discounts',async()=>{
 const result=await githubCosts('2026-10-06',{GITHUB_BILLING_TOKEN:'secret',GITHUB_BILLING_USER:'founder',GITHUB_BILLING_REPOSITORY:'founder/jules'},async url=>{
 const params=new URL(url).searchParams;assert.equal(params.get('repository'),'founder/jules');assert.equal(params.get('day'),'6');
 return {ok:true,json:async()=>({usageItems:[{netAmount:.2},{netAmount:-.05}]})};});assert.ok(Math.abs(result.days['2026-10-06']-.15)<1e-10);
});
const noBilling={openai:{status:'not_connected'},serpapi:{status:'not_connected'},github:{status:'not_connected'},vercel:{status:'not_connected'}};
const row=(report,id)=>report.rows.find(r=>r.id===id);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('empty ledger: every service unknown, never $0',()=>{
 const report=buildReport({date:'2026-10-06',entries:[],providers:noBilling,metered:[]});
 assert.equal(report.totals.today,null);assert.equal(report.totals.month,null);assert.equal(report.totals.projected,null);
 assert.equal(report.incomplete.length,8);assert.ok(report.rows.every(r=>r.basis==='unknown'));
});

test('manual services: fee spread over the month, usage summed, projection from entered days',()=>{
 const entries=[{service:'supabase',kind:'subscription',date:'2024-02-01',amount:29,updated_at:'2024-02-03T10:00:00Z'},
  {service:'photon',kind:'usage',date:'2024-02-02',amount:1},{service:'photon',kind:'usage',date:'2024-02-04',amount:3,updated_at:'2024-02-04T09:00:00Z'}];
 const report=buildReport({date:'2024-02-05',entries,providers:noBilling,metered:null});
 const supabase=row(report,'supabase'), photon=row(report,'photon');
 close(supabase.today,1);close(supabase.month,5);close(supabase.projected,29);assert.equal(supabase.basis,'manual');assert.equal(supabase.updated,'2024-02-03T10:00:00Z');
 assert.equal(photon.today,null);close(photon.month,4);close(photon.projected,2*29);assert.equal(photon.complete,false);assert.equal(supabase.complete,true);
 close(report.totals.month,9);assert.ok(report.incomplete.includes('Photon'));
});

test('OpenAI: billed days win, unreported recent days use the metered estimate, other projects excluded',()=>{
 const providers={...noBilling,openai:{status:'connected',days:{'2026-10-01':1,'2026-10-02':2,'2026-10-03':0},otherProjects:5,checkedAt:'2026-10-03T12:00:00Z',message:'OpenAI'}};
 // 1M input tokens of gpt-4.1-mini = $0.40 at list price.
 const metered=[{day:'2026-10-03',feature:'chat',provider:'openai',model:'gpt-4.1-mini-2025-04-14',calls:10,input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0},
  {day:'2026-10-02',feature:'chat',provider:'openai',model:'gpt-4.1-mini',calls:10,input_tokens:5e6,cached_tokens:0,output_tokens:0,web_search_calls:0}];
 const report=buildReport({date:'2026-10-03',entries:[{service:'openai',kind:'usage',date:'2026-10-02',amount:99}],providers,metered,now:new Date('2026-10-03T15:00:00Z')});
 const openai=row(report,'openai');
 close(openai.today,.4);close(openai.month,3.4);close(openai.projected,3.4/3*31);
 assert.equal(openai.basis,'billed+estimate');assert.equal(openai.complete,true);assert.ok(openai.notes.some(n=>n.includes('$5.00')));
});

test('OpenAI billed zero on an old day is trusted, not replaced by an estimate',()=>{
 const providers={...noBilling,openai:{status:'connected',days:{'2026-10-01':0},otherProjects:0,checkedAt:'x',message:''}};
 const metered=[{day:'2026-10-01',feature:'chat',provider:'openai',model:'gpt-4.1-mini',calls:1,input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0}];
 const openai=row(buildReport({date:'2026-10-01',entries:[],providers,metered,now:new Date('2026-10-10T00:00:00Z')}),'openai');
 assert.equal(openai.today,0);assert.equal(openai.basis,'billed');
});

test('OpenAI without billing falls back to labeled estimates; unknown models are unpriced, not $0',()=>{
 const metered=[{day:'2026-10-02',feature:'style_report',provider:'openai',model:'gpt-9',calls:3,input_tokens:1000,cached_tokens:0,output_tokens:500,web_search_calls:0},
  {day:'2026-10-02',feature:'chat',provider:'openai',model:'gpt-4.1-mini',calls:1,input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0}];
 const report=buildReport({date:'2026-10-02',entries:[],providers:noBilling,metered});
 const openai=row(report,'openai');
 close(openai.today,.4);assert.equal(openai.basis,'estimate');assert.ok(openai.notes.some(n=>n.includes('gpt-9')));
 const style=report.features.features.find(f=>f.feature==='style_report');assert.equal(style.unpriced,true);assert.equal(style.aiCalls,3);assert.equal(style.month,0);
 assert.deepEqual(report.features.unpriced,['gpt-9']);
});

test('SerpApi: plan price is the billed cost and prices each search as a plan share',()=>{
 const serpapi={status:'connected',planName:'Developer',monthlyPrice:75,allowance:5000,used:100,remaining:4900,renewalDate:'2026-11-03',checkedAt:'2026-10-10T00:00:00Z'};
 const metered=[{day:'2026-10-10',feature:'chat',provider:'serpapi',model:'google_shopping',calls:40,units:40},{day:'2026-10-09',feature:'eval_agent',provider:'serpapi',model:'google',calls:10,units:10}];
 const report=buildReport({date:'2026-10-10',entries:[{service:'serpapi',kind:'subscription',date:'2026-10-01',amount:999}],providers:{...noBilling,serpapi},metered});
 const s=row(report,'serpapi');
 close(s.today,75/31);close(s.month,75*10/31);close(s.projected,75);assert.equal(s.basis,'billed');assert.equal(s.complete,true);
 assert.ok(s.notes.some(n=>n.includes('100 of 5000')));assert.ok(s.notes.some(n=>n.includes('ignored')));
 const chat=report.features.features.find(f=>f.feature==='chat');assert.equal(chat.searches,40);close(chat.today,40*.015);close(report.features.evalsMonth,.15);
});

test('SerpApi with no plan price and no setting leaves search costs unknown',()=>{
 const priced=priceMetered([{day:'2026-10-10',feature:'chat',provider:'serpapi',calls:4,units:4}],{status:'connected',monthlyPrice:null,allowance:250},{});
 assert.equal(priced.rows[0].cost,null);assert.equal(priced.perSearch,null);
});

test('Vercel: daily usage billed, plan fee spread over the days it covers',()=>{
 const vercel={status:'connected',days:{'2026-10-02':.5},fixedDays:{'2026-10-01':1,'2026-10-02':1},fixed:[{amount:31}],otherProjects:0,checkedAt:'t',message:''};
 const v=row(buildReport({date:'2026-10-02',entries:[],providers:{...noBilling,vercel},metered:[]}),'vercel');
 close(v.today,1.5);close(v.month,2.5);close(v.projected,.25*31+2+29);assert.equal(v.basis,'billed');assert.equal(v.complete,true);
});

test('provider errors keep the service unknown or manual and say why',()=>{
 const report=buildReport({date:'2026-10-02',entries:[],providers:{...noBilling,vercel:{status:'error',message:'Billing sync failed (HTTP 403: the key was rejected).'}},metered:[]});
 const v=row(report,'vercel');assert.equal(v.month,null);assert.ok(v.notes[0].includes('403'));
});

const vercelEnv={VERCEL_BILLING_TOKEN:'secret',VERCEL_BILLING_TEAM_SLUG:'jules',VERCEL_BILLING_PROJECT_ID:'prj_jules'};
const charge={BillingCurrency:'USD',BilledCost:'0.12',ChargeCategory:'Usage',Tags:{ProjectId:'prj_jules'},ChargePeriodStart:'2026-10-06T00:00:00Z',ChargePeriodEnd:'2026-10-07T00:00:00Z'};
test('Vercel reader: month range, project filter, untagged team fees counted, multi-day fees spread',async()=>{
 const rows=[charge,{...charge,BilledCost:'8',Tags:{ProjectId:'prj_other'}},{...charge,ChargePeriodStart:'2026-10-02T00:00:00Z',ChargePeriodEnd:'2026-10-03T00:00:00Z',BilledCost:0.3,Tags:{}},
  {...charge,ChargeCategory:'Purchase',BilledCost:'20',Tags:{},ChargePeriodStart:'2026-09-21T00:00:00Z',ChargePeriodEnd:'2026-10-11T00:00:00Z'}];
 const result=await vercelCosts('2026-10-06',vercelEnv,async url=>{const p=new URL(url).searchParams;assert.equal(p.get('from'),'2026-10-01T00:00:00.000Z');assert.equal(p.get('to'),'2026-10-07T00:00:00.000Z');return {ok:true,text:async()=>rows.map(JSON.stringify).join('\n')};});
 close(result.days['2026-10-06'],.12);close(result.days['2026-10-02'],.3);assert.equal(result.otherProjects,8);
 assert.equal(Object.keys(result.fixedDays).length,6);close(result.fixedDays['2026-10-01'],1);assert.equal(result.days['2026-09-21'],undefined);
 assert.ok(!JSON.stringify(result).includes('secret'));
});
test('Vercel reader rejects malformed money and works without a project ID',async()=>{
 await assert.rejects(vercelCosts('2026-10-06',vercelEnv,async()=>({ok:true,text:async()=>JSON.stringify({...charge,BilledCost:'oops'})})));
 const team=await vercelCosts('2026-10-06',{...vercelEnv,VERCEL_BILLING_PROJECT_ID:''},async()=>({ok:true,text:async()=>[charge,{...charge,Tags:{ProjectId:'prj_other'}}].map(JSON.stringify).join('\n')}));
 close(team.days['2026-10-06'],.24);assert.equal(team.scope,'team');
});

const bucket=(date,results)=>({start_time:Date.parse(date+'T00:00:00Z')/1000,results});
test('OpenAI reader groups by project, paginates, and separates other projects',async()=>{
 let calls=0;
 const result=await openaiCosts('2026-10-06',{OPENAI_BILLING_ADMIN_KEY:'private-test-key',OPENAI_BILLING_PROJECT_ID:'proj_test'},async(url,options)=>{
  const u=new URL(url);assert.equal(u.searchParams.get('group_by'),'project_id');assert.equal(u.searchParams.get('start_time'),String(Date.parse('2026-10-01T00:00:00Z')/1000));assert.equal(u.searchParams.get('end_time'),String(Date.parse('2026-10-07T00:00:00Z')/1000));assert.equal(options.headers.Authorization,'Bearer private-test-key');
  calls++;
  return {ok:true,json:async()=>calls===1?{data:[bucket('2026-10-05',[{project_id:'proj_test',amount:{currency:'usd',value:.1}},{project_id:'proj_x',amount:{currency:'usd',value:3}}])],has_more:true,next_page:'next'}:{data:[bucket('2026-10-06',[])],has_more:false}};
 });
 assert.equal(calls,2);close(result.days['2026-10-05'],.1);assert.equal(result.days['2026-10-06'],0);assert.equal(result.otherProjects,3);assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('OpenAI reader: no key means no request; bad currency fails rather than reporting zero',async()=>{
 assert.equal((await openaiCosts('2026-10-06',{},()=>{throw new Error('must not fetch');})).status,'not_connected');
 await assert.rejects(openaiCosts('2026-10-06',{OPENAI_BILLING_ADMIN_KEY:'k'},async()=>({ok:true,json:async()=>({data:[bucket('2026-10-06',[{amount:{currency:'eur',value:1}}])],has_more:false})})));
 const report=await billingSnapshot('2026-10-06',{OPENAI_BILLING_ADMIN_KEY:'k'},async()=>({ok:false,status:401}));assert.equal(report.openai.status,'error');assert.ok(report.openai.message.includes('rejected'));
});
test('SerpApi reader returns plan and price without secret or email',async()=>{
 const result=await serpapiAccount({SERPAPI_API_KEY:'private-test'},async()=>({ok:true,json:async()=>({api_key:'private-test',account_email:'private@example.com',plan_name:'Developer',plan_monthly_price:75,plan_renewal_date:'2026-11-03',this_month_usage:35,total_searches_left:4965,searches_per_month:5000,extra_credits:0})}));
 assert.equal(result.monthlyPrice,75);assert.equal(result.used,35);assert.equal(result.renewalDate,'2026-11-03');
 assert.ok(!JSON.stringify(result).includes('private-test'));assert.ok(!JSON.stringify(result).includes('private@example.com'));
 const noPrice=await serpapiAccount({SERPAPI_API_KEY:'k'},async()=>({ok:true,json:async()=>({this_month_usage:1,total_searches_left:2,searches_per_month:3})}));assert.equal(noPrice.monthlyPrice,null);
});

test('costs API: report with features; a missing usage view never takes the page down',async()=>{
 const metered=[{day:'2026-10-15',feature:'chat',provider:'openai',model:'gpt-4.1-mini',calls:2,input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0}];
 const respond=async store=>{const handler=createCostsHandler({auth:async()=>200,storeFactory:()=>store,billing:async()=>noBilling});const res={setHeader(){},end(body){this.body=JSON.parse(body);}};await handler({headers:{},method:'GET',url:'/api/costs?date=2026-10-15'},res);return res;};
 const ok=await respond({costEntries:async()=>[],meteredMonth:async date=>{assert.equal(date,'2026-10-15');return metered;}});
 assert.equal(ok.statusCode,200);close(ok.body.features.today,.4);close(ok.body.totals.today,.4);
 const broken=await respond({costEntries:async()=>[],meteredMonth:async()=>{throw Error('missing view');}});
 assert.equal(broken.statusCode,200);assert.equal(broken.body.features,null);assert.ok(broken.body.featureNotice.includes('031'));assert.equal(broken.body.rows.length,8);
});

test('a monthly fee and budget carry forward until a later month replaces them',()=>{
 const entries=[{service:'photon',kind:'subscription',date:'2026-08-01',amount:250},{service:'photon',kind:'subscription',date:'2026-06-01',amount:99},
  {service:'supabase',kind:'subscription',date:'2026-09-01',amount:25},{service:'supabase',kind:'subscription',date:'2026-10-01',amount:0},
  {service:'codex',kind:'subscription',date:'2026-11-01',amount:20},{service:'openai',kind:'budget',date:'2026-09-01',amount:5}];
 const report=buildReport({date:'2026-10-10',entries,providers:noBilling,metered:[]});
 const photon=row(report,'photon'), supabase=row(report,'supabase'), codex=row(report,'codex');
 close(photon.projected,250);assert.equal(photon.complete,true);assert.ok(photon.notes.some(n=>n.includes('carried forward from August 2026')));
 assert.equal(supabase.projected,0);assert.ok(!supabase.notes.some(n=>n.includes('carried')));
 assert.equal(codex.projected,null);assert.equal(codex.complete,false); // a later month's fee never applies backwards
 assert.equal(report.budget,5);
 // A provider-reported plan price replaces a carried manual fee, without the carried note.
 const serpapi={status:'connected',planName:'Developer',monthlyPrice:75,allowance:5000,used:1,remaining:4999,renewalDate:null,checkedAt:'t'};
 const s=row(buildReport({date:'2026-10-10',entries:[{service:'serpapi',kind:'subscription',date:'2026-08-01',amount:50}],providers:{...noBilling,serpapi},metered:[]}),'serpapi');
 close(s.projected,75);assert.ok(!s.notes.some(n=>n.includes('carried')));
});

test('a billing connection that is not set up says what to add',()=>{
 const report=buildReport({date:'2026-10-10',entries:[],providers:{...noBilling,vercel:{status:'not_connected',message:'Add VERCEL_BILLING_TOKEN and VERCEL_BILLING_TEAM_SLUG in Vercel to read Vercel billing.'}},metered:[]});
 assert.ok(row(report,'vercel').notes[0].includes('VERCEL_BILLING_TOKEN'));
});

test('OpenRouter calls get their own row, stay out of the OpenAI bill comparison, and use the reported cost when unlisted',()=>{
 const metered=[
  {day:'2026-10-05',feature:'chat',provider:'openai',model:'gpt-6-luna',calls:2,units:2,input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0,cost_usd:0.1,last_at:'2026-10-05T10:00:00Z'},
  {day:'2026-10-05',feature:'chat',provider:'openrouter',model:'anthropic/claude-haiku-5.5',calls:1,units:1,input_tokens:1e6,cached_tokens:0,output_tokens:0,web_search_calls:0,cost_usd:0.1,last_at:'2026-10-05T10:00:00Z'},
  {day:'2026-10-05',feature:'chat',provider:'openrouter',model:'openai/gpt-oss-120b',calls:1,units:1,input_tokens:5000,cached_tokens:0,output_tokens:100,web_search_calls:0,cost_usd:0.0042,last_at:'2026-10-05T11:00:00Z'},
 ];
 const priced=priceMetered(metered,null);
 assert.deepEqual(priced.rows.map(r=>[r.provider,Number(r.cost.toFixed(4))]),[['openai',0.1],['openrouter',0.1],['openrouter',0.0042]]);
 assert.deepEqual(priced.unpriced,[]);
 const report=buildReport({date:'2026-10-05',entries:[],providers:noBilling,metered});
 close(row(report,'openai').today,0.1);close(row(report,'openrouter').today,0.1042);
 assert.equal(row(report,'openrouter').complete,true);
 assert.equal(buildReport({date:'2026-10-05',entries:[],providers:noBilling,metered:metered.slice(0,1)}).rows.some(r=>r.id==='openrouter'),false);
});

test('lifetime: whole earlier months from October 2026 plus this month to date, gaps named by month',async()=>{
 assert.deepEqual(lifetimeMonths('2026-10-21'),[]);
 assert.deepEqual(lifetimeMonths('2027-01-05'),['2026-10-31','2026-11-30','2026-12-31']);
 const claude={service:'claude',kind:'subscription',date:'2026-10-01',amount:100,note:''};
 const oct=buildReport({date:'2026-10-31',entries:[claude],providers:noBilling,metered:[]});
 const nov=buildReport({date:'2026-11-15',entries:[claude],providers:noBilling,metered:[]});
 const life=lifetimeTotal([oct,nov]);
 close(life.total,100+50);assert.equal(life.through,'2026-11-15');
 assert.deepEqual(life.gaps.map(g=>g.month),['2026-10','2026-11']);assert.ok(life.gaps[0].services.includes('Photon'));
 assert.equal(lifetimeTotal([buildReport({date:'2026-10-06',entries:[],providers:noBilling,metered:[]})]).total,null);
 // The handler adds earlier months; SerpApi's current plan is not applied to a past month.
 const serpapi={status:'connected',monthlyPrice:75,allowance:5000,used:1,remaining:4999,planName:'Dev',checkedAt:'x',message:''};
 const store={costEntries:async()=>[claude],meteredMonth:async()=>[],jobUsageMonth:async()=>[],jobRunsMonth:async()=>[],scheduledJobs:async()=>[],list:async()=>[]};
 const handler=createCostsHandler({auth:async()=>200,storeFactory:()=>store,billing:async()=>({...noBilling,serpapi}),env:{}});
 const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
 await handler({headers:{},method:'GET',url:'/api/costs?date=2026-11-15'},res);
 assert.equal(res.statusCode,200);assert.deepEqual(res.body.lifetime.months.map(m=>m.month),['2026-10','2026-11']);
 assert.ok(res.body.lifetime.gaps[0].services.includes('SerpApi'));assert.ok(!res.body.lifetime.gaps[1].services.includes('SerpApi'));
});
