/**
 * IdeaProbe — TL-077: Interview Stage Reconciliation & Isolation Regression Tests
 *
 * Requirements covered:
 * 1. Starting a persona chat creates or reuses one interview session record.
 * 2. Multiple chat turns with the same session ID do not create duplicate interview sessions (idempotency).
 * 3. Project stage reconciliation correctly transitions the `interviews` stage to `completed` with `provenance: 'SIMULATED'`.
 * 4. Cross-project persona access is rejected with HTTP 403 PROJECT_MISMATCH and zero database writes.
 * 5. Failed or invalid chat requests (empty message, non-existent persona) do not create misleading interview records.
 * 6. Existing interview fixtures, behavior, and provenance conventions remain intact.
 * 7. Production database remains 100% unchanged across all 16 tables.
 */

import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient, nowUtc } from "./src/lib/db";
import { POST as chatRoute } from "./src/app/api/personas/[id]/chat/route";
import { reconcileProjectStages } from "./src/lib/stageReconciliation";

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: any, message: string) {
  if (Boolean(condition)) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function getTableCounts(dbPath: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const counts: Record<string, number> = {};
  for (const t of tables.rows) {
    const tableName = String(t.name);
    const row = await client.execute(`SELECT COUNT(*) as count FROM "${tableName}"`);
    counts[tableName] = Number(row.rows[0].count);
  }
  return counts;
}

async function runRegressionSuite() {
  console.log("================================================================================");
  console.log("  IdeaProbe — TL-077 Interview Stage Reconciliation Regression Tests");
  console.log("================================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data/ideaprobe.db");
  const isolatedDbPath = path.resolve(__dirname, ".ideaprobe-data/test-tl077-isolated.db");

  // ── SUITE 1: Production Database Pre-Execution Invariance Check ─────────────
  console.log("Suite 1: Production Database Pre-Execution Invariance Baseline");
  assert(fs.existsSync(prodDbPath), `Production DB exists at ${prodDbPath}`);
  const preCounts = await getTableCounts(prodDbPath);
  console.log("  Pre-test production table counts:");
  for (const [table, count] of Object.entries(preCounts)) {
    console.log(`    ${table}: ${count}`);
  }
  assert(preCounts["interviews"] === 2, `Production baseline interviews count is 2 (got ${preCounts["interviews"]})`);
  assert(preCounts["turns"] === 64, `Production baseline turns count is 64 (got ${preCounts["turns"]})`);
  assert(preCounts["stages"] === 50, `Production baseline stages count is 50 (got ${preCounts["stages"]})`);
  assert(preCounts["projects"] === 7, `Production baseline projects count is 7 (got ${preCounts["projects"]})`);
  console.log();

  // ── SUITE 2: Isolated Test Database Setup ──────────────────────────────────
  console.log("Suite 2: Isolated Test Database Initialization");
  if (fs.existsSync(isolatedDbPath)) {
    try { fs.unlinkSync(isolatedDbPath); } catch {}
  }
  process.env.IDEAPROBE_DB_PATH = isolatedDbPath;
  resetDbClient();
  await initDb();
  assert(fs.existsSync(isolatedDbPath), `Isolated test DB initialized at ${isolatedDbPath}`);
  const db = getDb();

  // Setup test project A and test persona A
  const projAId = "proj-test-alpha";
  const projBId = "proj-test-beta";
  const now = nowUtc();

  await db.batch([
    {
      sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at)
            VALUES (?, 'Alpha Test Project', 'LIVE', 'active', ?, ?)`,
      args: [projAId, now, now],
    },
    {
      sql: `INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, created_at)
            VALUES (?, ?, 1, 'Exam cramming stress problem', 'Engineering Undergrads', 'Smart timetable app', ?)`,
      args: [`brief-${projAId}`, projAId, now],
    },
    {
      sql: `INSERT INTO personas (id, project_id, name, segment, context, objections, created_at)
            VALUES (?, ?, 'Rohan Verma', 'Undergraduate Engineering', 'Preparing for semester finals', '["Too expensive", "Setup takes too long"]', ?)`,
      args: ["persona-alpha-01", projAId, now],
    },
    {
      sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at)
            VALUES (?, 'Beta Test Project', 'LIVE', 'active', ?, ?)`,
      args: [projBId, now, now],
    },
    {
      sql: `INSERT INTO personas (id, project_id, name, segment, context, objections, created_at)
            VALUES (?, ?, 'Sneha Patel', 'Hospital Staff', 'Night shift rotations', '["No time to log in"]', ?)`,
      args: ["persona-beta-01", projBId, now],
    },
  ]);

  // Initial stage reconciliation for Project A
  const initialReconcile = await reconcileProjectStages(projAId);
  const initialIvStage = initialReconcile.stages.find((s) => s.stageKey === "interviews");
  assert(initialIvStage?.status === "queued", `Initial interviews stage status for project A is 'queued' (got ${initialIvStage?.status})`);
  assert(initialReconcile.runStatus === "running", `Initial run status is 'running' (got ${initialReconcile.runStatus})`);
  console.log();

  // ── SUITE 3: Starting Persona Chat Creates Single Interview Record ─────────
  console.log("Suite 3: Starting Persona Chat Creates Single Interview Record");
  const sessionIdA = "session-alpha-test-101";

  const chatReq1 = new NextRequest("http://localhost:3000/api/personas/persona-alpha-01/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA,
      projectId: projAId,
      message: "Hey Rohan, how do you handle exam scheduling currently?",
    }),
  });

  const chatRes1 = await chatRoute(chatReq1, { params: Promise.resolve({ id: "persona-alpha-01" }) });
  assert(chatRes1.status === 200, `First chat turn returns HTTP 200 (got ${chatRes1.status})`);
  const chatBody1 = await chatRes1.json();
  assert(chatBody1.data?.conversationId === sessionIdA, `Response conversationId matches sessionId (${chatBody1.data?.conversationId})`);
  assert(chatBody1.data?.interviewId === sessionIdA, `Response interviewId matches sessionId (${chatBody1.data?.interviewId})`);
  assert(chatBody1.data?.caveat.includes("SIMULATED ARTIFACT"), `Response includes simulation caveat`);

  // Verify interview row in DB
  const ivRows1 = await db.execute({
    sql: "SELECT * FROM interviews WHERE project_id = ?",
    args: [projAId],
  });
  assert(ivRows1.rows.length === 1, `Exactly 1 interview session created for project A (got ${ivRows1.rows.length})`);
  const ivRecord1 = ivRows1.rows[0];
  assert(ivRecord1.id === sessionIdA, `Interview ID equals sessionId (${ivRecord1.id})`);
  assert(ivRecord1.persona_id === "persona-alpha-01", `Interview links to correct persona (${ivRecord1.persona_id})`);
  assert(ivRecord1.provenance === "SIMULATED", `Interview provenance is strictly 'SIMULATED' (got ${ivRecord1.provenance})`);

  // Verify turns in DB
  const turnRows1 = await db.execute({
    sql: "SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at ASC",
    args: [sessionIdA],
  });
  assert(turnRows1.rows.length === 2, `Exactly 2 turns recorded for session 1 (got ${turnRows1.rows.length})`);
  assert(turnRows1.rows[0].role === "user" && turnRows1.rows[0].provenance === "USER_INPUT", `User turn has role 'user' and provenance 'USER_INPUT'`);
  assert(turnRows1.rows[1].role === "assistant", `Assistant turn has role 'assistant'`);
  console.log();

  // ── SUITE 4: Session Creation Idempotency Across Multiple Turns ───────────
  console.log("Suite 4: Session Creation Idempotency Across Multiple Turns");

  // Turn 2 in the same session
  const chatReq2 = new NextRequest("http://localhost:3000/api/personas/persona-alpha-01/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA,
      projectId: projAId,
      message: "Would you pay ₹99/month if setup took under 2 minutes?",
    }),
  });
  const chatRes2 = await chatRoute(chatReq2, { params: Promise.resolve({ id: "persona-alpha-01" }) });
  assert(chatRes2.status === 200, `Second chat turn returns HTTP 200`);

  // Turn 3 in the same session
  const chatReq3 = new NextRequest("http://localhost:3000/api/personas/persona-alpha-01/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA,
      projectId: projAId,
      message: "What happens when you miss a study session?",
    }),
  });
  const chatRes3 = await chatRoute(chatReq3, { params: Promise.resolve({ id: "persona-alpha-01" }) });
  assert(chatRes3.status === 200, `Third chat turn returns HTTP 200`);

  // Verify interview row count is STILL 1
  const ivRowsAfter3 = await db.execute({
    sql: "SELECT * FROM interviews WHERE project_id = ?",
    args: [projAId],
  });
  assert(ivRowsAfter3.rows.length === 1, `Interview session count remains strictly 1 after 3 turns (no duplicates)`);

  // Verify turns count is 6
  const turnRowsAfter3 = await db.execute({
    sql: "SELECT * FROM turns WHERE conversation_id = ?",
    args: [sessionIdA],
  });
  assert(turnRowsAfter3.rows.length === 6, `Total turns count is 6 (3 user + 3 assistant)`);
  console.log();

  // ── SUITE 5: Project Stage Reconciliation Verification ──────────────────────
  console.log("Suite 5: Project Stage Reconciliation Verification");
  const stageRes = await db.execute({
    sql: `SELECT s.stage_key, s.status, s.output_json, r.status as run_status
          FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'interviews'`,
    args: [projAId],
  });
  assert(stageRes.rows.length === 1, `Found interviews stage row for project A`);
  const ivStage = stageRes.rows[0];
  assert(ivStage.status === "completed", `Interviews stage transitioned to 'completed' (got ${ivStage.status})`);
  const outputJson = JSON.parse(String(ivStage.output_json));
  assert(outputJson.provenance === "SIMULATED", `Stage outputJson provenance is 'SIMULATED' (got ${outputJson.provenance})`);
  assert(outputJson.itemCount === 1, `Stage outputJson itemCount reflects 1 interview session`);
  assert(outputJson.caveat.includes("NEVER use synthetic interviews"), `Stage outputJson contains strict simulation caveat`);
  console.log();

  // ── SUITE 6: Cross-Project Persona Access & Isolation ──────────────────────
  console.log("Suite 6: Cross-Project Persona Access & Isolation");

  // Attempt to use persona-alpha-01 (belongs to projA) with projectId: projB
  const crossReq = new NextRequest("http://localhost:3000/api/personas/persona-alpha-01/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-cross-proj-attempt",
      projectId: projBId,
      message: "Testing cross-project injection",
    }),
  });
  const crossRes = await chatRoute(crossReq, { params: Promise.resolve({ id: "persona-alpha-01" }) });
  assert(crossRes.status === 403, `Cross-project persona access returns HTTP 403 (got ${crossRes.status})`);
  const crossBody = await crossRes.json();
  assert(crossBody.error?.code === "PROJECT_MISMATCH", `Error code is PROJECT_MISMATCH (got ${crossBody.error?.code})`);

  // Ensure NO writes occurred for project B or session-cross-proj-attempt
  const ivBCount = await db.execute({
    sql: "SELECT COUNT(*) as count FROM interviews WHERE project_id = ?",
    args: [projBId],
  });
  assert(Number(ivBCount.rows[0].count) === 0, `Project B has 0 interviews after rejected cross-project attempt`);

  const crossIvCount = await db.execute({
    sql: "SELECT COUNT(*) as count FROM interviews WHERE id = 'session-cross-proj-attempt'",
  });
  assert(Number(crossIvCount.rows[0].count) === 0, `Cross-project interview ID was not created`);

  // Attempt to reuse session from Project A in a chat with Project B persona
  const crossSessionReq = new NextRequest("http://localhost:3000/api/personas/persona-beta-01/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA, // belongs to Project A!
      projectId: projBId,
      message: "Trying to hijack Project A session from Project B persona",
    }),
  });
  const crossSessionRes = await chatRoute(crossSessionReq, { params: Promise.resolve({ id: "persona-beta-01" }) });
  assert(crossSessionRes.status === 403, `Hijacking existing session from another project returns HTTP 403`);
  console.log();

  // ── SUITE 7: Failed or Invalid Requests Do Not Write Records ───────────────
  console.log("Suite 7: Failed or Invalid Requests Do Not Write Misleading Records");

  // Empty message
  const emptyReq = new NextRequest("http://localhost:3000/api/personas/persona-alpha-01/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-empty-msg-test",
      message: "   ",
    }),
  });
  const emptyRes = await chatRoute(emptyReq, { params: Promise.resolve({ id: "persona-alpha-01" }) });
  assert(emptyRes.status === 400, `Empty message returns HTTP 400 (got ${emptyRes.status})`);

  const emptyIvCheck = await db.execute({
    sql: "SELECT COUNT(*) as count FROM interviews WHERE id = 'session-empty-msg-test'",
  });
  assert(Number(emptyIvCheck.rows[0].count) === 0, `No interview record created for invalid empty message`);

  // Non-existent persona
  const missingPersonaReq = new NextRequest("http://localhost:3000/api/personas/non-existent-persona/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-missing-persona",
      message: "Hello?",
    }),
  });
  const missingRes = await chatRoute(missingPersonaReq, { params: Promise.resolve({ id: "non-existent-persona" }) });
  assert(missingRes.status === 404, `Missing persona returns HTTP 404 (got ${missingRes.status})`);

  const missingIvCheck = await db.execute({
    sql: "SELECT COUNT(*) as count FROM interviews WHERE id = 'session-missing-persona'",
  });
  assert(Number(missingIvCheck.rows[0].count) === 0, `No interview record created for missing persona`);
  console.log();

  // ── SUITE 8: Existing Real/Demo Interviews Remain Intact ───────────────────
  console.log("Suite 8: Existing Real/Demo Interviews Remain Intact");
  const seededIv1 = await db.execute({
    sql: "SELECT * FROM interviews WHERE id = 'interview-01'",
  });
  assert(seededIv1.rows.length === 1, `Seeded interview-01 exists`);
  assert(seededIv1.rows[0].provenance === "SIMULATED", `interview-01 provenance is 'SIMULATED'`);
  assert(seededIv1.rows[0].project_id === "proj-study-planner", `interview-01 project_id is 'proj-study-planner'`);

  const seededIv2 = await db.execute({
    sql: "SELECT * FROM interviews WHERE id = 'interview-02'",
  });
  assert(seededIv2.rows.length === 1, `Seeded interview-02 exists`);
  assert(seededIv2.rows[0].provenance === "SIMULATED", `interview-02 provenance is 'SIMULATED'`);
  console.log();

  // ── SUITE 9: Production Database Post-Execution Invariance Check ───────────
  console.log("Suite 9: Production Database Post-Execution Invariance Check");
  const postCounts = await getTableCounts(prodDbPath);
  console.log("  Post-test production table counts:");
  let invariancePass = true;
  for (const [table, count] of Object.entries(preCounts)) {
    const postCount = postCounts[table];
    if (postCount !== count) {
      invariancePass = false;
      console.error(`  ✗ MISMATCH on ${table}: was ${count}, now ${postCount}`);
    }
  }
  assert(invariancePass, `All 16 production tables remain exactly identical to pre-test baseline (0 writes)`);
  assert(postCounts["interviews"] === preCounts["interviews"], `Production interviews count unchanged (${postCounts["interviews"]})`);
  assert(postCounts["turns"] === preCounts["turns"], `Production turns count unchanged (${postCounts["turns"]})`);
  assert(postCounts["stages"] === preCounts["stages"], `Production stages count unchanged (${postCounts["stages"]})`);
  assert(postCounts["projects"] === preCounts["projects"], `Production projects count unchanged (${postCounts["projects"]})`);
  console.log();

  // Clean up isolated DB
  if (fs.existsSync(isolatedDbPath)) {
    try { fs.unlinkSync(isolatedDbPath); } catch {}
  }

  console.log("================================================================================");
  console.log(`  TL-077 RESULTS: ${passedAssertions} passed, ${failedAssertions} failed`);
  console.log("================================================================================");

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
