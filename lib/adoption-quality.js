// Quality section of Admin › Adoption: how often Jules missed what a tester wanted, how often testers
// flagged a reply, and what happened to photo requests. Pure (rows in, numbers out).
// - Misses are model-inferred quality signals on tester messages (db/025, record_quality_signal in lib/ai.js):
//   a kind, which turn missed, and a neutral one-sentence summary written without quotes or names.
// - Flags are developer feedback the tester declared on purpose (#dev or a 👎 tapback, lib/developer-feedback.js).
// - Photo outcomes come from each photo message's reply: the closest match among its products, and whether
//   a wishlist save later came from that photo (wishlist_encounters.source_image_id).
import { weekStart } from './adoption.js';

export const MISS_KINDS = [
  { key: 'wrong_results', label: 'Wrong results', explain: 'Results that didn’t fit what the tester asked for.' },
  { key: 'ignored_request', label: 'Ignored a request', explain: 'Jules skipped something the tester asked for or a constraint they set.' },
  { key: 'misunderstood', label: 'Misunderstood', explain: 'Jules misread the request or what the tester was referring to.' },
  { key: 'missed_available_item', label: 'Found it themselves', explain: 'The tester found the item after Jules didn’t.' },
  { key: 'repeated', label: 'Repeated itself', explain: 'Jules asked for or said again something the tester had already given.' },
  { key: 'reply_quality', label: 'Reply wording', explain: 'Wording or presentation, such as the same opening line again.' },
  { key: 'other', label: 'Other', explain: 'Any other miss.' },
];
export const PHOTO_OUTCOMES = [
  { key: 'identified', label: 'Identified', explain: 'The reply included at least one likely match for the product in the photo.' },
  { key: 'similar', label: 'Similar only', explain: 'The reply offered similar items but no likely match.' },
  { key: 'none', label: 'Nothing found', explain: 'Jules searched for the product in the photo but the reply had no products, or none it could check.' },
  { key: 'not_search', label: 'Not a search', explain: 'The reply didn’t search for products, for example a photo shared for style advice or conversation.' },
  { key: 'unreadable', label: 'Couldn’t read photo', explain: 'The photo couldn’t be downloaded or read.' },
  { key: 'no_reply', label: 'No reply', explain: 'No reply was sent for this photo message.' },
];
const DAY = 86400000, WEEKS = 8, LIST = 50;
const ms = at => Date.parse(at);
const known = new Set(MISS_KINDS.map(k => k.key));
const kindOf = k => known.has(k) ? k : 'other';

// The outcome of one photo message from its reply's products.
export function photoOutcome(photo, reply) {
  if (photo.image_status === 'failed') return 'unreadable';
  if (!reply || reply.status !== 'sent') return 'no_reply';
  // No product list at all means the reply didn't run a product search for this photo.
  if (!Array.isArray(reply.products)) return 'not_search';
  const matches = reply.products.map(p => p?.match);
  if (matches.includes('likely_match') || matches.includes('exact')) return 'identified';
  if (matches.includes('similar')) return 'similar';
  return 'none';
}

export function quality({ conversations = [], results = [], misses = [], flags = [], thumbs = [], photos = [], photoReplies = [], photoSaves = [] }, now = Date.now()) {
  const sender = new Map(conversations.map(c => [c.id, c.sender_id]));
  const thumbIds = new Set(thumbs.map(t => t.id));
  const replyFor = new Map(photoReplies.map(r => [r.operation_id, r]));
  const savedImages = new Map();
  for (const s of photoSaves) savedImages.set(s.source_image_id, (savedImages.get(s.source_image_id) ?? false) || Boolean(s.correction));
  const photoRows = photos.map(p => {
    const images = (p.message_images ?? []).map(i => i.id).filter(id => savedImages.has(id));
    return { ...p, outcome: photoOutcome(p, replyFor.get(`ai:${p.provider_id}`)), saved: images.length > 0, corrected: images.some(id => savedImages.get(id)) };
  });
  const by = (rows, id) => rows.filter(r => r.conversation_id === id);
  const perTester = Object.fromEntries(conversations.map(c => {
    const shots = by(photoRows, c.id), flagged = by(flags, c.id);
    return [c.id, {
      misses: by(misses, c.id).length, flags: flagged.length, thumbs: flagged.filter(f => thumbIds.has(f.id)).length,
      photos: shots.length, photos_identified: shots.filter(p => p.outcome === 'identified').length, photos_saved: shots.filter(p => p.saved).length,
    }];
  }));

  // Weekly: misses by kind against the replies with results that week, plus flags and photo outcomes. Newest first.
  const weeks = [];
  const dated = [...results, ...misses, ...flags, ...photoRows].map(r => r.created_at).filter(at => Number.isFinite(ms(at)));
  if (dated.length) {
    const current = weekStart(now).getTime(), first = Math.min(...dated.map(ms));
    const start = Math.max(weekStart(first).getTime(), current - (WEEKS - 1) * 7 * DAY);
    for (let from = current; from >= start; from -= 7 * DAY) {
      const inWeek = r => ms(r.created_at) >= from && ms(r.created_at) < from + 7 * DAY;
      const missed = misses.filter(inWeek), shots = photoRows.filter(inWeek);
      weeks.push({
        week_of: new Date(from).toISOString().slice(0, 10), current: from === current,
        results: results.filter(inWeek).length, misses: missed.length,
        by_kind: Object.fromEntries(MISS_KINDS.map(k => [k.key, missed.filter(m => kindOf(m.kind) === k.key).length])),
        flags: flags.filter(inWeek).length,
        photos: Object.fromEntries(PHOTO_OUTCOMES.map(o => [o.key, shots.filter(p => p.outcome === o.key).length])),
      });
    }
  }
  const photoSummary = {
    total: photoRows.length, saved: photoRows.filter(p => p.saved).length, corrected: photoRows.filter(p => p.corrected).length,
    outcomes: Object.fromEntries(PHOTO_OUTCOMES.map(o => [o.key, photoRows.filter(p => p.outcome === o.key).length])),
  };
  // The misses to read, newest first, each linking to its message in the person's conversation.
  const list = [...misses].sort((a, b) => ms(b.created_at) - ms(a.created_at)).slice(0, LIST).map(m => ({
    id: m.id, conversation_id: m.conversation_id, sender_id: sender.get(m.conversation_id) ?? null, at: m.created_at,
    kind: kindOf(m.kind), about: m.about ?? null, summary: m.summary ?? null,
  }));
  return {
    kinds: MISS_KINDS, photo_outcomes: PHOTO_OUTCOMES, per_tester: perTester, weeks, photos: photoSummary, misses: list,
    totals: { misses: misses.length, results: results.length, flags: flags.length, thumbs: thumbs.length },
  };
}
