-- Low-stock alerts (PRD Section 28, October 21): a per-alert switch so a person can turn off only the
-- "nearly sold out" texts and keep price and restock alerts on. On by default: an existing alert on an
-- item covers low-stock texts for that item and size (founder decision). The low-stock episode itself
-- lives in last_result. Run in the Supabase SQL editor after 047_usage_openrouter.sql. Re-running is safe.
begin;
alter table public.price_alerts add column if not exists low_stock_alerts boolean not null default true;
commit;
