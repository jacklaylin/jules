import {randomUUID} from 'node:crypto';
import {receiveInInbox} from './inbox.js';
import {stateFromSearch} from './shopping-context.js';
import {imageType} from './images.js';

export function validateSimulation(input){
  const fail=()=>{const error=Error('Invalid simulator input. Start a new conversation or use a report exported by this simulator.');error.status=400;throw error;};
  if(typeof input.text!=='string'||input.text.length>4000||(!input.text.trim()&&!input.image))fail();
  if(input.failure&&!['save','delivery','none'].includes(input.failure))fail();
  const snapshot=input.snapshot??{messages:[],profile:{facts:[],version:0},items:[],alerts:[],images:[]};
  if(JSON.stringify(snapshot).length>3500000||!Array.isArray(snapshot.messages)||snapshot.messages.length>100||
    snapshot.messages.some(m=>!m||typeof m.body!=='string'||m.body.length>10000||!['inbound','outbound'].includes(m.direction))||
    !Array.isArray(snapshot.profile?.facts)||snapshot.profile.facts.length>150||
    snapshot.profile.facts.some(f=>!f||typeof f.field!=='string'||typeof f.key!=='string'||typeof f.value!=='string')||
    !Array.isArray(snapshot.items)||snapshot.items.length>100||!Array.isArray(snapshot.alerts)||snapshot.alerts.length>100||
    !Array.isArray(snapshot.images)||snapshot.images.length>20||snapshot.images.some(i=>!i||!['image/jpeg','image/png','image/webp'].includes(i.mime_type)||typeof i.data!=='string'||i.data.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(i.data)))fail();
  let image=null;
  if(input.image){
    if(typeof input.image!=='string'||input.image.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))fail();
    const bytes=Buffer.from(input.image,'base64');
    if(bytes.length>1000000)fail();
    try{image={mime_type:imageType(bytes),data:input.image};}catch{fail();}
  }
  return {snapshot:structuredClone(snapshot),image};
}

// The production inbox orchestrator runs unchanged. Only persistence, transport
// and progress feedback are replaced; no production store or Photon client exists here.
export async function simulateTurn(input,env,dependencies={}){
  const {snapshot:s,image}=validateSimulation(input),events=[],replies=[];
  const id=randomUUID(),conversation='simulator',operation=`ai:${id}`;
  const now=()=>new Date().toISOString();
  const entry=op=>s.messages.find(m=>m.operation_id===op);
  const event=(type,detail={})=>events.push({type,...detail});
  const persist=async op=>{
    const reply=entry(op);
    if(reply.wishlist_saved)return;
    if(!reply.wishlist_payload?.length)return;
    if(input.failure==='save')throw Error('Injected simulator save failure');
    if(op===operation&&reply.search_result?.user_confirmed&&reply.search_result?.identification_policy!=='text_wishlist')throw Error('Invalid confirmed save');
    for(const p of reply.wishlist_payload??[]){
      const existing=s.items.find(i=>i.url===p.url),item_id=existing?.item_id??randomUUID();
      const item={...p,item_id,reply_id:reply.id,has_image:!!p.image,messages:{created_at:now()}};
      delete item.image;delete item.additional_images;
      if(existing)s.items[s.items.indexOf(existing)]=item;else s.items.push(item);
    }
    reply.wishlist_saved=true;event('wishlist_saved',{urls:(reply.wishlist_payload??[]).map(p=>p.url)});
  };
  const store={
    receive:async()=>{s.messages.push({id,provider_id:id,direction:'inbound',body:input.text,status:'received',created_at:now(),message_images:[]});return conversation;},
    claimAI:async(_c,op)=>{if(entry(op))return false;s.messages.push({id:randomUUID(),operation_id:op,direction:'outbound',body:'',status:'generating',source:'ai',created_at:now()});return true;},
    context:async()=>s.messages.filter(m=>m.direction==='inbound'||m.status==='sent').slice(-20),
    profile:async()=>s.profile,
    saveProfile:async(_c,version,facts)=>{if(version!==s.profile.version)return false;s.profile={facts,version:version+1};event('profile_updated',{facts});return true;},
    memoryStatus:async(_id,status)=>{event('memory',{status});},
    imageStatus:async(_id,status)=>{event('image',{status});},
    saveImages:async(provider,images)=>{const message=s.messages.find(m=>m.provider_id===provider);for(const [position,img] of images.entries()){const stored={...img,id:randomUUID(),message_id:message.id,position};s.images.push(stored);message.message_images.push({id:stored.id,position});}},
    imagesForMessage:async messageId=>s.images.filter(i=>i.message_id===messageId),
    image:async imageId=>s.images.find(i=>i.id===imageId),
    textWishlistState:async()=>stateFromSearch(s.messages.findLast(m=>m.direction==='outbound'&&m.status==='sent'&&m.search_result)?.search_result),
    searchResult:async(op,result)=>{entry(op).search_result=result;event('shopping_outcome',{result});},
    wishlistPayload:async(op,payload)=>{entry(op).wishlist_payload=payload;},
    wishlistHasItems:async()=>!!s.items.length,
    saveConfirmedWishlist:async op=>{if(entry(op)?.search_result?.user_confirmed!==true)throw Error('Missing consent');await persist(op);},
    saveWishlist:async op=>{if(entry(op)?.status!=='sent')throw Error('Not delivered');await persist(op);},
    wishlistReplyId:async op=>entry(op)?.id,
    wishlistEntries:async()=>s.items,
    enablePriceAlert:async args=>{const existing=s.alerts.find(a=>a.p_group===args.p_group);const alert={...args,active:true,id:existing?.id??randomUUID()};if(existing)s.alerts[s.alerts.indexOf(existing)]=alert;else s.alerts.push(alert);event('alert_enabled',{alert});return alert;},
    prepareAI:async(op,body,source)=>Object.assign(entry(op),{body,source,status:'sending'}),
    finish:async(op,status)=>{entry(op).status=status;event('delivery',{status});},
    reserve:async(_c,op,body,source)=>{if(entry(op))return false;s.messages.push({id:randomUUID(),operation_id:op,direction:'outbound',body,source,status:'sending',created_at:now()});return true;},
    operation:async op=>entry(op),
    saveFeedback:async()=>event('feedback_saved'),
  };
  const started=Date.now();
  const outcome=await receiveInInbox({space:{phone:'simulator'},message:{id,sender:{id:'simulator'},content:{text:input.text},attachments:image?[{id:'simulator-image'}]:[]}},
    {...env,SITE_ORIGIN:'',AI_ENABLED:'true'},
    {...dependencies,store,loadImages:async()=>image?[image]:[],progress:async()=>async()=>{},send:async(_delivery,body)=>{if(input.failure==='delivery')throw Error('Injected simulator delivery failure');replies.push(body);}});
  // Product photo bytes are presentation artifacts, not conversation evidence.
  for(const m of s.messages)if(m.wishlist_payload)m.wishlist_payload=m.wishlist_payload.map(({image,additional_images,...p})=>p);
  if(JSON.stringify(s).length>3500000){s.images=s.images.slice(-2);event('history_images_trimmed');}
  return {snapshot:s,replies,events,outcome,elapsed_ms:Date.now()-started,configuration:{conversation_model:env.OPENAI_MODEL||'gpt-4.1-mini',search_model:env.OPENAI_SEARCH_MODEL||'gpt-4.1'},simulated:['database','delivery','alert scheduling'],live:['conversation model','profile model','search','retailer checks']};
}
