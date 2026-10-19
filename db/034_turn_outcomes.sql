-- Tapbacks for turn outcomes (lib/adoption-events.js recordReaction, lib/turn-outcomes.js). Run once in the
-- Supabase SQL editor. Safe to deploy the code first: until this runs, tapbacks are only logged
-- (reaction_received, then adoption_event_failed) and nothing else is affected.
-- A reaction row holds the reply it points at (ref = that reply's operation id) and a fixed kind in detail
-- (love, like, laugh, emphasize, question, other). No message text or phone numbers.
begin;
alter table public.adoption_events drop constraint if exists adoption_events_kind_check;
alter table public.adoption_events add constraint adoption_events_kind_check
  check (kind in ('results_shown','link_click','purchase_intent','reaction'));
alter table public.adoption_events add column if not exists detail text
  check (detail is null or detail in ('love','like','laugh','emphasize','question','other'));
commit;
