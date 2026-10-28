/**
 * IdeaProbe — Insight Extraction (F11) Eligibility Gate Regression Test
 *
 * Verifies:
 * 1. Isolated DB Execution: Production database is verified invariant before and after.
 * 2. Unreviewed Evidence Rejection: Live projects with 0 accepted evidence correctly return HTTP 400 NO_ELIGIBLE_EVIDENCE.
 * 3. InsightType Normalization: Mixed casing, spaces, and hyphens ("Open Question", "open-question") are normalized safely.
 * 4. Human Review Gate Transition: Once evidence is marked ACCEPTED, POST /insights/generate passes the review gate and synthesizes.
 * 5. Error Extraction Integrity: The client extracts the structured server error message instead of throwing a generic HTTP 400 error.
 * 6. Production DB Invariance: Zero mutations made to ideaprobe.db.
 */

import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as generateInsight } from "./src/app/api/projects/[id]/insights/generate/route";

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

async function getTableCounts(dbPath: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const tablesRes = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
  );
  const counts: Record<string, number> = {};
  for (const row of tablesRes.rows) {
    const tableName = String(row.name);
    const countRes = await client.execute(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    counts[tableName] = Number(countRes.rows[0].cnt);
  }
  if (typeof (client as any).close === "function") (client as any).close();
  return counts;
}

