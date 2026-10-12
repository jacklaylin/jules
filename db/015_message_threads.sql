-- Preserve provider reply references; resolve targets only within the owner's conversation.
begin;
alter table public.messages add column reply_provider_id text
  check (reply_provider_id is null or length(reply_provider_id) between 1 and 500);
-- Known successful outbound provider IDs let incoming replies resolve assistant messages too.
alter table public.messages drop constraint messages_check;
alter table public.messages add constraint messages_direction_reference check (
  (direction='inbound' and provider_id is not null and operation_id is null and status='received')
  or (direction='outbound' and operation_id is not null and status<>'received'));
drop function public.receive_message(text,text,text,text);
create function public.receive_message(p_sender text,p_line text,p_provider_id text,p_body text,p_reply_provider_id text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare conversation uuid;
begin
  insert into public.conversations(sender_id,line) values(p_sender,p_line)
  on conflict(sender_id,line) do update set updated_at=now()
  returning id into conversation;
  insert into public.messages(conversation_id,provider_id,direction,body,status,source,reply_provider_id)
  values(conversation,p_provider_id,'inbound',p_body,'received','tester',p_reply_provider_id)
  on conflict(provider_id) do nothing;
  return conversation;
end;
$$;
revoke all on function public.receive_message(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.receive_message(text,text,text,text,text) to service_role;
commit;
