-- Smaller purchase-history saves (lib/history-patch.js). Run once in the Supabase SQL editor, after 050_report_card_events.sql.
-- Safe to deploy the code first: until this runs, saves fall back to writing the whole history row as before.
-- A chat answer ("keeping it") changed a few KB of the person's ~600 KB history row, but every save sent the whole
-- row back (about 2.6s per answer, October 23). This writes only the top-level keys that changed, under the same
-- lease and revision check as finish_gmail_import, and records the evidence the same way.
begin;
create or replace function public.patch_gmail_import(p_conversation uuid,p_revision integer,p_set jsonb,p_remove text[],p_evidence jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update gmail_imports set data=(data - coalesce(p_remove,'{}'::text[])) || coalesce(p_set,'{}'::jsonb),lease_until=null,oauth_hash=null,oauth_expires=null,updated_at=now()
 where conversation_id=p_conversation and revision=p_revision and lease_until>now();
 if not found then return false; end if;
 perform insert_evidence(p_conversation,coalesce(p_evidence,'[]'::jsonb));
 return true;
end; $$;
revoke all on function public.patch_gmail_import(uuid,integer,jsonb,text[],jsonb) from public,anon,authenticated;
grant execute on function public.patch_gmail_import(uuid,integer,jsonb,text[],jsonb) to service_role;
commit;
