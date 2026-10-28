/**
 * IdeaProbe — Phase 3F Verification Suite: LIVE-Mode Fallback Isolation
 *
 * Verifies:
 * 1. LIVE competitor generation with Ollama unavailable returns HTTP 503 INFERENCE_FAILED.
 * 2. LIVE persona generation with Ollama unavailable returns HTTP 503 INFERENCE_FAILED.
 * 3. Both failures produce zero database writes.
 * 4. DEMO fallbacks still work and retain SAMPLE provenance when Ollama is unavailable.
 * 5. Successful LIVE inference still works and saves AI_INFERENCE provenance.
 * 6. No exam-prep fallback records leak into LIVE projects.
 * 7. Production SQLite database strictly invariant (zero writes).
 */

import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as analyzeCompetitor } from "./src/app/api/projects/[id]/competitors/analyze/route";
import { POST as generatePersona } from "./src/app/api/projects/[id]/personas/generate/route";

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
  console.log("IdeaProbe — Phase 3F: LIVE-Mode Fallback Isolation Test Suite");
  console.log("==========================================================================\n");

  const originalFetch = globalThis.fetch;
  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const scratchDir = path.resolve(__dirname, ".ideaprobe-data");
  const tempDbPath = path.resolve(scratchDir, "test-phase3f-isolated.db");

  // Clean up any old temp test database
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  // ── Baseline check of production database ──
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  const prodClient = createClient({ url: `file:${prodDbPath.replace(/\\/g, "/")}` });
  const preSnapshots = await prodClient.execute("SELECT COUNT(*) as cnt FROM report_snapshots");
  const preExperiments = await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments");
  const preAssumptions = await prodClient.execute("SELECT COUNT(*) as cnt FROM assumptions");
  const preCompetitors = await prodClient.execute("SELECT COUNT(*) as cnt FROM competitors");
  const prePersonas = await prodClient.execute("SELECT COUNT(*) as cnt FROM personas");
  const preProjects = await prodClient.execute("SELECT COUNT(*) as cnt FROM projects");

  const baselineSnapshots = Number(preSnapshots.rows[0].cnt);
  const baselineExperiments = Number(preExperiments.rows[0].cnt);
  const baselineAssumptions = Number(preAssumptions.rows[0].cnt);
  const baselineCompetitors = Number(preCompetitors.rows[0].cnt);
  const baselinePersonas = Number(prePersonas.rows[0].cnt);
  const baselineProjects = Number(preProjects.rows[0].cnt);

  assert(baselineSnapshots === 230, `Production report snapshots baseline is 230 (actual: ${baselineSnapshots})`);
  assert(baselineExperiments === 3, `Production experiments baseline is 3 (actual: ${baselineExperiments})`);
  assert(baselineAssumptions === 5, `Production assumptions baseline is 5 (actual: ${baselineAssumptions})`);
  assert(baselineProjects === 6, `Production projects baseline is 6 (actual: ${baselineProjects})`);

  // ── Suite 2: Static Code Structure Audit ──
  console.log("\nSuite 2: Static Code Structure Audit for Route Handlers");
  const compRouteSrc = fs.readFileSync(
    path.join(__dirname, "src/app/api/projects/[id]/competitors/analyze/route.ts"),
    "utf-8"
  );
  const personaRouteSrc = fs.readFileSync(
    path.join(__dirname, "src/app/api/projects/[id]/personas/generate/route.ts"),
    "utf-8"
  );

  assert(
    compRouteSrc.includes("isAiInference"),
    "competitors/analyze imports and calls isAiInference"
  );
  assert(
    compRouteSrc.includes("isDemoProject"),
    "competitors/analyze checks isDemoProject"
  );
  assert(
    compRouteSrc.includes("INFERENCE_FAILED") && compRouteSrc.includes("503"),
    "competitors/analyze returns HTTP 503 INFERENCE_FAILED on live failure"
  );
  assert(
    compRouteSrc.includes("!isDemoProject && !isLive"),
    "competitors/analyze guards database insert for live projects when offline"
  );

  assert(
    personaRouteSrc.includes("isAiInference"),
    "personas/generate imports and calls isAiInference"
  );
  assert(
    personaRouteSrc.includes("isDemoProject"),
    "personas/generate checks isDemoProject"
  );
  assert(
    personaRouteSrc.includes("INFERENCE_FAILED") && personaRouteSrc.includes("503"),
    "personas/generate returns HTTP 503 INFERENCE_FAILED on live failure"
  );
  assert(
    personaRouteSrc.includes("!isDemoProject && !isLive"),
    "personas/generate guards database insert for live projects when offline"
  );

  // ── Setup Isolated Test Database ──
  console.log("\nSuite 3: Isolated Database Environment Setup");
  process.env.IDEAPROBE_DB_PATH = tempDbPath;
  resetDbClient();
  await initDb();
  const testDb = getDb();

  // Create LIVE test project
  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: ["proj-live-test", "CampusCourier Campus Logistics", "LIVE", "active", new Date().toISOString(), new Date().toISOString()],
  });
  await testDb.execute({
    sql: "INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "brief-live-1",
      "proj-live-test",
      1,
      "Hostel students have to walk 15 minutes to main gate to collect parcel deliveries",
      "Hostel resident university students in Blocks C & D",
      "Peer-to-peer concierge WhatsApp delivery network for campus parcels",
      "logistics",
      new Date().toISOString(),
    ],
  });

  // Create DEMO test project
  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: ["proj-demo-test", "Exam Study Planner", "DEMO", "active", new Date().toISOString(), new Date().toISOString()],
  });
  await testDb.execute({
    sql: "INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "brief-demo-1",
      "proj-demo-test",
      1,
      "Students preparing for multi-track exams struggle with rigid timetables",
      "Undergraduate students with overlapping competitive exams",
      "Adaptive study planner that reschedules automatically",
      "edtech",
      new Date().toISOString(),
    ],
  });

  assert(true, "Isolated test database initialized with LIVE and DEMO test projects");

  // ── Suite 4: Ollama Unavailable Mode (Fail-Fast on LIVE, Zero DB Writes) ──
  console.log("\nSuite 4: Ollama Unavailable Mode — LIVE Projects Fail-Fast & Zero DB Writes");

  // Mock globalThis.fetch so Ollama is simulated completely unreachable
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("11434")) {
      // Return 500 or throw network error
      return new Response(JSON.stringify({ error: "Connection refused" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  // 1. LIVE competitor generation with Ollama unavailable returns 503
  const liveCompReq = new NextRequest("http://localhost:3000/api/projects/proj-live-test/competitors/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "status_quo" }),
  });
  const liveCompRes = await analyzeCompetitor(liveCompReq, { params: Promise.resolve({ id: "proj-live-test" }) });
  assert(liveCompRes.status === 503, `LIVE competitor analyze returns HTTP 503 when Ollama unavailable (got ${liveCompRes.status})`);

  const liveCompData = await liveCompRes.json();
  assert(liveCompData.error?.code === "INFERENCE_FAILED", `Error code is INFERENCE_FAILED (got ${liveCompData.error?.code})`);
  assert(liveCompData.error?.retryable === true, "Error payload marks retryable as true");
  assert(
    typeof liveCompData.error?.message === "string" && liveCompData.error.message.includes("Start Ollama and retry"),
    `Error message contains helpful retry instructions: "${liveCompData.error?.message}"`
  );

  // 2. LIVE persona generation with Ollama unavailable returns 503
  const livePersonaReq = new NextRequest("http://localhost:3000/api/projects/proj-live-test/personas/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const livePersonaRes = await generatePersona(livePersonaReq, { params: Promise.resolve({ id: "proj-live-test" }) });
  assert(livePersonaRes.status === 503, `LIVE persona generate returns HTTP 503 when Ollama unavailable (got ${livePersonaRes.status})`);

  const livePersonaData = await livePersonaRes.json();
  assert(livePersonaData.error?.code === "INFERENCE_FAILED", `Error code is INFERENCE_FAILED (got ${livePersonaData.error?.code})`);
  assert(livePersonaData.error?.retryable === true, "Error payload marks retryable as true");
  assert(
    typeof livePersonaData.error?.message === "string" && livePersonaData.error.message.includes("Start Ollama and retry"),
    `Error message contains helpful retry instructions: "${livePersonaData.error?.message}"`
  );

  // 3. Both failures produce zero database writes
  const liveCompsInDb = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM competitors WHERE project_id = ?",
    args: ["proj-live-test"],
  });
  const livePersonasInDb = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM personas WHERE project_id = ?",
    args: ["proj-live-test"],
  });
  assert(Number(liveCompsInDb.rows[0].cnt) === 0, `Zero competitors written to LIVE project (actual: ${liveCompsInDb.rows[0].cnt})`);
  assert(Number(livePersonasInDb.rows[0].cnt) === 0, `Zero personas written to LIVE project (actual: ${livePersonasInDb.rows[0].cnt})`);

  // ── Suite 5: DEMO Fallbacks Work and Retain SAMPLE Provenance ──
  console.log("\nSuite 5: DEMO Fallback Mode — DEMO Projects Retain SAMPLE Fallbacks");

  // DEMO competitor analyze
  const demoCompReq = new NextRequest("http://localhost:3000/api/projects/proj-demo-test/competitors/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "status_quo" }),
  });
  const demoCompRes = await analyzeCompetitor(demoCompReq, { params: Promise.resolve({ id: "proj-demo-test" }) });
  assert(demoCompRes.status === 200, `DEMO competitor analyze returns HTTP 200 when Ollama unavailable (got ${demoCompRes.status})`);

  const demoCompData = await demoCompRes.json();
  assert(
    demoCompData.data?.competitor?.provenance === "SAMPLE",
    `DEMO competitor retains SAMPLE provenance (got ${demoCompData.data?.competitor?.provenance})`
  );
  assert(
    demoCompData.data?.inference?.provenance === "SAMPLE",
    `DEMO inference meta reports SAMPLE provenance (got ${demoCompData.data?.inference?.provenance})`
  );

  // Verify competitor written to DB for DEMO project with SAMPLE provenance
  const demoCompsInDb = await testDb.execute({
    sql: "SELECT name, provenance FROM competitors WHERE project_id = ?",
    args: ["proj-demo-test"],
  });
  assert(demoCompsInDb.rows.length === 1, `Exactly 1 competitor written to DEMO project (actual: ${demoCompsInDb.rows.length})`);
  assert(
    demoCompsInDb.rows[0]?.provenance === "SAMPLE",
    `DEMO competitor in database has SAMPLE provenance (got ${demoCompsInDb.rows[0]?.provenance})`
  );

  // DEMO persona generate
  const demoPersonaReq = new NextRequest("http://localhost:3000/api/projects/proj-demo-test/personas/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const demoPersonaRes = await generatePersona(demoPersonaReq, { params: Promise.resolve({ id: "proj-demo-test" }) });
  assert(demoPersonaRes.status === 200, `DEMO persona generate returns HTTP 200 when Ollama unavailable (got ${demoPersonaRes.status})`);

  const demoPersonaData = await demoPersonaRes.json();
  assert(
    demoPersonaData.data?.persona?.provenance === "SAMPLE",
    `DEMO persona retains SAMPLE provenance (got ${demoPersonaData.data?.persona?.provenance})`
  );

  // Verify persona written to DB for DEMO project with SAMPLE provenance
  const demoPersonasInDb = await testDb.execute({
    sql: "SELECT name, provenance FROM personas WHERE project_id = ?",
    args: ["proj-demo-test"],
  });
  assert(demoPersonasInDb.rows.length === 1, `Exactly 1 persona written to DEMO project (actual: ${demoPersonasInDb.rows.length})`);
  assert(
    demoPersonasInDb.rows[0]?.provenance === "SAMPLE",
    `DEMO persona in database has SAMPLE provenance (got ${demoPersonasInDb.rows[0]?.provenance})`
  );

  // ── Suite 6: Successful LIVE Inference Works & Tags AI_INFERENCE ──
  console.log("\nSuite 6: Live Inference Mode — LIVE Projects Succeed & Tag AI_INFERENCE");

  // Mock globalThis.fetch to simulate healthy Ollama with valid structured JSON responses
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
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const prompt = body.prompt || "";

      if (prompt.includes("competitor-analysis") || prompt.includes("competitor category")) {
        const liveCompetitor = {
          name: "Gate Runner WhatsApp Informal Network",
          category: "substitute",
          description: "Informal batches of hostel friends take turns walking to the gate for each other.",
          differentiation: "CampusCourier provides reliable guaranteed peer delivery windows with accountability.",
          source_ids: [],
          confidence: "medium",
          caveat: "Inferred from campus operational layout; requires customer interview verification.",
        };
        return new Response(
          JSON.stringify({ response: JSON.stringify(liveCompetitor) }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (prompt.includes("persona hypothesis") || prompt.includes("segment persona")) {
        const livePersona = {
          name: "Exam-Season Hostel Resident",
          segment: "Final-year engineering students staying in Block C during semester project deadlines",
          context: "Studying 10+ hours a day in their rooms with strict deadlines, ordering groceries and books online.",
          jobs: ["Receive urgent course materials without interrupting study sessions", "Avoid wasting 30 minutes trekking to campus gate"],
          pains: ["Gate security holds packages; delivery boys not permitted inside hostels", "Lost study flow during midday deliveries"],
          goals: ["Get parcels delivered directly to hostel room door", "Pay small fee rather than walk in hot sun"],
          behaviors: ["Orders 2-3 parcels a week", "Pays via UPI instantly"],
          constraints: ["Budget: <= ₹40 per delivery", "Must arrive within 30 minutes of gate notification"],
          objections: ["Will a peer runner safely handle fragile electronics?", "What if the runner takes too long?"],
          evidence_ids: [],
          assumptions: ["ASSUMPTION: Students are willing to pay ₹30-₹50 per delivery — unvalidated"],
        };
        return new Response(
          JSON.stringify({ response: JSON.stringify(livePersona) }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return originalFetch(input, init);
  };

  // Call LIVE competitor analyze with healthy Ollama
  const liveCompSuccessReq = new NextRequest("http://localhost:3000/api/projects/proj-live-test/competitors/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "substitute" }),
  });
  const liveCompSuccessRes = await analyzeCompetitor(liveCompSuccessReq, { params: Promise.resolve({ id: "proj-live-test" }) });
  assert(liveCompSuccessRes.status === 200, `LIVE competitor analyze returns HTTP 200 when Ollama is healthy (got ${liveCompSuccessRes.status})`);

  const liveCompSuccessData = await liveCompSuccessRes.json();
  assert(
    liveCompSuccessData.data?.competitor?.name === "Gate Runner WhatsApp Informal Network",
    `LIVE competitor name matches generated entity (got "${liveCompSuccessData.data?.competitor?.name}")`
  );
  assert(
    liveCompSuccessData.data?.competitor?.provenance === "AI_INFERENCE",
    `LIVE competitor provenance is AI_INFERENCE (got "${liveCompSuccessData.data?.competitor?.provenance}")`
  );

  // Call LIVE persona generate with healthy Ollama
  const livePersonaSuccessReq = new NextRequest("http://localhost:3000/api/projects/proj-live-test/personas/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const livePersonaSuccessRes = await generatePersona(livePersonaSuccessReq, { params: Promise.resolve({ id: "proj-live-test" }) });
  assert(livePersonaSuccessRes.status === 200, `LIVE persona generate returns HTTP 200 when Ollama is healthy (got ${livePersonaSuccessRes.status})`);

  const livePersonaSuccessData = await livePersonaSuccessRes.json();
  assert(
    livePersonaSuccessData.data?.persona?.name === "Exam-Season Hostel Resident",
    `LIVE persona name matches generated entity (got "${livePersonaSuccessData.data?.persona?.name}")`
  );
  assert(
    livePersonaSuccessData.data?.persona?.provenance === "AI_INFERENCE",
    `LIVE persona provenance is AI_INFERENCE (got "${livePersonaSuccessData.data?.persona?.provenance}")`
  );

  // ── Suite 7: Leakage Quarantine Verification on LIVE Project ──
  console.log("\nSuite 7: Leakage Quarantine Verification on LIVE Project");

  const liveCompsAfterAll = await testDb.execute({
    sql: "SELECT name, category, provenance FROM competitors WHERE project_id = ?",
    args: ["proj-live-test"],
  });
  assert(liveCompsAfterAll.rows.length === 1, `LIVE project has exactly 1 competitor (actual: ${liveCompsAfterAll.rows.length})`);
  assert(
    liveCompsAfterAll.rows[0].name === "Gate Runner WhatsApp Informal Network",
    `LIVE competitor is the generated logistics competitor, not exam prep`
  );
  assert(
    !liveCompsAfterAll.rows.some((r) => String(r.name).includes("Study Timetable") || String(r.name).includes("Google Calendar")),
    "Zero exam-prep fallback competitors in LIVE project"
  );

  const livePersonasAfterAll = await testDb.execute({
    sql: "SELECT name, segment, provenance FROM personas WHERE project_id = ?",
    args: ["proj-live-test"],
  });
  assert(livePersonasAfterAll.rows.length === 1, `LIVE project has exactly 1 persona (actual: ${livePersonasAfterAll.rows.length})`);
  assert(
    livePersonasAfterAll.rows[0].name === "Exam-Season Hostel Resident",
    `LIVE persona is the generated logistics resident, not Dual-Track Exam Student`
  );
  assert(
    !livePersonasAfterAll.rows.some((r) => String(r.name).includes("Dual-Track") || String(r.segment).includes("CA Foundation")),
    "Zero exam-prep fallback personas in LIVE project"
  );

  // Restore fetch
  globalThis.fetch = originalFetch;

  // ── Suite 8: Final Production Database Invariance Check ──
  console.log("\nSuite 8: Final Production Database Invariance Check");
  const postSnapshots = await prodClient.execute("SELECT COUNT(*) as cnt FROM report_snapshots");
  const postExperiments = await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments");
  const postAssumptions = await prodClient.execute("SELECT COUNT(*) as cnt FROM assumptions");
  const postCompetitors = await prodClient.execute("SELECT COUNT(*) as cnt FROM competitors");
  const postPersonas = await prodClient.execute("SELECT COUNT(*) as cnt FROM personas");
  const postProjects = await prodClient.execute("SELECT COUNT(*) as cnt FROM projects");

  assert(
    Number(postSnapshots.rows[0].cnt) === baselineSnapshots,
    `Production report snapshots invariant: ${postSnapshots.rows[0].cnt} === ${baselineSnapshots}`
  );
  assert(
    Number(postExperiments.rows[0].cnt) === baselineExperiments,
    `Production experiments invariant: ${postExperiments.rows[0].cnt} === ${baselineExperiments}`
  );
  assert(
    Number(postAssumptions.rows[0].cnt) === baselineAssumptions,
    `Production assumptions invariant: ${postAssumptions.rows[0].cnt} === ${baselineAssumptions}`
  );
  assert(
    Number(postCompetitors.rows[0].cnt) === baselineCompetitors,
    `Production competitors invariant: ${postCompetitors.rows[0].cnt} === ${baselineCompetitors}`
  );
  assert(
    Number(postPersonas.rows[0].cnt) === baselinePersonas,
    `Production personas invariant: ${postPersonas.rows[0].cnt} === ${baselinePersonas}`
  );
  assert(
    Number(postProjects.rows[0].cnt) === baselineProjects,
    `Production projects invariant: ${postProjects.rows[0].cnt} === ${baselineProjects}`
  );

  // Target records check
  const expCheck = await prodClient.execute({
    sql: "SELECT id, status, result, provenance FROM experiments WHERE id = 'exp-mvoxna2d-b1yt'",
    args: [],
  });
  assert(
    expCheck.rows.length === 1 && expCheck.rows[0].status === "planned" && expCheck.rows[0].result === null,
    "Target experiment exp-mvoxna2d-b1yt remains planned with null result in production DB"
  );

  const asmCheck = await prodClient.execute({
    sql: "SELECT id, status, provenance FROM assumptions WHERE id = 'asm-mvoxna1k-frgs'",
    args: [],
  });
  assert(
    asmCheck.rows.length === 1 && asmCheck.rows[0].status === "unvalidated",
    "Target assumption asm-mvoxna1k-frgs remains unvalidated in production DB"
  );

  // Clean up isolated test database
  resetDbClient();
  if (fs.existsSync(tempDbPath)) {
    try {
      fs.unlinkSync(tempDbPath);
    } catch {
      // On Windows, the file lock may be held until process exit; ignore
    }
  }

  console.log("\n==========================================================================");
  console.log(`Phase 3F Test Results: ${passed} passed, ${failed} failed`);
  console.log("==========================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
