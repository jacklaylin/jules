-- Let usage_events record OpenRouter calls (lib/usage.js meters any role set to an openrouter: model).
-- Before this, the provider check allowed only openai and serpapi, so a metered operation with one
-- OpenRouter call lost its whole batch (log: usage_record_failed) and those dollars were missing from Costs.
-- Run in the Supabase SQL editor after 046_onboarding_reminder.sql. Re-running is safe.
begin;
alter table public.usage_events drop constraint if exists usage_events_provider_check;
alter table public.usage_events add constraint usage_events_provider_check
  check (provider in ('openai','serpapi','openrouter'));
commit;
