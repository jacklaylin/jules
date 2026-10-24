-- Jules+ fake-door test (lib/plus-test.js, /plus; PLUS-TEST.md). Run once in the Supabase SQL editor.
-- Safe to deploy the code first: until this runs, these events are only logged (plus_event_failed) and the page works.
-- plus_viewed: someone opened /plus (ref = the monthly price shown, at most once a day per person or browser).
-- plus_interest: they tapped Get Jules+ (ref = the price shown). Nothing is charged or changed on their account.
-- conversation_id is the signed-in tester, or null for a signed-out visitor. No identity, text or phone numbers are stored.
begin;
alter table public.adoption_events drop constraint if exists adoption_events_kind_check;
alter table public.adoption_events add constraint adoption_events_kind_check
  check (kind in ('results_shown','link_click','purchase_intent','reaction','report_viewed','report_shared','report_share_opened','report_card_viewed','report_card_shared',
    'plus_viewed','plus_interest'));
commit;
