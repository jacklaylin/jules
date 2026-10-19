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
