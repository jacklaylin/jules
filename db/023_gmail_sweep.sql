-- Restarts stalled Gmail imports once a minute (lib/gmail-worker.js sweepGmailImports).
-- Vercel blocks a function that keeps calling itself, and the Hobby plan only allows daily crons,
-- so the Supabase scheduler calls the sweep instead. It calls Vercel only when an import is running
-- and has been quiet for over a minute.
--
-- The shared secret is generated here, inside Supabase Vault; the Vercel server reads it with its
-- service-role database access. Nobody copies it. Re-running this file keeps the existing secret.
-- Change the site origin below only if the production domain changes.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pgcrypto;
do $$ begin
 if not exists(select 1 from vault.secrets where name='jules_gmail_sweep_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'jules_gmail_sweep_secret');
 end if;
end $$;
create or replace function public.gmail_sweep_secret()
returns text language sql stable security definer set search_path=public as $$
 select decrypted_secret from vault.decrypted_secrets where name='jules_gmail_sweep_secret';
$$;
revoke all on function public.gmail_sweep_secret() from public,anon,authenticated;
grant execute on function public.gmail_sweep_secret() to service_role;
create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from gmail_imports where data->'job'->>'status' in ('listing','extracting','questions')
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now())) then return; end if;
 perform net.http_get(url:='https://jules-gamma.vercel.app/api/wishlist?gmail=sweep',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;
select cron.unschedule(jobid) from cron.job where jobname='jules-gmail-sweep';
select cron.schedule('jules-gmail-sweep','* * * * *','select public.gmail_sweep_tick()');
commit;
