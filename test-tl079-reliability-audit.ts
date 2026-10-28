/**
 * IdeaProbe — TL-079: Live AI and Research Reliability Gap Audit
 *
 * Comprehensive empirical audit of Ollama and TinyFish failure handling,
 * error responses, retryability, database integrity, provenance safety,
 * duplicate handling, and recovery.
 *
 * Runs 100% against an isolated temporary SQLite database.
 * Protects production database (.ideaprobe-data/ideaprobe.db) with 0 writes.
 */

import path from "path";
import fs from "fs";
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";

// Load environment variables
loadEnvConfig(process.cwd());

// Configure isolated database
const isolatedDbPath = path.resolve("./.ideaprobe-data/test-tl079-isolated.db");
const prodDbPath = path.resolve("./.ideaprobe-data/ideaprobe.db");
process.env.IDEAPROBE_DB_PATH = isolatedDbPath;

import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as createProject } from "./src/app/api/projects/route";
import { POST as generatePersona } from "./src/app/api/projects/[id]/personas/generate/route";
import { POST as personaChat } from "./src/app/api/personas/[id]/chat/route";
import { POST as generateInsight } from "./src/app/api/projects/[id]/insights/generate/route";
import { POST as generateExperiment } from "./src/app/api/projects/[id]/experiments/generate/route";
import { POST as analyzeCompetitor } from "./src/app/api/projects/[id]/competitors/analyze/route";
import { POST as runResearchJob } from "./src/app/api/projects/[id]/research-jobs/route";
import { PATCH as updateEvidence } from "./src/app/api/projects/[id]/evidence/route";
import { POST as createEvidence } from "./src/app/api/projects/[id]/evidence/route";
import { POST as createSource } from "./src/app/api/projects/[id]/sources/route";
import { POST as createAssumption } from "./src/app/api/projects/[id]/assumptions/route";
import { searchTinyFish, checkTinyFishHealth } from "./src/lib/tinyfish";
import { checkOllamaHealth } from "./src/lib/ollama";

let passed = 0;
let failed = 0;
const auditFindings: string[] = [];

