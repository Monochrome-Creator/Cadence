-- Cadence Tasks REST API (/api/tasks) — additive schema. Review and apply
-- separately from schema.sql. Safe to re-run. No existing column, policy or
-- client code path is changed; the app never sends updated_at or completed_at.
begin;

-- 1. completed_at: stamped when a task becomes Done (API or app), cleared on
--    reopen. Existing Done tasks stay null — their real completion time is
--    unknown and is not back-filled.
alter table public.tasks add column if not exists completed_at timestamptz;

-- 2. Keep updated_at honest. The app upserts task rows without updated_at, so
--    until now it only ever held the insert time — useless for the API's
--    optimistic concurrency (expected_updated_at). Bump it on every update that
--    actually changes the row (identical re-upserts don't count), so an edit in
--    the app makes a stale API write 409 instead of silently overwriting it.
create or replace function public.tasks_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  if new.status = 'Done' and old.status <> 'Done' then
    new.completed_at := coalesce(new.completed_at, pg_catalog.now());
  elsif new.status <> 'Done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
  before update on public.tasks
  for each row when (old.* is distinct from new.*)
  execute function public.tasks_touch();

-- 3. Per-key fixed-window rate limit (60 req/min), shared across serverless
--    instances. Server-only: RLS on, no policies, no anon/authenticated access.
create table if not exists public.api_rate_limits (
  key_id       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key_id, window_start)
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;

-- Counts one request and returns the window's running total plus the seconds
-- until the window resets (for Retry-After). Prunes windows older than 1h.
create or replace function public.api_rate_limit_hit(p_key_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  win timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  total integer;
begin
  insert into public.api_rate_limits as r (key_id, window_start, hits)
    values (p_key_id, win, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1
    returning r.hits into total;
  delete from public.api_rate_limits
    where window_start < pg_catalog.now() - interval '1 hour';
  return pg_catalog.jsonb_build_object(
    'hits', total,
    'reset_in', pg_catalog.ceil(extract(epoch from (win + interval '1 minute' - pg_catalog.now())))::int
  );
end $$;

revoke all on function public.api_rate_limit_hit(text) from public, anon, authenticated;
grant execute on function public.api_rate_limit_hit(text) to service_role;
commit;
