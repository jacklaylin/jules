export const services = [
  ['openai', 'OpenAI API', 'https://platform.openai.com/usage'],
  ['photon', 'Photon', 'https://app.photon.codes/'],
  ['serpapi', 'SerpApi', 'https://serpapi.com/dashboard'],
  ['vercel', 'Vercel', 'https://vercel.com/dashboard'],
  ['supabase', 'Supabase', 'https://supabase.com/dashboard'],
  ['github', 'GitHub', 'https://github.com/settings/billing'],
  ['codex', 'ChatGPT / Codex', 'https://chatgpt.com/'],
].map(([id, name, url]) => ({ id, name, url }));
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
    return {...service, usage:usage?.amount ?? null, monthly:subscription?.amount ?? null, daily:subscription ? subscription.amount / days : null, total:(usage?.amount ?? 0) + (subscription?.amount ?? 0) / days, note:usage?.note ?? '', complete:!!usage && !!subscription};
  });
  return {rows, total:rows.reduce((sum,row) => sum + row.total,0), missing:rows.filter(r => !r.complete).length, budget:entries.find(e => e.kind === 'budget' && e.date === month)?.amount ?? null};
}
