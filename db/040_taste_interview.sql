-- Gap-filling taste interview (lib/interview.js, design/cold-start-taste-brief.md step 2).
-- 1. Evidence kind 'stated_answer': the person's answer to one of Jules's interview questions, kept
--    with the question it answered. Lasting facts from the answer are saved by the chat as usual.
-- 2. Evidence origin 'interview' (not purchase history: "Delete imported history" keeps it).
-- 3. taste_interviews: which questions were asked, their outcomes, and whether the person declined.
-- Run once after 039_site_origin.sql and BEFORE setting INTERVIEW_ENABLED=true. Deploying the code
-- first is safe: with the flag off nothing reads or writes these.
begin;
alter table public.evidence drop constraint evidence_kind_check;
alter table public.evidence add constraint evidence_kind_check check (kind in ('purchase_event','correction','photo_observation','user_note','chat_statement','operator_entry','confirmation','wishlist_event','legacy_record','order_summary','stated_answer'));
insert into public.evidence_origins(origin,purchase_history) values ('interview',false)
on conflict (origin) do update set purchase_history=excluded.purchase_history;
create table public.taste_interviews (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  revision integer not null default 1,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object'),
  updated_at timestamptz not null default now()
);
alter table public.taste_interviews enable row level security;
revoke all on public.taste_interviews from public,anon,authenticated;
grant all on public.taste_interviews to service_role;
commit;
