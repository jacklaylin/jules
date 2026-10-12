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
 if(!response.ok){const error=Error('Gmail request failed');error.status=response.status===401?401:503;throw error;}
 return response.json();
}
export async function exchangeCode(code,env,fetcher=fetch){
 const data=await result(await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_GMAIL_CLIENT_ID,client_secret:env.GOOGLE_GMAIL_CLIENT_SECRET,redirect_uri:gmailConfiguration(env).redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)}));
 if(!data.access_token||!data.refresh_token||!data.scope?.split(' ').includes(GMAIL_SCOPE))throw Error('Gmail read consent was not granted');
 return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in)*1000};
}
export async function accessToken(tokens,env,fetcher=fetch){
 if(tokens.expires_at>Date.now()+60000)return tokens;
 const data=await result(await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_GMAIL_CLIENT_ID,client_secret:env.GOOGLE_GMAIL_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)}));
 if(!data.access_token)throw Error('Reconnect Gmail');return {...tokens,access_token:data.access_token,expires_at:Date.now()+Number(data.expires_in)*1000};
}
export async function gmailGet(path,tokens,fetcher=fetch){
 return result(await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)}));
}
export async function revokeToken(tokens,fetcher=fetch){
 const response=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token}),signal:AbortSignal.timeout(15000)});
 if(!response.ok&&response.status!==400)throw Error('Could not revoke Gmail access');
}
