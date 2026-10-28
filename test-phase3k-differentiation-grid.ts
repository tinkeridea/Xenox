/**
 * IdeaProbe — Phase 3K: Competitor Differentiation Grid Test Suite
 *
 * Verifies:
 * 1. Production database baseline pre-execution invariance check.
 * 2. Pure differentiation validation logic:
 *    - isDifferentiated() correctly distinguishes articulated advantages from gaps.
 *    - getDifferentiationMetrics() calculates total, articulated, gaps, and coverage %.
 *    - buildDifferentiationMarkdownTable() renders a markdown table with escaping and status tags.
 * 3. Isolated test database environment setup (zero mutation of production DB).
 * 4. Project-scoped competitor creation and differentiation metric computation.
 * 5. Inline differentiation updates (resolving differentiation gaps) & stage reconciliation.
 * 6. Strict project isolation (Project A competitors never leak into Project B).
 * 7. DEMO project fixtures integrity (proj-study-planner has 100% differentiation coverage across canonical records).
 * 8. Production database baseline post-execution invariance check.
 */

import path from "path";
import fs from "fs";
import {
  isDifferentiated,
  getDifferentiationMetrics,
  buildDifferentiationMarkdownTable,
  formatCompetitorCategory,
  normalizeCompetitorName,
  getSemanticCompetitorKey,
  deduplicateCompetitors,
} from "./src/lib/competitorValidation";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { getCompetitorsFromDb } from "./src/app/api/projects/[id]/competitors/route";
import { reconcileProjectStages } from "./src/lib/stageReconciliation";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const PROD_DB_PATH = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
const ISOLATED_DB_PATH = path.resolve(__dirname, ".ideaprobe-data", "test-phase3k-isolated.db");

