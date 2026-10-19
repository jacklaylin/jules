-- Signup source (/signup?ref=…, lib/public-signup.js). Run once in the Supabase SQL editor.
-- Safe to deploy the code first: until this runs, signups save without their source and log signup_ref_unsaved.
-- Only a short code is stored (a-z, 0-9, _ and -, at most 40 characters), never a full URL.
alter table public.public_signups add column if not exists ref text check (ref ~ '^[a-z0-9_-]{1,40}$');
