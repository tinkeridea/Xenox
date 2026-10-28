/**
 * IdeaProbe — Phase 3I Verification Suite: Report Snapshot History & Comparison
 *
 * Verifies:
 * 1. Project-scoped listing of report snapshot metadata ordered by version DESC.
 * 2. Strict project isolation (Project A's history never includes Project B's snapshots).
 * 3. Loading older immutable snapshots without mutation or overwriting latest.
 * 4. Grounded comparison between two snapshots (verdict, provenance deltas, sections, pipeline metrics).
 * 5. Edge cases: empty history, single snapshot, invalid version, non-existent project.
 * 6. Production database strict invariance (zero writes, exactly 230 snapshots preserved).
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { getReportFromDb, getReportHistoryFromDb } from "./src/app/api/projects/[id]/report/route";
import {
  compareSnapshots,
  extractVerdictHeadline,
  parseProvenanceManifest,
  parseReportSections,
  type ReportSnapshot,
} from "./src/lib/reportComparison";

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
  console.log("\n==========================================================================");
  console.log("IdeaProbe — Phase 3I: Report Snapshot History & Comparison Verification");
  console.log("==========================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const scratchDir = path.resolve(__dirname, ".ideaprobe-data");
  const tempDbPath = path.resolve(scratchDir, "test-phase3i-isolated.db");

  // Clean up any stale temp test database
  if (fs.existsSync(tempDbPath)) {
    try {
      fs.unlinkSync(tempDbPath);
    } catch {}
  }

  // ── Suite 1: Production Database Pre-Execution Baseline Check ──
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  const prodClient = createClient({ url: `file:${prodDbPath.replace(/\\/g, "/")}` });
  const preSnapshots = await prodClient.execute("SELECT COUNT(*) as cnt FROM report_snapshots");
  const preExperiments = await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments");
  const preAssumptions = await prodClient.execute("SELECT COUNT(*) as cnt FROM assumptions");
  const preProjects = await prodClient.execute("SELECT COUNT(*) as cnt FROM projects");

  const baselineSnapshots = Number(preSnapshots.rows[0].cnt);
  const baselineExperiments = Number(preExperiments.rows[0].cnt);
  const baselineAssumptions = Number(preAssumptions.rows[0].cnt);
  const baselineProjects = Number(preProjects.rows[0].cnt);

  assert(baselineSnapshots === 230, `Production report snapshots baseline is 230 (actual: ${baselineSnapshots})`);
  assert(baselineExperiments === 3, `Production experiments baseline is 3 (actual: ${baselineExperiments})`);
  assert(baselineAssumptions === 5, `Production assumptions baseline is 5 (actual: ${baselineAssumptions})`);
  assert(baselineProjects === 6, `Production projects baseline is 6 (actual: ${baselineProjects})`);

  // ── Suite 2: Static Code Structure Audit ──
  console.log("\nSuite 2: Static Code Structure Audit for Report History & Comparison");

  const reportRouteSrc = fs.readFileSync(
    path.join(__dirname, "src/app/api/projects/[id]/report/route.ts"),
    "utf-8"
  );
  assert(
    reportRouteSrc.includes("getReportHistoryFromDb"),
    "report/route.ts exports getReportHistoryFromDb"
  );
  assert(
    reportRouteSrc.includes("version?: number"),
    "report/route.ts getReportFromDb accepts optional version parameter"
  );

  const historyRouteSrc = fs.readFileSync(
    path.join(__dirname, "src/app/api/projects/[id]/report/history/route.ts"),
    "utf-8"
  );
  assert(
    historyRouteSrc.includes("delegateToFastAPI"),
    "report/history/route.ts delegates GET to FastAPI"
  );

  const reportComparisonSrc = fs.readFileSync(
    path.join(__dirname, "src/lib/reportComparison.ts"),
    "utf-8"
  );
  assert(
    reportComparisonSrc.includes("compareSnapshots"),
    "reportComparison.ts exports compareSnapshots"
  );
  assert(
    reportComparisonSrc.includes("extractVerdictHeadline"),
    "reportComparison.ts exports extractVerdictHeadline"
  );

  const reportPageSrc = fs.readFileSync(
    path.join(__dirname, "src/app/report/page.tsx"),
    "utf-8"
  );
  assert(
    reportPageSrc.includes("modal-report-comparison"),
    "report/page.tsx contains comparison modal"
  );
  assert(
    reportPageSrc.includes("select-report-version"),
    "report/page.tsx contains version history selector"
  );
  assert(
    reportPageSrc.includes("banner-historical-snapshot"),
    "report/page.tsx contains immutable historical snapshot notice banner"
  );
  assert(
    reportPageSrc.includes("btn-compare-versions"),
    "report/page.tsx contains compare versions button"
  );

  const pyRouterSrc = fs.readFileSync(
    path.join(__dirname, "../backend/app/routers/report.py"),
    "utf-8"
  );
  assert(
    pyRouterSrc.includes("/{project_id}/report/history"),
    "FastAPI report router defines /{project_id}/report/history endpoint"
  );
  assert(
    pyRouterSrc.includes("version: Optional[str] = None"),
    "FastAPI report router handles version query parameter"
  );

  // ── Suite 3: Isolated Database Environment Setup ──
  console.log("\nSuite 3: Isolated Database Environment Setup");
  process.env.IDEAPROBE_DB_PATH = tempDbPath;
  resetDbClient();
  await initDb();
  const testDb = getDb();

  const now = new Date().toISOString();
  // Create isolated test projects
  await testDb.execute({
    sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["proj-iso-a", "Test Project Alpha", "LIVE", "active", now, now],
  });
  await testDb.execute({
    sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["proj-iso-b", "Test Project Beta", "LIVE", "active", now, now],
  });
  await testDb.execute({
    sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["proj-empty", "Empty Project", "LIVE", "active", now, now],
  });
  await testDb.execute({
    sql: `INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["proj-single", "Single Project", "LIVE", "active", now, now],
  });

  // Seed snapshots for Project A out of order (v2, v1, v3)
  const v1Content = [
    {
      id: "sec-verdict",
      title: "Founder Verdict",
      provenance: "AI_INFERENCE",
      content: "VALIDATION STATUS: NEEDS FURTHER RESEARCH\nInitial discovery indicates potential interest.",
      caveat: "Subject to verification.",
    },
    {
      id: "sec-assumptions",
      title: "Key Assumptions",
      provenance: "USER_INPUT",
      content: "3 assumption(s) registered. Critical/High Priority: 2. 0 validated. 0 invalidated.",
      caveat: null,
    },
    {
      id: "sec-competitors",
      title: "Competitors",
      provenance: "REAL_SOURCE",
      content: "2 alternative(s) / competitor(s) mapped.",
      caveat: null,
    },
  ];

  const v2Content = [
    {
      id: "sec-verdict",
      title: "Founder Verdict",
      provenance: "AI_INFERENCE",
      content: "VALIDATION STATUS: PIVOT RECOMMENDED\nPricing resistance observed in initial tests.",
      caveat: "Verified via preliminary survey.",
    },
    {
      id: "sec-assumptions",
      title: "Key Assumptions",
      provenance: "USER_INPUT",
      content: "4 assumption(s) registered. Critical/High Priority: 3. 1 validated. 1 invalidated.",
      caveat: null,
    },
    {
      id: "sec-experiments",
      title: "Experiments",
      provenance: "REAL_EXPERIMENT_RESULT",
      content: "1 experiment(s) designed. 1 completed. 1 with real experiment results.",
      caveat: null,
    },
    {
      id: "sec-competitors",
      title: "Competitors",
      provenance: "REAL_SOURCE",
      content: "4 alternative(s) / competitor(s) mapped.",
      caveat: null,
    },
  ];

  const v3Content = [
    {
      id: "sec-verdict",
      title: "Founder Verdict",
      provenance: "REAL_EXPERIMENT_RESULT",
      content: "VALIDATION STATUS: PROCEED WITH CAUTION\nPilot confirmed willingness to pay among dorm residents.",
      caveat: null,
    },
    {
      id: "sec-assumptions",
      title: "Key Assumptions",
      provenance: "USER_INPUT",
      content: "5 assumption(s) registered. Critical/High Priority: 3. 2 validated. 1 invalidated.",
      caveat: null,
    },
    {
      id: "sec-experiments",
      title: "Experiments",
      provenance: "REAL_EXPERIMENT_RESULT",
      content: "2 experiment(s) designed. 2 completed. 2 with real experiment results.",
      caveat: null,
    },
    {
      id: "sec-competitors",
      title: "Competitors",
      provenance: "REAL_SOURCE",
      content: "4 alternative(s) / competitor(s) mapped.",
      caveat: null,
    },
  ];

  const v1Manifest = { USER_INPUT: 1, REAL_SOURCE: 1, AI_INFERENCE: 1 };
  const v2Manifest = { USER_INPUT: 1, REAL_SOURCE: 2, REAL_EXPERIMENT_RESULT: 1, AI_INFERENCE: 1 };
  const v3Manifest = { USER_INPUT: 1, REAL_SOURCE: 2, REAL_EXPERIMENT_RESULT: 2, AI_INFERENCE: 1 };

  // Insert v2 first
  await testDb.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, version, generated_at, content, provenance_manifest, contains_simulated, contains_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["snap-a-v2", "proj-iso-a", 2, "2026-10-26T10:00:00Z", JSON.stringify(v2Content), JSON.stringify(v2Manifest), 0, 0],
  });
  // Insert v1
  await testDb.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, version, generated_at, content, provenance_manifest, contains_simulated, contains_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["snap-a-v1", "proj-iso-a", 1, "2026-10-25T10:00:00Z", JSON.stringify(v1Content), JSON.stringify(v1Manifest), 0, 0],
  });
  // Insert v3
  await testDb.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, version, generated_at, content, provenance_manifest, contains_simulated, contains_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["snap-a-v3", "proj-iso-a", 3, "2026-10-26T14:00:00Z", JSON.stringify(v3Content), JSON.stringify(v3Manifest), 0, 0],
  });

  // Seed snapshots for Project B (v1, v2)
  await testDb.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, version, generated_at, content, provenance_manifest, contains_simulated, contains_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["snap-b-v1", "proj-iso-b", 1, "2026-10-26T11:00:00Z", JSON.stringify(v1Content), JSON.stringify(v1Manifest), 0, 0],
  });
  await testDb.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, version, generated_at, content, provenance_manifest, contains_simulated, contains_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["snap-b-v2", "proj-iso-b", 2, "2026-10-26T15:00:00Z", JSON.stringify(v2Content), JSON.stringify(v2Manifest), 0, 0],
  });

  // Seed single snapshot for proj-single
  await testDb.execute({
    sql: `INSERT INTO report_snapshots (id, project_id, version, generated_at, content, provenance_manifest, contains_simulated, contains_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["snap-s-v1", "proj-single", 1, "2026-10-26T12:00:00Z", JSON.stringify(v1Content), JSON.stringify(v1Manifest), 0, 0],
  });

  // Helper to fetch history unwrapping JSON envelope
  async function fetchHistoryFromDb(id: string) {
    const resp = await getReportHistoryFromDb(id);
    const json = await resp.json();
    if (resp.status !== 200) {
      const err = new Error(json.error?.message || `HTTP ${resp.status}`);
      (err as any).status = resp.status;
      (err as any).code = json.error?.code;
      throw err;
    }
    return json.data?.snapshots;
  }

  // Helper to fetch report snapshot unwrapping JSON envelope
  async function fetchReportFromDb(id: string, version?: number) {
    const resp = await getReportFromDb(id, version);
    const json = await resp.json();
    if (resp.status === 404) {
      return null;
    }
    if (resp.status !== 200) {
      const err = new Error(json.error?.message || `HTTP ${resp.status}`);
      (err as any).status = resp.status;
      (err as any).code = json.error?.code;
      throw err;
    }
    return json.data?.report;
  }

  // ── Suite 4: Listing Versions & Ordering ──
  console.log("\nSuite 4: Listing Report Snapshot History & Ordering");
  const historyA = await fetchHistoryFromDb("proj-iso-a");
  assert(historyA.length === 3, `Project Alpha history returns 3 snapshots (got: ${historyA.length})`);
  assert(historyA[0].version === 3, "First snapshot is version 3");
  assert(historyA[1].version === 2, "Second snapshot is version 2");
  assert(historyA[2].version === 1, "Third snapshot is version 1");
  assert(historyA[0].id === "snap-a-v3", "v3 ID is snap-a-v3");
  assert(historyA[0].verdict === "PROCEED WITH CAUTION", `v3 extracted verdict is 'PROCEED WITH CAUTION' (got: '${historyA[0].verdict}')`);
  assert(historyA[1].verdict === "PIVOT RECOMMENDED", `v2 extracted verdict is 'PIVOT RECOMMENDED' (got: '${historyA[1].verdict}')`);
  assert(historyA[2].verdict === "NEEDS FURTHER RESEARCH", `v1 extracted verdict is 'NEEDS FURTHER RESEARCH' (got: '${historyA[2].verdict}')`);
  assert(historyA[0].total_items === 6, `v3 total items calculated as 6 (got: ${historyA[0].total_items})`);
  assert(historyA[0].section_count === 4, `v3 section count is 4 (got: ${historyA[0].section_count})`);

  // ── Suite 5: Strict Project Isolation Enforcement ──
  console.log("\nSuite 5: Strict Project Isolation Enforcement");
  const historyB = await fetchHistoryFromDb("proj-iso-b");
  assert(historyB.length === 2, `Project Beta history returns exactly 2 snapshots (got: ${historyB.length})`);
  assert(historyB.every((s: any) => s.project_id === "proj-iso-b"), "All snapshots in Beta history belong strictly to proj-iso-b");
  assert(historyA.every((s: any) => s.project_id === "proj-iso-a"), "All snapshots in Alpha history belong strictly to proj-iso-a");
  assert(!historyA.some((s: any) => s.id.startsWith("snap-b")), "Alpha history contains zero Beta snapshots");
  assert(!historyB.some((s: any) => s.id.startsWith("snap-a")), "Beta history contains zero Alpha snapshots");

  // ── Suite 6: Loading Older Versions Without Mutation ──
  console.log("\nSuite 6: Loading Older Immutable Snapshots Without Mutation");
  // Default (no version specified) returns latest (v3)
  const defaultReport = await fetchReportFromDb("proj-iso-a");
  assert(defaultReport !== null && defaultReport.version === 3, "Default getReportFromDb returns latest version (v3)");

  // Explicit version 1
  const v1Report = await fetchReportFromDb("proj-iso-a", 1);
  assert(v1Report !== null && v1Report.version === 1, "getReportFromDb with version=1 returns v1");
  assert(v1Report.id === "snap-a-v1", "v1 report has correct id snap-a-v1");

  // Explicit version 2
  const v2Report = await fetchReportFromDb("proj-iso-a", 2);
  assert(v2Report !== null && v2Report.version === 2, "getReportFromDb with version=2 returns v2");
  assert(v2Report.id === "snap-a-v2", "v2 report has correct id snap-a-v2");

  // Verify DB state invariant after reads
  const snapCountCheck = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM report_snapshots WHERE project_id = ?",
    args: ["proj-iso-a"],
  });
  assert(Number(snapCountCheck.rows[0].cnt) === 3, "Reading older snapshots did not insert or delete any rows (count invariant at 3)");

  // Verify that loading v1 did not overwrite v3
  const recheckLatest = await fetchReportFromDb("proj-iso-a");
  assert(recheckLatest?.version === 3, "Latest report remains version 3 after reading v1");

  // ── Suite 7: Accurate Comparison of Two Versions ──
  console.log("\nSuite 7: Accurate Comparison of Two Versions");
  const diffV1V2 = compareSnapshots(
    v1Report as unknown as ReportSnapshot,
    v2Report as unknown as ReportSnapshot
  );

  // Verdict evolution
  assert(diffV1V2.baseVersion === 1, "Base version is 1");
  assert(diffV1V2.compareVersion === 2, "Compare version is 2");
  assert(diffV1V2.verdict.changed === true, "Verdict changed is true between v1 and v2");
  assert(diffV1V2.verdict.baseHeadline === "NEEDS FURTHER RESEARCH", "v1 headline is NEEDS FURTHER RESEARCH");
  assert(diffV1V2.verdict.compareHeadline === "PIVOT RECOMMENDED", "v2 headline is PIVOT RECOMMENDED");

  // Provenance deltas
  const realExpDelta = diffV1V2.provenance.manifestDeltas.find((d) => d.key === "REAL_EXPERIMENT_RESULT");
  assert(realExpDelta !== undefined && realExpDelta.delta === 1, "REAL_EXPERIMENT_RESULT delta is +1 (0 -> 1)");
  const realSrcDelta = diffV1V2.provenance.manifestDeltas.find((d) => d.key === "REAL_SOURCE");
  assert(realSrcDelta !== undefined && realSrcDelta.delta === 1, "REAL_SOURCE delta is +1 (1 -> 2)");
  assert(diffV1V2.provenance.totalDelta === 2, `Total items delta is +2 (got: ${diffV1V2.provenance.totalDelta})`);

  // Section comparison
  const verdictSecComp = diffV1V2.sections.find((s) => s.sectionId === "sec-verdict");
  assert(verdictSecComp?.status === "modified", "sec-verdict status is modified");
  assert(verdictSecComp?.contentChanged === true, "sec-verdict contentChanged is true");

  const expSecComp = diffV1V2.sections.find((s) => s.sectionId === "sec-experiments");
  assert(expSecComp?.status === "added", "sec-experiments was added in v2");

  const diffV2V3 = compareSnapshots(
    v2Report as unknown as ReportSnapshot,
    defaultReport as unknown as ReportSnapshot
  );
  assert(diffV2V3.verdict.baseHeadline === "PIVOT RECOMMENDED", "v2 base headline is PIVOT RECOMMENDED");
  assert(diffV2V3.verdict.compareHeadline === "PROCEED WITH CAUTION", "v3 compare headline is PROCEED WITH CAUTION");
  const assumptionsComp = diffV2V3.sections.find((s) => s.sectionId === "sec-assumptions");
  assert(assumptionsComp?.status === "modified", "sec-assumptions is modified in v3");

  // ── Suite 8: Edge Cases ──
  console.log("\nSuite 8: Edge Cases (Empty History, Single Snapshot, Invalid Versions, Missing Project)");

  // 1. Empty History
  const emptyHistory = await fetchHistoryFromDb("proj-empty");
  assert(Array.isArray(emptyHistory) && emptyHistory.length === 0, "Empty project returns empty history array []");
  const emptyReport = await fetchReportFromDb("proj-empty");
  assert(emptyReport === null, "Empty project returns null report snapshot");

  // 2. Single Snapshot
  const singleHistory = await fetchHistoryFromDb("proj-single");
  assert(singleHistory.length === 1, "Single snapshot project returns 1 history entry");
  assert(singleHistory[0].version === 1, "Single snapshot version is 1");

  // 3. Invalid Version (non-existent version 99)
  const nonExistentVer = await fetchReportFromDb("proj-iso-a", 99);
  assert(nonExistentVer === null, "Non-existent version 99 returns null snapshot");

  // 4. Invalid Version (negative or 0)
  try {
    await fetchReportFromDb("proj-iso-a", -1);
    assert(false, "Negative version should throw an error");
  } catch (err: any) {
    assert(err.message.includes("positive integer"), "Negative version throws error mentioning positive integer");
  }

  // 5. Missing Project
  try {
    await fetchHistoryFromDb("proj-ghost");
    assert(false, "Non-existent project should throw error in fetchHistoryFromDb");
  } catch (err: any) {
    assert(err.message.includes("not found") || err.code === "PROJECT_NOT_FOUND", "Missing project throws not found error");
  }

  // ── Suite 9: Production Database Post-Execution Invariance Check ──
  console.log("\nSuite 9: Production Database Post-Execution Invariance Check");
  // Restore DB path and reset client
  delete process.env.IDEAPROBE_DB_PATH;
  resetDbClient();

  const postSnapshots = await prodClient.execute("SELECT COUNT(*) as cnt FROM report_snapshots");
  const postExperiments = await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments");
  const postAssumptions = await prodClient.execute("SELECT COUNT(*) as cnt FROM assumptions");
  const postProjects = await prodClient.execute("SELECT COUNT(*) as cnt FROM projects");

  const finalSnapshots = Number(postSnapshots.rows[0].cnt);
  const finalExperiments = Number(postExperiments.rows[0].cnt);
  const finalAssumptions = Number(postAssumptions.rows[0].cnt);
  const finalProjects = Number(postProjects.rows[0].cnt);

  assert(finalSnapshots === baselineSnapshots, `Production report snapshots strictly invariant: ${baselineSnapshots} -> ${finalSnapshots}`);
  assert(finalExperiments === baselineExperiments, `Production experiments strictly invariant: ${baselineExperiments} -> ${finalExperiments}`);
  assert(finalAssumptions === baselineAssumptions, `Production assumptions strictly invariant: ${baselineAssumptions} -> ${finalAssumptions}`);
  assert(finalProjects === baselineProjects, `Production projects strictly invariant: ${baselineProjects} -> ${finalProjects}`);

  // Clean up temporary test database
  if (fs.existsSync(tempDbPath)) {
    try {
      fs.unlinkSync(tempDbPath);
    } catch {}
  }

  console.log("\n==========================================================================");
  console.log(`Phase 3I Verification Complete: ${passed} passed, ${failed} failed`);
  console.log("==========================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
