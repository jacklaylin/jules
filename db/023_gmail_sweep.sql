-- Restarts stalled Gmail imports once a minute (lib/gmail-worker.js sweepGmailImports).
-- Vercel blocks a function that keeps calling itself, and the Hobby plan only allows daily crons,
-- so the Supabase scheduler calls the sweep instead. It calls Vercel only when an import is running
-- and has been quiet for over a minute.
--
-- Before running: store two Vault secrets in this project (SQL Editor, values never in Git):
--   select vault.create_secret('https://YOUR-JULES-DOMAIN', 'jules_site_origin');
--   select vault.create_secret('THE-SAME-VALUE-AS-VERCEL-GMAIL_SWEEP_SECRET', 'jules_gmail_sweep_secret');
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
declare origin text; secret text;
begin
 if not exists(select 1 from gmail_imports where data->'job'->>'status' in ('listing','extracting','questions')
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now())) then return; end if;
 select decrypted_secret into origin from vault.decrypted_secrets where name='jules_site_origin';
 select decrypted_secret into secret from vault.decrypted_secrets where name='jules_gmail_sweep_secret';
 if origin is null or secret is null then raise warning 'gmail sweep: vault secrets missing'; return; end if;
 perform net.http_get(url:=rtrim(origin,'/')||'/api/wishlist?gmail=sweep',headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;
select cron.schedule('jules-gmail-sweep','* * * * *','select public.gmail_sweep_tick()');
commit;
