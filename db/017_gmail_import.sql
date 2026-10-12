-- Private, invite-only Gmail pilot. Browser roles never receive tokens or receipt evidence.
begin;
create table public.gmail_imports (
 conversation_id uuid primary key references public.conversations(id),
 revision integer not null default 0,
 token_ciphertext text,
 data jsonb not null default '{}'::jsonb,
 oauth_hash text unique,
 oauth_expires timestamptz,
 lease_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.gmail_imports enable row level security;
revoke all on public.gmail_imports from public,anon,authenticated;
grant all on public.gmail_imports to service_role;
create function public.begin_gmail_oauth(p_conversation uuid,p_hash text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 insert into gmail_imports(conversation_id) values(p_conversation) on conflict do nothing;
 update gmail_imports set oauth_hash=p_hash,oauth_expires=now()+interval '10 minutes'
 where conversation_id=p_conversation and (lease_until is null or lease_until<now());
 return found;
end; $$;
create function public.consume_gmail_oauth(p_hash text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare owner uuid;
begin
 update gmail_imports set oauth_hash=null,oauth_expires=null where oauth_hash=p_hash and oauth_expires>now()
 returning conversation_id into owner;
 return owner;
end; $$;
create function public.claim_gmail_import(p_conversation uuid)
returns setof gmail_imports language sql security invoker set search_path=public as $$
 update gmail_imports set revision=revision+1,lease_until=now()+interval '110 seconds'
 where conversation_id=p_conversation and (lease_until is null or lease_until<now()) returning *;
$$;
create function public.finish_gmail_import(p_conversation uuid,p_revision integer,p_data jsonb,p_token text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update gmail_imports set data=p_data,token_ciphertext=p_token,lease_until=null,oauth_hash=null,oauth_expires=null,updated_at=now()
 where conversation_id=p_conversation and revision=p_revision and lease_until>now();
 return found;
end; $$;
revoke all on function public.begin_gmail_oauth(uuid,text),public.consume_gmail_oauth(text),public.claim_gmail_import(uuid),public.finish_gmail_import(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.begin_gmail_oauth(uuid,text),public.consume_gmail_oauth(text),public.claim_gmail_import(uuid),public.finish_gmail_import(uuid,integer,jsonb,text) to service_role;
commit;
