-- Suggested wardrobe photos (lib/wardrobe-photos.js, PRD section 29): photos Jules found by searching
-- for a purchase, and the owner's "Is this yours?" answers. Their evidence rows use the new origin
-- wardrobe, which "Delete imported history" removes along with the purchases they describe
-- (purchase_history = true). A Gmail or Shop re-read does not remove them.
-- Run once after 036_cost_caps.sql. Safe to deploy the code first: until this row exists, the
-- wardrobe simply shows no suggestions (the write is rejected and retried on a later visit).
insert into public.evidence_origins(origin,purchase_history) values ('wardrobe',true)
on conflict (origin) do update set purchase_history=excluded.purchase_history;
