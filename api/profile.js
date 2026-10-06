import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { FIELDS, remember, tasteSummary } from '../lib/memory.js';
import { json, readJson, uuid } from '../lib/http.js';
export const config = { api: { bodyParser: false }, maxDuration: 60 };
export function createProfileHandler({ auth = authorize, storeFactory = createStore, extract, env = process.env } = {}) {
  return async (req,res) => {
    try {
      const access = await auth(req.headers,env);
      if (access !== 200) return json(res,access,{ error:'Please sign in with the owner account.' });
      if (env.MEMORY_ENABLED !== 'true') return json(res,503,{ error:'Personal memory is not enabled yet.' });
      if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return json(res,405,{error:'Method not allowed.'}); }
      const input = req.method === 'GET' ? Object.fromEntries(new URL(req.url,'https://local.invalid').searchParams) : await readJson(req);
      if (!uuid(input.conversation)) return json(res,400,{error:'Choose a conversation.'});
      const store = storeFactory(env);
      if (!await store.conversation(input.conversation)) return json(res,404,{error:'Conversation not found.'});
      let profile, limited = false;
      if (req.method === 'GET') profile = await store.profile(input.conversation);
      else if (input.action === 'import') {
        const history = await store.historyForMemory(input.conversation);
        limited = history.length > 100;
        profile = await remember(store,input.conversation,history.slice(0,100).reverse(),env,extract);
      } else if (['set','remove'].includes(input.action)) {
        if (!FIELDS.includes(input.field) || typeof input.key !== 'string' || !input.key.trim() || input.key.length > 100 ||
          typeof input.value !== 'string' || input.value.length > 500 || (input.action === 'set' && !input.value.trim()) || !Number.isInteger(input.version)) return json(res,400,{error:'Enter a valid preference.'});
        const existing = await store.profile(input.conversation);
        if (existing.version !== input.version) return json(res,409,{error:'The profile changed. Reload it before editing.'});
        const fact = { field:input.field,key:input.key.trim().toLowerCase(),value:input.value.trim(),deleted:input.action==='remove',
          source:'operator',source_id:null,evidence:'Edited in the private inbox',updated_at:new Date().toISOString() };
        // One CAS attempt for operator edits: never silently overwrite a concurrent change.
        const facts = existing.facts.filter(f => !(f.field===fact.field && f.key===fact.key)).concat(fact);
        if (facts.length > 150) return json(res,400,{error:'Profile has reached its 150-fact limit.'});
        if (!await store.saveProfile(input.conversation,existing.version,facts)) return json(res,409,{error:'The profile changed. Reload it before editing.'});
        profile = {facts,version:existing.version+1};
      } else return json(res,400,{error:'Unknown profile action.'});
      return json(res,200,{...profile,summary:tasteSummary(profile.facts),limited});
    } catch {
      console.error(JSON.stringify({event:'profile_request_failed'}));
      return json(res,503,{error:'Could not update memory. Existing saved preferences are intact; reload before trying again.'});
    }
  };
}
export default createProfileHandler();
