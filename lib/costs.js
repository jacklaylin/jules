export const services = [
  ['openai', 'OpenAI API', 'https://platform.openai.com/usage'],
  ['photon', 'Photon', 'https://app.photon.codes/'],
  ['serpapi', 'SerpApi', 'https://serpapi.com/dashboard'],
  ['vercel', 'Vercel', 'https://vercel.com/dashboard'],
  ['supabase', 'Supabase', 'https://supabase.com/dashboard'],
  ['github', 'GitHub', 'https://github.com/settings/billing'],
  ['codex', 'ChatGPT / Codex', 'https://chatgpt.com/'],
].map(([id, name, url]) => ({ id, name, url }));
// Metered spend (usage_events, list-price estimates) grouped by what caused it. Evals are owner test
// runs from scripts/replay-gate.js or the admin Replays page, not user activity.
const FEATURES = {chat:'Chat replies',gmail_import:'Gmail import',shop_history:'Shop import',style_reading:'Style reading',price_alerts:'Price alerts',eval_agent:'Evals · agent routing (test runs)',eval_replay:'Evals · reply replays (test runs)'};
export function meteredByFeature(rows) {
  const by = new Map();
  for (const r of rows) { const f = by.get(r.feature) ?? {feature:r.feature, label:FEATURES[r.feature] ?? r.feature, calls:0, cost:0, eval:r.feature.startsWith('eval_')}; f.calls += Number(r.calls); f.cost += Number(r.cost_usd); by.set(r.feature, f); }
  const features = [...by.values()].sort((a,b) => b.cost - a.cost);
  const sum = list => list.reduce((s,f) => s + f.cost, 0);
  return {features, total:sum(features), evals:sum(features.filter(f => f.eval))};
}
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
}
export function validateEntry(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('Invalid cost entry'), {status:400});
  if (!services.some(s => s.id === input.service) || !['usage','subscription','budget'].includes(input.kind) || !validDate(input.date) || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0 || input.amount > 1000000 || (input.kind !== 'usage' && !input.date.endsWith('-01')) || typeof input.note !== 'string' || input.note.length > 300) throw Object.assign(new Error('Invalid cost entry'), {status:400});
  return {service:input.service, kind:input.kind, date:input.date, amount:Math.round(input.amount * 1000000) / 1000000, note:input.note};
}
export function summarize(date, entries) {
  const month = date.slice(0,7) + '-01';
  const days = new Date(Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)), 0)).getUTCDate();
  const rows = services.map(service => {
    const usage = entries.find(e => e.service === service.id && e.kind === 'usage' && e.date === date);
    const subscription = entries.find(e => e.service === service.id && e.kind === 'subscription' && e.date === month);
    return {...service, usage:usage?.amount ?? null, monthly:subscription?.amount ?? null, daily:subscription ? subscription.amount / days : null, total:!usage && !subscription ? null : (usage?.amount ?? 0) + (subscription?.amount ?? 0) / days, note:usage?.note ?? '', complete:!!usage && !!subscription};
  });
  return {rows, total:rows.every(row=>row.total===null)?null:rows.reduce((sum,row) => sum + (row.total??0),0), missing:rows.filter(r => !r.complete).length, budget:entries.find(e => e.kind === 'budget' && e.date === month)?.amount ?? null};
}
