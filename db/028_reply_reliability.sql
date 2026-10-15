-- Reply reliability (lib/reply-failures.js).
-- 1. messages.reply_diagnostics: why a reply fell back or stalled (step, error class, model status,
--    elapsed ms). Kept apart from search_result so a failed turn never replaces pending shopping state.
-- 2. gmail_imports.chat_answers: a chat answer about purchase history that arrived while the import
--    worker held the lease. The worker applies it on its next step instead of the reply failing.
-- 3. A once-a-minute watchdog for replies stuck in generating/sending, using the same Supabase
--    scheduler and Vault secret as the Gmail sweep (db/023_gmail_sweep.sql must already be applied).
--    It calls Vercel only when a reply has been stuck past the 120-second function limit.
-- Change the site origin below only if the production domain changes.
begin;
alter table public.messages add column if not exists reply_diagnostics jsonb;
alter table public.gmail_imports add column if not exists chat_answers jsonb not null default '[]'::jsonb;

-- Appends without the lease. Answers are keyed by their message, so a replayed delivery is not added twice.
create or replace function public.queue_history_answer(p_conversation uuid, p_answer jsonb)
returns boolean language sql security definer set search_path=public as $$
 update gmail_imports set chat_answers=chat_answers||jsonb_build_array(p_answer)
 where conversation_id=p_conversation and not chat_answers @> jsonb_build_array(jsonb_build_object('id',p_answer->>'id'))
 returning true;
$$;
-- Removes applied answers by id (only the lease holder applies them; applying twice is a no-op).
create or replace function public.clear_history_answers(p_conversation uuid, p_ids text[])
returns void language sql security definer set search_path=public as $$
 update gmail_imports set chat_answers=coalesce((select jsonb_agg(a) from jsonb_array_elements(chat_answers) a where not (a->>'id' = any(p_ids))),'[]'::jsonb)
 where conversation_id=p_conversation;
$$;
revoke all on function public.queue_history_answer(uuid,jsonb),public.clear_history_answers(uuid,text[]) from public,anon,authenticated;
grant execute on function public.queue_history_answer(uuid,jsonb),public.clear_history_answers(uuid,text[]) to service_role;

create index if not exists messages_stuck_replies on public.messages (created_at)
 where direction='outbound' and status in ('generating','sending');

create or replace function public.reply_watchdog_tick()
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from messages where direction='outbound' and status in ('generating','sending')
   and operation_id like 'ai:%' and created_at<now()-interval '125 seconds' and created_at>now()-interval '1 day'
   and (reply_diagnostics is null or reply_diagnostics->>'stalled_at' is null)) then return; end if;
 perform net.http_get(url:='https://jules-gamma.vercel.app/api/imessage?watchdog=replies',
  headers:=jsonb_build_object('Authorization','Bearer '||gmail_sweep_secret()),timeout_milliseconds:=10000);
end; $$;
revoke all on function public.reply_watchdog_tick() from public,anon,authenticated;
select cron.unschedule(jobid) from cron.job where jobname='jules-reply-watchdog';
select cron.schedule('jules-reply-watchdog','* * * * *','select public.reply_watchdog_tick()');
commit;
