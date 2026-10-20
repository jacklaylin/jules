// Where a signup came from: a short code on the signup link (/signup?ref=podcast, or utm_source).
// Shared by the page and the server. A code that doesn't fit the format is dropped, never an error:
// a bad link must not block a signup. This checks a technical format; it never reads the person's words.
export function signupRef(value){
 if(typeof value!=='string')return null;
 const ref=value.trim().toLowerCase();
 return /^[a-z0-9_-]{1,40}$/.test(ref)?ref:null;
}
export const refFromSearch=search=>{const params=new URLSearchParams(search);return signupRef(params.get('ref'))??signupRef(params.get('utm_source'));};
// A link to the landing page with ?ref= keeps its source when the visitor taps through to /signup.
export function carryRef(links,search){
 const ref=refFromSearch(search);
 if(ref)for(const link of links)link.setAttribute('href',`/signup?ref=${ref}`);
 return ref;
}
// How someone arrived: the referring site's host and the utm_ tags on the link they followed.
// Shared by the page and the server; each value is a technical format check, and anything else is dropped.
// Our own pages send no referrer (Referrer-Policy: no-referrer), so the landing page remembers the first
// outside arrival for this tab and the signup form sends it along.
const UTM=/^[a-z0-9._-]{1,60}$/,HOST=/^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const utm=value=>{if(typeof value!=='string')return null;const v=value.trim().toLowerCase();return UTM.test(v)?v:null;};
export function signupArrival(value,ownHost){
 if(!value||typeof value!=='object')return null;
 const host=typeof value.referrer_host==='string'?value.referrer_host.trim().toLowerCase().replace(/^www\./,''):'';
 const own=String(ownHost??'').toLowerCase().replace(/^www\./,'');
 const arrival={referrer_host:HOST.test(host)&&host!==own?host:null,utm_source:utm(value.utm_source),utm_medium:utm(value.utm_medium),utm_campaign:utm(value.utm_campaign)};
 return Object.values(arrival).some(Boolean)?arrival:null;
}
export function arrivalFrom(referrer,search,ownHost){
 let host=null;try{host=referrer?new URL(referrer).hostname:null;}catch{}
 const params=new URLSearchParams(search);
 return signupArrival({referrer_host:host,utm_source:params.get('utm_source'),utm_medium:params.get('utm_medium'),utm_campaign:params.get('utm_campaign')},ownHost);
}
const ARRIVAL_KEY='jules-arrival';
// The first outside arrival in this tab wins; storage that throws (private mode) just means no record.
// Pass storage as a function: reading window.sessionStorage itself can throw when site data is blocked.
export function rememberArrival(getStorage,{referrer,search,host}){
 const current=arrivalFrom(referrer,search,host);
 try{
  const storage=getStorage();
  const saved=signupArrival(JSON.parse(storage.getItem(ARRIVAL_KEY)??'null'),host);
  if(saved)return saved;
  if(current)storage.setItem(ARRIVAL_KEY,JSON.stringify(current));
 }catch{}
 return current;
}
