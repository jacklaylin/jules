import {randomUUID} from 'node:crypto';
import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {json,readJson} from './http.js';
import {wishlistUser} from './wishlist.js';
import {firstName} from './memory.js';
import {normalizeSignupPhone} from './public-signup.js';
import {CONTACT_CARD_TEXT,contactCardFile} from './contact-card.js';

export const WELCOME = "hey, it’s jules. i’m your personal shopper. want to try a style reading? for this test, the Gmail connection is a demo — no emails will be read.";
const base=env=>env.SITE_ORIGIN.replace(/\/$/,'');
// Signs plain /onboarding and /report links at send time, so the person lands signed in. The ledger,
// chat history and model context keep the plain link; only the delivered text carries the one-time token.
export async function signInLinks(body,{store,conversationId,env}){
 if(!env.SITE_ORIGIN||!store.createSignInLink)return body;
 const plain=new RegExp(base(env).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/(onboarding|report)(?![\\w/?#-])','g');
 if(!plain.test(body))return body;
 let id=null;
 try{id=await store.createSignInLink(conversationId);}catch{console.log(JSON.stringify({event:'sign_in_link_failed'}));}
 return id?body.replace(plain,(_,page)=>`${base(env)}/${page}#signin=${id}`):body;
}
async function notify(store,conversation,stage,body,env,send,compose){
 const operation=`onboarding:${conversation.id}:${stage}`;
 // Reuse the original body and outcome on retries; never resend uncertain delivery.
 const existing=await store.operation(operation);
 if(existing)return {status:existing.status,duplicate:true};
 const signed=async(target,text,...rest)=>send(target,await signInLinks(text,{store,conversationId:conversation.id,env}),...rest);
 return deliverReply({store,send:signed,conversation,operation,body,source:'operator',env,...(compose&&{compose})});
}
// A fresh one-tap link, texted when someone opens a spent or expired one. Each send is its own
// ledger entry; the link is signed at send time like every other /onboarding link.
export const FRESH_LINK_LIMIT=5;
export async function sendFreshLink(store,conversationId,env,send=sendGreeting){
 const conversation=await store.conversation(conversationId);
 if(!conversation)return {status:'failed'};
 const signed=async(target,text,...rest)=>send(target,await signInLinks(text,{store,conversationId,env}),...rest);
 return deliverReply({store,send:signed,conversation,operation:`onboarding:${conversationId}:link:${Date.now()}`,body:`here’s a fresh link to pick up where you left off: ${base(env)}/onboarding`,source:'operator',env});
}
export const welcomeText=env=>`hey, it’s jules, your personal shopper. i’d love to get to know you. connect your shopping accounts here and i’ll learn from what you actually buy: ${base(env)}/onboarding`;
// Sent instead of the plain "spot opened" text when the owner approves someone (lib/waitlist.js).
export const approvedWelcomeText=env=>`good news: your spot just opened. i’m jules, your personal shopper. connect your shopping accounts here and i’ll learn from what you actually buy: ${base(env)}/onboarding`;
export async function welcomeTester(phone,store,env,send=sendGreeting){
 if(env.ONBOARDING_ENABLED!=='true')return {message_sent:false};
 const conversation=await store.onboardingInvite(phone);
 if(!conversation)return {message_sent:false};
 return welcomeConversation(store,conversation,env,send,env.GMAIL_IMPORT_ENABLED==='true'?welcomeText(env):WELCOME);
}
// Moves an invited conversation to offered and texts the welcome once (signed link, message ledger).
// Someone already past the invite gets nothing new: { message_sent:false, onboarding_started:true }.
export async function welcomeConversation(store,conversation,env,send,body){
 await store.advanceOnboarding(conversation.id,'invited','offered');
 const session=await store.onboardingSession(conversation.id);
 if(session?.state!=='offered')return {message_sent:false,onboarding_started:true};
 const result=await notify(store,conversation,'welcome',body,env,send);
 const card=result.status==='sent'&&!result.duplicate&&contactCardEnabled(env)?await sendContactCard(store,conversation,env,send):null;
 return {message_sent:result.status==='sent',message_status:result.status,onboarding_started:true,duplicate:Boolean(result.duplicate),...(card&&{contact_card:card})};
}
// One reminder, about a day after the welcome, for someone still offered or accepted with nothing connected
// (db/046 onboarding_reminders_due, woken by the once-a-minute Gmail sweep). Once per person ever: the
// ledger entry onboarding:<id>:reminder is never reused, and it blocks the send for anyone who texted STOP.
// Off unless ONBOARDING_REMINDER_ENABLED. A "Not now" tap does not stop it; declining in chat does.
export const reminderText=env=>`whenever you’re ready, here’s your link to connect your shopping accounts: ${base(env)}/onboarding`;
// Anything connected or started: a Gmail sign-in, an import, or a Shop connection (even one awaiting approval).
export const connectedAnything=row=>Boolean(row?.token_ciphertext||row?.data?.job||
 Object.values(row?.data?.connections??{}).some(c=>c?.credential||(c?.status??'not_connected')!=='not_connected'));
export const REMINDER_AFTER_MS=24*3600000,REMINDER_UNTIL_MS=48*3600000;
export async function sendOnboardingReminders(store,env,send=sendGreeting,{wrap=(_id,work)=>work(),now=Date.now()}={}){
 if(env.ONBOARDING_REMINDER_ENABLED!=='true'||!env.SITE_ORIGIN||!store.onboardingRemindersDue)return {reminders:0};
 let due;
 try{due=await store.onboardingRemindersDue();}catch{console.log(JSON.stringify({event:'onboarding_reminder_failed',step:'due'}));return {reminders:0};}
 let reminders=0;
 for(const row of due??[]){
  try{
   // The database picked them; their state and connections are read again here before texting.
   const age=now-Date.parse(row.welcome_sent_at);
   if(!(age>=REMINDER_AFTER_MS&&age<=REMINDER_UNTIL_MS))continue;
   const id=row.conversation_id,[session,history,conversation]=await Promise.all([store.onboardingSession(id),store.gmailImport(id),store.conversation(id)]);
   if(!conversation||!['offered','accepted'].includes(session?.state)||connectedAnything(history))continue;
   const result=await wrap(id,()=>notify(store,conversation,'reminder',reminderText(env),env,send));
   if(result?.duplicate)continue;
   if(result?.status==='sent')reminders++;
   console.log(JSON.stringify({event:result?.status==='sent'?'onboarding_reminder_sent':'onboarding_reminder_not_sent',status:result?.status??null,state:session.state,not_now:Boolean(row.not_now_at)}));
  }catch{console.log(JSON.stringify({event:'onboarding_reminder_failed',step:'send'}));}
 }
 return {reminders};
}
// The card after the welcome is paused unless CONTACT_CARD_ENABLED (founder, Oct 21): with Photon's shared
// line the card can only carry JULES_PUBLIC_LINE, which may not be the number a tester texts. Turn it on once
// Photon is on one number. The owner's Text them Jules's contact card button (resendContactCard) still works.
export const contactCardEnabled=env=>env.CONTACT_CARD_ENABLED==='true';
// Right after a delivered welcome: "save me so you know it’s me:" with jules.vcf (still-orb photo), once.
// The card carries the line this person texts (else JULES_PUBLIC_LINE); a failure here never changes the welcome's outcome.
export async function sendContactCard(store,conversation,env,send,{file=contactCardFile,stage='contact_card'}={}){
 try{
  const vcf=await file(env,{line:conversation.line});
  if(!vcf)return 'skipped';
  const result=await notify(store,conversation,stage,CONTACT_CARD_TEXT,env,(target,text,...rest)=>send(target,text,rest[0],{files:[vcf]}));
  return result.status;
 }catch{console.log(JSON.stringify({event:'contact_card_failed'}));return 'failed';}
}

// Owner action (Admin › person): text the contact card again, e.g. to re-test it with one phone or to
// reach someone who signed up before the card existed. Each click is its own ledger entry; nothing is reset.
export const resendContactCard=(store,conversation,env,send=sendGreeting,{file}={})=>
 sendContactCard(store,conversation,env,send,{stage:`contact_card:${randomUUID()}`,...(file&&{file})});

// Owner action (Admin › person): text the welcome again on purpose, e.g. after the first one ended
// 'uncertain' (nothing resends that automatically). Only while onboarding is offered or accepted. The text
// is exactly what the dialog quoted: the first welcome's stored text (its link plain; signed at send time),
// else the approval welcome. Each click is its own ledger entry and the earlier one is kept, so a STOP still
// blocks it. A delivered resend is followed by the contact card, as the first welcome is.
export const RESEND_WELCOME_STATES=['offered','accepted'];
const asWritten=async({draft})=>({body:draft,captions:[],composed:false});
export async function resendWelcomeText(store,conversationId,env,state){
 if(!RESEND_WELCOME_STATES.includes(state)||!env.SITE_ORIGIN)return null;
 return (await store.operation(`onboarding:${conversationId}:welcome`))?.body??approvedWelcomeText(env);
}
export async function resendWelcome(store,conversation,env,send=sendGreeting){
 const session=await store.onboardingSession(conversation.id);
 const body=await resendWelcomeText(store,conversation.id,env,session?.state);
 if(!body)throw Object.assign(new Error('They aren’t waiting on the welcome (onboarding isn’t offered or accepted), so nothing was sent.'),{status:409});
 const result=await notify(store,conversation,`welcome:${randomUUID()}`,body,env,send,asWritten);
 const card=result.status==='sent'&&contactCardEnabled(env)?await resendContactCard(store,conversation,env,send):null;
 return {welcome:result.status,...(card&&{contact_card:card})};
}

// Agent skill. The agent reads the onboarding offer and conversation and chooses this tool;
// the executor only validates the current onboarding state and advances it.
export const ONBOARDING_TOOL={type:'function',name:'onboarding',strict:true,
 description:'Act on Jules\'s onboarding offers. accept: the user clearly accepts the offered Gmail connection or demo (not mailbox access itself, not consent to save products or alerts). decline: declines, postpones or cancels that offer; record it with this tool, not only a conversation_reply, so the offer is closed and Jules does not keep asking. status: asks about that offer or wants its link. style: asks for the photo-based style reading. An ambiguous yes, or a yes to a different question, is not acceptance; use conversation_reply instead.',
 parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['accept','decline','status','style']}}}};
