-- Cadence API v2 — task delete (archived), subtask editing, goals, daily plan,
-- categories. Additive; apply after tasks-api.sql. Safe to re-run.
begin;

-- ---------------------------------------------------------------------------
-- 1. Deleted-task archive + tombstones. API deletes copy the full task (with
--    subtasks) here first, so any delete can be undone with
--    api_restore_task(). The ids double as tombstones: a device still holding
--    a stale copy can't re-insert the task or its subtasks (the insert is
--    silently skipped and the next pull drops it locally).
-- ---------------------------------------------------------------------------
create table if not exists public.deleted_tasks (
  id         text primary key,
  user_id    uuid not null,
  snapshot   jsonb not null,
  deleted_by text not null,
  deleted_at timestamptz not null default now()
);
alter table public.deleted_tasks enable row level security;
revoke all on public.deleted_tasks from public, anon, authenticated;

-- Subtasks deleted via the API get the same tombstone treatment.
create table if not exists public.deleted_subtasks (
  id         text primary key,
  task_id    text not null,
  deleted_at timestamptz not null default now()
);
alter table public.deleted_subtasks enable row level security;
revoke all on public.deleted_subtasks from public, anon, authenticated;

create or replace function public.skip_tombstoned_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.deleted_tasks d where d.id = new.id) then
    return null;
  end if;
  return new;
end $$;

create or replace function public.skip_tombstoned_subtask()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.deleted_tasks d where d.id = new.task_id)
     or exists (select 1 from public.deleted_subtasks d where d.id = new.id) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_skip_tombstoned on public.tasks;
create trigger tasks_skip_tombstoned before insert on public.tasks
  for each row execute function public.skip_tombstoned_task();
drop trigger if exists subtasks_skip_tombstoned on public.subtasks;
create trigger subtasks_skip_tombstoned before insert on public.subtasks
  for each row execute function public.skip_tombstoned_subtask();

-- ---------------------------------------------------------------------------
-- 2. A subtask change is a change to its task: bump the parent's updated_at
--    so expected_updated_at covers subtasks too (API and app edits alike).
--    Identical re-upserts don't count.
-- ---------------------------------------------------------------------------
create or replace function public.subtasks_touch_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set updated_at = pg_catalog.now()
    where id = coalesce(new.task_id, old.task_id);
  if tg_op = 'UPDATE' and new.task_id <> old.task_id then
    update public.tasks set updated_at = pg_catalog.now() where id = old.task_id;
  end if;
  return null;
end $$;

drop trigger if exists subtasks_touch_parent_ins_del on public.subtasks;
create trigger subtasks_touch_parent_ins_del after insert or delete on public.subtasks
  for each row execute function public.subtasks_touch_parent();
drop trigger if exists subtasks_touch_parent_upd on public.subtasks;
create trigger subtasks_touch_parent_upd after update on public.subtasks
  for each row when (old.* is distinct from new.*)
  execute function public.subtasks_touch_parent();

-- ---------------------------------------------------------------------------
-- 3. Version stamps for the jsonb blobs on users (goals, daily plan,
--    categories), bumped only when that blob actually changes. They are the
--    expected_updated_at for the goals / daily-plan / categories endpoints.
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists goals_updated_at      timestamptz not null default now();
alter table public.users add column if not exists daily_plan_updated_at timestamptz not null default now();
alter table public.users add column if not exists categories_updated_at timestamptz not null default now();

create or replace function public.users_touch_blobs()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.goals is distinct from old.goals then new.goals_updated_at := pg_catalog.now(); end if;
  if new.daily_plan is distinct from old.daily_plan then new.daily_plan_updated_at := pg_catalog.now(); end if;
  if new.categories is distinct from old.categories then new.categories_updated_at := pg_catalog.now(); end if;
  return new;
end $$;

drop trigger if exists users_touch_blobs on public.users;
create trigger users_touch_blobs before update on public.users
  for each row execute function public.users_touch_blobs();

-- ---------------------------------------------------------------------------
-- 4. Server-only RPCs (service_role). Each locks the task row, checks
--    expected_updated_at and writes in one transaction — never a partial write.
-- ---------------------------------------------------------------------------

