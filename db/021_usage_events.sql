-- Per-user cost metering (lib/usage.js). One row per outbound OpenAI or SerpApi call, attributed to
-- the user action that caused it. cost_usd is an estimate from list prices; invoices remain authoritative.
begin;
create table public.usage_events (
  id bigint generated always as identity primary key,
  conversation_id uuid references public.conversations(id) on delete set null,
  operation text not null,
  feature text not null,
  action text,
  provider text not null check (provider in ('openai','serpapi')),
  model text,
  units integer not null default 1,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  web_search_calls integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index usage_events_owner_time on public.usage_events(conversation_id,created_at);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from public,anon,authenticated;
grant all on public.usage_events to service_role;
-- Daily cost per user and feature, for review and eventual billing.
create view public.usage_by_user_day with (security_invoker=true) as
  select conversation_id,date_trunc('day',created_at)::date as day,feature,action,
    count(*) as calls,sum(input_tokens) as input_tokens,sum(output_tokens) as output_tokens,
    sum(web_search_calls) as web_search_calls,sum(cost_usd) as cost_usd
  from public.usage_events group by 1,2,3,4;
revoke all on public.usage_by_user_day from public,anon,authenticated;
grant select on public.usage_by_user_day to service_role;
commit;
