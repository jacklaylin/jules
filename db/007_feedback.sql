-- Run once in the Supabase SQL editor before deploying feedback mode.
-- Reuse private inbound messages; provider_id already deduplicates reports.
alter table public.messages add column developer_feedback text;
