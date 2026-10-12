// Message IDs and reply links are technical references. The model interprets intent.
export function replyProviderId(message) {
  const id = message?.content?.type === 'reply' ? message.content.target?.id : null;
  return typeof id === 'string' && id.length > 0 && id.length <= 500 ? id : null;
}

export function imageReferences(messages) {
  const current = messages.findLast(m => m.direction === 'inbound');
  if (current?.message_images?.length) return [{ id: current.id, provider_id: current.provider_id,
    caption: current.body, message_images: current.message_images, explicit_reply: Boolean(current.reply_context) }];
  if (current?.reply_context?.resolved === false) return [];
  const referenced = current?.reply_context?.messages ?? [];
  const candidates = current?.reply_context ? referenced : messages;
  return candidates.filter(m => m.direction === 'inbound' && m.message_images?.length)
    .map(m => ({ id: m.id, provider_id: m.provider_id, caption: m.body,
      message_images: m.message_images, explicit_reply: Boolean(current?.reply_context) }));
}

export function referencedImage(messages, requestedId) {
  const references = imageReferences(messages);
  if (requestedId) return references.find(m => m.id === requestedId) ?? null;
  return references.at(-1) ?? null;
}
