-- Moves the Supabase scheduler calls (Gmail sweep, reply watchdog, nightly judge) to https://textjules.com.
-- The production origin now lives in one place, public.site_origin(); change only that line if the domain
-- changes again. Run in the Supabase SQL editor after SITE_ORIGIN in Vercel is https://textjules.com, and
-- before jules-gamma.vercel.app redirects (the scheduler does not follow redirects). Re-running is safe.
-- Function bodies are otherwise unchanged from 026, 028 and 038.
begin;
create or replace function public.site_origin()
returns text language sql immutable as $$ select 'https://textjules.com' $$;
revoke all on function public.site_origin() from public,anon,authenticated;

create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from gmail_imports where (data->'job'->>'status' in ('listing','extracting','questions')
     or exists(select 1 from jsonb_each(coalesce(data->'connections','{}'::jsonb)) c where c.value->>'status' in ('awaiting_approval','extracting')))
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now())) then return; end if;
 perform net.http_get(url:=site_origin()||'/api/wishlist?gmail=sweep',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;

create or replace function public.reply_watchdog_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from messages where direction='outbound' and status in ('generating','sending')
   and operation_id like 'ai:%' and created_at<now()-interval '125 seconds' and created_at>now()-interval '1 day'
   and (reply_diagnostics is null or reply_diagnostics->>'stalled_at' is null)) then return; end if;
 perform net.http_get(url:=site_origin()||'/api/imessage?watchdog=replies',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.reply_watchdog_tick() from public,anon,authenticated;

create or replace function public.judge_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 perform net.http_get(url:=site_origin()||'/api/imessage?job=judge',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.judge_tick() from public,anon,authenticated;
commit;
