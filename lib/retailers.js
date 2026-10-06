// Editorial ordering for this experiment, not claims about authenticity or policies.
// Only explicit domain entries receive a preference; unknown boutiques remain unreviewed.
export const RETAILERS = [
  {domain:'barbour.com',name:'Barbour',tier:'official',brands:['barbour']},
  {domain:'paulsmith.com',name:'Paul Smith',tier:'official',brands:['paul smith','barbour x paul smith']},
  {domain:'prada.com',name:'Prada',tier:'official',brands:['prada']},
  {domain:'ysl.com',name:'Saint Laurent',tier:'official',brands:['saint laurent']},
  {domain:'driesvannoten.com',name:'Dries Van Noten',tier:'official',brands:['dries van noten']},
  ...['farfetch.com','ssense.com','mrporter.com','net-a-porter.com','nordstrom.com'].map(domain=>({domain,name:domain,tier:'preferred',brands:[]})),
];
export function retailerFor(url,brand='',registry=RETAILERS) {
  const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
  const entry=registry.find(r=>host===r.domain||host.endsWith('.'+r.domain));
  if(!entry)return {domain:host,name:host,tier:'unreviewed',rank:2};
  const official=entry.tier==='official'&&entry.brands.some(b=>brand.toLowerCase().includes(b));
  return {domain:host,name:entry.name,tier:official?'official':entry.tier==='preferred'?'preferred':'unreviewed',rank:official?0:entry.tier==='preferred'?1:2};
}
export function rankSources(products) {
  // Product evidence always precedes merchant preference. No unsourced stock/price scoring.
  return products.map(p=>({...p,retailer:retailerFor(p.url,p.brand)})).sort((a,b)=>
    (a.match==='likely_match'?0:1)-(b.match==='likely_match'?0:1)||a.retailer.rank-b.retailer.rank||(b.evidence_score??0)-(a.evidence_score??0));
}