export const onboardingAvailable=(session,env)=>Boolean(session)||env.STYLE_ENABLED==='true';
// The one re-offer in chat, for someone who skipped the welcome and shopped instead: still offered (never
// after a decline or once connected), the real Gmail import on, and none recorded yet. reoffered_at is
// undefined until db/047 runs, so nothing is re-offered before it can be recorded.
export const reofferAvailable=(session,env)=>env.GMAIL_IMPORT_ENABLED==='true'&&Boolean(env.SITE_ORIGIN)&&session?.state==='offered'&&session.reoffered_at===null;
// October 22: connecting Gmail or Shop from the onboarding page leaves the state 'offered', so the state
// alone re-offered the link to someone already connected. Any import row with a Gmail token, a started
// import or an imported source counts as connected; an unreadable row counts too, so a failed read
// never re-offers.
export const accountsConnected=row=>Boolean(row?.token_ciphertext||row?.data?.job||Object.values(row?.data?.connections??{}).some(c=>c?.imported_at));
const connectedNow=async(store,conversationId)=>!store.gmailImport?false:await Promise.resolve(store.gmailImport(conversationId)).then(accountsConnected,()=>true);
export const reofferText=env=>`whenever you want, connect your shopping accounts and i’ll learn your sizes and favorite stores from your receipts: ${base(env)}/onboarding`;
// What the agent sees: the state, plus whether the re-offer is still open and the person's product-link
// clicks (a positive signal the conversation text does not show). Clicks are read only while it is open.
export async function onboardingContext(session,env,store,conversationId){
 const open=reofferAvailable(session,env)&&!await connectedNow(store,conversationId);
 const clicks=open&&store.linkClicks?await store.linkClicks(conversationId).catch(()=>0):0;
 return {state:session?.state??null,style_reading_available:env.STYLE_ENABLED==='true',gmail_import:env.GMAIL_IMPORT_ENABLED==='true',
  ...(session?{reoffer_available:open,...(open?{product_link_clicks:clicks}:{})}:{})};
}
// Returns the reply body, or null when the action does not apply to the current state. 'reoffer' is
// not offered to the model: the agent loop runs it after a positive sign (lib/ai.js reofferAfter).
export async function onboardingAction(action,{conversationId,session,store,env}){
 if(action==='style'&&env.STYLE_ENABLED==='true')return `add outfit photos and inspiration screenshots here for a style reading you can review: ${base(env)}/style`;
 if(action==='reoffer'){
  if(!reofferAvailable(session,env)||await connectedNow(store,conversationId))return null;
  // Recorded before the line goes back to the agent: a turn that fails afterwards still never re-offers twice.
  const recorded=await Promise.resolve(store.recordOnboardingReoffer?.(conversationId)).catch(()=>false);
  console.log(JSON.stringify({event:recorded?'onboarding_reoffered':'onboarding_reoffer_not_recorded'}));
  return recorded?reofferText(env):null;
 }
 if(session&&action==='decline'){
  await store.advanceOnboarding(conversationId,session.state,'declined');
  await import('./coverage.js').then(m=>m.logCoverage(store,conversationId,'declined')).catch(()=>{});
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
   // "Text Jules" opens the line this person texts (their own on Photon's Free plan), else JULES_PUBLIC_LINE.
   const own=await Promise.resolve(store.conversation?.(access.conversation)).catch(()=>null);
   const line=normalizeSignupPhone(own?.line)||normalizeSignupPhone(env.JULES_PUBLIC_LINE);
   if(req.method==='GET')return json(res,200,{state:session.state,first_name:await firstName(store,access.conversation).catch(()=>null)??null,demo:env.GMAIL_IMPORT_ENABLED!=='true',gmail_available:env.GMAIL_IMPORT_ENABLED==='true',...(line?{text_url:`sms:${line}`}:{})});
   if(req.method!=='POST')return json(res,405,{error:'Use GET or POST.'});
   if(req.headers.origin!==base(env))return json(res,403,{error:'Continue from the Jules website.'});
   const input=await readJson(req,2048);
   // "Not now, go to Messages": recorded for Admin and the reminder log; what they see and their state stay the same.
   if(input.action==='not-now'){
    let recorded=false;
    if(['offered','accepted'].includes(session.state))recorded=await Promise.resolve(store.recordOnboardingNotNow?.(access.conversation)).then(Boolean).catch(()=>false);
    console.log(JSON.stringify({event:'onboarding_not_now',state:session.state,recorded}));
    return json(res,200,{state:session.state,recorded});
   }
   if(!['connect-demo','skip'].includes(input.action))return json(res,400,{error:'Unknown action.'});
   if(input.action==='skip'){
    if(session.state==='ready')return json(res,200,{state:'ready',destination:'/wishlist'});
    if(session.state!=='ready'){await store.advanceOnboarding(access.conversation,session.state,'declined');await import('./coverage.js').then(m=>m.logCoverage(store,access.conversation,'declined')).catch(()=>{});
     // Skipping Gmail and Shop starts the text interview instead (lib/interview.js; off unless INTERVIEW_ENABLED).
     await import('./interview.js').then(m=>m.startInterview(store,access.conversation,env,'declined',{send})).catch(()=>console.log(JSON.stringify({event:'interview_start_failed'})));}
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
