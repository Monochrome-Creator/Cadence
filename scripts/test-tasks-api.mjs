#!/usr/bin/env node
/**
 * Integration tests for the Cadence REST API — CADENCE_API_SPEC.md §8.
 *
 *   CADENCE_API_BASE=https://omniprod.vercel.app CADENCE_API_KEY=… node scripts/test-tasks-api.mjs
 *
 * Creates real tasks titled "[API TEST] …" (category "API Test") and deletes
 * them via the API at the end; their archive rows stay in deleted_tasks.
 *
 * ALLOW_PROFILE_WRITES=1 also runs the goals / daily-plan / categories write
 * tests (8–12 touch the account's goals list, Focus list and columns). Only
 * set it when the API points at a throwaway test account.
 *
 * Optional: with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, tests simulate
 * writes made by the Cadence app itself (direct row writes, the way
 * src/store/cloud-sync.ts does) — stale API writes must 409, and deleted
 * tasks/subtasks must not be re-created by a stale device.
 *
 * Never prints the API key.
 */
import { randomUUID } from "node:crypto";

const BASE = (process.env.CADENCE_API_BASE ?? "").replace(/\/$/, "");
const KEY = process.env.CADENCE_API_KEY ?? "";
if (!BASE || !KEY) {
  console.error("Set CADENCE_API_BASE and CADENCE_API_KEY");
  process.exit(2);
}

const created = [];
const results = [];

async function api(method, path, { body, key = KEY, headers = {}, retry429 = true } = {}) {
  for (;;) {
    const r = await rawApi(method, path, { body, key, headers });
    if (r.status !== 429 || !retry429) return r;
    // Stay under the 60/min limit: wait out the window, then retry.
    await sleep((Number(r.headers.get("retry-after")) || 5) * 1000 + 250);
  }
}

async function rawApi(method, path, { body, key, headers }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { "X-API-Key": key } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, headers: res.headers };
}

async function createTask(fields) {
  const r = await api("POST", "/api/tasks", {
    body: { category: "API Test", ...fields, title: `[API TEST] ${fields.title}` },
  });
  if (r.status !== 201) throw new Error(`create failed: ${r.status} ${JSON.stringify(r.json)}`);
  created.push(r.json.task.id);
  return r.json.task;
}

function check(cond, label, extra) {
  if (!cond) throw new Error(`${label}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`);
  return label;
}

const SKIP = Symbol("skip");

