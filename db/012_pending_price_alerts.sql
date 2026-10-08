begin;
-- Consent creates a watch even when stores do not expose size-level stock/prices.
-- The checker establishes its first verified baseline before looking for drops.
alter table public.price_alerts drop constraint price_alerts_baselines_check;
alter table public.price_alerts add constraint price_alerts_baselines_check
  check(jsonb_typeof(baselines)='array');
commit;
