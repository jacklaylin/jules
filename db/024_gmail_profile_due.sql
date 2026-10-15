-- 24-hour fallback for the post-import "who you are" text (lib/receipt-notifications.js).
-- Due when an import finished in the last 14 days, its completion text was sent, no profile text
-- has been sent for it, and the last question text (or the completion, if none) is over 24 hours old.
-- Timing comes from the message ledger; the sweep (023) also calls Vercel when one is due.
begin;
create or replace function public.gmail_profiles_due()
returns table(conversation_id uuid) language sql stable security definer set search_path=public as $$
 select g.conversation_id from gmail_imports g
 where g.data->'job'->>'status'='ready'
   and (g.data->'job'->>'completed_at')::timestamptz>now()-interval '14 days'
   and exists(select 1 from messages m where m.operation_id='gmail:'||g.conversation_id||':ready:'||(g.data->'job'->>'started_at') and m.status='sent')
   and not exists(select 1 from messages m where m.operation_id='gmail:'||g.conversation_id||':profile:'||(g.data->'job'->>'started_at'))
   and coalesce((select max(m.created_at) from messages m where m.conversation_id=g.conversation_id and m.operation_id like 'gmail:'||g.conversation_id||':question:%'),
     (g.data->'job'->>'completed_at')::timestamptz)<now()-interval '24 hours'
 limit 20;
$$;
revoke all on function public.gmail_profiles_due() from public,anon,authenticated;
grant execute on function public.gmail_profiles_due() to service_role;
create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from gmail_imports where data->'job'->>'status' in ('listing','extracting','questions')
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now()))
   and not exists(select 1 from gmail_profiles_due()) then return; end if;
 perform net.http_get(url:='https://jules-gamma.vercel.app/api/wishlist?gmail=sweep',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;
commit;
