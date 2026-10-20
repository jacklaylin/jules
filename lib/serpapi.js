// A short process-local pause avoids repeated calls to an exhausted optional source.
const pausedUntil=new Map();
export function assertSerpApiAvailable(env){
 if((pausedUntil.get(env.SERPAPI_API_KEY)??0)>Date.now())throw Error('Search source temporarily unavailable');
}
export async function serpApiJSON(url,options,env,fetcher=fetch){
 assertSerpApiAvailable(env);
 const response=await fetcher(url,options);
 let data;try{data=await response.json();}catch{}
 const exhausted=typeof data?.error==='string'&&/run out of searches|quota|credits?|search(?:es)? limit|exhausted/i.test(data.error);
 if(exhausted||response.status===429){
  pausedUntil.set(env.SERPAPI_API_KEY,Date.now()+(exhausted?600000:60000));
  if(pausedUntil.size>100)pausedUntil.delete(pausedUntil.keys().next().value);
  console.log(JSON.stringify({event:'serpapi_paused',reason:exhausted?'quota':'rate_limit'}));
 }
 // An empty result page is an answer (nothing found), not an outage.
 if(response.ok&&typeof data?.error==='string'&&/hasn't returned any results/i.test(data.error))return data;
 if(!response.ok||data?.error||!data)throw Error('Search source unavailable');
 rememberShopping(url,data);
 return data;
}
// Google Shopping results this instance paid for in the last few minutes. A better-price scan after a
// save (lib/store-scan.js) reads the offers the identifying search already returned before paying again.
const RECENT_SHOPPING_MS=900000,recentShopping=[];
function rememberShopping(url,data){
 let params;try{params=new URL(url).searchParams;}catch{return;}
 if(params.get('engine')!=='google_shopping'||!Array.isArray(data.shopping_results))return;
 recentShopping.push({at:Date.now(),gl:params.get('gl')??'us',rows:data.shopping_results});
 if(recentShopping.length>20)recentShopping.shift();
}
export function recentShoppingResults(gl,now=Date.now()){
 return recentShopping.filter(r=>r.gl===gl&&now-r.at<RECENT_SHOPPING_MS).flatMap(r=>r.rows);
}
