-- Style report engagement (lib/report-events.js, Admin › Adoption). Run once in the Supabase SQL editor.
-- Safe to deploy the code first: until this runs, these events are only logged (adoption_event_failed)
-- and the report, sharing and share links work as before.
-- report_viewed: the person opened their own report (ref = report id, at most once a day per report).
-- report_shared: they shared, copied or downloaded it (detail = the channel).
-- report_share_opened: someone opened their share link (credited to the person who shared it).
-- No viewer identity, link, message text or phone numbers are stored.
begin;
alter table public.adoption_events drop constraint if exists adoption_events_kind_check;
alter table public.adoption_events add constraint adoption_events_kind_check
  check (kind in ('results_shown','link_click','purchase_intent','reaction','report_viewed','report_shared','report_share_opened'));
alter table public.adoption_events drop constraint if exists adoption_events_detail_check;
alter table public.adoption_events add constraint adoption_events_detail_check
  check (detail is null or detail in ('love','like','laugh','emphasize','question','other','story','download','copy','share_sheet'));
commit;
