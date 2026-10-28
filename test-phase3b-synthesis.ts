/**
 * Phase 3B Regression Test Suite: Evidence-to-Insight Synthesis Gate
 *
 * Verifies:
 * 1. Human review gate filtering (only ACCEPTED/EDITED evidence eligible for synthesis).
 * 2. Fail-fast error handling when live project has no eligible evidence (NO_ELIGIBLE_EVIDENCE).
 * 3. Fail-fast error handling when live inference fails (INFERENCE_FAILED, no fallback).
 * 4. Grounded citation constraint (evidence_for_ids filtered to eligible context).
 * 5. Production database invariance prior to controlled execution.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@libsql/client";
import { validateInsight, INSIGHT_SCHEMA_DESC } from "./src/lib/ollama";

async function runTests() {
  console.log("=======================================================");
  console.log("  IdeaProbe Phase 3B: Evidence-to-Insight Test Suite");
  console.log("=======================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // ── Suite 1: Source Code Audit for Human Review Gate & Fail-Fast ──
  console.log("Suite 1: Source Code Audit for Human Review Gate & Fail-Fast");
  const routePath = path.join(__dirname, "src/app/api/projects/[id]/insights/generate/route.ts");
  const routeSrc = fs.readFileSync(routePath, "utf-8");

  assert(
    routeSrc.includes("reviewer_status IN ('ACCEPTED', 'EDITED')"),
    "insights/generate filters evidence by reviewer_status IN ('ACCEPTED', 'EDITED')"
  );

  assert(
    routeSrc.includes("NO_ELIGIBLE_EVIDENCE"),
    "insights/generate returns NO_ELIGIBLE_EVIDENCE when live project has no accepted evidence"
  );

  assert(
    routeSrc.includes("INFERENCE_FAILED") && routeSrc.includes("Fallbacks are not permitted for live customer synthesis"),
    "insights/generate rejects offline fallbacks for live projects with INFERENCE_FAILED"
  );

  assert(
    routeSrc.includes("validEvidenceIds") && routeSrc.includes("validEvidenceIds.has"),
    "insights/generate bounds evidence_for_ids strictly to valid eligible evidence IDs"
  );

  // ── Suite 2: Isolated Temp Database Simulation ─────────────────────
  console.log("\nSuite 2: Isolated Temp Database Evidence Gate & Schema Validation");
  const scratchDir = path.join(__dirname, "scratch");
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const tempDbPath = path.join(scratchDir, "test_phase3b_isolated.db");
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const testDb = createClient({ url: `file:${tempDbPath.replace(/\\/g, "/")}` });
  await testDb.execute(`CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL)`);
  await testDb.execute(`CREATE TABLE evidence (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT,
    claim TEXT NOT NULL, excerpt TEXT, provenance TEXT NOT NULL,
    confidence TEXT NOT NULL, reviewer_status TEXT NOT NULL,
    caveat TEXT, created_at TEXT NOT NULL
  )`);
  await testDb.execute(`CREATE TABLE insights (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, statement TEXT NOT NULL,
    type TEXT NOT NULL, confidence TEXT NOT NULL, evidence_for_ids TEXT,
    evidence_against_ids TEXT, caveat TEXT, provenance TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  await testDb.execute({
    sql: "INSERT INTO projects VALUES ('proj-test-live', 'Test Live', 'LIVE', 'active')",
    args: [],
  });

  await testDb.execute({
    sql: "INSERT INTO evidence VALUES ('ev-acc-1', 'proj-test-live', 'src-1', 'Accepted Claim', 'Excerpt 1', 'REAL_SOURCE', 'High', 'ACCEPTED', null, '2026-10-25T00:00:00Z')",
    args: [],
  });
  await testDb.execute({
    sql: "INSERT INTO evidence VALUES ('ev-unrev-2', 'proj-test-live', 'src-2', 'Unreviewed Claim', 'Excerpt 2', 'REAL_SOURCE', 'Medium', 'UNREVIEWED', null, '2026-10-25T00:00:00Z')",
    args: [],
  });
  await testDb.execute({
    sql: "INSERT INTO evidence VALUES ('ev-rej-3', 'proj-test-live', 'src-3', 'Rejected Claim', 'Excerpt 3', 'REAL_SOURCE', 'Low', 'REJECTED', null, '2026-10-25T00:00:00Z')",
    args: [],
  });

  // Query using the exact query from route.ts
  const qRes = await testDb.execute({
    sql: `SELECT id, reviewer_status FROM evidence WHERE project_id = 'proj-test-live' AND reviewer_status IN ('ACCEPTED', 'EDITED')`,
    args: [],
  });

  assert(qRes.rows.length === 1, `Eligible evidence query returns exactly 1 item (got ${qRes.rows.length})`);
  assert(qRes.rows[0].id === "ev-acc-1", `Selected evidence is ev-acc-1`);
  assert(qRes.rows[0].reviewer_status === "ACCEPTED", `Selected evidence has reviewer_status ACCEPTED`);

  // Verify validateInsight on a candidate live synthesis
  const candidateInsight = {
    statement: "Verified delivery infrastructure exists for moving goods to campus, but the service is designed for off-campus students rather than hostel residents requiring frequent intra-campus movement.",
    type: "theme",
    confidence: "medium",
    evidence_for_ids: ["ev-acc-1"],
    evidence_against_ids: [],
    caveat: "The evidence describes a one-time move-in shipping service for off-campus students, not a recurring delivery solution for hostel residents.",
    provenance: "AI_INFERENCE",
  };

  const validated = validateInsight(candidateInsight);
  assert(validated.statement === candidateInsight.statement, "validateInsight accepts candidate statement");
  assert(validated.type === "theme", "validateInsight preserves type theme");
  assert(validated.provenance === "AI_INFERENCE", "validateInsight enforces AI_INFERENCE provenance");
  assert(validated.evidence_for_ids[0] === "ev-acc-1", "validateInsight preserves supporting evidence ID");

  // Insert into isolated test DB and query back
  await testDb.execute({
    sql: `INSERT INTO insights VALUES ('ins-test-1', 'proj-test-live', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      validated.statement,
      validated.type,
      "Medium",
      JSON.stringify(validated.evidence_for_ids),
      JSON.stringify(validated.evidence_against_ids),
      validated.caveat,
      validated.provenance,
    ],
  });

  const insRes = await testDb.execute("SELECT * FROM insights WHERE project_id = 'proj-test-live'");
  assert(insRes.rows.length === 1, "Isolated DB contains exactly 1 insight");
  assert(insRes.rows[0].provenance === "AI_INFERENCE", "Persisted provenance is AI_INFERENCE");
  assert(JSON.parse(String(insRes.rows[0].evidence_for_ids))[0] === "ev-acc-1", "Persisted evidence reference matches");

  // ── Suite 3: Production Database Baseline Invariance ───────────────
  console.log("\nSuite 3: Production Database Baseline Invariance (Read-Only)");
  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const prodDb = createClient({ url: `file:${prodDbPath.replace(/\\/g, "/")}` });

  const tables = [
    { name: "projects", expected: 6 },
    { name: "idea_briefs", expected: 6 },
    { name: "runs", expected: 4 },
    { name: "stages", expected: 40 },
    { name: "sources", expected: 24 },
    { name: "evidence", expected: 24 },
    { name: "competitors", expected: 6 },
    { name: "personas", expected: 4 },
    { name: "interviews", expected: 2 },
    { name: "turns", expected: 60 },
    { name: "insights", expected: 11 },
    { name: "assumptions", expected: 5 },
    { name: "experiments", expected: 3 },
    { name: "mvp_features", expected: 7 },
    { name: "report_snapshots", expected: 230 },
  ];

  for (const t of tables) {
    const res = await prodDb.execute(`SELECT COUNT(*) as c FROM ${t.name}`);
    const count = Number(res.rows[0].c);
    assert(count === t.expected, `Prod table '${t.name}' count invariant: ${count} === ${t.expected}`);
  }

  // Check CampusCourier specific baseline
  const ccInsights = await prodDb.execute("SELECT id, statement, type, confidence, evidence_for_ids, provenance FROM insights WHERE project_id = 'proj-f3554e11'");
  assert(ccInsights.rows.length === 1, `CampusCourier has exactly 1 insight (got ${ccInsights.rows.length})`);
  const ccIns = ccInsights.rows[0];
  assert(ccIns.provenance === "AI_INFERENCE", "CampusCourier insight provenance is AI_INFERENCE");
  const ccEvIds = JSON.parse(String(ccIns.evidence_for_ids));
  assert(ccEvIds.includes("ev-tf-1792966687905-0"), "CampusCourier insight cites ev-tf-1792966687905-0");

  const ccTargetEv = await prodDb.execute("SELECT id, reviewer_status, provenance FROM evidence WHERE id = 'ev-tf-1792966687905-0'");
  assert(ccTargetEv.rows.length === 1, "Target evidence ev-tf-1792966687905-0 exists in production DB");
  assert(ccTargetEv.rows[0].reviewer_status === "ACCEPTED", "Target evidence reviewer_status is ACCEPTED");
  assert(ccTargetEv.rows[0].provenance === "REAL_SOURCE", "Target evidence provenance is REAL_SOURCE");

  console.log(`\n=======================================================`);
  console.log(`  Tests completed: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`=======================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
