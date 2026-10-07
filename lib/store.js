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
    if (!response.ok) throw new Error('Database request failed');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const eq = value => encodeURIComponent(value);
  return {
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
    wishlistPending: () => request('messages?status=eq.sent&source=eq.ai&wishlist_saved=eq.false&wishlist_payload=not.is.null&select=operation_id&limit=100'),
    wishlistEntries: conversation => request(`wishlist_encounters?select=reply_id,item_id,source_image_id,name:product->>name,brand:product->>brand,target:product->>target,match:product->>match,display_name:product->>display_name,item_description:product->>item_description,candidate_rank:product->>candidate_rank,links:product->links,has_image:product->image->>mime_type,image_kind:product->>image_kind,preview_image_url:product->>preview_image_url,price_snapshot:product->price_snapshot,message_images(messages(created_at)),messages(created_at),wishlist_items!inner(conversation_id)&wishlist_items.conversation_id=eq.${eq(conversation)}&limit=1000`),
    async wishlistPhoto(conversation,id) {
      const rows = await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&select=image:product->image&limit=1`);
      return rows[0]?.image ?? null;
    },
    async correctWishlistProduct(conversation,id,update) {
      const item=await this.wishlistItem(conversation,id);
      if(!item)throw new Error('Item not found');
      const revised=product=>({...product,...update,superseded_links:[...(product.superseded_links??[]),...(product.links??[])]});
      await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}`,{method:'PATCH',body:{product:revised(item.product)}});
      for(const encounter of item.wishlist_encounters??[])await request(`wishlist_encounters?item_id=eq.${eq(id)}&source_image_id=eq.${eq(encounter.source_image_id)}`,{method:'PATCH',body:{product:revised(encounter.product)}});
    },
    wishlist: conversation => request(`wishlist_items?conversation_id=eq.${eq(conversation)}&select=id,product,saved_at&order=saved_at.desc,id.desc&limit=200`),
    async wishlistItem(conversation, id) {
      const rows = await request(`wishlist_items?conversation_id=eq.${eq(conversation)}&id=eq.${eq(id)}&select=id,product,saved_at,wishlist_encounters(source_image_id,product,messages(created_at))&limit=1`);
      return rows[0] ?? null;
    },
    saveFeedback: (provider, body) => request(`messages?provider_id=eq.${eq(provider)}&direction=eq.inbound`, {
      method: 'PATCH', body: { developer_feedback: body }, prefer: 'return=minimal',
    }),
    feedback: () => request('messages?developer_feedback=not.is.null&developer_feedback=neq.&select=id,conversation_id,developer_feedback,created_at,conversations(sender_id)&order=created_at.desc,id.desc&limit=100'),
    costEntries: date => request(`cost_entries?select=service,kind,date,amount,note,updated_at&date=gte.${date.slice(0,7)}-01&date=lte.${date}&limit=500`),
    saveCostEntry: entry => request('cost_entries?on_conflict=service,kind,date', {method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:{...entry,updated_at:new Date().toISOString()}}),
    receive: ({ space, message }) => request('rpc/receive_message', { method: 'POST', body: {
      p_sender: message.sender.id, p_line: space.phone, p_provider_id: message.id, p_body: message.content.text,
    } }),
    async saveImages(provider, images) {
      const rows = await request(`messages?provider_id=eq.${eq(provider)}&select=id&limit=1`);
      if (!rows[0]) throw new Error('Message missing');
      await request('message_images?on_conflict=message_id,position', { method:'POST', prefer:'resolution=ignore-duplicates,return=minimal',
        body:images.map((image,position) => ({...image,position,message_id:rows[0].id})) });
      await request(`messages?id=eq.${eq(rows[0].id)}`, {method:'PATCH',body:{image_status:'saved'}});
    },
    searchResult: (operation,result) => request(`messages?operation_id=eq.${eq(operation)}`,{method:'PATCH',body:{search_result:result}}),
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
      const inbound = await request(`messages?provider_id=eq.${eq(provider)}&conversation_id=eq.${eq(id)}&select=id,created_at&limit=1`);
      if (!inbound[0]) throw new Error('Inbound message missing');
      const { id: messageId, created_at: at } = inbound[0];
      const cursor = eq(`(created_at.lt.${at},and(created_at.eq.${at},id.lte.${messageId}))`);
      const rows = await request(`messages?conversation_id=eq.${eq(id)}&developer_feedback=is.null&and=(or(operation_id.is.null,operation_id.not.like.feedback:*),or(provider_id.is.null,provider_id.not.like.identification-test:*))&or=${cursor}&select=id,provider_id,direction,body,status,created_at,message_images(id,position)&order=created_at.desc,id.desc&limit=20`);
      return rows.reverse();
    },
    prepareAI: (operation, body, source) => request(`messages?operation_id=eq.${eq(operation)}`, {
      method: 'PATCH', body: { body, source, status: 'sending' }, prefer: 'return=minimal',
    }),
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
