/**
 * IdeaProbe — Phase 3L: Competitor Differentiation Integration into Unified Founder Report Test Suite
 *
 * Verifies:
 * 1. Production database baseline pre-execution invariance check.
 * 2. Static code structure audit across report/route.ts, reportComparison.ts, and report/page.tsx.
 * 3. Isolated test database environment setup (zero mutation of production DB).
 * 4. Pure differentiation validator and markdown table generator integration.
 * 5. Report Generation with Competitor Differentiation (POST /report):
 *    - Differentiation section appears when competitors exist.
 *    - Articulated differentiators display correctly with '✓ ARTICULATED' badges.
 *    - Missing, whitespace-only, and generic placeholder claims are flagged as '⚠️ GAP — Unspecified'.
 *    - Aggregate metrics: total alternatives, articulated differentiators, differentiation gaps, coverage %.
 *    - Provenance badges and source attribution are preserved.
 *    - Non-negotiable strategic hypothesis caveat is included (distinguishing claimed advantage from proven proof).
 * 6. Useful empty states when no competitors exist:
 *    - Report remains functional and renders clear guidance when project has 0 competitors.
 * 7. Strict project isolation & LIVE/DEMO separation:
 *    - Competitors are strictly scoped to the active project.
 *    - LIVE projects never receive demo competitors or synthetic fallbacks.
 * 8. Historical snapshot immutability & snapshot history/comparison compatibility:
 *    - Historical snapshots (without sec-differentiation) load without error.
 *    - Comparing historical vs new snapshot accurately marks sec-differentiation as 'added'.
 *    - Comparing two snapshots with sec-differentiation tracks metric deltas (articulated, gaps, coverage %).
 *    - Snapshot retrieval never mutates or overwrites stored snapshots.
 * 9. Production database baseline post-execution invariance check.
 */

import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import {
  isDifferentiated,
  getDifferentiationMetrics,
  buildDifferentiationMarkdownTable,
  formatCompetitorCategory,
} from "./src/lib/competitorValidation";
import {
  compareSnapshots,
  type ReportSnapshot,
} from "./src/lib/reportComparison";
import {
  POST as generateReport,
  getReportFromDb,
  getReportHistoryFromDb,
} from "./src/app/api/projects/[id]/report/route";

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
const ISOLATED_DB_PATH = path.resolve(__dirname, ".ideaprobe-data", "test-phase3l-isolated.db");

