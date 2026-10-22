-- Style report tracking, step 3a (lib/report-events.js, Admin › Style report). Run once in the Supabase SQL editor.
-- Safe to deploy the code first: until this runs, these events are only logged (adoption_event_failed) and the
-- report, sharing and share links work as before.
-- report_card_viewed: the owner reached a card (ref = report id:card, detail = the card), once per card per report.
-- report_card_shared: a card's image went into a Story share or download (detail = the card).
-- report_share_opened may now carry the share method in detail (copy, story, download, share_sheet).
-- No viewer identity, link, message text or phone numbers are stored.
begin;
alter table public.adoption_events drop constraint if exists adoption_events_kind_check;
alter table public.adoption_events add constraint adoption_events_kind_check
  check (kind in ('results_shown','link_click','purchase_intent','reaction','report_viewed','report_shared','report_share_opened','report_card_viewed','report_card_shared'));
alter table public.adoption_events drop constraint if exists adoption_events_detail_check;
alter table public.adoption_events add constraint adoption_events_detail_check
  check (detail is null or detail in ('love','like','laugh','emphasize','question','other','story','download','copy','share_sheet',
    'receipt','gatekeeper','inout','emoji','spectrum','match','read','judges'));
commit;
