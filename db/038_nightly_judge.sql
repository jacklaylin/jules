-- Nightly judge (lib/judge.js, RECOMMENDATION-SCORECARD.md). Run once in the Supabase SQL editor, after
-- db/023_gmail_sweep.sql (its scheduler secret) and db/034_recurring_jobs.sql (job_runs). Re-running is safe.
-- 1. sourcing_turns: one row per sourcing turn, keyed by the reply's operation id. Outcome fields (no message
--    text) are refreshed each run; judge fields are written once: overall verdict, failed criteria and each
--    criterion's verdict with a one-sentence paraphrased reason. founder_verdict is for "the judge was wrong".
-- 2. A scheduler tick every 10 minutes from 09:00 to 11:50 UTC (2–4:50 am Pacific). Each call judges a small
--    batch inside the 120-second function limit and stops when the day is done or JUDGE_DAILY_TURNS is reached.
-- Change the site origin below only if the production domain changes.
begin;
create table if not exists public.sourcing_turns (
  operation text primary key,
  conversation_id uuid references public.conversations(id) on delete cascade,
  at timestamptz not null,
  results_at timestamptz,
  request_type text,
  result text,
  products_shown integer,
  verified_shown integer,
  first_message_ms integer,
  result_ms integer,
  cost_usd numeric(12,6),
  labels text[] not null default '{}',
  headline text,
  threaded boolean not null default false,
  updated_at timestamptz not null default now(),
  judged_at timestamptz,
  judge_model text,
  judge_cost_usd numeric(12,6),
  verdict text check (verdict is null or verdict in ('pass','fail')),
  failed text[] not null default '{}',
  criteria jsonb,
  founder_verdict text check (founder_verdict is null or founder_verdict in ('agree','disagree'))
);
create index if not exists sourcing_turns_time on public.sourcing_turns(at);
create index if not exists sourcing_turns_judged on public.sourcing_turns(judged_at) where judged_at is not null;
alter table public.sourcing_turns enable row level security;
revoke all on public.sourcing_turns from public,anon,authenticated;
grant all on public.sourcing_turns to service_role;

create or replace function public.judge_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 perform net.http_get(url:='https://jules-gamma.vercel.app/api/imessage?job=judge',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.judge_tick() from public,anon,authenticated;
select cron.unschedule(jobid) from cron.job where jobname='jules-nightly-judge';
select cron.schedule('jules-nightly-judge','*/10 9-11 * * *','select public.judge_tick()');
commit;
