-- Waitlist access (lib/inbox.js, WAITLIST_ENABLED). Run once in the Supabase SQL editor.
-- Everyone who already has a conversation is approved; numbers that first text after this runs start
-- on the waitlist. Nothing reads these columns until WAITLIST_ENABLED=true.
begin;
alter table public.conversations
 add column if not exists access text not null default 'waitlisted' check(access in ('waitlisted','approved')),
 add column if not exists waitlist_replies integer not null default 0,
 add column if not exists waitlist_notice_at timestamptz,
 add column if not exists approved_at timestamptz;
update public.conversations set access='approved',approved_at=now() where access='waitlisted';

-- One waitlisted message's outcome, decided atomically so rapid messages cannot exceed the allowance:
-- 'approved' (no limit), 'reply' (an allowance reply was used; replies_used counts it), 'notice' (send
-- the waitlist notice, at most once a day), or 'quiet' (store the message, send nothing).
create function public.claim_waitlist_turn(p_conversation uuid,p_allowance integer)
returns table(outcome text,replies_used integer) language plpgsql security invoker set search_path=public as $$
declare c public.conversations;
begin
 select * into c from conversations where id=p_conversation for update;
 if not found or c.access='approved' then return query select 'approved'::text,0; return; end if;
 if c.waitlist_replies<p_allowance then
  update conversations set waitlist_replies=waitlist_replies+1 where id=p_conversation;
  return query select 'reply'::text,c.waitlist_replies+1; return;
 end if;
 if c.waitlist_notice_at is null or c.waitlist_notice_at<now()-interval '1 day' then
  update conversations set waitlist_notice_at=now() where id=p_conversation;
  return query select 'notice'::text,c.waitlist_replies; return;
 end if;
 return query select 'quiet'::text,c.waitlist_replies;
end;
$$;
revoke all on function public.claim_waitlist_turn(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_waitlist_turn(uuid,integer) to service_role;
commit;
