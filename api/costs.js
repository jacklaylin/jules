// Loads first so the cost meter wraps fetch before any handler below keeps a reference to it.
import '../lib/usage.js';
import { billingSnapshot } from '../lib/billing.js';
import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, readJson, timeView } from '../lib/http.js';
import { buildReport, lifetimeMonths, lifetimeTotal, validDate, validateEntry } from '../lib/costs.js';
import { spendingReport } from '../lib/cost-caps.js';
import { displayName, profileFirstName } from '../lib/memory.js';
export const config = { api: {bodyParser:false} };
export function createCostsHandler({auth=authorize, storeFactory=createStore, env=process.env, billing=billingSnapshot}={}) {
  return async (req,res) => {
    const started = performance.now();
    try {
      const access = await auth(req.headers,env);
      const authMs = performance.now() - started;
      if (access !== 200) return json(res,access,{error:'Sign in through the Jules inbox with the owner account.'});
      const store = storeFactory(env);
      if (req.method === 'GET') {
        timeView(res,'costs',started,authMs);
        const date = new URL(req.url,'https://local.invalid').searchParams.get('date');
        if (!validDate(date)) return json(res,400,{error:'Choose a valid date.'});
        const optional=read=>Promise.resolve().then(read).catch(()=>null);
        // Earlier months (for the lifetime total) are read beside this month's figures, not after them.
        const past=optional(()=>Promise.all(lifetimeMonths(date).map(end=>pastMonth(store,billing,env,end,optional))));
        const [entries, providers, metered, jobUsage, jobRuns, scheduled, spending] = await Promise.all([store.costEntries(date),billing(date,env),optional(()=>store.meteredMonth(date)),
          optional(()=>store.jobUsageMonth(date)),optional(()=>store.jobRunsMonth(date)),optional(()=>store.scheduledJobs(date)),optional(()=>peopleSpending(store,env))]);
        const report=buildReport({date,entries,providers,metered,jobUsage,jobRuns,scheduled,env});
        report.spending=spending;
        report.lifetime=await optional(async()=>{const months=await past;if(!months)throw Error('earlier months unavailable');return lifetimeTotal([...months,report]);});
        if(!metered)report.featureNotice='Feature costs are unavailable. If db/031_cost_dashboard.sql has not been run in Supabase, run it.';
        if(!jobUsage||!jobRuns||!scheduled)report.jobsNotice='Some recurring job figures are unavailable. If db/034_recurring_jobs.sql has not been run in Supabase, run it.';
        return json(res,200,report);
      }
      if (req.method === 'POST') {
        await store.saveCostEntry(validateEntry(await readJson(req)));
        return json(res,200,{saved:true});
      }
      res.setHeader('Allow','GET, POST'); return json(res,405,{error:'Method not allowed.'});
    } catch (error) { return json(res,[400,413,415].includes(error.status)?error.status:503,{error:error.status===400?'Check the date, amount, and service.':'Could not save or load costs. Check the database setup and try again.'}); }
  };
}
// An earlier month's whole-month report for the lifetime total. SerpApi reports only its current plan,
// so a past month uses the SerpApi fee entered by hand (unknown until entered).
async function pastMonth(store,billing,env,end,optional) {
  const [entries,providers,metered]=await Promise.all([store.costEntries(end),billing(end,env),optional(()=>store.meteredMonth(end))]);
  return buildReport({date:end,entries,providers:{...providers,serpapi:undefined},metered,env,now:new Date(end+'T23:59:59Z')});
}
// Spend vs cap per person (By person), always for today and this month in UTC, with names for the table.
async function peopleSpending(store,env) {
  const report=await spendingReport(store,env), ids=report.people.map(p=>p.conversation_id);
  const blank=()=>new Map();
  const conversations=(await store.list().catch(()=>[])).filter(c=>ids.includes(c.id));
  const [signups,profiles]=await Promise.all([store.signupNames?.(conversations.map(c=>c.sender_id)).catch(blank)??blank(),store.profilesFor?.(ids).catch(blank)??blank()]);
  const byId=new Map(conversations.map(c=>[c.id,c]));
  return {...report,people:report.people.map(p=>{
    const c=byId.get(p.conversation_id), signup=c&&signups.get(c.sender_id);
    const name=signup?[displayName(signup.first_name),displayName(signup.last_name)].filter(Boolean).join(' '):displayName(profileFirstName(profiles.get(p.conversation_id)));
    return {...p,name:name||null,sender_id:c?.sender_id??null};
  })};
}
export default createCostsHandler();
