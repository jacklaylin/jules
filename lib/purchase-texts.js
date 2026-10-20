import {timingSafeEqual} from 'node:crypto';
import {importStep} from './gmail-import.js';
import {refreshPlan,REFRESH_LIMIT} from './gmail-discovery.js';
import {sourcesActive} from './connected-sources.js';
import {loadReceipts} from './evidence.js';
import {receiptModel} from './receipt-extraction.js';
import {wardrobeView,itemName} from './wardrobe.js';
import {sendFitCheck,textedToday,PROACTIVE} from './fit-checks.js';
import {tagPurchaseHistory} from './item-tags.js';
import {tagWardrobePhotos} from './photo-tags.js';
import {ensureClosetSummary} from './closet-summary.js';
import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {withUsage} from './usage.js';
import {checkCaps,logCapReached} from './cost-caps.js';
import {recordJobRun} from './jobs.js';
import {json} from './http.js';
import {gmailLinked,gmailReconnectNeeded,markGmailReconnect} from './gmail-client.js';

// The daily purchase check (vercel.json cron, once a day around midday in the US). For everyone with
// Gmail connected it reads only mail since the last check, with the same reading rules as the import,
// so new purchases land in the purchase history and therefore the wardrobe (a view of that history).
// Then Jules sends at most one text a day about what was bought, with the angle chosen by the model.
// The check keeps its own job in data.refresh; data.job stays the person's last full import, so the
// account card, the import's texts and the restart sweep never see it.
const DAY=86400000,RECENT_MS=7*DAY,HOLD_MS=15*60000,LOOKBACK_MS=30*DAY;
const OWNER_BUDGET_MS=60000,RUN_BUDGET_MS=240000;
const active=status=>['listing','extracting','questions'].includes(status);
const today=now=>new Date(now).toISOString().slice(0,10);

export function newRefreshJob(data,now=Date.now()){
 // A day of overlap: Gmail's after: is by day in some time zones, and anything already read is skipped.
 const since=Date.parse(data.refresh?.checked_at??data.job?.completed_at??'')||now-RECENT_MS;
 const after=Math.floor((Math.max(since,now-LOOKBACK_MS)-DAY)/1000),before=Math.floor(now/1000)+DAY/1000;
 return {kind:'refresh',status:'listing',after,before,recent_after:after,limit:REFRESH_LIMIT,search_plan:refreshPlan(after,before),search_index:0,ids:[],processed:[],limited:false,started_at:new Date(now).toISOString()};
}

// One bounded step of the check under the row's lease. Returns what happened:
// 'more' (call again), 'ready' (finished now), 'done' (already checked today), 'skipped' or 'busy'.
export async function refreshStep(store,owner,env,{step=importStep,now=Date.now()}={}){
 const row=await store.claimGmailImport(owner);if(!row)return {status:'busy'};
 try{
  const data=structuredClone(row.data),refresh=data.refresh??={pending:[],announced:[]};
  // A full import or a connected source still reading owns the row; today's check waits for tomorrow.
  if(!gmailLinked(row)||active(data.job?.status)||sourcesActive(data)){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);return {status:'skipped',reason:!row.token_ciphertext?'not_connected':gmailReconnectNeeded(data)?'reconnect':'import_running'};}
  if(!refresh.job||refresh.job.status==='ready'){
   if(refresh.checked_on===today(now)){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);return {status:'done'};}
   refresh.job=newRefreshJob(data,now);
  }
  if(refresh.job.status==='questions'){
   // Questions belong to the full import; the check only records what is new.
   const job=refresh.job,receipts=await loadReceipts(store,owner,row),baseline=new Set(job.baseline_items??[]);
   const found=receipts.state.items.map(i=>i.id).filter(id=>!baseline.has(id)&&!refresh.announced.includes(id));
   refresh.pending=[...new Set([...refresh.pending,...found])];
   Object.assign(job,{status:'ready',completed_at:new Date(now).toISOString()});
   refresh.checked_at=new Date(Math.min(job.before*1000,now)).toISOString();refresh.checked_on=today(now);
   if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))throw Error('Refresh write conflict');
   return {status:'ready',emails:job.ids.length,found:found.length};
  }
  // importStep reads data.job; the check's job stands in for it during the step.
  const main=data.job;data.job=refresh.job;
  const next=await step({...row,data,receipts:await loadReceipts(store,owner,row),profile:async()=>(await store.profile(owner)).facts},env);
  const written=structuredClone(next.data);written.refresh={...refresh,...written.refresh,job:written.job};
  if(main===undefined)delete written.job;else written.job=main;
  delete written.refresh.job.error;delete written.refresh.failures;
  if(!await store.finishGmailImport(owner,row.revision,written,next.token_ciphertext,next.evidence??[]))throw Error('Refresh write conflict');
  return {status:'more'};
 }catch(error){
  // Completed steps are kept; the next run (or tomorrow's) continues the same check. A refused sign-in
  // stops the checks until Gmail is reconnected.
  const data=structuredClone(row.data);data.refresh={...data.refresh,failures:(data.refresh?.failures??0)+1};
  const reconnect=markGmailReconnect(data,error,'purchase_check')||Boolean(error?.reconnect);
  await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext).catch(()=>{});
  return {status:'failed',error:error.status??null,...(reconnect?{reason:'reconnect'}:{})};
 }
}

