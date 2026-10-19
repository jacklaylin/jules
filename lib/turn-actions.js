// What the agent did in a turn, as structured fields only (reply_diagnostics.actions): which tool it
// chose, the interpretation it gave in that tool's arguments (a decision, option numbers, whether a
// search continues the pending request) and whether code ran it. No message text, queries or links.
// lib/turn-outcomes.js reads these to label what a user did after a set of results.
const MAX_ACTIONS = 12;
const indices = value => Array.isArray(value) ? value.filter(Number.isInteger).slice(0, 20) : undefined;
const pick = (value, allowed) => allowed.includes(value) ? value : undefined;
const STATUSES = ['done', 'not_run', 'blocked', 'failed'];

export function actionRecord(call, output) {
  const args = call?.args ?? {}, plan = args.search_plan ?? {};
  const record = { tool: String(call?.name ?? 'unknown').slice(0, 40), status: pick(output?.status, STATUSES) ?? 'unknown' };
  if (call?.name === 'respond_to_options') Object.assign(record, { decision: pick(args.decision, ['interest', 'decline', 'clarify']), option_indices: indices(args.option_indices) });
  if (call?.name === 'save_to_wishlist') Object.assign(record, { option_indices: indices(args.option_indices), consent_context: pick(args.consent_context, ['explicit_request', 'answer_to_offer']) });
  if (call?.name === 'manage_price_alerts') Object.assign(record, { operation: pick(args.operation, ['create', 'status', 'cancel']), option_indices: indices(args.option_indices) });
  if (['find_products', 'ask_shopping_question'].includes(call?.name)) Object.assign(record, {
    continuation: pick(plan.continuation, ['same_request', 'new_request']), mode: pick(plan.mode, ['identify', 'discover', 'alternatives']),
    keep_option_indices: indices(plan.keep_option_indices), exclude_option_indices: indices(plan.exclude_option_indices),
    use_image: args.use_image === true ? true : undefined,
  });
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
}

// The list persisted with the turn, plus what the turn actually saved or changed (the inbox's outcome).
// reply_tool: the tool that ended the turn (conversation_reply, wishlist_status, …).
export function turnActions(actions, outcome = {}, replyTool = null) {
  return {
    actions: actions.slice(0, MAX_ACTIONS), reply_tool: typeof replyTool === 'string' ? replyTool.slice(0, 40) : null,
    saved_now: outcome.saved_now === true, alerts_turned_on: outcome.alerts_turned_on === true, alerts_turned_off: outcome.alerts_turned_off === true,
  };
}
