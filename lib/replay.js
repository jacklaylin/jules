import { searchProducts } from './search.js';
import { generateReply } from './ai.js';
import { textWishlistAction } from './text-wishlist.js';
import { relevanceCheck, shoppingConstraints } from './relevance.js';

const man=[{field:'gender',key:'identity',value:'man'},{field:'size',key:'shoes/eu',value:'45'}];
const woman=[{field:'shopping_range',key:'clothing',value:'women'},{field:'size',key:'shoes/eu',value:'39'}];
const pendingOptions=['Ivory','Black','Navy'].map((color,i)=>({brand:'Prada',name:i===2?'Speedrock leather and mesh fabric sneakers':'Speedrock Re-Nylon and suede sneakers',url:'https://www.prada.com/us/en/p/'+(i===2?'speedrock-leather-and-mesh-fabric-sneakers/2EE468_3ZM0_F0008_F_G000':'speedrock-re-nylon-and-suede-sneakers/'+(i===0?'2EE469_D7C_F0304_F_G000':'2EE469_D7C_F0002_F_G000')),match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',shopping_range:'men',color}}));
const pendingCase={facts:man,brand:'prada',model:'speed.?rock',state:{stage:'choice',query:'Prada Speedrock sneakers',options:pendingOptions},history:[{direction:'outbound',status:'sent',body:'Which version did you have in mind? 1. Ivory suede, 2. Black suede, 3. Navy mesh.'}]};
export const REPLAY_CASES=[
 {id:'nike-named',name:'Named shoe · Nike',message:'Find me Nike Air Max 90 sneakers with product links.',facts:man,brand:'nike',model:'air.*max.*90'},
 {id:'asics-profile',name:'Saved women’s profile · ASICS',message:'I really want ASICS GEL-KAYANO 14 sneakers.',facts:woman,brand:'asics',model:'kayano.*14'},
 {id:'new-balance-variants',name:'Multiple versions · New Balance',message:'I want New Balance 990 sneakers. Which version should I get?',facts:man,brand:'new balance',model:'990',requireQuestion:true},
 {id:'salomon-named',name:'Named shoe · Salomon',message:'Find Salomon XT-6 shoes and send product pages.',facts:man,brand:'salomon',model:'xt.?6'},
 {id:'prada-spacing',name:'Spacing in model name · Prada',message:'I really want the Prada Speed Rock sneakers.',facts:man,brand:'prada',model:'speed.?rock'},
 {id:'range-correction',name:'Correction preserves men’s range',message:'Those are women’s shoes, I am a man. Find the Nike Air Max 90 for me.',history:[{direction:'outbound',status:'sent',body:'Here are women’s Air Max shoes.'}],facts:man,brand:'nike',model:'air.*max.*90'},
 {id:'gift-override',name:'Explicit recipient overrides profile',message:'Find women’s ASICS GEL-KAYANO 14 for my wife.',facts:man,brand:'asics',model:'kayano.*14'},
 {id:'unknown-model',name:'Unknown shoe asks for identification',message:'Find the Examplebrand Totallyfictional 999 shoes.',facts:man,brand:'examplebrand',model:'totallyfictional',unknown:true},
 {id:'satisfy-waffle',name:'Official store support · SATISFY',message:'Find SATISFY MothTech Waffle Long Tee product pages.',facts:[],brand:'satisfy',model:'mothtech.*waffle'},
 {id:'mfpen-scout',name:'Product page rather than collection · mfpen',message:'Find mfpen Scout Deck Shoe Scratched Black product pages.',facts:[],brand:'mfpen',model:'scout.*deck'},
 ...[
  ['selection-subset','Tentative subset','Ivory or black I think',[0,1]],
  ['selection-exclusion','Natural exclusion','Both neutrals appeal to me; leave out the navy pair.',[0,1]],
  ['selection-all','All pending options','Honestly, I could see myself wearing every one of these.',[0,1,2]],
  ['selection-none','No pending options','None of these is doing it for me. Let’s leave these off my wishlist.',[]],
 ].map(([id,name,message,expected_selection])=>({...pendingCase,id,name,message,expected_selection})),
];
REPLAY_CASES.push(...[
 ['alert-consent-profile','Approved alerts use saved sizing','Yes please'],
 ['alert-size-continuation','Size update resumes prior approval','I’m a size 45 eur/it and 12 US'],
].map(([id,name,message])=>({...pendingCase,id,name,message,expected_watches:[0,1],state:{...pendingCase.state,stage:id==='alert-size-continuation'?'size_set':'offer_set',selected_set:pendingOptions.slice(0,2),offered_urls:pendingOptions.slice(0,2).map(p=>p.url),...(id==='alert-size-continuation'?{confirmed_consent:'wishlist_alerts'}:{})},history:[...pendingCase.history,{direction:'inbound',body:'I like both colors'},{direction:'outbound',status:'sent',body:'I can add both to your wishlist. Should I also set a price-drop reminder for both?'},...(id==='alert-size-continuation'?[{direction:'inbound',body:'Yes please'},{direction:'outbound',status:'sent',body:'Which size should I watch?'}]:[])]})));
REPLAY_CASES.push(...[
 ['save-known-set','Save referenced products without sourcing','Can you add these to my wishlist',[0,1,2]],
 ['save-known-subset','Save a specified subset','Keep the first two in my wishlist, please',[0,1]],
 ['save-corrected-set','Save with an exclusion','Save the black pair, not the other two',[1]],
 ['save-only-consent','Save without monitoring consent','Add all of these to my wishlist; leave reminders off',[0,1,2]],
].map(([id,name,message,expected_saved])=>({...pendingCase,id,name,message,expected_saved,state:{...pendingCase.state,stage:'reference',options:pendingOptions.map(p=>({...p,sourcing_status:'store_not_found',listing_check:{status:'check_failed'},reference_provenance:'conversation_product'}))}})));
REPLAY_CASES.push({...pendingCase,id:'decline-after-save',name:'Decline alerts while retaining saved items',message:'No thanks, just keep it in my wishlist.',expected_selection:[],state:{...pendingCase.state,stage:'offer_set',already_saved:true,offered_action:'alerts',selected_set:[pendingOptions[0]],offered_urls:[pendingOptions[0].url]},history:[...pendingCase.history,{direction:'inbound',body:'Save the ivory pair'},{direction:'outbound',status:'sent',body:'Saved to your wishlist. Would you like a price alert for it?'}]});
const savedTrouserLink='https://www.mrporter.com/en-us/mens/product/dries-van-noten/clothing/casual-trousers/straight-leg-cotton-trousers/46376663162930410';
REPLAY_CASES.push(...[
 ['saved-status-complaint',"i don't see it in my wishlist"],
 ['saved-status-location','Where did that save go?'],
 ['saved-status-confirmation','The wishlist page is empty—did you actually save the trousers?'],
].map(([id,message])=>({id,name:'Saved item status · '+id.split('-').at(-1),message,facts:man,brand:'dries',model:'trousers',expected_status:true,execution:{mode:'simulator'},items:[{id:'fixture-item',name:'Mr Porter trousers reference',links:[{url:savedTrouserLink,verification_status:'unverified'}]}],history:[{direction:'inbound',body:'Save this to my wishlist without alerts: '+savedTrouserLink},{direction:'outbound',status:'sent',body:'Saved to your wishlist.'}]})));
const URLs=body=>[...String(body).matchAll(/https:\/\/[^\s<>]+/g)].map(m=>m[0].replace(/[),.;]+$/,''));
const refusal=body=>/couldn.t (?:finish|verify|find|prepare)|try again|search.*failed|haven.t sent|cannot (?:search|verify)|can.t (?:search|verify)/i.test(body);
export function scoreReplay(test,{body='',result,error}={}){
 const failures=[];
 if(error)failures.push('reply_failed');
 const constraints=shoppingConstraints(test.facts,test.message);
 const products=result?.text_wishlist_state?.options??result?.products??[];
 const urls=URLs(body);
 const questions=String(body).match(/[^.!?]*\?/g)??[];
 const offered=result?.text_wishlist_state?.selected_set??[];
 const offerValid=result?.text_wishlist_state?.stage==='offer_set'&&offered.length>0&&offered.every(p=>p.listing_check?.status==='verified'&&relevanceCheck(p,constraints).eligible&&String(p.brand).toLowerCase().includes(test.brand.toLowerCase())&&new RegExp(test.model,'i').test(p.name));
 const question=Boolean(offerValid&&questions.length)||questions.some(q=>(test.unknown?/\b(name|label|photo|link|model)\b/i:/\b(versions?|variants?|models?|colou?rs?|leather|suede|mesh|low.top|high.top|v[1-9])\b/i).test(q))||(!test.unknown&&test.requireQuestion&&/\b(versions?|variants?|v[1-9])\b/i.test(body)&&questions.some(q=>/\b(retro|runner|fashion|classic|vintage|sporty)\b/i.test(q)&&/\bor\b/i.test(q)));
 const known=new Map(products.flatMap(p=>[[p.url,p],...(p.merchant_options??[]).map(m=>[m.url,{...p,listing_check:m.listing_check}]) ]));
 for(const url of urls){
  const p=known.get(url);
  if(!p||p.listing_check?.status!=='verified'){failures.push('unverified_or_unrecorded_link');continue;}
  if(!relevanceCheck(p,constraints).eligible||(constraints.range&&constraints.range!=='unisex'&&![constraints.range,'unisex'].includes(p.listing_check?.shopping_range)))failures.push('profile_mismatch');
  if(!String(p.brand??'').toLowerCase().includes(test.brand.toLowerCase()))failures.push('wrong_brand');
  if(!(new RegExp(test.model,'i')).test([p.name,p.listing_check?.product_name,url].join(' ')))failures.push('wrong_model');
  if(/\/(?:c|categories?|search)\//i.test(new URL(url).pathname))failures.push('category_link');
 }
 if(test.expected_status){
  if(result?.identification_policy!=='wishlist_status')failures.push('wishlist_status_not_inspected');
  if(result?.user_confirmed||result?.alert_requests?.length||urls.length)failures.push('status_restarted_shopping');
 }
 else if(test.expected_saved){
  const expected=test.expected_saved.map(i=>test.state.options[i].url).sort();
  if(result?.user_confirmed!==true)failures.push('explicit_save_not_prepared');
  if(JSON.stringify((result?.products??[]).map(p=>p.url).sort())!==JSON.stringify(expected))failures.push('wrong_saved_set');
  if(result?.intent_action!=='selection'||urls.length)failures.push('restarted_or_repeated_sources');
  if(result?.alert_requests?.length)failures.push('unconsented_monitoring');
  if(test.id==='save-only-consent'&&(result?.offer_alerts!==false||result?.text_wishlist_state!==null))failures.push('repeated_declined_alert_offer');
 }
 else if(test.expected_watches){
  const expected=test.expected_watches.map(i=>test.state.options[i].url).sort();
  if(!result?.user_confirmed)failures.push('approved_action_not_prepared');
  if(JSON.stringify((result?.alert_requests??[]).map(w=>w.url).sort())!==JSON.stringify(expected))failures.push('wrong_watch_set');
  if(result?.text_wishlist_state!==null)failures.push('approved_action_not_advanced');
  if((result?.alert_requests??[]).some(w=>!w.size))failures.push('saved_size_not_used');
  if(questions.length)failures.push('repeated_question_after_consent');
 }
 else if(test.expected_selection){
  const expected=test.expected_selection.map(i=>test.state.options[i].url).sort();
  if(JSON.stringify(offered.map(p=>p.url).sort())!==JSON.stringify(expected))failures.push('wrong_selected_set');
  if(expected.length&&!offerValid)failures.push('missing_next_step_offer');
  if(!expected.length&&result?.text_wishlist_state!==null)failures.push('selection_not_cleared');
  if(result?.intent_action!=='selection'||urls.length)failures.push('restarted_or_repeated_sources');
  if(result?.user_confirmed||result?.alert_requests?.length)failures.push('unconsented_action');
 }
 else if(test.unknown){if(urls.length)failures.push('invented_unknown_product');if(!question)failures.push('missing_identification_question');}
 else{
  if(refusal(body))failures.push('generic_failure_is_not_success');
  if(!urls.length&&!question)failures.push('no_product_or_variant_question');
  if(test.requireQuestion&&!question)failures.push('missing_variant_question');
 }
 // Replay prepares responses only. A reported completed save or active watch is a failure.
 if((!test.expected_status&&/\bsaved (?:it|this|to your wishlist)/i.test(body))||/\b(?:alert|watch) (?:is |now )?active/i.test(body))failures.push('unperformed_side_effect_claim');
 return {passed:!failures.length,failures:[...new Set(failures)],links:urls.length,question,constraints:{range:constraints.range},body};
}
export async function runReplay(test,env,{generate=generateReply,search,fetcher=fetch}={}){
 let result,tool=null;
 const started=Date.now();
 const usage={requests:0,input_tokens:0,output_tokens:0};
 const tracked=async(url,options)=>{
  const response=await fetcher(url,options);
  if(url==='https://api.openai.com/v1/responses'){
   usage.requests++;
   const original=response.json.bind(response);
   response.json=async()=>{const data=await original();usage.input_tokens+=data.usage?.input_tokens??0;usage.output_tokens+=data.usage?.output_tokens??0;return data;};
  }
  return response;
 };
 const source=search??((query,images,settings,ignored,constraints)=>searchProducts(query,images,settings,tracked,constraints));
 const messages=[...(test.history??[]),{direction:'inbound',body:test.message}];
 try{
  const body=await generate(messages,env,tracked,{enabled:true,saved:true,facts:test.facts??[],wishlistState:test.state??null,wishlistItems:test.items??[],executionContext:test.execution??{mode:'production'},
   recordSearch:async value=>{result=value;tool='search_products';},
   wishlistAction:async (args,resolvedState=test.state??null)=>{tool='text_wishlist';return textWishlistAction(args,{state:resolvedState,text:test.message,env,facts:test.facts??[],record:async value=>{result=value;},search:source});},
  });
  return {id:test.id,name:test.name,...scoreReplay(test,{body,result}),tool,elapsed_ms:Date.now()-started,usage,cost_usd:null,configuration:{conversation_model:env.OPENAI_MODEL||'gpt-4.1-mini',search_model:env.OPENAI_SEARCH_MODEL||'gpt-4.1'},result};
 }catch{return {id:test.id,name:test.name,...scoreReplay(test,{error:true}),tool,elapsed_ms:Date.now()-started,usage,cost_usd:null};}
}
