import {createHmac} from 'node:crypto';

// A person's referral code for signup links they share (/signup?ref=u-…): stable per person, so every
// share they make (style report link, starter-pack image) credits them in Admin › People. It's keyed
// with the server secret, so the code in a public link can't be turned back into their internal ID;
// Admin recomputes it for each person to find who referred whom. Fits the signup source format.
export function referralRef(conversationId,env){
 const key=env?.SUPABASE_SERVICE_ROLE_KEY;
 if(typeof conversationId!=='string'||!conversationId||!key||key.startsWith('replace-with'))return null;
 return 'u-'+createHmac('sha256',key).update('jules-referral:v1:'+conversationId).digest('hex').slice(0,12);
}
