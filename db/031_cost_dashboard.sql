-- Costs dashboard: month-to-date metered usage per day, feature, provider and model (lib/costs.js).
-- Tokens are summed so the dashboard can price each model from current list prices, and calls to a
-- model without a known price show as unpriced instead of $0. Read-only view; no data changes.
create or replace view public.usage_by_day_model with (security_invoker=true) as
  select date_trunc('day',created_at at time zone 'UTC')::date as day,feature,provider,model,
    count(*) as calls,sum(units) as units,sum(input_tokens) as input_tokens,sum(cached_tokens) as cached_tokens,
    sum(output_tokens) as output_tokens,sum(web_search_calls) as web_search_calls,sum(cost_usd) as cost_usd,
    max(created_at) as last_at
  from public.usage_events group by 1,2,3,4;
revoke all on public.usage_by_day_model from public,anon,authenticated;
grant select on public.usage_by_day_model to service_role;
