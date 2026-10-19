// Admin › Scorecard data (public/scorecard-view.js computes the figures). Stored sourcing turns (db/038,
// refreshed nightly by lib/judge.js) for eight weeks, with the last three days computed fresh from the
// message log so today's searches show before the judge runs. No message text is read or returned.
import { loadTurnOutcomes } from './turn-outcomes.js';
import { redact } from './feedback-triage.js';
import { worstTurns } from '../public/scorecard-view.js';

const DAY = 86400000, FRESH_DAYS = 3, WEEKS = 8;

export async function loadScorecard(store, { now = Date.now() } = {}) {
  const since = new Date(now - WEEKS * 7 * DAY).toISOString();
  const [stored, fresh, conversations] = await Promise.all([
    store.sourcingTurns(since).then(rows => ({ rows, available: true })).catch(error => { if ([400, 404].includes(error.database_status)) return { rows: [], available: false }; throw error; }),
    loadTurnOutcomes(store, { days: FRESH_DAYS, now }),
    store.list(),
  ]);
  // Fresh outcome fields win (later follow-ups add labels); judge fields come from the stored row.
  const byOperation = new Map(stored.rows.map(r => [r.operation, r]));
  for (const t of fresh.turns) byOperation.set(t.operation, { ...byOperation.get(t.operation), ...t });
  const turns = [...byOperation.values()].map(t => ({ ...t, cost_usd: Number(t.cost_usd ?? 0) })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Message ids for the worst turns, so each links to its place in the conversation.
  const worst = worstTurns(turns);
  const ids = worst.length && store.inboundIds ? await store.inboundIds(worst.map(t => t.operation.slice(t.operation.indexOf(':') + 1))).catch(() => new Map()) : new Map();
  for (const t of turns) { const id = ids.get(t.operation.slice(t.operation.indexOf(':') + 1)); if (id) t.message_id = id; }
  return {
    generated_at: new Date(now).toISOString(), judge_available: stored.available, turns,
    senders: Object.fromEntries(conversations.map(c => [c.id, c.sender_id])),
  };
}

// A draft replay case from a judged turn, for REPLAY-SUITE.md: the user's message and the turns before it,
// with emails and phone numbers masked. It is a starting point to anonymise and edit, never committed as is.
export async function replayDraft(store, turn) {
  const inbound = turn.operation.slice(turn.operation.indexOf(':') + 1);
  const context = await store.feedbackContext(turn.conversation_id, turn.at, 8, 0);
  const at = context.findIndex(m => m.direction === 'inbound' && m.provider_id === inbound);
  if (at < 0) return null;
  const history = context.slice(Math.max(0, at - 6), at).filter(m => m.status === 'sent' || m.direction === 'inbound').filter(m => !m.developer_feedback)
    .map(m => ({ direction: m.direction, status: m.direction === 'outbound' ? 'sent' : 'received', body: redact(String(m.body ?? '')).slice(0, 1500) }));
  return {
    id: `real-${String(turn.at).slice(0, 10)}-${inbound.slice(-6)}`,
    name: `Real turn · ${(turn.failed ?? []).join(', ') || turn.headline || 'review'}`,
    message: redact(String(context[at].body ?? '')),
    history,
    judge: Object.fromEntries((turn.failed ?? []).map(k => [k, turn.criteria?.[k]?.reason ?? ''])),
    todo: 'Anonymise anything personal, add brand/model or expected tools, and pair it with a reworded twin before adding it to lib/replay.js or lib/agent-eval-cases.js.',
  };
}