// What Jules may say about: new items that are the person's own (not gifts, returns, cancellations or
// duplicates), bought in the last week. Older finds join the wardrobe quietly.
export function textableItems(view,pending,now=Date.now()){
 return view.items.filter(i=>pending.includes(i.id)&&i.bought_at&&now-Date.parse(i.bought_at)<=RECENT_MS);
}

export const ANGLES=['styling','new_direction','pattern','just_added'];
// similar_owned_item_ids comes first so the model looks at what they already own before choosing an angle.
const PICK_SCHEMA={type:'object',additionalProperties:false,required:['lead_item_id','similar_owned_item_ids','send','angle','related_item_ids','hook'],properties:{
 lead_item_id:{type:'string'},similar_owned_item_ids:{type:'array',maxItems:12,items:{type:'string'}},
 send:{type:'boolean'},angle:{type:'string',enum:ANGLES},
 related_item_ids:{type:'array',maxItems:3,items:{type:'string'}},hook:{type:'string'}}};
const PICK_PROMPT=`You are Jules, a personal shopper. The person just bought NEW_ITEMS (found in their shopping emails and added to their wardrobe). WARDROBE is what they already own.
Choose the single most interesting thing to text them about, as structured data. One text covers every new item; pick a lead item.
First, similar_owned_item_ids: every WARDROBE item of the same kind as the lead item (the same type of garment, e.g. other cargo trousers for cargo trousers, other loafers for loafers), up to 12. Read the whole WARDROBE; empty only if there truly is none.
Angles:
- styling: offer ideas for wearing the lead item with things they already own; related_item_ids are up to 3 WARDROBE items that would go with it.
- new_direction: only when similar_owned_item_ids is empty: the lead item is a kind of thing they have never bought.
- pattern: the lead item continues something they already own (similar_owned_item_ids is not empty); related_item_ids are up to 3 of those similar items.
- just_added: nothing above stands out; just say it was added and that they can tell Jules if it was a gift or anything is off.
hook: for new_direction and pattern, one short casual line in lowercase about how the lead item relates to WARDROBE: what makes it new for them, or what it repeats. It must tell them something the item's name doesn't: never restate or describe the item itself (its name, color, fit or look). Never state a number, count or time span (no "fourth", "three", "since 2022"): say "another", "yet more", "the latest in a line of". A shared brand or store also works. A bracketed aside is welcome. The style of line, not words to reuse: "yet another pair of loafers (a uniform is forming)", "first knitwear in a closet of tees (are we entering a phase?)". Write your own line from this person's WARDROBE. If nothing specific and true can be said, choose styling or just_added. Otherwise hook is "". It may only mention the listed items. No prices, links, sizes, stock, shipping or store policies.
send: false only when the purchase is not worth a text at all (a restock of plain basics such as socks or underwear). Use only ids from the input.`;

