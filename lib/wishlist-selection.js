import {relevanceCheck} from './relevance.js';
import {baselineOffers,lowestAvailable} from './price-alerts.js';

export async function selectionOutcome(args,{state,facts,env,respond,inspect,constraints}) {
 const available=state?.options??state?.selected_set??(state?.selected?[state.selected]:[]);
 const indices=args.option_indices;
 if(!Array.isArray(indices)||indices.some(i=>!Number.isInteger(i)||i<0||i>=available.length)||new Set(indices).size!==indices.length)return respond('I couldn’t connect that selection to the current options. Which items did you mean?',state);
 if(args.decision==='decline')return respond('Got it. I won’t save these or set reminders.',null);
 if(args.decision==='clarify')return respond(typeof args.response==='string'&&args.response.length<=600&&!/https?:\/\//i.test(args.response)?args.response:'Which options would you like to keep?',state);
 const selected=indices.map(i=>available[i]);
 if(!selected.length)return respond('Which items would you like me to keep?',state);
 if(selected.some(p=>p.listing_check?.status!=='verified'||!relevanceCheck(p,constraints).eligible))return respond('I need to recheck those options before saving them. Would you like me to find alternatives?',state);
 const colors=[...new Set(selected.map(p=>p.listing_check?.color??p.name))];
 const description=colors.join(' and '),set=selected.length===1?'it':selected.length===2?'both':'all '+selected.length;
 if(args.decision==='interest')return respond(`${description}, got it. I can add ${set} to your wishlist. Should I also set a price-drop reminder for ${set}?`,{...state,stage:'offer_set',options:available,selected_set:selected,offered_urls:selected.map(p=>p.url)});
 const explicit=args.consent_context==='explicit_request';
 if(args.decision!=='confirm'||!['wishlist','wishlist_alerts'].includes(args.consent)||(!explicit&&(!['offer_set','size_set'].includes(state?.stage)||selected.some(p=>!state.offered_urls?.includes(p.url)))))return respond('Should I add this selection to your wishlist, with or without price-drop reminders?',state);
 state={...state,selected_set:selected,offered_urls:selected.map(p=>p.url)};
 const watches=[];
 if(args.consent==='wishlist_alerts'){
  if(env.PRICE_ALERTS_ENABLED!=='true')return respond('Price-drop reminders aren’t available right now. Should I save these without reminders?',{...state,stage:'offer_set'});
  const inspected=await Promise.all(selected.map(async p=>({p,...await inspect([{url:p.url,color:p.listing_check.color},...(p.merchant_options??[]).map(m=>({url:m.url,color:m.listing_check?.color}))])})));
  const missing=[];
  for(const {p,sizes=[],checks=[]} of inspected){
   const explicit=(args.size_choices??[]).find(s=>s.option_index===available.findIndex(o=>o.url===p.url))?.size;
   const saved=sizes.filter(size=>facts.some(f=>!f.deleted&&f.field==='size'&&f.key.startsWith('shoes/')&&({eu:'EU',uk:'UK',us_men:'US men',us_women:'US women'}[f.key.split('/')[1]]+' '+f.value)===size));
   const size=explicit&&sizes.includes(explicit)?explicit:saved.length===1?saved[0]:null;
   const baselines=size?lowestAvailable(baselineOffers(checks,size)).map(b=>({...b,drop_percent:0})):[];
   if(!size){missing.push({url:p.url,color:p.listing_check.color,sizes});continue;}
   if(!baselines.length)return respond('I couldn’t verify an available price for every selected size. Should I save the selection without reminders?',{...state,stage:'offer_set'});
   watches.push({url:p.url,size,baselines,links:[{url:p.url,color:p.listing_check.color}]});
  }
  if(missing.length)return respond('Which retailer size should I watch? '+missing.map(m=>`${m.color}: ${m.sizes.length?m.sizes.join(', '):'size availability not verified'}`).join('; ')+'. I haven’t saved these or enabled reminders yet.',{...state,stage:'size_set',size_options:missing});
 }
 return respond(`I’ll add ${set} to your wishlist${watches.length?' and set the price-drop reminders':''}.\n${selected.map(p=>p.url).join('\n')}`,null,{user_confirmed:true,products:selected,alert_requests:watches});
}
