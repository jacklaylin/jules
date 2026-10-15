-- Carrier opt-out (STOP/START). Run once after 024_gmail_profile_due.sql.
-- A conversation with sms_opted_out_at set receives no texts. The block lives in the ledger
-- functions, so every reserved send (replies, onboarding, receipts, price alerts) honours it,
-- including sends already in flight when STOP arrives. Blocked sends are recorded as 'blocked'
-- for observability and are never sent later. Only 'compliance' texts (the STOP/HELP/START
-- confirmations) pass.
begin;
alter table public.conversations add column if not exists sms_opted_out_at timestamptz;
alter table public.messages drop constraint messages_status_check;
alter table public.messages add constraint messages_status_check check (status in ('received','generating','sending','sent','uncertain','blocked'));
alter table public.messages drop constraint messages_source_check;
alter table public.messages add constraint messages_source_check check (source in ('tester','greeting','operator','ai','ai_fallback','compliance'));

create or replace function public.reserve_reply(p_conversation uuid, p_operation text, p_body text, p_source text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare inserted uuid; opted_out boolean;
begin
  select sms_opted_out_at is not null into opted_out from public.conversations where id = p_conversation for share;
  insert into public.messages(conversation_id, operation_id, direction, body, status, source)
  values(p_conversation, p_operation, 'outbound', p_body,
    case when coalesce(opted_out, false) and p_source <> 'compliance' then 'blocked' else 'sending' end, p_source)
  on conflict(operation_id) do nothing returning id into inserted;
  if inserted is null or (coalesce(opted_out, false) and p_source <> 'compliance') then return false; end if;
  update public.conversations set updated_at = now() where id = p_conversation;
  return true;
end;
$$;

create or replace function public.claim_ai_reply(p_conversation uuid, p_operation text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare inserted uuid;
begin
  if exists(select 1 from public.conversations where id = p_conversation and sms_opted_out_at is not null) then return false; end if;
  insert into public.messages(conversation_id,operation_id,direction,body,status,source)
  values(p_conversation,p_operation,'outbound','AI reply is being prepared.','generating','ai')
  on conflict(operation_id) do nothing returning id into inserted;
  return inserted is not null;
end;
$$;

-- Returns true when the state changed, so a repeated STOP or START sends one confirmation.
create function public.set_sms_opt_out(p_conversation uuid, p_opted_out boolean)
returns boolean language plpgsql security invoker set search_path = public as $$
declare changed uuid;
begin
  update public.conversations set sms_opted_out_at = case when p_opted_out then now() else null end
  where id = p_conversation and (sms_opted_out_at is not null) <> p_opted_out
  returning id into changed;
  return changed is not null;
end;
$$;
revoke all on function public.set_sms_opt_out(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_sms_opt_out(uuid,boolean) to service_role;
commit;