// Checks the model's choice against the actual items; anything unsupported falls back to "just added".
export function validPick(pick,items,wardrobe){
 const ids=new Set(items.map(i=>i.id)),owned=new Set(wardrobe.map(i=>i.id));
 const lead=items.find(i=>i.id===pick?.lead_item_id)??items[0];
 const related=[...new Set(Array.isArray(pick?.related_item_ids)?pick.related_item_ids:[])].filter(id=>owned.has(id)&&!ids.has(id)).slice(0,3);
 const hook=typeof pick?.hook==='string'?pick.hook.trim():'';
 const hookOk=hook.length>0&&hook.length<=160&&!/https?:|www\.|[$€£¥]|\d/i.test(hook);
 let angle=ANGLES.includes(pick?.angle)?pick.angle:'just_added';
 if(angle==='styling'&&!related.length)angle='just_added';
 // "First of its kind" must not contradict what they own; "pattern" must name what it repeats.
 // Same wardrobe category as the lead item when both are tagged: a shirt is never "another" pair of trousers.
 const kind=new Map(wardrobe.map(i=>[i.id,i.category])),same=id=>!lead.category||!kind.get(id)||kind.get(id)===lead.category;
 const similar=(Array.isArray(pick?.similar_owned_item_ids)?pick.similar_owned_item_ids:[]).filter(id=>owned.has(id)&&!ids.has(id)&&same(id));
 if(['new_direction','pattern'].includes(angle)&&!hookOk||angle==='new_direction'&&similar.length||angle==='pattern'&&!similar.length)angle='just_added';
 return {send:pick?.send!==false,angle,lead,related:angle==='styling'?related:angle==='pattern'?(related.length?related:similar.slice(0,3)):[],hook:['new_direction','pattern'].includes(angle)?hook:''};
}

const describe=itemName;
const listOf=names=>names.length>1?names.slice(0,-1).join(', ')+' and '+names.at(-1):names[0];
// The factual draft; lib/compose.js writes the message in Jules's voice and checks it against this.
export function purchaseDraft(choice,items,wardrobe){
 const {lead}=choice,others=items.length-1,owned=new Map(wardrobe.map(i=>[i.id,i]));
 const base=`i saw your new ${describe(lead)}${lead.merchant?` from ${lead.merchant}`:''} in your email and added it to your wardrobe`+(others?`, plus ${others===1?'one other new purchase':`${others} other new purchases`}.`:'.');
 const related=listOf(choice.related.map(id=>describe(owned.get(id))));
 const next={
  styling:` want a couple of ideas for wearing it with your ${related}?`,
  new_direction:` ${choice.hook}`,
  pattern:` ${choice.hook}`,
  just_added:' tell me if it was a gift or if anything looks off.'
 }[choice.angle];
 return base+next;
}

// At most one purchase text a day, and none on a day a fit check went out. Pending items are marked announced before the text goes out, so a
// failure afterwards can miss a text but never repeat one.
export async function announcePurchases(store,owner,env,{interpret=request=>receiptModel(request,env),send=sendGreeting,now=Date.now()}={}){
 const operation=PROACTIVE.purchase(owner,today(now));
 if(await textedToday(store,owner,now))return {status:'already_sent_today'};
 const current=await store.gmailImport(owner),pending=current?.data?.refresh?.pending??[];
 if(!pending.length)return {status:'nothing_new'};
 const receipts=await loadReceipts(store,owner,current),view=wardrobeView(receipts.state,{tags:current.data.item_tags??{}});
 // Turned off in chat: purchases still join the wardrobe; they are settled without a text.
 const off=!purchaseTextsOn(current.data);
 const items=off?[]:textableItems(view,pending,now),wardrobe=view.items.filter(i=>!pending.includes(i.id));
 // Hold while they are mid-conversation; tomorrow's check includes these items.
 const last=(await store.recent?.(owner,1).catch(()=>[])??[]).at(-1);
 if(items.length&&last&&now-Date.parse(last.created_at)<HOLD_MS)return {status:'held',reason:'mid_conversation',items:items.length};
 let choice=null;
 if(items.length){
  const brief=i=>({id:i.id,brand:i.brand,product:i.product,color:i.color,category:i.category,merchant:i.merchant,bought:i.bought_at?.slice(0,10)??null});
  let pick=null;
  try{pick=await interpret({schema:PICK_SCHEMA,instructions:PICK_PROMPT,context:{NEW_ITEMS:items.map(brief),WARDROBE:wardrobe.slice(0,300).map(brief)}});}
  catch{console.log(JSON.stringify({event:'purchase_text_pick_failed'}));}
  choice=validPick(pick,items,wardrobe);
 }
 const row=await store.claimGmailImport(owner);if(!row)return {status:'busy'};
 const data=structuredClone(row.data),refresh=data.refresh??={pending:[],announced:[]};
 // Everything pending is settled now: told about, or too old to text about.
 refresh.announced=[...new Set([...refresh.announced??[],...refresh.pending??[]])].slice(-500);refresh.pending=[];
 if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))return {status:'busy'};
 if(off)return {status:'texts_off',items:pending.length};
 if(!items.length)return {status:'nothing_recent',items:pending.length};
 if(!choice.send)return {status:'not_worth_a_text',items:items.length};
 const result=await deliverReply({store,send,conversation:await store.conversation(owner),operation,body:purchaseDraft(choice,items,wardrobe),source:'operator',env,purpose:'new_purchase',
  // Recorded in the wardrobe, not saved to the wishlist: without this the composer's claim checks read
  // "added to your wardrobe" as a wishlist save and send the plain draft instead.
  facts:{wardrobe_added:items.map(describe)}});
 return {status:result.status,angle:choice.angle,items:items.length};
}

