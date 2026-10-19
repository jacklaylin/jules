-- Adoption events (lib/adoption-events.js, Admin › Adoption): one row per product-results reply (quantity =
-- product options linked in it), outbound product-link click, or purchase request (PRD §18, §22).
-- ref is the reply's operation id. No message text, product names or phone numbers are stored.
begin;
create table public.adoption_events (
  id bigint generated always as identity primary key,
  conversation_id uuid references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('results_shown','link_click','purchase_intent')),
  ref text,
  quantity integer not null default 1,
  created_at timestamptz not null default now()
);
create index adoption_events_owner_time on public.adoption_events(conversation_id,created_at);
alter table public.adoption_events enable row level security;
revoke all on public.adoption_events from public,anon,authenticated;
grant all on public.adoption_events to service_role;
commit;
