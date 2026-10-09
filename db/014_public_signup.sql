-- Early-access signup only. No outbound messages are sent by this migration.
begin;
create table public.public_signups (
 request_id uuid primary key,
 phone_number text not null check(phone_number ~ '^\+[1-9][0-9]{7,14}$'),
 consent_version text not null,
 consent_text text not null,
 consent_at timestamptz not null default now(),
 connection_hash text not null,
 number_verified_at timestamptz,
 welcome_status text not null default 'not_enabled' check(welcome_status in ('not_enabled','pending','sent','uncertain'))
);
create index public_signups_connection_time on public.public_signups(connection_hash,consent_at);
alter table public.public_signups enable row level security;
revoke all on public.public_signups from public,anon,authenticated;
grant all on public.public_signups to service_role;
create function public.record_public_signup(p_request uuid,p_phone text,p_consent_version text,p_consent_text text,p_connection_hash text)
returns text language plpgsql security invoker set search_path=public as $$
begin
 -- Serialize rate checks and inserts for a connection, including concurrent requests.
 perform pg_advisory_xact_lock(hashtextextended(p_connection_hash,0));
 if exists(select 1 from public_signups where request_id=p_request) then
  if exists(select 1 from public_signups where request_id=p_request and phone_number=p_phone and consent_version=p_consent_version) then return 'saved'; end if;
  return 'limited';
 end if;
 if (select count(*) from public_signups where connection_hash=p_connection_hash and consent_at>now()-interval '1 hour')>=5 then return 'limited'; end if;
 insert into public_signups(request_id,phone_number,consent_version,consent_text,connection_hash)
 values(p_request,p_phone,p_consent_version,p_consent_text,p_connection_hash);
 return 'saved';
end;
$$;
revoke all on function public.record_public_signup(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_public_signup(uuid,text,text,text,text) to service_role;
commit;
