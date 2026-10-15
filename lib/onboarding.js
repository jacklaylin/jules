import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {json,readJson} from './http.js';
import {wishlistUser} from './wishlist.js';
import {normalizeSignupPhone} from './public-signup.js';

export const WELCOME = "hey, it’s jules. i’m your personal shopper. want to try a style reading? for this test, the Gmail connection is a demo — no emails will be read.";
const base=env=>env.SITE_ORIGIN.replace(/\/$/,'');
async function notify(store,conversation,stage,body,env,send){
 const operation=`onboarding:${conversation.id}:${stage}`;
 // Reuse the original body and outcome on retries; never resend uncertain delivery.
 const existing=await store.operation(operation);
 if(existing)return {status:existing.status,duplicate:true};
 return deliverReply({store,send,conversation,operation,body,source:'operator',env});
}
export async function welcomeTester(phone,store,env,send=sendGreeting){
 if(env.ONBOARDING_ENABLED!=='true')return {message_sent:false};
 const conversation=await store.onboardingInvite(phone);
 if(!conversation)return {message_sent:false};
 await store.advanceOnboarding(conversation.id,'invited','offered');
 const session=await store.onboardingSession(conversation.id);
 if(session.state!=='offered')return {message_sent:false,onboarding_started:true};
 const result=await notify(store,conversation,'welcome',env.GMAIL_IMPORT_ENABLED==='true'?"hey, it’s jules. i’m your personal shopper. want to connect Gmail so I can learn from your purchase history? you’ll review access and analysis consent on the website.":WELCOME,env,send);
 return {message_sent:result.status==='sent',message_status:result.status,onboarding_started:true};
}

// Agent skill. The agent reads the onboarding offer and conversation and chooses this tool;
// the executor only validates the current onboarding state and advances it.
export const ONBOARDING_TOOL={type:'function',name:'onboarding',strict:true,
 description:'Act on Jules\'s onboarding offers. accept: the user clearly accepts the offered Gmail connection or demo (not mailbox access itself, not consent to save products or alerts). decline: declines or cancels that offer. status: asks about that offer or wants its link. style: asks for the photo-based style reading. An ambiguous yes, or a yes to a different question, is not acceptance; use conversation_reply instead.',
 parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['accept','decline','status','style']}}}};
export const onboardingAvailable=(session,env)=>Boolean(session)||env.STYLE_ENABLED==='true';
// Returns the reply body, or null when the action does not apply to the current state.
export async function onboardingAction(action,{conversationId,session,store,env}){
 if(action==='style'&&env.STYLE_ENABLED==='true')return `add outfit photos and inspiration screenshots here for a style reading you can review: ${base(env)}/style`;
 if(session&&action==='decline'){
  await store.advanceOnboarding(conversationId,session.state,'declined');
  return 'no problem. send me a photo or link when you want help finding something. tell me when you’d like it saved to your wishlist.';
 }
 if(session&&action==='accept'&&['offered','accepted','declined'].includes(session.state)){
  await store.advanceOnboarding(conversationId,session.state,'accepted');
  return env.GMAIL_IMPORT_ENABLED==='true'?`connect Gmail and review receipt analysis consent here: ${base(env)}/onboarding`:`let’s try it. this is the Gmail demo; it won’t access your email. sign in with your invited email to continue: ${base(env)}/onboarding`;
 }
 if(session&&action==='status'){
  return env.GMAIL_IMPORT_ENABLED==='true'?`check your import or manage your Gmail connection here: ${base(env)}/onboarding`:session.state==='ready'?`your demo is ready. no email was connected or analyzed. take a look: ${base(env)}/onboarding?view=ready`:
   session.state==='accepted'?`continue the Gmail demo here: ${base(env)}/onboarding`:
   'want to try the style reading demo? Gmail isn’t connected yet, so no emails will be read.';
 }
 return null;
}

export function createOnboardingHandler({env=process.env,storeFactory,auth=wishlistUser,send=sendGreeting}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(env.ONBOARDING_ENABLED!=='true')return json(res,503,{error:'The onboarding demo is not available yet.'});
  try{
   const store=storeFactory(env),access=await auth(req.headers,env,store);
   if(access.status!==200)return json(res,access.status,{error:'Sign in with your invited email to continue.'});
   let session=await store.onboardingSession(access.conversation);
   if(!session)return json(res,403,{error:'This account is not invited to the onboarding demo.'});
   const line=normalizeSignupPhone(env.JULES_PUBLIC_LINE);
   if(req.method==='GET')return json(res,200,{state:session.state,demo:env.GMAIL_IMPORT_ENABLED!=='true',gmail_available:env.GMAIL_IMPORT_ENABLED==='true',...(line?{text_url:`sms:${line}`}:{})});
   if(req.method!=='POST')return json(res,405,{error:'Use GET or POST.'});
   if(req.headers.origin!==base(env))return json(res,403,{error:'Continue from the Jules website.'});
   const input=await readJson(req,2048);
   if(!['connect-demo','skip'].includes(input.action))return json(res,400,{error:'Unknown action.'});
   if(input.action==='skip'){
    if(session.state==='ready')return json(res,200,{state:'ready',destination:'/wishlist'});
    if(session.state!=='ready')await store.advanceOnboarding(access.conversation,session.state,'declined');
    return json(res,200,{state:'declined',destination:'/wishlist'});
   }
   if(env.GMAIL_IMPORT_ENABLED==='true')return json(res,409,{error:'Use the Gmail connection and analysis consent on this page.'});
   if(!['accepted','ready'].includes(session.state))return json(res,409,{error:'Reply to Jules’s style reading offer in Messages first.'});
   const conversation=await store.conversation(access.conversation);
   if(session.state==='accepted'){
    const result=await notify(store,conversation,'started','the demo is starting — no email is being read. while you wait, send me things you like: photos, screenshots, links. tell me what you’d like saved to your wishlist.',env,send);
    if(result.status!=='sent')return json(res,503,{error:'We couldn’t confirm the first text was sent. Check Messages; we won’t send it twice.'});
    await store.advanceOnboarding(access.conversation,'accepted','ready');
   }
   // The demo completes inside this request, independent of whether the browser stays open.
   // A future real Gmail job must replace this explicit demo, not imitate its completion.
   session=await store.onboardingSession(access.conversation);
   if(session.state!=='ready')return json(res,409,{error:'The demo was cancelled.'});
   const result=await notify(store,conversation,'ready',`your style reading demo is ready. no email was connected or analyzed. next up: your wishlist. ${base(env)}/onboarding?view=ready`,env,send);
   return json(res,200,{state:'ready',demo:true,notification_status:result.status});
  }catch(error){console.log(JSON.stringify({event:'onboarding_request_failed',status:error.status||503}));return json(res,error.status||503,{error:'Could not continue the demo. Please try again.'});}
 };
}