async function runTests() {
  console.log("\n=======================================================");
  console.log("IdeaProbe — Phase 3K: Competitor Differentiation Grid");
  console.log("=======================================================\n");

  // ── Suite 1: Production Database Pre-Execution Baseline Check ──────
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  let prodInitialMtime = 0;
  let prodInitialSize = 0;

  if (fs.existsSync(PROD_DB_PATH)) {
    const stat = fs.statSync(PROD_DB_PATH);
    prodInitialMtime = stat.mtimeMs;
    prodInitialSize = stat.size;
    assert(prodInitialSize > 0, `Production database exists with size ${prodInitialSize} bytes`);
  } else {
    assert(false, "Production database file not found at expected location");
  }

  // ── Suite 2: Pure Differentiation Validation Logic ──────────────────
  console.log("\nSuite 2: Pure Differentiation Validation Logic");

  // 2a: isDifferentiated checks
  assert(
    isDifferentiated({ differentiator: "Auto-reschedules sessions; competitors require manual updates" }) === true,
    "Articulated differentiation statement returns true"
  );
  assert(
    isDifferentiated({ differentiator: "  Tactile and trusted. Zero setup required.  " }) === true,
    "Trimmed articulated statement returns true"
  );
  assert(isDifferentiated({ differentiator: "" }) === false, "Empty string returns false");
  assert(isDifferentiated({ differentiator: "   " }) === false, "Whitespace-only string returns false");
  assert(isDifferentiated({ differentiator: null }) === false, "null returns false");
  assert(isDifferentiated({ differentiator: undefined }) === false, "undefined returns false");
  assert(isDifferentiated({ differentiator: "Not specified." }) === false, "'Not specified.' returns false");
  assert(isDifferentiated({ differentiator: "not specified" }) === false, "'not specified' (case-insensitive) returns false");
  assert(isDifferentiated({ differentiator: "None" }) === false, "'None' returns false");
  assert(isDifferentiated({ differentiator: "N/A" }) === false, "'N/A' returns false");
  assert(isDifferentiated({ differentiator: "TBD" }) === false, "'TBD' returns false");

  // 2b: getDifferentiationMetrics calculations
  const emptyMetrics = getDifferentiationMetrics([]);
  assert(emptyMetrics.total === 0, "Empty list total is 0");
  assert(emptyMetrics.articulated === 0, "Empty list articulated is 0");
  assert(emptyMetrics.gaps === 0, "Empty list gaps is 0");
  assert(emptyMetrics.coveragePercent === 0, "Empty list coverage is 0%");

  const mixedList = [
    { differentiator: "Faster dispatch within 10 minutes" },
    { differentiator: "" },
    { differentiator: "Not specified." },
    { differentiator: "Guaranteed peer delivery with rating" },
  ];
  const mixedMetrics = getDifferentiationMetrics(mixedList);
  assert(mixedMetrics.total === 4, "Mixed list total is 4");
  assert(mixedMetrics.articulated === 2, "Mixed list articulated is 2");
  assert(mixedMetrics.gaps === 2, "Mixed list gaps is 2");
  assert(mixedMetrics.coveragePercent === 50, "Mixed list coverage is 50%");

  const fullList = [
    { differentiator: "Advantage A" },
    { differentiator: "Advantage B" },
    { differentiator: "Advantage C" },
  ];
  const fullMetrics = getDifferentiationMetrics(fullList);
  assert(fullMetrics.coveragePercent === 100, "100% coverage when all items have differentiators");
  assert(fullMetrics.gaps === 0, "0 gaps when all items have differentiators");

  // 2c: buildDifferentiationMarkdownTable
  const emptyTable = buildDifferentiationMarkdownTable([]);
  assert(emptyTable.includes("No competitors"), "Empty list returns no competitors notice");

  const sampleCompetitors = [
    {
      name: "Campus Courier Co",
      category: "direct",
      description: "Third-party courier delivery app",
      differentiator: "Peer-to-peer student network with lower fees",
      provenance: "USER_INPUT",
    },
    {
      name: "Walking to Main Gate",
      category: "status_quo",
      description: "Students walk 15 mins to the gate",
      differentiator: "",
      provenance: "USER_INPUT",
    },
  ];
  const tableMd = buildDifferentiationMarkdownTable(sampleCompetitors);
  assert(tableMd.includes("| **Campus Courier Co** | Direct Competitor |"), "Table includes formatted competitor row");
  assert(tableMd.includes("✓ Articulated"), "Differentiated competitor shows '✓ Articulated'");
  assert(tableMd.includes("⚠️ Gap (Unspecified)"), "Undifferentiated competitor shows '⚠️ Gap (Unspecified)'");
  assert(tableMd.includes("`USER_INPUT`"), "Table includes provenance tag");

  // Pipe escaping check
  const pipeCompetitor = [
    {
      name: "App | Tool",
      category: "substitute",
      description: "Does A | B",
      differentiator: "Diff | Advantage",
      provenance: "AI_INFERENCE",
    },
  ];
  const pipeTable = buildDifferentiationMarkdownTable(pipeCompetitor);
  assert(!pipeTable.includes("App | Tool"), "Pipe character in name is escaped");
  assert(pipeTable.includes("App \\| Tool"), "Pipes in name are properly escaped as \\|");

  // ── Suite 3: Isolated Database Environment Setup ───────────────────
  console.log("\nSuite 3: Isolated Database Environment Setup");
  if (fs.existsSync(ISOLATED_DB_PATH)) {
    fs.unlinkSync(ISOLATED_DB_PATH);
  }

  process.env.IDEAPROBE_DB_PATH = ISOLATED_DB_PATH;
  resetDbClient();
  await initDb();
  const db = getDb();

  const countRes = await db.execute("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'");
  assert(Number(countRes.rows[0].c) >= 16, "Isolated database initialized with complete 16-table schema");

  // ── Suite 4: Project-Scoped Competitor Creation & Metric Computation
  console.log("\nSuite 4: Project-Scoped Competitor Creation & Metric Computation");
  const projectId = "proj-grid-alpha";

  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status) VALUES (?, ?, 'LIVE', 'active')",
    args: [projectId, "Campus Parcel Logistics"],
  });

  await db.execute({
    sql: "INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution) VALUES (?, ?, 1, 'Problem', 'Hostel Students', 'Solution')",
    args: [`brief-${projectId}`, projectId],
  });

  // Insert Competitor 1 with defined differentiator
  await db.execute({
    sql: `INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "comp-alpha-01",
      projectId,
      "Campus Courier Co",
      "direct",
      "Commercial delivery service charging ₹100 per delivery",
      "Our student peer network costs ₹30–₹50 with 15-minute turnaround",
      "USER_INPUT",
    ],
  });

  // Insert Competitor 2 with missing differentiator (Differentiation Gap)
  await db.execute({
    sql: `INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "comp-alpha-02",
      projectId,
      "Manual Main Gate Walk",
      "status_quo",
      "Students walk 15 minutes each way to gate",
      "", // Gap
      "USER_INPUT",
    ],
  });

  // Query via getCompetitorsFromDb
  const alphaRes = await getCompetitorsFromDb(projectId);
  const alphaJson = await alphaRes.json();
  const alphaData = alphaJson.data;
  assert(alphaData.competitors.length === 2, "2 competitors retrieved for proj-grid-alpha");

  const alphaMetrics = getDifferentiationMetrics(alphaData.competitors);
  assert(alphaMetrics.total === 2, "Metrics total is 2");
  assert(alphaMetrics.articulated === 1, "Metrics articulated is 1");
  assert(alphaMetrics.gaps === 1, "Metrics gaps is 1");
  assert(alphaMetrics.coveragePercent === 50, "Metrics coverage is 50%");

  // ── Suite 5: Inline Differentiation Updates & Stage Reconciliation ──
  console.log("\nSuite 5: Inline Differentiation Updates & Stage Reconciliation");

  // Update comp-alpha-02 differentiator (resolving the gap)
  await db.execute({
    sql: "UPDATE competitors SET differentiator = ? WHERE id = ?",
    args: ["Eliminates 30-minute roundtrip walking friction in heat/rain for nominal ₹30 fee", "comp-alpha-02"],
  });

  const updatedRes = await getCompetitorsFromDb(projectId);
  const updatedJson = await updatedRes.json();
  const updatedData = updatedJson.data;
  const updatedMetrics = getDifferentiationMetrics(updatedData.competitors);

  assert(updatedMetrics.articulated === 2, "Articulated count increases to 2 after inline update");
  assert(updatedMetrics.gaps === 0, "Gaps drop to 0 after articulating differentiator");
  assert(updatedMetrics.coveragePercent === 100, "Coverage reaches 100%");

  // Reconcile stages and verify status
  const reconcileRes = await reconcileProjectStages(projectId);
  assert(reconcileRes.stages.find((s) => s.stageKey === "competitors")?.status === "completed", "Competitors stage remains completed");

  // ── Suite 6: Strict Project Isolation Enforcement ─────────────────
  console.log("\nSuite 6: Strict Project Isolation Enforcement");
  const projectBeta = "proj-grid-beta";

  await db.execute({
    sql: "INSERT INTO projects (id, title, mode, status) VALUES (?, ?, 'LIVE', 'active')",
    args: [projectBeta, "Unrelated Beta Project"],
  });

  const betaRes = await getCompetitorsFromDb(projectBeta);
  const betaJson = await betaRes.json();
  const betaData = betaJson.data;
  assert(betaData.competitors.length === 0, "Project Beta has 0 competitors (no leakage from Alpha)");

  const betaMetrics = getDifferentiationMetrics(betaData.competitors);
  assert(betaMetrics.total === 0, "Project Beta differentiation total is 0");
  assert(betaMetrics.coveragePercent === 0, "Project Beta differentiation coverage is 0%");

  // ── Suite 7: DEMO Fixtures Differentiation Integrity ───────────────
  console.log("\nSuite 7: DEMO Fixtures Differentiation Integrity");
  const demoRes = await getCompetitorsFromDb("proj-study-planner");
  const demoJson = await demoRes.json();
  const demoData = demoJson.data;

  assert(demoData.competitors.length >= 5, `DEMO project has ${demoData.competitors.length} competitors mapped`);

  // Verify all canonical records have rich differentiators
  const comp01 = demoData.competitors.find((c: any) => c.id === "comp-01");
  const comp02 = demoData.competitors.find((c: any) => c.id === "comp-02");
  const comp03 = demoData.competitors.find((c: any) => c.id === "comp-03");
  const comp04 = demoData.competitors.find((c: any) => c.id === "comp-04");
  const comp05 = demoData.competitors.find((c: any) => c.id === "comp-05");

  assert(Boolean(comp01 && isDifferentiated(comp01)), "comp-01 (Notion) has articulated differentiator");
  assert(Boolean(comp02 && isDifferentiated(comp02)), "comp-02 (Forest) has articulated differentiator");
  assert(Boolean(comp03 && isDifferentiated(comp03)), "comp-03 (Quizlet) has articulated differentiator");
  assert(Boolean(comp04 && isDifferentiated(comp04)), "comp-04 (Google Calendar) has articulated differentiator");
  assert(Boolean(comp05 && isDifferentiated(comp05)), "comp-05 (Manual Notebook) has articulated differentiator");

  const demoMetrics = getDifferentiationMetrics(demoData.competitors);
  assert(demoMetrics.gaps === 0, "DEMO project has 0 differentiation gaps");
  assert(demoMetrics.coveragePercent === 100, "DEMO project has 100% differentiation coverage");

  // Clean up isolated DB file
  resetDbClient();
  delete process.env.IDEAPROBE_DB_PATH;
  try {
    if (fs.existsSync(ISOLATED_DB_PATH)) {
      fs.unlinkSync(ISOLATED_DB_PATH);
    }
  } catch {
    // Windows file handle lock during process lifetime is safe to ignore
  }

  // ── Suite 8: Production Database Invariance Check ─────────────────
  console.log("\nSuite 8: Production Database Invariance Check");
  if (fs.existsSync(PROD_DB_PATH)) {
    const postStat = fs.statSync(PROD_DB_PATH);
    assert(postStat.size === prodInitialSize, `Production DB size strictly invariant: ${postStat.size} === ${prodInitialSize}`);
    assert(postStat.mtimeMs === prodInitialMtime, `Production DB mtime strictly invariant: ${postStat.mtimeMs} === ${prodInitialMtime}`);
  } else {
    assert(false, "Production database file missing after test run");
  }

  console.log("\n=======================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  process.exit(1);
});
