// Mocks the single agent's model turn: a list of tool calls with complete strict arguments.
const defaults={
  find_products:{query:'',search_plan:null,use_image:false,image_message_id:null,department:'unspecified',for_someone_else:false,show_variants:false},
  ask_shopping_question:{query:'',search_plan:null,response:'',department:'unspecified',for_someone_else:false},
  respond_to_options:{decision:'interest',option_indices:[],color_choices:[],size_choices:[],response:''},
  save_to_wishlist:{option_indices:[],consent_context:'explicit_request',color_choices:[],size_choices:[],offer_alerts:true},
  manage_price_alerts:{operation:'create',option_indices:[],consent_context:'explicit_request',color_choices:[],size_choices:[],saved_item_ids:[]},
  wishlist_status:{response:''},update_purchase_history:{},update_profile:{changes:[],acknowledgment:''},profile_status:{response:''},
  onboarding:{action:'status'},send_developer_feedback:{feedback:''},conversation_reply:{response:''},
};
export const tool=(name,args={})=>({type:'function_call',name,arguments:JSON.stringify({...defaults[name],...args})});
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
export const withConsent=(fetcher,authorizes=true)=>async(url,options)=>isConsentCheck(options)?consentResponse(typeof authorizes==='function'?authorizes(options):authorizes):fetcher(url,options);
