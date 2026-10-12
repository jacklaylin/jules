begin;
alter table public.public_signups add column if not exists profile jsonb not null default '{}'::jsonb;
create function public.record_public_signup(p_request uuid,p_phone text,p_consent_version text,p_consent_text text,p_connection_hash text,p_profile jsonb)
returns text language plpgsql security invoker set search_path=public as $$
declare outcome text;
begin
 outcome:=record_public_signup(p_request,p_phone,p_consent_version,p_consent_text,p_connection_hash);
 if outcome='saved' then update public_signups set profile=p_profile where request_id=p_request and profile='{}'::jsonb; end if;
 return outcome;
end; $$;
create table public.login_challenges(id uuid primary key,phone text not null,connection_hash text not null,email text,created_at timestamptz not null default now(),attempts integer not null default 0,used boolean not null default false);
alter table public.login_challenges enable row level security;
revoke all on public.login_challenges from public,anon,authenticated;
grant all on public.login_challenges to service_role;
create function public.begin_phone_login(p_id uuid,p_phone text,p_connection text,p_email text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_connection,1));
 perform pg_advisory_xact_lock(hashtextextended(p_phone,2));
 if (select count(*) from login_challenges where connection_hash=p_connection and created_at>now()-interval '1 hour')>=10 or (select count(*) from login_challenges where phone=p_phone and created_at>now()-interval '1 hour')>=5 then return false; end if;
 update login_challenges set used=true where phone=p_phone;
 insert into login_challenges(id,phone,connection_hash,email) values(p_id,p_phone,p_connection,p_email);
 return true;
end; $$;
create function public.attempt_phone_login(p_id uuid)
returns text language plpgsql security invoker set search_path=public as $$
declare target text;
begin
 update login_challenges set attempts=attempts+1 where id=p_id and not used and attempts<5 and created_at>now()-interval '10 minutes' returning email into target;
 return target;
end; $$;
revoke all on function public.record_public_signup(uuid,text,text,text,text,jsonb),public.begin_phone_login(uuid,text,text,text),public.attempt_phone_login(uuid) from public,anon,authenticated;
grant execute on function public.record_public_signup(uuid,text,text,text,text,jsonb),public.begin_phone_login(uuid,text,text,text),public.attempt_phone_login(uuid) to service_role;
commit;