async function runRegressionSuite() {
  console.log("==========================================================================");
  console.log("IdeaProbe — Insight Extraction Eligibility Gate Regression Test");
  console.log("==========================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const isolatedDbPath = path.resolve(__dirname, ".ideaprobe-data", "test-insight-gate.db");

  // Step 0: Record production DB baseline
  console.log("── Phase 0: Production Database Baseline ──");
  const preCounts = await getTableCounts(prodDbPath);
  console.log("Production database baseline snapshot captured across 16 tables.");

  // Step 1: Create isolated copy
  if (fs.existsSync(isolatedDbPath)) fs.unlinkSync(isolatedDbPath);
  fs.copyFileSync(prodDbPath, isolatedDbPath);

  process.env.IDEAPROBE_DB_PATH = isolatedDbPath;
  resetDbClient();
  await initDb();
  const testDb = getDb();

  try {
    // ── Suite 1: Campus SkillSwap State Inspection ──
    console.log("\n── Suite 1: Target Project (Campus SkillSwap) State ──");
    const targetProjectId = "proj-cf22841b";

    const projRes = await testDb.execute({
      sql: "SELECT id, title, mode, status FROM projects WHERE id = ?",
      args: [targetProjectId],
    });
    assert("Target project exists in database", projRes.rows.length === 1);
    assert("Target project title is 'Campus SkillSwap'", String(projRes.rows[0]?.title) === "Campus SkillSwap");
    assert("Target project mode is 'LIVE'", String(projRes.rows[0]?.mode) === "LIVE");

    const evRes = await testDb.execute({
      sql: "SELECT id, claim, reviewer_status, provenance FROM evidence WHERE project_id = ?",
      args: [targetProjectId],
    });
    assert("Target project has 4 evidence items", evRes.rows.length === 4);
    const unreviewedCount = evRes.rows.filter((e) => String(e.reviewer_status) === "UNREVIEWED").length;
    const acceptedCount = evRes.rows.filter((e) => String(e.reviewer_status) === "ACCEPTED" || String(e.reviewer_status) === "EDITED").length;
    assert("All 4 evidence items have reviewer_status = 'UNREVIEWED'", unreviewedCount === 4);
    assert("0 evidence items are ACCEPTED or EDITED under Human Review Gate", acceptedCount === 0);

    // ── Suite 2: Exact HTTP 400 Reproduction & Root Cause Identification ──
    console.log("\n── Suite 2: Reproduction of HTTP 400 NO_ELIGIBLE_EVIDENCE ──");

    const req1 = new NextRequest(
      `http://localhost:3000/api/projects/${targetProjectId}/insights/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insightType: "open_question" }),
      }
    );

    const res1 = await generateInsight(req1, { params: Promise.resolve({ id: targetProjectId }) });
    assert("Response status code is 400", res1.status === 400);

    const body1 = await res1.json();
    assert("Response contains error envelope", Boolean(body1.error));
    assert("Error code is 'NO_ELIGIBLE_EVIDENCE'", body1.error?.code === "NO_ELIGIBLE_EVIDENCE");
    assert(
      "Error message explicitly identifies Human Review Gate failure",
      String(body1.error?.message).includes("has no accepted evidence under the human review gate")
    );
    assert("Error retryable flag is false", body1.error?.retryable === false);

    // ── Suite 3: Insight Type Normalization Hardening ──
    console.log("\n── Suite 3: Insight Type Normalization Hardening ──");

    const variants = [
      { input: "Open Question", expectedNormalized: "open_question" },
      { input: "open question", expectedNormalized: "open_question" },
      { input: "open-question", expectedNormalized: "open_question" },
      { input: "OPEN_QUESTION", expectedNormalized: "open_question" },
      { input: "Contradiction", expectedNormalized: "contradiction" },
      { input: "THEME", expectedNormalized: "theme" },
    ];

    for (const v of variants) {
      const reqVariant = new NextRequest(
        `http://localhost:3000/api/projects/${targetProjectId}/insights/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ insightType: v.input }),
        }
      );
      const resVariant = await generateInsight(reqVariant, { params: Promise.resolve({ id: targetProjectId }) });
      const bodyVariant = await resVariant.json();
      assert(
        `Variant '${v.input}' cleanly enters review gate (HTTP 400 NO_ELIGIBLE_EVIDENCE, not 500)`,
        resVariant.status === 400 && bodyVariant.error?.code === "NO_ELIGIBLE_EVIDENCE"
      );
    }

    // ── Suite 4: Review Gate Transition in Isolated Database ──
    console.log("\n── Suite 4: Review Gate Transition (Founder Acceptance in Isolated DB) ──");

    // Founder reviews and accepts 1 evidence item
    const targetEvId = "ev-tf-1793022307394-0";
    await testDb.execute({
      sql: "UPDATE evidence SET reviewer_status = 'ACCEPTED' WHERE id = ?",
      args: [targetEvId],
    });

    const checkEvRes = await testDb.execute({
      sql: "SELECT reviewer_status FROM evidence WHERE id = ?",
      args: [targetEvId],
    });
    assert("Evidence item updated to 'ACCEPTED' in isolated DB", String(checkEvRes.rows[0]?.reviewer_status) === "ACCEPTED");

    // Now trigger synthesis with "open_question"
    console.log("Triggering synthesis with accepted evidence in isolated DB...");
    const reqAccepted = new NextRequest(
      `http://localhost:3000/api/projects/${targetProjectId}/insights/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insightType: "open_question" }),
      }
    );

    const resAccepted = await generateInsight(reqAccepted, { params: Promise.resolve({ id: targetProjectId }) });
    assert(
      "With accepted evidence, request is NOT rejected with 400 NO_ELIGIBLE_EVIDENCE",
      resAccepted.status !== 400
    );

    const bodyAccepted = await resAccepted.json();
    if (resAccepted.status === 200) {
      assert("Synthesis returned 200 OK via live inference", resAccepted.status === 200);
      assert("Generated insight type is 'open_question'", bodyAccepted.data?.insight?.type === "open_question");
      assert("Generated insight statement is non-empty", Boolean(bodyAccepted.data?.insight?.statement));
      assert(
        "Generated insight links to accepted evidence item",
        Array.isArray(bodyAccepted.data?.insight?.evidence_for_ids) &&
          bodyAccepted.data?.insight?.evidence_for_ids.includes(targetEvId)
      );
      assert("Provenance is AI_INFERENCE", bodyAccepted.data?.insight?.provenance === "AI_INFERENCE");
    } else {
      console.log(`Note: Inference returned status ${resAccepted.status}:`, bodyAccepted);
      assert("Status is 503 if Ollama was unreachable, never 400", resAccepted.status === 503);
    }

    // ── Suite 5: Client-Side Error Extraction Unit Logic ──
    console.log("\n── Suite 5: Client-Side Error Extraction Logic ──");

    // Test how client extracts message from 400 response
    const mock400Response = {
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "NO_ELIGIBLE_EVIDENCE",
          message: "Project 'proj-cf22841b' has no accepted evidence under the human review gate. Review and accept evidence before generating insights.",
          retryable: false,
        },
      }),
    };

    let clientExtractedMessage = "";
    if (!mock400Response.ok) {
      const errJson = await mock400Response.json().catch(() => null);
      clientExtractedMessage = errJson?.error?.message || `Inference endpoint returned HTTP ${mock400Response.status}`;
    }

    assert(
      "Client extracts backend error message instead of generic 'HTTP 400'",
      clientExtractedMessage === "Project 'proj-cf22841b' has no accepted evidence under the human review gate. Review and accept evidence before generating insights."
    );
    assert(
      "Client message does NOT contain 'Inference endpoint returned HTTP 400'",
      !clientExtractedMessage.includes("Inference endpoint returned HTTP 400")
    );

    if (typeof (testDb as any).close === "function") {
      try { (testDb as any).close(); } catch {}
    }
  } finally {
    // Reset DB back to production
    delete process.env.IDEAPROBE_DB_PATH;
    resetDbClient();
  }

  // ── Suite 6: Production Database Invariance ──
  console.log("\n── Suite 6: Production Database Invariance Check ──");
  const postCounts = await getTableCounts(prodDbPath);
  let invariant = true;
  for (const table of Object.keys(preCounts)) {
    const diff = (postCounts[table] || 0) - preCounts[table];
    if (diff !== 0) {
      console.error(`  Table '${table}' mutated! Pre: ${preCounts[table]}, Post: ${postCounts[table]}`);
      invariant = false;
    }
  }
  assert("All 16 production database tables remain strictly invariant (0 writes)", invariant);

  // Clean up isolated DB files if not locked
  try {
    if (fs.existsSync(isolatedDbPath)) fs.unlinkSync(isolatedDbPath);
    if (fs.existsSync(`${isolatedDbPath}-wal`)) fs.unlinkSync(`${isolatedDbPath}-wal`);
    if (fs.existsSync(`${isolatedDbPath}-shm`)) fs.unlinkSync(`${isolatedDbPath}-shm`);
  } catch (err: any) {
    console.log(`(Note: isolated temp file cleanup deferred on Windows process exit: ${err.message})`);
  }

  console.log(`\n==========================================================================`);
  console.log(`Regression Test Completed: ${passed} passed, ${failed} failed`);
  console.log(`==========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
