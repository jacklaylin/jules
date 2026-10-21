// Which db/ migrations the deployed code needs, checked against the live database. Migrations are run
// by hand in the Supabase SQL editor, so one can be missed: on October 15, 2026 PR #38 shipped without
// db/025_sms_opt_out.sql and every reply failed on a missing column for hours.
// When a migration adds a table, column or function the code uses, add it here.
// Run with: node --env-file=.env.local scripts/schema-check.js

// Tables and columns, each with the migration that adds it. Read with select=...&limit=0 (no rows).
// optional: the code catches the failure and carries on without it, so it is reported but not fatal.
export const COLUMNS = [
  { table: 'conversations', columns: ['id', 'sender_id', 'line'], migration: '001_admin.sql' },
  { table: 'messages', columns: ['id', 'conversation_id', 'provider_id', 'operation_id', 'direction', 'body', 'status', 'source'], migration: '001_admin.sql' },
  { table: 'taste_profiles', columns: ['conversation_id', 'facts', 'version'], migration: '003_memory.sql' },
  { table: 'messages', columns: ['memory_status'], migration: '003_memory.sql' },
  { table: 'message_images', columns: ['id'], migration: '004_images.sql' },
  { table: 'messages', columns: ['image_status'], migration: '004_images.sql' },
  { table: 'messages', columns: ['search_result'], migration: '005_search.sql' },
  { table: 'cost_entries', columns: ['*'], migration: '006_costs.sql' },
  { table: 'messages', columns: ['developer_feedback'], migration: '007_feedback.sql' },
  { table: 'wishlist_members', columns: ['*'], migration: '008_wishlist.sql' },
  { table: 'wishlist_items', columns: ['id', 'conversation_id', 'product_url', 'product'], migration: '008_wishlist.sql' },
  { table: 'wishlist_encounters', columns: ['item_id', 'reply_id', 'product'], migration: '008_wishlist.sql' },
  { table: 'messages', columns: ['wishlist_payload', 'wishlist_saved'], migration: '008_wishlist.sql' },
  { table: 'price_alerts', columns: ['id', 'group_id', 'baselines', 'links', 'active', 'next_check_at'], migration: '009_price_alerts.sql' },
  { table: 'style_sessions', columns: ['conversation_id', 'revision', 'data'], migration: '010_style.sql' },
  { table: 'style_sources', columns: ['id', 'kind'], migration: '010_style.sql' },
  { table: 'public_signups', columns: ['request_id', 'connection_hash'], migration: '014_public_signup.sql' },
  { table: 'messages', columns: ['reply_provider_id'], migration: '015_message_threads.sql' },
  { table: 'wishlist_entry_metadata', columns: ['item_id', 'metadata'], migration: '015_wishlist_metadata.sql' },
  { table: 'onboarding_sessions', columns: ['conversation_id', 'state'], migration: '016_onboarding.sql' },
  { table: 'onboarding_sessions', columns: ['not_now_at'], migration: '044_onboarding_reminder.sql', optional: true },
  { table: 'gmail_imports', columns: ['conversation_id', 'revision', 'data'], migration: '017_gmail_import.sql' },
  { table: 'public_signups', columns: ['profile'], migration: '018_signup_login.sql' },
  { table: 'login_challenges', columns: ['id'], migration: '018_signup_login.sql' },
  { table: 'evidence', columns: ['id', 'kind', 'origin', 'source', 'data'], migration: '019_evidence.sql' },
  { table: 'usage_events', columns: ['id', 'operation', 'feature', 'cost_usd'], migration: '021_usage_events.sql' },
  { table: 'usage_by_day_model', columns: ['day', 'feature', 'provider', 'model', 'units', 'input_tokens', 'cached_tokens', 'output_tokens', 'web_search_calls', 'last_at'], migration: '031_cost_dashboard.sql', optional: true },
  { table: 'evidence_origins', columns: ['origin', 'purchase_history'], migration: '022_history_sources.sql' },
  { table: 'messages', columns: ['quality_signal'], migration: '025_quality_signals.sql', optional: true },
  { table: 'conversations', columns: ['sms_opted_out_at'], migration: '025_sms_opt_out.sql' },
  { table: 'messages', columns: ['sent_at'], migration: '027_reply_sent_at.sql' },
  { table: 'messages', columns: ['reply_diagnostics'], migration: '028_reply_reliability.sql' },
  { table: 'public_signups', columns: ['ref'], migration: '033_signup_ref.sql', optional: true },
  { table: 'public_signups', columns: ['referrer_host', 'utm_source', 'utm_medium', 'utm_campaign'], migration: '041_signup_arrival.sql', optional: true },
  { table: 'adoption_events', columns: ['id', 'kind', 'ref'], migration: '032_adoption_events.sql', optional: true },
  { table: 'adoption_events', columns: ['detail'], migration: '034_turn_outcomes.sql', optional: true },
  { table: 'sourcing_turns', columns: ['operation', 'labels', 'verdict', 'criteria', 'founder_verdict'], migration: '038_nightly_judge.sql', optional: true },
  { table: 'gmail_imports', columns: ['chat_answers'], migration: '028_reply_reliability.sql' },
  { table: 'taste_interviews', columns: ['conversation_id', 'revision', 'state'], migration: '040_taste_interview.sql', optional: true },
  { table: 'store_scans', columns: ['product_key', 'result', 'scanned_at'], migration: '042_store_scans.sql', optional: true },
  { table: 'usage_events', columns: ['job'], migration: '034_recurring_jobs.sql', optional: true },
  { table: 'job_runs', columns: ['job', 'started_at', 'duration_ms', 'status', 'summary'], migration: '034_recurring_jobs.sql', optional: true },
  { table: 'usage_by_day_job', columns: ['day', 'job', 'provider', 'model', 'calls', 'units', 'last_at'], migration: '034_recurring_jobs.sql', optional: true },
  { table: 'job_runs_by_day', columns: ['day', 'job', 'runs', 'failed', 'skipped', 'last_at', 'last_status'], migration: '034_recurring_jobs.sql', optional: true },
  { table: 'usage_by_user_model_day', columns: ['conversation_id', 'day', 'provider', 'model', 'units', 'input_tokens', 'cached_tokens', 'output_tokens', 'web_search_calls', 'cost_usd'], migration: '036_cost_caps.sql', optional: true },
];

