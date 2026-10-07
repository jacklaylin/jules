begin;
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  group_id uuid not null,
  name text not null,
  size text not null check(length(trim(size)) between 1 and 80),
  baselines jsonb not null check(jsonb_array_length(baselines)>0),
  links jsonb not null,
  active boolean not null default true,
  notified boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  next_check_at timestamptz not null default now()+interval '3 days',
  last_checked_at timestamptz,
  last_result jsonb,
  created_at timestamptz not null default now(),
  unique(conversation_id,group_id)
);
alter table public.price_alerts enable row level security;
revoke all on public.price_alerts from anon,authenticated;
grant all on public.price_alerts to service_role;
create function public.enable_price_alert(p_conversation uuid,p_item uuid,p_group uuid,p_name text,p_size text,p_baselines jsonb,p_links jsonb)
returns public.price_alerts language plpgsql security invoker set search_path=public as $$
declare result public.price_alerts;
begin
  if not exists(select 1 from wishlist_items where id=p_item and conversation_id=p_conversation) then raise exception 'Invalid item owner'; end if;
  insert into price_alerts(conversation_id,item_id,group_id,name,size,baselines,links)
    values(p_conversation,p_item,p_group,p_name,p_size,p_baselines,p_links)
    on conflict(conversation_id,group_id) do update set
      active=true,notified=false,size=excluded.size,baselines=excluded.baselines,links=excluded.links,name=excluded.name,
      revision=gen_random_uuid(),next_check_at=now()+interval '3 days',last_checked_at=null,last_result=null
    where price_alerts.active=false
    returning * into result;
  if result.id is null then select * into result from price_alerts where conversation_id=p_conversation and group_id=p_group; end if;
  return result;
end; $$;
create function public.claim_price_alerts() returns setof public.price_alerts
language sql security invoker set search_path=public as $$
  update price_alerts set next_check_at=now()+interval '3 days'
    where id in (select id from price_alerts where active and next_check_at<=now() order by next_check_at limit 50 for update skip locked)
    returning *;
$$;
revoke all on function public.enable_price_alert(uuid,uuid,uuid,text,text,jsonb,jsonb),public.claim_price_alerts() from public,anon,authenticated;
grant execute on function public.enable_price_alert(uuid,uuid,uuid,text,text,jsonb,jsonb),public.claim_price_alerts() to service_role;
commit;
