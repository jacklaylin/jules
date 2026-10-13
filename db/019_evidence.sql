-- One evidence store. Requires 003_memory, 010/011_style and 017_gmail_import.
-- Evidence rows are immutable proof points. Profile facts are beliefs that cite them.
begin;
-- Safety copies of the data this migration converts. Private; drop after the release is verified.
create table public._backup_019_taste_profiles as select * from public.taste_profiles;
create table public._backup_019_style_sessions as select * from public.style_sessions;
create table public._backup_019_gmail_imports as select conversation_id,revision,data,updated_at from public.gmail_imports;
alter table public._backup_019_taste_profiles enable row level security;
alter table public._backup_019_style_sessions enable row level security;
alter table public._backup_019_gmail_imports enable row level security;
revoke all on public._backup_019_taste_profiles,public._backup_019_style_sessions,public._backup_019_gmail_imports from public,anon,authenticated;
create table public.evidence (
  id text primary key check (length(id) between 3 and 300),
  seq bigint generated always as identity,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('purchase_event','correction','photo_observation','user_note','chat_statement','operator_entry','confirmation','wishlist_event','legacy_record')),
  origin text not null check (origin in ('gmail','style','chat','operator','wishlist','legacy')),
  source jsonb not null check (jsonb_typeof(source)='object'),
  data jsonb not null check (jsonb_typeof(data)='object'),
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index evidence_owner_seq on public.evidence(conversation_id,seq);
create index evidence_owner_origin on public.evidence(conversation_id,origin,seq);
alter table public.evidence enable row level security;
revoke all on public.evidence from public,anon,authenticated;
grant all on public.evidence to service_role;

-- Inserts keep array order (replay order). Re-recording the same proof is a no-op.
create function public.insert_evidence(p_conversation uuid,p_rows jsonb) returns void
language plpgsql security invoker set search_path=public as $$
begin
  if p_rows is null or jsonb_array_length(p_rows)=0 then return; end if;
  insert into evidence(id,conversation_id,kind,origin,source,data,recorded_by)
  select r.value->>'id',p_conversation,r.value->>'kind',r.value->>'origin',r.value->'source',r.value->'data',r.value->>'recorded_by'
  from jsonb_array_elements(p_rows) with ordinality r(value,n) order by r.n
  on conflict (id) do nothing;
  if exists(select 1 from jsonb_array_elements(p_rows) r join evidence e on e.id=r->>'id' where e.conversation_id<>p_conversation)
    then raise exception 'Evidence owner mismatch'; end if;
end; $$;

-- Every belief, including a removal tombstone, must cite at least one existing evidence row.
create function public.facts_supported(p_conversation uuid,p_facts jsonb) returns boolean
language sql stable security invoker set search_path=public as $$
  select not exists(
    select 1 from jsonb_array_elements(p_facts) f
    where jsonb_typeof(f->'evidence_ids') is distinct from 'array' or jsonb_array_length(f->'evidence_ids')=0
      or coalesce(f->>'basis','') not in ('stated','confirmed','inferred')
      or exists(select 1 from jsonb_array_elements_text(f->'evidence_ids') i
        where not exists(select 1 from evidence e where e.id=i and e.conversation_id=p_conversation)));
$$;

