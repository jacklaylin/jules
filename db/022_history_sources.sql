-- Purchase-history sources beyond Gmail (lib/connected-sources.js), starting with Shop orders.
-- Evidence origins move from a fixed check constraint to a table, so a new source is one row.
-- purchase_history marks origins that "Delete imported history" removes. Connected sources share
-- the gmail_imports row (lease, questions, history summary); their sealed sign-ins live in its data.
-- Run after 021_usage_events.sql and before SHOP_ORDERS_ENABLED=true.
begin;
create table public.evidence_origins (
  origin text primary key,
  purchase_history boolean not null default false
);
alter table public.evidence_origins enable row level security;
insert into public.evidence_origins(origin,purchase_history) values
  ('gmail',true),('shop',true),('style',false),('chat',false),('operator',false),('wishlist',false),('legacy',false);
alter table public.evidence drop constraint evidence_origin_check;
alter table public.evidence add constraint evidence_origin_fkey foreign key (origin) references public.evidence_origins(origin);

create or replace function public.finish_gmail_import(p_conversation uuid,p_revision integer,p_data jsonb,p_token text,p_evidence jsonb,p_clear boolean default false)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update gmail_imports set data=p_data,token_ciphertext=p_token,lease_until=null,oauth_hash=null,oauth_expires=null,updated_at=now()
 where conversation_id=p_conversation and revision=p_revision and lease_until>now();
 if not found then return false; end if;
 if p_clear then
  delete from evidence where conversation_id=p_conversation and origin in (select origin from evidence_origins where purchase_history);
  perform prune_unsupported_facts(p_conversation);
 end if;
 perform insert_evidence(p_conversation,p_evidence);
 return true;
end; $$;
-- A user who connects only another source has no row until Gmail sign-in starts; connecting creates it.
create function public.ensure_gmail_import(p_conversation uuid) returns void
language sql security invoker set search_path=public as $$
 insert into gmail_imports(conversation_id) values(p_conversation) on conflict do nothing;
$$;
revoke all on table public.evidence_origins from public,anon,authenticated;
grant select on public.evidence_origins to service_role;
revoke all on function public.finish_gmail_import(uuid,integer,jsonb,text,jsonb,boolean),public.ensure_gmail_import(uuid) from public,anon,authenticated;
grant execute on function public.finish_gmail_import(uuid,integer,jsonb,text,jsonb,boolean),public.ensure_gmail_import(uuid) to service_role;
commit;
