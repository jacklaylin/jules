import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { COLUMNS, RPCS, checkSchema, schemaReport, formatSchemaReport } from '../lib/schema-check.js';

const env = { SUPABASE_URL: 'https://fake.supabase.invalid/', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' };
const respond = (status, value) => ({ ok: status < 400, status, json: async () => value });
// A fake PostgREST: tables answer unless a column is in `missingColumns`; the root lists functions.
function database({ missingColumns = [], missingRpcs = [], listing = true, status = null } = {}) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, headers: init.headers });
    const path = url.replace('https://fake.supabase.invalid/rest/v1/', '');
    if (status) return respond(status, { code: 'PGRST301' });
    if (path === '') return listing ? respond(200, { paths: Object.fromEntries(RPCS.filter(r => !missingRpcs.includes(r.name)).map(r => [`/rpc/${r.name}`, {}])) }) : respond(404, {});
    const [table, query] = path.split('?select=');
    const columns = query.split('&')[0].split(',');
    return columns.some(c => missingColumns.includes(`${table}.${c}`)) ? respond(400, { code: '42703', message: 'column does not exist' }) : respond(200, []);
  };
  return { fetcher, requests };
}

test('every listed migration exists in db/', () => {
  const files = new Set(readdirSync(new URL('../db/', import.meta.url)));
  for (const need of [...COLUMNS, ...RPCS]) assert.ok(files.has(need.migration), `${need.migration} is in db/`);
});

test('a complete schema passes without reading any rows', async () => {
  const { fetcher, requests } = database();
  const report = schemaReport(await checkSchema(env, fetcher));
  assert.equal(report.ok, true); assert.equal(report.checked, COLUMNS.length + RPCS.length);
  assert.ok(requests.filter(r => r.url.includes('?select=')).every(r => r.url.endsWith('&limit=0')));
  assert.equal(requests[0].headers.apikey, 'fake-service-key');
  assert.match(formatSchemaReport(report), /Schema OK/);
});

test('the October 15 case names db/025_sms_opt_out.sql, and missing migrations are listed in order', async () => {
  const { fetcher } = database({ missingColumns: ['conversations.sms_opted_out_at', 'messages.reply_diagnostics'], missingRpcs: ['set_sms_opt_out'] });
  const report = schemaReport(await checkSchema(env, fetcher));
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing.map(m => m.migration), ['025_sms_opt_out.sql', '028_reply_reliability.sql']);
  assert.deepEqual(report.missing[0].needs, ['conversations.sms_opted_out_at (400 42703)', 'rpc set_sms_opt_out()']);
  const text = formatSchemaReport(report);
  assert.match(text, /db\/025_sms_opt_out\.sql[\s\S]*db\/028_reply_reliability\.sql/);
  assert.match(text, /FAILED/);
});

test('an optional migration is reported without failing the check', async () => {
  const report = schemaReport(await checkSchema(env, database({ missingColumns: ['messages.quality_signal'] }).fetcher));
  assert.equal(report.ok, true); assert.deepEqual(report.missing, []);
  assert.deepEqual(report.optional.map(m => m.migration), ['025_quality_signals.sql']);
  assert.match(formatSchemaReport(report), /Optional migrations[\s\S]*db\/025_quality_signals\.sql[\s\S]*Schema OK/);
});

test('a wrong key is reported as a failed check, not as missing migrations', async () => {
  const report = schemaReport(await checkSchema(env, database({ status: 401 }).fetcher));
  assert.equal(report.ok, false); assert.deepEqual(report.missing, []);
  assert.ok(report.errors.length > 0); assert.match(formatSchemaReport(report), /Could not check/);
  await assert.rejects(checkSchema({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'replace-with-key' }), /required/);
});

test('without a function listing, columns are still checked and functions are reported as unchecked', async () => {
  const report = schemaReport(await checkSchema(env, database({ listing: false }).fetcher));
  assert.equal(report.ok, true); assert.equal(report.unchecked, RPCS.length);
  assert.match(formatSchemaReport(report), /functions not checked/);
});
