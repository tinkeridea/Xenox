/**
 * IdeaProbe — Phase 3H Verification Suite: Experiment Planner LIVE-Mode Fallback Isolation
 *
 * Verifies:
 * 1. LIVE experiment generation with Ollama unavailable returns HTTP 503 INFERENCE_FAILED.
 * 2. LIVE failure produces zero database writes (zero experiments inserted).
 * 3. LIVE failure leaves the linked assumption strictly unvalidated (never transitioned to 'testing').
 * 4. DEMO fallbacks still work and persist with SAMPLE provenance when Ollama is unavailable.
 * 5. Successful LIVE inference works and saves AI_INFERENCE provenance with expected assumption transition.
 * 6. Timeout and malformed inference responses fail-fast without bypassing LIVE protection.
 * 7. Production SQLite database strictly invariant (zero writes).
 */

import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as generateExperiment } from "./src/app/api/projects/[id]/experiments/generate/route";

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
  console.log("IdeaProbe — Phase 3H: Experiment Planner LIVE-Mode Fallback Isolation");
  console.log("==========================================================================\n");

  const originalFetch = globalThis.fetch;
  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const scratchDir = path.resolve(__dirname, ".ideaprobe-data");
  const tempDbPath = path.resolve(scratchDir, "test-phase3h-isolated.db");

  // Clean up any old temp test database
  if (fs.existsSync(tempDbPath)) {
    try {
      fs.unlinkSync(tempDbPath);
    } catch {}
  }

  // ── Baseline check of production database ──
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
  console.log("\nSuite 2: Static Code Structure Audit for experiments/generate/route.ts");
  const expRouteSrc = fs.readFileSync(
    path.join(__dirname, "src/app/api/projects/[id]/experiments/generate/route.ts"),
    "utf-8"
  );

  assert(
    expRouteSrc.includes("isAiInference"),
    "experiments/generate imports and calls isAiInference"
  );
  assert(
    expRouteSrc.includes("isDemoProject"),
    "experiments/generate checks isDemoProject"
  );
  assert(
    expRouteSrc.includes("INFERENCE_FAILED") && expRouteSrc.includes("503"),
    "experiments/generate returns HTTP 503 INFERENCE_FAILED on live failure"
  );
  assert(
    expRouteSrc.includes("!isDemoProject && !isLive"),
    "experiments/generate guards database insert and assumption transition for live projects when offline"
  );

  // ── Suite 3: Isolated Database Environment Setup ──
  console.log("\nSuite 3: Isolated Database Environment Setup");
  process.env.IDEAPROBE_DB_PATH = tempDbPath;
  resetDbClient();
  await initDb();

  const testDb = getDb();

  // Create LIVE test project
  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: ["proj-live-exp-test", "CampusLogistics Live Project", "LIVE", "active", "2026-10-26T00:00:00Z", "2026-10-26T00:00:00Z"],
  });
  await testDb.execute({
    sql: `INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, geography, category, stage, constraints, goals, provenance, created_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "brief-live-1",
      "proj-live-exp-test",
      "Hostel residents walk 15 mins to campus gate for parcel pickups",
      "Hostel students in Blocks C & D",
      "Peer-to-peer delivery network",
      "India",
      "Logistics",
      "Problem Validation",
      "",
      "",
      "USER_INPUT",
      "2026-10-26T00:00:00Z",
    ],
  });
  await testDb.execute({
    sql: "INSERT INTO assumptions (id, project_id, statement, category, impact, uncertainty, status, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "asm-live-1",
      "proj-live-exp-test",
      "Students will pay peers ₹30 per parcel delivery rather than walking to the gate",
      "desirability",
      "High",
      "Critical",
      "unvalidated",
      "USER_INPUT",
      "2026-10-26T00:00:00Z",
    ],
  });

  // Create DEMO test project
  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: ["proj-demo-exp-test", "Study Planner Demo Project", "DEMO", "active", "2026-10-26T00:00:00Z", "2026-10-26T00:00:00Z"],
  });
  await testDb.execute({
    sql: `INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, geography, category, stage, constraints, goals, provenance, created_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "brief-demo-1",
      "proj-demo-exp-test",
      "Engineering students struggle with study schedules",
      "College engineering students",
      "Automated WhatsApp study schedule rebalancing",
      "India",
      "EdTech",
      "Idea Validation",
      "",
      "",
      "SAMPLE",
      "2026-10-26T00:00:00Z",
    ],
  });
  await testDb.execute({
    sql: "INSERT INTO assumptions (id, project_id, statement, category, impact, uncertainty, status, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "asm-demo-1",
      "proj-demo-exp-test",
      "Students will complete 3+ study blocks if notified via WhatsApp",
      "desirability",
      "High",
      "Critical",
      "unvalidated",
      "SAMPLE",
      "2026-10-26T00:00:00Z",
    ],
  });

  assert(true, "Isolated test database initialized with LIVE and DEMO test projects and assumptions");

  // ── Suite 4: Ollama Unavailable Mode — LIVE Projects Fail-Fast & Zero DB Writes ──
  console.log("\nSuite 4: Ollama Unavailable Mode — LIVE Projects Fail-Fast & Zero DB Writes");
  // Mock fetch to simulate Ollama unavailable
  globalThis.fetch = async () => {
    return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:11434"));
  };

  const liveReq = new NextRequest("http://localhost:3000/api/projects/proj-live-exp-test/experiments/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptionId: "asm-live-1", method: "Concierge MVP" }),
  });

  const liveRes = await generateExperiment(liveReq, { params: Promise.resolve({ id: "proj-live-exp-test" }) });
  assert(liveRes.status === 503, `LIVE experiment generate returns HTTP 503 when Ollama unavailable (got ${liveRes.status})`);

  const liveJson = await liveRes.json();
  assert(liveJson.error?.code === "INFERENCE_FAILED", `Error code is INFERENCE_FAILED (got ${liveJson.error?.code})`);
  assert(liveJson.error?.retryable === true, "Error payload marks retryable as true");
  assert(
    typeof liveJson.error?.message === "string" && liveJson.error.message.includes("Ollama local inference failed"),
    `Error message contains helpful retry instructions: "${liveJson.error?.message}"`
  );

  // Verify zero experiment rows inserted into LIVE project
  const liveExpCount = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM experiments WHERE project_id = ?",
    args: ["proj-live-exp-test"],
  });
  assert(Number(liveExpCount.rows[0].cnt) === 0, `Zero experiments written to LIVE project (actual: ${liveExpCount.rows[0].cnt})`);

  // Verify linked assumption remains unvalidated
  const liveAsmCheck = await testDb.execute({
    sql: "SELECT status FROM assumptions WHERE id = ?",
    args: ["asm-live-1"],
  });
  assert(
    liveAsmCheck.rows[0].status === "unvalidated",
    `Linked assumption status remains unvalidated on LIVE failure (actual: "${liveAsmCheck.rows[0].status}")`
  );

  // ── Suite 5: DEMO Fallback Mode — DEMO Projects Retain SAMPLE Fallbacks ──
  console.log("\nSuite 5: DEMO Fallback Mode — DEMO Projects Retain SAMPLE Fallbacks");
  const demoReq = new NextRequest("http://localhost:3000/api/projects/proj-demo-exp-test/experiments/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptionId: "asm-demo-1" }),
  });

  const demoRes = await generateExperiment(demoReq, { params: Promise.resolve({ id: "proj-demo-exp-test" }) });
  assert(demoRes.status === 201, `DEMO experiment generate returns HTTP 201 when Ollama unavailable (got ${demoRes.status})`);

  const demoJson = await demoRes.json();
  const demoProvenance = demoJson.data?.provenance || demoJson.meta?.provenance;
  assert(demoProvenance === "SAMPLE", `DEMO experiment retains SAMPLE provenance (got ${demoProvenance})`);

  const demoExpCount = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM experiments WHERE project_id = ?",
    args: ["proj-demo-exp-test"],
  });
  assert(Number(demoExpCount.rows[0].cnt) === 1, `Exactly 1 experiment written to DEMO project (actual: ${demoExpCount.rows[0].cnt})`);

  const demoExpRow = await testDb.execute({
    sql: "SELECT provenance, status FROM experiments WHERE project_id = ? LIMIT 1",
    args: ["proj-demo-exp-test"],
  });
  assert(demoExpRow.rows[0].provenance === "SAMPLE", `DEMO experiment in database has SAMPLE provenance (got ${demoExpRow.rows[0].provenance})`);

  // Verify demo linked assumption transitioned to 'testing'
  const demoAsmCheck = await testDb.execute({
    sql: "SELECT status FROM assumptions WHERE id = ?",
    args: ["asm-demo-1"],
  });
  assert(
    demoAsmCheck.rows[0].status === "testing",
    `Linked demo assumption transitioned to testing for demo project (actual: "${demoAsmCheck.rows[0].status}")`
  );

  // ── Suite 6: Live Inference Mode — LIVE Projects Succeed & Tag AI_INFERENCE ──
  console.log("\nSuite 6: Live Inference Mode — LIVE Projects Succeed & Tag AI_INFERENCE");
  // Mock fetch to simulate successful Ollama inference
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/api/tags")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "qwen3.5:4b" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.includes("/api/generate")) {
      return new Response(
        JSON.stringify({
          response: JSON.stringify({
            hypothesis: "If we offer peer-to-peer delivery coordination via WhatsApp in Blocks C and D, at least 15 students will place paid orders within seven days.",
            method: "Concierge WhatsApp MVP",
            cohort: "Hostel residents in Blocks C and D (n=50)",
            metric: "Completed peer-delivery orders placed during the 7-day test",
            threshold: "At least 15 completed orders, with positive ratings",
            duration: "7 days",
            cost_estimate: "₹0 (manual coordination)",
            decision_rules: {
              continue: ">= 15 completed orders and positive student ratings",
              pivot: "6 to 14 completed orders; investigate pricing friction",
              stop: "< 6 completed orders after seven days",
            },
            ethical_notes: [
              "Explicit student consent required for notifications",
              "No personal contact details shared publicly",
            ],
            linked_assumption_ids: ["asm-live-1"],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return originalFetch(input, init);
  };

  const liveSuccessReq = new NextRequest("http://localhost:3000/api/projects/proj-live-exp-test/experiments/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptionId: "asm-live-1" }),
  });

  const liveSuccessRes = await generateExperiment(liveSuccessReq, { params: Promise.resolve({ id: "proj-live-exp-test" }) });
  assert(liveSuccessRes.status === 201, `LIVE experiment generate returns HTTP 201 when Ollama is healthy (got ${liveSuccessRes.status})`);

  const liveSuccessJson = await liveSuccessRes.json();
  const liveProvenance = liveSuccessJson.data?.provenance || liveSuccessJson.meta?.provenance;
  assert(liveProvenance === "AI_INFERENCE", `LIVE experiment provenance is AI_INFERENCE (got ${liveProvenance})`);
  assert(
    liveSuccessJson.data?.experiment?.hypothesis?.includes("Blocks C and D"),
    "LIVE experiment hypothesis matches generated entity"
  );

  const liveExpCheck = await testDb.execute({
    sql: "SELECT provenance, status FROM experiments WHERE project_id = ?",
    args: ["proj-live-exp-test"],
  });
  assert(Number(liveExpCheck.rows.length) === 1, `Exactly 1 experiment in LIVE project now (actual: ${liveExpCheck.rows.length})`);
  assert(liveExpCheck.rows[0].provenance === "AI_INFERENCE", `LIVE experiment in database has AI_INFERENCE provenance (got ${liveExpCheck.rows[0].provenance})`);

  // Verify linked assumption now transitioned to 'testing'
  const liveAsmUpdated = await testDb.execute({
    sql: "SELECT status FROM assumptions WHERE id = ?",
    args: ["asm-live-1"],
  });
  assert(
    liveAsmUpdated.rows[0].status === "testing",
    `Linked assumption transitioned to testing after successful live generation (actual: "${liveAsmUpdated.rows[0].status}")`
  );

  // ── Suite 7: Timeout and Malformed Response Protection ──
  console.log("\nSuite 7: Timeout and Malformed Response Protection on LIVE Project");

  // Create another live assumption to test timeout
  await testDb.execute({
    sql: "INSERT INTO assumptions (id, project_id, statement, category, impact, uncertainty, status, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "asm-live-2",
      "proj-live-exp-test",
      "Students prefer evening delivery slots between 5pm and 8pm",
      "desirability",
      "Medium",
      "High",
      "unvalidated",
      "USER_INPUT",
      "2026-10-26T00:00:00Z",
    ],
  });

  // Test 7A: Timeout error
  globalThis.fetch = async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    return Promise.reject(abortErr);
  };

  const timeoutReq = new NextRequest("http://localhost:3000/api/projects/proj-live-exp-test/experiments/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptionId: "asm-live-2" }),
  });
  const timeoutRes = await generateExperiment(timeoutReq, { params: Promise.resolve({ id: "proj-live-exp-test" }) });
  assert(timeoutRes.status === 503, `LIVE experiment generate returns HTTP 503 on timeout (got ${timeoutRes.status})`);
  const timeoutJson = await timeoutRes.json();
  assert(timeoutJson.error?.code === "INFERENCE_FAILED", `Timeout returns INFERENCE_FAILED (got ${timeoutJson.error?.code})`);

  // Test 7B: Malformed JSON response
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ response: "not valid json {{{..." }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const malformedReq = new NextRequest("http://localhost:3000/api/projects/proj-live-exp-test/experiments/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptionId: "asm-live-2" }),
  });
  const malformedRes = await generateExperiment(malformedReq, { params: Promise.resolve({ id: "proj-live-exp-test" }) });
  assert(malformedRes.status === 503, `LIVE experiment generate returns HTTP 503 on malformed response (got ${malformedRes.status})`);
  const malformedJson = await malformedRes.json();
  assert(malformedJson.error?.code === "INFERENCE_FAILED", `Malformed response returns INFERENCE_FAILED (got ${malformedJson.error?.code})`);

  // Verify asm-live-2 remains unvalidated and zero new experiments were written
  const asm2Check = await testDb.execute({
    sql: "SELECT status FROM assumptions WHERE id = ?",
    args: ["asm-live-2"],
  });
  assert(asm2Check.rows[0].status === "unvalidated", "Assumption asm-live-2 remains unvalidated after timeout and malformed failures");

  const totalLiveExp = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM experiments WHERE project_id = ?",
    args: ["proj-live-exp-test"],
  });
  assert(Number(totalLiveExp.rows[0].cnt) === 1, `Still exactly 1 experiment in LIVE project (no leaked failure records) (actual: ${totalLiveExp.rows[0].cnt})`);

  // Restore fetch and cleanup isolated DB
  globalThis.fetch = originalFetch;
  delete process.env.IDEAPROBE_DB_PATH;
  resetDbClient();
  try {
    fs.unlinkSync(tempDbPath);
  } catch {}

  // ── Suite 8: Final Production Database Invariance Check ──
  console.log("\nSuite 8: Final Production Database Invariance Check");
  const postSnapshots = await prodClient.execute("SELECT COUNT(*) as cnt FROM report_snapshots");
  const postExperiments = await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments");
  const postAssumptions = await prodClient.execute("SELECT COUNT(*) as cnt FROM assumptions");
  const postProjects = await prodClient.execute("SELECT COUNT(*) as cnt FROM projects");

  assert(
    Number(postSnapshots.rows[0].cnt) === baselineSnapshots,
    `Production report snapshots invariant: ${baselineSnapshots} === ${Number(postSnapshots.rows[0].cnt)}`
  );
  assert(
    Number(postExperiments.rows[0].cnt) === baselineExperiments,
    `Production experiments invariant: ${baselineExperiments} === ${Number(postExperiments.rows[0].cnt)}`
  );
  assert(
    Number(postAssumptions.rows[0].cnt) === baselineAssumptions,
    `Production assumptions invariant: ${baselineAssumptions} === ${Number(postAssumptions.rows[0].cnt)}`
  );
  assert(
    Number(postProjects.rows[0].cnt) === baselineProjects,
    `Production projects invariant: ${baselineProjects} === ${Number(postProjects.rows[0].cnt)}`
  );

  const targetExp = await prodClient.execute({
    sql: "SELECT id, status, result, provenance FROM experiments WHERE id = 'exp-mvoxna2d-b1yt'",
    args: [],
  });
  assert(
    targetExp.rows.length === 1 &&
      targetExp.rows[0].status === "planned" &&
      targetExp.rows[0].result === null,
    "Target experiment exp-mvoxna2d-b1yt remains planned with null result in production DB"
  );

  const targetAsm = await prodClient.execute({
    sql: "SELECT id, status FROM assumptions WHERE id = 'asm-mvoxna1k-frgs'",
    args: [],
  });
  assert(
    targetAsm.rows.length === 1 && targetAsm.rows[0].status === "unvalidated",
    "Target assumption asm-mvoxna1k-frgs remains unvalidated in production DB"
  );

  console.log("\n==========================================================================");
  console.log(`Phase 3H Test Results: ${passed} passed, ${failed} failed`);
  console.log("==========================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
