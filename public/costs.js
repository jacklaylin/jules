import {trackedFetch as fetch} from './activity.js';
const $ = id => document.getElementById(id);
const money = value => value === null ? 'Unknown' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
$('date').value = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function api(options={}) {
  const token=sessionStorage.getItem('jules_token');
  if(!token) throw new Error('Sign in through the Jules inbox, then return to Costs.');
  const response=await fetch(`/api/costs?date=${encodeURIComponent($('date').value)}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},cache:'no-store'});
  const data=await response.json(); if(!response.ok)throw new Error(data.error); return data;
}
let version=0;
async function load() {
  const request=++version;
  $('total').textContent='Loading…'; $('rows').replaceChildren();$('coverage').textContent='';$('budget-status').textContent='';$('openai-status').textContent='';$('serpapi-status').textContent='';$('github-status').textContent='';$('vercel-status').textContent='';
  try {
    const data=await api(); if(request!==version)return;
    $('notice').textContent='';$('total').textContent=data.total===null?'Costs unknown':`${money(data.total)} ${data.missing?'known subtotal':'recorded'}`;
    $('coverage').textContent=data.missing?`${data.missing} of ${data.rows.length} services have missing usage or subscription amounts. The total is incomplete.`:'All services have recorded usage and subscription amounts.';
    $('budget-status').textContent=data.budget===null?'No daily warning budget set.':`Daily warning budget: ${money(data.budget)} · ${data.total!==null && data.total>data.budget?'OVER BUDGET':data.missing?'Coverage incomplete; actual costs may exceed budget':'Within recorded budget'}`;
    const openai=data.providers.openai;
    $('openai-status').textContent=`OpenAI: ${openai.message}${openai.status==='connected'?` Total reported ${openai.periodStart} through ${openai.periodEnd} (UTC): ${money(openai.periodTotal)}. Checked ${new Date(openai.checkedAt).toLocaleString()}.`:''}`;
    const serpapi=data.providers.serpapi;
    $('serpapi-status').textContent=`SerpApi: ${serpapi.message}${serpapi.status==='connected'?` ${serpapi.used} searches used this billing month; ${serpapi.remaining} credits left; allowance ${serpapi.allowance}. Checked ${new Date(serpapi.checkedAt).toLocaleString()}.`:''}`;
    for(const name of ['github','vercel']) {
      const provider=data.providers[name];
      $(name+'-status').textContent=`${name==='github'?'GitHub':'Vercel'}: ${provider.message}${provider.status==='connected'?` Reported daily charges: ${money(provider.daily)}. ${name==='vercel'?`Excluded unallocated team charges: ${money(provider.unallocated)}. `:''}Checked ${new Date(provider.checkedAt).toLocaleString()}.`:''}`;
    }
    if(!$('service').options.length)for(const row of data.rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.name;$('service').append(option);}
    for(const row of data.rows){
      const tr=document.createElement('tr');const name=document.createElement('td');const link=document.createElement('a');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.name;name.append(link);
      if(row.note){const note=document.createElement('small');note.textContent=row.note;name.append(note);}tr.append(name);
      for(const text of [money(row.usage),row.daily===null?'Unknown':`${money(row.daily)} (${money(row.monthly)}/mo)`,money(row.total),`${row.source} · ${row.complete?'Recorded':'Incomplete'}`]){const td=document.createElement('td');td.textContent=text;tr.append(td);}
      $('rows').append(tr);
    }
  }catch(error){if(request===version){$('total').textContent='Unavailable';$('notice').textContent=error.message;}}
}
$('refresh').onclick=load;$('date').onchange=load;
$('entry').onsubmit=async event=>{
  event.preventDefault();$('save').disabled=true;
  try{const kind=$('kind').value;await api({method:'POST',body:JSON.stringify({service:kind==='budget'?'openai':$('service').value,kind,date:kind==='usage'?$('date').value:$('date').value.slice(0,7)+'-01',amount:Number($('amount').value),note:$('note').value})});await load();$('amount').value='';$('note').value='';}catch(error){$('notice').textContent=error.message;}finally{$('save').disabled=false;}
};
load();