// Functions the code calls through /rest/v1/rpc, each with the migration that adds it. Checked by
// name in PostgREST's schema listing; calling them would have side effects.
export const RPCS = [
  { name: 'receive_message', migration: '001_admin.sql' },
  { name: 'reserve_reply', migration: '001_admin.sql' },
  { name: 'claim_ai_reply', migration: '002_ai.sql' },
  { name: 'save_taste_profile', migration: '003_memory.sql' },
  { name: 'save_wishlist_reply', migration: '008_wishlist.sql' },
  { name: 'enable_price_alert', migration: '009_price_alerts.sql' },
  { name: 'claim_price_alerts', migration: '009_price_alerts.sql' },
  { name: 'write_style', migration: '010_style.sql' },
  { name: 'delete_style', migration: '010_style.sql' },
  { name: 'save_confirmed_wishlist_reply', migration: '013_confirmed_wishlist.sql' },
  { name: 'record_public_signup', migration: '014_public_signup.sql' },
  { name: 'advance_onboarding', migration: '016_onboarding.sql' },
  { name: 'begin_gmail_oauth', migration: '017_gmail_import.sql' },
  { name: 'consume_gmail_oauth', migration: '017_gmail_import.sql' },
  { name: 'claim_gmail_import', migration: '017_gmail_import.sql' },
  { name: 'finish_gmail_import', migration: '017_gmail_import.sql' },
  { name: 'begin_phone_login', migration: '018_signup_login.sql' },
  { name: 'attempt_phone_login', migration: '018_signup_login.sql' },
  { name: 'insert_evidence', migration: '019_evidence.sql' },
  { name: 'delete_evidence', migration: '019_evidence.sql' },
  { name: 'ensure_gmail_import', migration: '022_history_sources.sql' },
  { name: 'gmail_sweep_secret', migration: '023_gmail_sweep.sql' },
  { name: 'gmail_profiles_due', migration: '024_gmail_profile_due.sql' },
  { name: 'set_sms_opt_out', migration: '025_sms_opt_out.sql' },
  { name: 'queue_history_answer', migration: '028_reply_reliability.sql' },
  { name: 'clear_history_answers', migration: '028_reply_reliability.sql' },
  { name: 'scheduled_jobs', migration: '034_recurring_jobs.sql', optional: true },
  { name: 'onboarding_reminders_due', migration: '044_onboarding_reminder.sql', optional: true },
];

// Configuration rows the code relies on (a foreign key rejects writes without them), each with the
// migration that inserts it. Read by key; these are lookup rows, never personal data.
export const ROWS = [
  { table: 'evidence_origins', key: 'origin', value: 'chat_screenshot', migration: '029_chat_screenshots.sql' },
  { table: 'evidence_origins', key: 'origin', value: 'interview', migration: '040_taste_interview.sql', optional: true },
  { table: 'evidence_origins', key: 'origin', value: 'wishlist_purchase', migration: '043_wishlist_purchases.sql', optional: true },
];

