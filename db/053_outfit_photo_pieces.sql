-- Outfit photos into the wardrobe (PRD section 30, lib/outfit-closet.js): pieces read from an outfit photo
-- the person texted join their wardrobe as evidence under their own origin, with a crop of their own photo,
-- and "Delete imported history" removes them with the rest.
-- Run once BEFORE turning on OUTFIT_CLOSET_ENABLED: without it, reading a photo into the wardrobe fails to save.
begin;
insert into public.evidence_origins(origin,purchase_history) values ('outfit_photo',true)
on conflict (origin) do update set purchase_history=excluded.purchase_history;
commit;
