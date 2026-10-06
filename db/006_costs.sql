-- Owner-only cost ledger. Existing server authentication controls access.
create table if not exists public.cost_entries (
  service text not null check (service in ('openai','photon','serpapi','vercel','supabase','github','codex')),
  kind text not null check (kind in ('usage','subscription','budget')),
  date date not null,
  amount numeric not null check (amount >= 0 and amount <= 1000000),
  note text not null default '' check (length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (service, kind, date)
);
alter table public.cost_entries enable row level security;
revoke all on public.cost_entries from anon, authenticated;
grant all on public.cost_entries to service_role;
