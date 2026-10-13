import {randomUUID,createHmac} from 'node:crypto';
import {normalizeSignupPhone} from './public-signup.js';
import {json,readJson,uuid} from './http.js';
import {sendGreeting} from './photon.js';
export function createPhoneLoginHandler({env=process.env,storeFactory,fetcher=fetch,send=sendGreeting}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
  if(!env.SITE_ORIGIN||req.headers.origin!==env.SITE_ORIGIN.replace(/\/$/,''))return json(res,403,{error:'Use the Jules login page.'});
  try{
   const input=await readJson(req,2048),store=storeFactory(env);
   async function auth(path,body,admin=false){const key=admin?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_ANON_KEY;const response=await fetcher(env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/'+path,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Authentication failed');return response.json();}
   if(!input||typeof input!=='object')return json(res,400,{error:'Use the Jules login form.'});
   if(input.action==='request'){
    const phone=normalizeSignupPhone(input.phone);if(!phone)return json(res,400,{error:'Enter a valid phone number, including the country code outside the US and Canada.'});
    const member=await store.phoneLoginMember(phone),id=randomUUID();
    const connection=createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown')).digest('hex');
    if(!await store.beginPhoneLogin(id,phone,connection,member?.email??null))return json(res,429,{error:'Too many code requests. Please try again in an hour.'});
    if(member){
     const link=await auth('admin/generate_link',{type:'magiclink',email:member.email},true);
     if(!/^\d{6,10}$/.test(link.email_otp??''))throw Error('Missing code');
     // Login codes never enter chat history, model context, or application logs.
     await send({space:{phone:member.line},message:{sender:{id:phone}}},`Your Jules sign-in code is ${link.email_otp}. It expires in 10 minutes. Don’t share this code.`,env);
    }
    return json(res,200,{challenge:id,message:'If this number has access to Jules, a code is on its way. Enter it below.'});
   }
   if(input.action!=='verify'||!uuid(input.challenge)||!/^\d{6,10}$/.test(input.code??''))return json(res,400,{error:'Enter the code from Messages.'});
   const email=await store.attemptPhoneLogin(input.challenge);if(!email)return json(res,400,{error:'This code expired or too many attempts were made. Request a new code.'});
   let session;try{session=await auth('verify',{type:'email',email,token:input.code});}catch{return json(res,400,{error:'That code did not work. Check Messages and try again.'});}
   if(!session.access_token||session.user?.email?.toLowerCase()!==email.toLowerCase())throw Error('Invalid session');
   await store.completePhoneLogin(input.challenge);
   return json(res,200,{access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at??Math.floor(Date.now()/1000)+session.expires_in});
  }catch{console.log(JSON.stringify({event:'phone_login_failed'}));return json(res,503,{error:'Could not complete sign-in. Please try again.'});}
 };
}
