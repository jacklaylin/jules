-- Milestone 2 only. Run once in the Supabase SQL editor.
begin;
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  line text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sender_id, line)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  provider_id text unique,
  operation_id text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null check (length(body) between 1 and 10000),
  status text not null check (status in ('received', 'sending', 'sent', 'uncertain')),
  source text not null check (source in ('tester', 'greeting', 'operator')),
  created_at timestamptz not null default now(),
  check ((direction = 'inbound' and provider_id is not null and operation_id is null and status = 'received')
      or (direction = 'outbound' and operation_id is not null and provider_id is null and status <> 'received'))
);
create index messages_conversation_time on public.messages(conversation_id, created_at, id);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
-- No browser roles can read/write private conversations, even with a valid login.
revoke all on public.conversations, public.messages from anon, authenticated;
grant all on public.conversations, public.messages to service_role;

create function public.receive_message(p_sender text, p_line text, p_provider_id text, p_body text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare conversation uuid;
begin
  insert into public.conversations(sender_id, line) values(p_sender, p_line)
  on conflict(sender_id, line) do update set updated_at = now()
  returning id into conversation;
  insert into public.messages(conversation_id, provider_id, direction, body, status, source)
  values(conversation, p_provider_id, 'inbound', p_body, 'received', 'tester')
  on conflict(provider_id) do nothing;
  return conversation;
end;
$$;

create function public.reserve_reply(p_conversation uuid, p_operation text, p_body text, p_source text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare inserted uuid;
begin
  insert into public.messages(conversation_id, operation_id, direction, body, status, source)
  values(p_conversation, p_operation, 'outbound', p_body, 'sending', p_source)
  on conflict(operation_id) do nothing returning id into inserted;
  if inserted is not null then
    update public.conversations set updated_at = now() where id = p_conversation;
  end if;
  return inserted is not null;
end;
$$;
revoke all on function public.receive_message(text,text,text,text) from public, anon, authenticated;
revoke all on function public.reserve_reply(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.receive_message(text,text,text,text) to service_role;
grant execute on function public.reserve_reply(uuid,text,text,text) to service_role;
commit;
