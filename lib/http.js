export function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(value));
}
export async function readJson(req, max = 24000) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    const error = new Error('Use JSON'); error.status = 415; throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > max) { const error = new Error('Too large'); error.status = 413; throw error; }
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Invalid JSON'); error.status = 400; throw error; }
}
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// How long each Admin read took, once its response goes out: a Server-Timing header (the browser's Network panel
// shows it) and an admin_view_timing log line (Vercel logs), so slow tabs show up by name. No ids or data.
export function timeView(res, view, started, authMs) {
  const end = res.end.bind(res);
  res.end = (...args) => {
    const ms = Math.round(performance.now() - started);
    if (!res.headersSent) res.setHeader('Server-Timing', `auth;dur=${authMs.toFixed(1)}, ${view};dur=${ms}`);
    console.log(JSON.stringify({ event: 'admin_view_timing', view, status: res.statusCode, ms, auth_ms: Math.round(authMs) }));
    return end(...args);
  };
}
