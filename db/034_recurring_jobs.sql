-- Recurring job costs (lib/jobs.js, Admin › Costs › Recurring jobs). Run once in the Supabase SQL editor;
-- re-running it is safe. Until it runs, job costs still count by feature and the dashboard says so.
begin;
-- Which recurring job caused each metered call (null for anything a person did).
alter table public.usage_events add column if not exists job text;

-- One row each time a scheduled job reaches Vercel: when, how long, and whether it worked, failed or was
-- skipped (switched off).
create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  status text not null check (status in ('ok','failed','skipped')),
  summary jsonb not null default '{}'
);
create index if not exists job_runs_job_time on public.job_runs(job, started_at desc);
alter table public.job_runs enable row level security;
revoke all on public.job_runs from public,anon,authenticated;
grant all on public.job_runs to service_role;

create or replace view public.usage_by_day_job with (security_invoker=true) as
  select date_trunc('day',created_at at time zone 'UTC')::date as day,job,provider,model,
    count(*) as calls,sum(units) as units,sum(input_tokens) as input_tokens,sum(cached_tokens) as cached_tokens,
    sum(output_tokens) as output_tokens,sum(web_search_calls) as web_search_calls,max(created_at) as last_at
  from public.usage_events where job is not null group by 1,2,3,4;
revoke all on public.usage_by_day_job from public,anon,authenticated;
grant select on public.usage_by_day_job to service_role;

create or replace view public.job_runs_by_day with (security_invoker=true) as
  select date_trunc('day',started_at at time zone 'UTC')::date as day,job,count(*) as runs,
    count(*) filter (where status='failed') as failed,count(*) filter (where status='skipped') as skipped,sum(duration_ms) as duration_ms,max(started_at) as last_at,
    (array_agg(status order by started_at desc))[1] as last_status
  from public.job_runs group by 1,2;
revoke all on public.job_runs_by_day from public,anon,authenticated;
grant select on public.job_runs_by_day to service_role;

-- Every pg_cron job Supabase actually has, with its runs since p_since, so a job scheduled outside
-- this repo still shows up on the dashboard (as not tracked) instead of being missed.
create or replace function public.scheduled_jobs(p_since timestamptz)
returns table(jobname text, schedule text, active boolean, runs bigint, failed bigint, last_run timestamptz, last_status text)
language sql stable security definer set search_path=public,cron as $$
  select j.jobname,j.schedule,j.active,count(d.runid),count(d.runid) filter (where d.status='failed'),max(d.start_time),
    (array_agg(d.status order by d.start_time desc) filter (where d.runid is not null))[1]
  from cron.job j left join cron.job_run_details d on d.jobid=j.jobid and d.start_time>=p_since
  group by j.jobid,j.jobname,j.schedule,j.active;
$$;
revoke all on function public.scheduled_jobs(timestamptz) from public,anon,authenticated;
grant execute on function public.scheduled_jobs(timestamptz) to service_role;

-- A monthly budget per recurring job, entered with Update an amount (service = 'job:<id>').
alter table public.cost_entries drop constraint if exists cost_entries_service_check;
alter table public.cost_entries drop constraint if exists cost_entries_kind_check;
alter table public.cost_entries add constraint cost_entries_service_check
  check (service in ('openai','photon','serpapi','vercel','supabase','github','codex') or service ~ '^job:[a-z_]{1,40}$');
alter table public.cost_entries add constraint cost_entries_kind_check check (kind in ('usage','subscription','budget','job_budget'));
commit;
