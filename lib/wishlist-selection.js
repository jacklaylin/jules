import { publicURL } from './search.js';
import {relevanceCheck} from './relevance.js';
import {baselineOffers,initialPriceBaselines} from './price-alerts.js';

export async function selectionOutcome(args,{state,facts,env,respond,inspect,constraints}) {
 const available=state?.options??state?.selected_set??(state?.selected?[state.selected]:[]);
 const retained=state?.confirmed_consent;
 const indices=args.option_indices;
 if(!Array.isArray(indices)||indices.some(i=>!Number.isInteger(i)||i<0||i>=available.length)||new Set(indices).size!==indices.length)return respond('I couldn’t connect that selection to the current options. Which items did you mean?',state);
 if(args.decision==='decline')return respond(state?.already_saved?'No price alerts. The items stay in your wishlist.':'Got it. I won’t save these or set reminders.',null);
 if(args.decision==='clarify')return respond(typeof args.response==='string'&&args.response.length<=600&&!/https?:\/\//i.test(args.response)?args.response:'Which options would you like to keep?',state);
 const selected=indices.map(i=>available[i]);
 if(!selected.length)return respond('Which items would you like me to keep?',state);
 if(selected.some(p=>!publicURL(p.url)||p.listing_check?.status!=='verified'&&!['user_link','conversation_product'].includes(p.reference_provenance)))return respond('I need to recheck those options before saving them. Would you like me to find alternatives?',state);
 if(selected.some(p=>p.listing_check?.status==='verified'&&!relevanceCheck(p,constraints).eligible)&&!(args.decision==='confirm'&&args.consent==='wishlist'&&args.consent_context==='explicit_request'))return respond('Those options don’t match the current shopping preferences. Which items did you want to keep?',state);
 const colors=[...new Set(selected.map(p=>p.listing_check?.color??p.name))];
 const description=colors.join(' and '),set=selected.length===1?'it':selected.length===2?'both':'all '+selected.length;
 const continuing=retained&&selected.length===state.selected_set?.length&&selected.every(p=>state.selected_set.some(s=>s.url===p.url));
 if(continuing&&args.decision==='interest'){args={...args,decision:'confirm',consent:retained,consent_context:'answer_to_offer'};}
 if(args.decision==='interest')return respond(`${description}, got it. I can add ${set} to your wishlist. Should I also set a price-drop reminder for ${set}?`,{...state,stage:'offer_set',options:available,selected_set:selected,offered_urls:selected.map(p=>p.url),confirmed_consent:null});
 const explicit=args.consent_context==='explicit_request';
 if(args.decision!=='confirm'||!['wishlist','wishlist_alerts'].includes(args.consent)||(!explicit&&(!['offer_set','size_set'].includes(state?.stage)||selected.some(p=>!state.offered_urls?.includes(p.url)))))return respond('Should I add this selection to your wishlist, with or without price-drop reminders?',state);
 state={...state,selected_set:selected,offered_urls:selected.map(p=>p.url),confirmed_consent:args.consent};
 const watches=[];
 if(args.consent==='wishlist_alerts'){
  if(env.PRICE_ALERTS_ENABLED!=='true')return respond('Price-drop reminders aren’t available right now. Should I save these without reminders?',{...state,stage:'offer_set'});
  const inspected=await Promise.all(selected.map(async p=>({p,...await inspect([{url:p.url,color:p.listing_check?.color},...(p.merchant_options??[]).map(m=>({url:m.url,color:m.listing_check?.color}))])})));
  const missing=[];
  for(const {p,sizes=[],checks=[]} of inspected){
   const explicit=(args.size_choices??[]).find(s=>s.option_index===available.findIndex(o=>o.url===p.url))?.size;
   const saved=facts.filter(f=>!f.deleted&&f.field==='size'&&f.key.startsWith('shoes/')&&(!f.key.split('/')[2]||f.key.split('/')[2].toLowerCase()===p.brand?.toLowerCase())).map(f=>{
    const system={eu:'EU',uk:'UK',us_men:'US men',us_women:'US women'}[f.key.split('/')[1]];
    return system?system+' '+f.value:null;
   }).filter(Boolean);
   const requested=explicit?[explicit]:saved;
   const size=requested.find(s=>sizes.includes(s))??requested[0];
   if(!size){missing.push({url:p.url,color:p.listing_check?.color,sizes});continue;}
   const baselines=initialPriceBaselines(requested.flatMap(s=>baselineOffers(checks,s))).map(b=>({...b,drop_percent:0}));
   watches.push({url:p.url,size,baselines,links:[{url:p.url,name:p.name,color:p.listing_check?.color,requested_sizes:requested},...(p.merchant_options??[]).map(m=>({url:m.url,name:p.name,color:m.listing_check?.color,requested_sizes:requested}))]});
  }
  if(missing.length)return respond('Which retailer size should I watch? '+missing.map(m=>`${m.color??selected.find(p=>p.url===m.url)?.name}: ${m.sizes.length?m.sizes.join(', '):'size availability not verified'}`).join('; ')+(state.already_saved?'. The items are saved; reminders aren’t on yet.':'. I haven’t saved these or enabled reminders yet.'),{...state,stage:'size_set',size_options:missing});
 }
 const next=args.consent==='wishlist'?{...state,stage:'offer_set',confirmed_consent:null,offered_action:'alerts',already_saved:true}:null;
 return respond(`I’ll add ${set} to your wishlist${watches.length?' and set the price-drop reminders':''}.`,next,{user_confirmed:true,products:selected,alert_requests:watches});
}
