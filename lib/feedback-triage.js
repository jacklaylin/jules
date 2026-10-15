// Builds private triage packets from developer feedback the tester declared (#dev or a 👎 tapback,
// lib/developer-feedback.js) and from quality signals the agent inferred (record_quality_signal).
// A packet is the report, the message it came from, nearby turns and their persisted diagnostics. Sender identity is never read; contact details in text are masked as a technical
// format (this is redaction, not interpretation of what the user meant).
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d ().-]{7,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const redact = text => typeof text === 'string' ? text.replace(EMAIL, '[email]').replace(PHONE, match => ISO_DATE.test(match) ? match : '[phone]') : text;

// Search results can be large; keep the fields that explain what happened, not every candidate.
// Scalars (identification_policy, intent_action, user_confirmed…) are kept; arrays become counts;
// pending-state stage and recorded diagnostics are kept, truncated.
const clip = (value, size = 1500) => { const text = JSON.stringify(value); return text.length > size ? text.slice(0, size) + '…' : value; };
export function diagnostics(result) {
  if (!result || typeof result !== 'object') return null;
  const keep = {};
  for (const [key, value] of Object.entries(result)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) keep[key] = typeof value === 'string' ? redact(value).slice(0, 300) : value;
    else if (Array.isArray(value)) keep[`${key}_count`] = value.length;
    else if (key.endsWith('_diagnostics')) keep[key] = clip(value);
    else if (typeof value.stage === 'string') {
      keep[`${key}_stage`] = value.stage;
      if (value.search_plan) keep[`${key}_search_plan`] = clip(value.search_plan, 600);
    }
  }
  if (Array.isArray(result.products)) keep.products = result.products.slice(0, 5).map(p => ({ name: p?.name, url: p?.url, verified: p?.verified,
    brand: p?.listing_check?.product_brand ?? p?.brand, availability: p?.listing_check?.availability ?? null }));
  return keep;
}

const turn = (message, target) => ({
  id: message.id, direction: message.direction,
  ...(target && message.provider_id === target ? { is_reported_message: true } : {}), at: message.created_at, status: message.status, source: message.source,
  text: redact(message.body ?? ''),
  ...(message.developer_feedback ? { is_feedback_report: true } : {}),
  ...(message.message_images?.length ? { images: message.message_images.length, image_status: message.image_status } : {}),
  ...(message.memory_status ? { memory_status: message.memory_status } : {}),
  ...(message.search_result ? { diagnostics: diagnostics(message.search_result) } : {}),
});

// Quality signals need db/022_quality_signals.sql; until it runs, packets say they are unavailable.
async function qualityReports(store, since, limit) {
  if (!store.qualitySince) return { rows: [], available: false };
  try { return { rows: await store.qualitySince(since, limit), available: true }; }
  catch { return { rows: [], available: false }; }
}

export async function triagePackets(store, { since = null, limit = 50, latest = null } = {}) {
  const developer = (await store.feedbackSince(since, latest ? 1000 : limit)).map(r => ({ ...r, kind: 'developer_feedback' }));
  const quality = await qualityReports(store, since, latest ? 1000 : limit);
  let reports = [...developer, ...quality.rows.map(r => ({ ...r, kind: 'quality_signal' }))]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(0, latest ? undefined : limit);
  if (latest) reports = reports.slice(-latest);
  const packets = [];
  for (const report of reports) {
    const context = await store.feedbackContext(report.conversation_id, report.created_at);
    packets.push({
      feedback_id: report.id, kind: report.kind, conversation_id: report.conversation_id, at: report.created_at,
      ...(report.kind === 'quality_signal'
        ? { signal: { kind: report.quality_signal?.kind, about: report.quality_signal?.about, summary: redact(report.quality_signal?.summary ?? '') } }
        : { report: redact(report.developer_feedback) }),
      original_message: redact(report.body ?? ''),
      replying_to_earlier_message: Boolean(report.reply_provider_id),
      context: context.map(message => turn(message, report.reply_provider_id)),
    });
  }
  return { generated_at: new Date().toISOString(), since, count: packets.length,
    cursor: packets.at(-1)?.at ?? since, quality_signals_available: quality.available, packets };
}
