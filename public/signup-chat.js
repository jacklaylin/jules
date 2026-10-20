// Pure helpers for the chat-style signup. They check technical formats (dates, digits) and
// pick Jules's lines from the server's reported outcome; they never interpret what someone means.
import {normalizeSignupPhone} from './signup-phone.js';

// "Sam Rivera" -> first "Sam", last "Rivera". One word leaves the last name for a follow-up question.
export function splitName(value){
 const words=String(value??'').trim().split(/\s+/).filter(Boolean);
 if(!words.length)return null;
 if(words.length===1)return {first:words[0],last:''};
 return {first:words.slice(0,-1).join(' '),last:words.at(-1)};
}

// Digits typed into the birthday box come back as "MM / DD / YYYY" while typing.
export function maskBirthday(value){
 const digits=String(value??'').replace(/\D/g,'').slice(0,8);
 return [digits.slice(0,2),digits.slice(2,4),digits.slice(4)].filter(Boolean).join(' / ');
}

// Returns {iso:"1994-10-19", month, day} for a real past date, or {error} with what to fix.
export function parseBirthday(value,now=new Date()){
 const digits=String(value??'').replace(/\D/g,'');
 if(digits.length!==8)return {error:'format'};
 const month=+digits.slice(0,2),day=+digits.slice(2,4),year=+digits.slice(4);
 const iso=`${digits.slice(4)}-${digits.slice(0,2)}-${digits.slice(2,4)}`;
 const date=new Date(iso+'T00:00:00Z');
 if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==iso||year<1900||date>now)return {error:'date'};
 const adult=`${now.getUTCFullYear()-18}-${now.toISOString().slice(5,10)}`;
 if(iso>adult)return {error:'under_18'};
 return {iso,month,day};
}

const SIGNS=[['Capricorn','♑',1,19],['Aquarius','♒',2,18],['Pisces','♓',3,20],['Aries','♈',4,19],['Taurus','♉',5,20],['Gemini','♊',6,20],['Cancer','♋',7,22],['Leo','♌',8,22],['Virgo','♍',9,22],['Libra','♎',10,22],['Scorpio','♏',11,21],['Sagittarius','♐',12,21],['Capricorn','♑',12,31]];
// The western star sign for a month and day, worked out from the date only.
export function starSign(month,day){
 for(const [name,symbol,m,last] of SIGNS)if(month<m||(month===m&&day<=last))return {name,symbol};
 return {name:'Capricorn',symbol:'♑'};
}

export const GENDERS=[['woman','Woman'],['man','Man'],['non_binary','Non-binary'],['undisclosed','Prefer not to say']];

export const validPhone=value=>normalizeSignupPhone(value);
// A US/Canada number reads back as "+1 (415) 555-0123"; anything else as typed.
export const formatPhone=(e164,typed)=>/^\+1\d{10}$/.test(e164)?`+1 (${e164.slice(2,5)}) ${e164.slice(5,8)}-${e164.slice(8)}`:typed.trim();
// "+14155550123" -> "•••-0123": enough to recognise the number without repeating it whole.
export const maskPhone=phone=>`•••-${String(phone).slice(-4)}`;

// Jules's closing lines, from what the server says actually happened. Never claims a text that wasn't confirmed.
export function outcomeLines(result,phone){
 const sent=result.message_sent===true,uncertain=['uncertain','sending'].includes(result.message_status);
 const waiting=!sent&&!uncertain&&!result.onboarding_started&&result.waitlisted===true;
 if(sent)return {lines:[`done. i just texted ${maskPhone(phone)}.`,'see you in Messages. reply there and we’ll get started.'],open:true};
 if(uncertain)return {lines:['your signup’s saved, but i couldn’t confirm my text reached you.','check Messages before trying again.'],open:true};
 if(result.onboarding_started)return {lines:['you’re all set. let’s keep going in Messages.'],open:true};
 if(waiting&&result.text_url)return {lines:['you’re on the waitlist.','text me from the number you signed up with to say hi. i can reply a few times while you wait, and i’ll text you there when your spot opens.'],open:true};
 if(result.text_url)return {lines:['you’re signed up.','send me the first text from the number you signed up with.'],open:true};
 return {lines:['you’re signed up.'],open:false};
}
