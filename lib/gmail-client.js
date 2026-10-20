import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

export const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function gmailConfiguration(env){
 const origin=new URL(env.SITE_ORIGIN);if(origin.protocol!=='https:')throw Error('Gmail requires HTTPS');
 const key=Buffer.from(env.GMAIL_TOKEN_KEY??'','base64');
 if(key.length!==32||!env.GOOGLE_GMAIL_CLIENT_ID||!env.GOOGLE_GMAIL_CLIENT_SECRET)throw Error('Gmail configuration missing');
 return {origin:origin.origin,redirect:origin.origin+'/api/wishlist?gmail=callback',key};
}
export function sealToken(value,owner,env){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',gmailConfiguration(env).key,iv);cipher.setAAD(Buffer.from(owner));
 return [iv.toString('base64url'),Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]).toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
}
export function openToken(value,owner,env){
 const [iv,body,tag]=value.split('.');const cipher=createDecipheriv('aes-256-gcm',gmailConfiguration(env).key,Buffer.from(iv,'base64url'));
 cipher.setAAD(Buffer.from(owner));cipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body,'base64url')),cipher.final()]).toString());
}
export function authorizationURL(state,env){
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:env.GOOGLE_GMAIL_CLIENT_ID,redirect_uri:gmailConfiguration(env).redirect,response_type:'code',scope:GMAIL_SCOPE,state,access_type:'offline',prompt:'consent',include_granted_scopes:'false'}).toString();return url.href;
}
async function result(response){
 if(!response.ok){const error=Error('Gmail request failed');error.status=response.status===401?401:503;error.http=response.status;throw error;}
 return response.json();
}
export async function exchangeCode(code,env,fetcher=fetch){
 const data=await result(await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_GMAIL_CLIENT_ID,client_secret:env.GOOGLE_GMAIL_CLIENT_SECRET,redirect_uri:gmailConfiguration(env).redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)}));
 if(!data.access_token||!data.refresh_token||!data.scope?.split(' ').includes(GMAIL_SCOPE))throw Error('Gmail read consent was not granted');
 return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in)*1000};
}
export async function accessToken(tokens,env,fetcher=fetch){
 if(tokens.expires_at>Date.now()+60000)return tokens;
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_GMAIL_CLIENT_ID,client_secret:env.GOOGLE_GMAIL_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 // Google refuses the renewal for good (400 invalid_grant: expired or revoked; 401: client refused):
 // retrying cannot help, so the error says the person must reconnect. Only Google's error code is kept.
 if(response.status===400||response.status===401){
  const code=await response.json().then(b=>typeof b?.error==='string'?b.error.slice(0,40):null,()=>null);
  if(response.status===401||code==='invalid_grant')throw Object.assign(Error('Reconnect Gmail'),{status:401,http:response.status,reconnect:true,google_error:code});
 }
 const data=await result(response);
 if(!data.access_token)throw Error('Reconnect Gmail');return {...tokens,access_token:data.access_token,expires_at:Date.now()+Number(data.expires_in)*1000};
}
export async function gmailGet(path,tokens,fetcher=fetch){
 return result(await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)}));
}
export async function revokeToken(tokens,fetcher=fetch){
 const response=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token}),signal:AbortSignal.timeout(15000)});
 if(!response.ok&&response.status!==400)throw Error('Could not revoke Gmail access');
}

// A connection whose renewal Google refused stays stored (it is revoked on disconnect) but counts as
// not connected until the person connects Gmail again, which clears the mark (data.gmail_auth).
export const gmailReconnectNeeded=data=>data?.gmail_auth?.status==='reconnect';
export const gmailLinked=row=>Boolean(row?.token_ciphertext)&&!gmailReconnectNeeded(row?.data);
// Marks data (in place) after a refused renewal; true the first time, so the caller logs it once.
export function markGmailReconnect(data,error,where,now=new Date()){
 if(!error?.reconnect||gmailReconnectNeeded(data))return false;
 data.gmail_auth={status:'reconnect',at:now.toISOString(),http:error.http??null,google_error:error.google_error??null,where};
 if(['listing','extracting','questions'].includes(data.job?.status)){data.job.status='paused';delete data.job.failures;delete data.job.error;}
 console.log(JSON.stringify({event:'gmail_reconnect_needed',where,http:error.http??null,google_error:error.google_error??null}));
 return true;
}
// For read-only paths (admin re-checks, the comparison) that hold no lease: claim, mark, release.
export async function recordGmailReconnect(store,owner,error,where){
 if(!error?.reconnect)return;
 try{const row=await store.claimGmailImport(owner);if(!row)return;const data=structuredClone(row.data);markGmailReconnect(data,error,where);await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext);}
 catch{console.log(JSON.stringify({event:'gmail_reconnect_record_failed',where}));}
}
