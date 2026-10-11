# Cadence API — Implementation Specification

**Status:** IMPLEMENTED (MVP), deployed 2026-10-11 at `https://omniprod.vercel.app`.
**Target:** omniprod.vercel.app (Next.js 16) + Supabase backend + GitHub source
**Author:** Muse, 2026-10-11. Revised by Claude 2026-10-11 after checking the live Supabase schema — see "Schema drift" below. Approved direction: additive only; existing app behavior unchanged.
**Code:** `src/app/api/tasks/**`, `src/lib/tasks-api.ts`, `supabase/tasks-api.sql`, tests in `scripts/test-tasks-api.mjs`.

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
  "last_completed_period": "string | null",
  "pomodoros_logged": 0,
  "updated_at": "ISO-8601 (µs precision — echo it back verbatim)",
  "completed_at": "ISO-8601 | null"
}
```

## 2. Endpoints (MVP)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/tasks | List tasks (filters below) → `{ tasks: [...], count }`, newest `updated_at` first |
| GET | /api/tasks/:id | Single task → `{ task }` |
| POST | /api/tasks | Create task → `201 { task }` |
| PATCH | /api/tasks/:id | Update title/status/priority/deadline/category/progress/goal_id/life_pillar → `{ task }` |
| POST | /api/tasks/:id/complete | Mark complete (status=Done, progress=100, completed_at stamped) → `{ task, changed }` |

Deliberately EXCLUDED: deletes (`DELETE /api/tasks/:id` answers 404 and touches nothing), subtask editing, recurrence changes.

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
- Every query is scoped to `CADENCE_API_USER_ID` (Casper's Supabase auth user) and runs with the service-role key server-side. Single scope: read + write; no delete.
- Rate limit: 60 req/min per key, fixed one-minute windows, counted in Postgres (`api_rate_limit_hit()`), so it holds across serverless instances. Over the limit → 429 + `Retry-After` (seconds to window reset). Requests that get a 429 still count.
- Each request is logged as one JSON line (`tag: "tasks-api"`): timestamp, method, route template (no ids), key id (first 8 hex chars of the key's SHA-256), status, duration, plus `reopen: true` on a Done → not-Done PATCH. No titles, bodies or keys. (Vercel's own platform request log still records the raw URL path and query string.)

## 5. Task lifecycle semantics

- **Completion:** idempotent — completing an already-Done task returns 200 with `changed: false` and writes nothing (no conflict check, since nothing is written).
- **Status transitions:** any → Done allowed; Done → not-Done allowed via PATCH (reopen), logged. `completed_at` is set by the DB trigger when a task becomes Done (via the API or the app) and cleared when it is reopened.
- **Recurring tasks:** `recurrence` is a read-only passthrough. Completing a recurring task (via `/complete` or `PATCH status=Done`) is **refused with 400**: the app's period engine reopens any recurring task without its own `last_completed_period` stamp, so an API completion would be silently undone. Phase 2.
- **Ownership:** single-user MVP. No `owner` column yet (Phase 2).
- The app gives priority points for completions in local history; API completions don't (that history is client-side only).

## 6. Sync conflict handling (mandatory)

- Every mutation carries `expected_updated_at`. The check and the write are a single `UPDATE … WHERE updated_at = expected_updated_at`, so two concurrent writers can never both succeed.
- Mismatch → **409 `conflict`**, `details: { server: <current task>, attempted: <request fields> }`. No write occurs.
- `updated_at` is bumped by a DB trigger on every row change, **including edits made in the Cadence app**, so an API write based on a version older than an app edit gets a 409.
- Client policy (Muse, user-mandated 2026-10-11): on 409 — STOP, preserve both versions, log the conflict, request Casper's approval. Never auto-resolve, never "save mine".
- Spurious 409s are expected (and safe) when the app rewrites a row without a meaningful change for the API, e.g. a board reorder changes `task_order`.
- **Known limit (app side, out of scope):** the app is local-first and pushes whole task rows without checking versions. If the app holds a stale copy of a task (it hasn't re-synced since an API write) and Casper then edits that task in the app, the app's push overwrites the API's change. Fixing this would mean changing app sync logic, which this MVP must not do. Mitigation: the app pulls on open and on Reconnect.

## 7. Change history

- `updated_at` bumped on every mutation (trigger); `completed_at` set on completion.
- Phase 2: append-only `task_events` table. MVP request logs suffice.

## 8. Integration tests — `scripts/test-tasks-api.mjs`

```bash
CADENCE_API_BASE=https://omniprod.vercel.app CADENCE_API_KEY=… node scripts/test-tasks-api.mjs
```

1. Create → get → fields round-trip (plus: unknown field / missing title → 400).
2. Patch title → `updated_at` advanced; stale `expected_updated_at` → 409 with both versions; nothing written.
3. Complete → Done / 100 / `completed_at`; re-complete idempotent (no write).
4. List filters: status, due_before, goal_id.
5. Auth: missing/invalid key → 401; DELETE → 404 and task still exists.
6. Conflict: two simultaneous PATCHes on one version → exactly one 200 + one 409; winner persisted, loser retries → both edits present. With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set, also simulates an app edit → stale API write → 409, app edit preserved.
7. Rate limit: burst of 75 → 429 with `Retry-After`.

The tests create real tasks titled `[API TEST] …` (category `API Test`). The API can't delete them, so remove them afterwards with the service-role key (ids printed on the `CREATED_IDS` line).

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
- [ ] Casper copies `CADENCE_API_KEYS` from Vercel → Muse's Secure Vault
