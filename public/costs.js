import {mountAdminShell,adminJson} from './admin-console.js';
mountAdminShell('costs');
const $ = id => document.getElementById(id);
const money = value => value === null || value === undefined ? 'Unknown' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value!==0&&Math.abs(value)<1?4:2}).format(value);
const basisLabel = basis => basis==='unknown'?'Not recorded':basis.split('+').map(b=>b[0].toUpperCase()+b.slice(1)).join(' + ');
const when = iso => { if(!iso)return 'Never'; const d=new Date(iso); return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Never'; };
$('date').value = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const api=(options={})=>adminJson(`/api/costs?date=${encodeURIComponent($('date').value)}`,options);
const cell=(...children)=>{const td=document.createElement('td');td.append(...children);return td;};
const small=text=>{const el=document.createElement('small');el.textContent=text;return el;};
let version=0;
async function load() {
  const request=++version;
  for(const id of ['total-today','total-month','total-projected'])$(id).textContent='Loading…';
  $('rows').replaceChildren();$('coverage').textContent='';$('budget-status').textContent='';$('metered-rows').replaceChildren();$('metered-status').textContent='';
  try {
    const data=await api(); if(request!==version)return;
    $('notice').textContent='';
    const partial=data.incomplete.length?' (known part)':'';
    $('total-today').textContent=money(data.totals.today)+(data.totals.today===null?'':partial);
    $('total-month').textContent=money(data.totals.month)+(data.totals.month===null?'':partial);
    $('total-projected').textContent=money(data.totals.projected)+(data.totals.projected===null?'':partial);
    $('coverage').textContent=data.incomplete.length?`Incomplete: ${data.incomplete.join(', ')}. Totals include only what is known.`:'Every service is covered.';
    $('budget-status').textContent=data.budget===null?'No daily warning budget set.':`Daily warning budget: ${money(data.budget)} · ${data.totals.today!==null && data.totals.today>data.budget?'OVER BUDGET':data.incomplete.length?'coverage incomplete; actual costs may exceed budget':'within budget'}`;
    if(!$('service').options.length)for(const row of data.rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.name;$('service').append(option);}
    for(const row of data.rows){
      const tr=document.createElement('tr');
      const link=document.createElement('a');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.name;
      const name=cell(link);for(const note of row.notes)name.append(small(note));
      const badge=document.createElement('span');badge.className='badge '+row.basis.split('+')[0];badge.textContent=basisLabel(row.basis)+(row.complete?'':' · incomplete');
      tr.append(name,cell(money(row.today)),cell(money(row.month)),cell(money(row.projected)),cell(badge,small(row.source)),cell(when(row.updated)));
      $('rows').append(tr);
    }
    const f=data.features;
    if(!f)$('metered-status').textContent=data.featureNotice??'Feature costs are unavailable.';
    else{
      const notes=[`${money(f.today)} on this day · ${money(f.month)} this month (estimates) · ${money(f.evalsMonth)} of it from eval test runs.`];
      notes.push(f.perSearch?(f.perSearch.basis==='plan'?`Searches priced at ${money(f.perSearch.value)} each (SerpApi plan price ÷ monthly searches).`:`Searches priced at ${money(f.perSearch.value)} each (SERPAPI_COST_PER_SEARCH setting).`):'Search costs unknown until SerpApi reports a plan price.');
      if(f.unpriced.length)notes.push(`No list price for ${f.unpriced.join(', ')}; those calls are counted but not priced.`);
      $('metered-status').textContent=notes.join(' ');
      for(const feature of f.features){
        const tr=document.createElement('tr');
        tr.append(cell(feature.label),cell(String(feature.aiCalls)),cell(String(feature.searches)),cell(money(feature.today)),cell(money(feature.month)+(feature.unpriced?' + unpriced calls':'')));
        $('metered-rows').append(tr);
      }
      if(!f.features.length)$('metered-status').textContent='No metered calls this month.';
    }
  }catch(error){if(request===version){for(const id of ['total-today','total-month','total-projected'])$(id).textContent='Unavailable';$('notice').textContent=error.message;}}
}
$('refresh').onclick=load;$('date').onchange=load;
$('entry').onsubmit=async event=>{
  event.preventDefault();$('save').disabled=true;
  try{const kind=$('kind').value;await api({method:'POST',body:JSON.stringify({service:kind==='budget'?'openai':$('service').value,kind,date:kind==='usage'?$('date').value:$('date').value.slice(0,7)+'-01',amount:Number($('amount').value),note:$('note').value})});await load();$('amount').value='';$('note').value='';}catch(error){$('notice').textContent=error.message;}finally{$('save').disabled=false;}
};
load();
