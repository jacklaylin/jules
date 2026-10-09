const recovery='Your conversation and draft are preserved. Check your wishlist before retrying; the save may have completed.';

export async function readSimulatorResponse(response,{turn=false}={}){
  let data;
  try{data=JSON.parse(await response.text());}catch{
    const reason=[408,504].includes(response.status)?'Jules took too long to respond.':'The server returned an unreadable response.';
    throw Error(`${reason} ${recovery}`);
  }
  if(!response.ok)throw Error(typeof data?.error==='string'?data.error:`The request failed (HTTP ${response.status}). ${recovery}`);
  const valid=turn?data?.snapshot&&Array.isArray(data.snapshot.messages)&&Array.isArray(data.replies)&&Array.isArray(data.events)&&typeof data.outcome==='string'&&Number.isFinite(data.elapsed_ms):Array.isArray(data?.items);
  if(!valid)throw Error(`The server returned an incomplete response. ${recovery}`);
  return data;
}
