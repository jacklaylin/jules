import {createSession} from './wishlist-session.js';
export const LEGACY_KEYS=['jules_token','jules_wishlist_token'];

// Magic links return tokens in the URL fragment. Keep them with the shared rotating session, never in the URL.
export function captureSignIn({location,history,localStore,tabStore,now=()=>Date.now()}){
 const session=createSession({storage:localStore});
 const fragment=new URLSearchParams(location.hash.slice(1));
 let error=null;
 if(fragment.has('access_token')){
  session.save({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||now()/1000+(Number(fragment.get('expires_in'))||3600)});
  LEGACY_KEYS.forEach(key=>tabStore.removeItem(key));
 }else if(fragment.has('error_description'))error='The sign-in link expired or was already used. Request a new link.';
 else if(!session.read()){
  // Earlier admin pages kept a non-renewable token per tab; adopt it once so open tabs keep working.
  const legacy=LEGACY_KEYS.map(key=>tabStore.getItem(key)).find(Boolean);
  if(legacy)session.save({access_token:legacy,expires_at:now()/1000+3600});
 }
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 return error;
}
