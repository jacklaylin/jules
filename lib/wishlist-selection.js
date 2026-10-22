import { publicURL } from './public-url.js';
import {relevanceCheck} from './relevance.js';
import {baselineOffers,initialPriceBaselines,sizeKey,ONE_SIZE} from './price-alerts.js';
import {mergeListings,brandOf,sameBrand} from './same-product.js';

// Saved sizes the agent said apply to this product. Keys are category/system[/brand]; code only checks
// that each key is a saved size, that a brand-specific size names this product's brand, and that a
// brand exception replaces the general size of its category. Labels keep the stated system; never converted.
const SYSTEMS={eu:'EU',it:'IT',uk:'UK',us:'US',us_men:'US men',us_women:'US women'};
export function profileSizes(facts,product,keys=[]){
 // A key without the stored category/system shape carries no category evidence (e.g. a store name).
 const sizes=facts.filter(f=>!f.deleted&&f.field==='size'&&/^[^/]+\/[^/]+(?:\/[^/]+)?$/.test(f.key??'')&&f.value),parts=f=>f.key.split('/');
 const brand=f=>parts(f)[2]?.toLowerCase(),ours=f=>!brand(f)||brand(f)===String(product.brand??'').trim().toLowerCase();
 const chosen=sizes.filter(f=>keys.includes(f.key)&&ours(f)),categories=new Set(chosen.map(f=>parts(f)[0]));
 const applicable=[...new Set([...chosen,...sizes.filter(f=>brand(f)&&ours(f)&&categories.has(parts(f)[0]))])];
 const exception=new Set(applicable.filter(brand).map(f=>parts(f)[0]));
 return [...new Set(applicable.filter(f=>brand(f)||!exception.has(parts(f)[0])).map(f=>{
  // One saved value can hold several sizes the person wears ("31, 32"): a list format, each its own label.
  const system=SYSTEMS[parts(f)[1]];
  return String(f.value).split(/\s*,\s*/).map(v=>v.trim()).filter(Boolean).map(value=>system&&!sizeKey(value).startsWith(sizeKey(system)+' ')?system+' '+value:value);
 }).flat())];
}

