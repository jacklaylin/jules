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
 return data;
}
