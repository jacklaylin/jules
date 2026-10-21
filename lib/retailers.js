import {domainToUnicode} from 'node:url';
import {BRANDS,TRUSTED_RETAILERS,RESALE_MARKETPLACES,SUPPRESSED_STORES} from './source-registry.js';
export {BRANDS,TRUSTED_RETAILERS,RESALE_MARKETPLACES,SUPPRESSED_STORES} from './source-registry.js';
// A suppressed site (an aggregator or low-trust marketplace) is never a place to buy.
export function isSuppressedStore(url){try{const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');return SUPPRESSED_STORES.some(d=>host===d||host.endsWith('.'+d));}catch{return false;}}
// Editorial priority, not a guarantee about a store or any individual item.
export const RETAILERS=[...BRANDS.map(r=>({...r,tier:'official'})),...TRUSTED_RETAILERS.map(r=>({...r,tier:'preferred',brands:[]}))];
// A lookalike store imitates a brand's or a listed store's own site: its name is one typo away (a
// letter added, dropped, changed or swapped) from a listed store's name, or from the brand the page
// says it sells. Copycat shops of this kind sell counterfeits, so they are treated like a suppressed
// site. A format check on the store's domain, not on anything the user wrote. Short names (under seven
// letters) are skipped: too many real stores sit one letter apart from them.
const siteSlug=value=>String(value??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
function siteName(host){
 const labels=host.split('.');
 return siteSlug(labels.length>=3&&['co','com','net','org','ac'].includes(labels.at(-2))&&labels.at(-1).length===2?labels.at(-3):labels.at(-2)??labels[0]);
}
function oneTypo(a,b){
 if(a===b||Math.abs(a.length-b.length)>1)return false;
 let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;
 if(a.length===b.length)return a.slice(i+1)===b.slice(i+1)||a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);
 return a.length>b.length?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1);
}
const LISTED_SITES=[...new Set([...RETAILERS.map(r=>r.domain),...RESALE_MARKETPLACES])];
const LISTED_NAMES=[...new Set(LISTED_SITES.map(siteName))].filter(name=>name.length>=7);
// A domain spelled with letters from another alphabet that look like Latin ones (a Cyrillic а in
// an otherwise Latin name) is the usual phishing disguise, whatever name it imitates.
function mixedScript(host){
 return host.split('.').some(label=>{
  if(!label.startsWith('xn--'))return false;
  const text=domainToUnicode(label);
  return /[a-z]/.test(text)&&/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text);
 });
}
// A store or marketplace the registry lists by name (official, curated or resale).
export function isListedStore(url){try{const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');return LISTED_SITES.some(d=>host===d||host.endsWith('.'+d));}catch{return false;}}
export function isLookalikeStore(url,brand=null){
 let host;try{host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return false;}
 if(LISTED_SITES.some(d=>host===d||host.endsWith('.'+d)))return false;
 if(mixedScript(host))return true;
 const name=siteName(host),own=siteSlug(brand);
 // A possessive brand (Tricker's) may drop the s in its own domain.
 if(own&&(name===own||name===siteSlug(String(brand).replace(/[’']s\b/gi,''))))return false;
 return [...LISTED_NAMES,...(own.length>=7?[own]:[])].some(target=>oneTypo(name,target));
}
export const SOURCE_DOMAINS=[...new Set([...RETAILERS.map(r=>r.domain),'footlocker.com'])];
export function sourceDomains(scope){return [...new Set(RETAILERS.filter(r=>r.tier===scope).map(r=>r.domain))];}
// A scoped web search's domain filter takes at most 100 domains; the registry can list more, and the
// first 100 in priority order go in the filter.
export function filterDomains(scope){return sourceDomains(scope).slice(0,100);}
export function sourcePriority(scope){return RETAILERS.filter(r=>r.tier===scope).map(({domain,name,brands,priority})=>({domain,name,brands,priority}));}
export function retailerFor(url,brand='',registry=RETAILERS) {
 const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
 const entries=registry.filter(r=>host===r.domain||host.endsWith('.'+r.domain));
 const normalize=value=>String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
 const official=entries.find(r=>r.tier==='official'&&r.brands.some(b=>normalize(brand)===normalize(b)));
 const entry=official??entries.find(r=>r.tier==='preferred');
 // Reputation order: official brand store, curated retailer, other store, resale marketplace.
 if(!entry&&RESALE_MARKETPLACES.some(d=>host===d||host.endsWith('.'+d)))return {domain:host,name:host,tier:'resale',rank:3};
 if(!entry)return {domain:host,name:entries[0]?.name??host,tier:'unreviewed',rank:2};
 return {domain:host,name:entry.name,tier:entry.tier,rank:official?0:1,priority:entry.priority??0};
}
export function rankSources(products) {
 // Product evidence precedes merchant preference. Never score unsourced commerce facts.
 return products.map(p=>({...p,retailer:retailerFor(p.url,p.brand)})).sort((a,b)=>
  (a.match==='likely_match'?0:1)-(b.match==='likely_match'?0:1)||a.retailer.rank-b.retailer.rank||(b.evidence_score??0)-(a.evidence_score??0)||(a.retailer.priority??0)-(b.retailer.priority??0));
}