export async function selectionOutcome(args,{state,facts,env,respond,inspect,constraints,verify}) {
 const available=state?.options??state?.selected_set??(state?.selected?[state.selected]:[]);
 const retained=state?.confirmed_consent;
 const indices=args.option_indices;
 if(!Array.isArray(indices)||indices.some(i=>!Number.isInteger(i)||i<0||i>=available.length)||new Set(indices).size!==indices.length)return respond('i couldn’t connect that selection to the current options. which items did you mean?',state);
 if(args.decision==='decline')return respond(state?.already_saved?'no price alerts. the items stay in your wishlist.':'got it. i won’t save these or set reminders.',null);
 if(args.decision==='clarify')return respond(typeof args.response==='string'&&args.response.length<=600&&!/https?:\/\//i.test(args.response)?args.response:'which options would you like to keep?',state);
 const selected=[];
 for(const i of indices){
  let p=available[i];const choice=(args.color_choices??[]).find(c=>c.option_index===i);
  if(choice){
   const color=p.listing_check?.color_options?.[choice.color_index];
   if(!Number.isInteger(choice.color_index)||!color||!publicURL(color.url)||!verify)return respond('i couldn’t verify that color for this item. which retailer color did you mean?',state);
   const check=await verify(color.url,p.listing_check?.product_name??p.name);
   if(check.status!=='verified'||check.color!==color.color)return respond('i couldn’t verify the selected color’s listing. i haven’t saved another color.',state);
   // A color representative is not a user-selected size or verified size availability.
   p={...p,url:check.url,name:(p.listing_check?.product_name??p.name)+' — '+color.color,selected_color:color.color,listing_check:{...check,availability:null},price_snapshot:check.price_snapshot,merchant_options:[]};
  }
  available[i]=p;selected.push(p);
 }
 if(!selected.length)return respond('which items would you like me to keep?',state);
 // Options the user says are one product sold by different stores (or the agent reads as clearly the
 // same) save as one item listing every store. Code checks only that each group names selected options,
 // once each, and that no two of them are known to be different brands.
 const groups=sameProductGroupsFor(args.same_product_groups,indices,available);
 if(groups.length){
  const lead=new Map(groups.map(g=>[Math.min(...g),mergeListings(g.map(i=>available[i]),{currency:env.SHOPPING_CURRENCY??'USD'})]));
  const grouped=new Set(groups.flat());
  selected.splice(0,selected.length,...indices.flatMap(i=>lead.has(i)?[lead.get(i)]:grouped.has(i)?[]:[available[i]]));
  // A size, colour or sizing the user gave for any of a group's options applies to the merged item.
  const at=new Map(groups.flatMap(g=>{const merged=lead.get(Math.min(...g)),to=available.findIndex(o=>o.url===merged.url);return g.map(i=>[i,to]);}));
  const remap=list=>(list??[]).map(c=>at.has(c.option_index)?{...c,option_index:at.get(c.option_index)}:c).filter((c,k,all)=>all.findIndex(o=>o.option_index===c.option_index)===k);
  args={...args,size_choices:remap(args.size_choices),option_sizing:remap(args.option_sizing)};
  console.log(JSON.stringify({event:'same_product_saved',groups:groups.length}));
 }
 if(selected.some(p=>!publicURL(p.url)||p.listing_check?.status!=='verified'&&!['user_link','conversation_product','search_unverified'].includes(p.reference_provenance)))return respond('i need to recheck those options before saving them. would you like me to find alternatives?',state);
 // Items the user showed in their own screenshot are theirs to save, whatever Jules's search preferences say.
 if(selected.some(p=>p.listing_check?.status==='verified'&&p.reference_provenance!=='screenshot'&&!relevanceCheck(p,constraints).eligible)&&!(args.decision==='confirm'&&args.consent==='wishlist'&&args.consent_context==='explicit_request'))return respond('those options don’t match the current shopping preferences. which items did you want to keep?',state);
 const colors=[...new Set(selected.map(p=>p.listing_check?.color??p.name))];
 const description=colors.join(' and '),set=selected.length===1?'it':selected.length===2?'both':'all '+selected.length;
 const continuing=retained&&selected.length===state.selected_set?.length&&selected.every(p=>state.selected_set.some(s=>s.url===p.url));
 if(continuing&&args.decision==='interest'){args={...args,decision:'confirm',consent:retained,consent_context:'answer_to_offer'};}
 if(args.decision==='confirm'&&args.consent==='wishlist'&&carriesApprovedAlert(args,state,selected.map(p=>p.url)))args={...args,consent:'wishlist_alerts'};
 if(args.decision==='interest')return respond(`${description}, got it. I can add ${set} to your wishlist. Should I also set a price-drop reminder for ${set}?`,{...state,stage:'offer_set',options:available,selected_set:selected,offered_urls:selected.map(p=>p.url),confirmed_consent:null});
 const explicit=args.consent_context==='explicit_request';
 if(args.decision!=='confirm'||!['wishlist','wishlist_alerts'].includes(args.consent)||(!explicit&&(!['offer_set','size_set'].includes(state?.stage)||selected.some(p=>!state.offered_urls?.includes(p.url)))))return respond('should i add this selection to your wishlist, with or without price-drop reminders?',state);
 state={...state,selected_set:selected,offered_urls:selected.map(p=>p.url),confirmed_consent:args.consent,
  sizing_by_url:{...state.sizing_by_url,...Object.fromEntries(selected.map(p=>[p.url,(args.option_sizing??[]).find(s=>s.option_index===available.findIndex(o=>o.url===p.url))?.sizing]).filter(([,v])=>v))},
  size_keys_by_url:{...state.size_keys_by_url,...Object.fromEntries(selected.map(p=>[p.url,(args.option_sizing??[]).find(s=>s.option_index===available.findIndex(o=>o.url===p.url))?.profile_size_keys]).filter(([,v])=>v?.length))}};
 const watches=[];
 if(args.consent==='wishlist_alerts'){
  if(env.PRICE_ALERTS_ENABLED!=='true')return respond('price-drop reminders aren’t available right now. should i save these without reminders?',{...state,stage:'offer_set'});
  // Sizing comes from the agent's structured reading; a size choice the user stated takes precedence.
  const choice=(list,p)=>(list??[]).find(s=>s.option_index===available.findIndex(o=>o.url===p.url));
  // A size question's answer resumes the approved action; the sizing read at approval still applies.
  const sizingOf=p=>choice(args.option_sizing,p)?.sizing??state.sizing_by_url?.[p.url];
  const oneSizeAsked=p=>sizingOf(p)==='one_size'&&!choice(args.size_choices,p);
  const inspected=await Promise.all(selected.map(async p=>{const asked=oneSizeAsked(p)?{requested_sizes:[ONE_SIZE]}:{};
   return {p,...await inspect([{url:p.url,name:p.name,color:p.listing_check?.color,market_country:env.SHOPPING_COUNTRY,market_currency:env.SHOPPING_CURRENCY,...asked},...(p.merchant_options??[]).map(m=>({url:m.url,name:p.name,color:m.listing_check?.color,market_country:env.SHOPPING_COUNTRY,market_currency:env.SHOPPING_CURRENCY,...asked}))])};}));
  const missing=[];
  for(const {p,sizes=[],checks=[]} of inspected){
   const explicit=choice(args.size_choices,p)?.size,sizing=sizingOf(p);
   // A one-size item is watched as one size only when its page lists no other sizes.
   const oneSize=oneSizeAsked(p)&&sizes.every(s=>sizeKey(s)===sizeKey(ONE_SIZE));
   // The agent names the saved sizes for this item's category; footwear without that reading keeps the shoe sizes.
   const keys=choice(args.option_sizing,p)?.profile_size_keys?.length?choice(args.option_sizing,p).profile_size_keys:state.size_keys_by_url?.[p.url]
    ??(sizing==='footwear'?facts.filter(f=>f.field==='size'&&f.key?.startsWith('shoes/')&&SYSTEMS[f.key.split('/')[1]]).map(f=>f.key):[]);
   const saved=sizing==='one_size'?[]:profileSizes(facts,p,keys);
   const requested=oneSize?[ONE_SIZE]:explicit?[explicit]:saved;
   const size=requested.find(s=>sizes.some(x=>sizeKey(x)===sizeKey(s)))??requested[0];
   if(!size){missing.push({url:p.url,color:p.listing_check?.color,sizes});continue;}
   const baselines=initialPriceBaselines(requested.flatMap(s=>baselineOffers(checks,s))).map(b=>({...b,drop_percent:0}));
   watches.push({url:p.url,size,baselines,links:[{url:p.url,name:p.name,color:p.listing_check?.color,requested_sizes:requested,market_country:env.SHOPPING_COUNTRY,market_currency:env.SHOPPING_CURRENCY},...(p.merchant_options??[]).map(m=>({url:m.url,name:p.name,color:m.listing_check?.color,requested_sizes:requested,market_country:env.SHOPPING_COUNTRY,market_currency:env.SHOPPING_CURRENCY}))]});
  }
  if(missing.length)return respond('which retailer size should i watch? '+missing.map(m=>`${m.color??selected.find(p=>p.url===m.url)?.name}: ${m.sizes.length?m.sizes.join(', '):'size availability not verified'}`).join('; ')+(state.already_saved?'. the items are saved; reminders aren’t on yet.':'. i haven’t saved these or enabled reminders yet.'),{...state,stage:'size_set',size_options:missing});
 }
 // A plain save of items that are only the saved list standing in (nothing was pending) changes
 // nothing. October 21: Jules offered two items it had no product record for, the user said yes, and
 // the reply said the saved items were "already in your wishlist". Say what is saved and ask instead.
 if(args.consent==='wishlist'&&!watches.length&&selected.length&&selected.every(p=>p.saved_item_id&&p.sourcing_status==='saved_reference'))
  return respond(`${selected.map(p=>p.name).filter(Boolean).join('; ')||'those'} ${selected.length>1?'are':'is'} already in your wishlist, so nothing new was saved. which item did you mean?`,null,{user_confirmed:false,products:[]});
 const next=args.consent==='wishlist'&&args.offer_alerts!==false?{...state,stage:'offer_set',confirmed_consent:null,offered_action:'alerts',already_saved:true}:null;
 return respond(`i’ll add ${set} to your wishlist${watches.length?' and set the price-drop reminders':''}.`,next,{user_confirmed:true,products:selected,alert_requests:watches,offer_alerts:args.offer_alerts!==false,...(selected.every(p=>p.saved_item_id)?{existing_saved_groups:selected.map(p=>p.saved_item_id)}:{})});
}
export function sameProductGroupsFor(groups,indices,available){
 const used=new Set();
 return (Array.isArray(groups)?groups:[]).map(g=>Array.isArray(g)?[...new Set(g)]:[]).filter(g=>{
  if(g.length<2||g.some(i=>!indices.includes(i)||used.has(i)))return false;
  const brands=g.map(i=>brandOf(available[i])).filter(Boolean);
  if(brands.some(b=>!sameBrand(b,brands[0])))return false;
  g.forEach(i=>used.add(i));return true;
 });
}
// A save of exactly the set an approved save-and-alert is waiting on (stage size_set: Jules asked which
// size to watch) resumes that approval, alert included, as an alert request would. The approval came
// from the user; which of the two tools the agent picked to finish it must not drop the alert they asked
// for (October 22: the size reply saved without the alert in 1 of 3 replays). offer_alerts false is the
// agent's reading that the user turned reminders down, so that save stays a plain save.
export function carriesApprovedAlert(args,state,urls){
 const set=state?.selected_set??[];
 return state?.stage==='size_set'&&state.confirmed_consent==='wishlist_alerts'&&args?.offer_alerts!==false
  &&urls.length===set.length&&urls.every(u=>u&&set.some(s=>s.url===u));
}
// An acceptance must answer an actual save/monitor offer for exactly those options.
export function invalidOfferConsent(intent,state){
 if(intent.action!=='selection'||intent.decision!=='confirm'||intent.consent_context!=='answer_to_offer')return false;
 if(state?.confirmed_consent)return false;
 const options=state?.options??state?.selected_set??[],indices=intent.option_indices;
 return !['offer_set','size_set'].includes(state?.stage)||!Array.isArray(indices)||indices.some(i=>!options[i]||!state.offered_urls?.includes(options[i].url));
}
