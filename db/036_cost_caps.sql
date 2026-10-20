-- Spending caps (lib/cost-caps.js, COST-CAPS.md). Run once in the Supabase SQL editor; re-running it is safe.
-- Until it runs, caps still work from the stored per-call estimates (usage_by_user_day), which undercount
-- calls priced after they happened (the gpt-5.5 rows below).
begin;

-- Each person's metered calls per UTC day and model, with token and search counts, so spend is priced
-- at current list prices in code (the same way Admin › Costs prices the totals).
create or replace view public.usage_by_user_model_day with (security_invoker=true) as
  select conversation_id,date_trunc('day',created_at at time zone 'UTC')::date as day,provider,model,
    count(*) as calls,sum(units) as units,sum(input_tokens) as input_tokens,sum(cached_tokens) as cached_tokens,
    sum(output_tokens) as output_tokens,sum(web_search_calls) as web_search_calls,sum(cost_usd) as cost_usd
  from public.usage_events group by 1,2,3,4;
revoke all on public.usage_by_user_model_day from public,anon,authenticated;
grant select on public.usage_by_user_model_day to service_role;

-- gpt-5.5 calls recorded before it had a price were stored at $0. Price them at the list rate
-- ($5 input, $0.50 cached input, $30 output per 1M tokens; $10 per 1,000 web searches).
update public.usage_events
  set cost_usd = round(((input_tokens - cached_tokens) * 5.00 + cached_tokens * 0.50 + output_tokens * 30.00) / 1e6 + web_search_calls * 0.010, 6)
  where cost_usd = 0 and (model = 'gpt-5.5' or model ~ '^gpt-5\.5-\d{4}-\d{2}-\d{2}$') and (input_tokens > 0 or output_tokens > 0);
commit;