// Whether Jules may text this person on her own about purchases she finds (on unless they turned it
// off in chat). STOP still stops every text, through the message ledger.
export const purchaseTextsOn=data=>data?.purchase_texts?.enabled!==false;
export const PURCHASE_TEXTS_ACTIONS=['turn_off','turn_on','status'];
// Agent skill: the conversational agent chooses this tool from the meaning of the newest message.
export const PURCHASE_TEXTS_TOOL={type:'function',name:'manage_purchase_texts',strict:true,
 description:'Turn off, turn back on, or check the texts Jules sends on her own about purchases she finds in the user\'s email (a text about a new purchase, and follow-ups about it such as asking how it fits). Use when the newest message asks to stop, pause, resume or asks about those texts. turn_on only when the user asks for them back. It does not change replies, price alerts or the wardrobe: purchases keep being added to the wardrobe either way.',
 parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:PURCHASE_TEXTS_ACTIONS}}}};
export const PURCHASE_TEXTS_GUIDE='\nPURCHASE TEXTS: Jules texts the user on her own, at most once a day, when she finds a new purchase in their email. When the newest message asks to stop, restart or asks about those texts, call manage_purchase_texts; never say they changed without it. Texting STOP stops every text from Jules, not just these.';

// Factual drafts; the agent writes the reply in Jules's voice.
function purchaseTextsReply(action,{on,changed,connected}){
 const gmail=connected?'':' your Gmail isn\'t connected right now, so there\'s nothing for me to read until you reconnect it on your account page.';
 if(action==='turn_off')return (changed?'done: no more texts from me about purchases i find in your email.':'texts about purchases from your email are already off.')+' new purchases still go into your wardrobe, and you can ask me to turn these texts back on anytime.';
 if(action==='turn_on')return (changed?'done: i\'ll text you again when i spot a new purchase in your email, at most once a day.':'texts about new purchases from your email are already on, at most one a day.')+gmail;
 return (on?'texts about new purchases from your email are on: at most one a day, when i spot something new.':'texts about new purchases from your email are off. you can ask me to turn them back on anytime.')+gmail;
}
// record(state) receives what this turn did ('turned_off', 'turned_on' or 'unchanged') for the reply checks.
export async function managePurchaseTexts(store,owner,action,{messageId=null,now=Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms)),record=()=>{}}={}){
 if(!PURCHASE_TEXTS_ACTIONS.includes(action))throw Error('Invalid purchase texts action');
 if(!await store.gmailImport(owner))return 'i don\'t read your email, so i don\'t send texts about your purchases.';
 // The row is briefly leased while an import or the daily check writes; wait for it rather than fail.
 for(let attempt=0;attempt<4;attempt++){
  const row=await store.claimGmailImport(owner);
  if(!row){await wait(2000);continue;}
  const on=purchaseTextsOn(row.data),connected=gmailLinked(row),enabled=action==='turn_on';
  if(action==='status'||on===enabled){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);
   console.log(JSON.stringify({event:'purchase_texts_setting',action,changed:false,on}));
   record('unchanged');
   return purchaseTextsReply(action,{on,changed:false,connected});
  }
  const data={...structuredClone(row.data),purchase_texts:{enabled,changed_at:new Date(now).toISOString(),message_id:messageId}};
  if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))break;
  console.log(JSON.stringify({event:'purchase_texts_setting',action,changed:true,on:enabled}));
  record(enabled?'turned_on':'turned_off');
  return purchaseTextsReply(action,{on:enabled,changed:true,connected});
 }
 console.log(JSON.stringify({event:'purchase_texts_setting',action,changed:false,busy:true}));
 return 'i couldn\'t change that setting just now because i\'m in the middle of updating your purchase history. ask me again in a minute.';
}

