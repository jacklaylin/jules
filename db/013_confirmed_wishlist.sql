-- Explicit save consent persists before Jules confirms it. Image auto-saves still
-- use save_wishlist_reply and require an accepted outbound identification reply.
begin;
create function public.save_confirmed_wishlist_reply(p_operation text) returns void
language plpgsql security invoker set search_path=public as $$
declare reply public.messages; entry jsonb; item uuid;
begin
  select * into reply from public.messages where operation_id=p_operation for update;
  if not found or reply.source <> 'ai' or reply.status not in ('generating','sending','sent')
    or reply.search_result->>'identification_policy' is distinct from 'text_wishlist'
    or reply.search_result->>'user_confirmed' is distinct from 'true'
    or reply.wishlist_payload is null then raise exception 'Confirmed save missing'; end if;
  if reply.wishlist_saved then return; end if;
  if jsonb_array_length(reply.wishlist_payload)=0 then raise exception 'Empty confirmed save'; end if;
  for entry in select value from jsonb_array_elements(reply.wishlist_payload) loop
    if not exists(select 1 from jsonb_array_elements(reply.search_result->'products') p
      where p->>'url'=entry->>'url') then raise exception 'Unselected product'; end if;
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
revoke all on function public.save_confirmed_wishlist_reply(text) from public,anon,authenticated;
grant execute on function public.save_confirmed_wishlist_reply(text) to service_role;
commit;
