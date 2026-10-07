import { searchProducts } from './search.js';
import { inspectAlertLinks, baselineOffers, lowestAvailable } from './price-alerts.js';
import { groupWishlist } from './wishlist.js';

export const TEXT_WISHLIST_TOOL={type:'function',name:'text_wishlist',description:'Start a wishlist conversation when the user expresses wanting a named product, even without explicitly asking for links. Select a sourced color/option, confirm saving or a price alert, or decline. Use only for the current text product conversation; never for a photo or unrelated yes/no.',strict:true,parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['start','select','save','alert','decline']},query:{type:'string',description:'For start only: exact named product and relevant clothing range, no personal identifiers; otherwise empty.'},choice:{type:'string',description:'For select only: user-stated color, numbered option or retailer size label; otherwise empty.'}},required:['action','query','choice']}};
const clean=s=>String(s??'').toLowerCase().trim().replace(/[^a-z0-9]+/g,' ');
const label=p=>[p.brand,p.name].filter(Boolean).join(' ');
const links=p=>[{url:p.url,name:p.name,color:p.listing_check?.color},...(p.merchant_options??[]).filter(m=>clean(m.listing_check?.color)===clean(p.listing_check?.color)).map(m=>({url:m.url,name:p.name,color:m.listing_check?.color}))];
const money=p=>p?new Intl.NumberFormat('en-US',{style:'currency',currency:p.currency}).format(p.amount):'a price I can’t verify yet';
const yes=text=>/^\s*(yes|yeah|yep|sure|please|ok(?:ay)?|do it|save (?:it|them)|(?:set|turn on|enable)(?: the| a)? (?:price )?alert)[.!\s]*$/i.test(text);

// State is attached to the sent reply, so failed/uncertain deliveries cannot advance it.
export async function textWishlistAction(args,{state,text,env,facts=[],record,search=searchProducts,inspect=inspectAlertLinks}) {
  const respond=async(body,next,extra={})=>{
    await record({identification_policy:'text_wishlist',checked_at:new Date().toISOString(),products:[],text_wishlist_state:next,...extra});
    return body;
  };
  if(args.action==='start') {
    const result=await search(args.query,[],env);
    const options=(result.products??[]).filter(p=>p.match==='likely_match'&&p.sourcing_status==='store_found'&&p.listing_check?.status==='verified').slice(0,3);
    if(!options.length)return respond('I couldn’t verify that product yet. Can you send its product link or double-check the model name?',null);
    const next={stage:'choice',query:args.query,options};
    const blocks=options.map((p,i)=>`${i+1}. ${label(p)}${p.listing_check.color?' — '+p.listing_check.color:''}\n${p.url}`);
    return respond(`I found these listings. ${options.every(p=>p.listing_check.color)?'Which color is your favorite?':'Which one did you have in mind? I haven’t verified all the color options.'}\n\n${blocks.join('\n\n')}`,next);
  }
  if(!state)return 'Which product would you like me to find and save?';
  if(args.action==='decline')return respond('Got it. I won’t add it or set an alert.',null);
  if(args.action==='select' && state.stage==='choice') {
    const choice=clean(args.choice);
    const number=/^[1-3]$/.test(choice)?Number(choice)-1:null;
    const matches=number!==null?state.options.filter((p,i)=>i===number):state.options.filter(p=>clean(p.listing_check?.color)===choice||clean(p.name)===choice);
    if(matches.length!==1)return respond('I can’t confidently connect that color to one of these listings. Which numbered option do you mean?',state);
    const selected=matches[0];
    let sizes=[],checks=[];
    if(env.PRICE_ALERTS_ENABLED==='true'&&selected.listing_check?.color){({sizes,checks}=await inspect(links(selected)));}
    const known=sizes.filter(size=>facts.some(f=>{
      if(f.deleted||f.field!=='size')return false;
      const [category,system]=f.key.split('/');
      if(category!=='shoes'||!['eu','uk','us_men','us_women'].includes(system))return false;
      const prefix={eu:'EU',uk:'UK',us_men:'US men',us_women:'US women'}[system];
      return clean(size)===clean(`${prefix} ${f.value}`);
    }));
    const next={...state,stage:'confirm',selected,sizes,checks,size:known.length===1?known[0]:null};
    const price=selected.price_snapshot?`The listed price is ${money(selected.price_snapshot)}; shipping and taxes may be extra.`:'I couldn’t verify a current price.';
    const alert=sizes.length?` Want me to save this color and set a price alert? ${next.size?'I’ll watch your saved size '+next.size+'.':'I’ll need your size.'} I’ll check every three days for any verified price drop.`:' Want me to save this color to your wishlist? I can’t verify a size-specific price alert for it yet.';
    return respond(`${price}${alert}\n${selected.url}`,next);
  }
  if(args.action==='select'&&state.stage==='size') {
    const size=state.sizes.find(s=>clean(s)===clean(args.choice));
    if(!size)return respond(`Please pick the retailer’s size label: ${state.sizes.join(', ')}. I won’t convert your saved size automatically.`,state);
    // Selecting a size is not consent to an alert. Ask once more with the exact condition.
    return respond(`Save ${label(state.selected)} in ${state.selected.listing_check.color}, size ${size}, and alert you when its verified price drops? I’ll check every three days.`,{...state,stage:'confirm',size});
  }
  if(['save','alert'].includes(args.action)&&state.stage==='confirm') {
    if(!yes(text))return respond('Should I save this selection? Say yes or no.',state);
    if(args.action==='alert'&&env.PRICE_ALERTS_ENABLED==='true'&&state.sizes?.length&&!state.size)return respond(`Which size should I watch? The retailer lists ${state.sizes.join(', ')}.`,{...state,stage:'size'});
    const alert=args.action==='alert'&&env.PRICE_ALERTS_ENABLED==='true'&&state.size;
    let baselines=[];
    if(alert) {
      const {checks}=await inspect(links(state.selected));
      baselines=lowestAvailable(baselineOffers(checks,state.size)).map(b=>({...b,drop_percent:0}));
      if(!baselines.length)return respond('I couldn’t verify an available price for that size, so I haven’t enabled an alert. Would you like to save the item without an alert?',{...state,sizes:[],size:null});
    }
    return respond(`I’ll save this selection${alert?' and enable the price alert':''}.\n${state.selected.url}`,null,{user_confirmed:true,products:[state.selected],alert_request:alert?{size:state.size,baselines,links:links(state.selected)}:null});
  }
  return respond('Which option did you mean?',state);
}

export async function finishTextWishlist({store,operation,conversationId,result,env}) {
  if(result?.identification_policy!=='text_wishlist'||!result.user_confirmed)return null;
  const reply=await store.wishlistReplyId(operation);
  const item=groupWishlist((await store.wishlistEntries(conversationId)).filter(row=>row.reply_id===reply))[0];
  if(!item)throw new Error('Wishlist save not found');
  let body='Saved to your wishlist.';
  if(result.alert_request) {
    const {size,baselines,links}=result.alert_request;
    const alert=await store.enablePriceAlert({p_conversation:conversationId,p_item:item.image_item,p_group:item.id,p_name:item.name,p_size:size,p_baselines:baselines,p_links:links});
    if(!alert?.active)throw new Error('Alert was not activated');
    body=`Saved, with a price alert for size ${size}. I’ll check every three days and text you if the verified price drops.`;
  }
  return body+(env.SITE_ORIGIN?`\n${env.SITE_ORIGIN.replace(/\/$/,'')}/wishlist`:'');
}
