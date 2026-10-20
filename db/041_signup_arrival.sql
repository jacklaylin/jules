-- How a signup arrived (lib/public-signup.js): the referring site's host and the link's utm_ tags.
-- Run once in the Supabase SQL editor. Safe to deploy the code first: until this runs, signups save
-- without these fields and log signup_arrival_unsaved. Only short codes and a host name are stored, never a full URL.
alter table public.public_signups
 add column if not exists referrer_host text check (referrer_host ~ '^[a-z0-9.-]{4,253}$'),
 add column if not exists utm_source text check (utm_source ~ '^[a-z0-9._-]{1,60}$'),
 add column if not exists utm_medium text check (utm_medium ~ '^[a-z0-9._-]{1,60}$'),
 add column if not exists utm_campaign text check (utm_campaign ~ '^[a-z0-9._-]{1,60}$');
