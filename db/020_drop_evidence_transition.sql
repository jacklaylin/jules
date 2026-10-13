-- Run after the evidence/agent release is verified in production (see ARCHITECTURE.md, Deployment order).
-- Removes the transitional function signatures used only by the previous deployment, and the
-- pre-migration safety copies. Irreversible: confirm the release first.
begin;
drop function public.finish_gmail_import(uuid,integer,jsonb,text);
drop function public.write_style(uuid,integer,jsonb,jsonb,uuid,jsonb);
drop table public._backup_019_taste_profiles;
drop table public._backup_019_style_sessions;
drop table public._backup_019_gmail_imports;
commit;
