-- One onboarding reminder, about a day after the welcome (lib/onboarding.js sendOnboardingReminders).
-- Run in the Supabase SQL editor after 045_gmail_profile_sweep.sql. Re-running is safe.
-- 1. onboarding_sessions.not_now_at: when the person last tapped "Not now, go to Messages" on /onboarding.
--    It records the tap only; their onboarding state does not change.
-- 2. onboarding_reminders_due(): people whose welcome was sent 24 to 48 hours ago, still offered or
--    accepted, with nothing connected (no Gmail sign-in, no import, no Shop connection), not opted out,
--    and no reminder in the message ledger yet. The 48-hour edge means turning the reminder on later
--    never texts people welcomed long ago, and a switched-off reminder stops waking Vercel after a day.
-- 3. gmail_sweep_tick(): the existing once-a-minute sweep also calls Vercel when a reminder is due.
--    Otherwise unchanged from 045 (keeps its gmail_profiles_due() wake-up; tests/gmail-sweep-tick.test.js).
begin;
alter table public.onboarding_sessions add column if not exists not_now_at timestamptz;

drop function if exists public.onboarding_reminders_due();
create function public.onboarding_reminders_due()
returns table(conversation_id uuid, not_now_at timestamptz, welcome_sent_at timestamptz) language sql stable security definer set search_path=public as $$
 select s.conversation_id,s.not_now_at,coalesce(w.sent_at,w.created_at) from onboarding_sessions s
 join conversations c on c.id=s.conversation_id
 join messages w on w.operation_id='onboarding:'||s.conversation_id||':welcome' and w.status='sent'
 where s.state in ('offered','accepted')
   and c.sms_opted_out_at is null
   and coalesce(w.sent_at,w.created_at) between now()-interval '48 hours' and now()-interval '24 hours'
   and not exists(select 1 from messages r where r.operation_id='onboarding:'||s.conversation_id||':reminder')
   and not exists(select 1 from gmail_imports g where g.conversation_id=s.conversation_id and (g.token_ciphertext is not null or g.data ? 'job'
     or exists(select 1 from jsonb_each(coalesce(g.data->'connections','{}'::jsonb)) x
       where x.value->>'credential' is not null or coalesce(x.value->>'status','not_connected')<>'not_connected')))
 limit 20;
$$;
revoke all on function public.onboarding_reminders_due() from public,anon,authenticated;
grant execute on function public.onboarding_reminders_due() to service_role;

create or replace function public.gmail_sweep_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from gmail_imports where (data->'job'->>'status' in ('listing','extracting','questions')
     or exists(select 1 from jsonb_each(coalesce(data->'connections','{}'::jsonb)) c where c.value->>'status' in ('awaiting_approval','extracting')))
   and updated_at<now()-interval '1 minute' and (lease_until is null or lease_until<now()))
   and not exists(select 1 from gmail_profiles_due())
   and not exists(select 1 from onboarding_reminders_due()) then return; end if;
 perform net.http_get(url:=site_origin()||'/api/wishlist?gmail=sweep',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.gmail_sweep_tick() from public,anon,authenticated;
commit;
