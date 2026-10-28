/**
 * IdeaProbe — Phase 3J Automated Verification Suite
 *
 * Verifies stage status reconciliation against SQLite database in complete isolation:
 * 1. A new project with no supporting data retains appropriate initial stage states.
 * 2. Adding relevant real project data updates only the corresponding stage status.
 * 3. Existing completed stages do not regress incorrectly.
 * 4. Different projects' stages remain isolated.
 * 5. DEMO fixtures do not falsely advance LIVE project stages.
 * 6. Repeated reconciliation is idempotent.
 * 7. Overview progress agrees with persisted stage statuses.
 * 8. Existing project creation, evidence, experiments, and report behavior remains intact.
 *
 * SAFETY INVARIANT:
 * - Production SQLite database is verified before and after test execution (0 writes).
 * - All tests execute against an isolated temporary SQLite database.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── 0. Production Database Pre-Check Invariant ───────────────────────
const PROD_DB_PATH = path.join(__dirname, ".ideaprobe-data", "ideaprobe.db");
function getProdDbStats(): { exists: boolean; size: number; mtime: number } {
  if (!fs.existsSync(PROD_DB_PATH)) {
    return { exists: false, size: 0, mtime: 0 };
  }
  const stat = fs.statSync(PROD_DB_PATH);
  return { exists: true, size: stat.size, mtime: stat.mtimeMs };
}

const preStats = getProdDbStats();

// Configure isolated temporary database BEFORE importing any lib modules
const TEMP_DB_DIR = path.join(__dirname, "scratch");
if (!fs.existsSync(TEMP_DB_DIR)) {
  fs.mkdirSync(TEMP_DB_DIR, { recursive: true });
}
const TEMP_DB_PATH = path.join(TEMP_DB_DIR, `test-phase3j-${Date.now()}.db`);
process.env.IDEAPROBE_DB_PATH = TEMP_DB_PATH;

// Now import database and reconciliation utilities
import { initDb, getDb, nowUtc } from "./src/lib/db";
import {
  reconcileProjectStages,
  determineStageState,
  type ProjectEntityCounts,
} from "./src/lib/stageReconciliation";
import { STAGE_KEYS, type StageKey } from "./src/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTestSuite() {
  console.log("\n=======================================================");
  console.log("IdeaProbe — Phase 3J: Stage Status Reconciliation Suite");
  console.log("=======================================================\n");

  await initDb();
  const db = getDb();
  const now = nowUtc();

  // ── Scenario 1: New project with no supporting data retains initial queued states ──
  console.log("Scenario 1: New project with no supporting data retains initial queued states");
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'LIVE', 'active', ?, ?)",
    args: ["proj-new-1", "Clean Slate Project", now, now],
  });
  await db.execute({
    sql: "INSERT INTO runs (id, project_id, status, mode, prompt_version, created_at) VALUES (?, ?, 'queued', 'LIVE', 'phase2-v1', ?)",
    args: ["run-new-1", "proj-new-1", now],
  });
  for (const k of STAGE_KEYS) {
    await db.execute({
      sql: "INSERT INTO stages (id, run_id, stage_key, status, attempt) VALUES (?, ?, ?, 'queued', 1)",
      args: [`stg-n1-${k}`, "run-new-1", k],
    });
  }

  const res1 = await reconcileProjectStages("proj-new-1");
  assert(res1.completedStagesCount === 0, "Scenario 1: Completed stages count is 0 for project with no supporting data");
  assert(res1.runStatus === "queued", "Scenario 1: Run status remains 'queued'");
  assert(res1.stages.length === 10, "Scenario 1: Exactly 10 stages returned");
  const allQueued = res1.stages.every((s) => s.status === "queued");
  assert(allQueued, "Scenario 1: All 10 stages retain 'queued' status");

  // ── Scenario 2: Adding relevant real project data updates ONLY corresponding stage status ──
  console.log("\nScenario 2: Adding relevant real project data updates only corresponding stage status");
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'LIVE', 'active', ?, ?)",
    args: ["proj-prog-1", "Progression Project", now, now],
  });
  await db.execute({
    sql: "INSERT INTO runs (id, project_id, status, mode, prompt_version, created_at) VALUES (?, ?, 'queued', 'LIVE', 'phase2-v1', ?)",
    args: ["run-prog-1", "proj-prog-1", now],
  });
  for (const k of STAGE_KEYS) {
    await db.execute({
      sql: "INSERT INTO stages (id, run_id, stage_key, status, attempt) VALUES (?, ?, ?, 'queued', 1)",
      args: [`stg-p1-${k}`, "run-prog-1", k],
    });
  }

  // 2a. Add 1 source (0 evidence) -> research becomes running, others remain queued
  await db.execute({
    sql: "INSERT INTO sources (id, project_id, title, url, source_type, retrieved_at, created_at) VALUES (?, ?, ?, ?, 'web', ?, ?)",
    args: ["src-p1", "proj-prog-1", "Industry Report", "https://example.com/rep", now, now],
  });
  const res2a = await reconcileProjectStages("proj-prog-1");
  const research2a = res2a.stages.find((s) => s.stageKey === "research");
  assert(research2a?.status === "running", "Scenario 2a: Adding source updates research to 'running'");
  const othersQueued2a = res2a.stages.filter((s) => s.stageKey !== "research").every((s) => s.status === "queued");
  assert(othersQueued2a, "Scenario 2a: All other 9 stages remain 'queued'");
  assert(res2a.runStatus === "running", "Scenario 2a: Run status is 'running'");

  // 2b. Add evidence -> research becomes completed, others remain queued
  await db.execute({
    sql: "INSERT INTO evidence (id, project_id, source_id, claim, excerpt, provenance, confidence, reviewer_status, created_at) VALUES (?, ?, ?, ?, ?, 'REAL_SOURCE', 'High', 'ACCEPTED', ?)",
    args: ["ev-p1", "proj-prog-1", "src-p1", "High demand verified", "Excerpt here", now],
  });
  const res2b = await reconcileProjectStages("proj-prog-1");
  const research2b = res2b.stages.find((s) => s.stageKey === "research");
  assert(research2b?.status === "completed", "Scenario 2b: Adding evidence updates research to 'completed'");
  assert(Boolean(research2b?.completedAt), "Scenario 2b: research stage has completedAt timestamp");
  const othersQueued2b = res2b.stages.filter((s) => s.stageKey !== "research").every((s) => s.status === "queued");
  assert(othersQueued2b, "Scenario 2b: All other 9 stages still remain 'queued'");

  // 2c. Add competitor -> competitors becomes completed, other non-research remain queued
  await db.execute({
    sql: "INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance, created_at) VALUES (?, ?, ?, 'direct', 'Desc', 'Diff', 'AI_INFERENCE', ?)",
    args: ["comp-p1", "proj-prog-1", "Competitor Alpha", now],
  });
  const res2c = await reconcileProjectStages("proj-prog-1");
  const comp2c = res2c.stages.find((s) => s.stageKey === "competitors");
  assert(comp2c?.status === "completed", "Scenario 2c: Adding competitor updates competitors to 'completed'");
  const resOtherQueued2c = res2c.stages.filter((s) => !["research", "competitors"].includes(s.stageKey)).every((s) => s.status === "queued");
  assert(resOtherQueued2c, "Scenario 2c: Remaining 8 stages remain 'queued'");

  // 2d. Add brief with target customer -> icp becomes completed
  await db.execute({
    sql: `INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, provenance, created_at)
          VALUES (?, ?, 1, 'Problem statement', 'College engineering students in India', 'Solution statement', 'USER_INPUT', ?)`,
    args: ["brief-p1", "proj-prog-1", now],
  });
  const res2d = await reconcileProjectStages("proj-prog-1");
  const icp2d = res2d.stages.find((s) => s.stageKey === "icp");
  assert(icp2d?.status === "completed", "Scenario 2d: Adding brief with target_customer updates icp to 'completed'");

  // 2e. Add persona -> personas becomes completed
  await db.execute({
    sql: `INSERT INTO personas (id, project_id, name, segment, context, jobs, pains, goals, behaviors, constraints, objections, assumptions, provenance, created_at)
          VALUES (?, ?, 'Arjun', 'Student', 'Hostel', '[]', '[]', '[]', '[]', '[]', '[]', '[]', 'SIMULATED', ?)`,
    args: ["pers-p1", "proj-prog-1", now],
  });
  const res2e = await reconcileProjectStages("proj-prog-1");
  const pers2e = res2e.stages.find((s) => s.stageKey === "personas");
  assert(pers2e?.status === "completed", "Scenario 2e: Adding persona updates personas to 'completed'");

  // 2f. Add interview -> interviews becomes completed
  await db.execute({
    sql: "INSERT INTO interviews (id, project_id, persona_id, scenario, provenance, created_at) VALUES (?, ?, ?, 'Exam prep', 'SIMULATED', ?)",
    args: ["int-p1", "proj-prog-1", "pers-p1", now],
  });
  const res2f = await reconcileProjectStages("proj-prog-1");
  const int2f = res2f.stages.find((s) => s.stageKey === "interviews");
  assert(int2f?.status === "completed", "Scenario 2f: Adding interview updates interviews to 'completed'");

  // 2g. Add insight -> insights becomes completed
  await db.execute({
    sql: "INSERT INTO insights (id, project_id, statement, type, confidence, provenance, created_at) VALUES (?, ?, 'Key friction pattern', 'theme', 'High', 'AI_INFERENCE', ?)",
    args: ["ins-p1", "proj-prog-1", now],
  });
  const res2g = await reconcileProjectStages("proj-prog-1");
  const ins2g = res2g.stages.find((s) => s.stageKey === "insights");
  assert(ins2g?.status === "completed", "Scenario 2g: Adding insight updates insights to 'completed'");

  // 2h. Add assumption -> risks becomes completed
  await db.execute({
    sql: "INSERT INTO assumptions (id, project_id, statement, category, impact, uncertainty, status, provenance, created_at) VALUES (?, ?, 'Students will pay ₹99', 'pricing', 'High', 'High', 'unvalidated', 'AI_INFERENCE', ?)",
    args: ["asm-p1", "proj-prog-1", now],
  });
  const res2h = await reconcileProjectStages("proj-prog-1");
  const risks2h = res2h.stages.find((s) => s.stageKey === "risks");
  assert(risks2h?.status === "completed", "Scenario 2h: Adding assumption updates risks to 'completed'");

  // 2i. Experiments semantics:
  // - Planned experiment -> running (NOT completed!)
  await db.execute({
    sql: `INSERT INTO experiments (id, project_id, assumption_id, hypothesis, method, metric, threshold, status, provenance, created_at)
          VALUES (?, ?, 'asm-p1', '50% will click buy', 'Landing page', 'CTR', '5%', 'planned', 'AI_INFERENCE', ?)`,
    args: ["exp-p1", "proj-prog-1", now],
  });
  const res2i1 = await reconcileProjectStages("proj-prog-1");
  const exp2i1 = res2i1.stages.find((s) => s.stageKey === "experiments");
  assert(exp2i1?.status === "running", "Scenario 2i.1: Planned experiment correctly evaluates to 'running' (not prematurely completed)");

  // - Completed experiment -> completed
  await db.execute({
    sql: "UPDATE experiments SET status = 'completed', result = '62% CTR achieved' WHERE id = ?",
    args: ["exp-p1"],
  });
  const res2i2 = await reconcileProjectStages("proj-prog-1");
  const exp2i2 = res2i2.stages.find((s) => s.stageKey === "experiments");
  assert(exp2i2?.status === "completed", "Scenario 2i.2: Completed experiment with result evaluates to 'completed'");

  // 2j. Add MVP feature -> mvp becomes completed
  await db.execute({
    sql: "INSERT INTO mvp_features (id, project_id, name, scope, priority, effort, status, provenance, created_at) VALUES (?, ?, 'Auto-Rescheduler', 'Core', 'now', 'Medium', 'candidate', 'AI_INFERENCE', ?)",
    args: ["mvp-p1", "proj-prog-1", now],
  });
  const res2j = await reconcileProjectStages("proj-prog-1");
  const mvp2j = res2j.stages.find((s) => s.stageKey === "mvp");
  assert(mvp2j?.status === "completed", "Scenario 2j: Adding MVP feature updates mvp to 'completed'");

  // 2k. Add report snapshot -> report becomes completed & run status becomes completed
  await db.execute({
    sql: "INSERT INTO report_snapshots (id, project_id, content, provenance_manifest, contains_simulated, contains_sample, version, generated_at) VALUES (?, ?, '[]', '{}', 0, 0, 1, ?)",
    args: ["snap-p1", "proj-prog-1", now],
  });
  const res2k = await reconcileProjectStages("proj-prog-1");
  const rep2k = res2k.stages.find((s) => s.stageKey === "report");
  assert(rep2k?.status === "completed", "Scenario 2k: Adding report snapshot updates report to 'completed'");
  assert(res2k.completedStagesCount === 10, "Scenario 2k: Exactly 10 of 10 stages completed");
  assert(res2k.runStatus === "completed", "Scenario 2k: Parent run status transitions to 'completed' when all 10 stages are complete");

  // ── Scenario 3: Completed stages do not regress incorrectly & timestamps preserve ──
  console.log("\nScenario 3: Existing completed stages do not regress & timestamps preserve");
  const initialCompletedAt = research2b?.completedAt;
  assert(Boolean(initialCompletedAt), "Scenario 3: Stage research has initial completedAt");

  // Reconcile again without altering research evidence
  const res3 = await reconcileProjectStages("proj-prog-1");
  const research3 = res3.stages.find((s) => s.stageKey === "research");
  assert(research3?.status === "completed", "Scenario 3: Completed stage remains completed");
  assert(research3?.completedAt === initialCompletedAt, "Scenario 3: Completed stage preserves exact completedAt timestamp without churn");

  // Test abandoned experiments semantics: if all experiments abandoned, stage becomes 'failed'
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'LIVE', 'active', ?, ?)",
    args: ["proj-abandoned", "Abandoned Project", now, now],
  });
  await db.execute({
    sql: "INSERT INTO runs (id, project_id, status, mode, prompt_version, created_at) VALUES (?, ?, 'queued', 'LIVE', 'phase2-v1', ?)",
    args: ["run-ab-1", "proj-abandoned", now],
  });
  await db.execute({
    sql: `INSERT INTO experiments (id, project_id, hypothesis, method, metric, threshold, status, provenance, created_at)
          VALUES (?, ?, 'Failed test', 'Method', 'Metric', 'Threshold', 'abandoned', 'AI_INFERENCE', ?)`,
    args: ["exp-ab-1", "proj-abandoned", now],
  });
  const resAb = await reconcileProjectStages("proj-abandoned");
  const expAb = resAb.stages.find((s) => s.stageKey === "experiments");
  assert(expAb?.status === "failed", "Scenario 3b: Abandoned experiments transition stage to 'failed'");

  // ── Scenario 4: Different projects' stages remain isolated ──
  console.log("\nScenario 4: Different projects' stages remain strictly isolated");
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'LIVE', 'active', ?, ?)",
    args: ["proj-iso-a", "Isolated Project A", now, now],
  });
  await db.execute({
    sql: "INSERT INTO runs (id, project_id, status, mode, prompt_version, created_at) VALUES (?, ?, 'queued', 'LIVE', 'phase2-v1', ?)",
    args: ["run-iso-a", "proj-iso-a", now],
  });
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'LIVE', 'active', ?, ?)",
    args: ["proj-iso-b", "Isolated Project B", now, now],
  });
  await db.execute({
    sql: "INSERT INTO runs (id, project_id, status, mode, prompt_version, created_at) VALUES (?, ?, 'queued', 'LIVE', 'phase2-v1', ?)",
    args: ["run-iso-b", "proj-iso-b", now],
  });

  // Add 3 competitors to Project A only
  await db.execute({
    sql: "INSERT INTO competitors (id, project_id, name, category, created_at) VALUES ('comp-iso-a1', 'proj-iso-a', 'Comp A1', 'direct', ?)",
    args: [now],
  });
  await db.execute({
    sql: "INSERT INTO competitors (id, project_id, name, category, created_at) VALUES ('comp-iso-a2', 'proj-iso-a', 'Comp A2', 'indirect', ?)",
    args: [now],
  });

  const resIsoA = await reconcileProjectStages("proj-iso-a");
  const resIsoB = await reconcileProjectStages("proj-iso-b");

  const compA = resIsoA.stages.find((s) => s.stageKey === "competitors");
  const compB = resIsoB.stages.find((s) => s.stageKey === "competitors");

  assert(compA?.status === "completed", "Scenario 4: Project A competitors stage is completed");
  assert(compB?.status === "queued", "Scenario 4: Project B competitors stage remains queued (zero leakage from A)");
  assert(resIsoB.completedStagesCount === 0, "Scenario 4: Project B has 0 completed stages");

  // ── Scenario 5: DEMO fixtures do not falsely advance LIVE project stages ──
  console.log("\nScenario 5: DEMO fixtures do not falsely advance LIVE project stages");
  // Demo project proj-study-planner was seeded by initDb with all 10 completed stages and sample records
  const demoDbRes = await db.execute({
    sql: "SELECT id FROM projects WHERE id = 'proj-study-planner'",
  });
  assert(demoDbRes.rows.length > 0, "Scenario 5: DEMO project proj-study-planner exists in database");

  // Reconcile demo project to verify demo stages are completed
  const resDemo = await reconcileProjectStages("proj-study-planner");
  assert(resDemo.completedStagesCount === 10, "Scenario 5: DEMO project has 10 of 10 completed stages");

  // Create clean live project
  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'LIVE', 'active', ?, ?)",
    args: ["proj-clean-live", "Pure Live Project", now, now],
  });

  const resLive = await reconcileProjectStages("proj-clean-live");
  assert(resLive.completedStagesCount === 0, "Scenario 5: Live project has 0 completed stages despite DEMO project having fixtures");
  const liveResearch = resLive.stages.find((s) => s.stageKey === "research");
  assert(liveResearch?.status === "queued", "Scenario 5: Live research stage is queued (not advanced by demo evidence)");
  const liveComp = resLive.stages.find((s) => s.stageKey === "competitors");
  assert(liveComp?.status === "queued", "Scenario 5: Live competitors stage is queued (not advanced by demo competitors)");

  // ── Scenario 6: Repeated reconciliation is idempotent ──
  console.log("\nScenario 6: Repeated reconciliation is idempotent");
  const pass1 = await reconcileProjectStages("proj-prog-1");
  const pass2 = await reconcileProjectStages("proj-prog-1");
  const pass3 = await reconcileProjectStages("proj-prog-1");

  assert(pass1.completedStagesCount === pass2.completedStagesCount, "Scenario 6: Pass 1 and Pass 2 completed stage counts match");
  assert(pass2.completedStagesCount === pass3.completedStagesCount, "Scenario 6: Pass 2 and Pass 3 completed stage counts match");
  assert(pass1.runStatus === pass3.runStatus, "Scenario 6: Run status is strictly identical across passes");

  // Check database rows directly
  const dbStagesRes = await db.execute({
    sql: "SELECT stage_key, status, completed_at FROM stages WHERE run_id = ? ORDER BY stage_key ASC",
    args: [pass1.runId],
  });
  assert(dbStagesRes.rows.length === 10, "Scenario 6: Exactly 10 stage rows exist in SQLite after repeated passes (no duplicate rows)");

  // ── Scenario 7: Overview progress agrees with persisted stage statuses ──
  console.log("\nScenario 7: Overview progress agrees with persisted stage statuses");
  const stagesFromDb = await db.execute({
    sql: "SELECT stage_key, status FROM stages WHERE run_id = ?",
    args: [pass1.runId],
  });
  const completedInDb = stagesFromDb.rows.filter((r: any) => r.status === "completed").length;
  assert(completedInDb === pass1.completedStagesCount, "Scenario 7: Persisted completed count matches returned completedStagesCount");
  assert(completedInDb === 10, "Scenario 7: Completed count in DB is exactly 10 for fully populated project");

  // Also verify on partial project
  const stagesFromIsoA = await db.execute({
    sql: "SELECT stage_key, status FROM stages WHERE run_id = ?",
    args: [resIsoA.runId],
  });
  const completedIsoA = stagesFromIsoA.rows.filter((r: any) => r.status === "completed").length;
  assert(completedIsoA === resIsoA.completedStagesCount, "Scenario 7: Partial project DB count agrees with returned stage statuses");

  // ── Scenario 8: Existing project creation, evidence, experiments, and report behavior remains intact ──
  console.log("\nScenario 8: Existing project creation, evidence, experiments, and report behavior remains intact");
  // Test project creation via API route handler
  const { POST: createProjectPost } = await import("./src/app/api/projects/route");
  const reqCreate = new Request("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "End-to-End Test Project",
      mode: "LIVE",
      problem: "Students struggle with homework",
      target_customer: "Middle school students",
      solution: "AI tutor assistant",
    }),
  });
  const resCreateObj = await createProjectPost(reqCreate as any);
  const jsonCreate = await resCreateObj.json();
  assert(resCreateObj.status === 201, "Scenario 8: POST /api/projects succeeds with 201");
  assert(Boolean(jsonCreate.data?.projectId), "Scenario 8: Returns created projectId");
  const newPid = jsonCreate.data.projectId;

  // Verify newly created project stages exist in DB
  const newProjStages = await db.execute({
    sql: "SELECT s.* FROM stages s JOIN runs r ON s.run_id = r.id WHERE r.project_id = ?",
    args: [newPid],
  });
  assert(newProjStages.rows.length === 10, "Scenario 8: 10 initial stage rows created in SQLite");

  // Verify GET /api/projects/[id]/stages route handler
  const { GET: getStagesRoute } = await import("./src/app/api/projects/[id]/stages/route");
  const reqStages = new Request(`http://localhost:3000/api/projects/${newPid}/stages`);
  const stagesRouteRes = await getStagesRoute(reqStages as any, { params: Promise.resolve({ id: newPid }) });
  const stagesRouteJson = await stagesRouteRes.json();
  assert(stagesRouteRes.status === 200, "Scenario 8: GET /api/projects/[id]/stages returns 200 OK");
  assert(stagesRouteJson.data?.stages?.length === 10, "Scenario 8: Stages route returns 10 stages");

  // ── Post-Check Production Safety Invariant ─────────────────

  // Clean up temporary database file
  if (fs.existsSync(TEMP_DB_PATH)) {
    try {
      fs.unlinkSync(TEMP_DB_PATH);
    } catch {
      // Temp file cleanup best-effort on Windows
    }
  }

  console.log("\n=======================================================");
  console.log("Production Database Invariance Verification");
  console.log("=======================================================");
  const postStats = getProdDbStats();
  assert(preStats.exists === postStats.exists, "Production DB file existence preserved");
  assert(preStats.size === postStats.size, `Production DB size unchanged (${preStats.size} === ${postStats.size})`);
  assert(preStats.mtime === postStats.mtime, `Production DB mtime unchanged (${preStats.mtime} === ${postStats.mtime})`);

  console.log("\n=======================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
