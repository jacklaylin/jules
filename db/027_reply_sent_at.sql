-- When each reply was actually sent, for chat speed metrics (lib/chat-metrics.js). Run once after
-- 026_history_sweep.sql. An outbound row's created_at is when the reply placeholder was claimed, not
-- when the text went out; sent_at is set by the database the moment a row's status becomes 'sent',
-- so no application code path has to remember to record it. Older rows stay null (the metrics fall
-- back to recorded timing diagnostics or estimates and say so).
begin;
alter table public.messages add column if not exists sent_at timestamptz;

create or replace function public.stamp_message_sent_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') and new.sent_at is null then
    new.sent_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_stamp_sent_at on public.messages;
create trigger messages_stamp_sent_at before insert or update of status on public.messages
  for each row execute function public.stamp_message_sent_at();
commit;
