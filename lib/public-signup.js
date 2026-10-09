import {createHmac} from 'node:crypto';
import {json,readJson,uuid} from './http.js';
import {createStore} from './store.js';
import {SIGNUP_CONSENT,SIGNUP_VERSION} from '../public/signup-consent.js';
export function normalizeSignupPhone(value){
 if(typeof value!=='string'||value.length>32||!/^[+\d\s().-]+$/.test(value))return null;
 let phone=value.replace(/[\s().-]/g,'');
 if(!phone.startsWith('+')){if(/^\d{10}$/.test(phone))phone='+1'+phone;else if(/^1\d{10}$/.test(phone))phone='+'+phone;else return null;}
 return /^\+[1-9]\d{7,14}$/.test(phone)?phone:null;
}
export function createSignupHandler({env=process.env,storeFactory=createStore,log=console.log}={}){
 return async(req,res)=>{
  if(req.method==='GET')return json(res,200,{enabled:env.PUBLIC_SIGNUP_ENABLED==='true'});
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return json(res,405,{error:'Use the signup form.'});}
  if(env.PUBLIC_SIGNUP_ENABLED!=='true')return json(res,503,{error:'Signups are not open yet. Please check back soon.'});
  if(!env.SITE_ORIGIN||req.headers.origin!==env.SITE_ORIGIN.replace(/\/$/,''))return json(res,403,{error:'Submit your signup from the Jules website.'});
  try{
   const input=await readJson(req,2048),phone=normalizeSignupPhone(input?.phone);
   if(!phone)return json(res,400,{error:'Enter a valid mobile number. Include + and your country code outside the US or Canada.'});
   if(input.consent!==true)return json(res,400,{error:'Please agree to receive messages from Jules before signing up.'});
   if(input.consent_version!==SIGNUP_VERSION)return json(res,409,{error:'The consent information has changed. Reload and review it before signing up.'});
   if(!uuid(input.request_id))return json(res,400,{error:'Reload the signup form and try again.'});
   const connection=req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown';
   const connectionHash=createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(String(connection)).digest('hex');
   const result=await storeFactory(env).signup({p_request:input.request_id,p_phone:phone,p_consent_version:SIGNUP_VERSION,p_consent_text:SIGNUP_CONSENT,p_connection_hash:connectionHash});
   if(result==='limited')return json(res,429,{error:'Too many signup attempts. Please try again in an hour.'});
   if(result!=='saved')throw new Error('Signup not confirmed');
   log(JSON.stringify({event:'public_signup_saved',consent_version:SIGNUP_VERSION}));
   const line=normalizeSignupPhone(env.JULES_PUBLIC_LINE);
   return json(res,200,{saved:true,message_sent:false,...(line?{text_url:`sms:${line}`}:{})});
  }catch(error){log(JSON.stringify({event:'public_signup_failed',status:error.status||503}));return json(res,error.status||503,{error:'Could not save your signup. Please try again.'});}
 };
}
export default createSignupHandler();
