import {BRANDS,TRUSTED_RETAILERS} from './source-registry.js';
export {BRANDS,TRUSTED_RETAILERS} from './source-registry.js';
// Editorial priority, not a guarantee about a store or any individual item.
export const RETAILERS=[...BRANDS.map(r=>({...r,tier:'official'})),...TRUSTED_RETAILERS.map(r=>({...r,tier:'preferred',brands:[]}))];
export const SOURCE_DOMAINS=[...new Set([...RETAILERS.map(r=>r.domain),'footlocker.com'])];
export function sourceDomains(scope){return [...new Set(RETAILERS.filter(r=>r.tier===scope).map(r=>r.domain))];}
export function sourcePriority(scope){return RETAILERS.filter(r=>r.tier===scope).map(({domain,name,brands,priority})=>({domain,name,brands,priority}));}
export function retailerFor(url,brand='',registry=RETAILERS) {
 const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
 const entries=registry.filter(r=>host===r.domain||host.endsWith('.'+r.domain));
 const normalize=value=>String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
 const official=entries.find(r=>r.tier==='official'&&r.brands.some(b=>normalize(brand)===normalize(b)));
 const entry=official??entries.find(r=>r.tier==='preferred');
 if(!entry)return {domain:host,name:entries[0]?.name??host,tier:'unreviewed',rank:2};
 return {domain:host,name:entry.name,tier:entry.tier,rank:official?0:1,priority:entry.priority??0};
}
export function rankSources(products) {
 // Product evidence precedes merchant preference. Never score unsourced commerce facts.
 return products.map(p=>({...p,retailer:retailerFor(p.url,p.brand)})).sort((a,b)=>
  (a.match==='likely_match'?0:1)-(b.match==='likely_match'?0:1)||a.retailer.rank-b.retailer.rank||(b.evidence_score??0)-(a.evidence_score??0)||(a.retailer.priority??0)-(b.retailer.priority??0));
}
