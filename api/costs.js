import { billingSnapshot } from '../lib/billing.js';
import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, readJson } from '../lib/http.js';
import { buildReport, validDate, validateEntry } from '../lib/costs.js';
export const config = { api: {bodyParser:false} };
export function createCostsHandler({auth=authorize, storeFactory=createStore, env=process.env, billing=billingSnapshot}={}) {
  return async (req,res) => {
    try {
      const access = await auth(req.headers,env);
      if (access !== 200) return json(res,access,{error:'Sign in through the Jules inbox with the owner account.'});
      const store = storeFactory(env);
      if (req.method === 'GET') {
        const date = new URL(req.url,'https://local.invalid').searchParams.get('date');
        if (!validDate(date)) return json(res,400,{error:'Choose a valid date.'});
        const [entries, providers, metered] = await Promise.all([store.costEntries(date),billing(date,env),Promise.resolve().then(()=>store.meteredMonth(date)).catch(()=>null)]);
        const report=buildReport({date,entries,providers,metered,env});
        if(!metered)report.featureNotice='Feature costs are unavailable. If db/031_cost_dashboard.sql has not been run in Supabase, run it.';
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
export default createCostsHandler();
