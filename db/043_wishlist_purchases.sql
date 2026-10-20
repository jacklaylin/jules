-- "I bought this" on the wishlist (lib/wishlist-purchases.js): a saved item the person marks as bought
-- joins their purchase history (the wardrobe) as evidence under its own origin, and "Delete imported
-- history" removes it with the rest. The mark itself lives on the wishlist encounter, like removal.
-- Run once BEFORE deploying the code that uses it: without it, marking an item as bought fails to save.
begin;
insert into public.evidence_origins(origin,purchase_history) values ('wishlist_purchase',true)
on conflict (origin) do update set purchase_history=excluded.purchase_history;
commit;
