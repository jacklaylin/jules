// Billing reads only: no inference calls, no provider response bodies or keys logged.
// Each reader returns the provider's own dollars for the selected month through the selected UTC day.
import { validDate } from './costs.js';
const configured = value => typeof value === 'string' && value.length > 0 && !value.startsWith('replace-with');
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0,10);
const monthStart = date => date.slice(0,7)+'-01';
async function get(url, options, fetcher) {
  const response = await fetcher(url,{...options,signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Object.assign(new Error('Billing request failed'),{billingStatus:response.status});
  return response.json();
}

// OpenAI organization Costs API (admin key). Daily buckets grouped by project, so other projects'
// spend is reported separately instead of trusting a filter.
export async function openaiCosts(date, env, fetcher=fetch) {
  if (!configured(env.OPENAI_BILLING_ADMIN_KEY)) return {status:'not_connected',message:'Add OPENAI_BILLING_ADMIN_KEY in Vercel to read OpenAI billing.'};
  if (!validDate(date)) throw new Error('Invalid date');
  const project = configured(env.OPENAI_BILLING_PROJECT_ID) ? env.OPENAI_BILLING_PROJECT_ID : null;
  const start = Date.parse(monthStart(date)+'T00:00:00Z')/1000, end = Date.parse(date+'T00:00:00Z')/1000+86400;
  const days = {}; let otherProjects = 0, page;
  for (let n=0;n<10;n++) {
    const params=new URLSearchParams({start_time:String(start),end_time:String(end),bucket_width:'1d',limit:'31',group_by:'project_id'});
    if(page)params.set('page',page);
    const data=await get('https://api.openai.com/v1/organization/costs?'+params,{headers:{Authorization:`Bearer ${env.OPENAI_BILLING_ADMIN_KEY}`}},fetcher);
    if(!Array.isArray(data.data)||typeof data.has_more!=='boolean')throw new Error('Invalid billing response');
    for(const bucket of data.data){
      if(!Number.isInteger(bucket.start_time)||bucket.start_time<start||bucket.start_time>=end||!Array.isArray(bucket.results))throw new Error('Invalid billing bucket');
      const day=iso(bucket.start_time*1000);
      days[day]??=0;
      for(const row of bucket.results){
        const value=Number(row.amount?.value);
        if(row.amount?.currency!=='usd'||!Number.isFinite(value)||value<0)throw new Error('Unsupported billing amount');
        if(project && row.project_id!==project)otherProjects+=value; else days[day]+=value;
      }
    }
    if(!data.has_more)return {status:'connected',days,otherProjects,scope:project?'project':'organization',checkedAt:new Date().toISOString(),
      message:project?'OpenAI-reported costs for the Jules project. Other projects are left out.':'OpenAI-reported costs for the whole organization (no Jules project ID set).'};
    if(typeof data.next_page!=='string'||!data.next_page||data.next_page===page)throw new Error('Invalid billing pagination');
    page=data.next_page;
  }
  throw new Error('Incomplete billing pagination');
}

// SerpApi Account API: plan, its monthly price and searches used/left. Reading it uses no search credits.
export async function serpapiAccount(env,fetcher=fetch) {
  if(!configured(env.SERPAPI_API_KEY))return {status:'not_connected',message:'Add SERPAPI_API_KEY in Vercel to read the SerpApi plan.'};
  const data=await get('https://serpapi.com/account.json?'+new URLSearchParams({api_key:env.SERPAPI_API_KEY}),{},fetcher);
  const counts=['this_month_usage','total_searches_left','searches_per_month'];
  if(counts.some(key=>!Number.isFinite(data[key])||data[key]<0))throw new Error('Invalid credit response');
  const price=Number.isFinite(data.plan_monthly_price)&&data.plan_monthly_price>=0?data.plan_monthly_price:null;
  return {status:'connected',planName:typeof data.plan_name==='string'?data.plan_name.slice(0,80):null,monthlyPrice:price,
    renewalDate:typeof data.plan_renewal_date==='string'&&validDate(data.plan_renewal_date)?data.plan_renewal_date:null,
    used:data.this_month_usage,remaining:data.total_searches_left,allowance:data.searches_per_month,
    extraCredits:Number.isFinite(data.extra_credits)?data.extra_credits:0,checkedAt:new Date().toISOString(),
    message:price===null?'SerpApi did not report a plan price. Enter the monthly fee by hand.':'SerpApi-reported plan and price. Searches are included in the plan, so the fee is the cost.'};
}

export async function githubCosts(date,env,fetcher=fetch) {
  if(!configured(env.GITHUB_BILLING_TOKEN)||!configured(env.GITHUB_BILLING_USER)||!configured(env.GITHUB_BILLING_REPOSITORY))return {status:'not_connected',message:'Add GITHUB_BILLING_TOKEN, GITHUB_BILLING_USER and GITHUB_BILLING_REPOSITORY in Vercel to read GitHub billing, or enter its fee by hand.'};
  const params=new URLSearchParams({year:date.slice(0,4),month:String(Number(date.slice(5,7))),day:String(Number(date.slice(8,10))),repository:env.GITHUB_BILLING_REPOSITORY});
  const data=await get(`https://api.github.com/users/${encodeURIComponent(env.GITHUB_BILLING_USER)}/settings/billing/usage/summary?${params}`,{headers:{Authorization:`Bearer ${env.GITHUB_BILLING_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}},fetcher);
  if(!Array.isArray(data.usageItems))throw new Error('Invalid GitHub billing response');
  let daily=0;
  for(const item of data.usageItems){if(typeof item.netAmount!=='number'||!Number.isFinite(item.netAmount))throw new Error('Invalid GitHub amount');daily+=item.netAmount;}
  return {status:'connected',days:{[date]:daily},checkedAt:new Date().toISOString(),message:'GitHub-reported net metered charges for the repository on the selected day only. Subscription fees remain manual.'};
}

// Vercel FOCUS charges for the month so far. One-day charges are usage on that day; longer charges
// (plan and seat fees) are spread evenly over the days they cover. With a project ID set, charges
// tagged to other projects are reported separately; untagged team charges (plan, seats) count.
export async function vercelCosts(date,env,fetcher=fetch) {
  if(!configured(env.VERCEL_BILLING_TOKEN)||!configured(env.VERCEL_BILLING_TEAM_SLUG))return {status:'not_connected',message:'Add VERCEL_BILLING_TOKEN and VERCEL_BILLING_TEAM_SLUG in Vercel to read Vercel billing.'};
  if(!validDate(date))throw new Error('Invalid date');
  const project=configured(env.VERCEL_BILLING_PROJECT_ID)?env.VERCEL_BILLING_PROJECT_ID:null;
  const from=Date.parse(monthStart(date)+'T00:00:00Z'), to=Date.parse(date+'T00:00:00Z')+DAY;
  const params=new URLSearchParams({from:new Date(from).toISOString(),to:new Date(to).toISOString(),slug:env.VERCEL_BILLING_TEAM_SLUG});
  const response=await fetcher('https://api.vercel.com/v1/billing/charges?'+params,{headers:{Authorization:`Bearer ${env.VERCEL_BILLING_TOKEN}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Object.assign(new Error('Vercel billing request failed'),{billingStatus:response.status});
  const body=await response.text();if(body.length>20000000)throw new Error('Billing response too large');
  const days={}, fixedDays={}, fixed=[]; let otherProjects=0;
  for(const line of body.split('\n').filter(s=>s.trim())){
    const row=JSON.parse(line);
    const amount=Number(row.BilledCost), start=Date.parse(row.ChargePeriodStart), end=Date.parse(row.ChargePeriodEnd);
    if(row.BillingCurrency!=='USD'||row.BilledCost===null||row.BilledCost===''||!Number.isFinite(amount))throw new Error('Invalid Vercel billing amount');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Invalid Vercel charge period');
    const tagged=row.Tags?.ProjectId;
    if(project&&tagged&&tagged!==project){otherProjects+=amount;continue;}
    if(end-start<=DAY+3600000){const day=iso(start);if(start>=from&&start<to)days[day]=(days[day]??0)+amount;continue;}
    // A multi-day charge: its daily share on each covered day of this month up to the selected day.
    const share=amount/((end-start)/DAY);
    fixed.push({name:String(row.ServiceName??'').slice(0,80),amount,start:iso(start),end:iso(end-1),perDay:share});
    for(let t=Math.max(from,Date.parse(iso(start)+'T00:00:00Z'));t<Math.min(to,end);t+=DAY)fixedDays[iso(t)]=(fixedDays[iso(t)]??0)+share;
  }
  return {status:'connected',days,fixedDays,fixed,otherProjects,scope:project?'project':'team',checkedAt:new Date().toISOString(),
    message:project?'Vercel-reported charges for the Jules project plus team-wide plan and seat fees. Other projects are left out.':'Vercel-reported charges for the whole team (no Jules project ID set).'};
}

export async function billingSnapshot(date,env,fetcher=fetch) {
  const names=['openai','serpapi','github','vercel'];
  const results=await Promise.allSettled([openaiCosts(date,env,fetcher),serpapiAccount(env,fetcher),githubCosts(date,env,fetcher),vercelCosts(date,env,fetcher)]);
  return Object.fromEntries(names.map((name,index)=>{
    if(results[index].status==='fulfilled')return [name,results[index].value];
    const status=results[index].reason?.billingStatus;
    console.log(JSON.stringify({event:'billing_sync_failed',provider:name,status:Number.isInteger(status)?status:null,reason:Number.isInteger(status)?null:String(results[index].reason?.message??'').slice(0,120)}));
    return [name,{status:'error',message:`Billing sync failed${Number.isInteger(status)?` (HTTP ${status}${status===401||status===403?': the key was rejected':''})`:''}. Check the key and provider access; billed costs are unknown until a successful refresh.`}];
  }));
}
