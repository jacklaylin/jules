-- Avoid repeatedly decompressing inline photo bytes for every projected JSON field.
-- Only the existing server role can read this view; underlying RLS stays in force.
begin;
create or replace view public.wishlist_entry_metadata with (security_invoker=true) as
select w.conversation_id, e.item_id, e.reply_id, e.source_image_id,
       e.product - array['image','additional_images','listing_check','product_data']::text[] as metadata,
       e.product->'image'->>'mime_type' as has_image,
       m.created_at as reply_at, im.created_at as source_at
from public.wishlist_encounters e
join public.wishlist_items w on w.id=e.item_id
join public.messages m on m.id=e.reply_id
left join public.message_images i on i.id=e.source_image_id
left join public.messages im on im.id=i.message_id;
revoke all on public.wishlist_entry_metadata from public, anon, authenticated;
grant select on public.wishlist_entry_metadata to service_role;
notify pgrst, 'reload schema';
commit;
