import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {uuid} from './http.js';

// Texts the owner when a public signup is saved, so they can set the tester up (Photon enrollment,
// conversation row, Approve in Admin › People) without being told. The text goes to the owner's own
// Jules conversation (OWNER_ALERT_CONVERSATION_ID) through the message ledger: once per signup request,
// never past the owner's STOP, sent as written (no composer). Its operation prefix keeps it out of the
// chat context the agent and composer read (lib/store.js), so it never looks like Jules talking.
export const ALERT_PREFIX='signup-alert:';
const asWritten=async({draft})=>({body:draft,captions:[],composed:false});
// "Sam R." and "•••-0123": enough to recognise the person, nothing more in the owner's chat.
const nameOf=profile=>profile?.first_name?`${profile.first_name}${profile.last_name?` ${profile.last_name[0].toUpperCase()}.`:''}`:'(no name)';
const masked=phone=>`•••-${String(phone).replace(/\D/g,'').slice(-4)}`;
const sourceOf=(ref,arrival)=>ref||arrival?.utm_source||arrival?.referrer_host||null;
export function signupAlertText({phone,profile,ref,arrival,env}){
 const from=sourceOf(ref,arrival);
 return `new signup: ${nameOf(profile)}, ${masked(phone)}${from?`, from ${from}`:''}. enroll them in photon, ask them to text jules first, then approve: ${env.SITE_ORIGIN.replace(/\/$/,'')}/admin`;
}
// outcome is the welcome result: a welcome goes (or is already under way) only for someone the owner invited.
// Returns the ledger status, or 'skipped'/'failed'. Never throws; a failure is logged as signup_alert_failed.
export async function signupAlert({store,env,phone,profile,ref,arrival,requestId,outcome={},send=sendGreeting,log=console.log}){
 const skip=reason=>{log(JSON.stringify({event:'signup_alert_skipped',reason}));return 'skipped';};
 try{
  const owner=env.OWNER_ALERT_CONVERSATION_ID;
  if(!owner||!env.SITE_ORIGIN)return skip('not_configured');
  if(!uuid(owner))return skip('invalid_setting');
  if(outcome.message_sent||outcome.onboarding_started)return skip('invited');
  const existing=await store.conversationForPhone(phone);
  if(existing&&(await store.accessFor([existing])).get(existing)?.access==='approved')return skip('approved');
  const conversation=await store.conversation(owner);
  if(!conversation)return skip('owner_conversation_missing');
  const result=await deliverReply({store,send,conversation,operation:ALERT_PREFIX+requestId,body:signupAlertText({phone,profile,ref,arrival,env}),source:'operator',env,compose:asWritten});
  log(JSON.stringify({event:'signup_alert',status:result.status,duplicate:Boolean(result.duplicate)}));
  return result.status;
 }catch(error){log(JSON.stringify({event:'signup_alert_failed',status:error?.status??error?.database_status??null}));return 'failed';}
}