async function test(name, fn) {
  const checks = [];
  try {
    if ((await fn((cond, label, extra) => checks.push(check(cond, label, extra)))) === SKIP) {
      console.log(`SKIP  ${name} (needs ALLOW_PROFILE_WRITES=1 on a test account)`);
      return;
    }
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
    for (const c of checks) console.log(`        ✓ ${c}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}`);
    for (const c of checks) console.log(`        ✓ ${c}`);
    console.log(`        ✗ ${err.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROFILE_WRITES = process.env.ALLOW_PROFILE_WRITES === "1";
/** Direct PostgREST call with the service role — stands in for the app's own writes. */
const sb = (method, path, body, prefer = "return=representation") =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });

console.log(`Cadence Tasks API integration tests → ${BASE}\n`);

await test("1. Create → get → fields round-trip", async (ok) => {
  const goal = `goal-apitest-${randomUUID()}`;
  const input = {
    title: "round trip",
    priority: "High",
    deadline: "2026-12-31",
    goal_id: goal,
    life_pillar: "Personal_IP",
  };
  const t = await createTask(input);
  const g = await api("GET", `/api/tasks/${t.id}`);
  ok(g.status === 200, "GET returns 200", g.status);
  const task = g.json.task;
  ok(task.title === "[API TEST] round trip", "title", task.title);
  ok(task.category === "API Test", "category", task.category);
  ok(task.priority === "High", "priority", task.priority);
  ok(task.deadline === "2026-12-31", "deadline", task.deadline);
  ok(task.goal_id === goal, "goal_id", task.goal_id);
  ok(task.life_pillar === "Personal_IP", "life_pillar", task.life_pillar);
  ok(task.status === "Not Started", "defaults status=Not Started", task.status);
  ok(task.recurrence === "none" && Array.isArray(task.subtasks), "recurrence/subtasks passthrough");
  ok(task.completed_at === null && typeof task.updated_at === "string", "completed_at null, updated_at set");
  const bad = await api("POST", "/api/tasks", { body: { title: "x", percent: 5 } });
  ok(bad.status === 400 && bad.json.error.code === "validation_error", "unknown field rejected with 400 validation_error", bad.status);
  const noTitle = await api("POST", "/api/tasks", { body: { category: "API Test" } });
  ok(noTitle.status === 400, "missing title rejected with 400", noTitle.status);
});

await test("2. Patch title → updated_at advances; stale expected_updated_at → 409", async (ok) => {
  const t = await createTask({ title: "patch me" });
  await sleep(20);
  const p = await api("PATCH", `/api/tasks/${t.id}`, {
    body: { title: "[API TEST] patched", expected_updated_at: t.updated_at },
  });
  ok(p.status === 200, "PATCH with current expected_updated_at → 200", p.status);
  ok(p.json.task.title === "[API TEST] patched", "title updated");
  ok(Date.parse(p.json.task.updated_at) > Date.parse(t.updated_at), "updated_at advanced", [t.updated_at, p.json.task.updated_at]);
  const stale = await api("PATCH", `/api/tasks/${t.id}`, {
    body: { title: "[API TEST] stale write", expected_updated_at: t.updated_at },
  });
  ok(stale.status === 409 && stale.json.error.code === "conflict", "stale PATCH → 409 conflict", stale.status);
  ok(stale.json.error.details.server.title === "[API TEST] patched", "409 details.server = stored version");
  ok(stale.json.error.details.attempted.title === "[API TEST] stale write", "409 details.attempted = rejected change");
  const after = await api("GET", `/api/tasks/${t.id}`);
  ok(after.json.task.title === "[API TEST] patched", "no write occurred on 409", after.json.task.title);
  ok(after.json.task.updated_at === p.json.task.updated_at, "updated_at unchanged by the 409");
  const missing = await api("PATCH", `/api/tasks/${t.id}`, { body: { title: "x" } });
  ok(missing.status === 400, "PATCH without expected_updated_at → 400", missing.status);
});

await test("3. Complete → Done/100/completed_at; re-complete is idempotent", async (ok) => {
  const t = await createTask({ title: "complete me" });
  const c = await api("POST", `/api/tasks/${t.id}/complete`, { body: { expected_updated_at: t.updated_at } });
  ok(c.status === 200, "complete → 200", c.status);
  ok(c.json.task.status === "Done", "status=Done", c.json.task.status);
  ok(c.json.task.progress === 100, "progress=100", c.json.task.progress);
  ok(typeof c.json.task.completed_at === "string", "completed_at stamped", c.json.task.completed_at);
  const again = await api("POST", `/api/tasks/${t.id}/complete`, { body: { expected_updated_at: c.json.task.updated_at } });
  ok(again.status === 200 && again.json.changed === false, "re-complete → 200, changed=false", again.status);
  ok(again.json.task.updated_at === c.json.task.updated_at, "re-complete wrote nothing (updated_at same)");
  ok(again.json.task.completed_at === c.json.task.completed_at, "completed_at unchanged");
});

await test("4. List filters: status, due_before, goal_id", async (ok) => {
  const goal = `goal-apitest-${randomUUID()}`;
  const a = await createTask({ title: "filter A", deadline: "2030-01-10", goal_id: goal });
  const b = await createTask({ title: "filter B", deadline: "2030-03-10", goal_id: goal });
  const c = await createTask({ title: "filter C" });
  const s = await api("PATCH", `/api/tasks/${c.id}`, { body: { status: "Stuck", expected_updated_at: c.updated_at } });
  ok(s.status === 200, "set C to Stuck", s.status);

  const byGoal = await api("GET", `/api/tasks?goal_id=${encodeURIComponent(goal)}`);
  const goalIds = byGoal.json.tasks.map((t) => t.id).sort();
  ok(byGoal.status === 200 && JSON.stringify(goalIds) === JSON.stringify([a.id, b.id].sort()), "goal_id → exactly A and B", goalIds);

  const due = await api("GET", `/api/tasks?goal_id=${encodeURIComponent(goal)}&due_before=2030-02-01`);
  ok(JSON.stringify(due.json.tasks.map((t) => t.id)) === JSON.stringify([a.id]), "due_before=2030-02-01 → only A");

  const stuck = await api("GET", "/api/tasks?status=Stuck&category=API%20Test&limit=500");
  ok(stuck.json.tasks.every((t) => t.status === "Stuck"), "status=Stuck returns only Stuck tasks");
  ok(stuck.json.tasks.some((t) => t.id === c.id) && !stuck.json.tasks.some((t) => t.id === a.id), "status=Stuck includes C, excludes A");

  const noDeadline = await api("GET", "/api/tasks?due_before=2099-01-01&category=API%20Test&limit=500");
  ok(!noDeadline.json.tasks.some((t) => t.id === c.id), "tasks without a deadline never match due_before");

  const badParam = await api("GET", "/api/tasks?status=Bogus");
  ok(badParam.status === 400, "invalid status filter → 400", badParam.status);
});

await test("5. Auth: missing/invalid key → 401 (reads, writes, deletes)", async (ok) => {
  const none = await api("GET", "/api/tasks", { key: "" });
  ok(none.status === 401 && none.json.error.code === "unauthorized", "missing key → 401 unauthorized", none.status);
  const wrong = await api("GET", "/api/tasks", { key: "not-the-key" });
  ok(wrong.status === 401, "invalid key → 401", wrong.status);
  const wrongWrite = await api("POST", "/api/tasks", { key: "not-the-key", body: { title: "[API TEST] must not exist" } });
  ok(wrongWrite.status === 401, "invalid key cannot create → 401", wrongWrite.status);
  const t = await createTask({ title: "survives bad delete" });
  const del = await api("DELETE", `/api/tasks/${t.id}`, { key: "not-the-key", body: { expected_updated_at: t.updated_at } });
  ok(del.status === 401, "DELETE with invalid key → 401", del.status);
  const noVersion = await api("DELETE", `/api/tasks/${t.id}`);
  ok(noVersion.status === 400, "DELETE without expected_updated_at → 400", noVersion.status);
  const still = await api("GET", `/api/tasks/${t.id}`);
  ok(still.status === 200, "task still exists after rejected deletes", still.status);
  const unknown = await api("GET", "/api/tasks/task-does-not-exist");
  ok(unknown.status === 404 && unknown.json.error.code === "not_found", "unknown id → 404 not_found", unknown.status);
});

await test("6. Conflict: concurrent edits → 409, no data loss", async (ok) => {
  const t = await createTask({ title: "conflict", priority: "Medium" });
  // Two clients read the same version, then both write.
  const [r1, r2] = await Promise.all([
    api("PATCH", `/api/tasks/${t.id}`, { body: { priority: "Critical", expected_updated_at: t.updated_at } }),
    api("PATCH", `/api/tasks/${t.id}`, { body: { deadline: "2031-05-05", expected_updated_at: t.updated_at } }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  ok(JSON.stringify(statuses) === "[200,409]", "simultaneous writes on one version → exactly one 200, one 409", statuses);
  const winner = r1.status === 200 ? r1 : r2;
  const loser = r1.status === 200 ? r2 : r1;
  ok(loser.json.error.details.server.updated_at === winner.json.task.updated_at, "409 carries the winner as details.server");
  const final = (await api("GET", `/api/tasks/${t.id}`)).json.task;
  const winnerWroteDeadline = winner === r2;
  ok(final.priority === (winnerWroteDeadline ? "Medium" : "Critical"), "winner's change persisted; loser's not applied (priority)", final.priority);
  ok(final.deadline === (winnerWroteDeadline ? "2031-05-05" : null), "winner's change persisted; loser's not applied (deadline)", final.deadline);
  // The loser retries properly: re-read, re-apply on the fresh version.
  const retry = await api("PATCH", `/api/tasks/${t.id}`, {
    body: { ...loser.json.error.details.attempted, expected_updated_at: final.updated_at },
  });
  ok(retry.status === 200, "retry against fresh updated_at → 200", retry.status);
  ok(retry.json.task.priority === "Critical" && retry.json.task.deadline === "2031-05-05", "both edits present after retry — zero data loss");

  if (SB_URL && SB_KEY) {
    // Simulate the Cadence app editing the task (row write without updated_at).
    const before = retry.json.task;
    const res = await sb("PATCH", `tasks?id=eq.${encodeURIComponent(t.id)}`, { title: "[API TEST] edited in app" });
    ok(res.ok, "simulated app edit applied", res.status);
    const stale = await api("PATCH", `/api/tasks/${t.id}`, {
      body: { title: "[API TEST] stale API write", expected_updated_at: before.updated_at },
    });
    ok(stale.status === 409, "API write stale vs an app edit → 409", stale.status);
    const now = (await api("GET", `/api/tasks/${t.id}`)).json.task;
    ok(now.title === "[API TEST] edited in app", "app's edit preserved", now.title);
  } else {
    console.log("        (skipped app-edit simulation: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set)");
  }
});

await test("8. Delete: guarded, archived, not resurrected by a stale device", async (ok) => {
  const t = await createTask({ title: "delete me" });
  const withSub = await api("POST", `/api/tasks/${t.id}/subtasks`, { body: { title: "child", expected_updated_at: t.updated_at } });
  ok(withSub.status === 201, "seeded a subtask", withSub.status);
  const v = withSub.json.task.updated_at;
  const stale = await api("DELETE", `/api/tasks/${t.id}`, { body: { expected_updated_at: t.updated_at } });
  ok(stale.status === 409 && stale.json.error.code === "conflict", "stale DELETE → 409", stale.status);
  ok((await api("GET", `/api/tasks/${t.id}`)).status === 200, "task untouched by the 409");
  const del = await api("DELETE", `/api/tasks/${t.id}?expected_updated_at=${encodeURIComponent(v)}`);
  ok(del.status === 200 && del.json.deleted === true, "DELETE with current version → 200", del.status);
  ok(del.json.archived.id === t.id && del.json.archived.subtasks.length === 1, "response returns archived snapshot incl. subtasks");
  ok((await api("GET", `/api/tasks/${t.id}`)).status === 404, "task now 404");
  ok((await api("DELETE", `/api/tasks/${t.id}`, { body: { expected_updated_at: v } })).status === 404, "deleting again → 404");
  if (SB_URL && SB_KEY) {
    const [{ user_id }] = await (await sb("GET", `deleted_tasks?select=user_id&id=eq.${t.id}`)).json();
    ok(Boolean(user_id), "archive row exists in deleted_tasks");
    // A stale device upserts the deleted task + its subtask, as pushTasks would.
    await sb("POST", "tasks?on_conflict=id", [{ id: t.id, user_id, title: "[API TEST] resurrected" }], "resolution=merge-duplicates,return=minimal");
    await sb("POST", "subtasks?on_conflict=id", [{ id: withSub.json.subtask_id, task_id: t.id, title: "x" }], "resolution=merge-duplicates,return=minimal");
    ok((await api("GET", `/api/tasks/${t.id}`)).status === 404, "stale device upsert did not re-create the task");
  }
});

await test("9. Subtasks: add / nest / edit / delete, version-guarded", async (ok) => {
  const t = await createTask({ title: "subtask host" });
  const a = await api("POST", `/api/tasks/${t.id}/subtasks`, { body: { title: "step 1", expected_updated_at: t.updated_at } });
  ok(a.status === 201 && a.json.task.subtasks.length === 1, "add L1 → 201", a.status);
  ok(Date.parse(a.json.task.updated_at) > Date.parse(t.updated_at), "parent updated_at advanced");
  const b = await api("POST", `/api/tasks/${t.id}/subtasks`, { body: { title: "step 1.1", level: "L2", deadline: "2030-01-01", expected_updated_at: a.json.task.updated_at } });
  const c = await api("POST", `/api/tasks/${t.id}/subtasks`, { body: { title: "step 2", expected_updated_at: b.json.task.updated_at } });
  ok(JSON.stringify(c.json.task.subtasks.map((s) => s.level)) === '["L1","L2","L1"]', "ordered L1, L2, L1");
  const staleAdd = await api("POST", `/api/tasks/${t.id}/subtasks`, { body: { title: "lost?", expected_updated_at: a.json.task.updated_at } });
  ok(staleAdd.status === 409 && staleAdd.json.error.details.server.subtasks.length === 3, "stale add → 409 with server version", staleAdd.status);
  const e = await api("PATCH", `/api/tasks/${t.id}/subtasks/${b.json.subtask_id}`, { body: { status: "done", percent: 100, expected_updated_at: c.json.task.updated_at } });
  ok(e.status === 200 && e.json.task.subtasks[1].status === "done", "edit subtask status → done", e.status);
  const bad = await api("PATCH", `/api/tasks/${t.id}/subtasks/${b.json.subtask_id}`, { body: { status: "finished", expected_updated_at: e.json.task.updated_at } });
  ok(bad.status === 400, "invalid subtask status → 400", bad.status);
  const d = await api("DELETE", `/api/tasks/${t.id}/subtasks/${a.json.subtask_id}`, { body: { expected_updated_at: e.json.task.updated_at } });
  ok(d.status === 200 && d.json.removed_subtask_ids.length === 2, "deleting L1 also removes its nested L2", d.json.removed_subtask_ids);
  ok(d.json.task.subtasks.length === 1 && d.json.task.subtasks[0].title === "step 2", "only step 2 remains");
  if (SB_URL && SB_KEY) {
    await sb("POST", "subtasks?on_conflict=id", [{ id: a.json.subtask_id, task_id: t.id, title: "step 1" }], "resolution=merge-duplicates,return=minimal");
    const after = (await api("GET", `/api/tasks/${t.id}`)).json.task;
    ok(after.subtasks.length === 1, "stale device upsert did not re-create the deleted subtask");
    await sb("PATCH", `subtasks?id=eq.${c.json.subtask_id}`, { title: "renamed in app" });
    const stale = await api("PATCH", `/api/tasks/${t.id}/subtasks/${c.json.subtask_id}`, { body: { title: "API rename", expected_updated_at: d.json.task.updated_at } });
    ok(stale.status === 409, "app edit to a subtask bumps the task version → stale API edit 409", stale.status);
  }
});

await test("10. is_today + Daily Plan focus list", async (ok) => {
  if (!PROFILE_WRITES) return SKIP;
  const tasks = [];
  for (let i = 0; i < 6; i++) tasks.push(await createTask({ title: `today ${i}` }));
  for (let i = 0; i < 5; i++) {
    const r = await api("PATCH", `/api/tasks/${tasks[i].id}`, { body: { is_today: true, expected_updated_at: tasks[i].updated_at } });
    ok(r.status === 200 && r.json.task.is_today === true, `is_today #${i + 1} → 200`, r.status);
  }
  const sixth = await api("PATCH", `/api/tasks/${tasks[5].id}`, { body: { is_today: true, expected_updated_at: tasks[5].updated_at } });
  ok(sixth.status === 400, "6th active today task → 400 (cap of 5)", sixth.status);
  const plan = await api("GET", "/api/daily-plan");
  ok(plan.status === 200 && tasks.slice(0, 5).every((t) => plan.json.today_task_ids.includes(t.id)), "GET daily-plan lists today tasks");
  const today = new Date().toISOString().slice(0, 10);
  const set = await api("PATCH", "/api/daily-plan", { body: { date: today, manual_task_ids: [tasks[5].id], expected_updated_at: plan.json.updated_at } });
  ok(set.status === 200 && set.json.manual_task_ids[0] === tasks[5].id && set.json.date === today, "PATCH daily-plan sets focus list", set.status);
  const stale = await api("PATCH", "/api/daily-plan", { body: { date: today, manual_task_ids: [], expected_updated_at: plan.json.updated_at } });
  ok(stale.status === 409 && stale.json.error.details.server.manual_task_ids.length === 1, "stale plan write → 409, plan kept", stale.status);
  const unknown = await api("PATCH", "/api/daily-plan", { body: { date: today, manual_task_ids: ["task-nope"], expected_updated_at: set.json.updated_at } });
  ok(unknown.status === 400, "unknown task id → 400", unknown.status);
});

