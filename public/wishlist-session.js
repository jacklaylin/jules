// Keep the rotating token pair together. Never log either token.
export function createSession({storage,fetcher=fetch,now=()=>Date.now(),lock=async work=>work()}={}){
 const key='jules_wishlist_session';let pending;
 const read=()=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
 const save=value=>storage.setItem(key,JSON.stringify(value));
 const clear=()=>storage.removeItem(key);
 async function token(force=false){
  const session=read();if(!session)return null;
  if(!force && (!session.refresh_token||session.expires_at>now()/1000+60))return session.access_token;
  if(!session.refresh_token)return session.access_token;
  if(!pending)pending=lock(async()=>{
   const current=read();if(!current)return null;
   if(current.access_token!==session.access_token||!force&&current.expires_at>now()/1000+60)return current.access_token;
   const response=await fetcher('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh',refresh_token:current.refresh_token}),cache:'no-store'});
   if(!response.ok){if([400,401,403].includes(response.status))clear();throw new Error(response.status>=500?'Could not renew your session. Please try again.':'Please sign in again.');}
   const data=await response.json();
   // A concurrent logout must not resurrect a saved session.
   if(read()?.refresh_token!==current.refresh_token)return null;
   save(data);return data.access_token;
  }).finally(()=>{pending=null;});
  return pending;
 }
 return {read,save,clear,token};
}
