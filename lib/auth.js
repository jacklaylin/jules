export async function authorize(headers, env, fetcher = fetch) {
  const token = headers.authorization;
  if (!env.ADMIN_EMAIL || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return 503;
  if (typeof token !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(token)) return 401;
  const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: token }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return response.status >= 500 ? 503 : 401;
  const user = await response.json();
  return user.email_confirmed_at && user.email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase() ? 200 : 403;
}
