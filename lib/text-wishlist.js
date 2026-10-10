import {marketEnvironment} from './shopping-market.js';
import { SEARCH_FAILURE_REPLY } from './voice.js';
import { searchProducts, formatSearch } from './search.js';
import { inspectAlertLinks } from './price-alerts.js';
import { groupWishlist } from './wishlist.js';
import { selectionOutcome } from './wishlist-selection.js';
import { verifyListing } from './listings.js';
import {listingProduct} from './product-photos.js';
import {wishlistPreviewURL} from './wishlist-preview.js';
import { shoppingConstraints,relevantProducts,relevanceCheck,requestedClothingRange,rangeFailure } from './relevance.js';

export const TEXT_WISHLIST_TOOL={type:'function',name:'text_wishlist',description:'Interpret shopping intent in context. Start sourcing only for a new product request. For pending options, selection supports any subset, all, none, tentative interest, corrections, exclusions, and natural answers. Do not restart search or repeat links when the user has answered. Confirm executes an explicit save request or clear scoped acceptance of an offer. Interest describes a preference without requesting an action. Resolve references against the numbered current options, not phrases.',strict:true,parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['start','selection']},query:{type:'string'},choice:{type:'string'},decision:{type:'string',enum:['interest','confirm','decline','clarify'],description:'confirm: user requests saving or monitoring, or accepts that offered action. interest: user expresses preference only, without requesting saving/monitoring. decline: rejects offered action or selection. clarify: a material reference or action ambiguity remains.'},option_indices:{type:'array',items:{type:'integer'},description:'Zero-based positions in pending options. Return every selected option. All means every index; none uses decline.'},consent:{type:'string',enum:['none','wishlist','wishlist_alerts']},offer_alerts:{type:'boolean',description:'Whether a post-save alert offer is useful. False if the user declines monitoring, requests saving without reminders, or has already answered that offer.'},consent_context:{type:'string',enum:['explicit_request','answer_to_offer','none']},color_choices:{type:'array',description:'Map a user color choice to an observed listing_check.color_options index for the selected option. Empty when no color was requested or unresolved. Never invent a color or a size.',items:{type:'object',additionalProperties:false,properties:{option_index:{type:'integer'},color_index:{type:'integer'}},required:['option_index','color_index']}},size_choices:{type:'array',items:{type:'object',additionalProperties:false,properties:{option_index:{type:'integer'},size:{type:'string',description:'Preserve the complete user size label including its stated system and length, e.g. IT 45, US men 12 or 50R. Do not strip prefixes or convert sizes.'}},required:['option_index','size']}},response:{type:'string',description:'For clarify only: one useful question based on context, no URLs or unsupported commerce claims.'}},required:['action','query','choice','decision','option_indices','consent','offer_alerts','consent_context','size_choices','color_choices','response']}};
const clean=s=>String(s??'').toLowerCase().trim().replace(/[^a-z0-9]+/g,' ');
const label=p=>{const name=p.listing_check?.product_name??p.name;return clean(name).startsWith(clean(p.brand))?name:[p.brand,name].filter(Boolean).join(' ');};
// State is attached to the sent reply, so failed/uncertain deliveries cannot advance it.
export async function textWishlistAction(args,{state,text,env,facts=[],record,search=searchProducts,inspect=inspectAlertLinks,verify=verifyListing}) {
  env=marketEnvironment(facts,env);
  if(verify===verifyListing)verify=(url,name)=>verifyListing(url,name,fetch,undefined,env);
  const constraints=args.action==='start'||!state?.constraints?shoppingConstraints(facts,text):{...shoppingConstraints(facts,text),...state.constraints,...(requestedClothingRange(text)?{range:requestedClothingRange(text)}:{})};
  const respond=async(body,next,extra={})=>{
    await record({identification_policy:'text_wishlist',intent_action:args.action,intent_decision:args.decision,checked_at:new Date().toISOString(),products:[],text_wishlist_state:next,...extra});
    return body;
  };
  if(args.action==='start') {
    const sourcingStarted=Date.now();
    const query=constraints.range&&constraints.range!=='unisex'?`${constraints.range==='men'?"Men's":"Women's"} department: ${args.query}`:args.query;
    let result,refinementNeeded=false;
    try{result=relevantProducts(await search(query+' Include verified colors, materials or other variants of this same model where available.',[],{...env,SEARCH_DEADLINE_MS:60000},fetch,constraints),constraints);}
    catch{
      console.log(JSON.stringify({event:'text_wishlist_search_failed',stage:'search'}));
      return respond(SEARCH_FAILURE_REPLY,null,{status:'failed',text_wishlist_diagnostics:{status:'failed',stage:'search'}});
    }
    const eligible=value=>(value.products??[]).filter(p=>p.match==='likely_match'&&p.sourcing_status==='store_found'&&p.listing_check?.status==='verified').slice(0,3);
    let options=eligible(result);
    const firstCandidates=(result.products??[]).map(p=>({url:p.url,match:p.match,checks:p.listing_checks??[p.listing_check].filter(Boolean)}));
    // A category page or inaccessible merchant is a failed candidate, not the end of sourcing.
    if(!options.length&&!result.refinement_attempted&&(firstCandidates.length||result.relevance_rejections?.length)){
      refinementNeeded=true;
      console.log(JSON.stringify({event:'text_wishlist_search_refine',candidates:firstCandidates.length}));
      const excluded=[...firstCandidates,...(result.relevance_rejections??[])].slice(0,3).map(p=>p.url.slice(0,220)).join(' ');
      try{
        result=relevantProducts(await search(`${query.slice(0,700)}. Find individual product detail pages, preferably the official brand's /p/ product pages. The previous category or inaccessible pages failed verification; find other sourced product URLs. Exclude: ${excluded}`,[],{...env,SEARCH_DEADLINE_MS:60000},fetch,constraints),constraints);
        options=eligible(result);
      }catch{console.log(JSON.stringify({event:'text_wishlist_search_refine_failed'}));}
    }
    const diagnostics={status:result.status,source_provider:result.source_provider,direct_checks:result.direct_checks,relevance_rejections:result.relevance_rejections,initial_candidates:result.initial_checks??firstCandidates,candidates:(result.products??[]).map(p=>({url:p.url,match:p.match,checks:p.listing_checks??[p.listing_check].filter(Boolean)}))};
    console.log(JSON.stringify({event:'text_wishlist_search',candidates:result.products?.length??0,eligible:options.length}));
    if(!options.length)return respond(result.relevance_rejections?.length?rangeFailure(result.relevance_rejections,constraints):formatSearch(result),null,{text_wishlist_diagnostics:diagnostics});
    const primary=options[0];
    const catalogColors=primary.listing_check.color_options??[];
    if(catalogColors.length){
      const expanded=await Promise.all(catalogColors.filter(c=>c.url!==primary.url).slice(0,4).map(async c=>{
        const check=await verify(c.url,primary.name);
        const candidate={...primary,name:check.product_name??primary.name,url:check.url,listing_check:check,price_snapshot:check.price_snapshot,merchant_options:[]};
        return check.status==='verified'&&clean(check.color)===clean(c.color)&&relevanceCheck(candidate,constraints).eligible?candidate:null;
      }));
      options=[primary,...expanded.filter(Boolean),...options.slice(1)];
    }else if(!refinementNeeded&&options.length===1&&Date.now()-sourcingStarted<60000){
      // Research model variants once, rather than making the user do that work.
      try{
        const variants=eligible(relevantProducts(await search(`Research variants of this exact product: ${label(primary)}. Original request: ${args.query}. Find distinct colors, materials or versions of the same model on individual retailer product pages; do not substitute another model.`,[],{...env,SEARCH_DEADLINE_MS:20000},fetch,constraints),constraints));
        for(const variant of variants){
          if(clean(variant.brand)!==clean(primary.brand))continue;
          const check=variant.listing_check;
          const metadata='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:check.product_name,brand:check.product_brand??variant.brand,url:variant.url})+'</script>';
          if(listingProduct(metadata,primary.listing_check.product_name??primary.name,variant.url,{minimumMatch:0.8}))options.push(variant);
        }
      }catch{console.log(JSON.stringify({event:'product_variant_research_failed'}));}
    }
    const unique=options.filter((p,i,all)=>all.findIndex(q=>q.url===p.url||clean(q.listing_check?.product_name??q.name)===clean(p.listing_check?.product_name??p.name)&&clean(q.listing_check?.color)===clean(p.listing_check?.color))===i);
    options=unique.slice(0,5);
    const next={stage:'choice',query:args.query,options,constraints};
    const money=p=>p.price_snapshot?new Intl.NumberFormat('en-US',{style:'currency',currency:p.price_snapshot.currency}).format(p.price_snapshot.amount):null;
    const blocks=options.map((p,i)=>`${options.length>1?i+1+'. ':''}${label(p)}${p.listing_check.color?' — '+p.listing_check.color:''}${money(p)?' · '+money(p):''}\n${p.url}`);
    const catalog=catalogColors.length?`Variants listed by the retailer: ${catalogColors.slice(0,6).map(c=>c.color).join(', ')}${catalogColors.length>6?' and more ('+catalogColors.length+' in total)':''}.`:'';
    const opening=options.length===1?'Found it.':'Here are the options I found.';
    const followup=options.length===1?'Want me to save it or set a price alert?':'Which would you like to keep? You can choose more than one.';
    return respond([opening,...blocks,catalog,unique.length>5?'More variants are available.':null,followup].filter(Boolean).join('\n\n'),next);

  }
  if(!state)return 'Which product would you like me to find and save?';
  if(args.action==='selection')return selectionOutcome(args,{state,facts,env,respond,inspect,constraints,verify});
  return respond('What would you like to do with these options?',state);

}

