// Remove and Undo answer at once (AGENTS.md Load speed): the card leaves (or comes back) and the toast shows,
// and the server is told behind it. A refused request puts the card back as it was and shows the error.

// Takes one entry out of an ordered Map; the returned function puts it back in its old place.
export function takeOut(cache,id){
 const keys=[...cache.keys()],at=keys.indexOf(id);
 const value=cache.get(id),before=new Set(keys.slice(0,at<0?0:at));cache.delete(id);
 return (update=value)=>{
  if(cache.has(id)||update===undefined)return;
  const entries=[...cache];let index=0;
  entries.forEach(([key],i)=>{if(before.has(key))index=i+1;});
  entries.splice(index,0,[id,update]);
  cache.clear();for(const [key,item] of entries)cache.set(key,item);
 };
}

// cache: the page's items in order. send(input) posts one change (and joins the page's in-flight writes).
// removeCard(card) plays the exit; refilter() recounts without redrawing; redraw() draws the cache again.
// notify(text,undo,extra) shows the toast; dismiss() hides it; fail(error) shows an error line.
export function createRemoval({cache,send,removeCard,refilter,redraw,notify,dismiss,fail,bought}){
 async function remove(item,card){
  const kept=cache.get(item.id)??item,putBack=takeOut(cache,item.id);
  const request=send({action:'remove',group:item.id,entries:item.entries});
  const motion=card?removeCard(card):Promise.resolve();
  refilter();
  // The next change to this card (Undo, I bought it) waits for the removal, so the server sees them in order.
  const settled=request.then(()=>true,()=>false);
  notify(kept.price_alert?.active?'Removed. Alert turned off.':'Removed from your wishlist.',
   async()=>{if(await settled)await restore(kept,putBack);},
   kept.bought||!bought?null:{label:'I bought it',run:async()=>{if(await settled)await bought(kept);}});
  try{await request;return true;}
  catch(error){await motion;dismiss();putBack();redraw();fail(error);return false;}
 }
 // Restoring leaves the alert off (the server keeps it off).
 async function restore(item,putBack=back=>cache.set(item.id,back)){
  putBack({...item,...(item.price_alert?{price_alert:{...item.price_alert,active:false}}:{})});redraw();
  try{await send({action:'restore',group:item.id,entries:item.entries});}
  catch(error){takeOut(cache,item.id);redraw();throw error;}
 }
 return {remove,restore};
}
