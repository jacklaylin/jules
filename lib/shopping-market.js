// Country and currency are independent: a foreign purchase does not establish residence.
export function inferImportedMarket(records){
 const orders=new Map();for(const r of records??[]){if(r.order_key&&r.source_id&&r.evidence&&['delivery_country','billing_country','transaction_currency'].includes(r.kind))orders.set(r.order_key+'/'+r.kind,r);}
 const infer=(k,pattern)=>{
  const rows=[...orders.values()].filter(r=>k.includes(r.kind)&&pattern.test(r.value??''));
  const counts=new Map();for(const r of rows){const group=counts.get(r.value)??new Map();group.set(r.order_key,r);counts.set(r.value,group);}
  const ranked=[...counts].sort((a,b)=>b[1].size-a[1].size),best=ranked[0];
  const total=new Set(rows.map(r=>r.order_key)).size;
  return best&&best[1].size>=2&&best[1].size/total>=0.7&&best[1].size>(ranked[1]?.[1].size??0)?{value:best[0],evidence:[...best[1].values()].map(({source_id,evidence})=>({source_id,evidence})),source:'email_import',confidence:'high'}:null;
 };
 return {country:infer(['delivery_country','billing_country'],/^[A-Z]{2}$/),currency:infer(['transaction_currency'],/^[A-Z]{3}$/)};
}
export function shoppingMarket(facts=[],env={}){
 const pick=field=>facts.filter(f=>!f.deleted&&f.field===field&&f.key==='primary').sort((a,b)=>Number(['message','operator'].includes(b.source))-Number(['message','operator'].includes(a.source))||String(b.updated_at??'').localeCompare(String(a.updated_at??'')))[0]?.value;
 const country=pick('country')??env.SHOPPING_COUNTRY??'US';
 const currency=pick('currency')??env.SHOPPING_CURRENCY??({US:'USD',CA:'CAD',GB:'GBP',AU:'AUD'}[country]??null);
 return {country:/^[A-Z]{2}$/.test(country)?country:'US',currency:currency&&/^[A-Z]{3}$/.test(currency)?currency:null};
}
export const marketEnvironment=(facts,env)=>{const m=shoppingMarket(facts,env);return {...env,SHOPPING_COUNTRY:m.country,SHOPPING_CURRENCY:m.currency};};

// Called by the email import after its model extracts cited country/currency signals.
// Exact source quotes and transaction identity are required before profile persistence.
export async function saveImportedMarket(store,conversation,records,sources,now=new Date().toISOString()){
 const supported=records.filter(r=>sources.some(s=>s.id===r.source_id&&typeof s.text==='string'&&s.text.includes(r.evidence)));
 const inferred=inferImportedMarket(supported),profile=await store.profile(conversation),facts=[...profile.facts];
 for(const field of ['country','currency']){
  const inference=inferred[field];if(!inference)continue;
  if(facts.some(f=>f.field===field&&f.key==='primary'&&['message','operator'].includes(f.source)))continue;
  const fact={field,key:'primary',value:inference.value,deleted:false,source:'email_import',source_id:inference.evidence[0].source_id,evidence_sources:inference.evidence.map(e=>e.source_id),evidence:'Repeated cited '+(field==='country'?'delivery/billing countries':'purchase currencies'),confidence:inference.confidence,updated_at:now};
  const index=facts.findIndex(f=>f.field===field&&f.key==='primary');if(index<0)facts.push(fact);else facts[index]=fact;
 }
 if(JSON.stringify(facts)!==JSON.stringify(profile.facts))await store.saveProfile(conversation,profile.version,facts);
 return {facts,market:shoppingMarket(facts)};
}
