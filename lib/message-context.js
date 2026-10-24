// Message IDs and reply links are technical references. The model interprets intent.
export function replyProviderId(message) {
  const id = message?.content?.type === 'reply' ? message.content.target?.id : null;
  return typeof id === 'string' && id.length > 0 && id.length <= 500 ? id : null;
}

// A tapback names the part of a message it is on ("p:0/<id>", the part's index then the message id);
// a threaded reply names the message itself. Either way the message is the id after the prefix.
export const sentMessageId = id => typeof id === 'string' ? id.replace(/^p:\d+\//, '') : id;

// The user message a reply threads under follows what the turn did, never whether the newest
// message had a photo. answered: message IDs whose request the agent says it answered; used: the
// photo messages its tools read. A reply in the tester's own thread stays there. Otherwise it
// threads under the one message it answers (or, for a newest request about an earlier photo, under
// that photo), and is not threaded when that is unclear. Unknown IDs are ignored.
export function threadTarget(message, messages, { answered = [], used = [] } = {}) {
  if (replyProviderId(message)) return message;
  const inbound = messages.filter(m => m.direction === 'inbound');
  const current = inbound.find(m => m.provider_id === message.id) ?? { provider_id: message.id };
  const resolve = ids => [...new Set(ids.filter(id => typeof id === 'string' && id)
    .map(id => id === message.id || id === current.id ? current : inbound.find(m => m.id === id)).filter(Boolean))];
  const asked = resolve(answered), read = resolve(used);
  // The agent named messages, but none of them exist here: which one it answers is unclear.
  if (answered.length && !asked.length) return null;
  const request = asked.length ? asked : [current];
  if (request.length !== 1) return null;
  const others = read.filter(m => m !== request[0]);
  const link = m => m.provider_id ? { id: m.provider_id, content: { type: m.message_images?.length ? 'attachment' : 'text' } } : null;
  if (others.length > 1) return null;
  if (others.length === 1) return request[0] === current ? link(others[0]) : null;
  if (request[0] === current) return message.attachments?.length ? message : null;
  return link(request[0]);
}

export function imageReferences(messages) {
  const current = messages.findLast(m => m.direction === 'inbound');
  if (current?.message_images?.length) return [{ id: current.id, provider_id: current.provider_id,
    caption: current.body, message_images: current.message_images, explicit_reply: Boolean(current.reply_context) }];
  if (current?.reply_context?.resolved === false) return [];
  const photos = list => list.filter(m => m.direction === 'inbound' && m.message_images?.length);
  // A thread with a photo names it. A thread without one (a reply under Jules's note about a brand)
  // falls back to the conversation's photos, as an unthreaded message does (October 22: "what did you
  // find?" threaded under a brand note lost the jacket photo two messages up, and Jules said it was no
  // longer available).
  const threaded = current?.reply_context ? photos(current.reply_context.messages ?? []) : [];
  return (threaded.length ? threaded : photos(messages))
    .map(m => ({ id: m.id, provider_id: m.provider_id, caption: m.body,
      message_images: m.message_images, explicit_reply: threaded.length > 0 }));
}

export function referencedImage(messages, requestedId) {
  const references = imageReferences(messages);
  if (requestedId) return references.find(m => m.id === requestedId) ?? null;
  return references.at(-1) ?? null;
}

// The product a card, caption or photo of a sent answer showed, as its number in the answer's results
// (the numbering the agent and the consent check use). A part sent since October 23 names the product's
// page. An older part's option counted the answer's cards, which are its linked products in result
// order, so an option kept from earlier and not linked again shifted every number after it.
export function cardOption(answer, part) {
  const products = answer?.search_result?.products ?? [], urls = p => [p?.url, ...(p?.merchant_options ?? []).map(m => m.url)].filter(Boolean);
  let index = part?.url ? products.findIndex(p => urls(p).includes(part.url)) : -1;
  if (!part?.url && Number.isInteger(part?.option)) {
    const sent = new Set((String(answer?.body ?? '').match(/https:\/\/\S+/g) ?? []).map(t => t.replace(/[).,!?;:’”"']+$/, '')));
    const linked = products.flatMap((p, i) => urls(p).some(u => sent.has(u)) ? [i] : []);
    index = linked[part.option - 1] ?? -1;
  }
  return index >= 0 ? { option: index + 1, url: products[index].url } : { option: part?.option ?? null };
}