async function runTests() {
  console.log("\n==========================================================================");
  console.log("IdeaProbe — Phase 3L: Competitor Differentiation in Unified Founder Report");
  console.log("==========================================================================\n");

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

  // ── Suite 2: Static Code Structure Audit ─────────────────────────────
  console.log("\nSuite 2: Static Code Structure & UI Contract Audit");
  const reportRouteSrc = fs.readFileSync(path.resolve(__dirname, "src/app/api/projects/[id]/report/route.ts"), "utf-8");
  const reportComparisonSrc = fs.readFileSync(path.resolve(__dirname, "src/lib/reportComparison.ts"), "utf-8");
  const reportPageSrc = fs.readFileSync(path.resolve(__dirname, "src/app/report/page.tsx"), "utf-8");

  assert(reportRouteSrc.includes('id: "sec-differentiation"'), "report/route.ts defines sec-differentiation section");
  assert(reportRouteSrc.includes('title: "Competitor Differentiation Analysis"'), "report/route.ts sets Competitor Differentiation Analysis title");
  assert(reportRouteSrc.includes("getDifferentiationMetrics"), "report/route.ts imports and computes getDifferentiationMetrics");
  assert(reportRouteSrc.includes("buildDifferentiationMarkdownTable"), "report/route.ts includes markdown matrix table in sec-differentiation content");
  assert(reportRouteSrc.includes("differentiated_competitors:"), "report/route.ts includes differentiated_competitors in report stats");
  assert(reportRouteSrc.includes("differentiation_coverage_pct:"), "report/route.ts includes differentiation_coverage_pct in report stats");
  assert(reportRouteSrc.includes("⚠️ STRATEGIC HYPOTHESIS NOTICE:"), "report/route.ts includes mandatory strategic hypothesis caveat");

  assert(reportComparisonSrc.includes('secId === "sec-differentiation"'), "reportComparison.ts extracts metrics from sec-differentiation");
  assert(reportComparisonSrc.includes("Articulated Differentiators"), "reportComparison.ts tracks Articulated Differentiators metric");
  assert(reportComparisonSrc.includes("Differentiation Gaps"), "reportComparison.ts tracks Differentiation Gaps metric");
  assert(reportComparisonSrc.includes("Differentiation Coverage %"), "reportComparison.ts tracks Differentiation Coverage % metric");

  assert(reportPageSrc.includes("DifferentiationReportSection"), "report/page.tsx defines DifferentiationReportSection component");
  assert(reportPageSrc.includes('id="report-differentiation-metrics"'), "report/page.tsx contains report-differentiation-metrics container");
  assert(reportPageSrc.includes('id="report-differentiation-gap-alert"'), "report/page.tsx contains report-differentiation-gap-alert element");
  assert(reportPageSrc.includes('id="report-differentiation-empty"'), "report/page.tsx contains report-differentiation-empty state");
  assert(reportPageSrc.includes('id="report-differentiation-grid-table"'), "report/page.tsx contains report-differentiation-grid-table element");

  // ── Suite 3: Isolated Database Environment Setup ─────────────────────
  console.log("\nSuite 3: Isolated Database Environment Setup");
  if (fs.existsSync(ISOLATED_DB_PATH)) {
    try { fs.unlinkSync(ISOLATED_DB_PATH); } catch {}
  }
  process.env.IDEAPROBE_DB_PATH = ISOLATED_DB_PATH;
  resetDbClient();

  await initDb();
  const db = getDb();

  // Create isolated test projects
  await db.execute({
    sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at)
          VALUES ('proj-test-alpha', 'Project Alpha with Differentiated Competitors', 'LIVE', 'active', datetime('now'), datetime('now')),
                 ('proj-test-beta', 'Project Beta with Zero Competitors', 'LIVE', 'active', datetime('now'), datetime('now'))`,
    args: [],
  });

  // Create IdeaBriefs
  await db.execute({
    sql: `INSERT INTO idea_briefs (id, project_id, problem, target_customer, solution, version, created_at)
          VALUES ('brief-alpha', 'proj-test-alpha', 'Exam prep is disorganized', 'College Students', 'AI Daily Study Planner', 1, datetime('now')),
                 ('brief-beta', 'proj-test-beta', 'Campus parcel delivery is slow', 'Hostel Students', 'Peer Concierge WhatsApp MVP', 1, datetime('now'))`,
    args: [],
  });

  // Create Initial Runs
  await db.execute({
    sql: `INSERT INTO runs (id, project_id, mode, status, created_at)
          VALUES ('run-alpha', 'proj-test-alpha', 'LIVE', 'queued', datetime('now')),
                 ('run-beta', 'proj-test-beta', 'LIVE', 'queued', datetime('now'))`,
    args: [],
  });

  // Seed 3 competitors for Project Alpha (1 articulated, 2 gaps)
  await db.execute({
    sql: `INSERT INTO competitors (id, project_id, name, category, description, differentiator, provenance, created_at)
          VALUES ('comp-a1', 'proj-test-alpha', 'Manual Notebook Timetable', 'status_quo', 'Physical paper planner and handwritten timetable.', 'Auto-reschedules sessions dynamically when user misses study blocks.', 'USER_INPUT', datetime('now')),
                 ('comp-a2', 'proj-test-alpha', 'Generic Todoist App', 'indirect', 'General purpose task manager with checkboxes.', 'Not specified.', 'USER_INPUT', datetime('now')),
                 ('comp-a3', 'proj-test-alpha', 'Quizlet Flashcards', 'substitute', 'Rote memorization flashcards and study sets.', '   ', 'USER_INPUT', datetime('now'))`,
    args: [],
  });

  assert(true, "Isolated database seeded with Project Alpha (3 competitors, 1 articulated, 2 gaps) and Project Beta (0 competitors)");

  // ── Suite 4: Pure Differentiation Validator & Calculation Checks ────
  console.log("\nSuite 4: Pure Differentiation Validator & Calculation Checks");
  assert(isDifferentiated({ differentiator: "Auto-reschedules sessions dynamically." }) === true, "Articulated differentiator returns true");
  assert(isDifferentiated({ differentiator: "Not specified." }) === false, "'Not specified.' returns false");
  assert(isDifferentiated({ differentiator: "none" }) === false, "'none' returns false");
  assert(isDifferentiated({ differentiator: "n/a" }) === false, "'n/a' returns false");
  assert(isDifferentiated({ differentiator: "tbd" }) === false, "'tbd' returns false");
  assert(isDifferentiated({ differentiator: "   " }) === false, "Whitespace returns false");
  assert(isDifferentiated({ differentiator: "" }) === false, "Empty string returns false");
  assert(isDifferentiated({ differentiator: null }) === false, "null returns false");

  const calcMetrics = getDifferentiationMetrics([
    { differentiator: "Auto-reschedules sessions" },
    { differentiator: "Not specified" },
    { differentiator: "" },
  ]);
  assert(calcMetrics.total === 3, "Total alternatives calculated as 3");
  assert(calcMetrics.articulated === 1, "Articulated differentiators calculated as 1");
  assert(calcMetrics.gaps === 2, "Differentiation gaps calculated as 2");
  assert(calcMetrics.coveragePercent === 33, "Coverage percentage calculated as 33% (1/3)");

  const emptyMetrics = getDifferentiationMetrics([]);
  assert(emptyMetrics.total === 0 && emptyMetrics.articulated === 0 && emptyMetrics.gaps === 0 && emptyMetrics.coveragePercent === 0, "Empty list yields 0 for all metrics");

  // ── Suite 5: Report Generation for Project with Competitors (Mixed Articulated & Gaps) ──
  console.log("\nSuite 5: Report Generation for Project with Competitors (POST /report)");
  const alphaRouteParams = { params: Promise.resolve({ id: "proj-test-alpha" }) };
  const reqAlphaReport = new NextRequest("http://localhost:3000/api/projects/proj-test-alpha/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const resAlpha = await generateReport(reqAlphaReport, alphaRouteParams);
  const jsonAlpha = await resAlpha.json();

  assert(resAlpha.status === 201, `POST /report returns HTTP 201 Created (got ${resAlpha.status})`);
  const alphaReport = jsonAlpha.data?.report;
  assert(Boolean(alphaReport), "Report object returned in data envelope");
  assert(alphaReport?.version === 1, "First report version is 1");

  const alphaSections: any[] = alphaReport?.content || [];
  assert(alphaSections.length === 10, `Report contains exactly 10 sections (got: ${alphaSections.length})`);

  const diffSec = alphaSections.find((s) => s.id === "sec-differentiation");
  assert(Boolean(diffSec), "Report content contains 'sec-differentiation' section");
  assert(diffSec?.title === "Competitor Differentiation Analysis", `Section title is 'Competitor Differentiation Analysis' (got: '${diffSec?.title}')`);
  assert(diffSec?.provenance === "USER_INPUT", `Section provenance is USER_INPUT (got: '${diffSec?.provenance}')`);

  // Verify aggregate metrics in content
  assert(diffSec?.content.includes("Differentiation Overview & Coverage:"), "Section content contains Overview & Coverage header");
  assert(diffSec?.content.includes("• Total Alternatives Mapped: 3"), "Section content specifies Total Alternatives Mapped: 3");
  assert(diffSec?.content.includes("• Articulated Differentiators: 1"), "Section content specifies Articulated Differentiators: 1");
  assert(diffSec?.content.includes("• Differentiation Gaps: 2"), "Section content specifies Differentiation Gaps: 2");
  assert(diffSec?.content.includes("• Differentiation Coverage: 33%"), "Section content specifies Differentiation Coverage: 33%");

  // Verify articulated vs gap flagging in items
  assert(diffSec?.content.includes("Manual Notebook Timetable"), "Section content lists Manual Notebook Timetable");
  assert(diffSec?.content.includes("✓ ARTICULATED"), "Articulated advantage tagged with ✓ ARTICULATED");
  assert(diffSec?.content.includes("Generic Todoist App"), "Section content lists Generic Todoist App");
  assert(diffSec?.content.includes("⚠️ GAP — Unspecified"), "Unspecified advantage flagged with ⚠️ GAP — Unspecified");
  assert(diffSec?.content.includes("Quizlet Flashcards"), "Section content lists Quizlet Flashcards");

  // Verify markdown table integration
  assert(diffSec?.content.includes("Comparative Differentiation Grid:"), "Section content includes Comparative Differentiation Grid table header");
  assert(diffSec?.content.includes("| Alternative | Category | Current Solution / Offer | Our Differentiation Advantage | Status | Provenance |"), "Section content includes markdown table column headers");
  assert(diffSec?.content.includes("| **Manual Notebook Timetable** | Status Quo |"), "Markdown table formats alternative row with human-readable Status Quo");

  // Verify strategic hypothesis caveat
  assert(
    Boolean(diffSec?.caveat && diffSec.caveat.includes("STRATEGIC HYPOTHESIS NOTICE")),
    "Section caveat includes mandatory STRATEGIC HYPOTHESIS NOTICE"
  );
  assert(
    Boolean(diffSec?.caveat && diffSec.caveat.includes("NOT validated customer preference")),
    "Section caveat explicitly distinguishes articulated claims from proven validation"
  );

  // Verify structured metrics and items on section object
  assert(diffSec?.metrics?.total === 3, "sec.metrics.total is 3");
  assert(diffSec?.metrics?.articulated === 1, "sec.metrics.articulated is 1");
  assert(diffSec?.metrics?.gaps === 2, "sec.metrics.gaps is 2");
  assert(diffSec?.metrics?.coveragePercent === 33, "sec.metrics.coveragePercent is 33%");
  assert(Array.isArray(diffSec?.items) && diffSec.items.length === 3, "sec.items contains 3 competitor items");

  // Verify stats on report
  assert(alphaReport?.stats?.differentiated_competitors === 1, "report.stats.differentiated_competitors is 1");
  assert(alphaReport?.stats?.differentiation_coverage_pct === 33, "report.stats.differentiation_coverage_pct is 33%");

  // ── Suite 6: Empty Project & Zero Competitor Handling ───────────────
  console.log("\nSuite 6: Empty Project & Zero Competitor Handling");
  const betaRouteParams = { params: Promise.resolve({ id: "proj-test-beta" }) };
  const reqBetaReport = new NextRequest("http://localhost:3000/api/projects/proj-test-beta/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const resBeta = await generateReport(reqBetaReport, betaRouteParams);
  const jsonBeta = await resBeta.json();

  assert(resBeta.status === 201, `POST /report for Beta returns HTTP 201 Created (got ${resBeta.status})`);
  const betaReport = jsonBeta.data?.report;
  const betaSections: any[] = betaReport?.content || [];
  assert(betaSections.length === 10, "Beta report contains exactly 10 sections");

  const betaDiffSec = betaSections.find((s) => s.id === "sec-differentiation");
  assert(Boolean(betaDiffSec), "Beta report contains sec-differentiation section");
  assert(
    betaDiffSec?.content.includes("No competitors or alternatives mapped for this project"),
    "Beta sec-differentiation renders useful empty state message"
  );
  assert(betaDiffSec?.metrics?.total === 0, "Beta sec.metrics.total is 0");
  assert(betaDiffSec?.metrics?.articulated === 0, "Beta sec.metrics.articulated is 0");
  assert(betaDiffSec?.metrics?.gaps === 0, "Beta sec.metrics.gaps is 0");
  assert(betaDiffSec?.metrics?.coveragePercent === 0, "Beta sec.metrics.coveragePercent is 0%");
  assert(betaDiffSec?.caveat === null, "Beta sec.caveat is null when zero competitors exist");
  assert(betaReport?.stats?.differentiated_competitors === 0, "Beta stats.differentiated_competitors is 0");
  assert(betaReport?.stats?.differentiation_coverage_pct === 0, "Beta stats.differentiation_coverage_pct is 0%");

  // ── Suite 7: Strict Project Isolation & Zero Demo Leakage ───────────
  console.log("\nSuite 7: Strict Project Isolation & Zero Demo Leakage to LIVE Projects");
  assert(!betaDiffSec?.content.includes("Manual Notebook"), "Beta report contains zero Alpha competitors");
  assert(!betaDiffSec?.content.includes("Quizlet"), "Beta report contains zero Quizlet alternatives");
  assert(!betaDiffSec?.content.includes("Forest"), "Beta report contains zero DEMO competitors (no leak of Forest)");
  assert(!betaDiffSec?.content.includes("Notion"), "Beta report contains zero DEMO competitors (no leak of Notion)");

  // ── Suite 8: Historical Snapshot Immutability & Comparison Compatibility ──
  console.log("\nSuite 8: Historical Snapshot Immutability & Comparison Compatibility");

  // Create legacy Snapshot v0 for Alpha (without sec-differentiation)
  const legacySections = [
    { id: "sec-verdict", title: "Verdict", provenance: "AI_INFERENCE", content: "VALIDATION STATUS: 🟡 IN PROGRESS", caveat: null },
    { id: "sec-competitors", title: "Competitive Landscape", provenance: "USER_INPUT", content: "2 alternative(s) / competitor(s) mapped.", caveat: null },
  ];
  await db.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, content, provenance_manifest, contains_simulated, contains_sample, version, generated_at)
          VALUES ('snap-alpha-v0', 'proj-test-alpha', ?, '{"USER_INPUT": 2, "AI_INFERENCE": 1}', 0, 0, 99, datetime('now'))`,
    args: [JSON.stringify(legacySections)],
  });

  // Verify loading older snapshot via getReportFromDb
  const legacySnapRes = await getReportFromDb("proj-test-alpha", 99);
  const legacySnapJson = await legacySnapRes.json();
  assert(legacySnapRes.status === 200, "Historical snapshot without sec-differentiation loads with HTTP 200");
  assert(legacySnapJson.data?.report?.version === 99, "Historical snapshot version is 99");
  assert(legacySnapJson.data?.report?.content?.length === 2, "Historical snapshot content length is preserved at 2");
  assert(!legacySnapJson.data?.report?.content?.some((s: any) => s.id === "sec-differentiation"), "Historical snapshot does not have sec-differentiation synthesized into it");

  // Verify compareSnapshots between legacy snapshot and new snapshot with sec-differentiation
  const diffComparison = compareSnapshots(
    legacySnapJson.data?.report as unknown as ReportSnapshot,
    alphaReport as unknown as ReportSnapshot
  );

  const comparedSec = diffComparison.sections.find((s) => s.sectionId === "sec-differentiation");
  assert(Boolean(comparedSec), "Comparison includes sec-differentiation");
  assert(comparedSec?.status === "added", `sec-differentiation status is 'added' when compared against legacy snapshot (got: '${comparedSec?.status}')`);

  // Verify metric extraction from sec-differentiation
  const artDelta = diffComparison.metrics.find((m) => m.metric === "Articulated Differentiators");
  assert(Boolean(artDelta), "Metric comparison tracks 'Articulated Differentiators'");
  assert(artDelta?.compareValue === 1, `Articulated Differentiators compare value is 1 (got: ${artDelta?.compareValue})`);

  const gapDelta = diffComparison.metrics.find((m) => m.metric === "Differentiation Gaps");
  assert(Boolean(gapDelta), "Metric comparison tracks 'Differentiation Gaps'");
  assert(gapDelta?.compareValue === 2, `Differentiation Gaps compare value is 2 (got: ${gapDelta?.compareValue})`);

  const covDelta = diffComparison.metrics.find((m) => m.metric === "Differentiation Coverage %");
  assert(Boolean(covDelta), "Metric comparison tracks 'Differentiation Coverage %'");
  assert(covDelta?.compareValue === 33, `Differentiation Coverage % compare value is 33% (got: ${covDelta?.compareValue})`);

  // Verify reading history
  const historyRes = await getReportHistoryFromDb("proj-test-alpha");
  const historyJson = await historyRes.json();
  assert(historyRes.status === 200, "getReportHistoryFromDb returns HTTP 200");
  assert(historyJson.data?.snapshots?.length === 2, `History returns exactly 2 snapshots (got: ${historyJson.data?.snapshots?.length})`);

  // ── Suite 9: Production Database Post-Execution Invariance Check ─────
  console.log("\nSuite 9: Production Database Post-Execution Invariance Check");
  if (fs.existsSync(PROD_DB_PATH)) {
    const stat = fs.statSync(PROD_DB_PATH);
    assert(stat.size === prodInitialSize, `Production DB size invariant: ${stat.size} === ${prodInitialSize}`);
    assert(stat.mtimeMs === prodInitialMtime, `Production DB mtime invariant: ${stat.mtimeMs} === ${prodInitialMtime}`);
  }

  // Cleanup isolated DB
  resetDbClient();
  delete process.env.IDEAPROBE_DB_PATH;
  try { fs.unlinkSync(ISOLATED_DB_PATH); } catch {}

  console.log("\n=======================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed with error:", err);
  process.exit(1);
});
