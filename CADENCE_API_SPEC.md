# Cadence API — Implementation Specification

**Status:** IMPLEMENTED. MVP deployed 2026-10-11; v2 (delete, subtasks, goals, daily plan, categories — approved by Casper 2026-10-11) deployed the same day. Base URL `https://omniprod.vercel.app`.
**Target:** omniprod.vercel.app (Next.js 16) + Supabase backend + GitHub source
**Author:** Muse, 2026-10-11. Revised by Claude 2026-10-11 after checking the live Supabase schema — see "Schema drift" below. Approved direction: additive only; existing app behavior unchanged.
**Code:** `src/app/api/{tasks,goals,daily-plan,categories}/**`, `src/lib/tasks-api.ts`, `src/lib/goals-api.ts`, `supabase/tasks-api.sql` + `supabase/tasks-api-v2.sql`, tests in `scripts/test-tasks-api.mjs`.

## Schema drift (found 2026-10-11, live DB `public.tasks`)

The original §1 came from the feed snapshot and UI observation. The live table differs as follows; the API uses the **real column names** (they also match the Astra briefing feed):

| Original spec | Live schema / API | Notes |
|---|---|---|
| `percent: 0` | `progress: integer \| null` | null = progress derived from subtasks in the app (no manual override) |
| `pillar`, `"Personal IP"` | `life_pillar`, `"Personal_IP"` | values: `Wealth`, `Health`, `Career`, `Personal_IP`, or null |
| `children[]` | `subtasks[]` (separate `public.subtasks` table) | each: `id, title, status (todo\|done\|cancelled), level (L1\|L2\|L3), percent, deadline`. Read-only. |
| status: 4 values | 6 values | adds `On-Going` and `Inbox` |
| recurrence: 4 values | 5 values | adds `quarterly` |
| `deadline: string \| null` | stored as text, `""` = none | API maps `""` ⇄ `null` |
| `completed_at` | **did not exist** | added (nullable `timestamptz`) by `supabase/tasks-api.sql`; existing Done tasks keep null (true completion time unknown) |
| `updated_at` | existed but **never changed after insert** | the app upserts rows without it. `supabase/tasks-api.sql` adds a trigger that bumps it on every update that actually changes the row |
| `ref` | does not exist | dropped |
| `owner` | does not exist | not added — Phase 2 |
| — | `pomodoros_logged` | included read-only (the "pomodoro sessions logged" field) |

Goals are not a table: they live as a JSON array in `public.users.goals`, each `{ id ("goal-<uuid>"), title, description, targetDate (yyyy-MM-dd or ""), lifePillar?, status ("active"|"done"), order }`. `tasks.goal_id` is plain text (no FK); the API does not check that the goal exists.

## 1. Data model (API task object)

```json
{
  "id": "task-<uuid>",
  "title": "string",
  "status": "Not Started | Working on it | On-Going | Stuck | Done | Inbox",
  "priority": "Critical | High | Medium | Low",
  "deadline": "YYYY-MM-DD | null",
  "category": "string",
  "recurrence": "none | daily | weekly | monthly | quarterly",
  "progress": "0–100 | null",
  "subtasks": [ { "id": "string", "title": "string", "status": "todo | done | cancelled", "level": "L1 | L2 | L3", "percent": "0–100 | null", "deadline": "YYYY-MM-DD | null" } ],
  "goal_id": "string | null",
  "life_pillar": "Wealth | Health | Career | Personal_IP | null",
  "is_today": "boolean (Daily Plan focus flag)",
  "last_completed_period": "string | null",
  "pomodoros_logged": 0,
  "updated_at": "ISO-8601 (µs precision — echo it back verbatim)",
  "completed_at": "ISO-8601 | null"
}
```

## 2. Endpoints

Every mutation carries `expected_updated_at` (see §6). For DELETE it may go in the JSON body or as `?expected_updated_at=`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/tasks | List tasks (filters below) → `{ tasks: [...], count }`, newest `updated_at` first |
| GET | /api/tasks/:id | Single task → `{ task }` |
| POST | /api/tasks | Create task → `201 { task }` |
| PATCH | /api/tasks/:id | Update title/status/priority/deadline/category/progress/goal_id/life_pillar/is_today → `{ task }` |
| POST | /api/tasks/:id/complete | Mark complete (status=Done, progress=100, completed_at stamped) → `{ task, changed }` |
| DELETE | /api/tasks/:id | Delete (archived, restorable) → `{ deleted: true, archived: <task incl. subtasks> }` |
| POST | /api/tasks/:id/subtasks | Append subtask `{ title, level?, status?, percent?, deadline? }` → `201 { task, subtask_id }` |
| PATCH | /api/tasks/:id/subtasks/:subtaskId | Edit `{ title?, status?, level?, percent?, deadline? }` → `{ task }` |
| DELETE | /api/tasks/:id/subtasks/:subtaskId | Remove it + its nested deeper rows (as the app does) → `{ task, removed_subtask_ids }` |
| GET | /api/goals | `{ goals: [...], updated_at }` |
| POST | /api/goals | Create `{ title, description?, target_date?, life_pillar? }` → `201 { goal, updated_at }` |
| PATCH | /api/goals/:id | Edit `{ title?, description?, target_date?, life_pillar?, status? }` → `{ goal, updated_at }` |
| GET | /api/daily-plan | `{ date, today_task_ids, manual_task_ids, review, updated_at }` |
| PATCH | /api/daily-plan | Set Focus list `{ date, manual_task_ids }` → same shape as GET |
| GET | /api/categories | `{ categories: [...], updated_at }` (ordered board columns) |
| PUT | /api/categories | Replace list `{ categories }` → same shape as GET |

