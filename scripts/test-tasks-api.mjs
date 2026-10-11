#!/usr/bin/env node
/**
 * Integration tests for the Tasks REST API — CADENCE_API_SPEC.md §8.
 *
 *   CADENCE_API_BASE=https://omniprod.vercel.app CADENCE_API_KEY=… node scripts/test-tasks-api.mjs
 *
 * Runs against a live deployment and creates real tasks titled "[API TEST] …"
 * in category "API Test". The API has no delete, so the created ids are
 * printed on the last line (CREATED_IDS) for manual/service-role cleanup.
 *
 * Optional: with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, test 6 also
 * simulates an edit made by the Cadence app itself (a direct row upsert, the
 * way src/store/cloud-sync.ts writes) and checks a stale API write then 409s.
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

async function api(method, path, { body, key = KEY, headers = {} } = {}) {
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

async function test(name, fn) {
  const checks = [];
  try {
    await fn((cond, label, extra) => checks.push(check(cond, label, extra)));
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

await test("5. Auth: missing/invalid key → 401; no delete endpoint (404)", async (ok) => {
  const none = await api("GET", "/api/tasks", { key: "" });
  ok(none.status === 401 && none.json.error.code === "unauthorized", "missing key → 401 unauthorized", none.status);
  const wrong = await api("GET", "/api/tasks", { key: "not-the-key" });
  ok(wrong.status === 401, "invalid key → 401", wrong.status);
  const wrongWrite = await api("POST", "/api/tasks", { key: "not-the-key", body: { title: "[API TEST] must not exist" } });
  ok(wrongWrite.status === 401, "invalid key cannot create → 401", wrongWrite.status);
  const t = await createTask({ title: "survives delete" });
  const del = await api("DELETE", `/api/tasks/${t.id}`);
  ok(del.status === 404, "DELETE /api/tasks/:id → 404", del.status);
  const still = await api("GET", `/api/tasks/${t.id}`);
  ok(still.status === 200, "task still exists after DELETE attempt", still.status);
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

  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && service) {
    // Simulate the Cadence app editing the task (row upsert without updated_at).
    const before = retry.json.task;
    const res = await fetch(`${url}/rest/v1/tasks?id=eq.${encodeURIComponent(t.id)}`, {
      method: "PATCH",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "[API TEST] edited in app" }),
    });
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

await test("7. Rate limit: burst → 429 with Retry-After", async (ok) => {
  const burst = await Promise.all(Array.from({ length: 75 }, () => api("GET", "/api/tasks?limit=1")));
  const limited = burst.filter((r) => r.status === 429);
  const okCount = burst.filter((r) => r.status === 200).length;
  ok(limited.length > 0, `burst of 75 → ${okCount}×200, ${limited.length}×429`, burst.map((r) => r.status));
  const r = limited[0];
  const retryAfter = Number(r.headers.get("retry-after"));
  ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After header = ${retryAfter}s`, r.headers.get("retry-after"));
  ok(r.json.error.code === "rate_limited", "error code rate_limited");
  ok(okCount <= 60, "no more than 60 succeeded in the window", okCount);
});

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} tests passed`);
console.log(`CREATED_IDS: ${created.join(",")}`);
process.exit(passed === results.length ? 0 : 1);
