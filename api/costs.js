import { billingSnapshot } from '../lib/billing.js';
import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, readJson } from '../lib/http.js';
import { summarize, validDate, validateEntry } from '../lib/costs.js';
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
        const [entries, providers] = await Promise.all([store.costEntries(date),billing(date,env)]);
        const report=summarize(date,entries);
        const row=report.rows.find(r=>r.id==='openai');
        if(providers.openai.status==='connected') {
          row.usage=providers.openai.daily;
          row.source='OpenAI billing API';
        } else if(providers.openai.status==='error') {
          row.usage=null; row.source='Billing sync failed';
        }
        for(const item of report.rows) {
          item.total=item.usage===null && item.daily===null ? null : (item.usage??0)+(item.daily??0);
          item.complete=item.usage!==null && item.monthly!==null;
          item.source??='Manual ledger';
        }
        report.total=report.rows.every(r=>r.total===null)?null:report.rows.reduce((sum,r)=>sum+(r.total??0),0);
        report.missing=report.rows.filter(r=>!r.complete).length;
        return json(res,200,{...report,providers});
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