function assert(condition: boolean, message: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}${detail ? ` (${detail})` : ""}`);
  }
}

async function getTableCounts(dbPath: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const counts: Record<string, number> = {};
  for (const row of tables.rows) {
    const tableName = row.name as string;
    const countRes = await client.execute(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
    counts[tableName] = Number(countRes.rows[0].cnt);
  }
  return counts;
}

const originalFetch = globalThis.fetch;

async function runAudit() {
  console.log("================================================================================");
  console.log("  IdeaProbe — TL-079: Live AI and Research Reliability Gap Audit");
  console.log("================================================================================\n");

  // Clean old isolated DB if exists
  if (fs.existsSync(isolatedDbPath)) {
    try { fs.unlinkSync(isolatedDbPath); } catch {}
  }

  // Suite 1: Production DB Pre-Execution Baseline
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  const preCounts = await getTableCounts(prodDbPath);
  console.log("  Production table counts baseline:");
  for (const [t, c] of Object.entries(preCounts)) {
    console.log(`    ${t}: ${c}`);
  }
  assert(preCounts.projects === 7, "Production baseline projects count is 7");
  assert(preCounts.report_snapshots === 231, "Production baseline report_snapshots count is 231");

  // Suite 2: Isolated DB Setup & Live Project Creation
  console.log("\nSuite 2: Isolated Database Environment Setup");
  resetDbClient();
  await initDb();
  const testDb = getDb();
  console.log(`  ✓ Isolated database active: ${isolatedDbPath}`);

  // Create LIVE test project
  const createReq = new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "CampusLocker — Intelligent Dorm Delivery Hub",
      problem: "Hostel students miss deliveries because gate security hours do not match class schedules.",
      target_customer: "College students living in university dorms",
      solution: "Smart locker bank placed inside residential hall lobbies with PIN code retrieval.",
      geography: "India",
      category: "Logistics",
    }),
  });
  const createRes = await createProject(createReq);
  const createData = await createRes.json();
  const liveProjId = createData.data?.projectId || createData.data?.id;
  assert(createRes.status === 201, `Created LIVE test project: ${liveProjId}`);

  // Create DEMO test project
  const createDemoReq = new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Demo Planner App",
      problem: "Exam students struggle to schedule study sessions.",
      target_customer: "Students",
      solution: "Planner app",
      mode: "DEMO",
    }),
  });
  const createDemoRes = await createProject(createDemoReq);
  const demoData = await createDemoRes.json();
  const demoProjId = demoData.data?.projectId || demoData.data?.id;
  assert(createDemoRes.status === 201, `Created DEMO test project: ${demoProjId}`);

  // Register an assumption for liveProjId
  const asmReq = new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      statement: "Hostel residents will pay ₹30 per parcel to pick up from lobby smart lockers.",
      category: "desirability",
      uncertainty: "Critical",
      impact: "High",
    }),
  });
  const asmRes = await createAssumption(asmReq, { params: Promise.resolve({ id: liveProjId }) });
  const asmData = await asmRes.json();
  const asmId = asmData.data?.assumption?.id || asmData.data?.id;
  assert(asmRes.status === 201 && Boolean(asmId), `Registered assumption: ${asmId}`);

  // Add 1 Accepted Evidence item for liveProjId so insight synthesis gate passes
  const srcRes = await createSource(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://www.parcelpending.com/blog/package-lockers-for-dorm-life/",
        title: "Package Lockers for Dorm Life",
        publisher: "Parcel Pending",
        source_type: "web",
      }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const srcData = await srcRes.json();
  const srcId = srcData.data?.source?.id || srcData.data?.id;

  const evRes = await createEvidence(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_id: srcId,
        claim: "Smart lockers in dorm lobbies reduce missed deliveries by up to 85%.",
        excerpt: "Universities implementing parcel lockers report 85% fewer package handling complaints.",
        confidence: "High",
      }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const evData = await evRes.json();
  const evId = evData.data?.evidence?.id || evData.data?.id;

  // Accept the evidence under human review gate
  const patchEvRes = await updateEvidence(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/evidence`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: evId,
        reviewer_status: "ACCEPTED",
      }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  assert(patchEvRes.status === 200, "Created and accepted real evidence item for live project");

  // ===========================================================================
  // SECTION A: OLLAMA RELIABILITY AUDIT
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("  SECTION A: OLLAMA RELIABILITY AUDIT");
  console.log("================================================================================");

  // Scenario 1: Successful Real Inference using configured qwen3.5:4b model
  console.log("\n--- Scenario A1: Genuine Live Inference (qwen3.5:4b) ---");
  const healthCheck = await checkOllamaHealth();
  console.log(`  Ollama health probe status: ${healthCheck.status}, model: ${healthCheck.targetModel}, latency: ${healthCheck.latencyMs}ms`);
  assert(healthCheck.status === "ready", "Ollama daemon is running and target model is ready");

  const livePersonaRes = await generatePersona(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/personas/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const livePersonaData = await livePersonaRes.json();
  assert(livePersonaRes.status === 200, `Live persona generation returned HTTP 200 (got ${livePersonaRes.status})`);
  assert(
    livePersonaData.data?.persona?.provenance === "AI_INFERENCE" || livePersonaData.meta?.provenance === "AI_INFERENCE",
    "Live persona generation carries AI_INFERENCE provenance"
  );
  const generatedPersonaId = livePersonaData.data?.persona?.id || livePersonaData.data?.id;

  // Scenario 2: Ollama Unavailable or Connection Refused (ECONNREFUSED)
  console.log("\n--- Scenario A2: Ollama Unavailable / Connection Refused ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("11434") || String(url).includes("/api/generate") || String(url).includes("/api/tags")) {
      const err = new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
      (err as any).code = "ECONNREFUSED";
      throw err;
    }
    return originalFetch(url, opts);
  };

  // A2.1 Persona generation
  const offPersonaRes = await generatePersona(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/personas/generate`, { method: "POST" }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const offPersonaData = await offPersonaRes.json();
  assert(offPersonaRes.status === 503, `LIVE persona generation returns HTTP 503 when Ollama offline (got ${offPersonaRes.status})`);
  assert(offPersonaData.error?.code === "INFERENCE_FAILED", "Error code is INFERENCE_FAILED");
  assert(offPersonaData.error?.retryable === true, "Persona error marks retryable: true");

  // A2.2 Insight synthesis
  const offInsightRes = await generateInsight(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/insights/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightType: "theme" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const offInsightData = await offInsightRes.json();
  assert(offInsightRes.status === 503, `LIVE insight synthesis returns HTTP 503 when Ollama offline (got ${offInsightRes.status})`);
  assert(offInsightData.error?.code === "INFERENCE_FAILED", "Error code is INFERENCE_FAILED");
  const insightRetryable = offInsightData.error?.retryable;
  console.log(`  [Audit Note] Insight generation error retryable flag is: ${insightRetryable}`);
  if (insightRetryable === false) {
    auditFindings.push("DEFECT: insights/generate returns retryable: false on 503 INFERENCE_FAILED (inconsistent with personas/generate and experiments/generate which return retryable: true)");
  }

  // A2.3 Experiment generation
  const offExpRes = await generateExperiment(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/experiments/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assumptionId: asmId }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const offExpData = await offExpRes.json();
  assert(offExpRes.status === 503, `LIVE experiment generation returns HTTP 503 when Ollama offline (got ${offExpRes.status})`);
  assert(offExpData.error?.code === "INFERENCE_FAILED", "Error code is INFERENCE_FAILED");
  assert(offExpData.error?.retryable === true, "Experiment error marks retryable: true");

  // A2.4 Competitor analysis
  const offCompRes = await analyzeCompetitor(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/competitors/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "direct" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const offCompData = await offCompRes.json();
  assert(offCompRes.status === 503, `LIVE competitor analysis returns HTTP 503 when Ollama offline (got ${offCompRes.status})`);
  assert(offCompData.error?.code === "INFERENCE_FAILED", "Error code is INFERENCE_FAILED");
  assert(offCompData.error?.retryable === true, "Competitor error marks retryable: true");

  // A2.5 Persona chat behavior when Ollama is offline
  if (generatedPersonaId) {
    const offChatRes = await personaChat(
      new NextRequest(`http://localhost:3000/api/personas/${generatedPersonaId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Would you use this locker system?",
          sessionId: "test-offline-session-1",
        }),
      }),
      { params: Promise.resolve({ id: generatedPersonaId }) }
    );
    const offChatData = await offChatRes.json();
    assert(offChatRes.status === 200, `Persona chat returns HTTP 200 with fixture fallback when Ollama is offline (got ${offChatRes.status})`);
    assert(
      String(offChatData.data?.caveat).includes("SIMULATED") || offChatData.data?.inference?.provenance === "SIMULATED",
      "Persona chat reply preserves SIMULATED caveat banner"
    );
  }

  // Scenario 3: Request Timeout (AbortError)
  console.log("\n--- Scenario A3: Request Timeout ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("/api/generate")) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  const timeoutPersonaRes = await generatePersona(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/personas/generate`, { method: "POST" }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  assert(timeoutPersonaRes.status === 503, `Timeout on persona generation returns HTTP 503 (got ${timeoutPersonaRes.status})`);

  const timeoutInsightRes = await generateInsight(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/insights/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightType: "theme" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  assert(timeoutInsightRes.status === 503, `Timeout on insight synthesis returns HTTP 503 (got ${timeoutInsightRes.status})`);

  // Scenario 4: Empty, Malformed, or Unusable Model Output
  console.log("\n--- Scenario A4: Empty, Malformed, or Unusable Model Output ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("/api/generate")) {
      // Return invalid JSON structure that cannot validate against schemas even after repair
      return new Response(JSON.stringify({ response: "NOT VALID JSON AT ALL {unclosed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  const malformedPersonaRes = await generatePersona(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/personas/generate`, { method: "POST" }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  assert(malformedPersonaRes.status === 503, `Malformed output on persona generation returns HTTP 503 (got ${malformedPersonaRes.status})`);

  const malformedInsightRes = await generateInsight(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/insights/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightType: "theme" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  assert(malformedInsightRes.status === 503, `Malformed output on insight synthesis returns HTTP 503 (got ${malformedInsightRes.status})`);

  // Scenario 5: HTTP Errors from Local Inference Service (HTTP 500 from Ollama)
  console.log("\n--- Scenario A5: HTTP Errors from Local Inference Service ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("/api/generate")) {
      return new Response("Internal Server Error: model failed to load", { status: 500 });
    }
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  const http500ExpRes = await generateExperiment(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/experiments/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assumptionId: asmId }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  assert(http500ExpRes.status === 503, `HTTP 500 from Ollama correctly triggers HTTP 503 INFERENCE_FAILED (got ${http500ExpRes.status})`);

  // Scenario 7: Insight Synthesis Failure — No Eligible Evidence Gate
  console.log("\n--- Scenario A7: Insight Synthesis — No Eligible Evidence Gate ---");
  const noEvProjReq = new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Empty Project",
      problem: "No data problem",
      target_customer: "Anyone",
      solution: "Basic solution",
      geography: "Global",
      category: "Software",
    }),
  });
  const noEvProjRes = await createProject(noEvProjReq);
  const noEvProjData = await noEvProjRes.json();
  const emptyProjId = noEvProjData.data?.projectId || noEvProjData.data?.id;

  const noEvInsightRes = await generateInsight(
    new NextRequest(`http://localhost:3000/api/projects/${emptyProjId}/insights/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightType: "theme" }),
    }),
    { params: Promise.resolve({ id: emptyProjId }) }
  );
  const noEvInsightData = await noEvInsightRes.json();
  assert(noEvInsightRes.status === 400, `No eligible evidence returns HTTP 400 (got ${noEvInsightRes.status})`);
  assert(noEvInsightData.error?.code === "NO_ELIGIBLE_EVIDENCE", "Error code is strictly NO_ELIGIBLE_EVIDENCE");

  // Scenario 10: Database Integrity and Zero Misleading Writes after Failures
  console.log("\n--- Scenario A10: Database Integrity & Provenance Protection ---");
  const expCountRes = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM experiments WHERE project_id = ?",
    args: [liveProjId],
  });
  assert(Number(expCountRes.rows[0].cnt) === 0, "Zero experiments written to LIVE project during all Ollama failure tests");

  const asmStatusRes = await testDb.execute({
    sql: "SELECT status FROM assumptions WHERE id = ?",
    args: [asmId],
  });
  assert(
    String(asmStatusRes.rows[0].status) === "unvalidated",
    `Assumption lifecycle status remained 'unvalidated' after failed experiment planning (got ${asmStatusRes.rows[0].status})`
  );

  const insightCountRes = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM insights WHERE project_id = ?",
    args: [liveProjId],
  });
  assert(Number(insightCountRes.rows[0].cnt) === 0, "Zero insights written to LIVE project during all Ollama failure tests");

  // Scenario 11: Recovery after Ollama Becomes Available Again
  console.log("\n--- Scenario A11: Recovery after Ollama Restored ---");
  globalThis.fetch = originalFetch; // Restore real fetch

  const recoveredExpRes = await generateExperiment(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/experiments/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assumptionId: asmId }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const recoveredExpData = await recoveredExpRes.json();
  assert(recoveredExpRes.status === 201, `After Ollama restored, experiment generation succeeds with HTTP 201 (got ${recoveredExpRes.status})`);
  assert(
    recoveredExpData.data?.experiment?.provenance === "AI_INFERENCE" || recoveredExpData.meta?.provenance === "AI_INFERENCE",
    "Recovered experiment carries AI_INFERENCE provenance"
  );

  // ===========================================================================
  // SECTION B: TINYFISH RELIABILITY AUDIT
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("  SECTION B: TINYFISH RELIABILITY AUDIT");
  console.log("================================================================================");

  // Scenario 1: Successful Live External Research with Genuine Source URLs
  console.log("\n--- Scenario B1: Live Research Execution ---");
  const tfHealth = await checkTinyFishHealth();
  console.log(`  TinyFish health probe status: ${tfHealth.status}, enabled: ${tfHealth.enabled}, latency: ${tfHealth.latencyMs}ms`);
  assert(tfHealth.status === "ready", "TinyFish API provider is configured and reachable");

  // We perform exactly 1 genuine live TinyFish search as permitted by instructions
  const liveResearchRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "campus parcel locker university dorm delivery",
        maxResults: 2,
      }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const liveResearchData = await liveResearchRes.json();
  assert(liveResearchRes.status === 201, `Live research returns HTTP 201 (got ${liveResearchRes.status})`);
  const sourcesReturned = liveResearchData.data?.sources || [];
  const evidenceReturned = liveResearchData.data?.evidence || [];
  assert(sourcesReturned.length > 0, `Returned ${sourcesReturned.length} genuine web sources`);
  assert(evidenceReturned.length > 0, `Returned ${evidenceReturned.length} extracted evidence claims`);
  if (sourcesReturned.length > 0) {
    assert(Boolean(sourcesReturned[0].url && sourcesReturned[0].url.startsWith("http")), `Source URL is genuine external HTTP URL: ${sourcesReturned[0].url}`);
    assert(sourcesReturned[0].provider === "tinyfish", "Source provider is 'tinyfish'");
  }
  if (evidenceReturned.length > 0) {
    assert(evidenceReturned[0].provenance === "REAL_SOURCE", "Evidence provenance is strictly REAL_SOURCE");
    assert(evidenceReturned[0].reviewer_status === "UNREVIEWED", "Evidence reviewer status is strictly UNREVIEWED (Human Review Gate)");
  }

  // Scenario 2: Missing or Invalid API Credentials
  console.log("\n--- Scenario B2: Missing / Invalid API Credentials ---");
  const origKey = process.env.TINYFISH_API_KEY;
  delete process.env.TINYFISH_API_KEY;

  const missingKeyRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const missingKeyData = await missingKeyRes.json();
  assert(missingKeyRes.status === 502, `Missing API key returns HTTP 502 TINYFISH_RESEARCH_FAILED (got ${missingKeyRes.status})`);
  assert(missingKeyData.error?.code === "TINYFISH_RESEARCH_FAILED", "Error code is TINYFISH_RESEARCH_FAILED");
  assert(missingKeyData.error?.retryable === true, "Error payload marks retryable: true");
  assert(String(missingKeyData.error?.message).includes("TINYFISH_API_KEY is not configured"), "Error message informs user of missing key");

  // Restore key
  process.env.TINYFISH_API_KEY = origKey;

  // Scenario 3: Connection Failure and Upstream HTTP Errors (500 from TinyFish)
  console.log("\n--- Scenario B3: Connection Failure & Upstream HTTP Errors ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      return new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" });
    }
    return originalFetch(url, opts);
  };

  const upstreamErrRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const upstreamErrData = await upstreamErrRes.json();
  assert(upstreamErrRes.status === 502, `Upstream HTTP 502 returns HTTP 502 (got ${upstreamErrRes.status})`);
  assert(upstreamErrData.error?.code === "TINYFISH_RESEARCH_FAILED", "Error code is TINYFISH_RESEARCH_FAILED");
  assert(upstreamErrData.error?.retryable === true, "Retryable is true on upstream failure");

  // Connection failure (network exception)
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      throw new Error("connect ECONNREFUSED api.search.tinyfish.ai:443");
    }
    return originalFetch(url, opts);
  };

  const connErrRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const connErrData = await connErrRes.json();
  assert(connErrRes.status === 502, `Network connection failure returns HTTP 502 (got ${connErrRes.status})`);
  assert(connErrData.error?.code === "TINYFISH_RESEARCH_FAILED", "Error code is TINYFISH_RESEARCH_FAILED");

  // Scenario 4: Timeout or Empty Results
  console.log("\n--- Scenario B4: Timeout & Empty Results ---");
  // 4a. Timeout (AbortError)
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "AbortError";
      throw err;
    }
    return originalFetch(url, opts);
  };

  const timeoutRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const timeoutData = await timeoutRes.json();
  assert(timeoutRes.status === 502, `Timeout returns HTTP 502 (got ${timeoutRes.status})`);
  assert(String(timeoutData.error?.message).includes("TinyFish search request failed"), "Timeout message indicates request failure");

  // 4b. Empty results returned by search API
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      return new Response(JSON.stringify({ query: "nonexistent query", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, opts);
  };

  const emptyRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "nonexistent obscure term" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const emptyData = await emptyRes.json();
  assert(emptyRes.status === 201, `Empty results returns HTTP 201 with empty lists (got ${emptyRes.status})`);
  assert(emptyData.data?.sourcesCreated === 0, "sourcesCreated is 0");
  assert(emptyData.data?.evidenceCreated === 0, "evidenceCreated is 0");

  // Scenario 5: Malformed Response or Missing Source Title/URL
  console.log("\n--- Scenario B5: Malformed Response / Missing Required Fields ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      // Missing title and snippet (triggers SQLite NOT NULL on title)
      return new Response(JSON.stringify({
        query: "test",
        results: [{ position: 1, site_name: "TestSite", url: "https://example.com/test" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, opts);
  };

  const malformedTfRes = await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );
  const malformedTfData = await malformedTfRes.json();
  console.log(`  [Audit Note] Malformed response (missing title) returned HTTP ${malformedTfRes.status}: ${malformedTfData.error?.code}`);
  if (malformedTfRes.status === 500) {
    auditFindings.push("RELIABILITY GAP: TinyFish results missing 'title' cause SQLite NOT NULL crash, returning unhandled HTTP 500 RESEARCH_JOB_ERROR instead of structured validation error or graceful fallback");
  }

  // Scenario 6: Duplicate URLs and Claims Handling
  console.log("\n--- Scenario B6: Duplicate URLs Handling ---");
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      return new Response(JSON.stringify({
        query: "test",
        results: [{
          position: 1,
          site_name: "DuplicateTestSite",
          title: "Duplicate Test Title",
          snippet: "This is a duplicate test snippet for testing deduplication.",
          url: "https://example.com/duplicate-page-1",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, opts);
  };

  // Run first crawl
  await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "dup test 1" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );

  // Run second crawl with exact same URL
  await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "dup test 2" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );

  const dupSourcesRes = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM sources WHERE project_id = ? AND url = 'https://example.com/duplicate-page-1'",
    args: [liveProjId],
  });
  const dupCount = Number(dupSourcesRes.rows[0].cnt);
  console.log(`  [Audit Note] Duplicate URL 'https://example.com/duplicate-page-1' row count in SQLite: ${dupCount}`);
  if (dupCount > 1) {
    auditFindings.push(`RELIABILITY GAP: TinyFish research-jobs route does not deduplicate sources by (project_id, url); querying twice inserted ${dupCount} duplicate rows in SQLite sources table`);
  }

  // Scenario 8: Failed Research Does NOT Create Fabricated Sources or Claims
  console.log("\n--- Scenario B8: Failed Research Zero-Write Integrity ---");
  const preFailSourcesCount = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM sources WHERE project_id = ?",
    args: [liveProjId],
  });
  const preFailEvidenceCount = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM evidence WHERE project_id = ?",
    args: [liveProjId],
  });

  // Execute failing research job
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      throw new Error("Simulated research failure");
    }
    return originalFetch(url, opts);
  };

  await runResearchJob(
    new NextRequest(`http://localhost:3000/api/projects/${liveProjId}/research-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "failing test query" }),
    }),
    { params: Promise.resolve({ id: liveProjId }) }
  );

  const postFailSourcesCount = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM sources WHERE project_id = ?",
    args: [liveProjId],
  });
  const postFailEvidenceCount = await testDb.execute({
    sql: "SELECT COUNT(*) as cnt FROM evidence WHERE project_id = ?",
    args: [liveProjId],
  });

  assert(
    Number(preFailSourcesCount.rows[0].cnt) === Number(postFailSourcesCount.rows[0].cnt),
    "Zero sources created during failed research job"
  );
  assert(
    Number(preFailEvidenceCount.rows[0].cnt) === Number(postFailEvidenceCount.rows[0].cnt),
    "Zero evidence created during failed research job"
  );

  // Scenario 9: Recovery after Failed Request
  console.log("\n--- Scenario B9: Recovery after Failed Request ---");
  globalThis.fetch = originalFetch; // Restore real fetch

  const recoveredHealth = await checkTinyFishHealth();
  assert(recoveredHealth.status === "ready", "TinyFish health recovers immediately after network mock restored");

  // Suite 16: Production Database Post-Execution Invariance Check
  console.log("\n================================================================================");
  console.log("  Suite 16: Production Database Post-Execution Invariance Check");
  console.log("================================================================================");
  const postCounts = await getTableCounts(prodDbPath);
  let allInvariant = true;
  for (const table of Object.keys(preCounts)) {
    if (postCounts[table] !== preCounts[table]) {
      console.error(`  ✗ MISMATCH on table ${table}: pre=${preCounts[table]}, post=${postCounts[table]}`);
      allInvariant = false;
    }
  }
  assert(allInvariant, "All 16 production tables remain 100% invariant against pre-audit baseline (0 writes to production SQLite DB)");

  console.log("\n================================================================================");
  console.log(`  Audit Execution Complete: ${passed} PASSED, ${failed} FAILED across ${passed + failed} assertions`);
  console.log("================================================================================");
  if (auditFindings.length > 0) {
    console.log("\nDocumented Reliability Gaps & Findings:");
    for (const f of auditFindings) {
      console.log(`  • ${f}`);
    }
  }
}

runAudit()
  .catch((err) => {
    console.error("FATAL AUDIT ERROR:", err);
    process.exit(1);
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    // Clean up temporary isolated database
    if (fs.existsSync(isolatedDbPath)) {
      try { fs.unlinkSync(isolatedDbPath); } catch {}
    }
  });