// One person's daily check: read new mail, tag new items so the wardrobe can file them, then text. A new
// purchase comes first; the fit check (lib/fit-checks.js) takes the day only when no purchase text went out.
export async function refreshOwner(store,owner,env,{step,announce=announcePurchases,fitCheck=sendFitCheck,tag=tagPurchaseHistory,photoTag=tagWardrobePhotos,closet=ensureClosetSummary,deadline=Date.now()+OWNER_BUDGET_MS,now=Date.now}={}){
 let result,steps=0;
 do{result=await refreshStep(store,owner,env,{step,now:now()});steps++;}while(result.status==='more'&&now()<deadline);
 if(result.found&&env.OPENAI_API_KEY)await tag(store,owner,env,{budgetMs:20000}).catch(()=>{});
 // New order photos, and searched photos the owner confirmed since yesterday, are read (lib/photo-tags.js).
 if(env.OPENAI_API_KEY)await photoTag(store,owner,env,{budgetMs:20000}).catch(()=>{});
 await closet(store,owner).catch(()=>{});
 const checked=['ready','done'].includes(result.status);
 const text=checked?await announce(store,owner,env).catch(()=>({status:'failed'})):{status:'not_checked'};
 // The fit check needs no new mail, but waits for a finished check so delivery notices are read first.
 const fit=checked&&text.status!=='sent'?await fitCheck(store,owner,env).catch(()=>({status:'failed'})):{status:'not_checked'};
 console.log(JSON.stringify({event:'gmail_refresh',status:result.status,reason:result.reason??null,steps,emails:result.emails??null,found:result.found??null,text:text.status,angle:text.angle??null,text_items:text.items??null,fit_check:fit.status}));
 return {check:result.status,...(result.reason?{reason:result.reason}:{}),text:text.status,fit_check:fit.status};
}

export async function runDailyRefresh(store,env,{owner=refreshOwner,now=Date.now}={}){
 const deadline=now()+RUN_BUDGET_MS,owners=await store.gmailConnections(),summary={people:owners.length,checked:0,texted:0,fit_checks:0,unfinished:0,failed:0};
 for(const id of owners){
  if(now()>=deadline){summary.unfinished++;continue;}
  // Over a spending cap (lib/cost-caps.js): skipped today; tomorrow's run checks again.
  const cap=await checkCaps(store,id,env);
  if(cap.capped){summary.capped=(summary.capped??0)+1;logCapReached(cap,'purchase_check');continue;}
  try{
   const result=await withUsage({store,env,conversation:id,operation:`gmail-refresh:${id}:${today(now())}`,feature:'gmail_refresh',job:'purchase_check'},()=>owner(store,id,env,{deadline:Math.min(deadline,now()+OWNER_BUDGET_MS)}));
   // A check that failed, or a Gmail sign-in Google refused, counts so the run's record shows it.
   if(['ready','done'].includes(result.check))summary.checked++;else if(result.check==='more')summary.unfinished++;
   else if(result.reason==='reconnect')summary.reconnect=(summary.reconnect??0)+1;else if(result.check==='failed')summary.failed++;
   if(result.text==='sent'||result.fit_check==='sent')summary.texted++;
   if(result.fit_check==='sent')summary.fit_checks++;
  }catch{summary.failed++;console.log(JSON.stringify({event:'gmail_refresh_failed'}));}
 }
 console.log(JSON.stringify({event:'gmail_refresh_run',...summary}));
 return summary;
}

// Vercel's daily cron calls this with CRON_SECRET (the same secret as the price checks).
export async function handleGmailRefresh(req,res,store,env,run=runDailyRefresh){
 const expected=env.CRON_SECRET&&Buffer.from(`Bearer ${env.CRON_SECRET}`),received=Buffer.from(req.headers.authorization??'');
 if(!expected||received.length!==expected.length||!timingSafeEqual(received,expected))return json(res,401,{error:'Unauthorized.'});
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
 const started=Date.now();
 if(env.GMAIL_IMPORT_ENABLED!=='true'||env.PURCHASE_TEXTS_ENABLED!=='true'){await recordJobRun(store,'purchase_check',started,'skipped',{reason:'disabled'});return json(res,503,{error:'Daily purchase check is not enabled.'});}
 try{const summary=await run(store,env);await recordJobRun(store,'purchase_check',started,summary.failed?'failed':'ok',summary);return json(res,200,summary);}
 catch{console.log(JSON.stringify({event:'gmail_refresh_run_failed'}));await recordJobRun(store,'purchase_check',started,'failed');return json(res,503,{error:'Daily purchase check failed.'});}
}
