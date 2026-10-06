-- Milestone 4. Existing private conversation is the user's profile identity in V0.
begin;
create table public.taste_profiles (
 conversation_id uuid primary key references public.conversations(id),
 facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts)='array' and jsonb_array_length(facts)<=150),
 version integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.taste_profiles enable row level security;
revoke all on public.taste_profiles from anon,authenticated;
grant all on public.taste_profiles to service_role;
alter table public.messages add column memory_status text check (memory_status in ('saved','failed'));
create function public.save_taste_profile(p_conversation uuid,p_version integer,p_facts jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare changed uuid;
begin
 insert into public.taste_profiles(conversation_id) values(p_conversation) on conflict do nothing;
 update public.taste_profiles set facts=p_facts,version=version+1,updated_at=now()
 where conversation_id=p_conversation and version=p_version returning conversation_id into changed;
 return changed is not null;
end;
$$;
revoke all on function public.save_taste_profile(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_taste_profile(uuid,integer,jsonb) to service_role;
commit;
