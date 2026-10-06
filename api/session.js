import { json, readJson } from '../lib/http.js';

export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Use POST.' }); }
  try {
    const env = process.env;
    if (!env.ADMIN_EMAIL || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SITE_ORIGIN) return json(res, 503, { error: 'Admin sign-in is not configured yet.' });
    const input = await readJson(req, 2048);
    // Avoid creating accounts or sending email to arbitrary visitors.
    if (typeof input?.email !== 'string' || input.email.trim().toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return json(res, 403, { error: 'Use the owner email address.' });
    const redirect = encodeURIComponent(`${env.SITE_ORIGIN.replace(/\/$/, '')}/admin`);
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/otp?redirect_to=${redirect}`, {
      method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.ADMIN_EMAIL, create_user: true }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return json(res, response.status === 429 ? 429 : 503, { error: 'Could not send the sign-in link. Wait a minute and try again.' });
    return json(res, 200, { ok: true });
  } catch { return json(res, 503, { error: 'Could not send the sign-in link.' }); }
}