export async function finishTextWishlist({store,operation,conversationId,result,env}) {
  if(result?.identification_policy!=='text_wishlist'||!result.user_confirmed)return null;
  const alreadySaved=Array.isArray(result.existing_saved_groups)&&result.existing_saved_groups.length>0;
  const reply=alreadySaved?null:await store.wishlistReplyId(operation,{confirmed:true});
  const rows=await store.wishlistEntries(conversationId);
  const items=alreadySaved?groupWishlist(rows).filter(item=>result.existing_saved_groups.includes(item.id)):groupWishlist(rows.filter(row=>row.reply_id===reply));
  if(alreadySaved&&items.length!==new Set(result.existing_saved_groups).size)throw Error('Saved item is not owned');
  if(!items.length)throw new Error('Wishlist save not found');
  let body=alreadySaved?'':items.length>1?'Saved '+items.length+' items to your wishlist.':'Saved to your wishlist.';
  const watches=result.alert_requests??(result.alert_request?[result.alert_request]:[]);
  if(alreadySaved&&!watches.length)body='Already in your wishlist.';
  for(const watch of watches){
    const item=watch.url?items.find(i=>i.links.some(l=>l.url===watch.url)):items[0];
    if(!item)throw new Error('Saved variant missing');
    const alert=await store.enablePriceAlert({p_conversation:conversationId,p_item:item.image_item,p_group:item.id,p_name:item.name,p_size:watch.size,p_baselines:watch.baselines,p_links:watch.links});
    if(!alert?.active)throw new Error('Alert was not activated');
  }
  if(watches.some(w=>!w.baselines.length))body+=' The alert is enabled, but its starting price hasn’t been verified yet.';
  if(watches.length)body+=' Price-drop reminders are on for '+(watches.length===1?'the selected item':'all '+watches.length+' selected items')+'. I’ll check every three days.';
  if(!watches.length&&env.PRICE_ALERTS_ENABLED==='true'&&result.offer_alerts!==false)body+=' Would you like '+(items.length===1?'a price alert for it?':'price alerts for these items?');
  const preview=items.length===1?wishlistPreviewURL(items[0].image_item,items[0].has_image,env):null;
  return body.trim()+(preview?`\n${preview}`:env.SITE_ORIGIN?`\n${env.SITE_ORIGIN.replace(/\/$/,'')}/wishlist`:'');
}