Still EXCLUDED: recurrence changes, goal deletion, moving subtasks between tasks, Mandala / flashcards / Memento Mori.

**Subtasks.** Subtask writes use the *parent task's* `expected_updated_at` and return the whole task; the new `updated_at` is on it. Order is array order; nesting comes from `level` (an L2 belongs to the L1 above it), as in the app. Subtask `status`: `todo | done | cancelled`.

**Delete.** The full task (row + subtasks) is copied into `deleted_tasks` in the same transaction as the delete. Restore with `select public.api_restore_task('task-…');` in the Supabase SQL editor. Deleted task and subtask ids become tombstones: a device still holding a stale copy cannot re-create them (its insert is skipped and its next pull drops the item).

**Goals.** Stored on the user row as one list, so `updated_at` versions the whole list — editing goal A makes a write based on the old version of goal B 409 (safe; re-read and retry). `target_date: YYYY-MM-DD | null`, `status: active | done`. Linking a task to a goal is `PATCH /api/tasks/:id { goal_id }`.

**Daily plan.** The Dashboard's main list is the `is_today` flag on tasks (`PATCH /api/tasks/:id { is_today: true }`), capped at 5 active (not Done/Inbox) tasks like the app → 400 past the cap. `manual_task_ids` is the hand-picked Focus list for `date`; send the user's local date (Singapore). Moving to a new date replays the app's day rollover (yesterday's unfinished picks become the `review`); a date before the current plan's date → 400.

**Categories.** Full ordered list replace. Tasks are not modified: a task whose category is dropped still shows as its own column. To rename a category, PATCH the tasks' `category` and PUT the new list.

## 3. Schemas

**Create (request):** `title` required; optional `category` (default `General`), `priority` (default `Medium`), `deadline`, `goal_id`, `life_pillar`. New tasks start `Not Started`.

**Update (request):** any non-empty subset of `{ title, status, priority, deadline, category, progress, goal_id, life_pillar }` + **required** `expected_updated_at`.

**Complete (request):** `{ "expected_updated_at": "..." }`.

Unknown fields are rejected with `400 validation_error` (not ignored), so a client still sending the old names `percent`/`pillar` finds out.

**List (query params):** `status`, `priority`, `category`, `goal_id`, `due_before=YYYY-MM-DD`, `due_after=YYYY-MM-DD` (both exclusive; tasks with no deadline never match), `limit` (default 100, max 500), `updated_since=ISO-8601` (exclusive). Unknown params → 400.

**Error envelope (all errors):**
```json
{ "error": { "code": "string", "message": "human-readable", "details": {} } }
```
Codes: `unauthorized` (401), `not_found` (404), `validation_error` (400), `conflict` (409), `rate_limited` (429), `internal` (500).

## 4. Authentication & permissions