-- Beliefs follow their evidence: drop missing citations, and drop a belief left with none.
create function public.prune_unsupported_facts(p_conversation uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare kept jsonb;
begin
  perform 1 from taste_profiles where conversation_id=p_conversation for update;
  if not found then return; end if;
  select coalesce(jsonb_agg(f.value||jsonb_build_object('evidence_ids',f.ids)),'[]'::jsonb) into kept
  from (select value,(select coalesce(jsonb_agg(i),'[]'::jsonb) from jsonb_array_elements_text(value->'evidence_ids') i
          where exists(select 1 from evidence e where e.id=i and e.conversation_id=p_conversation)) ids
        from taste_profiles,jsonb_array_elements(facts) where conversation_id=p_conversation) f
  where jsonb_array_length(f.ids)>0;
  update taste_profiles set facts=kept,version=version+1,updated_at=now()
  where conversation_id=p_conversation and facts is distinct from kept;
end; $$;

create function public.delete_evidence(p_conversation uuid,p_origin text,p_source_id text default null) returns void
language plpgsql security invoker set search_path=public as $$
begin
  delete from evidence where conversation_id=p_conversation and origin=p_origin
    and (p_source_id is null or source->>'id'=p_source_id or source->'ids' ? p_source_id);
  perform prune_unsupported_facts(p_conversation);
end; $$;

-- Backfill: give every existing belief evidence and a basis, without inventing support.
insert into public.evidence(id,conversation_id,kind,origin,source,data,recorded_by)
select distinct on (eid) eid,conversation_id,kind,origin,source,data,'migration' from (
  select p.conversation_id,f.value,
    case when f.value->>'source'='message' and f.value->>'source_id' is not null then 'chat:'||(f.value->>'source_id')||':'||md5(coalesce(f.value->>'evidence',''))
         when f.value->>'source'='style_report' then 'confirmation:'||coalesce(f.value->>'source_id','unknown')||':'||(f.value->>'field')||'/'||(f.value->>'key')
         when f.value->>'source'='operator' then 'operator:'||md5(f.value::text)
         else 'legacy:'||md5(f.value::text) end eid,
    case when f.value->>'source'='message' and f.value->>'source_id' is not null then 'chat_statement'
         when f.value->>'source'='style_report' then 'confirmation'
         when f.value->>'source'='operator' then 'operator_entry' else 'legacy_record' end kind,
    case when f.value->>'source'='message' and f.value->>'source_id' is not null then 'chat'
         when f.value->>'source'='style_report' then 'style'
         when f.value->>'source'='operator' then 'operator' else 'legacy' end origin,
    case when f.value->>'source'='message' and f.value->>'source_id' is not null then jsonb_build_object('type','message','id',f.value->>'source_id','quote',f.value->>'evidence')
         when f.value->>'source'='style_report' then jsonb_build_object('type','style_report','id',f.value->>'source_id')
         else jsonb_build_object('type',coalesce(f.value->>'source','unknown')) end source,
    case when f.value->>'source'='message' and f.value->>'source_id' is not null then jsonb_build_object('quote',f.value->>'evidence','at',f.value->>'updated_at')
         else jsonb_build_object('note',f.value->>'evidence','field',f.value->>'field','key',f.value->>'key','value',f.value->>'value') end data
  from public.taste_profiles p,jsonb_array_elements(p.facts) f
  where f.value->'evidence_ids' is null
) backfill order by eid
on conflict (id) do nothing;

update public.taste_profiles p set facts=(
  select coalesce(jsonb_agg(case when f.value->'evidence_ids' is not null then f.value else f.value||jsonb_build_object(
    'evidence_ids',jsonb_build_array(case when f.value->>'source'='message' and f.value->>'source_id' is not null then 'chat:'||(f.value->>'source_id')||':'||md5(coalesce(f.value->>'evidence',''))
      when f.value->>'source'='style_report' then 'confirmation:'||coalesce(f.value->>'source_id','unknown')||':'||(f.value->>'field')||'/'||(f.value->>'key')
      when f.value->>'source'='operator' then 'operator:'||md5(f.value::text) else 'legacy:'||md5(f.value::text) end),
    'basis',case when f.value->>'source' in ('message','operator') then 'stated' when f.value->>'source'='style_report' then 'confirmed' else 'inferred' end) end order by f.n),'[]'::jsonb)
  from jsonb_array_elements(p.facts) with ordinality f(value,n)),version=version+1,updated_at=now()
where exists(select 1 from jsonb_array_elements(p.facts) f where f->'evidence_ids' is null);

-- Profile writes now require cited evidence.
create or replace function public.save_taste_profile(p_conversation uuid,p_version integer,p_facts jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare changed uuid;
begin
 if not facts_supported(p_conversation,p_facts) then raise exception 'Profile fact without evidence'; end if;
 insert into public.taste_profiles(conversation_id) values(p_conversation) on conflict do nothing;
 update public.taste_profiles set facts=p_facts,version=version+1,updated_at=now()
 where conversation_id=p_conversation and version=p_version returning conversation_id into changed;
 return changed is not null;
end; $$;

-- Gmail: job state stays in gmail_imports; proof goes to evidence in the same transaction.
drop function public.finish_gmail_import(uuid,integer,jsonb,text);
create function public.finish_gmail_import(p_conversation uuid,p_revision integer,p_data jsonb,p_token text,p_evidence jsonb,p_clear boolean default false)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update gmail_imports set data=p_data,token_ciphertext=p_token,lease_until=null,oauth_hash=null,oauth_expires=null,updated_at=now()
 where conversation_id=p_conversation and revision=p_revision and lease_until>now();
 if not found then return false; end if;
 if p_clear then perform delete_evidence(p_conversation,'gmail'); end if;
 perform insert_evidence(p_conversation,p_evidence);
 return true;
end; $$;

-- Style: photos only. Evidence and confirmed beliefs write atomically with the session.
drop function public.write_style(uuid,integer,jsonb,jsonb,uuid,jsonb);
create function public.write_style(p_conversation uuid,p_revision integer,p_data jsonb,
  p_source jsonb default null,p_remove uuid default null,p_clear boolean default false,p_evidence jsonb default null,p_facts jsonb default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare current_revision integer; fact jsonb; remaining jsonb;
begin
  insert into style_sessions(conversation_id) values(p_conversation) on conflict do nothing;
  select revision into current_revision from style_sessions where conversation_id=p_conversation for update;
  if current_revision<>p_revision then return false; end if;
  if p_source is not null then
    if p_source->>'kind' not in ('outfit','inspiration') then raise exception 'Receipts come from Gmail or chat'; end if;
    insert into style_sources(id,conversation_id,kind,occasion,note,mime_type,data)
    values((p_source->>'id')::uuid,p_conversation,p_source->>'kind',p_source->>'occasion',p_source->>'note',p_source->>'mime_type',p_source->>'data');
  end if;
  if p_remove is not null then delete from style_sources where id=p_remove and conversation_id=p_conversation; end if;
  -- Changing inputs retires the previous reading and the beliefs that relied only on it.
  if p_clear then perform delete_evidence(p_conversation,'style'); end if;
  perform insert_evidence(p_conversation,coalesce(p_evidence,'[]'::jsonb));
  if p_facts is not null then
    if not facts_supported(p_conversation,p_facts) then raise exception 'Profile fact without evidence'; end if;
    insert into taste_profiles(conversation_id) values(p_conversation) on conflict do nothing;
    perform 1 from taste_profiles where conversation_id=p_conversation for update;
    -- Chat statements and operator edits win; a new confirmation replaces our own previous one.
    select coalesce(jsonb_agg(value),'[]'::jsonb) into remaining from taste_profiles,jsonb_array_elements(facts)
      where conversation_id=p_conversation and value->>'source' is distinct from 'style_report';
    for fact in select value from jsonb_array_elements(p_facts) loop
      if not exists(select 1 from jsonb_array_elements(remaining) f where f->>'field'=fact->>'field' and f->>'key'=fact->>'key') then
        remaining=remaining||jsonb_build_array(fact);
      end if;
    end loop;
    if jsonb_array_length(remaining)>150 then raise exception 'Taste profile full'; end if;
    update taste_profiles set facts=remaining,version=version+1,updated_at=now() where conversation_id=p_conversation;
  end if;
  update style_sessions set data=p_data,revision=revision+1,updated_at=now() where conversation_id=p_conversation;
  return true;
end; $$;

create or replace function public.delete_style(p_conversation uuid,p_revision integer) returns boolean
language plpgsql security invoker set search_path=public as $$
declare current_revision integer;
begin
  select revision into current_revision from style_sessions where conversation_id=p_conversation for update;
  if current_revision is null or current_revision<>p_revision then return false; end if;
  delete from style_sources where conversation_id=p_conversation;
  -- Keep a revision tombstone so an in-flight analysis cannot resurrect deleted data.
  update style_sessions set revision=revision+1,data='{"notes":"","tone":"balanced","report":null}'::jsonb,
    updated_at=now() where conversation_id=p_conversation;
  perform delete_evidence(p_conversation,'style');
  return true;
end; $$;

-- Existing style readings: move photo observations into evidence and keep references in the report.
insert into public.evidence(id,conversation_id,kind,origin,source,data,recorded_by)
select 'style:'||(s.data->'report'->>'id')||':'||(o->>'id'),s.conversation_id,
  case when o->>'basis'='context' then 'user_note' else 'photo_observation' end,'style',
  jsonb_build_object('type','style_source','ids',o->'source_ids'),o,'migration'
from public.style_sessions s,jsonb_array_elements(s.data->'report'->'analysis'->'observations') o
where jsonb_typeof(s.data->'report'->'analysis'->'observations')='array'
  and not (o->'source_ids' ? 'saved-profile')
on conflict (id) do nothing;

-- Clothing range and gender become fixed values that code compares directly (men/women/unisex;
-- man/woman/non-binary). This one-time conversion maps existing free text; anything that is not
-- clearly one value is left unchanged and ignored until the user restates it.
update public.taste_profiles p set facts=(select jsonb_agg(case
  when x.f->>'field'='shopping_range' then x.f||jsonb_build_object('value',case
    when lower(x.f->>'value') ~ '\m(unisex|all genders|gender neutral)\M' then 'unisex'
    when lower(x.f->>'value') ~ '\m(women''?s?|womenswear|female)\M' and lower(x.f->>'value') !~ '\m(men''?s?|menswear|male)\M' then 'women'
    when lower(x.f->>'value') ~ '\m(men''?s?|menswear|male)\M' and lower(x.f->>'value') !~ '\m(women''?s?|womenswear|female)\M' then 'men'
    else x.f->>'value' end)
  when x.f->>'field'='gender' then x.f||jsonb_build_object('value',case
    when lower(x.f->>'value') ~ '\mnon[- ]?binary\M' then 'non-binary'
    when lower(x.f->>'value') ~ '\m(woman|female)\M' then 'woman'
    when lower(x.f->>'value') ~ '\m(man|male)\M' then 'man'
    else x.f->>'value' end)
  else x.f end order by x.n) from jsonb_array_elements(p.facts) with ordinality x(f,n)),version=version+1,updated_at=now()
where exists(select 1 from jsonb_array_elements(p.facts) f where f->>'field' in ('shopping_range','gender'));

-- Transitional: the previous deployment calls these signatures between this migration and the
-- code deploy. Gmail progress keeps working; old profile writes without evidence are rejected.
-- Drop both once the new code is live (see ARCHITECTURE.md, Deployment order).
create function public.finish_gmail_import(p_conversation uuid,p_revision integer,p_data jsonb,p_token text)
returns boolean language sql security invoker set search_path=public as $$
  select finish_gmail_import(p_conversation,p_revision,p_data,p_token,'[]'::jsonb,false);
$$;
create function public.write_style(p_conversation uuid,p_revision integer,p_data jsonb,p_source jsonb,p_remove uuid,p_facts jsonb)
returns boolean language sql security invoker set search_path=public as $$
  select write_style(p_conversation,p_revision,p_data,p_source,p_remove,coalesce(jsonb_array_length(p_facts)=0,false),null,
    case when jsonb_array_length(p_facts)>0 then p_facts end);
$$;
revoke all on function public.finish_gmail_import(uuid,integer,jsonb,text),public.write_style(uuid,integer,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_gmail_import(uuid,integer,jsonb,text),public.write_style(uuid,integer,jsonb,jsonb,uuid,jsonb) to service_role;

revoke all on function public.insert_evidence(uuid,jsonb),public.facts_supported(uuid,jsonb),public.prune_unsupported_facts(uuid),public.delete_evidence(uuid,text,text),
  public.finish_gmail_import(uuid,integer,jsonb,text,jsonb,boolean),public.write_style(uuid,integer,jsonb,jsonb,uuid,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.insert_evidence(uuid,jsonb),public.facts_supported(uuid,jsonb),public.prune_unsupported_facts(uuid),public.delete_evidence(uuid,text,text),
  public.finish_gmail_import(uuid,integer,jsonb,text,jsonb,boolean),public.write_style(uuid,integer,jsonb,jsonb,uuid,boolean,jsonb,jsonb) to service_role;
commit;