// Codes PostgREST and Postgres return for a table, column or function that does not exist.
const MISSING_CODES = ['42703', '42P01', 'PGRST204', 'PGRST205'];

// Probes the database. Returns one result per requirement: 'ok', 'missing', 'error' (the check itself
// failed, e.g. a wrong key) or 'unchecked'. Reads no data rows; only the configuration rows in ROWS.
export async function checkSchema(env, fetcher = fetch) {
  const url = env.SUPABASE_URL?.replace(/\/$/, ''), key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('replace-with')) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const get = path => fetcher(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json, application/json' }, signal: AbortSignal.timeout(10000) });
  const results = [];
  for (const need of COLUMNS) {
    const label = `${need.table}${need.columns[0] === '*' ? '' : `.${need.columns.join(', ')}`}`;
    try {
      const response = await get(`${need.table}?select=${need.columns.join(',')}&limit=0`);
      const code = response.ok ? null : (await response.json().catch(() => ({}))).code ?? null;
      results.push({ kind: 'column', label, migration: need.migration, optional: Boolean(need.optional),
        status: response.ok ? 'ok' : MISSING_CODES.includes(code) ? 'missing' : 'error', detail: response.ok ? null : `${response.status}${code ? ' ' + code : ''}` });
    } catch (error) { results.push({ kind: 'column', label, migration: need.migration, optional: Boolean(need.optional), status: 'error', detail: error?.name ?? 'Error' }); }
  }
  // PostgREST lists every function the service role can call under paths "/rpc/<name>".
  let paths = null;
  try { const response = await get(''); if (response.ok) paths = (await response.json()).paths ?? null; } catch { /* reported as unchecked */ }
  for (const need of RPCS) {
    results.push({ kind: 'rpc', label: `rpc ${need.name}()`, migration: need.migration, optional: Boolean(need.optional),
      status: !paths ? 'unchecked' : `/rpc/${need.name}` in paths ? 'ok' : 'missing', detail: null });
  }
  for (const need of ROWS) {
    const label = `${need.table} row ${need.value}`;
    try {
      const response = await get(`${need.table}?select=${need.key}&${need.key}=eq.${encodeURIComponent(need.value)}&limit=1`);
      const rows = response.ok ? await response.json().catch(() => null) : null;
      results.push({ kind: 'row', label, migration: need.migration, optional: Boolean(need.optional), status: !response.ok ? 'error' : Array.isArray(rows) && rows.length ? 'ok' : 'missing', detail: response.ok ? null : String(response.status) });
    } catch (error) { results.push({ kind: 'row', label, migration: need.migration, optional: Boolean(need.optional), status: 'error', detail: error?.name ?? 'Error' }); }
  }
  return results;
}

// Groups results by migration so the output says which files to run, in order.
export function schemaReport(results) {
  const byMigration = (status, optional = false) => [...results.filter(r => r.status === status && Boolean(r.optional) === optional).reduce((map, r) => map.set(r.migration, [...(map.get(r.migration) ?? []), r]), new Map())]
    .sort(([a], [b]) => a.localeCompare(b)).map(([migration, list]) => ({ migration, needs: list.map(r => r.detail ? `${r.label} (${r.detail})` : r.label) }));
  const missing = byMigration('missing'), optional = byMigration('missing', true), errors = [...byMigration('error'), ...byMigration('error', true)], unchecked = results.filter(r => r.status === 'unchecked').length;
  return { ok: !missing.length && !errors.length, checked: results.filter(r => r.status !== 'unchecked').length, missing, optional, errors, unchecked };
}

export function formatSchemaReport(report) {
  const lines = [];
  if (report.missing.length) {
    lines.push('Migrations to run in the Supabase SQL editor, in this order:');
    for (const m of report.missing) lines.push(`  db/${m.migration}  (missing: ${m.needs.join('; ')})`);
  }
  if (report.optional.length) {
    lines.push('Optional migrations not yet run (the code works without them, with less recorded):');
    for (const m of report.optional) lines.push(`  db/${m.migration}  (missing: ${m.needs.join('; ')})`);
  }
  if (report.errors.length) {
    lines.push('Could not check (wrong key or database unreachable?):');
    for (const m of report.errors) lines.push(`  db/${m.migration}: ${m.needs.join('; ')}`);
  }
  if (report.unchecked) lines.push(`${report.unchecked} functions not checked: the database did not return its schema listing.`);
  lines.push(report.ok ? `Schema OK: ${report.checked} checks passed.` : 'Schema check FAILED: run the migrations above before deploying.');
  return lines.join('\n');
}
