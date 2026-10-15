-- 026: the once-a-minute restart (023) also covers connected sources (Shop): one still reading, or waiting
-- for the person to approve it, now runs in the background like Gmail (lib/gmail-worker.js).
-- Re-running this file is safe.
begin;
create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from gmail_imports where (data->'job'->>'status' in ('listing','extracting','questions')
     or exists(select 1 from jsonb_each(coalesce(data->'connections','{}'::jsonb)) c where c.value->>'status' in ('awaiting_approval','extracting')))
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now())) then return; end if;
 perform net.http_get(url:='https://jules-gamma.vercel.app/api/wishlist?gmail=sweep',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;
commit;