- `X-API-Key` header, checked against Vercel env var `CADENCE_API_KEYS` (Production). Comma-separated, so rotation is: add the new key alongside the old → redeploy → move clients over → remove the old key → redeploy. Generated server-side (`openssl rand -hex 32`); never in the repo, chat, logs or URLs. Muse holds it in the Secure Vault.
- Every query is scoped to `CADENCE_API_USER_ID` (Casper's Supabase auth user) and runs with the service-role key server-side. Single scope: read, write and (archived) task delete.
- Rate limit: 60 req/min per key, fixed one-minute windows, counted in Postgres (`api_rate_limit_hit()`), so it holds across serverless instances. Over the limit → 429 + `Retry-After` (seconds to window reset). Requests that get a 429 still count.
- Each request is logged as one JSON line (`tag: "tasks-api"`): timestamp, method, route template (no ids), key id (first 8 hex chars of the key's SHA-256), status, duration, plus `reopen: true` on a Done → not-Done PATCH. No titles, bodies or keys. (Vercel's own platform request log still records the raw URL path and query string.)

## 5. Task lifecycle semantics

- **Completion:** idempotent — completing an already-Done task returns 200 with `changed: false` and writes nothing (no conflict check, since nothing is written).
- **Status transitions:** any → Done allowed; Done → not-Done allowed via PATCH (reopen), logged. `completed_at` is set by the DB trigger when a task becomes Done (via the API or the app) and cleared when it is reopened.
- **Recurring tasks:** `recurrence` is a read-only passthrough. Completing a recurring task (via `/complete` or `PATCH status=Done`) is **refused with 400**: the app's period engine reopens any recurring task without its own `last_completed_period` stamp, so an API completion would be silently undone. Phase 2.
- **Ownership:** single-user. No `owner` column yet (Phase 2).
- The app gives priority points for completions in local history; API completions don't (that history is client-side only).

## 6. Sync conflict handling (mandatory)

- Every mutation carries `expected_updated_at`. The check and the write are a single `UPDATE … WHERE updated_at = expected_updated_at`, so two concurrent writers can never both succeed.
- Mismatch → **409 `conflict`**, `details: { server: <current task>, attempted: <request fields> }`. No write occurs.
- `updated_at` is bumped by a DB trigger on every row change, **including edits made in the Cadence app**, so an API write based on a version older than an app edit gets a 409.
- Client policy (Muse, user-mandated 2026-10-11): on 409 — STOP, preserve both versions, log the conflict, request Casper's approval. Never auto-resolve, never "save mine".
- Spurious 409s are expected (and safe) when the app rewrites a row without a meaningful change for the API, e.g. a board reorder changes `task_order`.
- Subtask changes (API or app) bump the parent task's `updated_at` (trigger), and `goals` / `daily_plan` / `categories` each have their own version stamp bumped on change — so the same 409 rule covers all of them.
- **App sync change (approved 2026-10-11):** the app used to delete, on every save, any subtask of that task it didn't know about — so a device with a stale copy wiped subtasks added via the API. It now deletes only the subtasks the user actually removed (a persisted outbox, `unsyncedDeletedSubtaskIds`).
- **Known limit (app side):** the app is local-first and pushes whole rows/lists without checking versions. If a device holds a stale copy (it hasn't re-synced since an API write) and Casper edits that same task / goal list / Focus list / category list there, the app's save overwrites the API's change to that item. Deletes are protected (tombstones); edits are not. Mitigation: the app pulls on open and on Reconnect.

## 7. Change history

- `updated_at` bumped on every mutation (trigger); `completed_at` set on completion.
- Phase 2: append-only `task_events` table. MVP request logs suffice.

## 8. Integration tests — `scripts/test-tasks-api.mjs`

```bash
CADENCE_API_BASE=https://omniprod.vercel.app CADENCE_API_KEY=… node scripts/test-tasks-api.mjs
```

Tests 10–12 change the account's goals, Focus list and columns, so they only run with `ALLOW_PROFILE_WRITES=1` — use a throwaway account (v2 was verified locally against Casper's empty second account, then smoke-tested on production without them).

1. Create → get → fields round-trip (plus: unknown field / missing title → 400).
2. Patch title → `updated_at` advanced; stale `expected_updated_at` → 409 with both versions; nothing written.
3. Complete → Done / 100 / `completed_at`; re-complete idempotent (no write).
4. List filters: status, due_before, goal_id.
5. Auth: missing/invalid key → 401 for reads, writes and deletes; DELETE without version → 400.
6. Conflict: two simultaneous PATCHes on one version → exactly one 200 + one 409; winner persisted, loser retries → both edits present. With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set, also simulates an app edit → stale API write → 409, app edit preserved.
7. Rate limit: burst of 75 → 429 with `Retry-After` (runs last).
8. Delete: stale → 409; archived snapshot returned; then 404; a stale device's upsert does not re-create it.
9. Subtasks: add / nest / edit / delete-with-children; stale → 409; a stale device can't re-create a deleted subtask; an app edit to a subtask makes a stale API edit 409.
10. `is_today` cap of 5; Daily Plan focus list set; stale → 409; unknown task id → 400.
11. Goals: create / edit; stale → 409; no stale write lands.
12. Categories: replace; stale → 409; duplicates → 400.

The tests create real tasks titled `[API TEST] …` (category `API Test`) and delete them via the API at the end; their archive rows remain in `deleted_tasks` (purge with the service role if wanted).

## 9. Non-goals / constraints

- Do not change existing app behavior, UI, or sync logic.
- Do not invent endpoints beyond this spec without approval.
- No PII beyond what tasks already contain; no new data collection.
- Deploy behind the existing Vercel project; env-var the API key.

## 10. Handoff checklist

- [x] Confirm Supabase table/column names match §1 (drift documented above)
- [x] Implement §2 endpoints + §4 auth
- [x] Implement §6 conflict semantics
- [x] Pass §8 tests (7/7 against production, 2026-10-11)
- [x] Deploy; base URL `https://omniprod.vercel.app`
- [x] v2: delete (archived), subtasks, goals, daily plan, categories; app subtask-sync fix
- [ ] Casper copies `CADENCE_API_KEYS` from Vercel → Muse's Secure Vault
