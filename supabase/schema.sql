-- ===========================================================================
-- Cadence — Supabase schema (cloud-synced Postgres, auth-scoped)
-- ===========================================================================
-- Run once per project in the Supabase SQL editor (Dashboard → SQL → New
-- query). Creates the three tables that mirror the Zustand state types in
-- `src/store/use-prod-store.ts`, wires them to Supabase Auth, and enables Row
-- Level Security so each user can only read/write their own data.
--
-- Identity model: real Supabase Auth. `public.users.id` references
-- `auth.users(id)`, and RLS matches rows against `auth.uid()` (the id baked
-- into the caller's JWT). The browser client sends that JWT automatically via
-- the auth session cookie — no custom headers required.
--
-- Type mapping (TS  ->  SQL):
--   Task.id              -> tasks.id               text  (keeps "task-<uuid>" ids)
--   Task.title           -> tasks.title            text
--   Task.status          -> tasks.status           text  (TaskStatus union)
--   Task.priority        -> tasks.priority         text  (TaskPriority union)
--   Task.deadline        -> tasks.deadline         text  (yyyy-MM-dd)
--   Task.category        -> tasks.category         text  (defaults 'General')
--   Task.subcategory     -> tasks.subcategory      text  (second-level group, '')
--   Task.recurrence      -> tasks.recurrence       text  (Recurrence union)
--   Task.pomodorosLogged -> tasks.pomodoros_logged integer
--   Task.order           -> tasks.task_order       integer ("order" is reserved)
--   Task.isEvening       -> tasks.is_evening       boolean (This Evening split)
--   Subtask.id           -> subtasks.id            text
--   Subtask.title        -> subtasks.title         text
--   Subtask.status       -> subtasks.status        text  (SubtaskStatus union)
--   Subtask.level        -> subtasks.level         text  (SubtaskLevel union)
--   Subtask.percent      -> subtasks.percent        integer (0–100, null = parent)
--   Subtask.deadline     -> subtasks.deadline       text  (yyyy-MM-dd, null unset)
--   (array index)        -> subtasks.subtask_order integer (preserves ordering)
--   categories (managed) -> users.categories       text[] (ordered board columns)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. users — one profile row per authenticated account, keyed to auth.users.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  -- Managed, ordered category list (board columns). Persists empty columns so
  -- a category doesn't vanish when its last task is dragged away.
  categories text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

-- Existing installs: add the managed category list if it predates this field.
alter table public.users
  add column if not exists categories text[] not null default '{}'::text[];

-- ---------------------------------------------------------------------------
-- 2. tasks — board rows, owned by a user and manually ordered.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id               text primary key,
  user_id          uuid not null references public.users (id) on delete cascade,
  title            text not null default '',
  status           text not null default 'Not Started'
                     check (status in ('Working on it', 'Stuck', 'Done', 'Not Started', 'Inbox')),
  priority         text not null default 'Medium'
                     check (priority in ('Low', 'Medium', 'High', 'Critical')),
  deadline         text not null default '',
  category         text not null default 'General',
  subcategory      text not null default '',
  recurrence       text not null default 'none'
                     check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'quarterly')),
  pomodoros_logged integer not null default 0 check (pomodoros_logged >= 0),
  task_order       integer not null default 0,
  -- Manual completion percent (0–100); null when the task derives progress from
  -- its micro-tasks instead of a manual override.
  progress         integer check (progress is null or (progress >= 0 and progress <= 100)),
  -- "This Evening" flag: surfaces the task under a separate after-hours header
  -- on the dashboard. Defaults false (a normal daytime task).
  is_evening       boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- Existing installs: add the subcategory column if it predates this field.
alter table public.tasks
  add column if not exists subcategory text not null default '';

-- Existing installs: widen the recurrence check to allow 'quarterly'.
alter table public.tasks
  drop constraint if exists tasks_recurrence_check;
alter table public.tasks
  add constraint tasks_recurrence_check
    check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'quarterly'));

-- Existing installs: widen the status check to allow the 'Inbox' holding pen.
alter table public.tasks
  drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
    check (status in ('Working on it', 'Stuck', 'Done', 'Not Started', 'Inbox'));

-- Existing installs: add the "This Evening" after-hours flag.
alter table public.tasks
  add column if not exists is_evening boolean not null default false;

-- Existing installs: add the manual completion-percent override column.
alter table public.tasks
  add column if not exists progress integer
    check (progress is null or (progress >= 0 and progress <= 100));

create index if not exists tasks_user_order_idx
  on public.tasks (user_id, task_order);

-- ---------------------------------------------------------------------------
-- 3. subtasks — nested micro-tasks (L1/L2/L3) belonging to a task. Ownership
--    is inherited from the parent task, so no user_id column is needed.
-- ---------------------------------------------------------------------------
create table if not exists public.subtasks (
  id            text primary key,
  task_id       text not null references public.tasks (id) on delete cascade,
  title         text not null default '',
  status        text not null default 'todo' check (status in ('todo', 'done')),
  level         text not null default 'L1'   check (level in ('L1', 'L2', 'L3')),
  subtask_order integer not null default 0,
  -- Leaf completion percent (0–100); null on parent/legacy rows. Parent rows
  -- show an average of their children, computed client-side.
  percent       integer check (percent is null or (percent >= 0 and percent <= 100)),
  -- Optional per-micro-task due date (yyyy-MM-dd); null when unset.
  deadline      text
);

-- Existing installs: add the per-micro-task progress + deadline columns.
alter table public.subtasks
  add column if not exists percent integer
    check (percent is null or (percent >= 0 and percent <= 100));
alter table public.subtasks
  add column if not exists deadline text;

create index if not exists subtasks_task_order_idx
  on public.subtasks (task_id, subtask_order);

-- ===========================================================================
-- Auto-provision a public.users row when an auth user is created
-- ===========================================================================
-- Keeps public.users in sync with auth.users so a freshly signed-up account
-- always has a profile row (and email) to hang tasks off of.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- Row Level Security — users can only touch their own data
-- ===========================================================================
-- The browser uses the public anon key, so RLS is what actually protects data.
-- Every policy resolves identity from auth.uid() (the caller's JWT subject).

alter table public.users    enable row level security;
alter table public.tasks    enable row level security;
alter table public.subtasks enable row level security;

-- users: a caller may only see and edit their own profile row.
create policy "users select own" on public.users
  for select using (auth.uid() = id);
create policy "users insert own" on public.users
  for insert with check (auth.uid() = id);
create policy "users update own" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- tasks: scoped directly by user_id.
create policy "tasks select own" on public.tasks
  for select using (auth.uid() = user_id);
create policy "tasks insert own" on public.tasks
  for insert with check (auth.uid() = user_id);
create policy "tasks update own" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks delete own" on public.tasks
  for delete using (auth.uid() = user_id);

-- subtasks: ownership is inherited from the parent task.
create policy "subtasks select own" on public.subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
create policy "subtasks insert own" on public.subtasks
  for insert with check (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
create policy "subtasks update own" on public.subtasks
  for update using (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
create policy "subtasks delete own" on public.subtasks
  for delete using (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