await test("11. Goals: create / edit, version-guarded", async (ok) => {
  if (!PROFILE_WRITES) return SKIP;
  const list = await api("GET", "/api/goals");
  ok(list.status === 200 && Array.isArray(list.json.goals), "GET goals → 200", list.status);
  const c = await api("POST", "/api/goals", { body: { title: "[API TEST] goal", target_date: "2027-01-01", life_pillar: "Wealth", expected_updated_at: list.json.updated_at } });
  ok(c.status === 201 && c.json.goal.status === "active" && c.json.goal.life_pillar === "Wealth", "create goal → 201", c.status);
  const stale = await api("POST", "/api/goals", { body: { title: "[API TEST] stale", expected_updated_at: list.json.updated_at } });
  ok(stale.status === 409 && stale.json.error.details.server.goals.some((g) => g.id === c.json.goal.id), "stale create → 409 with server list", stale.status);
  const e = await api("PATCH", `/api/goals/${c.json.goal.id}`, { body: { status: "done", life_pillar: null, expected_updated_at: c.json.updated_at } });
  ok(e.status === 200 && e.json.goal.status === "done" && e.json.goal.life_pillar === null, "edit goal → 200", e.status);
  const after = await api("GET", "/api/goals");
  ok(after.json.goals.filter((g) => g.title.startsWith("[API TEST]")).length === 1, "exactly one test goal stored (no stale write landed)");
  ok((await api("PATCH", "/api/goals/goal-nope", { body: { title: "x", expected_updated_at: after.json.updated_at } })).status === 404, "unknown goal → 404");
});