-- Full task snapshot (row + ordered subtasks) as jsonb.
create or replace function public.api_task_snapshot(p_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object('subtasks',
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.subtask_order, s.id)
              from public.subtasks s where s.task_id = t.id), '[]'::jsonb))
  from public.tasks t where t.id = p_id
$$;

-- Archive + delete. Returns {result: deleted|not_found|conflict, task}.
create or replace function public.api_delete_task(
  p_user uuid, p_id text, p_expected timestamptz, p_actor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur timestamptz; snap jsonb;
begin
  select t.updated_at into cur from public.tasks t
    where t.id = p_id and t.user_id = p_user for update;
  if not found then
    return pg_catalog.jsonb_build_object('result', 'not_found');
  end if;
  snap := public.api_task_snapshot(p_id);
  if cur <> p_expected then
    return pg_catalog.jsonb_build_object('result', 'conflict', 'task', snap);
  end if;
  insert into public.deleted_tasks (id, user_id, snapshot, deleted_by)
    values (p_id, p_user, snap, p_actor);
  delete from public.tasks where id = p_id;
  return pg_catalog.jsonb_build_object('result', 'deleted', 'task', snap);
end $$;

-- Replace a task's subtask list (the API computes the new list). Ids absent
-- from p_subtasks are deleted; order follows array order.
-- Returns {result: ok|not_found|conflict}.
create or replace function public.api_replace_subtasks(
  p_user uuid, p_task_id text, p_expected timestamptz, p_subtasks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur timestamptz;
begin
  select t.updated_at into cur from public.tasks t
    where t.id = p_task_id and t.user_id = p_user for update;
  if not found then return pg_catalog.jsonb_build_object('result', 'not_found'); end if;
  if cur <> p_expected then return pg_catalog.jsonb_build_object('result', 'conflict'); end if;

  with gone as (
    delete from public.subtasks s
      where s.task_id = p_task_id
        and s.id not in (select e->>'id' from pg_catalog.jsonb_array_elements(p_subtasks) e)
      returning s.id
  )
  insert into public.deleted_subtasks (id, task_id)
    select id, p_task_id from gone on conflict (id) do nothing;

  insert into public.subtasks (id, task_id, title, status, level, subtask_order, percent, deadline)
    select e->>'id', p_task_id, e->>'title', e->>'status', e->>'level',
           (o - 1)::int, (e->>'percent')::int, e->>'deadline'
    from pg_catalog.jsonb_array_elements(p_subtasks) with ordinality as x(e, o)
    on conflict (id) do update set
      title = excluded.title, status = excluded.status, level = excluded.level,
      subtask_order = excluded.subtask_order, percent = excluded.percent,
      deadline = excluded.deadline
    where public.subtasks.task_id = p_task_id;
  return pg_catalog.jsonb_build_object('result', 'ok');
end $$;

-- Manual recovery (SQL editor / service role only):
--   select public.api_restore_task('task-…');
create or replace function public.api_restore_task(p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare snap jsonb;
begin
  delete from public.deleted_tasks where id = p_id returning snapshot into snap;
  if snap is null then raise exception 'No archived task %', p_id; end if;
  insert into public.tasks
    select * from pg_catalog.jsonb_populate_record(null::public.tasks, snap - 'subtasks');
  insert into public.subtasks
    select * from pg_catalog.jsonb_populate_recordset(null::public.subtasks, snap->'subtasks');
  return public.api_task_snapshot(p_id);
end $$;

revoke all on function public.skip_tombstoned_task() from public, anon, authenticated;
revoke all on function public.skip_tombstoned_subtask() from public, anon, authenticated;
revoke all on function public.subtasks_touch_parent() from public, anon, authenticated;
revoke all on function public.api_task_snapshot(text) from public, anon, authenticated;
revoke all on function public.api_delete_task(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.api_replace_subtasks(uuid, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.api_restore_task(text) from public, anon, authenticated;
grant execute on function public.api_delete_task(uuid, text, timestamptz, text) to service_role;
grant execute on function public.api_replace_subtasks(uuid, text, timestamptz, jsonb) to service_role;
grant execute on function public.api_restore_task(text) to service_role;
commit;
