import {welcomeTester} from './onboarding.js';
import {signupWaitlisted} from './waitlist.js';
import {createHmac} from 'node:crypto';
import {json,readJson,uuid} from './http.js';
import {createStore} from './store.js';
import {rememberSignup} from './memory.js';
import {SIGNUP_CONSENT,SIGNUP_VERSION} from '../public/signup-consent.js';
import {signupRef} from '../public/signup-ref.js';
import {normalizeSignupPhone} from '../public/signup-phone.js';
export {normalizeSignupPhone};
export function signupProfile(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object')throw Object.assign(Error('Invalid profile'),{status:400});
 const {first_name,last_name,birthday,gender}=value;
 if(![first_name,last_name].every(v=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=80)||!/^\d{4}-\d{2}-\d{2}$/.test(birthday??'')||!['woman','man','non_binary','undisclosed'].includes(gender))throw Object.assign(Error('Invalid profile'),{status:400});
 const date=new Date(birthday+'T00:00:00Z');
 if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==birthday||birthday<'1900-01-01'||date>Date.now())throw Object.assign(Error('Invalid birthday'),{status:400});
 // Jules is for adults only (stated in the signup consent).
 const now=new Date(),adult=`${now.getUTCFullYear()-18}-${now.toISOString().slice(5,10)}`;
 if(birthday>adult)throw Object.assign(Error('Under 18'),{status:400,code:'under_18'});
 return {first_name:first_name.trim(),last_name:last_name.trim(),birthday,gender};
}
export function createSignupHandler({env=process.env,storeFactory=createStore,log=console.log,welcome=welcomeTester,waitlisted=signupWaitlisted}={}){
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
   const profile=signupProfile(input.profile);
   const connection=req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown';
   const connectionHash=createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(String(connection)).digest('hex');
   const store=storeFactory(env);
   const result=await store.signup({p_request:input.request_id,p_phone:phone,p_consent_version:SIGNUP_VERSION,p_consent_text:SIGNUP_CONSENT,p_connection_hash:connectionHash,...(profile?{p_profile:profile}:{})});
   if(result==='limited')return json(res,429,{error:'Too many signup attempts. Please try again in an hour.'});
   if(result!=='saved')throw new Error('Signup not confirmed');
   const ref=signupRef(input.ref);
   log(JSON.stringify({event:'public_signup_saved',consent_version:SIGNUP_VERSION,ref}));
   // The source is recorded after the signup is saved, so a missing column (db/033 not run) never blocks it.
   if(ref)try{await store.signupRef(input.request_id,ref);}catch(error){log(JSON.stringify({event:'signup_ref_unsaved',status:error?.database_status??null}));}
   const line=normalizeSignupPhone(env.JULES_PUBLIC_LINE);
   let outcome={message_sent:false};
   try{outcome=await welcome(phone,store,env);}catch{outcome={message_sent:false,message_status:'uncertain'};log(JSON.stringify({event:'onboarding_welcome_failed'}));}
   // Gender from the form seeds the shopping profile of this number's one conversation, when it exists.
   if(profile?.gender)try{const conversation=await store.conversationForPhone(phone);if(conversation)await rememberSignup(store,conversation,profile.gender,input.request_id);}catch{log(JSON.stringify({event:'signup_profile_seed_failed'}));}
   // An unknown status shows the general success wording rather than claiming a waitlist.
   const onWaitlist=await waitlisted(store,phone,env).catch(()=>false);
   return json(res,200,{saved:true,...outcome,waitlisted:onWaitlist,...(line?{text_url:`sms:${line}`}:{})});
  }catch(error){log(JSON.stringify({event:'public_signup_failed',status:error.status||503}));return json(res,error.status||503,{error:error.code==='under_18'?'You need to be 18 or older to use Jules.':error.status===400?'Check your name, birthday and gender selection.':'Could not save your signup. Please try again.'});}
 };
}
export default createSignupHandler();
