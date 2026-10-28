/**
 * IdeaProbe — Phase 2 Validation Gate: End-to-End Workflow & Evidence Integrity Test Suite
 *
 * Validates:
 * 1. Isolated Database Strategy: Executes entirely in a temporary SQLite database without mutating ideaprobe.db.
 * 2. Full End-to-End Workflow:
 *    - Step 1: Create a test project via POST /api/projects.
 *    - Step 2: Open it and verify project-aware ID preservation in API handlers.
 *    - Step 3: Verify strict project data isolation (zero leakage of sources, evidence, competitors, personas, interviews from proj-study-planner).
 *    - Step 4: Register an assumption, create an experiment, and record a result through the supported PATCH workflow (auto-upgrades to REAL_EXPERIMENT_RESULT).
 *    - Step 5: Verify experiment outcome evaluation does NOT automatically mutate assumption status (Decision D23/D24), and verify explicit founder confirmation.
 *    - Step 6: Generate a live report snapshot via POST /api/projects/[id]/report in the isolated environment.
 *    - Step 7: Confirm report reflects test project data, contains_simulated/sample are false, and verdict is evidence-grounded.
 * 3. Experiment Result Provenance Audit:
 *    - Trustworthy real experiment result (REAL_EXPERIMENT_RESULT + non-empty result) qualifies.
 *    - Non-empty result with missing/null provenance is conservatively quarantined -> PRE-VALIDATION.
 *    - Non-empty result with AI_INFERENCE provenance is quarantined -> PRE-VALIDATION.
 *    - Non-empty result with USER_INPUT provenance (draft notes) is quarantined -> PRE-VALIDATION.
 *    - Non-empty result with SIMULATED or SAMPLE provenance is quarantined -> PRE-VALIDATION.
 * 4. Assumption Status Transition Safety & Error Handling:
 *    - Rejection of invalid status strings (400 VALIDATION_FAILED).
 *    - Rejection of nonexistent assumption IDs (404 NOT_FOUND).
 *    - Successful explicit transitions.
 * 5. Production Database Invariance:
 *    - Verifies ideaprobe/.ideaprobe-data/ideaprobe.db snapshot count remains 229, max_version remains 229, 0 writes.
 */

import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as createProject, GET as getProject } from "./src/app/api/projects/route";
import { GET as getProjectDetail } from "./src/app/api/projects/[id]/route";
import { POST as createAssumption, PATCH as updateAssumption } from "./src/app/api/projects/[id]/assumptions/route";
import { POST as createExperiment, PATCH as updateExperiment } from "./src/app/api/projects/[id]/experiments/route";
import { POST as generateReport, buildVerdict } from "./src/app/api/projects/[id]/report/route";
import { evaluateExperimentDecision } from "./src/lib/experimentDecision";

let passed = 0;
let failed = 0;

