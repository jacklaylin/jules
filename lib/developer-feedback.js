// Developer feedback is declared by the tester, never inferred: a message that starts with the
// #dev marker, or a 👎 tapback on a message. Both are technical formats the tester types or taps on
// purpose (like a slash command), so code reads them before the agent runs. Founder exception to the
// no-keyword-routing rule, recorded in AGENTS.md. Quality signals the model infers live in ai.js.
export const DEV_MARKER = '#dev';
export const FLAG_EMOJI = '👎';
export const FEEDBACK_ACK = 'Sent to the developer. Thanks.';
const MARKER = /^\s*#dev(?![\p{L}\p{N}_])[\s:,.;-]*/iu;
// Skin tones and the emoji presentation selector do not change which tapback was sent.
const bareEmoji = emoji => typeof emoji === 'string' ? emoji.replace(/[\u{1F3FB}-\u{1F3FF}️]/gu, '') : '';

export const isFlagReaction = content => content?.type === 'reaction' && bareEmoji(content.emoji) === FLAG_EMOJI;
export function reactionTargetId(message) {
  const id = message?.content?.type === 'reaction' ? message.content.target?.id : null;
  return typeof id === 'string' && id.length > 0 && id.length <= 500 ? id : null;
}

// The report saved for the developer, or null when the message is not developer feedback.
// A threaded reply or a reaction points at the message being reported; the note may be empty.
export function developerReport(message) {
  if (isFlagReaction(message?.content)) return { channel: 'reaction', note: 'Flagged this reply with 👎.' };
  const text = message?.content?.text;
  const marker = typeof text === 'string' ? text.match(MARKER) : null;
  if (!marker) return null;
  const note = text.slice(marker[0].length).trim();
  return { channel: 'marker', note: note || 'Flagged with #dev (no note).' };
}
