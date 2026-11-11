-- Permanent basketball court catalog foundation.
-- Local migration only — do not apply until explicitly approved.

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  city text,
  region text,
  country text,
  source text not null,
  source_id text not null,
  verification_status text not null default 'unverified'
    check (verification_status = any (array['unverified'::text, 'verified'::text, 'rejected'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courts_latitude_range check (latitude >= -90::double precision and latitude <= 90::double precision),
  constraint courts_longitude_range check (longitude >= -180::double precision and longitude <= 180::double precision),
  constraint courts_name_not_blank check (length(trim(name)) > 0),
  constraint courts_source_not_blank check (length(trim(source)) > 0),
  constraint courts_source_id_not_blank check (length(trim(source_id)) > 0),
  constraint courts_source_source_id_key unique (source, source_id)
);

comment on table public.courts is 'Canonical basketball courts for map queries by bounding box.';
comment on column public.courts.source is 'Upstream origin, e.g. overpass, manual, fallback.';
comment on column public.courts.source_id is 'Stable id within the source system.';
comment on column public.courts.verification_status is 'unverified | verified | rejected';

-- Ensure blank-text checks exist even if an earlier table create omitted them.
alter table public.courts drop constraint if exists courts_name_not_blank;
alter table public.courts add constraint courts_name_not_blank check (length(trim(name)) > 0);
alter table public.courts drop constraint if exists courts_source_not_blank;
alter table public.courts add constraint courts_source_not_blank check (length(trim(source)) > 0);
alter table public.courts drop constraint if exists courts_source_id_not_blank;
alter table public.courts add constraint courts_source_id_not_blank check (length(trim(source_id)) > 0);

-- Bounding-box lookups filter latitude then longitude.
create index if not exists courts_latitude_longitude_idx
  on public.courts using btree (latitude, longitude);

create index if not exists courts_longitude_idx
  on public.courts using btree (longitude);

create index if not exists courts_verification_status_idx
  on public.courts using btree (verification_status);

alter table public.courts enable row level security;

-- Public read for anon + authenticated: verified courts only.
-- No insert/update/delete policies for those roles, so writes remain denied under RLS.
-- Drop first so the migration can be re-applied safely after a partial run.
drop policy if exists "Courts are publicly readable" on public.courts;

create policy "Courts are publicly readable"
  on public.courts
  for select
  to anon, authenticated
  using (verification_status = 'verified');

grant select on table public.courts to anon, authenticated;
revoke insert, update, delete on table public.courts from anon, authenticated;
