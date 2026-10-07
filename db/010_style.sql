-- Requires db/003_memory.sql and db/008_wishlist.sql. Private, invited-user pilot.
begin;
create table public.style_sessions (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  revision integer not null default 0,
  data jsonb not null default '{"notes":"","tone":"balanced","report":null}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.style_sources (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check(kind in ('outfit','inspiration','receipt')),
  occasion text not null default '',
  note text not null default '',
  mime_type text not null check(mime_type in ('image/jpeg','application/pdf')),
  data text not null,
  created_at timestamptz not null default now()
);
create index style_sources_owner on public.style_sources(conversation_id,created_at);
alter table public.style_sessions enable row level security;
alter table public.style_sources enable row level security;
revoke all on public.style_sessions,public.style_sources from anon,authenticated;
grant all on public.style_sessions,public.style_sources to service_role;

-- All writes use one owner-scoped optimistic lock, including uploads and model results.
create function public.write_style(p_conversation uuid,p_revision integer,p_data jsonb,
  p_source jsonb default null,p_remove uuid default null,p_facts jsonb default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare current_revision integer; source_count integer; fact jsonb; remaining jsonb;
begin
  insert into public.style_sessions(conversation_id) values(p_conversation) on conflict do nothing;
  select revision into current_revision from public.style_sessions where conversation_id=p_conversation for update;
  if current_revision<>p_revision then return false; end if;
  if p_source is not null then
    select count(*) into source_count from public.style_sources where conversation_id=p_conversation;
    if source_count>=12 then raise exception 'Source limit'; end if;
    insert into public.style_sources(id,conversation_id,kind,occasion,note,mime_type,data)
    values((p_source->>'id')::uuid,p_conversation,p_source->>'kind',p_source->>'occasion',p_source->>'note',p_source->>'mime_type',p_source->>'data');
  end if;
  if p_remove is not null then delete from public.style_sources where id=p_remove and conversation_id=p_conversation; end if;
  -- Only preferences separately confirmed by the user reach shopping memory.
  -- Preserve concurrent chat facts and operator corrections; replace our own previous read.
  if p_facts is not null then
    insert into public.taste_profiles(conversation_id) values(p_conversation) on conflict do nothing;
    perform 1 from public.taste_profiles where conversation_id=p_conversation for update;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into remaining
      from public.taste_profiles,jsonb_array_elements(facts)
      where conversation_id=p_conversation and value->>'source' is distinct from 'style_report';
    for fact in select value from jsonb_array_elements(p_facts) loop
      if not exists(select 1 from jsonb_array_elements(remaining) f where f->>'field'=fact->>'field' and f->>'key'=fact->>'key') then
        remaining=remaining||jsonb_build_array(fact);
      end if;
    end loop;
    if jsonb_array_length(remaining)>150 then raise exception 'Taste profile full'; end if;
    update public.taste_profiles set facts=remaining,version=version+1,updated_at=now() where conversation_id=p_conversation;
  end if;
  update public.style_sessions set data=p_data,revision=revision+1,updated_at=now() where conversation_id=p_conversation;
  return true;
end;
$$;
revoke all on function public.write_style(uuid,integer,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_style(uuid,integer,jsonb,jsonb,uuid,jsonb) to service_role;

create function public.delete_style(p_conversation uuid,p_revision integer) returns boolean
language plpgsql security invoker set search_path=public as $$
declare current_revision integer;
begin
  select revision into current_revision from public.style_sessions where conversation_id=p_conversation for update;
  if current_revision is null or current_revision<>p_revision then return false; end if;
  delete from public.style_sources where conversation_id=p_conversation;
  -- Keep a revision tombstone so an in-flight analysis cannot resurrect deleted data.
  update public.style_sessions set revision=revision+1,data='{"notes":"","tone":"balanced","report":null}'::jsonb,
    updated_at=now() where conversation_id=p_conversation;
  update public.taste_profiles set facts=(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(facts)
    where value->>'source' is distinct from 'style_report'),version=version+1,updated_at=now()
    where conversation_id=p_conversation;
  return true;
end;
$$;
revoke all on function public.delete_style(uuid,integer) from public,anon,authenticated;
grant execute on function public.delete_style(uuid,integer) to service_role;
commit;
