-- Search evidence is part of the already-private message history.
alter table public.messages add column if not exists search_result jsonb
  check (search_result is null or (jsonb_typeof(search_result)='object' and octet_length(search_result::text)<=30000));
