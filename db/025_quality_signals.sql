-- Run once in the Supabase SQL editor. Safe to deploy the code first: until this runs, quality
-- signals are only logged (event quality_signal) and the save fails quietly.
-- A model-inferred note on an inbound message that Jules missed what the user wanted on an earlier
-- turn: {kind, about, summary, at}. No sender identity; summary is a neutral paraphrase.
alter table public.messages add column quality_signal jsonb;
