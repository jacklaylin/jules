-- Which link a tap was on. Run once in the Supabase SQL editor, after 051_history_patch.sql.
-- Safe to deploy the code first: until this runs, taps are recorded without it, as before.
-- A link_click row's ref is the reply's operation; link_index is the tapped link's position in that reply's
-- result (resultLinks in lib/adoption-events.js), so the store tapped can be read from the stored result.
-- Needed to count taps per store and, later, to match an affiliate purchase to the product (AFFILIATE-LINKS.md).
begin;
alter table public.adoption_events add column if not exists link_index smallint check (link_index is null or link_index between 0 and 999);
commit;