await test("12. Categories: replace list, version-guarded", async (ok) => {
  if (!PROFILE_WRITES) return SKIP;
  const cur = await api("GET", "/api/categories");
  ok(cur.status === 200, "GET categories → 200", cur.status);
  const next = [...cur.json.categories.filter((c) => c !== "API Test"), "API Test"];
  const put = await api("PUT", "/api/categories", { body: { categories: next, expected_updated_at: cur.json.updated_at } });
  ok(put.status === 200 && put.json.categories.at(-1) === "API Test", "PUT categories → 200", put.status);
  const stale = await api("PUT", "/api/categories", { body: { categories: [], expected_updated_at: cur.json.updated_at } });
  ok(stale.status === 409, "stale PUT → 409", stale.status);
  const dup = await api("PUT", "/api/categories", { body: { categories: ["A", "A"], expected_updated_at: put.json.updated_at } });
  ok(dup.status === 400, "duplicate names → 400", dup.status);
  ok(JSON.stringify((await api("GET", "/api/categories")).json.categories) === JSON.stringify(next), "list unchanged by rejected writes");
});

await test("7. Rate limit: burst → 429 with Retry-After", async (ok) => {
  await sleep(61_000); // start from a fresh window so the count is exact
  const burst = await Promise.all(Array.from({ length: 75 }, () => api("GET", "/api/tasks?limit=1", { retry429: false })));
  const limited = burst.filter((r) => r.status === 429);
  const okCount = burst.filter((r) => r.status === 200).length;
  ok(limited.length > 0, `burst of 75 → ${okCount}×200, ${limited.length}×429`, burst.map((r) => r.status));
  const r = limited[0];
  const retryAfter = Number(r.headers.get("retry-after"));
  ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After header = ${retryAfter}s`, r.headers.get("retry-after"));
  ok(r.json.error.code === "rate_limited", "error code rate_limited");
  ok(okCount <= 60, "no more than 60 succeeded in the window", okCount);
});

// Clean up: delete every task this run created (they stay in the archive).
await sleep(61_000);
let cleaned = 0;
for (const id of created) {
  const cur = await api("GET", `/api/tasks/${id}`);
  if (cur.status !== 200) continue;
  const d = await api("DELETE", `/api/tasks/${id}`, { body: { expected_updated_at: cur.json.task.updated_at } });
  if (d.status === 200) cleaned++;
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} tests passed${results.length < 12 ? ` (${12 - results.length} skipped)` : ""}`);
console.log(`Cleanup: deleted ${cleaned} test task(s) via the API`);
console.log(`CREATED_IDS: ${created.join(",")}`);
process.exit(passed === results.length ? 0 : 1);
