import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { GREETING } from './imessage.js';
import { remember } from './memory.js';
import { generateReply } from './ai.js';
import { beginProgress, fetchImages, sendGreeting } from './photon.js';

export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting, generate = generateReply, updateMemory = remember, loadImages = fetchImages, progress = beginProgress } = {}) {
  const conversationId = await store.receive(delivery);
  if (env.AI_ENABLED === 'true') {
    const operation = `ai:${delivery.message.id}`;
    if (!await store.claimAI(conversationId, operation)) return 'imessage_ai_duplicate';
    let stopProgress = async () => {};
    try { stopProgress = await progress(delivery, env); } catch { /* Optional feedback must not block the answer. */ }
    try {
    let body, source = 'ai', products = [], replyTarget = delivery.message.attachments?.length ? delivery.message : null;
    try {
      let images = [];
      if (delivery.message.attachments?.length) {
        try {
          images = await loadImages(delivery, env);
          console.log(JSON.stringify({event:'image_downloaded',count:images.length}));
          await store.saveImages(delivery.message.id, images);
          console.log(JSON.stringify({event:'image_saved',count:images.length}));
        } catch {
          await store.imageStatus(delivery.message.id, 'failed');
          throw new Error('Image could not be read');
        }
      }
      const context = await store.context(conversationId, delivery.message.id);
      let memory = { enabled: env.MEMORY_ENABLED === 'true', saved: false, facts: [] };
      if (memory.enabled && !images.length) {
        try {
          const current = context.filter(m => m.direction === 'inbound').at(-1);
          if (!current) throw new Error('Missing inbound');
          const profile = await updateMemory(store, conversationId, [current], env);
          memory = { enabled: true, saved: true, facts: profile.facts };
          await store.memoryStatus(delivery.message.id, 'saved');
        } catch {
          await store.memoryStatus(delivery.message.id, 'failed');
          memory.facts = (await store.profile(conversationId)).facts;
          console.log(JSON.stringify({ event: 'memory_update_failed', message_id: delivery.message.id }));
        }
      }
      if (images.length && memory.enabled) memory.facts = (await store.profile(conversationId)).facts;
      body = await generate(context, env, fetch, { ...memory, images,
        loadImages: async () => {
          const reference=context.findLast(m=>m.direction==='inbound'&&m.message_images?.length);
          if (!reference) return [];
          const loaded = await store.imagesForMessage(reference.id);
          if (loaded.length && reference.provider_id) replyTarget = { id: reference.provider_id, content: { type: 'attachment' } };
          return loaded;
        },
        recordSearch: async result => {
          await store.searchResult(operation,result);
          products = result.identification_policy === 'visual_comparison' ? result.products ?? [] : [];
        },
      });
    }
    catch {
      source = 'ai_fallback';
      products = [];
      body = delivery.message.attachments?.length ? 'I couldn’t read that image. Please try a JPG, PNG, WebP, or HEIC image under 3 MB (up to three at a time).' : 'I couldn’t prepare a reply just now. Could you try again?';
    }
    await store.prepareAI(operation, body, source);
    try { await send(delivery, body, env, { replyTarget, products }); }
    catch { await store.finish(operation, 'uncertain'); return 'imessage_ai_reply_uncertain'; }
    await store.finish(operation, 'sent');
    return source === 'ai' ? 'imessage_ai_reply_sent' : 'imessage_ai_fallback_sent';
    } finally { try { await stopProgress(); } catch { /* Best effort cleanup. */ } }
  }
  if (delivery.message.content.text.trim().toLowerCase() !== 'hello') return 'imessage_received';
  const conversation = { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone };
  const result = await deliverReply({ store, send, conversation, operation: `greeting:${delivery.message.id}`, body: GREETING, source: 'greeting', env });
  return result.status === 'sent' ? 'imessage_reply_sent' : 'imessage_reply_uncertain';
}
