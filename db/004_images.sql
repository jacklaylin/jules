-- Small prototype: bounded private image bytes alongside messages, no public bucket.
create table if not exists public.message_images (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  position integer not null check (position between 0 and 2),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  data text not null check (length(data) between 1 and 4194304),
  unique(message_id,position)
);
alter table public.message_images enable row level security;
revoke all on public.message_images from anon, authenticated;
grant all on public.message_images to service_role;
alter table public.messages add column if not exists image_status text check (image_status in ('saved','failed'));
