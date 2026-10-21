-- One onboarding re-offer per person, inside a chat reply (lib/onboarding.js onboardingAction 'reoffer').
-- Run in the Supabase SQL editor after 046_onboarding_reminder.sql. Re-running is safe.
-- onboarding_sessions.reoffered_at: when Jules re-offered the connection link in a reply, after the person
-- skipped the welcome, shopped, and showed interest (a link click, a pick). Set once, only while offered;
-- it never changes their onboarding state. Until this runs, Jules simply never re-offers.
begin;
alter table public.onboarding_sessions add column if not exists reoffered_at timestamptz;
commit;
