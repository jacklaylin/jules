begin;
create table public.wishlist_members (
  email text primary key check (email = lower(email)),
  conversation_id uuid not null references public.conversations(id) on delete cascade
);
create table public.wishlist_revoked_sessions (
  token_hash text primary key,
  revoked_at timestamptz not null default now()
);
create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  product_url text not null,
  product jsonb not null,
  saved_at timestamptz not null default now(),
  unique(conversation_id, product_url)
);
create table public.wishlist_encounters (
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  reply_id uuid not null references public.messages(id) on delete cascade,
  source_image_id uuid references public.message_images(id) on delete set null,
  product jsonb not null,
  primary key(item_id, reply_id)
);
alter table public.messages add column wishlist_payload jsonb;
alter table public.messages add column wishlist_saved boolean not null default false;
alter table public.wishlist_revoked_sessions enable row level security;
revoke all on public.wishlist_revoked_sessions from anon, authenticated;
grant all on public.wishlist_revoked_sessions to service_role;
alter table public.wishlist_members enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.wishlist_encounters enable row level security;
revoke all on public.wishlist_members, public.wishlist_items, public.wishlist_encounters from anon, authenticated;
grant all on public.wishlist_members, public.wishlist_items, public.wishlist_encounters to service_role;
create function public.save_wishlist_reply(p_operation text) returns void
language plpgsql security invoker set search_path = public as $$
declare reply public.messages; entry jsonb; item uuid;
begin
  select * into reply from public.messages where operation_id=p_operation for update;
  if reply.status <> 'sent' or reply.source <> 'ai' or reply.wishlist_payload is null or reply.wishlist_saved then return; end if;
  for entry in select value from jsonb_array_elements(reply.wishlist_payload) loop
    if entry->>'source_image_id' is not null and not exists (
      select 1 from public.message_images i join public.messages m on m.id=i.message_id
      where i.id=(entry->>'source_image_id')::uuid and m.conversation_id=reply.conversation_id
    ) then raise exception 'Source image does not belong to conversation'; end if;
    insert into public.wishlist_items(conversation_id,product_url,product,saved_at)
      values(reply.conversation_id,entry->>'url',entry,reply.created_at)
      on conflict(conversation_id,product_url) do update set product=excluded.product,saved_at=excluded.saved_at
      returning id into item;
    insert into public.wishlist_encounters(item_id,reply_id,source_image_id,product)
      values(item,reply.id,(entry->>'source_image_id')::uuid,entry)
      on conflict do nothing;
  end loop;
  update public.messages set wishlist_saved=true where id=reply.id;
end;
$$;
revoke all on function public.save_wishlist_reply(text) from public,anon,authenticated;
grant execute on function public.save_wishlist_reply(text) to service_role;
commit;
