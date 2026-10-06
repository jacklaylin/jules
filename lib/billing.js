// Billing reads only: no inference calls, no provider response bodies or keys logged.
import { validDate } from './costs.js';
const configured = value => typeof value === 'string' && value.length > 0 && !value.startsWith('replace-with');
async function get(url, options, fetcher) {
  const response = await fetcher(url,{...options,signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`Billing request failed (${response.status}).`);
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
export async function billingSnapshot(date,env,fetcher=fetch) {
  const results=await Promise.allSettled([openaiCosts(date,env,fetcher),serpapiCredits(env,fetcher)]);
  const result=(index)=>results[index].status==='fulfilled'?results[index].value:{status:'error',message:'Billing sync failed. Check credentials and provider access; costs are unknown until a successful refresh.'};
  return {openai:result(0),serpapi:result(1)};
}
