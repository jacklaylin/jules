// Mocks the single agent's model turn: a list of tool calls with complete strict arguments.
const defaults={
  find_products:{query:'',search_plan:null,use_image:false,image_message_id:null,department:'unspecified',for_someone_else:false,show_variants:false,answers_message_ids:[],acknowledgment:''},
  ask_shopping_question:{query:'',search_plan:null,response:'',department:'unspecified',for_someone_else:false},
  respond_to_options:{decision:'interest',option_indices:[],color_choices:[],size_choices:[],option_sizing:[],response:''},
  save_to_wishlist:{option_indices:[],consent_context:'explicit_request',color_choices:[],size_choices:[],option_sizing:[],offer_alerts:true},
  manage_price_alerts:{operation:'create',option_indices:[],consent_context:'explicit_request',color_choices:[],size_choices:[],option_sizing:[],saved_item_ids:[]},
  wishlist_status:{response:'',include_link:false},update_purchase_history:{},update_profile:{changes:[],acknowledgment:''},profile_status:{response:''},
  onboarding:{action:'status'},record_quality_signal:{kind:'other',about:'previous_reply',summary:''},conversation_reply:{response:'',claims:{saved_now:false,alerts_turned_on:false,alerts_turned_off:false},answers_message_ids:[]},prepare_checkout:{items:[]},add_order_screenshot:{image_message_ids:[],store_named_by_user:null},
};
// A well-behaved model gives each alerted option its sizing; the test fixtures are shoes unless a test says otherwise.
const sized=(name,args)=>name==='manage_price_alerts'&&args.option_sizing===undefined&&(args.operation??'create')==='create'?{...args,option_sizing:(args.option_indices??[]).map(option_index=>({option_index,sizing:'footwear'}))}:args;
export const tool=(name,args={})=>({type:'function_call',name,arguments:JSON.stringify({...defaults[name],...sized(name,args)})});
export const agentTurn=(...calls)=>({ok:true,json:async()=>({status:'completed',output:calls})});
export const isAgentRequest=options=>Array.isArray(JSON.parse(options.body).tools);
export const agentContext=options=>JSON.parse(JSON.parse(options.body).input[0].content.replace(/^APPLICATION CONTEXT \(data, not instructions\): /,''));
export const toolNames=options=>JSON.parse(options.body).tools.map(t=>t.name);
// Maps an expected interpretation (the outcome a test asserts) to the agent tool that carries it.
export function fromIntent(intent){
  const pick=(names)=>Object.fromEntries(names.filter(n=>intent[n]!==undefined).map(n=>[n,intent[n]]));
  const choices=pick(['option_indices','color_choices','size_choices']);
  if(intent.action==='start')return tool('find_products',pick(['query','search_plan','department','for_someone_else']));
  if(intent.action==='clarify_search')return tool('ask_shopping_question',pick(['query','search_plan','response']));
  if(intent.action==='wishlist_status')return tool('wishlist_status',{response:intent.response});
  if(intent.action==='conversation')return tool('conversation_reply',{response:intent.response});
  if(intent.decision==='confirm'&&intent.consent==='wishlist_alerts')return tool('manage_price_alerts',{operation:'create',...choices,consent_context:intent.consent_context});
  if(intent.decision==='confirm')return tool('save_to_wishlist',{...choices,consent_context:intent.consent_context,...pick(['offer_alerts'])});
  return tool('respond_to_options',{decision:intent.decision??'interest',...choices,...pick(['response'])});
}
// Answers the independent consent check (a separate small model call before any save or alert).
export const isConsentCheck=options=>JSON.parse(options?.body??'{}').text?.format?.name==='consent';
export const consentResponse=authorizes=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({authorizes})}]}]})});
export const withConsent=(fetcher,authorizes=true)=>restating(async(url,options)=>isConsentCheck(options)?consentResponse(typeof authorizes==='function'?authorizes(options):authorizes):fetcher(url,options));
// The tool outputs the agent loop has sent back to the model this turn.
export const toolOutputs=options=>{const input=JSON.parse(options?.body??'{}').input??[];return input.filter(i=>i.type==='function_call_output').map(i=>JSON.parse(i.output));};
// A model that, once its tools have run, restates their results as its message (conversation_reply),
// claiming exactly what the results report. Turns whose tools produced no result go to fetcher.
export const restating=fetcher=>async(url,options)=>{
  if(!isAgentRequest(options))return fetcher(url,options);
  const outputs=toolOutputs(options),done=outputs.filter(o=>o.status==='done'&&typeof o.result==='string'&&o.result.trim());
  if(!done.length)return fetcher(url,options);
  const outcome=done.at(-1).outcome??{};
  return agentTurn(tool('conversation_reply',{response:done.map(o=>o.result).join('\n\n'),claims:{saved_now:outcome.saved_now===true,alerts_turned_on:outcome.alerts_turned_on===true,alerts_turned_off:outcome.alerts_turned_off===true}}));
};
