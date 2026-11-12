-- Persistent per-user rate limiting for court discovery ingest.
-- Local migration only — do not apply until explicitly approved.
-- Does not modify public.courts.

create schema if not exists private;

create table if not exists private.court_ingest_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0
    check (request_count >= 0)
);

comment on table private.court_ingest_rate_limits is
  'Atomic per-user windows for upsert-discovered-courts (service_role only).';

alter table private.court_ingest_rate_limits enable row level security;

-- No policies for anon/authenticated: only service_role / definer RPC may touch this table.
revoke all on table private.court_ingest_rate_limits from public, anon, authenticated;
grant all on table private.court_ingest_rate_limits to postgres, service_role;

/**
 * Atomically consume one request from the user's rolling window.
 * Returns jsonb: { allowed, remaining, request_count, reason? }
 * Callable only by service_role.
 */
create or replace function public.consume_court_ingest_rate_limit(
  p_user_id uuid,
  p_max_requests integer default 10,
  p_window_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = private, public
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

revoke all on function public.consume_court_ingest_rate_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_court_ingest_rate_limit(uuid, integer, integer)
  to service_role;