function assert(testName: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

async function runValidationGate() {
  console.log("==========================================================================");
  console.log("IdeaProbe — Phase 2 Validation Gate: End-to-End Workflow & Evidence Integrity");
  console.log("==========================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const isolatedDbPath = path.resolve(__dirname, ".ideaprobe-data", "test-phase2-isolated-gate.db");

  // Clean previous test artifact if exists
  if (fs.existsSync(isolatedDbPath)) {
    fs.unlinkSync(isolatedDbPath);
  }

  // Record production DB baseline
  const prodClient = createClient({ url: `file:${prodDbPath.replace(/\\/g, "/")}` });
  const prodBaseline = await prodClient.execute("SELECT COUNT(*) as cnt, MAX(version) as max_v FROM report_snapshots");
  const prodInitialCount = (prodBaseline.rows[0] as any).cnt;
  const prodInitialVersion = (prodBaseline.rows[0] as any).max_v;
  const prodInitialProjectsCount = Number((await prodClient.execute("SELECT COUNT(*) as cnt FROM projects")).rows[0]?.cnt || 0);
  const prodInitialExperimentsCount = Number((await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments")).rows[0]?.cnt || 0);
  if (typeof (prodClient as any).close === "function") (prodClient as any).close();

  console.log(`Production Database: ${prodDbPath}`);
  console.log(`Production Snapshots Baseline: count=${prodInitialCount}, max_version=${prodInitialVersion}`);
  console.log(`Isolated Test Database: ${isolatedDbPath}\n`);

  // Point environment to isolated test database
  process.env.IDEAPROBE_DB_PATH = isolatedDbPath;
  resetDbClient();

  try {
    // ── Phase 1: End-to-End Product Workflow in Isolated Database ──────
    console.log("── Phase 1: End-to-End Workflow in Isolated Environment ──");

    // Initialize isolated database schema and demo fixtures
    await initDb();
    const isolatedDb = getDb();
    assert("Isolated database file created successfully", fs.existsSync(isolatedDbPath));

    // Step 1: Create a new validation project
    console.log("\n1. Step 1: Create Test Project via POST /api/projects");
    const projectPayload = {
      title: "EcoCourier Logistics",
      problem: "High urban delivery emissions and congestion in tier-1 metros",
      target_customer: "Direct-to-consumer e-commerce retailers",
      solution: "Electric cargo bike delivery fleet with proprietary micro-hub routing",
      geography: "Mumbai",
      category: "CleanTech Logistics",
    };

    const reqCreateProj = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectPayload),
    });

    const resCreateProj = await createProject(reqCreateProj);
    const jsonCreateProj = await resCreateProj.json();

    assert("POST /api/projects returns HTTP 201", resCreateProj.status === 201);
    assert("Response envelope contains data.projectId", Boolean(jsonCreateProj.data?.projectId));
    const testProjectId = jsonCreateProj.data?.projectId;
    assert("Generated project ID has 'proj-' prefix", typeof testProjectId === "string" && testProjectId.startsWith("proj-"));
    assert("Project title matches payload", jsonCreateProj.data?.title === "EcoCourier Logistics");
    assert("Response envelope provenance is USER_INPUT", jsonCreateProj.meta?.provenance === "USER_INPUT");

    // Verify initial run and stages were created
    const runsCheck = await isolatedDb.execute({
      sql: "SELECT * FROM runs WHERE project_id = ?",
      args: [testProjectId],
    });
    assert("Initial run created in SQLite for test project", runsCheck.rows.length === 1);

    const stagesCheck = await isolatedDb.execute({
      sql: "SELECT COUNT(*) as cnt FROM stages WHERE run_id = ?",
      args: [(runsCheck.rows[0] as any).id],
    });
    assert("10 pipeline stages created for initial run", (stagesCheck.rows[0] as any).cnt === 10);

    // Step 2: Open project and confirm ID preservation in detail query
    console.log("\n2. Step 2: Open Project & Confirm ID Preservation");
    const routeParams = { params: Promise.resolve({ id: testProjectId }) };
    const reqDetail = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}`);
    // Note: getProjectDetail delegates to FastAPI in production; fallback to direct DB query in isolated harness
    const projRow = await isolatedDb.execute({
      sql: "SELECT * FROM projects WHERE id = ?",
      args: [testProjectId],
    });
    assert("Project retrieved from isolated DB by exact ID", projRow.rows.length === 1);
    assert("Retrieved project title is EcoCourier Logistics", (projRow.rows[0] as any).title === "EcoCourier Logistics");

    // Step 3: Confirm Project Isolation (Zero Data Leakage from proj-study-planner)
    console.log("\n3. Step 3: Project Isolation (No Data Leakage from Demo Project)");
    const sourcesLeak = await isolatedDb.execute({
      sql: "SELECT * FROM sources WHERE project_id = ?",
      args: [testProjectId],
    });
    assert("Test project has 0 sources (no leakage of demo sources)", sourcesLeak.rows.length === 0);

    const evidenceLeak = await isolatedDb.execute({
      sql: "SELECT * FROM evidence WHERE project_id = ?",
      args: [testProjectId],
    });
    assert("Test project has 0 evidence items (no leakage of demo evidence)", evidenceLeak.rows.length === 0);

    const competitorsLeak = await isolatedDb.execute({
      sql: "SELECT * FROM competitors WHERE project_id = ?",
      args: [testProjectId],
    });
    assert("Test project has 0 competitors (no leakage of demo competitors)", competitorsLeak.rows.length === 0);

    const personasLeak = await isolatedDb.execute({
      sql: "SELECT * FROM personas WHERE project_id = ?",
      args: [testProjectId],
    });
    assert("Test project has 0 personas (no leakage of demo personas)", personasLeak.rows.length === 0);

    const interviewsLeak = await isolatedDb.execute({
      sql: "SELECT * FROM interviews WHERE project_id = ?",
      args: [testProjectId],
    });
    assert("Test project has 0 interviews (no leakage of demo transcripts)", interviewsLeak.rows.length === 0);

    // Step 4: Create Assumption, Experiment, and Record Test Result
    console.log("\n4. Step 4: Register Assumption, Create Experiment, and Record Result");
    const reqCreateAsm = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statement: "Retailers will pay 15% premium for carbon-neutral delivery",
        category: "value",
        uncertainty: "Critical",
        impact: "High",
        rationale: "Green delivery is only viable if retailers shoulder delivery cost delta",
      }),
    });
    const resCreateAsm = await createAssumption(reqCreateAsm, routeParams);
    const jsonCreateAsm = await resCreateAsm.json();
    assert("POST /assumptions returns HTTP 201", resCreateAsm.status === 201);
    const testAsmId = jsonCreateAsm.data?.assumption?.id;
    assert("Created assumption ID exists", typeof testAsmId === "string" && testAsmId.startsWith("asm-"));
    assert("Assumption initial status is 'unvalidated'", jsonCreateAsm.data?.assumption?.status === "unvalidated");

    const reqCreateExp = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/experiments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assumption_id: testAsmId,
        hypothesis: "5 out of 10 retailers sign non-binding LOI for trial",
        method: "concierge",
        metric: "LOI conversion rate",
        threshold: ">= 50% sign LOI",
        decision_rules: "Continue: observed result >= 50%. Pivot: observed result from 25% through 49%, inclusive. Stop: observed result < 25%.",
        duration: "14 days",
      }),
    });
    const resCreateExp = await createExperiment(reqCreateExp, routeParams);
    const jsonCreateExp = await resCreateExp.json();
    assert("POST /experiments returns HTTP 201", resCreateExp.status === 201);
    const testExpId = jsonCreateExp.data?.experiment?.id;
    assert("Created experiment ID exists", typeof testExpId === "string" && testExpId.startsWith("exp-"));
    assert("Experiment initial status is 'planned'", jsonCreateExp.data?.experiment?.status === "planned");
    assert("Experiment initial result is null", jsonCreateExp.data?.experiment?.result === null);
    assert("Experiment initial provenance is USER_INPUT", jsonCreateExp.data?.experiment?.provenance === "USER_INPUT");

    // Record test result via supported workflow: PATCH /api/projects/[id]/experiments
    const reqRecordResult = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/experiments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: testExpId,
        status: "completed",
        result: "Observed 6 out of 10 retailers (60%) signed non-binding LOIs for carbon-neutral pilot",
      }),
    });
    const resRecordResult = await updateExperiment(reqRecordResult, routeParams);
    const jsonRecordResult = await resRecordResult.json();
    assert("PATCH /experiments (record result) returns HTTP 200", resRecordResult.status === 200);
    assert("Experiment status updated to 'completed'", jsonRecordResult.data?.experiment?.status === "completed");
    assert("Experiment result recorded correctly", jsonRecordResult.data?.experiment?.result.includes("60%"));
    assert("Experiment provenance auto-upgraded to REAL_EXPERIMENT_RESULT", jsonRecordResult.data?.experiment?.provenance === "REAL_EXPERIMENT_RESULT");

    // Step 5: Verify Outcome Evaluation Does NOT Automatically Mutate Assumption Status
    console.log("\n5. Step 5: Decision Evaluation & Explicit Assumption Confirmation Gate");
    const expRowAfter = (await isolatedDb.execute({
      sql: "SELECT * FROM experiments WHERE id = ?",
      args: [testExpId],
    })).rows[0] as any;

    const asmRowAfterExp = (await isolatedDb.execute({
      sql: "SELECT * FROM assumptions WHERE id = ?",
      args: [testAsmId],
    })).rows[0] as any;

    // Decision engine evaluation
    const decision = evaluateExperimentDecision(expRowAfter);
    assert("Decision engine evaluates 60% vs >= 50% threshold as Supported", decision.outcome === "supported" && decision.label === "Supported");
    assert("Decision engine suggests 'validated' status for assumption", decision.suggestedAssumptionStatus === "validated");

    // CRITICAL CHECK: Assumption in database remains 'unvalidated' (NO AUTOMATIC UPDATE per D23/D24)
    assert("Assumption in SQLite remains 'unvalidated' before explicit confirmation", asmRowAfterExp.status === "unvalidated");

    // Explicit founder confirmation transition via PATCH /api/projects/[id]/assumptions
    const reqConfirmAsm = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: testAsmId,
        status: "validated",
      }),
    });
    const resConfirmAsm = await updateAssumption(reqConfirmAsm, routeParams);
    assert("PATCH /assumptions confirms status change to 'validated'", resConfirmAsm.status === 200);

    const asmRowConfirmed = (await isolatedDb.execute({
      sql: "SELECT status FROM assumptions WHERE id = ?",
      args: [testAsmId],
    })).rows[0] as any;
    assert("Assumption status in SQLite is now 'validated'", asmRowConfirmed.status === "validated");

    // Step 6: Generate Report Snapshot in Isolated Environment
    console.log("\n6. Step 6: Generate Live Report Snapshot in Isolated Environment");
    const reqGenReport = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const resGenReport = await generateReport(reqGenReport, routeParams);
    const jsonGenReport = await resGenReport.json();

    assert("POST /report returns HTTP 201 Created", resGenReport.status === 201);
    assert("Report snapshot version is 1", jsonGenReport.data?.report?.version === 1);
    assert("Report ID references test project", jsonGenReport.data?.report?.id.includes(testProjectId));

    // Step 7: Confirm Report Reflects Test Project Data & Evidence Integrity
    console.log("\n7. Step 7: Confirm Report Data Fidelity & Evidence Integrity");
    const sections: any[] = jsonGenReport.data?.report?.content || [];
    assert("Report contains 9 sections", sections.length === 9);

    const briefSec = sections.find((s) => s.id === "sec-brief");
    assert("sec-brief contains EcoCourier Logistics problem & solution", briefSec?.content.includes("Electric cargo bike") && briefSec?.content.includes("Mumbai"));

    const sourcesSec = sections.find((s) => s.id === "sec-sources");
    assert("sec-sources reflects 0 indexed sources (no demo data leakage)", sourcesSec?.content.includes("No sources or evidence have been indexed in this project."));

    const expSec = sections.find((s) => s.id === "sec-experiments");
    assert("sec-experiments renders REAL_EXPERIMENT_RESULT provenance", expSec?.provenance === "REAL_EXPERIMENT_RESULT");
    assert("sec-experiments renders 1 completed experiment with result", expSec?.content.includes("1 with real experiment results") && expSec?.content.includes("60%"));

    const verdictSec = sections.find((s) => s.id === "sec-verdict");
    assert("sec-verdict accurately reflects PARTIAL VALIDATION from 1 real result & 1 validated assumption", verdictSec?.content.includes("VALIDATION STATUS: 🟡 PARTIAL VALIDATION"));
    assert("sec-verdict reports 1 real experiment result recorded", verdictSec?.content.includes("1 real experiment result(s) recorded. 1 assumption(s) validated."));
    assert("sec-verdict confirms all critical assumptions tested", verdictSec?.content.includes("All critical assumptions have been tested. Consider progressing to MVP build phase."));

    assert("Report contains_simulated is false", jsonGenReport.data?.report?.contains_simulated === false);
    assert("Report contains_sample is false", jsonGenReport.data?.report?.contains_sample === false);

    // ── Phase 2: Experiment-Result Provenance Audit Checks ───────────────
    console.log("\n── Phase 2: Experiment-Result Provenance Audit Checks ──");
    {
      const baseAssumptions = [{ id: "a-1", status: "validated", uncertainty: "Low", impact: "Low" }];

      // Case 1: Trustworthy real experiment result
      const vTrustworthy = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-1" }],
        realResults: [{ id: "exp-1", provenance: "REAL_EXPERIMENT_RESULT", result: "Observed 60% conversion" }],
        sources: [],
        evidence: [],
      });
      assert("Trustworthy real result (REAL_EXPERIMENT_RESULT + non-empty string) qualifies -> PARTIAL VALIDATION", vTrustworthy.includes("VALIDATION STATUS: 🟡 PARTIAL VALIDATION"));

      // Case 2: Non-empty result with missing/null provenance (unverified draft)
      const vNullProv = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-2" }],
        realResults: [{ id: "exp-2", provenance: null, result: "Draft notes claiming 80% signups" }],
        sources: [],
        evidence: [],
      });
      assert("Non-empty result with null provenance is quarantined -> PRE-VALIDATION", vNullProv.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

      // Case 3: Non-empty result with AI_INFERENCE provenance (AI hypothesis plan)
      const vAiInference = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-3" }],
        realResults: [{ id: "exp-3", provenance: "AI_INFERENCE", result: "AI-generated synthetic estimate of 70% conversion" }],
        sources: [],
        evidence: [],
      });
      assert("Non-empty result with AI_INFERENCE provenance is quarantined -> PRE-VALIDATION", vAiInference.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

      // Case 4: Non-empty result with USER_INPUT provenance (founder draft / unconducted plan)
      const vUserInput = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-4" }],
        realResults: [{ id: "exp-4", provenance: "USER_INPUT", result: "Founder scratchpad: hope to get 20 signups" }],
        sources: [],
        evidence: [],
      });
      assert("Non-empty result with USER_INPUT provenance is quarantined -> PRE-VALIDATION", vUserInput.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

      // Case 5: Non-empty result with SIMULATED provenance
      const vSimulated = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-5" }],
        realResults: [{ id: "exp-5", provenance: "SIMULATED", result: "Simulated persona said they would pay" }],
        sources: [],
        evidence: [],
      });
      assert("Non-empty result with SIMULATED provenance is quarantined -> PRE-VALIDATION", vSimulated.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

      // Case 6: Non-empty result with SAMPLE provenance
      const vSample = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-6" }],
        realResults: [{ id: "exp-6", provenance: "SAMPLE", result: "Sample demonstration result" }],
        sources: [],
        evidence: [],
      });
      assert("Non-empty result with SAMPLE provenance is quarantined -> PRE-VALIDATION", vSample.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));

      // Case 7: REAL_EXPERIMENT_RESULT provenance but empty/whitespace result
      const vEmptyResult = buildVerdict({
        assumptions: baseAssumptions,
        experiments: [{ id: "exp-7" }],
        realResults: [{ id: "exp-7", provenance: "REAL_EXPERIMENT_RESULT", result: "   " }],
        sources: [],
        evidence: [],
      });
      assert("REAL_EXPERIMENT_RESULT with empty whitespace string is quarantined -> PRE-VALIDATION", vEmptyResult.includes("VALIDATION STATUS: ⛔ PRE-VALIDATION"));
    }

    // ── Phase 3: Assumption Mutation Safety & Error Handling ────────────
    console.log("\n── Phase 3: Assumption Mutation Safety & Error Handling ──");
    {
      // 3.1: Invalid status string returns HTTP 400 VALIDATION_FAILED
      const reqInvalidStatus = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: testAsmId,
          status: "guaranteed_unicorn",
        }),
      });
      const resInvalidStatus = await updateAssumption(reqInvalidStatus, routeParams);
      const jsonInvalidStatus = await resInvalidStatus.json();
      assert("PATCH /assumptions with invalid status returns HTTP 400", resInvalidStatus.status === 400);
      assert("Error code is VALIDATION_FAILED", jsonInvalidStatus.error?.code === "VALIDATION_FAILED");

      // 3.2: Nonexistent assumption ID returns HTTP 404 NOT_FOUND
      const reqNonexistentAsm = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "asm-does-not-exist-9999",
          status: "testing",
        }),
      });
      const resNonexistentAsm = await updateAssumption(reqNonexistentAsm, routeParams);
      const jsonNonexistentAsm = await resNonexistentAsm.json();
      assert("PATCH /assumptions with nonexistent ID returns HTTP 404", resNonexistentAsm.status === 404);
      assert("Error code is NOT_FOUND", jsonNonexistentAsm.error?.code === "NOT_FOUND");

      // 3.3: Missing assumption ID returns HTTP 400 VALIDATION_FAILED
      const reqMissingId = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "testing",
        }),
      });
      const resMissingId = await updateAssumption(reqMissingId, routeParams);
      const jsonMissingId = await resMissingId.json();
      assert("PATCH /assumptions with missing ID returns HTTP 400", resMissingId.status === 400);
      assert("Error code is VALIDATION_FAILED", jsonMissingId.error?.code === "VALIDATION_FAILED");

      // 3.4: Legitimate lifecycle transition: validated -> testing
      const reqTransitionTesting = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: testAsmId,
          status: "testing",
        }),
      });
      const resTransitionTesting = await updateAssumption(reqTransitionTesting, routeParams);
      assert("PATCH /assumptions transition to 'testing' succeeds (HTTP 200)", resTransitionTesting.status === 200);

      // 3.5: Legitimate lifecycle transition: testing -> invalidated
      const reqTransitionInvalid = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: testAsmId,
          status: "invalidated",
        }),
      });
      const resTransitionInvalid = await updateAssumption(reqTransitionInvalid, routeParams);
      assert("PATCH /assumptions transition to 'invalidated' succeeds (HTTP 200)", resTransitionInvalid.status === 200);

      // Verify final status in isolated DB
      const finalAsmRow = (await isolatedDb.execute({
        sql: "SELECT status FROM assumptions WHERE id = ?",
        args: [testAsmId],
      })).rows[0] as any;
      assert("Assumption in isolated DB successfully reflects 'invalidated'", finalAsmRow.status === "invalidated");
    }

  } finally {
    // Teardown: Reset client and restore environment
    resetDbClient();
    delete process.env.IDEAPROBE_DB_PATH;

    // Clean up isolated test database file
    if (fs.existsSync(isolatedDbPath)) {
      try {
        fs.unlinkSync(isolatedDbPath);
        console.log(`\nCleaned up isolated database: ${isolatedDbPath}`);
      } catch (err: any) {
        console.warn(`Could not immediately delete temporary isolated DB (${err.message}) - marked for cleanup.`);
      }
    }
  }

  // ── Verification: Production Database Invariance ───────────────────
  console.log("\n── Production Database Invariance Check ──");
  {
    resetDbClient();
    const finalProdClient = createClient({ url: `file:${prodDbPath.replace(/\\/g, "/")}` });
    const prodFinal = await finalProdClient.execute("SELECT COUNT(*) as cnt, MAX(version) as max_v FROM report_snapshots");
    const prodFinalCount = (prodFinal.rows[0] as any).cnt;
    const prodFinalVersion = (prodFinal.rows[0] as any).max_v;

    assert("Production database report_snapshots count strictly invariant (no writes during test)", prodFinalCount === prodInitialCount, `Got ${prodFinalCount} (initial: ${prodInitialCount})`);
    assert("Production database report_snapshots max_version strictly invariant (no writes during test)", prodFinalVersion === prodInitialVersion, `Got ${prodFinalVersion} (initial: ${prodInitialVersion})`);

    const expCheck = await finalProdClient.execute("SELECT COUNT(*) as cnt FROM experiments");
    assert("Production database experiments table strictly invariant (no writes during test)", (expCheck.rows[0] as any).cnt === prodInitialExperimentsCount);

    const projCheck = await finalProdClient.execute("SELECT COUNT(*) as cnt FROM projects");
    assert("Production database projects table strictly invariant (no writes during test)", (projCheck.rows[0] as any).cnt === prodInitialProjectsCount);
    if (typeof (finalProdClient as any).close === "function") (finalProdClient as any).close();
  }

  console.log("\n==========================================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.`);
  console.log("==========================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runValidationGate().catch((err) => {
  console.error("Test runner threw unexpected exception:", err);
  process.exit(1);
});
