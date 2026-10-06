-- Milestone 3. Run once after 001_admin.sql.
begin;
alter table public.messages drop constraint messages_status_check;
alter table public.messages add constraint messages_status_check check (status in ('received','generating','sending','sent','uncertain'));
alter table public.messages drop constraint messages_source_check;
alter table public.messages add constraint messages_source_check check (source in ('tester','greeting','operator','ai','ai_fallback'));
create function public.claim_ai_reply(p_conversation uuid, p_operation text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare inserted uuid;
begin
  insert into public.messages(conversation_id,operation_id,direction,body,status,source)
  values(p_conversation,p_operation,'outbound','AI reply is being prepared.','generating','ai')
  on conflict(operation_id) do nothing returning id into inserted;
  return inserted is not null;
end;
$$;
revoke all on function public.claim_ai_reply(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_ai_reply(uuid,text) to service_role;
commit;
