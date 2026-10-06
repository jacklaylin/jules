// Billing reads only: no inference calls, no provider response bodies or keys logged.
import { validDate } from './costs.js';
const configured = value => typeof value === 'string' && value.length > 0 && !value.startsWith('replace-with');
async function get(url, options, fetcher) {
  const response = await fetcher(url,{...options,signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Object.assign(new Error('Billing request failed'),{billingStatus:response.status});
  return response.json();
}
export async function openaiCosts(date, env, fetcher=fetch) {
  if (!configured(env.OPENAI_BILLING_ADMIN_KEY) || !configured(env.OPENAI_BILLING_PROJECT_ID)) return {status:'not_connected',message:'Add OPENAI_BILLING_ADMIN_KEY and OPENAI_BILLING_PROJECT_ID in Vercel to connect billing.'};
  if (!validDate(date)) throw new Error('Invalid date');
  const start = Date.parse(date.slice(0,7)+'-01T00:00:00Z')/1000;
  const day = Date.parse(date+'T00:00:00Z')/1000;
  const end = day+86400;
  let page, total=0, daily=null;
  for (let n=0;n<10;n++) {
    const params=new URLSearchParams({start_time:String(start),end_time:String(end),bucket_width:'1d',limit:'31','project_ids[]':env.OPENAI_BILLING_PROJECT_ID});
    if(page)params.set('page',page);
    const data=await get('https://api.openai.com/v1/organization/costs?'+params,{headers:{Authorization:`Bearer ${env.OPENAI_BILLING_ADMIN_KEY}`}},fetcher);
    if(!Array.isArray(data.data)||typeof data.has_more!=='boolean')throw new Error('Invalid billing response');
    for(const bucket of data.data){
      if(!Number.isInteger(bucket.start_time)||bucket.start_time<start||bucket.start_time>=end||!Array.isArray(bucket.results))throw new Error('Invalid billing bucket');
      let amount=0;
      for(const row of bucket.results){
        if(row.amount?.currency!=='usd'||typeof row.amount.value!=='number'||!Number.isFinite(row.amount.value)||row.amount.value<0)throw new Error('Unsupported billing amount');
        amount+=row.amount.value;
      }
      total+=amount;
      if(bucket.start_time===day)daily=(daily??0)+amount;
    }
    if(!data.has_more)return {status:'connected',daily,periodTotal:total,periodStart:date.slice(0,7)+'-01',periodEnd:date,checkedAt:new Date().toISOString(),message:'OpenAI-reported project costs; UTC days. Recent usage may not yet be reported. Match the project and date range in OpenAI before comparing totals.'};
    if(typeof data.next_page!=='string'||!data.next_page||data.next_page===page)throw new Error('Invalid billing pagination');
    page=data.next_page;
  }
  throw new Error('Incomplete billing pagination');
}
export async function serpapiCredits(env,fetcher=fetch) {
  if(!configured(env.SERPAPI_API_KEY))return {status:'not_connected',message:'SerpApi key is not configured.'};
  const data=await get('https://serpapi.com/account.json?'+new URLSearchParams({api_key:env.SERPAPI_API_KEY}),{},fetcher);
  const values=['this_month_usage','total_searches_left','searches_per_month'];
  if(values.some(key=>!Number.isFinite(data[key])||data[key]<0))throw new Error('Invalid credit response');
  return {status:'connected',used:data.this_month_usage,remaining:data.total_searches_left,allowance:data.searches_per_month,checkedAt:new Date().toISOString(),message:'Current account-wide credit snapshot, not historical daily usage or dollar spend.'};
}
export async function githubCosts(date,env,fetcher=fetch) {
  if(!configured(env.GITHUB_BILLING_TOKEN)||!configured(env.GITHUB_BILLING_USER)||!configured(env.GITHUB_BILLING_REPOSITORY))return {status:'not_connected',message:'GitHub billing token and repository scope are not configured.'};
  const params=new URLSearchParams({year:date.slice(0,4),month:String(Number(date.slice(5,7))),day:String(Number(date.slice(8,10))),repository:env.GITHUB_BILLING_REPOSITORY});
  const data=await get(`https://api.github.com/users/${encodeURIComponent(env.GITHUB_BILLING_USER)}/settings/billing/usage/summary?${params}`,{headers:{Authorization:`Bearer ${env.GITHUB_BILLING_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}},fetcher);
  if(!Array.isArray(data.usageItems))throw new Error('Invalid GitHub billing response');
  let daily=0;
  for(const item of data.usageItems){if(typeof item.netAmount!=='number'||!Number.isFinite(item.netAmount))throw new Error('Invalid GitHub amount');daily+=item.netAmount;}
  return {status:'connected',daily,checkedAt:new Date().toISOString(),message:'GitHub-reported net metered charges for the configured repository and selected day. Subscription fees remain manual; recent usage may lag.'};
}
export async function vercelCosts(date,env,fetcher=fetch) {
  if(!configured(env.VERCEL_BILLING_TOKEN)||!configured(env.VERCEL_BILLING_TEAM_SLUG)||!configured(env.VERCEL_BILLING_PROJECT_ID))return {status:'not_connected',message:'Vercel billing token, team slug, and project ID are not configured.'};
  const from=date+'T00:00:00.000Z', to=new Date(Date.parse(from)+86400000).toISOString();
  const params=new URLSearchParams({from,to,slug:env.VERCEL_BILLING_TEAM_SLUG});
  const response=await fetcher('https://api.vercel.com/v1/billing/charges?'+params,{headers:{Authorization:`Bearer ${env.VERCEL_BILLING_TOKEN}`},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Object.assign(new Error('Vercel billing request failed'),{billingStatus:response.status});
  const body=await response.text();if(body.length>2000000)throw new Error('Billing response too large');
  let daily=0,unallocated=0;
  for(const line of body.split('\n').filter(s=>s.trim())){
    const row=JSON.parse(line);
    if(row.BillingCurrency!=='USD'||row.BilledCost===null||row.BilledCost===''||!Number.isFinite(Number(row.BilledCost)))throw new Error('Invalid Vercel billing amount');
    const amount=Number(row.BilledCost), project=row.Tags?.ProjectId;
    // Never guess ownership or spread a multi-day charge across days.
    if(!project){unallocated+=amount;continue;}
    if(project!==env.VERCEL_BILLING_PROJECT_ID)continue;
    if(Date.parse(row.ChargePeriodStart)<Date.parse(from)||Date.parse(row.ChargePeriodEnd)>Date.parse(to)||!Number.isFinite(Date.parse(row.ChargePeriodStart))||!Number.isFinite(Date.parse(row.ChargePeriodEnd)))throw new Error('Charge cannot be attributed to this day');
    daily+=amount;
  }
  return {status:'connected',daily,unallocated,checkedAt:new Date().toISOString(),message:'Vercel-reported billed charges tagged to Jules for the selected UTC day. Untagged team charges are excluded and shown separately; fixed fees remain manual. Recent reporting may lag.'};
}
export async function billingSnapshot(date,env,fetcher=fetch) {
  const names=['openai','serpapi','github','vercel'];
  const results=await Promise.allSettled([openaiCosts(date,env,fetcher),serpapiCredits(env,fetcher),githubCosts(date,env,fetcher),vercelCosts(date,env,fetcher)]);
  return Object.fromEntries(names.map((name,index)=>[name,results[index].status==='fulfilled'?results[index].value:{status:'error',message:`Billing sync failed${Number.isInteger(results[index].reason?.billingStatus)?` (HTTP ${results[index].reason.billingStatus})`:''}. Check credentials and provider access; costs are unknown until a successful refresh.`}]));
}
