-- Order summaries from order-list screenshots sent in chat (lib/order-screenshots.js): one evidence row
-- per order or return row (store, order number, date, status, total as shown). They count orders,
-- returns and order totals per store; they are not items. Adds the evidence kind 'order_summary'.
-- Run once after 029_chat_screenshots.sql and BEFORE deploying the code that uses it: without it every
-- screenshot that shows order rows fails to save, and Jules says it couldn't save the screenshot.
begin;
alter table public.evidence drop constraint evidence_kind_check;
alter table public.evidence add constraint evidence_kind_check check (kind in ('purchase_event','correction','photo_observation','user_note','chat_statement','operator_entry','confirmation','wishlist_event','legacy_record','order_summary'));
commit;
