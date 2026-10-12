-- Invite-only tester onboarding. No Gmail credentials or receipt data.
begin;
create table public.onboarding_sessions (
 conversation_id uuid primary key references public.conversations(id),
 state text not null default 'invited' check(state in ('invited','offered','accepted','declined','ready')),
 updated_at timestamptz not null default now()
);
alter table public.onboarding_sessions enable row level security;
revoke all on public.onboarding_sessions from public,anon,authenticated;
grant all on public.onboarding_sessions to service_role;
create function public.advance_onboarding(p_conversation uuid,p_from text,p_to text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update onboarding_sessions set state=p_to,updated_at=now() where conversation_id=p_conversation and state=p_from;
 return found;
end;
$$;
revoke all on function public.advance_onboarding(uuid,text,text) from public,anon,authenticated;
grant execute on function public.advance_onboarding(uuid,text,text) to service_role;
commit;
