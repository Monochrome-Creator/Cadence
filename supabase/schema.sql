-- ===========================================================================
-- Cadence — Supabase schema (cloud-synced Postgres, auth-scoped)
-- ===========================================================================
-- Run once per project in the Supabase SQL editor (Dashboard → SQL → New
-- query). Creates the tables that mirror the Zustand state types in
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
  -- Auto-planner state: { plan: { date, mainTaskIds }, review: { date, taskIds } }.
  -- Synced like categories (no dedicated table); see src/store/cloud-sync.ts.
  daily_plan jsonb,
  -- North Star goals + flashcards: stored whole as jsonb on the user row (no
  -- dedicated table). Synced like daily_plan; see src/store/cloud-sync.ts.
  goals jsonb,
  flashcards jsonb,
  -- Mandala core label + themes (each holding its success behaviours), stored
  -- whole as one jsonb blob. Synced like goals; see src/store/cloud-sync.ts.
  mandala jsonb,
  -- Memento Mori: birth date, life expectancy, checked weeks — one jsonb blob.
  -- Synced like mandala; see src/store/cloud-sync.ts.
  memento_mori jsonb,
  created_at timestamptz not null default now()
);

-- Existing installs: add the managed category list if it predates this field.
alter table public.users
  add column if not exists categories text[] not null default '{}'::text[];

-- Existing installs: add the auto-planner (Daily Plan) state column.
alter table public.users
  add column if not exists daily_plan jsonb;

-- Existing installs: add the North Star goals + flashcards state columns.
alter table public.users
  add column if not exists goals jsonb;
alter table public.users
  add column if not exists flashcards jsonb;

-- Existing installs: add the Mandala (core + themes) state column.
alter table public.users
  add column if not exists mandala jsonb;

-- Existing installs: add the Memento Mori state column.
alter table public.users
  add column if not exists memento_mori jsonb;

-- ---------------------------------------------------------------------------
-- 2. tasks — board rows, owned by a user and manually ordered.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id               text primary key,
  user_id          uuid not null references public.users (id) on delete cascade,
  title            text not null default '',
  status           text not null default 'Not Started'
                     check (status in ('Working on it', 'On-Going', 'Stuck', 'Done', 'Not Started', 'Inbox')),
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
  -- GTD "Today" promotion flag. A workspace task (status <> 'Inbox') with
  -- is_today=true is a non-negotiable Daily Action item shown on the Dashboard;
  -- false keeps it in the Workspace master backlog. Capped at 5 active per day
  -- client-side. Defaults false.
  is_today         boolean not null default false,
  -- "Four Pillars" life-area attribution. Null for general/untagged tasks.
  life_pillar      text
                     check (life_pillar is null or life_pillar in ('Wealth', 'Health', 'Career', 'Personal_IP')),
  -- Calendar-period reset stamp for recurring tasks. Stores the period key of
  -- the period in which the task was last completed (e.g. '2026-W24', '2026-06',
  -- '2026-Q2'). When the current period's key differs, the task reopens.
  last_completed_period text,
  -- Times the deadline has been pushed back via the overdue review. Drives the
  -- "moved N×" badge and the 3-strikes escalation. Defaults 0.
  postpone_count   integer not null default 0 check (postpone_count >= 0),
  -- Linked North Star goal id (goal-<uuid>). Goals live as jsonb on the user
  -- row (no goals table), so this is a plain nullable text reference, not a FK.
  -- Null when the task isn't anchored to a goal.
  goal_id          text,
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

-- Existing installs: widen the status check to allow the 'Inbox' holding pen
-- and the 'On-Going' status for repeating (daily/weekly/monthly/annual) tasks.
alter table public.tasks
  drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
    check (status in ('Working on it', 'On-Going', 'Stuck', 'Done', 'Not Started', 'Inbox'));

-- Existing installs: add the "This Evening" after-hours flag.
alter table public.tasks
  add column if not exists is_evening boolean not null default false;

-- Existing installs: add the GTD "Today" promotion flag.
alter table public.tasks
  add column if not exists is_today boolean not null default false;

