-- Persistent per-user + global rate limiting for court discovery ingest.
-- Local migration only — do not apply until explicitly approved.
-- Does not modify public.courts.

create schema if not exists private;

-- Do NOT revoke/alter schema-level privileges on private.
-- process-notification-outbox already uses private.notification_outbox via
-- SUPABASE_DB_URL; its connection role is not readable from secrets, so existing
-- private schema USAGE must be preserved. Lockdown is table-scoped below.

create table if not exists private.court_ingest_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0
    check (request_count >= 0)
);

comment on table private.court_ingest_rate_limits is
  'Atomic per-user windows for upsert-discovered-courts (service_role / definer RPC only).';

alter table private.court_ingest_rate_limits enable row level security;

revoke all on table private.court_ingest_rate_limits from public, anon, authenticated;
grant all on table private.court_ingest_rate_limits to postgres, service_role;

-- Singleton global Overpass budget (consumed only when a fetch is required).
create table if not exists private.court_ingest_global_rate_limits (
  bucket text primary key default 'default',
  window_started_at timestamptz not null,
  request_count integer not null default 0
    check (request_count >= 0)
);

comment on table private.court_ingest_global_rate_limits is
  'Atomic global Overpass windows for upsert-discovered-courts (service_role / definer RPC only).';

alter table private.court_ingest_global_rate_limits enable row level security;

revoke all on table private.court_ingest_global_rate_limits from public, anon, authenticated;
grant all on table private.court_ingest_global_rate_limits to postgres, service_role;

insert into private.court_ingest_global_rate_limits (bucket, window_started_at, request_count)
values ('default', now(), 0)
on conflict (bucket) do nothing;

-- Drop prior combined overloads from earlier Phase 2 drafts.
drop function if exists public.consume_court_ingest_rate_limit(uuid, integer, integer);
drop function if exists public.consume_court_ingest_rate_limit(uuid, integer, integer, integer, integer);

/**
 * Atomically consume one per-user ingest request slot.
 * Does not touch the global Overpass budget.
 */
create or replace function public.consume_court_ingest_user_rate_limit(
  p_user_id uuid,
  p_max_requests integer default 10,
  p_window_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = private, pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'request_count', 0,
      'reason', 'missing_user'
    );
  end if;

  if p_max_requests is null or p_max_requests < 1 then
    p_max_requests := 10;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    p_window_seconds := 600;
  end if;
  if p_max_requests > 100 then
    p_max_requests := 100;
  end if;

  insert into private.court_ingest_rate_limits as t (user_id, window_started_at, request_count)
  values (p_user_id, v_now, 0)
  on conflict (user_id) do nothing;

  select window_started_at, request_count
    into v_window, v_count
  from private.court_ingest_rate_limits
  where user_id = p_user_id
  for update;

  if v_window <= v_now - make_interval(secs => p_window_seconds) then
    v_window := v_now;
    v_count := 0;
  end if;

  if v_count >= p_max_requests then
    update private.court_ingest_rate_limits
    set window_started_at = v_window,
        request_count = v_count
    where user_id = p_user_id;

    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'request_count', v_count,
      'reason', 'rate_limited'
    );
  end if;

  v_count := v_count + 1;

  update private.court_ingest_rate_limits
  set window_started_at = v_window,
      request_count = v_count
  where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_max_requests - v_count, 0),
    'request_count', v_count
  );
end;
$$;

revoke all on function public.consume_court_ingest_user_rate_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_court_ingest_user_rate_limit(uuid, integer, integer)
  to service_role;

/**
 * Atomically consume one global Overpass budget slot.
 * Call only when at least one OSM ID requires an Overpass fetch.
 * Concurrent callers serialize on the singleton row FOR UPDATE — no bypass.
 */
create or replace function public.consume_court_ingest_global_rate_limit(
  p_max_requests integer default 100,
  p_window_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = private, pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if p_max_requests is null or p_max_requests < 1 then
    p_max_requests := 100;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    p_window_seconds := 600;
  end if;
  if p_max_requests > 1000 then
    p_max_requests := 1000;
  end if;

  insert into private.court_ingest_global_rate_limits as g (bucket, window_started_at, request_count)
  values ('default', v_now, 0)
  on conflict (bucket) do nothing;

  select window_started_at, request_count
    into v_window, v_count
  from private.court_ingest_global_rate_limits
  where bucket = 'default'
  for update;

  if v_window <= v_now - make_interval(secs => p_window_seconds) then
    v_window := v_now;
    v_count := 0;
  end if;

  if v_count >= p_max_requests then
    update private.court_ingest_global_rate_limits
    set window_started_at = v_window,
        request_count = v_count
    where bucket = 'default';

    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'request_count', v_count,
      'global_remaining', 0,
      'reason', 'global_rate_limited'
    );
  end if;

  v_count := v_count + 1;

  update private.court_ingest_global_rate_limits
  set window_started_at = v_window,
      request_count = v_count
  where bucket = 'default';

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_max_requests - v_count, 0),
    'request_count', v_count,
    'global_remaining', greatest(p_max_requests - v_count, 0)
  );
end;
$$;

revoke all on function public.consume_court_ingest_global_rate_limit(integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_court_ingest_global_rate_limit(integer, integer)
  to service_role;
