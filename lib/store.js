import {randomUUID} from 'node:crypto';
import {uuid} from './http.js';
import {uniqueAlertLinks} from './alert-links.js';
import { stateFromSearch } from './shopping-context.js';
import { boundedSearchResult, jsonbBytes } from './search-result-budget.js';
import { replyProviderId, sentMessageId } from './message-context.js';
import { reactionTargetId, REACTION_NOTE, CONTINUATION_NOTE } from './developer-feedback.js';
import {purchaseHistory} from './evidence.js';
import {CONNECTED_SOURCES} from './connected-sources.js';
const HISTORY_SOURCE_NAMES=Object.keys(CONNECTED_SOURCES);
export const SIGN_IN_LINK_HOURS=24;
export function createStore(env, fetcher = fetch) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('replace-with')) throw new Error('Database not configured');
  async function request(path, { method = 'GET', body, prefer } = {}, attempt = 0) {
    const response = await fetcher(`${url}/rest/v1/${path}`, {
      method, headers: { apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      // The table or function name only (never ids or filters), so a failure says which read it was.
      const error=new Error('Database request failed');error.database_status=response.status;error.database_table=path.split(/[?/]/)[0].slice(0,60)+(path.startsWith('rpc/')?'/'+path.split(/[?/]/)[1]:'');
      try{const failure=await response.json();if(/^[A-Z0-9]{5,12}$/.test(failure.code??''))error.database_code=failure.code;}catch{}
      // A read cancelled by the statement timeout (57014) usually succeeds once the database has
      // warmed up (October 20: the first message after two quiet hours timed out loading context).
      // Reads only: a write may have partly applied, so it is never repeated.
      if(error.database_code==='57014'&&method==='GET'&&attempt===0){console.log(JSON.stringify({event:'database_read_retried',table:error.database_table}));return request(path,{method,body,prefer},1);}
      throw error;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const eq = value => encodeURIComponent(value);
  // Reads every page of a list (PostgREST returns at most 1,000 rows per request), up to 20,000 rows.
  async function paged(path) {
    const rows = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const page = await request(`${path}&limit=1000&offset=${offset}`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }
  return {
    async phoneLoginMember(phone) {
      const rows=await request(`conversations?sender_id=eq.${eq(phone)}&select=id,line,sms_opted_out_at,wishlist_members!inner(email)&limit=2`);
      if(rows.length!==1||rows[0].wishlist_members.length!==1)return null;
      return {email:rows[0].wishlist_members[0].email,line:rows[0].line,opted_out:Boolean(rows[0].sms_opted_out_at)};
    },
    beginPhoneLogin:(id,phone,connection,email)=>request('rpc/begin_phone_login',{method:'POST',body:{p_id:id,p_phone:phone,p_connection:connection,p_email:email}}),
    attemptPhoneLogin:id=>request('rpc/attempt_phone_login',{method:'POST',body:{p_id:id}}),
    completePhoneLogin:id=>request(`login_challenges?id=eq.${eq(id)}`,{method:'PATCH',body:{used:true}}),
    // Self-serve accounts (lib/accounts.js). The member email for a conversation (one, or null), adding
    // one, and the onboarding invite; adds leave an existing row as it is.
    async memberEmail(conversation){
      const rows=await request(`wishlist_members?conversation_id=eq.${eq(conversation)}&select=email&limit=2`);
      return rows.length===1?rows[0].email:null;
    },
    addMember:(email,conversation)=>request('wishlist_members',{method:'POST',body:{email,conversation_id:conversation},prefer:'resolution=ignore-duplicates,return=minimal'}),
    inviteOnboarding:conversation=>request('onboarding_sessions',{method:'POST',body:{conversation_id:conversation},prefer:'resolution=ignore-duplicates,return=minimal'}),
    // One-tap sign-in links texted by Jules reuse login_challenges. The phone column holds
    // 'link:<conversation>' so code requests neither count them toward limits nor cancel them.
    async createSignInLink(conversation){
      const rows=await request(`wishlist_members?conversation_id=eq.${eq(conversation)}&select=email&limit=2`);
      if(rows.length!==1)return null;
      const id=randomUUID();
      await request('login_challenges',{method:'POST',body:{id,phone:'link:'+conversation,connection_hash:'sign-in-link',email:rows[0].email}});
      return id;
    },
    // The conversation a sign-in link was made for, used or not, and how many links it got in the last hour.
    async signInLinkOwner(id){
      const row=(await request(`login_challenges?id=eq.${eq(id)}&phone=like.link:*&select=phone&limit=1`))[0];
      if(!row)return null;
      const conversation=row.phone.slice(5),since=new Date(Date.now()-3600e3).toISOString();
      const recent=await request(`login_challenges?phone=eq.${eq(row.phone)}&created_at=gt.${eq(since)}&select=id`);
      return {conversation,recent:recent.length};
    },
    // First name from this number's latest signup, for the onboarding greeting.
    async signupFirstName(conversation){
      const phone=(await request(`conversations?id=eq.${eq(conversation)}&select=sender_id&limit=1`))[0]?.sender_id;
      if(!phone)return null;
      const name=(await request(`public_signups?phone_number=eq.${eq(phone)}&select=profile&order=consent_at.desc&limit=1`))[0]?.profile?.first_name;
      return typeof name==='string'&&name.trim()?name.trim():null;
    },
    // Consumes the link atomically; returns its email once, within SIGN_IN_LINK_HOURS.
    async useSignInLink(id){
      const since=new Date(Date.now()-SIGN_IN_LINK_HOURS*3600e3).toISOString();
      const rows=await request(`login_challenges?id=eq.${eq(id)}&used=is.false&phone=like.link:*&created_at=gt.${eq(since)}`,{method:'PATCH',body:{used:true},prefer:'return=representation'});
      return rows?.[0]?.email??null;
    },
    async gmailImport(conversation) {return (await request(`gmail_imports?conversation_id=eq.${eq(conversation)}&select=*&limit=1`))[0]??null;},
    // Conversations whose connected Gmail (a token is held) is this lowercase address.
    gmailAccountOwners:async email=>(await request(`gmail_imports?data->>account=eq.${eq(email)}&token_ciphertext=not.is.null&select=conversation_id&limit=5`)).map(r=>r.conversation_id),
    // The style report behind a share link (lib/style-report.js). Only the report and its owner's id, never the Gmail token.
    // Every person's style report copy log and votes, for the jokes learning loop (lib/report-copy.js). Never the Gmail token or history.
    reportCopyRows:()=>request(`gmail_imports?select=conversation_id,copy:data->style_report->copy_log,feedback:data->style_report->feedback&limit=500`),
    async reportByShareToken(token) {return (await request(`gmail_imports?data->style_report->share->>token=eq.${eq(token)}&select=conversation_id,report:data->style_report&limit=1`))[0]??null;},
    // Running imports that have not written since `before` (the sweep decides which to restart).
    gmailProfilesDue:async()=>(await request('rpc/gmail_profiles_due',{method:'POST',body:{}})).map(r=>r.conversation_id??r),
    gmailSweepSecret:async()=>request('rpc/gmail_sweep_secret',{method:'POST',body:{}}),
    // Everyone with Gmail still connected (lib/purchase-texts.js daily check).
    gmailConnections:async()=>(await request('gmail_imports?token_ciphertext=not.is.null&select=conversation_id&limit=200')).map(r=>r.conversation_id),
    // Running Gmail imports and connected sources still reading or awaiting approval (lib/gmail-worker.js sweep).
    quietGmailImports:before=>request(`gmail_imports?select=conversation_id,updated_at,lease_until,job:data->job,connections:data->connections&or=(data->job->>status.in.(listing,extracting,questions),${HISTORY_SOURCE_NAMES.map(n=>`data->connections->${n}->>status.in.(awaiting_approval,extracting)`).join(',')})&updated_at=lt.${eq(before)}&limit=50`),
    // Receipt-derived shopping history is a view over evidence, never stored as a belief.
    purchaseHistory(conversation) {return purchaseHistory(this,conversation);},
    // exclude: an evidence kind left out (purchase history skips stored order photos, which are large).
    async evidence(conversation,origin=null,{exclude=null}={}) {
      const rows=[];
      for(let offset=0;;offset+=1000){
        const page=await request(`evidence?conversation_id=eq.${eq(conversation)}${origin?`&origin=${Array.isArray(origin)?`in.(${origin.map(eq).join(',')})`:`eq.${eq(origin)}`}`:''}${exclude?`&kind=neq.${eq(exclude)}`:''}&select=id,kind,origin,source,data,recorded_by,created_at&order=seq.asc&limit=1000&offset=${offset}`);
        rows.push(...page);if(page.length<1000)return rows;
      }
    },
    // Order photos stored with purchase history (lib/order-photos.js): which items have one, and one photo.
    purchasePhotos:conversation=>request(`evidence?conversation_id=eq.${eq(conversation)}&kind=eq.photo_observation&id=like.order_photo:*&select=item_id:data->>item_id,photo_source:data->>photo_source,width:data->>width,height:data->>height,version:created_at&limit=2000`),
    async purchasePhoto(conversation,item) {
      const rows=await request(`evidence?conversation_id=eq.${eq(conversation)}&id=eq.${eq('order_photo:'+item)}&kind=eq.photo_observation&select=mime_type:data->>mime_type,data:data->>data&limit=1`);
      return rows[0]??null;
    },
    // Suggested wardrobe photos (lib/wardrobe-photos.js): every suggestion, empty search and answer, oldest
    // first, without the photo bytes; and one suggestion's photo.
    wardrobePhotoEvidence:conversation=>request(`evidence?conversation_id=eq.${eq(conversation)}&origin=eq.wardrobe&select=id,created_at,item_id:data->>item_id,result:data->>result,checks:data->>checks,asset_url:data->>asset_url,title:data->>title,seller:data->>seller,suggestion_id:data->>suggestion_id,decision:data->>decision&order=seq&limit=5000`),
    async wardrobeSuggestionPhoto(conversation,id) {
      const rows=await request(`evidence?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&origin=eq.wardrobe&kind=eq.photo_observation&select=mime_type:data->>mime_type,data:data->>data&limit=1`);
      return rows[0]??null;
    },
    recordUsage:rows=>request('usage_events',{method:'POST',body:rows,prefer:'return=minimal'}),
    async usageByUser(since) {return request(`usage_by_user_day?day=gte.${eq(since)}&select=conversation_id,day,feature,action,calls,web_search_calls,cost_usd&order=day.desc&limit=1000`);},
    recordEvidence:(conversation,rows)=>request('rpc/insert_evidence',{method:'POST',body:{p_conversation:conversation,p_rows:rows}}),
    deleteEvidence:(conversation,origin,source=null)=>request('rpc/delete_evidence',{method:'POST',body:{p_conversation:conversation,p_origin:origin,p_source_id:source}}),
    beginGmailOAuth:(conversation,hash)=>request('rpc/begin_gmail_oauth',{method:'POST',body:{p_conversation:conversation,p_hash:hash}}),
    consumeGmailOAuth:hash=>request('rpc/consume_gmail_oauth',{method:'POST',body:{p_hash:hash}}),
    ensureGmailImport: conversation => request('rpc/ensure_gmail_import',{method:'POST',body:{p_conversation:conversation}}),
    async claimGmailImport(conversation) {return (await request('rpc/claim_gmail_import',{method:'POST',body:{p_conversation:conversation}}))[0]??null;},
    finishGmailImport:(conversation,revision,data,token,evidence=[],clear=false)=>request('rpc/finish_gmail_import',{method:'POST',body:{p_conversation:conversation,p_revision:revision,p_data:data,p_token:token,p_evidence:evidence,p_clear:clear}}),
    // The one conversation for this number; none, or more than one (several lines), is null.
    async conversationForPhone(phone) {
      const rows=await request(`conversations?sender_id=eq.${eq(phone)}&select=id&limit=2`);
      return rows.length===1?rows[0].id:null;
    },
    // Admin › People › New signups (lib/new-signups.js): the latest signup per number that has no conversation yet.
    async signupsWithoutConversation() {
      const latest=new Map();
      for(const row of await paged('public_signups?select=request_id,phone_number,profile,consent_at&order=consent_at.desc'))if(!latest.has(row.phone_number))latest.set(row.phone_number,row);
      if(!latest.size)return [];
      const phones=[...latest.keys()],known=new Set();
      for(let i=0;i<phones.length;i+=100)for(const c of await request(`conversations?sender_id=in.(${phones.slice(i,i+100).map(p=>`"${eq(p)}"`).join(',')})&select=sender_id`))known.add(c.sender_id);
      return [...latest.values()].filter(row=>!known.has(row.phone_number));
    },
    async onboardingInvite(phone) {
      const rows=await request(`conversations?sender_id=eq.${eq(phone)}&select=id,sender_id,line,onboarding_sessions!inner(state)&limit=2`);
      return rows.length===1?rows[0]:null;
    },
    async onboardingSession(conversation) {
      return (await request(`onboarding_sessions?conversation_id=eq.${eq(conversation)}&select=state,updated_at&limit=1`))[0]??null;
    },
    // Onboarding reminder (db/046): who is due, the "Not now" tap (state unchanged), and both for Admin.
    onboardingRemindersDue:()=>request('rpc/onboarding_reminders_due',{method:'POST',body:{}}),
    async recordOnboardingNotNow(conversation) {
      const rows=await request(`onboarding_sessions?conversation_id=eq.${eq(conversation)}&state=in.(offered,accepted)&select=conversation_id`,{method:'PATCH',body:{not_now_at:new Date().toISOString()},prefer:'return=representation'});
      return rows.length>0;
    },
    async onboardingOverview(conversation) {
      const [row]=await request(`onboarding_sessions?conversation_id=eq.${eq(conversation)}&select=state,not_now_at&limit=1`);
      if(!row)return null;
      const [reminder]=await request(`messages?operation_id=eq.${eq(`onboarding:${conversation}:reminder`)}&select=status,created_at&limit=1`);
      return {state:row.state,not_now_at:row.not_now_at,reminder:reminder?{status:reminder.status,at:reminder.created_at}:null};
    },
    advanceOnboarding: (conversation,from,to)=>request('rpc/advance_onboarding',{method:'POST',body:{p_conversation:conversation,p_from:from,p_to:to}}),
    // Owner re-test: only this conversation's onboarding texts leave the ledger (each is sent once per
    // operation ID), then the session returns to invited so the next signup sends the welcome again.
    async resetOnboarding(conversation) {
      const removed=await request(`messages?conversation_id=eq.${eq(conversation)}&operation_id=like.${eq(`onboarding:${conversation}:`)}*&select=id`,{method:'DELETE',prefer:'return=representation'});
      await request(`onboarding_sessions?conversation_id=eq.${eq(conversation)}`,{method:'PATCH',body:{state:'invited',updated_at:new Date().toISOString()},prefer:'return=minimal'});
      return {texts_removed:removed?.length??0};
    },
    signup: input => request('rpc/record_public_signup', {method:'POST',body:input}),
    // The first source recorded for a signup is kept (db/033).
    signupRef: (requestId,ref) => request(`public_signups?request_id=eq.${eq(requestId)}&ref=is.null`,{method:'PATCH',body:{ref},prefer:'return=minimal'}),
    signupArrival: (requestId,arrival) => request(`public_signups?request_id=eq.${eq(requestId)}`,{method:'PATCH',body:arrival,prefer:'return=minimal'}),
    // Each number's first signup that recorded how it arrived (db/041), for Admin › People.
    async signupArrivals(){
      const rows=await request('public_signups?or=(referrer_host.not.is.null,utm_source.not.is.null)&select=phone_number,referrer_host,utm_source,utm_medium,utm_campaign&order=consent_at.asc');
      const first=new Map();for(const row of rows)if(!first.has(row.phone_number))first.set(row.phone_number,{referrer_host:row.referrer_host,utm_source:row.utm_source,utm_medium:row.utm_medium,utm_campaign:row.utm_campaign});
      return first;
    },
    // Each number's first signup with a source, for Admin › People.
    async signupSources(){
      const rows=await request('public_signups?ref=not.is.null&select=phone_number,ref&order=consent_at.asc');
      const first=new Map();for(const row of rows)if(!first.has(row.phone_number))first.set(row.phone_number,row.ref);
      return first;
    },
    async textWishlistState(conversation) {
      const rows=await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&status=eq.sent&search_result=not.is.null&select=search_result,created_at&order=created_at.desc,id.desc&limit=1`);
      const row=rows[0];
      return row && Date.now()-Date.parse(row.created_at)<7*86400000 ? stateFromSearch(row.search_result) : null;
    },
    async wishlistReplyId(operation, {confirmed=false}={}) {
      const scope=confirmed?"&source=eq.ai&status=in.(generating,sending,sent)&search_result->>user_confirmed=eq.true":"&status=eq.sent";
      return (await request(`messages?operation_id=eq.${eq(operation)}${scope}&select=id&limit=1`))[0]?.id;
    },
    // Taste interview progress (db/040, lib/interview.js). Writes are compare-and-set on revision.
    async interview(conversation) {
      return (await request(`taste_interviews?conversation_id=eq.${eq(conversation)}&select=revision,state&limit=1`))[0] ?? {revision:0,state:{}};
    },
    async writeInterview(conversation,revision,state) {
      const rows=revision===0
        ?await request('taste_interviews?on_conflict=conversation_id',{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{conversation_id:conversation,revision:1,state}})
        :await request(`taste_interviews?conversation_id=eq.${eq(conversation)}&revision=eq.${eq(revision)}`,{method:'PATCH',prefer:'return=representation',body:{revision:revision+1,state,updated_at:new Date().toISOString()}});
      return Array.isArray(rows)&&rows.length>0;
    },
    async styleSession(conversation) {
      return (await request(`style_sessions?conversation_id=eq.${eq(conversation)}&select=revision,data&limit=1`))[0]
        ?? {revision:0,data:{notes:'',tone:'balanced',report:null}};
    },
    async styleSources(conversation,bytes=false) {
      const sources=[],pageSize=bytes?5:100;
      for(let offset=0;;offset+=pageSize){
        const page=await request(`style_sources?conversation_id=eq.${eq(conversation)}&select=id,kind,occasion,note,mime_type,created_at${bytes?',data':''}&order=created_at.asc,id.asc&limit=${pageSize}&offset=${offset}`);
        sources.push(...page);if(page.length<pageSize)return sources;
      }
    },
    async styleSource(conversation,id) {
      return (await request(`style_sources?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&select=id,kind,occasion,note,mime_type,data&limit=1`))[0]??null;
    },
    writeStyle: (conversation,revision,data,{source=null,remove=null,clear=false,evidence=null,facts=null}={}) => request('rpc/write_style',{method:'POST',body:{p_conversation:conversation,p_revision:revision,p_data:data,p_source:source,p_remove:remove,p_clear:clear,p_evidence:evidence,p_facts:facts}}),
    deleteStyle: (conversation,revision) => request('rpc/delete_style',{method:'POST',body:{p_conversation:conversation,p_revision:revision}}),
    pendingPriceAlerts: conversation => request(`price_alerts?conversation_id=eq.${eq(conversation)}&active=eq.true&baselines=eq.[]&select=id,revision,group_id,size,links,last_checked_at&order=last_checked_at.asc.nullsfirst&limit=2`),
    priceAlerts: conversation => request(`price_alerts?conversation_id=eq.${eq(conversation)}&select=id,group_id,name,size,active,last_checked_at,notified,baselines,links,last_result,low_stock_alerts`),
    enablePriceAlert: input => request('rpc/enable_price_alert',{method:'POST',body:{...input,p_links:uniqueAlertLinks(input.p_links??[])}}),
    setPriceAlertLinks: (id,links) => request(`price_alerts?id=eq.${eq(id)}&active=eq.true`,{method:'PATCH',body:{links}}),
    disablePriceAlert: (conversation,group) => request(`price_alerts?conversation_id=eq.${eq(conversation)}&group_id=eq.${eq(group)}`,{method:'PATCH',body:{active:false}}),
    // Only the low-stock texts on this item's alert; price and restock texts stay as they are.
    setLowStockAlerts: (conversation,group,on) => request(`price_alerts?conversation_id=eq.${eq(conversation)}&group_id=eq.${eq(group)}`,{method:'PATCH',body:{low_stock_alerts:on===true}}),
    claimPriceAlerts: () => request('rpc/claim_price_alerts',{method:'POST',body:{}}),
    async priceAlert(id) {return (await request(`price_alerts?id=eq.${eq(id)}&select=*&limit=1`))[0]??null;},
    async priceAlertCurrent(id,revision) {return (await request(`price_alerts?id=eq.${eq(id)}&revision=eq.${eq(revision)}&active=eq.true&select=id&limit=1`)).length>0;},
    recordPriceCheck: (id,revision,result,notified,baselines,links) => request(`price_alerts?id=eq.${eq(id)}&revision=eq.${eq(revision)}`,{method:'PATCH',body:{last_checked_at:new Date().toISOString(),last_result:result,...(notified?{notified:true}:{}),...(baselines?{baselines}:{}),...(links?{links}:{})}}),
    async reserveIdentificationTest(conversation,key,query,hash) {
      const rows=await request('messages?on_conflict=provider_id',{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{
        conversation_id:conversation,provider_id:key,direction:'inbound',body:'Identification test import (no iMessage sent): '+query,status:'received',source:'operator',search_result:{test_status:'running',test_hash:hash}
      }});
      const record=rows?.[0]??(await request(`messages?provider_id=eq.${eq(key)}&select=id,conversation_id,search_result,wishlist_payload&limit=1`))[0];
      if(!record)throw new Error('Test reservation failed');
      return {created:Boolean(rows?.length),record};
    },
    finishIdentificationTest: (id,result)=>request(`messages?id=eq.${eq(id)}`,{method:'PATCH',body:{search_result:result}}),
    identificationTestImages: id=>request(`message_images?message_id=eq.${eq(id)}&select=id,position&order=position.asc`),
    identificationTestPayload: (id,payload)=>request(`messages?id=eq.${eq(id)}`,{method:'PATCH',body:{wishlist_payload:payload}}),
    async importIdentificationTest(conversation,message,payload,at) {
      for(const product of payload) {
        const rows=await request('wishlist_items?on_conflict=conversation_id,product_url',{method:'POST',prefer:'resolution=merge-duplicates,return=representation',body:{conversation_id:conversation,product_url:product.url,product,saved_at:at}});
        await request('wishlist_encounters?on_conflict=item_id,reply_id',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{item_id:rows[0].id,reply_id:message,source_image_id:product.source_image_id,product}});
      }
    },
    async wishlistRevoked(hash) { return (await request(`wishlist_revoked_sessions?token_hash=eq.${eq(hash)}&select=token_hash&limit=1`)).length > 0; },
    wishlistRevoke: hash => request('wishlist_revoked_sessions?on_conflict=token_hash', {method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{token_hash:hash}}),
    async wishlistHasItems(conversation) { return (await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&select=id&limit=1`)).length > 0; },
    async wishlistMember(email) {
      const rows = await request(`wishlist_members?email=eq.${eq(email)}&select=conversation_id&limit=1`);
      return rows[0] ?? null;
    },
    wishlistPayload: (operation, payload) => request(`messages?operation_id=eq.${eq(operation)}`, { method:'PATCH', body:{wishlist_payload:payload} }),
    saveWishlist: operation => request('rpc/save_wishlist_reply', {method:'POST',body:{p_operation:operation}}),
    saveConfirmedWishlist: operation => request('rpc/save_confirmed_wishlist_reply', {method:'POST',body:{p_operation:operation}}),
    wishlistPending: () => request('messages?status=eq.sent&source=eq.ai&wishlist_saved=eq.false&wishlist_payload=not.is.null&select=operation_id&limit=100'),
    wishlistEntries: (conversation,{includeRemoved=false}={}) => request(`wishlist_entry_metadata?conversation_id=eq.${eq(conversation)}&select=reply_id,item_id,source_image_id,metadata,has_image,reply_at,source_at&limit=1000`).then(rows=>rows.map(({metadata,reply_at,source_at,...row})=>metadata?{...metadata,...row,removed:metadata.wishlist_removed,bought:metadata.wishlist_bought??null,messages:{created_at:reply_at},message_images:source_at?{messages:{created_at:source_at}}:null}:row)).then(rows=>includeRemoved?rows:rows.filter(row=>row.removed!=='true'&&row.removed!==true)),
    setWishlistRemoved(conversation,entries,removed) {return this.updateWishlistEntries(conversation,entries,{wishlist_removed:removed});},
    // Marks on the person's own encounters (removed, bought). Read through owned items before updating
    // their individual encounters; snapshots and conversation history stay, so every mark can be undone.
    async updateWishlistEntries(conversation,entries,changes) {
      for(const entry of entries){
        const item=await this.wishlistItem(conversation,entry.item_id);
        const encounter=item?.wishlist_encounters?.find(row=>row.reply_id===entry.reply_id);
        if(!encounter)throw new Error('Item not found');
        await request(`wishlist_encounters?item_id=eq.${eq(entry.item_id)}&reply_id=eq.${eq(entry.reply_id)}`,{method:'PATCH',body:{product:{...encounter.product,...changes}}});
      }
    },
    async wishlistPhoto(conversation,id,index=null) {
      const rows = await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&select=image:product->image,additional_images:product->additional_images&limit=1`);
      return index===null?rows[0]?.image??null:rows[0]?.additional_images?.[index]??null;
    },
    async saveWishlistPhotos(conversation,id,update) {
      const item=await this.wishlistItem(conversation,id);
      if(!item)throw new Error('Item not found');
      const fields=Object.fromEntries(['image','image_kind','additional_images','photo_count','photo_status','photo_attempts','details_attempts','photo_attempted_at','photo_attempted_revision'].filter(k=>k in update).map(k=>[k,update[k]]));
      await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}`,{method:'PATCH',body:{product:{...item.product,...fields}}});
      for(const encounter of item.wishlist_encounters??[])await request(`wishlist_encounters?item_id=eq.${eq(id)}&reply_id=eq.${eq(encounter.reply_id)}`,{method:'PATCH',body:{product:{...encounter.product,...fields}}});
    },
    async correctWishlistProduct(conversation,id,update) {
      const item=await this.wishlistItem(conversation,id);
      if(!item)throw new Error('Item not found');
      const revised=product=>({...product,...update,superseded_links:[...(product.superseded_links??[]),...(product.links??[])]});
      await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}`,{method:'PATCH',body:{product:revised(item.product)}});
      for(const encounter of item.wishlist_encounters??[])await request(`wishlist_encounters?item_id=eq.${eq(id)}&reply_id=eq.${eq(encounter.reply_id)}`,{method:'PATCH',body:{product:revised(encounter.product)}});
    },
    // The items one save created or refreshed (a reply's saved payload), for the better-price scan.
    async savedWishlistItems(operation) {
      const reply=(await request(`messages?operation_id=eq.${eq(operation)}&wishlist_saved=eq.true&select=conversation_id,wishlist_payload&limit=1`))[0];
      const items=[];
      for(const url of [...new Set((reply?.wishlist_payload??[]).map(p=>p?.url).filter(Boolean))])
        items.push(...(await request(`wishlist_items?conversation_id=eq.${eq(reply.conversation_id)}&product_url=eq.${eq(url)}&select=id,conversation_id,product&limit=1`)));
      return items;
    },
    // Adds store links the item does not have yet and returns how many. Read just before the write,
    // so a photo or detail update made meanwhile is kept.
    async addWishlistLinks(conversation,id,links) {
      const item=await this.wishlistItem(conversation,id);
      if(!item)throw new Error('Item not found');
      const merged=product=>{const have=new Set((product.links??[]).map(l=>l.url));return {...product,links:[...(product.links??[]),...links.filter(l=>!have.has(l.url))]};};
      const added=merged(item.product).links.length-(item.product.links??[]).length;
      if(!added)return 0;
      await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}`,{method:'PATCH',body:{product:merged(item.product)}});
      for(const encounter of item.wishlist_encounters??[])await request(`wishlist_encounters?item_id=eq.${eq(id)}&reply_id=eq.${eq(encounter.reply_id)}`,{method:'PATCH',body:{product:merged(encounter.product)}});
      return added;
    },
    // A product's latest better-price scan, shared across users (db/042_store_scans.sql).
    async storeScan(key) {return (await request(`store_scans?product_key=eq.${eq(key)}&select=result,scanned_at&limit=1`))[0]??null;},
    saveStoreScan: (key,result) => request('store_scans?on_conflict=product_key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{product_key:key,result,scanned_at:new Date().toISOString()}}),
    wishlist: conversation => request(`wishlist_items?conversation_id=eq.${eq(conversation)}&select=id,product,saved_at&order=saved_at.desc,id.desc&limit=200`),
    async wishlistConversationContext(conversation,replyIds) {
      const ids=replyIds.filter(uuid);if(!ids.length)return [];
      const anchors=await request(`messages?conversation_id=eq.${eq(conversation)}&id=in.(${ids.join(',')})&select=id,created_at&order=created_at.desc&limit=1`);
      if(!anchors[0])return [];
      const [before,after]=await Promise.all([
        request(`messages?conversation_id=eq.${eq(conversation)}&created_at=lte.${eq(anchors[0].created_at)}&select=id,direction,body,status,search_result,created_at&order=created_at.desc,id.desc&limit=21`),
        request(`messages?conversation_id=eq.${eq(conversation)}&created_at=gt.${eq(anchors[0].created_at)}&select=id,direction,body,status,search_result,created_at&order=created_at.asc,id.asc&limit=20`)
      ]);
      return [...before.reverse(),...after];
    },
    async wishlistItem(conversation, id) {
      const rows = await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&select=id,product,saved_at,wishlist_encounters(reply_id,source_image_id,product,messages(created_at))&limit=1`);
      return rows[0] ?? null;
    },
    saveFeedback: (provider, body) => request(`messages?provider_id=eq.${eq(provider)}&direction=eq.inbound`, {
      method: 'PATCH', body: { developer_feedback: body }, prefer: 'return=minimal',
    }),
    // The tester's latest inbound messages before this one, newest first, to tell whether a developer
    // report was just sent (lib/developer-feedback.js reportToContinue).
    inboundBefore: (conversation, provider, limit = 4) => request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.inbound&provider_id=neq.${eq(provider)}&select=provider_id,developer_feedback,created_at&order=created_at.desc,id.desc&limit=${limit}`),
    // Model-inferred signal that a turn missed what the user wanted (db/025_quality_signals.sql).
    saveQualitySignal: (provider, signal) => request(`messages?provider_id=eq.${eq(provider)}&direction=eq.inbound`, {
      method: 'PATCH', body: { quality_signal: signal }, prefer: 'return=minimal',
    }),
    qualitySince: (since, limit = 50) => request(`messages?quality_signal=not.is.null${since ? `&created_at=gt.${eq(since)}` : ''}&select=id,conversation_id,body,quality_signal,created_at,reply_provider_id&order=created_at.asc,id.asc&limit=${limit}`),
    feedback: () => request(`messages?developer_feedback=not.is.null&developer_feedback=neq.&developer_feedback=neq.${eq(CONTINUATION_NOTE)}&select=id,conversation_id,developer_feedback,created_at,conversations(sender_id)&order=created_at.desc,id.desc&limit=100`),
    // Triage reads: oldest-first after a cursor, without sender identity, plus the turns around each report.
    feedbackSince: (since, limit = 50) => request(`messages?developer_feedback=not.is.null&developer_feedback=neq.&developer_feedback=neq.${eq(CONTINUATION_NOTE)}${since ? `&created_at=gt.${eq(since)}` : ''}&select=id,conversation_id,body,developer_feedback,created_at,reply_provider_id&order=created_at.asc,id.asc&limit=${limit}`),
    async feedbackContext(conversation, at, before = 12, after = 4) {
      const fields = 'select=id,provider_id,operation_id,direction,body,status,source,created_at,developer_feedback,image_status,memory_status,search_result,reply_diagnostics,wishlist_saved,message_images(id,mime_type)';
      const [earlier, later] = await Promise.all([
        request(`messages?conversation_id=eq.${eq(conversation)}&created_at=lte.${eq(at)}&${fields}&order=created_at.desc,id.desc&limit=${before + 1}`),
        request(`messages?conversation_id=eq.${eq(conversation)}&created_at=gt.${eq(at)}&${fields}&order=created_at.asc,id.asc&limit=${after}`),
      ]);
      return [...earlier.reverse(), ...later];
    },
    // The sent message a report replies to or taps, when it is outside the context window: the answer
    // itself, or the answer whose card, caption or photo it is (reply_diagnostics.sent_parts).
    async feedbackTarget(conversation, provider) {
      const fields = 'select=id,provider_id,operation_id,direction,body,status,source,created_at,search_result,reply_diagnostics,message_images(id,mime_type)', id = sentMessageId(provider);
      return (await request(`messages?conversation_id=eq.${eq(conversation)}&provider_id=eq.${eq(id)}&${fields}&limit=1`))[0]
        ?? (await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&reply_diagnostics->sent_parts=cs.${eq(JSON.stringify([{ id }]))}&${fields}&limit=1`).catch(() => []))[0] ?? null;
    },
    // Chat metrics reads (lib/chat-metrics.js): message rows without body text, oldest first.
    async metricRows(from, until = null) {
      const window = `created_at=gte.${eq(from)}${until ? `&created_at=lt.${eq(until)}` : ''}`;
      const fields = 'conversation_id,provider_id,operation_id,direction,status,source,created_at,search_result';
      // Newer columns (db/027 sent_at, db/028 reply_diagnostics) are read when present; a 400 means not migrated yet.
      for (const extra of [',sent_at,reply_diagnostics', ',sent_at', '']) {
        try { return await paged(`messages?${window}&select=${fields}${extra}&order=created_at.asc,id.asc`); }
        catch (error) { if (error.database_status !== 400 || !extra) throw error; }
      }
    },
    // Turn outcome reads (lib/turn-outcomes.js): no message text. Flags are read by id only (the note is
    // the tester's own words), quality signals by kind. Newer columns degrade when not migrated yet.
    async outcomeRows(from) {
      const window = `created_at=gte.${eq(from)}`, tester = 'provider_id=not.like.identification-test:*';
      const fields = 'conversation_id,provider_id,operation_id,direction,status,source,created_at,sent_at,search_result,reply_diagnostics,reply_provider_id,image_status';
      const optional = (path, fallback) => paged(path).catch(error => { if ([400, 404].includes(error.database_status)) return fallback?.() ?? []; throw error; });
      const [messages, flagged, signals, usage, events] = await Promise.all([
        paged(`messages?${window}&select=${fields}&order=created_at.asc,id.asc`),
        paged(`messages?${window}&direction=eq.inbound&developer_feedback=not.is.null&developer_feedback=neq.${eq(CONTINUATION_NOTE)}&select=provider_id`),
        optional(`messages?${window}&direction=eq.inbound&quality_signal=not.is.null&${tester}&select=provider_id,kind:quality_signal->>kind`),
        optional(`usage_events?${window}&select=operation,action,cost_usd&order=id.asc`),
        optional(`adoption_events?${window}&select=conversation_id,kind,ref,detail,created_at&order=id.asc`,
          () => optional(`adoption_events?${window}&select=conversation_id,kind,ref,created_at&order=id.asc`)),
      ]);
      const flags = new Set(flagged.map(f => f.provider_id)), kinds = new Map(signals.map(q => [q.provider_id, q.kind]));
      return { usage, events, messages: messages.map(m => m.direction !== 'inbound' ? m : { ...m,
        developer_feedback: flags.has(m.provider_id) ? { flagged: true } : null, quality_signal: kinds.has(m.provider_id) ? { kind: kinds.get(m.provider_id) } : null }) };
    },
    // Nightly judge (lib/judge.js, db/038): outcome rows are upserted every run without touching judge columns.
    saveSourcingTurns: rows => request('sourcing_turns?on_conflict=operation', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: rows.map(r => ({ ...r, updated_at: new Date().toISOString() })) }),
    async judgedSince(from) { return (await request(`sourcing_turns?judged_at=gte.${eq(from)}&select=operation&limit=1000`)).length; },
    async judgedOperations(operations) {
      const found = [];
      for (let i = 0; i < operations.length; i += 40) {
        const chunk = operations.slice(i, i + 40).map(o => `"${String(o).replace(/"/g, '')}"`).join(',');
        found.push(...(await request(`sourcing_turns?operation=in.(${encodeURIComponent(chunk)})&judged_at=not.is.null&select=operation`)).map(r => r.operation));
      }
      return found;
    },
    saveJudgement: (operation, judgement) => request(`sourcing_turns?operation=eq.${eq(operation)}`, { method: 'PATCH', body: judgement, prefer: 'return=minimal' }),
    sourcingTurns: from => paged(`sourcing_turns?at=gte.${eq(from)}&select=operation,conversation_id,at,results_at,request_type,result,products_shown,verified_shown,first_message_ms,result_ms,cost_usd,labels,headline,threaded,judged_at,verdict,failed,criteria,founder_verdict&order=at.asc`),
    sourcingTurn: operation => request(`sourcing_turns?operation=eq.${eq(operation)}&select=operation,conversation_id,at,headline,failed,criteria&limit=1`).then(rows => rows[0] ?? null),
    markJudgement: (operation, verdict) => request(`sourcing_turns?operation=eq.${eq(operation)}`, { method: 'PATCH', body: { founder_verdict: verdict }, prefer: 'return=minimal' }),
    // Inbound message row ids by provider id, for links into a conversation.
    async inboundIds(providers) {
      const found = new Map();
      for (let i = 0; i < providers.length; i += 40) {
        const chunk = providers.slice(i, i + 40).map(p => `"${String(p).replace(/"/g, '')}"`).join(',');
        for (const r of await request(`messages?direction=eq.inbound&provider_id=in.(${encodeURIComponent(chunk)})&select=id,provider_id`)) found.set(r.provider_id, r.id);
      }
      return found;
    },
    judgeFailuresSince: (since, limit = 50) => request(`sourcing_turns?verdict=eq.fail${since ? `&judged_at=gt.${eq(since)}` : ''}&select=operation,conversation_id,at,judged_at,result,labels,failed,criteria&order=judged_at.asc&limit=${limit}`),
    // Adoption dashboard reads (lib/adoption.js): ids and timestamps only, no message text. Owner test messages
    // (identification tests) are left out; a sent `ai:` reply counts as results when it carried at least one product.
    async adoptionRows() {
      const [conversations, inbound, replies, saves, alerts, costs, events] = await Promise.all([
        paged('conversations?line=neq.simulator&select=id,sender_id,created_at&order=created_at.asc'),
        paged('messages?direction=eq.inbound&source=eq.tester&provider_id=not.like.identification-test:*&select=conversation_id,created_at&order=created_at.asc,id.asc'),
        paged('messages?direction=eq.outbound&status=eq.sent&operation_id=like.ai:*&search_result=not.is.null&select=conversation_id,created_at,first:search_result->products->0&order=created_at.asc,id.asc'),
        paged('wishlist_items?select=conversation_id,saved_at&order=saved_at.asc'),
        paged('price_alerts?select=conversation_id,active,created_at&order=created_at.asc'),
        paged('usage_by_user_day?conversation_id=not.is.null&select=conversation_id,cost_usd&order=day.asc'),
        this.adoptionEvents(),
      ]);
      return { conversations, inbound, results: replies.filter(r => r.first).map(({ first, ...r }) => r), saves, alerts, costs, events };
    },
    // Quality section reads (lib/adoption-quality.js). Message text is never read: misses carry the model's neutral
    // summary, flags are counted by id (a 👎 by its fixed note), and photo replies by their products' match labels.
    async adoptionQualityRows() {
      const tester = 'provider_id=not.like.identification-test:*';
      const [misses, flags, thumbs, photos, photoSaves] = await Promise.all([
        paged(`messages?quality_signal=not.is.null&${tester}&select=id,conversation_id,created_at,kind:quality_signal->>kind,about:quality_signal->>about,summary:quality_signal->>summary&order=created_at.asc,id.asc`)
          .catch(error => { if (error.database_status === 400) return []; throw error; }),
        paged(`messages?developer_feedback=not.is.null&developer_feedback=neq.&developer_feedback=neq.${eq(CONTINUATION_NOTE)}&select=id,conversation_id,created_at&order=created_at.asc,id.asc`),
        paged(`messages?developer_feedback=like.${eq(REACTION_NOTE)}*&select=id&order=id.asc`),
        paged(`messages?direction=eq.inbound&image_status=not.is.null&${tester}&select=id,conversation_id,provider_id,created_at,image_status,message_images(id)&order=created_at.asc,id.asc`),
        paged('wishlist_encounters?source_image_id=not.is.null&select=source_image_id,correction:product->>correction_source&order=item_id.asc'),
      ]);
      const photoReplies = [];
      const operations = photos.map(p => `ai:${p.provider_id}`);
      for (let i = 0; i < operations.length; i += 40) {
        const list = operations.slice(i, i + 40).map(o => `"${o.replace(/["\\]/g, '')}"`).join(',');
        photoReplies.push(...await request(`messages?operation_id=in.(${eq(list)})&direction=eq.outbound&select=operation_id,status,products:search_result->products&limit=1000`));
      }
      return { misses, flags, thumbs, photos, photoReplies, photoSaves };
    },
    // Adoption events (db/032). Before that migration runs the table is missing, which reads as no events.
    async adoptionEvents() {
      try { return await paged('adoption_events?select=conversation_id,kind,quantity,created_at&order=created_at.asc,id.asc'); }
      catch (error) { if ([400, 404].includes(error.database_status)) return []; throw error; }
    },
    recordAdoptionEvent: row => request('adoption_events', { method: 'POST', body: row, prefer: 'return=minimal' }),
    // The sent reply a tapback points at, only in the reacting person's own conversation (lib/adoption-events.js).
    // A tapback on a product card or a wishlist card names that part, kept with its answer (reply_diagnostics.sent_parts).
    async reactionTarget(provider, sender) {
      const id = sentMessageId(provider), owner = `select=conversation_id,operation_id,conversations!inner(sender_id)&conversations.sender_id=eq.${eq(sender)}&limit=1`;
      return (await request(`messages?provider_id=eq.${eq(id)}&direction=eq.outbound&${owner}`))[0]
        ?? (await request(`messages?direction=eq.outbound&reply_diagnostics->sent_parts=cs.${eq(JSON.stringify([{ id }]))}&${owner}`).catch(() => []))[0] ?? null;
    },
    // The stored result of a sent reply, for tracked product links (lib/adoption-events.js).
    async replyResult(operation) {
      return (await request(`messages?operation_id=eq.${eq(operation)}&direction=eq.outbound&select=conversation_id,search_result&limit=1`))[0] ?? null;
    },
    replyActions: (from, until = null) => paged(`usage_events?operation=like.ai:*&action=not.is.null&created_at=gte.${eq(from)}${until ? `&created_at=lt.${eq(until)}` : ''}&select=operation,action&order=id.asc`),
    // Recurring jobs (db/034_recurring_jobs.sql): metered calls and runs per job for the month, and pg_cron's own job list.
    jobUsageMonth: date => request(`usage_by_day_job?day=gte.${eq(date.slice(0,7)+'-01')}&day=lte.${eq(date)}&select=day,job,provider,model,calls,units,input_tokens,cached_tokens,output_tokens,web_search_calls,last_at&limit=5000`),
    jobRunsMonth: date => request(`job_runs_by_day?day=gte.${eq(date.slice(0,7)+'-01')}&day=lte.${eq(date)}&select=day,job,runs,failed,skipped,duration_ms,last_at,last_status&limit=5000`),
    scheduledJobs: date => request('rpc/scheduled_jobs',{method:'POST',body:{p_since:date.slice(0,7)+'-01T00:00:00Z'}}),
    recordJobRun: run => request('job_runs',{method:'POST',body:run,prefer:'return=minimal'}),
    meteredMonth: date => request(`usage_by_day_model?day=gte.${eq(date.slice(0,7)+'-01')}&day=lte.${eq(date)}&select=day,feature,provider,model,calls,units,input_tokens,cached_tokens,output_tokens,web_search_calls,cost_usd,last_at&limit=5000`),
    // Spending caps (lib/cost-caps.js): token and search counts per day and model, priced in code. Before
    // db/036_cost_caps.sql runs, a person's spend falls back to the stored per-call estimates.
    async userSpend(conversation, month) {
      const cols = 'day,provider,model,units,input_tokens,cached_tokens,output_tokens,web_search_calls,cost_usd';
      try { return await request(`usage_by_user_model_day?conversation_id=eq.${eq(conversation)}&day=gte.${eq(month)}&select=${cols}&limit=5000`); }
      catch { return request(`usage_by_user_day?conversation_id=eq.${eq(conversation)}&day=gte.${eq(month)}&select=day,cost_usd&limit=5000`); }
    },
    globalSpend: month => request(`usage_by_day_model?day=gte.${eq(month)}&select=day,provider,model,units,input_tokens,cached_tokens,output_tokens,web_search_calls,cost_usd&limit=5000`),
    async spendByUser(month) {
      try { return await paged(`usage_by_user_model_day?day=gte.${eq(month)}&conversation_id=not.is.null&select=conversation_id,day,provider,model,units,input_tokens,cached_tokens,output_tokens,web_search_calls,cost_usd&order=conversation_id.asc,day.asc`); }
      catch { return paged(`usage_by_user_day?day=gte.${eq(month)}&conversation_id=not.is.null&select=conversation_id,day,cost_usd&order=conversation_id.asc,day.asc`); }
    },
    // Whether a fixed notice (operation prefix, e.g. 'cost-cap:') was texted to this person since a time.
    async noticeSince(conversation, prefix, since) {
      return (await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&operation_id=like.${eq(prefix)}*&created_at=gte.${eq(since)}&select=id&limit=1`)).length > 0;
    },
    // The month's daily usage, plus every earlier monthly fee and budget: a fee carries forward until changed.
    costEntries: date => request(`cost_entries?select=service,kind,date,amount,note,updated_at&date=lte.${date}&or=(kind.neq.usage,date.gte.${date.slice(0,7)}-01)&order=date.desc&limit=1000`),
    saveCostEntry: entry => request('cost_entries?on_conflict=service,kind,date', {method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:{...entry,updated_at:new Date().toISOString()}}),
    receive: ({ space, message }) => request('rpc/receive_message', { method: 'POST', body: {
      p_sender: message.sender.id, p_line: space.phone, p_provider_id: message.id, p_body: message.content.text,
      p_reply_provider_id: replyProviderId(message) ?? reactionTargetId(message),
    } }),
    async saveImages(provider, images) {
      const rows = await request(`messages?provider_id=eq.${eq(provider)}&select=id&limit=1`);
      if (!rows[0]) throw new Error('Message missing');
      await request('message_images?on_conflict=message_id,position', { method:'POST', prefer:'resolution=ignore-duplicates,return=minimal',
        body:images.map((image,position) => ({...image,position,message_id:rows[0].id})) });
      await request(`messages?id=eq.${eq(rows[0].id)}`, {method:'PATCH',body:{image_status:'saved'}});
    },
    // Bounded to the column's size limit (lib/search-result-budget.js), so a large profile or result never fails the write.
    searchResult: (operation,result) => {
      const bounded=boundedSearchResult(result);
      if(bounded?.storage_trimmed)console.log(JSON.stringify({event:'search_result_trimmed',level:bounded.storage_trimmed,bytes:jsonbBytes(bounded)}));
      return request(`messages?operation_id=eq.${eq(operation)}`,{method:'PATCH',body:{search_result:bounded}});
    },
    recordDelivery: (operation,provider,replyProvider=null) => request(`messages?operation_id=eq.${eq(operation)}&direction=eq.outbound`, {
      method:'PATCH',body:{provider_id:provider,reply_provider_id:replyProvider},prefer:'return=minimal',
    }),
    // One message of a conversation, for the admin re-read of a failed photo.
    async conversationMessage(conversation, id) {
      const rows = await request(`messages?id=eq.${eq(id)}&conversation_id=eq.${eq(conversation)}&select=id,provider_id,direction,image_status,message_images(id)&limit=1`);
      return rows[0] ?? null;
    },
    imagesForMessage: id => request(`message_images?message_id=eq.${eq(id)}&select=mime_type,data&order=position.asc&limit=3`),
    imageStatus: (provider,status) => request(`messages?provider_id=eq.${eq(provider)}`, {method:'PATCH',body:{image_status:status}}),
    async image(id) {
      const rows = await request(`message_images?id=eq.${eq(id)}&select=mime_type,data&limit=1`);
      return rows[0] ?? null;
    },
    list: () => request('conversations?select=id,sender_id,line,created_at,updated_at&order=updated_at.desc&limit=50'),
    async conversation(id) {
      const rows = await request(`conversations?id=eq.${eq(id)}&select=id,sender_id,line&limit=1`);
      return rows[0] ?? null;
    },
    async messages(id, before) {
      // Return newest 100 in chronological order. Earlier history is paginated by timestamp + ID.
      const cursor = before ? `&or=${eq(`(created_at.lt.${before.at},and(created_at.eq.${before.at},id.lt.${before.id}))`)}` : '';
      const rows = await request(`messages?conversation_id=eq.${eq(id)}&select=id,direction,body,status,source,created_at,developer_feedback,memory_status,image_status,search_result,message_images(id,mime_type)&order=created_at.desc,id.desc&limit=101${cursor}`);
      const hasMore = rows.length > 100;
      const page = rows.slice(0, 100).reverse();
      return { messages: page, before: hasMore ? { at: page[0].created_at, id: page[0].id } : null };
    },
    async profile(id) {
      const rows = await request(`taste_profiles?conversation_id=eq.${eq(id)}&select=facts,version&limit=1`);
      return rows[0] ?? { facts: [], version: 0 };
    },
    saveProfile: (id, version, facts) => request('rpc/save_taste_profile', { method: 'POST', body: {
      p_conversation: id, p_version: version, p_facts: facts,
    } }),
    memoryStatus: (provider, status) => request(`messages?provider_id=eq.${eq(provider)}`, {
      method: 'PATCH', body: { memory_status: status }, prefer: 'return=minimal',
    }),
    historyForMemory: id => request(`messages?conversation_id=eq.${eq(id)}&direction=eq.inbound&source=eq.tester&developer_feedback=is.null&select=id,direction,body,created_at&order=created_at.desc,id.desc&limit=101`),
    // Waitlist status for Admin › People (db/035). Callers treat a failure as unknown status.
    async accessFor(ids) {
      const valid = ids.filter(uuid); if (!valid.length) return new Map();
      const rows = await request(`conversations?id=in.(${valid.join(',')})&select=id,access,waitlist_replies,approved_at`);
      return new Map(rows.map(({ id, ...row }) => [id, row]));
    },
    // True only when this call moved the conversation from waitlisted to approved.
    async approveAccess(conversation) {
      const rows = await request(`conversations?id=eq.${eq(conversation)}&access=eq.waitlisted`, { method: 'PATCH', body: { access: 'approved', approved_at: new Date().toISOString() }, prefer: 'return=representation' });
      return rows.length > 0;
    },
    // True only when this call moved the conversation from approved back to the waitlist. Replies already
    // used on the waitlist stay used.
    async waitlistAccess(conversation) {
      const rows = await request(`conversations?id=eq.${eq(conversation)}&access=eq.approved`, { method: 'PATCH', body: { access: 'waitlisted', approved_at: null }, prefer: 'return=representation' });
      return rows.length > 0;
    },
    // Admin › People names: each number's latest signup name, and the first name told to Jules in chat.
    async signupNames(phones) {
      const valid = phones.filter(p => typeof p === 'string' && p); if (!valid.length) return new Map();
      const rows = await request(`public_signups?phone_number=in.(${valid.map(p => `"${eq(p)}"`).join(',')})&select=phone_number,profile&order=consent_at.desc`);
      const names = new Map(); for (const row of rows) if (!names.has(row.phone_number) && row.profile?.first_name) names.set(row.phone_number, row.profile);
      return names;
    },
    async profilesFor(ids) {
      const valid = ids.filter(uuid); if (!valid.length) return new Map();
      return new Map((await request(`taste_profiles?conversation_id=in.(${valid.join(',')})&select=conversation_id,facts`)).map(r => [r.conversation_id, r.facts]));
    },
    // Waitlist (db/035): approved, an allowance reply, the daily notice, or quiet. Only read with WAITLIST_ENABLED.
    async claimWaitlistTurn(conversation, allowance) {
      return (await request('rpc/claim_waitlist_turn', { method: 'POST', body: { p_conversation: conversation, p_allowance: allowance } }))[0] ?? null;
    },
    // Turn order (lib/inbox.js): whether a later message in the conversation has claimed its own
    // reply, and whether an earlier reply is still being prepared. Claim rows are dated when the
    // message arrives, until a reply that followed an acknowledgment is re-dated at send time.
    async newerTurn(conversation, operation) {
      const mine = (await request(`messages?operation_id=eq.${eq(operation)}&select=created_at&limit=1`))[0];
      if (!mine) return false;
      return (await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&operation_id=like.ai:*&operation_id=neq.${eq(operation)}&status=neq.blocked&created_at=gt.${eq(mine.created_at)}&select=id&limit=1`)).length > 0;
    },
    async olderTurnRunning(conversation, operation, since) {
      const mine = (await request(`messages?operation_id=eq.${eq(operation)}&select=created_at&limit=1`))[0];
      if (!mine) return false;
      return (await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&operation_id=like.ai:*&operation_id=neq.${eq(operation)}&status=eq.generating&created_at=lt.${eq(mine.created_at)}&created_at=gt.${eq(since)}&select=id&limit=1`)).length > 0;
    },
    claimAI: (conversation, operation) => request('rpc/claim_ai_reply', { method: 'POST', body: {
      p_conversation: conversation, p_operation: operation,
    } }),
    async context(id, provider) {
      const inbound = await request(`messages?provider_id=eq.${eq(provider)}&conversation_id=eq.${eq(id)}&select=id,created_at,reply_provider_id&limit=1`);
      if (!inbound[0]) throw new Error('Inbound message missing');
      const { id: messageId, created_at: at } = inbound[0];
      const cursor = eq(`(created_at.lt.${at},and(created_at.eq.${at},id.lte.${messageId}))`);
      const rows = await request(`messages?conversation_id=eq.${eq(id)}&developer_feedback=is.null&and=(or(operation_id.is.null,and(operation_id.not.like.feedback:*,operation_id.not.like.signup-alert:*)),or(provider_id.is.null,provider_id.not.like.identification-test:*))&or=${cursor}&select=id,provider_id,direction,body,status,created_at,reply_provider_id,message_images(id,position)&order=created_at.desc,id.desc&limit=20`);
      const context = rows.reverse();
      if (inbound[0].reply_provider_id) {
        const references = [], seen = new Set([provider]), parts = [];
        let target = inbound[0].reply_provider_id;
        while (target && !seen.has(target) && references.length < 10) {
          seen.add(target);
          const select = 'select=id,provider_id,direction,body,status,created_at,reply_provider_id,search_result,message_images(id,position)';
          let matches = await request(`messages?conversation_id=eq.${eq(id)}&provider_id=eq.${eq(sentMessageId(target))}&${select}&limit=1`);
          // A product card, its caption or photo, or a wishlist card is its own iMessage: the answer it
          // belongs to keeps its id (reply_diagnostics.sent_parts), and the reply is about that product.
          if (!matches[0]) {
            const part = sentMessageId(target); parts.push(part);
            matches = await request(`messages?conversation_id=eq.${eq(id)}&direction=eq.outbound&reply_diagnostics->sent_parts=cs.${eq(JSON.stringify([{ id:part }]))}&select=id,provider_id,direction,body,status,created_at,reply_provider_id,search_result,reply_diagnostics,message_images(id,position)&limit=1`).catch(() => []);
            if (matches[0]) {
              const { reply_diagnostics: sent, ...answer } = matches[0], found = sent?.sent_parts?.find(p => p.id === part);
              matches = [{ ...answer, replied_to_part: { kind:found?.kind ?? null, option:found?.option ?? null } }];
            }
          }
          if (!matches[0]) break;
          references.push(matches[0]);
          target = matches[0].reply_provider_id;
        }
        const resolved = references.length > 0 && !target;
        // iMessage points every reply in a thread at the thread's first message, so later turns in the
        // same thread (the user's replies and Jules' answers to them) belong to what is referenced.
        let thread = [];
        if (resolved) {
          const quoted = ids => `in.(${ids.map(v => eq(`"${v.replace(/["\\]/g, '\\$&')}"`)).join(',')})`;
          const fields = 'select=id,provider_id,direction,body,status,created_at,reply_provider_id,search_result,message_images(id,position)';
          const within = `conversation_id=eq.${eq(id)}&created_at=lte.${eq(at)}&id=neq.${eq(messageId)}&developer_feedback=is.null&or=(operation_id.is.null,and(operation_id.not.like.feedback:*,operation_id.not.like.signup-alert:*))`;
          const replies = await request(`messages?${within}&reply_provider_id=${quoted([...references.map(m => m.provider_id).filter(Boolean), ...parts])}&${fields}&order=created_at.desc,id.desc&limit=10`);
          const asked = replies.map(m => m.provider_id).filter(Boolean);
          const answers = asked.length ? await request(`messages?${within}&direction=eq.outbound&reply_provider_id=${quoted(asked)}&${fields}&order=created_at.desc,id.desc&limit=10`) : [];
          const known = new Set(references.map(m => m.id));
          thread = [...replies, ...answers].filter(m => !known.has(m.id) && (m.direction === 'inbound' || m.status === 'sent') && known.add(m.id))
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-8);
        }
        const current = context.find(m => m.id === messageId);
        if (current) current.reply_context = { provider_id: inbound[0].reply_provider_id,
          resolved, messages: [...references.reverse(), ...thread] };
      }
      return context;
    },
    // The latest turns, for the reply composer. Developer feedback, its acknowledgments and the owner's
    // new-signup alerts (lib/signup-alert.js) are excluded, as in context() above.
    recent: async (id, limit = 8) => (await request(`messages?conversation_id=eq.${eq(id)}&developer_feedback=is.null&or=(operation_id.is.null,and(operation_id.not.like.feedback:*,operation_id.not.like.signup-alert:*))&select=direction,body,status,created_at&order=created_at.desc,id.desc&limit=${limit}`)).reverse(),
    // resequence dates the reply at send time (it follows an acknowledgment sent during the turn).
    prepareAI: (operation, body, source, { resequence = false } = {}) => request(`messages?operation_id=eq.${eq(operation)}`, {
      method: 'PATCH', body: { body, source, status: 'sending', ...(resequence ? { created_at: new Date().toISOString() } : {}) }, prefer: 'return=minimal',
    }),
    // Unprompted texts since a time, for the shared nudge limits (lib/nudges.js): the "goes with" offer,
    // fit checks and price alerts. Admin test texts (nudge-test:, price-alert-test:) never count.
    unpromptedSince: (conversation, since) => request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&created_at=gte.${eq(since)}&or=(operation_id.like.gmail:*:purchases:*,operation_id.like.gmail:*:fit-check:*,operation_id.like.price-alert:*)&select=operation_id,status,created_at&order=created_at.desc&limit=50`),
    // When the person last texted Jules (ISO), for the nudge back-off (lib/nudges.js); null when never.
    async lastInbound(conversation) {
      const rows = await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.inbound&select=created_at&order=created_at.desc&limit=1`);
      return rows[0]?.created_at ?? null;
    },
    // Every person's nudge log, for Admin › Adoption (lib/nudges.js nudgeSummary).
    nudgeLogs: () => request('gmail_imports?select=conversation_id,nudges:data->nudges&data->nudges=not.is.null&limit=200'),
    // The nudge state alone (lib/goes-with.js): the open "goes with" offer, without the purchase history.
    async nudgeState(conversation) {
      const rows = await request(`gmail_imports?conversation_id=eq.${eq(conversation)}&select=nudges:data->nudges&limit=1`);
      return rows[0]?.nudges ?? null;
    },
    async smsOptedOut(conversation) {
      const rows = await request(`conversations?id=eq.${eq(conversation)}&select=sms_opted_out_at&limit=1`);
      return Boolean(rows[0]?.sms_opted_out_at);
    },
    setSmsOptOut: (conversation, optedOut) => request('rpc/set_sms_opt_out', { method: 'POST', body: {
      p_conversation: conversation, p_opted_out: optedOut,
    } }),
    reserve: (conversation, operation, body, source) => request('rpc/reserve_reply', { method: 'POST', body: {
      p_conversation: conversation, p_operation: operation, p_body: body, p_source: source,
    } }),
    async operation(operation) {
      const rows = await request(`messages?operation_id=eq.${eq(operation)}&select=conversation_id,body,status&limit=1`);
      return rows[0] ?? null;
    },
    finish: (operation, status) => request(`messages?operation_id=eq.${eq(operation)}`, {
      method: 'PATCH', body: { status }, prefer: 'return=minimal',
    }),
    // Why a reply fell back or stalled (db/028_reply_reliability.sql); never message text.
    replyDiagnostics: (operation, diagnostics) => request(`messages?operation_id=eq.${eq(operation)}&direction=eq.outbound`, {
      method: 'PATCH', body: { reply_diagnostics: diagnostics }, prefer: 'return=minimal',
    }),
    stalledReplies: before => request(`messages?direction=eq.outbound&status=in.(generating,sending)&operation_id=like.ai:*&created_at=lt.${eq(before)}&created_at=gt.${eq(new Date(Date.now()-86400000).toISOString())}&or=(reply_diagnostics.is.null,reply_diagnostics->>stalled_at.is.null)&select=id,conversation_id,operation_id,status,created_at,reply_diagnostics&order=created_at.asc&limit=5`),
    // Claims a stuck reply once: only the first sweep to mark it stalled gets the row back.
    async claimStalledReply(id, diagnostics) {
      const rows = await request(`messages?id=eq.${eq(id)}&status=in.(generating,sending)&or=(reply_diagnostics.is.null,reply_diagnostics->>stalled_at.is.null)`, {
        method: 'PATCH', body: { reply_diagnostics: diagnostics }, prefer: 'return=representation' });
      return rows.length === 1;
    },
    async repliedSince(conversation, at) {
      return (await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&status=eq.sent&created_at=gt.${eq(at)}&select=id&limit=1`)).length > 0;
    },
    queueHistoryAnswer: (conversation, answer) => request('rpc/queue_history_answer', { method: 'POST', body: { p_conversation: conversation, p_answer: answer } }),
    clearHistoryAnswers: (conversation, ids) => request('rpc/clear_history_answers', { method: 'POST', body: { p_conversation: conversation, p_ids: ids } }),
  };
}
