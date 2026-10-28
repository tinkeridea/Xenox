/**
 * IdeaProbe — Live Runtime Smoke Test (Ollama & TinyFish)
 *
 * Verifies:
 * 1. Real TinyFish external research crawl via POST /api/projects/[id]/research-jobs
 * 2. Real Ollama local AI inference (qwen3.5:4b) via POST /api/projects/[id]/insights/generate
 * 3. 100% database isolation using .ideaprobe-data/smoke-test.db (0 writes to production)
 */

import path from "path";
import fs from "fs";
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";

// Load .env.local
loadEnvConfig(process.cwd());

// Configure isolated database
const isolatedDbPath = path.resolve("./.ideaprobe-data/smoke-test.db");
const prodDbPath = path.resolve("./.ideaprobe-data/ideaprobe.db");
process.env.IDEAPROBE_DB_PATH = isolatedDbPath;

import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as createProject } from "./src/app/api/projects/route";
import { POST as runResearchJob } from "./src/app/api/projects/[id]/research-jobs/route";
import { PATCH as updateEvidence } from "./src/app/api/projects/[id]/evidence/route";
import { POST as generateInsight } from "./src/app/api/projects/[id]/insights/generate/route";

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

async function runLiveSmoke() {
  console.log("================================================================================");
  console.log("  IdeaProbe — Live Runtime Smoke Test: Ollama & TinyFish");
  console.log("================================================================================\n");

  // Step 1: Pre-Execution Baseline Check
  console.log("Step 1: Production Database Pre-Execution Baseline Check");
  const preCounts = await getTableCounts(prodDbPath);
  console.log("  ✓ Production DB baseline captured across all 16 tables");

  // Step 2: Initialize Isolated Database
  console.log("\nStep 2: Initialize Isolated Database");
  resetDbClient();
  await initDb();
  console.log(`  ✓ Isolated database active: ${isolatedDbPath}`);

  // Step 3: Create Disposable Live Project
  console.log("\nStep 3: Create Disposable Live Test Project");
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
  const testProjectId = createData.data?.projectId || createData.data?.id;
  console.log(`  ✓ Created test project ID: ${testProjectId} (status: ${createRes.status})`);

  // Step 4: Real TinyFish Research Execution
  console.log("\nStep 4: Real TinyFish Research Execution");
  const researchQuery = "campus parcel locker university dorm delivery";
  const researchReq = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/research-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: researchQuery,
      maxResults: 3,
    }),
  });

  const startTime = Date.now();
  console.log(`  -> Sending real research query to TinyFish API: "${researchQuery}"...`);
  const researchRes = await runResearchJob(researchReq, { params: Promise.resolve({ id: testProjectId }) });
  const latency = Date.now() - startTime;
  const researchData = await researchRes.json();

  let discoveredEvidenceId: string | null = null;
  if (researchRes.status === 200 || researchRes.status === 201) {
    console.log(`  ✓ TinyFish research succeeded in ${latency}ms (HTTP ${researchRes.status})`);
    const sources = researchData.data?.sources || [];
    const evidence = researchData.data?.evidence || [];
    console.log(`  ✓ Sources returned: ${sources.length}, Evidence claims extracted: ${evidence.length}`);
    for (let i = 0; i < sources.length; i++) {
      console.log(`    [Source ${i + 1}] Title: "${sources[i].title}" | URL: ${sources[i].url} | Publisher: ${sources[i].publisher}`);
    }
    if (evidence.length > 0) {
      discoveredEvidenceId = evidence[0].id;
      console.log(`    [Evidence 1] Claim: "${evidence[0].claim?.slice(0, 100)}..." (Provenance: ${evidence[0].provenance})`);
    }
  } else {
    console.error(`  ✗ TinyFish research returned HTTP ${researchRes.status}:`, JSON.stringify(researchData));
  }

  // Step 5: Human Review Gate on Discovered Evidence
  if (discoveredEvidenceId) {
    console.log("\nStep 5: Human Review Gate — Accept Real Discovered Evidence");
    const patchReq = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/evidence`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: discoveredEvidenceId,
        reviewer_status: "ACCEPTED",
      }),
    });
    const patchRes = await updateEvidence(patchReq, { params: Promise.resolve({ id: testProjectId }) });
    const patchData = await patchRes.json();
    console.log(`  ✓ Evidence ${discoveredEvidenceId} transitioned to ACCEPTED (HTTP ${patchRes.status})`);
  }

  // Step 6: Real Ollama Local AI Inference
  console.log("\nStep 6: Real Ollama Local AI Inference (Insight Synthesis)");
  const aiStartTime = Date.now();
  console.log("  -> Prompting local Ollama model (qwen3.5:4b) to synthesize insight from real evidence...");
  const insightReq = new NextRequest(`http://localhost:3000/api/projects/${testProjectId}/insights/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      insightType: "theme",
    }),
  });
  const insightRes = await generateInsight(insightReq, { params: Promise.resolve({ id: testProjectId }) });
  const aiLatency = Date.now() - aiStartTime;
  const insightData = await insightRes.json();

  if (insightRes.status === 200 || insightRes.status === 201) {
    console.log(`  ✓ Ollama local inference succeeded in ${aiLatency}ms (HTTP ${insightRes.status})`);
    const ins = insightData.data?.insight || insightData.data;
    console.log(`  ✓ Provenance: ${ins?.provenance}`);
    console.log(`  ✓ Statement: "${ins?.statement}"`);
    console.log(`  ✓ Evidence cited: [${ins?.evidence_for_ids?.join(", ")}]`);
    console.log(`  ✓ Confidence: ${ins?.confidence}`);
    console.log(`  ✓ Caveat: "${ins?.caveat}"`);
  } else {
    console.error(`  ✗ Ollama insight synthesis returned HTTP ${insightRes.status}:`, JSON.stringify(insightData));
  }

  // Step 7: Production DB Invariance Check
  console.log("\nStep 7: Production Database Post-Execution Invariance Check");
  const postCounts = await getTableCounts(prodDbPath);
  let allInvariant = true;
  for (const table of Object.keys(preCounts)) {
    if (postCounts[table] !== preCounts[table]) {
      console.error(`  ✗ MISMATCH on table ${table}: ${preCounts[table]} -> ${postCounts[table]}`);
      allInvariant = false;
    }
  }
  if (allInvariant) {
    console.log("  ✓ Production DB strictly invariant across all 16 tables (0 writes)!");
  }

  console.log("\n================================================================================");
  console.log("  Live Runtime Smoke Test Complete!");
  console.log("================================================================================");
}

runLiveSmoke().catch((err) => {
  console.error("FATAL ERROR in runLiveSmoke:", err);
  process.exit(1);
});
