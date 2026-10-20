-- Better-price scans after a save (lib/store-scan.js), shared across users: one row per product
-- (a hash of brand, product name and colour), holding the other stores whose own page showed a price.
-- Run once in the Supabase SQL editor. Safe to deploy the code first: until this runs, every save
-- scans on its own (no sharing) and nothing else changes.
create table if not exists public.store_scans (
  product_key text primary key check (product_key ~ '^[0-9a-f]{40}$'),
  result jsonb not null default '{}'::jsonb,
  scanned_at timestamptz not null default now()
);
alter table public.store_scans enable row level security;
revoke all on public.store_scans from anon, authenticated;
