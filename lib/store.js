import {uuid} from './http.js';
import {uniqueAlertLinks} from './alert-links.js';
import { stateFromSearch } from './shopping-context.js';
import { replyProviderId } from './message-context.js';
import {purchaseHistory} from './evidence.js';
export function createStore(env, fetcher = fetch) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('replace-with')) throw new Error('Database not configured');
  async function request(path, { method = 'GET', body, prefer } = {}) {
    const response = await fetcher(`${url}/rest/v1/${path}`, {
      method, headers: { apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const error=new Error('Database request failed');error.database_status=response.status;
      try{const failure=await response.json();if(/^[A-Z0-9]{5,12}$/.test(failure.code??''))error.database_code=failure.code;}catch{}
      throw error;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const eq = value => encodeURIComponent(value);
  return {
    async phoneLoginMember(phone) {
      const rows=await request(`conversations?sender_id=eq.${eq(phone)}&select=id,line,sms_opted_out_at,wishlist_members!inner(email)&limit=2`);
      if(rows.length!==1||rows[0].wishlist_members.length!==1)return null;
      return {email:rows[0].wishlist_members[0].email,line:rows[0].line,opted_out:Boolean(rows[0].sms_opted_out_at)};
    },
    beginPhoneLogin:(id,phone,connection,email)=>request('rpc/begin_phone_login',{method:'POST',body:{p_id:id,p_phone:phone,p_connection:connection,p_email:email}}),
    attemptPhoneLogin:id=>request('rpc/attempt_phone_login',{method:'POST',body:{p_id:id}}),
    completePhoneLogin:id=>request(`login_challenges?id=eq.${eq(id)}`,{method:'PATCH',body:{used:true}}),
    async gmailImport(conversation) {return (await request(`gmail_imports?conversation_id=eq.${eq(conversation)}&select=*&limit=1`))[0]??null;},
    // Running imports that have not written since `before` (the sweep decides which to restart).
    gmailProfilesDue:async()=>(await request('rpc/gmail_profiles_due',{method:'POST',body:{}})).map(r=>r.conversation_id??r),
    gmailSweepSecret:async()=>request('rpc/gmail_sweep_secret',{method:'POST',body:{}}),
    quietGmailImports:before=>request(`gmail_imports?select=conversation_id,updated_at,lease_until,job:data->job&data->job->>status=in.(listing,extracting,questions)&updated_at=lt.${eq(before)}&limit=50`),
    // Receipt-derived shopping history is a view over evidence, never stored as a belief.
    purchaseHistory(conversation) {return purchaseHistory(this,conversation);},
    async evidence(conversation,origin=null) {
      const rows=[];
      for(let offset=0;;offset+=1000){
        const page=await request(`evidence?conversation_id=eq.${eq(conversation)}${origin?`&origin=${Array.isArray(origin)?`in.(${origin.map(eq).join(',')})`:`eq.${eq(origin)}`}`:''}&select=id,kind,origin,source,data,recorded_by,created_at&order=seq.asc&limit=1000&offset=${offset}`);
        rows.push(...page);if(page.length<1000)return rows;
      }
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
    async onboardingInvite(phone) {
      const rows=await request(`conversations?sender_id=eq.${eq(phone)}&select=id,sender_id,line,onboarding_sessions!inner(state)&limit=2`);
      return rows.length===1?rows[0]:null;
    },
    async onboardingSession(conversation) {
      return (await request(`onboarding_sessions?conversation_id=eq.${eq(conversation)}&select=state,updated_at&limit=1`))[0]??null;
    },
    advanceOnboarding: (conversation,from,to)=>request('rpc/advance_onboarding',{method:'POST',body:{p_conversation:conversation,p_from:from,p_to:to}}),
    signup: input => request('rpc/record_public_signup', {method:'POST',body:input}),
    async textWishlistState(conversation) {
      const rows=await request(`messages?conversation_id=eq.${eq(conversation)}&direction=eq.outbound&status=eq.sent&search_result=not.is.null&select=search_result,created_at&order=created_at.desc,id.desc&limit=1`);
      const row=rows[0];
      return row && Date.now()-Date.parse(row.created_at)<7*86400000 ? stateFromSearch(row.search_result) : null;
    },
    async wishlistReplyId(operation, {confirmed=false}={}) {
      const scope=confirmed?"&source=eq.ai&status=in.(generating,sending,sent)&search_result->>user_confirmed=eq.true":"&status=eq.sent";
      return (await request(`messages?operation_id=eq.${eq(operation)}${scope}&select=id&limit=1`))[0]?.id;
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
    priceAlerts: conversation => request(`price_alerts?conversation_id=eq.${eq(conversation)}&select=id,group_id,name,size,active,last_checked_at,notified,baselines,links,last_result`),
    enablePriceAlert: input => request('rpc/enable_price_alert',{method:'POST',body:{...input,p_links:uniqueAlertLinks(input.p_links??[])}}),
    disablePriceAlert: (conversation,group) => request(`price_alerts?conversation_id=eq.${eq(conversation)}&group_id=eq.${eq(group)}`,{method:'PATCH',body:{active:false}}),
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
    wishlistEntries: (conversation,{includeRemoved=false}={}) => request(`wishlist_entry_metadata?conversation_id=eq.${eq(conversation)}&select=reply_id,item_id,source_image_id,metadata,has_image,reply_at,source_at&limit=1000`).then(rows=>rows.map(({metadata,reply_at,source_at,...row})=>metadata?{...metadata,...row,removed:metadata.wishlist_removed,messages:{created_at:reply_at},message_images:source_at?{messages:{created_at:source_at}}:null}:row)).then(rows=>includeRemoved?rows:rows.filter(row=>row.removed!=='true'&&row.removed!==true)),
    async setWishlistRemoved(conversation,entries,removed) {
      // Read through owned items before updating their individual encounters.
      // Keep snapshots and conversation history so removal can be undone.
      for(const entry of entries){
        const item=await this.wishlistItem(conversation,entry.item_id);
        const encounter=item?.wishlist_encounters?.find(row=>row.reply_id===entry.reply_id);
        if(!encounter)throw new Error('Item not found');
        await request(`wishlist_encounters?item_id=eq.${eq(entry.item_id)}&reply_id=eq.${eq(entry.reply_id)}`,{method:'PATCH',body:{product:{...encounter.product,wishlist_removed:removed}}});
      }
    },
    async wishlistPhoto(conversation,id,index=null) {
      const rows = await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&select=image:product->image,additional_images:product->additional_images&limit=1`);
      return index===null?rows[0]?.image??null:rows[0]?.additional_images?.[index]??null;
    },
    async saveWishlistPhotos(conversation,id,update) {
      const item=await this.wishlistItem(conversation,id);
      if(!item)throw new Error('Item not found');
      const fields=Object.fromEntries(['image','image_kind','additional_images','photo_count','photo_status','photo_attempted_at','photo_attempted_revision'].filter(k=>k in update).map(k=>[k,update[k]]));
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
    feedback: () => request('messages?developer_feedback=not.is.null&developer_feedback=neq.&select=id,conversation_id,developer_feedback,created_at,conversations(sender_id)&order=created_at.desc,id.desc&limit=100'),
    // Triage reads: oldest-first after a cursor, without sender identity, plus the turns around each report.
    feedbackSince: (since, limit = 50) => request(`messages?developer_feedback=not.is.null&developer_feedback=neq.${since ? `&created_at=gt.${eq(since)}` : ''}&select=id,conversation_id,body,developer_feedback,created_at,reply_provider_id&order=created_at.asc,id.asc&limit=${limit}`),
    async feedbackContext(conversation, at, before = 12, after = 4) {
      const fields = 'select=id,direction,body,status,source,created_at,developer_feedback,image_status,memory_status,search_result,message_images(id,mime_type)';
      const [earlier, later] = await Promise.all([
        request(`messages?conversation_id=eq.${eq(conversation)}&created_at=lte.${eq(at)}&${fields}&order=created_at.desc,id.desc&limit=${before + 1}`),
        request(`messages?conversation_id=eq.${eq(conversation)}&created_at=gt.${eq(at)}&${fields}&order=created_at.asc,id.asc&limit=${after}`),
      ]);
      return [...earlier.reverse(), ...later];
    },
    costEntries: date => request(`cost_entries?select=service,kind,date,amount,note,updated_at&date=gte.${date.slice(0,7)}-01&date=lte.${date}&limit=500`),
    saveCostEntry: entry => request('cost_entries?on_conflict=service,kind,date', {method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:{...entry,updated_at:new Date().toISOString()}}),
    receive: ({ space, message }) => request('rpc/receive_message', { method: 'POST', body: {
      p_sender: message.sender.id, p_line: space.phone, p_provider_id: message.id, p_body: message.content.text,
      p_reply_provider_id: replyProviderId(message),
    } }),
    async saveImages(provider, images) {
      const rows = await request(`messages?provider_id=eq.${eq(provider)}&select=id&limit=1`);
      if (!rows[0]) throw new Error('Message missing');
      await request('message_images?on_conflict=message_id,position', { method:'POST', prefer:'resolution=ignore-duplicates,return=minimal',
        body:images.map((image,position) => ({...image,position,message_id:rows[0].id})) });
      await request(`messages?id=eq.${eq(rows[0].id)}`, {method:'PATCH',body:{image_status:'saved'}});
    },
    searchResult: (operation,result) => request(`messages?operation_id=eq.${eq(operation)}`,{method:'PATCH',body:{search_result:result}}),
    recordDelivery: (operation,provider,replyProvider=null) => request(`messages?operation_id=eq.${eq(operation)}&direction=eq.outbound`, {
      method:'PATCH',body:{provider_id:provider,reply_provider_id:replyProvider},prefer:'return=minimal',
    }),
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
    claimAI: (conversation, operation) => request('rpc/claim_ai_reply', { method: 'POST', body: {
      p_conversation: conversation, p_operation: operation,
    } }),
    async context(id, provider) {
      const inbound = await request(`messages?provider_id=eq.${eq(provider)}&conversation_id=eq.${eq(id)}&select=id,created_at,reply_provider_id&limit=1`);
      if (!inbound[0]) throw new Error('Inbound message missing');
      const { id: messageId, created_at: at } = inbound[0];
      const cursor = eq(`(created_at.lt.${at},and(created_at.eq.${at},id.lte.${messageId}))`);
      const rows = await request(`messages?conversation_id=eq.${eq(id)}&developer_feedback=is.null&and=(or(operation_id.is.null,operation_id.not.like.feedback:*),or(provider_id.is.null,provider_id.not.like.identification-test:*))&or=${cursor}&select=id,provider_id,direction,body,status,created_at,reply_provider_id,message_images(id,position)&order=created_at.desc,id.desc&limit=20`);
      const context = rows.reverse();
      if (inbound[0].reply_provider_id) {
        const references = [], seen = new Set([provider]);
        let target = inbound[0].reply_provider_id;
        while (target && !seen.has(target) && references.length < 10) {
          seen.add(target);
          const matches = await request(`messages?conversation_id=eq.${eq(id)}&provider_id=eq.${eq(target)}&select=id,provider_id,direction,body,status,created_at,reply_provider_id,search_result,message_images(id,position)&limit=1`);
          if (!matches[0]) break;
          references.push(matches[0]);
          target = matches[0].reply_provider_id;
        }
        const current = context.find(m => m.id === messageId);
        if (current) current.reply_context = { provider_id: inbound[0].reply_provider_id,
          resolved: references.length > 0 && !target, messages: references.reverse() };
      }
      return context;
    },
    prepareAI: (operation, body, source) => request(`messages?operation_id=eq.${eq(operation)}`, {
      method: 'PATCH', body: { body, source, status: 'sending' }, prefer: 'return=minimal',
    }),
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
  };
}
