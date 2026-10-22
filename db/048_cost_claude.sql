-- Let Admin › Costs record the Claude subscription (service 'claude', a manual monthly fee).
-- Before this, the service check rejected it, so saving a Claude amount failed.
-- Run in the Supabase SQL editor after 047_usage_openrouter.sql. Re-running is safe.
begin;
alter table public.cost_entries drop constraint if exists cost_entries_service_check;
alter table public.cost_entries add constraint cost_entries_service_check
  check (service in ('openai','photon','serpapi','vercel','supabase','github','codex','claude') or service ~ '^job:[a-z_]{1,40}$');
commit;
