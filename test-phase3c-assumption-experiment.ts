/**
 * IdeaProbe Phase 3C Test Suite: Falsifiable Assumption and Planned Experiment
 *
 * Verifies:
 * 1. Isolated schema validation for assumption and experiment tables.
 * 2. Exact field mapping, priority formula calculation (12 for Critical x High),
 *    and USER_INPUT provenance for founder-defined assumption.
 * 3. Planned experiment parameter bounding, foreign key linkage to assumption,
 *    and unrun status (status = 'planned', result = null).
 * 4. Falsifiable decision engine criteria parsing:
 *    - targetValue: 15 (>= 15)
 *    - failureValue: 6 (< 6)
 *    - pivotRange: [6, 14]
 * 5. Production database pre-write baseline verification.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@libsql/client";
import { parseThresholdCriteria, evaluateExperimentDecision } from "./src/lib/experimentDecision";

const UNCERTAINTY_SCORE: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const IMPACT_SCORE: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function calcPriorityScore(uncertainty: string, impact: string): number {
  return (UNCERTAINTY_SCORE[uncertainty] || 1) * (IMPACT_SCORE[impact] || 1);
}

async function runTests() {
  console.log("===============================================================");
  console.log("  IdeaProbe Phase 3C: Assumption & Experiment Test Suite");
  console.log("===============================================================\n");

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

  // ── Suite 1: Isolated Database Schema & Field Mapping ───────────────────
  console.log("Suite 1: Isolated Database Schema & Field Mapping");
  const scratchDir = path.join(__dirname, "scratch");
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const tempDbPath = path.join(scratchDir, "test_phase3c_isolated.db");
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const testDb = createClient({ url: `file:${tempDbPath.replace(/\\/g, "/")}` });

  await testDb.execute(`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL
  )`);

  await testDb.execute(`CREATE TABLE assumptions (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    statement    TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'business_model',
    impact       TEXT NOT NULL DEFAULT 'Medium' CHECK(impact IN ('High','Medium','Low')),
    uncertainty  TEXT NOT NULL DEFAULT 'High' CHECK(uncertainty IN ('Critical','High','Medium','Low')),
    rationale    TEXT,
    status       TEXT NOT NULL DEFAULT 'unvalidated' CHECK(status IN ('unvalidated','testing','validated','invalidated')),
    evidence_ids TEXT,
    provenance   TEXT NOT NULL DEFAULT 'AI_INFERENCE',
    created_at   TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`);

  await testDb.execute(`CREATE TABLE experiments (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id),
    assumption_id  TEXT REFERENCES assumptions(id),
    hypothesis     TEXT NOT NULL,
    method         TEXT NOT NULL,
    cohort         TEXT,
    metric         TEXT NOT NULL,
    threshold      TEXT NOT NULL,
    duration       TEXT,
    cost_estimate  TEXT,
    decision_rules TEXT,
    status         TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','completed','abandoned')),
    result         TEXT,
    provenance     TEXT NOT NULL DEFAULT 'AI_INFERENCE',
    created_at     TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )`);

  await testDb.execute({
    sql: "INSERT INTO projects VALUES ('proj-f3554e11', 'IdeaProbe Provenance Retest - CampusCourier', 'LIVE', 'active')",
    args: [],
  });

  // Test Assumption Creation
  const asmStatement = "Hostel students are willing to pay peers ₹30–₹50 per delivery rather than walking to the campus main gate.";
  const asmCategory = "desirability";
  const asmImpact = "High";
  const asmUncertainty = "Critical";
  const asmStatus = "unvalidated";
  const asmProvenance = "USER_INPUT";
  const asmRationale = "Founder desirability hypothesis targeting the open question raised in insight-gen-1792998567590 regarding intra-campus student delivery demand.";
  const asmPriority = calcPriorityScore(asmUncertainty, asmImpact);

  assert(asmPriority === 12, `Priority score calculation: Critical (4) x High (3) = 12 (got ${asmPriority})`);

  const asmId = "asm-test-campus-001";
  await testDb.execute({
    sql: `INSERT INTO assumptions (id, project_id, statement, category, impact, uncertainty, rationale, status, evidence_ids, provenance)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [asmId, "proj-f3554e11", asmStatement, asmCategory, asmImpact, asmUncertainty, asmRationale, asmStatus, JSON.stringify([]), asmProvenance],
  });

  const asmCheck = await testDb.execute({
    sql: "SELECT * FROM assumptions WHERE id = ?",
    args: [asmId],
  });
  assert(asmCheck.rows.length === 1, "Assumption inserted into isolated DB");
  const asmRow = asmCheck.rows[0] as any;
  assert(asmRow.statement === asmStatement, "Assumption statement preserved exactly");
  assert(asmRow.category === "desirability", "Assumption category is desirability");
  assert(asmRow.impact === "High", "Assumption impact is High");
  assert(asmRow.uncertainty === "Critical", "Assumption uncertainty is Critical");
  assert(asmRow.status === "unvalidated", "Assumption status is unvalidated");
  assert(asmRow.provenance === "USER_INPUT", "Assumption provenance is USER_INPUT");
  assert(asmRow.project_id === "proj-f3554e11", "Assumption belongs to proj-f3554e11");

  // Test Experiment Creation
  const expHypothesis = "Among hostel residents in Blocks C and D, offering peer-to-peer deliveries at ₹30–₹50 will produce at least 15 completed delivery orders within seven days.";
  const expMethod = "Concierge WhatsApp MVP: Manual peer-to-peer delivery coordination via WhatsApp broadcast group";
  const expCohort = "Hostel residents in Blocks C and D (Target sample: 50 students)";
  const expDuration = "7 days";
  const expCost = "₹0 (founder time)";
  const expMetric = "Number of completed peer-delivery orders placed during the test";
  const expThreshold = "At least 15 completed orders, with positive ratings";
  const expDecisionRules = JSON.stringify({
    continue: "Continue: 15 or more completed orders (>= 15) and positive ratings.",
    pivot: "Pivot: 6-14 completed orders (6 to 14); investigate pricing friction and unmet needs.",
    stop: "Stop: Fewer than 6 (< 6) completed orders after seven days, provided the test was properly run."
  });
  const expStatus = "planned";
  const expProvenance = "USER_INPUT";

  const expId = "exp-test-campus-001";
  await testDb.execute({
    sql: `INSERT INTO experiments (id, project_id, assumption_id, hypothesis, method, cohort, metric, threshold, duration, cost_estimate, decision_rules, status, result, provenance)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)`,
    args: [expId, "proj-f3554e11", asmId, expHypothesis, expMethod, expCohort, expMetric, expThreshold, expDuration, expCost, expDecisionRules, expStatus, expProvenance],
  });

  const expCheck = await testDb.execute({
    sql: `SELECT e.*, a.statement as assumption_statement FROM experiments e
          LEFT JOIN assumptions a ON e.assumption_id = a.id
          WHERE e.id = ?`,
    args: [expId],
  });
  assert(expCheck.rows.length === 1, "Experiment inserted into isolated DB");
  const expRow = expCheck.rows[0] as any;
  assert(expRow.assumption_id === asmId, "Experiment links to created assumption ID");
  assert(expRow.assumption_statement === asmStatement, "Joined assumption statement matches");
  assert(expRow.status === "planned", "Experiment status is planned");
  assert(expRow.result === null, "Experiment result is null (unrun)");
  assert(expRow.provenance === "USER_INPUT", "Experiment provenance is USER_INPUT");
  assert(expRow.duration === "7 days", "Experiment duration is 7 days");
  assert(expRow.cohort.includes("Blocks C and D"), "Cohort includes Blocks C and D");
  assert(expRow.cohort.includes("50 students"), "Cohort includes target sample (50 students)");

  // ── Suite 2: Falsifiable Decision Engine Criteria Parsing ──────────────
  console.log("\nSuite 2: Falsifiable Decision Engine Criteria Parsing");
  const parsedCriteria = parseThresholdCriteria(expThreshold, expMetric, expDecisionRules);
  assert(parsedCriteria !== null, "parseThresholdCriteria returns non-null criteria");
  if (parsedCriteria) {
    assert(parsedCriteria.targetValue === 15, `targetValue is 15 (got ${parsedCriteria.targetValue})`);
    assert(parsedCriteria.operator === ">=", `operator is >= (got ${parsedCriteria.operator})`);
    assert(parsedCriteria.direction === "higher_is_better", `direction is higher_is_better (got ${parsedCriteria.direction})`);
    assert(parsedCriteria.failureValue === 6, `failureValue is 6 (got ${parsedCriteria.failureValue})`);
    assert(parsedCriteria.failureOperator === "<", `failureOperator is < (got ${parsedCriteria.failureOperator})`);
    assert(Array.isArray(parsedCriteria.pivotRange) && parsedCriteria.pivotRange[0] === 6 && parsedCriteria.pivotRange[1] === 14,
      `pivotRange is [6, 14] (got ${JSON.stringify(parsedCriteria.pivotRange)})`);
  }

  // Decision evaluation for unrun experiment
  const unrunEvaluation = evaluateExperimentDecision(expRow);
  assert(unrunEvaluation.outcome === "inconclusive", "Unrun experiment outcome is inconclusive");
  assert(unrunEvaluation.label === "Inconclusive", "Unrun experiment label is Inconclusive");
  assert(unrunEvaluation.suggestedAssumptionStatus === "keep", "Unrun experiment suggests keeping assumption status");

  // ── Suite 3: Production Database Post-Write Verification ─────────────
  console.log("\nSuite 3: Production Database Post-Write Verification");
  const prodDbPath = path.join(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const prodDb = createClient({ url: `file:${prodDbPath.replace(/\\/g, "/")}` });

  const prodProjects = await prodDb.execute("SELECT id, title, mode FROM projects WHERE id = 'proj-f3554e11'");
  assert(prodProjects.rows.length === 1, "Production project proj-f3554e11 exists");
  assert(prodProjects.rows[0].mode === "LIVE", "Production project proj-f3554e11 has mode LIVE");

  const prodAsms = await prodDb.execute("SELECT * FROM assumptions WHERE project_id = 'proj-f3554e11'");
  assert(prodAsms.rows.length === 1, `CampusCourier has exactly 1 assumption in production DB (got ${prodAsms.rows.length})`);
  const actualAsm = prodAsms.rows[0] as any;
  assert(actualAsm.id === "asm-mvoxna1k-frgs", `Assumption ID is asm-mvoxna1k-frgs`);
  assert(actualAsm.provenance === "USER_INPUT", `Assumption provenance is USER_INPUT`);
  assert(actualAsm.status === "unvalidated", `Assumption status is unvalidated`);
  assert(actualAsm.category === "desirability", `Assumption category is desirability`);
  assert(actualAsm.impact === "High", `Assumption impact is High`);
  assert(actualAsm.uncertainty === "Critical", `Assumption uncertainty is Critical`);
  assert(calcPriorityScore(actualAsm.uncertainty, actualAsm.impact) === 12, `Assumption priority score is 12`);

  const prodExps = await prodDb.execute("SELECT * FROM experiments WHERE project_id = 'proj-f3554e11'");
  assert(prodExps.rows.length === 1, `CampusCourier has exactly 1 experiment in production DB (got ${prodExps.rows.length})`);
  const actualExp = prodExps.rows[0] as any;
  assert(actualExp.id === "exp-mvoxna2d-b1yt", `Experiment ID is exp-mvoxna2d-b1yt`);
  assert(actualExp.assumption_id === "asm-mvoxna1k-frgs", `Experiment links to asm-mvoxna1k-frgs`);
  assert(actualExp.provenance === "USER_INPUT", `Experiment provenance is USER_INPUT`);
  assert(actualExp.status === "planned", `Experiment status is planned`);
  assert(actualExp.result === null, `Experiment result is null (no fabricated result)`);
  assert(actualExp.duration === "7 days", `Experiment duration is 7 days`);

  const totalAsms = await prodDb.execute("SELECT COUNT(*) as c FROM assumptions");
  assert(Number(totalAsms.rows[0].c) === 5, `Total assumptions across all projects is 5 (got ${totalAsms.rows[0].c})`);

  const totalExps = await prodDb.execute("SELECT COUNT(*) as c FROM experiments");
  assert(Number(totalExps.rows[0].c) === 3, `Total experiments across all projects is 3 (got ${totalExps.rows[0].c})`);

  const prodSnapshots = await prodDb.execute("SELECT COUNT(*) as c FROM report_snapshots");
  assert(Number(prodSnapshots.rows[0].c) === 230, `Production report_snapshots strictly invariant at 230 (got ${prodSnapshots.rows[0].c})`);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
