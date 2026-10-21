-- Restores the 24-hour "who you are" profile-text fallback in the once-a-minute sweep.
-- 024 made gmail_sweep_tick() call Vercel when gmail_profiles_due() has rows; 026 and 039 redefined it
-- without that condition, so the fallback only ran when an import happened to be stuck at the same time.
-- Run in the Supabase SQL editor after 039_site_origin.sql. Re-running is safe.
-- Otherwise unchanged from 039. Every redefinition of gmail_sweep_tick() must keep each wake-up
-- condition of the one before it (tests/gmail-sweep-tick.test.js checks this).
begin;
create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from gmail_imports where (data->'job'->>'status' in ('listing','extracting','questions')
     or exists(select 1 from jsonb_each(coalesce(data->'connections','{}'::jsonb)) c where c.value->>'status' in ('awaiting_approval','extracting')))
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now()))
   and not exists(select 1 from gmail_profiles_due()) then return; end if;
 perform net.http_get(url:=site_origin()||'/api/wishlist?gmail=sweep',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;
commit;