-- Existing installs: add the overdue-review postpone counter.
alter table public.tasks
  add column if not exists postpone_count integer not null default 0
    check (postpone_count >= 0);

-- Existing installs: add the North Star goal link.
alter table public.tasks
  add column if not exists goal_id text;

-- Existing installs: add the manual completion-percent override column.
alter table public.tasks
  add column if not exists progress integer
    check (progress is null or (progress >= 0 and progress <= 100));

-- Existing installs: add the "Four Pillars" life-area attribution column.
alter table public.tasks
  add column if not exists life_pillar text;
alter table public.tasks
  drop constraint if exists tasks_life_pillar_check;
alter table public.tasks
  add constraint tasks_life_pillar_check
    check (life_pillar is null or life_pillar in ('Wealth', 'Health', 'Career', 'Personal_IP'));

-- Existing installs: add the calendar-period reset stamp for recurring tasks.
alter table public.tasks
  add column if not exists last_completed_period text;

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
  status        text not null default 'todo' check (status in ('todo', 'done', 'cancelled')),
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

-- Existing installs: widen the subtask status check to allow 'cancelled'
-- (a crossed-out micro-task that no longer counts toward progress).
alter table public.subtasks
  drop constraint if exists subtasks_status_check;
alter table public.subtasks
  add constraint subtasks_status_check
    check (status in ('todo', 'done', 'cancelled'));

create index if not exists subtasks_task_order_idx
  on public.subtasks (task_id, subtask_order);

-- ---------------------------------------------------------------------------
-- 4. push_subscriptions — Web Push endpoints, one row per device/browser a
--    user has enabled notifications on (e.g. the Sunday Memento Mori
--    reminder). A dedicated table because a user can have multiple devices.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

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

alter table public.users             enable row level security;
alter table public.tasks             enable row level security;
alter table public.subtasks          enable row level security;
alter table public.push_subscriptions enable row level security;

-- users: a caller may only see and edit their own profile row.
-- (`create policy` has no `if not exists`, so each is dropped first — this is
-- what makes the file safe to re-run against a database that already has it.)
drop policy if exists "users select own" on public.users;
create policy "users select own" on public.users
  for select using (auth.uid() = id);
drop policy if exists "users insert own" on public.users;
create policy "users insert own" on public.users
  for insert with check (auth.uid() = id);
drop policy if exists "users update own" on public.users;
create policy "users update own" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- tasks: scoped directly by user_id.
drop policy if exists "tasks select own" on public.tasks;
create policy "tasks select own" on public.tasks
  for select using (auth.uid() = user_id);
drop policy if exists "tasks insert own" on public.tasks;
create policy "tasks insert own" on public.tasks
  for insert with check (auth.uid() = user_id);
drop policy if exists "tasks update own" on public.tasks;
create policy "tasks update own" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tasks delete own" on public.tasks;
create policy "tasks delete own" on public.tasks
  for delete using (auth.uid() = user_id);

-- subtasks: ownership is inherited from the parent task.
drop policy if exists "subtasks select own" on public.subtasks;
create policy "subtasks select own" on public.subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
drop policy if exists "subtasks insert own" on public.subtasks;
create policy "subtasks insert own" on public.subtasks
  for insert with check (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
drop policy if exists "subtasks update own" on public.subtasks;
create policy "subtasks update own" on public.subtasks
  for update using (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );
drop policy if exists "subtasks delete own" on public.subtasks;
create policy "subtasks delete own" on public.subtasks
  for delete using (
    exists (
      select 1 from public.tasks t
      where t.id = subtasks.task_id and t.user_id = auth.uid()
    )
  );

-- push_subscriptions: scoped directly by user_id. The cron send endpoint uses
-- the service-role key (bypasses RLS) to read across all users.
drop policy if exists "push_subscriptions select own" on public.push_subscriptions;
create policy "push_subscriptions select own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "push_subscriptions insert own" on public.push_subscriptions;
create policy "push_subscriptions insert own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "push_subscriptions delete own" on public.push_subscriptions;
create policy "push_subscriptions delete own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
