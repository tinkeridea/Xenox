/**
 * IdeaProbe — Master End-to-End MVP Verification & Readiness Gate Test Suite (TL-078)
 *
 * Validates the complete founder journey across two distinct startup ideas:
 * 1. Project A: "StudySync — Peer Academic Mentoring" (Target: Engineering Undergrads, mode: LIVE)
 * 2. Project B: "ChefRoute — Cloud Kitchen Fleet Dispatch" (Target: Multi-brand Dark Kitchen Operators, mode: LIVE)
 *
 * Exercises all 14 core workflows end-to-end:
 * - Workflow 1: Multi-Project Creation, Brief Management & Cross-Project Isolation
 * - Workflow 2: Persona Generation with AI Inference / Verified Fallback Provenance
 * - Workflow 3: Simulated Persona Chat, Interview Session Persistence & TL-077 Verification
 * - Workflow 4: Research & Evidence Ledger, Human Review Gate, Quarantine & Isolation
 * - Workflow 5: Evidence-Gated Insight Extraction & Human Review Gate Enforcement
 * - Workflow 6: Assumptions, Risk Scoring & Risks Stage Progression
 * - Workflow 7 & 8: AI Experiment Generation, Persistence, Assumption Linkage & Decision Rules
 * - Workflow 9 & 10: Recording Experiment Results & Deterministic Decision Loop Evaluation
 * - Workflow 11: MVP Feature Prioritization (NOW / LATER / OMIT) & Stage Progression
 * - Workflow 12: Competitor Mapping, Differentiation Matrix & Gap Resolution
 * - Workflow 13: Unified Founder Report Generation, Snapshots, Immutability & Comparison
 * - Workflow 14: Master Stage Progression & Parent Run Status (10/10 Stages Completed)
 * - Workflow 15: CSV, JSON & Markdown Exports & RFC 4180 Escaping
 *
 * Safeguards:
 * - Operates entirely in an isolated temporary database (.ideaprobe-data/test-e2e-mvp-gate.db).
 * - Inspects and asserts production database (.ideaprobe-data/ideaprobe.db) across all 16 tables before and after execution (0 writes).
 */

import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";

// API Route Handlers
import { POST as createProject, GET as getProjectsList } from "./src/app/api/projects/route";
import { PATCH as updateProject, getProjectFromDb } from "./src/app/api/projects/[id]/route";
import { POST as createSource } from "./src/app/api/projects/[id]/sources/route";
import { POST as createEvidence, PATCH as updateEvidence, getEvidenceFromDb } from "./src/app/api/projects/[id]/evidence/route";
import { POST as createCompetitor, PATCH as updateCompetitor, getCompetitorsFromDb } from "./src/app/api/projects/[id]/competitors/route";
import { POST as createAssumption, PATCH as updateAssumption, getAssumptionsFromDb } from "./src/app/api/projects/[id]/assumptions/route";
import { POST as createExperiment, PATCH as updateExperiment, getExperimentsFromDb } from "./src/app/api/projects/[id]/experiments/route";
import { POST as generateReport, getReportFromDb, buildVerdict } from "./src/app/api/projects/[id]/report/route";
import { GET as getStagesRoute } from "./src/app/api/projects/[id]/stages/route";
import { POST as generatePersonaRoute } from "./src/app/api/projects/[id]/personas/generate/route";
import { POST as chatRoute } from "./src/app/api/personas/[id]/chat/route";
import { POST as generateInsightRoute } from "./src/app/api/projects/[id]/insights/generate/route";
import { POST as generateExperimentRoute } from "./src/app/api/projects/[id]/experiments/generate/route";
import { POST as createMvpFeature, getMvpFeaturesFromDb } from "./src/app/api/projects/[id]/mvp/route";

// Pure Utilities
import { isDifferentiated, getDifferentiationMetrics, buildDifferentiationMarkdownTable } from "./src/lib/competitorValidation";
import {
  escapeCsvCell,
  sanitizeFilename,
  downloadFile,
  generateCompetitorCsv,
  generateCompetitorJson,
  generateEvidenceCsv,
  generateEvidenceJson,
} from "./src/lib/exportUtils";
import { evaluateExperimentDecision } from "./src/lib/experimentDecision";
import { compareSnapshots } from "./src/lib/reportComparison";
import { determineStageState, reconcileProjectStages } from "./src/lib/stageReconciliation";
import { isVerifiedRealEvidence, isPlaceholderEvidence } from "./src/lib/evidenceValidation";

let passedAssertions = 0;
let failedAssertions = 0;
let skippedChecks = 0;

function assert(condition: any, message: string) {
  if (Boolean(condition)) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function skip(message: string, reason: string) {
  skippedChecks++;
  console.log(`  ⊘ SKIP: ${message} (Reason: ${reason})`);
}

const EXPECTED_PROD_COUNTS: Record<string, number> = {
  ai_jobs: 0,
  assumptions: 6,
  competitors: 7,
  evidence: 28,
  experiments: 4,
  idea_briefs: 7,
  insights: 12,
  interviews: 2,
  mvp_features: 13,
  personas: 5,
  projects: 7,
  report_snapshots: 231,
  runs: 5,
  sources: 28,
  stages: 50,
  turns: 64,
};

async function getTableCounts(dbPath: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const counts: Record<string, number> = {};
  for (const t of tables.rows) {
    const tableName = String(t.name);
    const row = await client.execute(`SELECT COUNT(*) as count FROM "${tableName}"`);
    counts[tableName] = Number(row.rows[0].count);
  }
  return counts;
}

async function probeOllama(): Promise<{ live: boolean; model: string | null }> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      const models: string[] = (data.models || []).map((m: any) => m.name);
      const targetModel = models.find((m) => m.includes("qwen3.5:4b")) || models[0] || null;
      return { live: true, model: targetModel };
    }
  } catch {}
  return { live: false, model: null };
}

async function runMasterE2eGate() {
  console.log("================================================================================");
  console.log("  IdeaProbe — Master End-to-End MVP Verification Gate (TL-078)");
  console.log("================================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data/ideaprobe.db");
  const isolatedDbPath = path.resolve(__dirname, ".ideaprobe-data/test-e2e-mvp-gate.db");

  // ── SUITE 1: Production Database Pre-Execution Baseline Check ───────────────
  console.log("Suite 1: Production Database Pre-Execution Baseline Check (16 Tables)");
  assert(fs.existsSync(prodDbPath), `Production database exists at ${prodDbPath}`);
  const preCounts = await getTableCounts(prodDbPath);

  let baselineMatch = true;
  for (const [t, exp] of Object.entries(EXPECTED_PROD_COUNTS)) {
    const actual = preCounts[t];
    if (actual !== exp) {
      baselineMatch = false;
      console.error(`  ✗ Baseline mismatch on ${t}: expected ${exp}, found ${actual}`);
    }
  }
  assert(baselineMatch, `All 16 production tables match verified TL-077 baseline exactly`);
  console.log();

  // ── SUITE 2: Isolated Test Database Setup & Service Probing ─────────────────
  console.log("Suite 2: Isolated Test Database Setup & Service Probing");
  if (fs.existsSync(isolatedDbPath)) {
    try { fs.unlinkSync(isolatedDbPath); } catch {}
  }
  process.env.IDEAPROBE_DB_PATH = isolatedDbPath;
  resetDbClient();
  await initDb();
  assert(fs.existsSync(isolatedDbPath), `Isolated test DB initialized at ${isolatedDbPath}`);
  const db = getDb();

  const ollamaInfo = await probeOllama();
  if (ollamaInfo.live) {
    console.log(`  ℹ Local Ollama detected online: active model '${ollamaInfo.model}'`);
  } else {
    console.log(`  ℹ Local Ollama not reachable on :11434; deterministic offline fallbacks will be exercised`);
  }
  console.log();

  // ── SUITE 3: Workflow 1 — Multi-Project Creation & Brief Management ─────────
  console.log("Suite 3: Workflow 1 — Multi-Project Creation & Project Isolation");
  // Create Project A
  const createReqA = new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "StudySync — Peer Academic Mentoring",
      problem: "Sophomore STEM students have high failure rates; university tutoring has 2-week backlog.",
      target_customer: "Undergraduate engineering students",
      solution: "15-minute on-demand peer video sessions booked at micro-intervals.",
      geography: "India / US Universities",
      category: "EdTech / Peer Tutoring",
      mode: "LIVE",
    }),
  });
  const resA = await createProject(createReqA);
  const dataA = await resA.json();
  assert(resA.status === 201, "Project A created successfully with HTTP 201");
  const projAId = dataA.data.projectId || dataA.data.id;
  assert(projAId && projAId.startsWith("proj-"), `Project A received valid ID: ${projAId}`);
  assert(dataA.data.mode === "LIVE", "Project A mode is LIVE");

  // Create Project B
  const createReqB = new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "ChefRoute — Cloud Kitchen Fleet Dispatch",
      problem: "Food delivery aggregators take 30% take-rate and batch orders poorly.",
      target_customer: "Multi-brand dark kitchen operators",
      solution: "Shared localized runner dispatch network across 5-8 non-competing kitchens.",
      geography: "Tier 1 Metro Hubs",
      category: "Logistics / FoodTech",
      mode: "LIVE",
    }),
  });
  const resB = await createProject(createReqB);
  const dataB = await resB.json();
  assert(resB.status === 201, "Project B created successfully with HTTP 201");
  const projBId = dataB.data.projectId || dataB.data.id;
  assert(projBId && projBId.startsWith("proj-"), `Project B received valid ID: ${projBId}`);
  assert(projAId !== projBId, "Project A and Project B have distinct IDs");

  // Patch Project A brief
  const patchReqA = new NextRequest(`http://localhost:3000/api/projects/${projAId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "StudySync — On-Demand STEM Mentoring",
      problem: "Sophomore STEM students have 35% failure rates; college tutoring has 3-week backlog.",
      stage: "idea",
    }),
  });
  const patchResA = await updateProject(patchReqA, { params: Promise.resolve({ id: projAId }) });
  const patchDataA = await patchResA.json();
  assert(patchResA.status === 200, "Project A brief successfully updated via PATCH");
  assert(patchDataA.data.message === "Project updated successfully", "Project A update confirmed via response message");

  // Verify Project Detail via getProjectFromDb
  const detailA = await getProjectFromDb(projAId);
  const detailAJson = await detailA.json();
  assert(detailAJson.data.project.title === "StudySync — On-Demand STEM Mentoring", "Project A detail confirms updated title");
  assert(detailAJson.data.counts.evidence_count === 0, "Project A initially has 0 evidence");
  assert(detailAJson.data.counts.competitor_count === 0, "Project A initially has 0 competitors");
  assert(detailAJson.data.counts.persona_count === 0, "Project A initially has 0 personas");
  assert(detailAJson.data.counts.interview_count === 0, "Project A initially has 0 interviews");

  const detailB = await getProjectFromDb(projBId);
  const detailBJson = await detailB.json();
  assert(detailBJson.data.project.title === "ChefRoute — Cloud Kitchen Fleet Dispatch", "Project B detail returns correct title");
  assert(detailBJson.data.counts.evidence_count === 0, "Project B initially has 0 evidence");
  console.log();

  // ── SUITE 4: Workflow 2 — Persona Generation with AI Inference / Fallback ───
  console.log("Suite 4: Workflow 2 — Persona Generation with Provenance Tagging");
  const personaGenReq = new NextRequest(`http://localhost:3000/api/projects/${projAId}/personas/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const personaGenRes = await generatePersonaRoute(personaGenReq, { params: Promise.resolve({ id: projAId }) });
  assert(personaGenRes.status === 200, "Persona generation returns HTTP 200");
  const personaGenData = await personaGenRes.json();
  const createdPersona = personaGenData.data?.persona;
  assert(!!createdPersona?.id, `Persona created with ID: ${createdPersona?.id}`);
  assert(createdPersona.projectId === projAId, "Persona strictly associated with Project A");
  assert(
    createdPersona.provenance === "AI_INFERENCE" || createdPersona.provenance === "SAMPLE",
    `Persona provenance is valid (${createdPersona.provenance})`
  );
  assert(personaGenData.data.caveat.includes("structured hypothesis"), "Persona response includes structured hypothesis caveat");

  // Verify persona persisted in SQLite
  const dbPersonaRow = await db.execute({
    sql: "SELECT * FROM personas WHERE id = ? AND project_id = ?",
    args: [createdPersona.id, projAId],
  });
  assert(dbPersonaRow.rows.length === 1, "Persona persisted in SQLite personas table");

  // Verify Stage Reconciliation for personas stage
  const stageAfterPersona = await db.execute({
    sql: `SELECT s.status, s.output_json FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'personas'`,
    args: [projAId],
  });
  assert(stageAfterPersona.rows[0]?.status === "completed", "Personas stage transitioned to 'completed'");

  // Verify Project B Persona Isolation
  const dbPersonaB = await db.execute({
    sql: "SELECT COUNT(*) as count FROM personas WHERE project_id = ?",
    args: [projBId],
  });
  assert(Number(dbPersonaB.rows[0].count) === 0, "Project B has 0 personas (project isolation verified)");
  console.log();

  // ── SUITE 5: Workflow 3 — Simulated Persona Chat, Sessions & TL-077 ─────────
  console.log("Suite 5: Workflow 3 — Simulated Persona Chat, Sessions & TL-077 Verification");
  const sessionIdA = `session-studysync-${Date.now()}`;

  // Turn 1: Initial user message
  const chatReq1 = new NextRequest(`http://localhost:3000/api/personas/${createdPersona.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA,
      projectId: projAId,
      message: "How do you manage exam prep when you get stuck on a difficult problem?",
    }),
  });
  const chatRes1 = await chatRoute(chatReq1, { params: Promise.resolve({ id: createdPersona.id }) });
  assert(chatRes1.status === 200, "Persona chat turn 1 returns HTTP 200");
  const chatData1 = await chatRes1.json();
  assert(chatData1.data?.conversationId === sessionIdA, "Response conversationId matches sessionId");
  assert(chatData1.data?.interviewId === sessionIdA, "Response interviewId matches sessionId");
  assert(chatData1.data?.caveat.includes("SIMULATED ARTIFACT"), "Response includes simulation caveat (Decision D03)");

  // Verify interview row in SQLite
  const ivRowsA1 = await db.execute({
    sql: "SELECT * FROM interviews WHERE project_id = ?",
    args: [projAId],
  });
  assert(ivRowsA1.rows.length === 1, "Single interview session record created in SQLite");
  assert(ivRowsA1.rows[0].id === sessionIdA, "Interview record ID equals sessionId");
  assert(ivRowsA1.rows[0].provenance === "SIMULATED", "Interview session provenance is strictly 'SIMULATED'");

  // Verify turns in SQLite
  const turnRowsA1 = await db.execute({
    sql: "SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at ASC",
    args: [sessionIdA],
  });
  assert(turnRowsA1.rows.length === 2, "Exactly 2 turns recorded for turn 1 (1 user + 1 assistant)");
  assert(turnRowsA1.rows[0].role === "user" && turnRowsA1.rows[0].provenance === "USER_INPUT", "User turn tagged USER_INPUT");
  assert(turnRowsA1.rows[1].role === "assistant", "Assistant turn recorded with response");

  // Turn 2 & Turn 3: Multi-turn session idempotency check
  const chatReq2 = new NextRequest(`http://localhost:3000/api/personas/${createdPersona.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA,
      projectId: projAId,
      message: "Would you pay $5 for a 15-minute video call with a vetted peer?",
    }),
  });
  const chatRes2 = await chatRoute(chatReq2, { params: Promise.resolve({ id: createdPersona.id }) });
  assert(chatRes2.status === 200, "Persona chat turn 2 returns HTTP 200");

  const chatReq3 = new NextRequest(`http://localhost:3000/api/personas/${createdPersona.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionIdA,
      projectId: projAId,
      message: "What is your biggest fear with booking peer tutors online?",
    }),
  });
  const chatRes3 = await chatRoute(chatReq3, { params: Promise.resolve({ id: createdPersona.id }) });
  assert(chatRes3.status === 200, "Persona chat turn 3 returns HTTP 200");

  // Assert Idempotency: Exactly 1 interview session, but 6 turns
  const ivRowsAAfter = await db.execute({
    sql: "SELECT COUNT(*) as count FROM interviews WHERE project_id = ?",
    args: [projAId],
  });
  assert(Number(ivRowsAAfter.rows[0].count) === 1, "Idempotency verified: Interview session count remains strictly 1 after 3 turns");

  const turnRowsAAfter = await db.execute({
    sql: "SELECT COUNT(*) as count FROM turns WHERE conversation_id = ?",
    args: [sessionIdA],
  });
  assert(Number(turnRowsAAfter.rows[0].count) === 6, "Total turns count is 6 (3 user turns + 3 assistant turns)");

  // Cross-Project Persona Access Protection
  const crossChatReq = new NextRequest(`http://localhost:3000/api/personas/${createdPersona.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-cross-leak-test",
      projectId: projBId, // Mismatched project!
      message: "Attempting cross-project access",
    }),
  });
  const crossChatRes = await chatRoute(crossChatReq, { params: Promise.resolve({ id: createdPersona.id }) });
  assert(crossChatRes.status === 403, "Cross-project persona access rejected with HTTP 403");
  const crossChatJson = await crossChatRes.json();
  assert(crossChatJson.error?.code === "PROJECT_MISMATCH", "Cross-project error code is PROJECT_MISMATCH");

  // Assert Zero Writes for Rejected Cross-Project Request
  const crossIvCheck = await db.execute({
    sql: "SELECT COUNT(*) as count FROM interviews WHERE id = 'session-cross-leak-test'",
  });
  assert(Number(crossIvCheck.rows[0].count) === 0, "No interview record created for rejected cross-project request");

  // Verify Interviews Stage Reconciliation (TL-077 Core Fix)
  const ivStageRow = await db.execute({
    sql: `SELECT s.status, s.output_json FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'interviews'`,
    args: [projAId],
  });
  assert(ivStageRow.rows[0]?.status === "completed", "TL-077 Verified: Interviews stage transitioned to 'completed'");
  const ivOutput = JSON.parse(String(ivStageRow.rows[0]?.output_json));
  assert(ivOutput.provenance === "SIMULATED", "Interviews stage output provenance is strictly 'SIMULATED'");
  assert(ivOutput.caveat.includes("NEVER use synthetic interviews"), "Interviews stage output contains strict simulation caveat");
  console.log();

  // ── SUITE 6: Workflow 4 — Research & Evidence Ledger ─────────────────────────
  console.log("Suite 6: Workflow 4 — Research & Evidence Ledger, Review Gate & Isolation");
  // Add source to Project A
  const srcReqA = new NextRequest(`http://localhost:3000/api/projects/${projAId}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "ASEE Engineering Retention & Mentorship Survey 2025",
      url: "https://asee.org/surveys/engineering-retention-2025",
      source_type: "academic",
      provenance: "REAL_SOURCE",
    }),
  });
  const srcResA = await createSource(srcReqA, { params: Promise.resolve({ id: projAId }) });
  const srcDataA = await srcResA.json();
  assert(srcResA.status === 201, "Source created for Project A");
  const srcAId = srcDataA.data.source?.id || srcDataA.data.id;

  // Add evidence to Project A: 1 Real Accepted, 1 Sample/Placeholder, 1 Real Rejected
  const evReq1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim: "68% of sophomore engineering dropouts cite inability to get immediate help during homework assignments.",
      excerpt: "Survey across 12 universities indicates students abandon problem sets after 45 minutes of being stuck.",
      source_id: srcAId,
      confidence: "High",
      reviewer_status: "UNREVIEWED",
      provenance: "REAL_SOURCE",
    }),
  });
  const evRes1 = await createEvidence(evReq1, { params: Promise.resolve({ id: projAId }) });
  const evData1 = await evRes1.json();
  assert(evRes1.status === 201, "Evidence 1 created for Project A");
  const ev1Id = evData1.data.evidence?.id || evData1.data.id;

  // Human Review Gate: Accept Evidence 1
  const patchEv1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/evidence`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: ev1Id,
      reviewer_status: "ACCEPTED",
    }),
  });
  const patchEvRes1 = await updateEvidence(patchEv1, { params: Promise.resolve({ id: projAId }) });
  assert(patchEvRes1.status === 200, "Human Review Gate: Evidence 1 status transitioned to ACCEPTED");

  // Evidence 2: Sample/Synthetic fixture (must be quarantined)
  const evReq2 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim: "Students prefer app-based booking over in-person tutor scheduling (SAMPLE FIXTURE).",
      source_id: srcAId,
      confidence: "Low",
      reviewer_status: "ACCEPTED",
      provenance: "SAMPLE",
    }),
  });
  const evRes2 = await createEvidence(evReq2, { params: Promise.resolve({ id: projAId }) });
  const evData2 = await evRes2.json();
  const ev2Id = evData2.data.evidence?.id || evData2.data.id;

  // Evidence 3: Rejected real evidence
  const evReq3 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim: "High school students prefer group tutoring on Zoom.",
      source_id: srcAId,
      confidence: "Medium",
      reviewer_status: "REJECTED",
      provenance: "REAL_SOURCE",
    }),
  });
  const evRes3 = await createEvidence(evReq3, { params: Promise.resolve({ id: projAId }) });
  const evData3 = await evRes3.json();

  // Verify Project A Evidence Ledger
  const evListA = await getEvidenceFromDb(projAId);
  const evListAJson = await evListA.json();
  assert(evListAJson.data.evidence.length === 3, "Project A has exactly 3 evidence items");
  assert(evListAJson.data.metrics.verifiedRealCount === 1, "Only 1 evidence item is verified real (SAMPLE and REJECTED quarantined)");

  // Strict Project Isolation: Project B must have 0 evidence and 0 sources
  const evListB = await getEvidenceFromDb(projBId);
  const evListBJson = await evListB.json();
  assert(evListBJson.data.evidence.length === 0, "Project B has 0 evidence (strict project isolation)");
  assert(evListBJson.data.sources.length === 0, "Project B has 0 sources (strict project isolation)");
  console.log();

  // ── SUITE 7: Workflow 5 — Evidence-Gated Insight Extraction ─────────────────
  console.log("Suite 7: Workflow 5 — Evidence-Gated Insight Extraction & Review Gate");
  // Review Gate Rejection Test: Project B has 0 accepted evidence, must reject with HTTP 400
  const insightGenReqB = new NextRequest(`http://localhost:3000/api/projects/${projBId}/insights/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insightType: "theme" }),
  });
  const insightGenResB = await generateInsightRoute(insightGenReqB, { params: Promise.resolve({ id: projBId }) });
  assert(insightGenResB.status === 400, "Insight synthesis on project without accepted evidence returns HTTP 400");
  const insightGenJsonB = await insightGenResB.json();
  assert(insightGenJsonB.error?.code === "NO_ELIGIBLE_EVIDENCE", "Error code is strictly NO_ELIGIBLE_EVIDENCE");

  // Synthesize Insight for Project A with eligible accepted evidence
  const insightGenReqA = new NextRequest(`http://localhost:3000/api/projects/${projAId}/insights/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insightType: "theme" }),
  });
  const insightGenResA = await generateInsightRoute(insightGenReqA, { params: Promise.resolve({ id: projAId }) });
  assert(insightGenResA.status === 200, "Insight synthesis for Project A with accepted evidence returns HTTP 200");
  const insightGenDataA = await insightGenResA.json();
  const createdInsight = insightGenDataA.data?.insight;
  assert(!!createdInsight?.id, `Insight created with ID: ${createdInsight?.id}`);
  assert(createdInsight.projectId === projAId, "Insight associated with Project A");
  assert(createdInsight.evidence_for_ids.includes(ev1Id), "Insight explicitly cites accepted Evidence 1");
  assert(
    createdInsight.provenance === "AI_INFERENCE" || createdInsight.provenance === "SAMPLE",
    `Insight provenance is valid (${createdInsight.provenance})`
  );

  // Verify insights stage reconciliation
  const stageAfterInsight = await db.execute({
    sql: `SELECT s.status FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'insights'`,
    args: [projAId],
  });
  assert(stageAfterInsight.rows[0]?.status === "completed", "Insights stage transitioned to 'completed'");
  console.log();

  // ── SUITE 8: Workflow 6 — Assumptions & Risk Scoring ────────────────────────
  console.log("Suite 8: Workflow 6 — Assumptions, Dynamic Risk Scoring & Risks Stage");
  // Assumption 1: Desirability (Critical 4 × High 3 = 12)
  const asmReq1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      statement: "Sophomore engineering students will pay $15/hr for immediate peer problem-solving help.",
      category: "desirability",
      impact: "High",
      uncertainty: "Critical",
      status: "unvalidated",
      provenance: "USER_INPUT",
    }),
  });
  const asmRes1 = await createAssumption(asmReq1, { params: Promise.resolve({ id: projAId }) });
  const asmData1 = await asmRes1.json();
  assert(asmRes1.status === 201, "Assumption 1 registered for Project A");
  const asm1Id = asmData1.data.assumption?.id || asmData1.data.id;
  assert(asmData1.data.assumption.priority_score === 12, "Assumption 1 priority score is 12 (Critical 4 × High 3)");

  // Assumption 2: Feasibility (High 3 × Medium 2 = 6)
  const asmReq2 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      statement: "Upperclassmen mentors can reliably be matched within 5 minutes of request.",
      category: "feasibility",
      impact: "Medium",
      uncertainty: "High",
      status: "unvalidated",
      provenance: "USER_INPUT",
    }),
  });
  const asmRes2 = await createAssumption(asmReq2, { params: Promise.resolve({ id: projAId }) });
  const asmData2 = await asmRes2.json();
  assert(asmRes2.status === 201, "Assumption 2 registered for Project A");
  assert(asmData2.data.assumption.priority_score === 6, "Assumption 2 priority score is 6 (High 3 × Medium 2)");

  // Verify risks stage reconciliation
  const stageAfterAsm = await db.execute({
    sql: `SELECT s.status FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'risks'`,
    args: [projAId],
  });
  assert(stageAfterAsm.rows[0]?.status === "completed", "Risks stage transitioned to 'completed'");
  console.log();

  // ── SUITE 9: Workflow 7 & 8 — AI Experiment Generation & Persistence ────────
  console.log("Suite 9: Workflow 7 & 8 — AI Experiment Generation, Persistence & Decision Rules");
  // Generate experiment via AI endpoint linked to Assumption 1
  const expGenReq = new NextRequest(`http://localhost:3000/api/projects/${projAId}/experiments/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assumptionId: asm1Id,
      method: "Concierge MVP / WhatsApp Bot",
    }),
  });
  const expGenRes = await generateExperimentRoute(expGenReq, { params: Promise.resolve({ id: projAId }) });
  assert(expGenRes.status === 201, "AI experiment generation returns HTTP 201");
  const expGenData = await expGenRes.json();
  const generatedExp = expGenData.data?.experiment;
  assert(!!generatedExp?.id, `Experiment created with ID: ${generatedExp?.id}`);
  assert(generatedExp.assumption_id === asm1Id, "Experiment strictly linked to Assumption 1");
  assert(generatedExp.status === "planned", "Generated experiment initial status is 'planned'");
  assert(!!generatedExp.decision_rules, "Experiment contains structured decision rules");

  // Verify Assumption 1 transitioned to 'testing'
  const asmAfterGen = await db.execute({
    sql: "SELECT status FROM assumptions WHERE id = ?",
    args: [asm1Id],
  });
  assert(asmAfterGen.rows[0]?.status === "testing", "Assumption 1 lifecycle status transitioned to 'testing'");

  // Reconcile stage progression with the newly planned experiment
  await reconcileProjectStages(projAId);
  const stageExpPlanned = await db.execute({
    sql: `SELECT s.status FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'experiments'`,
    args: [projAId],
  });
  assert(stageExpPlanned.rows[0]?.status === "running", "Experiments stage evaluates to 'running' while experiment is planned");
  console.log();

  // ── SUITE 10: Workflow 9 & 10 — Recording Experiment Results & Decision Loop ─
  console.log("Suite 10: Workflow 9 & 10 — Recording Results, Decision Loop & Human Confirmation");
  const exp1Id = generatedExp.id;

  // Complete Experiment 1: Record Result and Auto-Upgrade Provenance
  const patchExp1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/experiments`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: exp1Id,
      status: "completed",
      result: "Conducted 7-day concierge test across 40 students. Result: 22 completed paid micro-tutoring sessions with 95% satisfaction.",
    }),
  });
  const patchExpRes1 = await updateExperiment(patchExp1, { params: Promise.resolve({ id: projAId }) });
  const patchExpData1 = await patchExpRes1.json();
  assert(patchExpRes1.status === 200, "Experiment 1 updated with result observations");
  assert(patchExpData1.data.experiment.provenance === "REAL_EXPERIMENT_RESULT", "Experiment provenance auto-upgraded to REAL_EXPERIMENT_RESULT");

  // Verify experiments stage transitioned to 'completed'
  const stageExpDone = await db.execute({
    sql: `SELECT s.status FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'experiments'`,
    args: [projAId],
  });
  assert(stageExpDone.rows[0]?.status === "completed", "Experiments stage transitioned to 'completed' with recorded result");

  // Deterministic Decision Engine Evaluation
  const decisionSupported = evaluateExperimentDecision({
    threshold: "At least 15 completed sessions",
    result: "Completed 22 sessions",
    decisionRules: JSON.stringify({
      continue: ">= 15 completed sessions",
      pivot: "6-14 completed sessions",
      stop: "< 6 completed sessions",
    }),
  });
  assert(decisionSupported.outcome === "supported", "Decision engine evaluates 22 completed sessions as SUPPORTED");

  const decisionPivot = evaluateExperimentDecision({
    threshold: "At least 15 completed sessions",
    result: "Completed 10 sessions",
    decisionRules: JSON.stringify({
      continue: ">= 15 completed sessions",
      pivot: "6-14 completed sessions",
      stop: "< 6 completed sessions",
    }),
  });
  assert(decisionPivot.outcome === "inconclusive", "Decision engine evaluates 10 sessions as INCONCLUSIVE / PIVOT");

  const decisionRejected = evaluateExperimentDecision({
    threshold: "At least 15 completed sessions",
    result: "Completed 3 sessions",
    decisionRules: JSON.stringify({
      continue: ">= 15 completed sessions",
      pivot: "6-14 completed sessions",
      stop: "< 6 completed sessions",
    }),
  });
  assert(decisionRejected.outcome === "rejected", "Decision engine evaluates 3 sessions as REJECTED");

  // Measurement Ambiguity Safety Check
  const decisionAmbiguous = evaluateExperimentDecision({
    threshold: ">= 30% conversion",
    result: "Several students seemed interested during conversations",
    decisionRules: JSON.stringify({ continue: ">= 30%", stop: "< 15%" }),
  });
  assert(decisionAmbiguous.outcome === "inconclusive", "Decision engine returns INCONCLUSIVE when measurement cannot safely be determined");

  // Human Confirmation Gate (Decision D23/D24): Viewing decisions never auto-mutates assumptions
  const checkAsm1 = await getAssumptionsFromDb(projAId);
  const checkAsm1Json = await checkAsm1.json();
  const asm1Record = checkAsm1Json.data.assumptions.find((a: any) => a.id === asm1Id);
  assert(asm1Record.status === "testing", "Assumption remains 'testing' (human confirmation gate preserved)");

  // Explicit Founder Confirmation: Transition assumption status to 'validated'
  const patchAsm1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/assumptions`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: asm1Id,
      status: "validated",
    }),
  });
  const patchAsmRes1 = await updateAssumption(patchAsm1, { params: Promise.resolve({ id: projAId }) });
  assert(patchAsmRes1.status === 200, "Founder explicitly transitions assumption status to VALIDATED");
  console.log();

  // ── SUITE 11: Workflow 11 — MVP Feature Prioritization (NOW / LATER / OMIT) ──
  console.log("Suite 11: Workflow 11 — MVP Feature Prioritization (NOW / LATER / OMIT)");
  // Feature 1: Now
  const mvpReq1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/mvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "1-Click Instant Peer Booking",
      priority: "now",
      effort: "High",
      experiment_ids: [exp1Id],
      rationale: "Validated by concierge test with 22 completed sessions.",
    }),
  });
  const mvpRes1 = await createMvpFeature(mvpReq1, { params: Promise.resolve({ id: projAId }) });
  assert(mvpRes1.status === 201, "MVP feature 1 (Now) created with HTTP 201");

  // Feature 2: Later
  const mvpReq2 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/mvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Whiteboard Drawing Tool",
      priority: "later",
      effort: "Medium",
      rationale: "Desirable for STEM problems, but basic audio/screen-share suffices for MVP.",
    }),
  });
  const mvpRes2 = await createMvpFeature(mvpReq2, { params: Promise.resolve({ id: projAId }) });
  assert(mvpRes2.status === 201, "MVP feature 2 (Later) created with HTTP 201");

  // Feature 3: Omit
  const mvpReq3 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/mvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Automated AI Lecture Note Transcriber",
      priority: "omit",
      effort: "High",
      rationale: "Distracts from synchronous peer mentorship core hypothesis.",
    }),
  });
  const mvpRes3 = await createMvpFeature(mvpReq3, { params: Promise.resolve({ id: projAId }) });
  assert(mvpRes3.status === 201, "MVP feature 3 (Omit) created with HTTP 201");

  // Verify MVP counts and stage status
  const mvpListA = await getMvpFeaturesFromDb(projAId);
  const mvpListAJson = await mvpListA.json();
  assert(mvpListAJson.data.counts.total === 3, "Total MVP features count is 3");
  assert(mvpListAJson.data.counts.now === 1, "Now features count is 1");
  assert(mvpListAJson.data.counts.later === 1, "Later features count is 1");
  assert(mvpListAJson.data.counts.omit === 1, "Omit features count is 1");

  const stageMvp = await db.execute({
    sql: `SELECT s.status FROM stages s
          JOIN runs r ON s.run_id = r.id
          WHERE r.project_id = ? AND s.stage_key = 'mvp'`,
    args: [projAId],
  });
  assert(stageMvp.rows[0]?.status === "completed", "MVP stage transitioned to 'completed'");
  console.log();

  // ── SUITE 12: Workflow 12 — Competitor Mapping & Differentiation Matrix ─────
  console.log("Suite 12: Workflow 12 — Competitor Mapping, Differentiation Matrix & Gaps");
  // 1. Chegg Study (Direct) — Articulated
  const compReqA1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/competitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Chegg Study",
      category: "direct",
      current_solution: "Asynchronous static textbook step-by-step solutions with 2-4 hour Q&A turnaround.",
      differentiator: "Synchronous 15-minute live peer micro-tutoring with interactive whiteboard.",
      provenance: "USER_INPUT",
    }),
  });
  const compResA1 = await createCompetitor(compReqA1, { params: Promise.resolve({ id: projAId }) });
  assert(compResA1.status === 201, "Competitor 1 created for Project A");

  // 2. University Tutoring Centers (Substitute) — Articulated
  const compReqA2 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/competitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Campus Tutoring Centers",
      category: "substitute",
      current_solution: "Free on-campus physical walk-in tutoring with 2-week advance booking.",
      differentiator: "Instant booking at 11 PM before exam with vetted peer who took the same course.",
      provenance: "USER_INPUT",
    }),
  });
  const compResA2 = await createCompetitor(compReqA2, { params: Promise.resolve({ id: projAId }) });
  assert(compResA2.status === 201, "Competitor 2 created for Project A");

  // 3. WhatsApp Peer Study Groups (Status Quo) — Unspecified / GAP
  const compReqA3 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/competitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: 'Informal "Study Group" Chats',
      category: "status_quo",
      current_solution: "Free unstructured peer messaging groups with noisy conversations.",
      differentiator: "", // Unspecified GAP
      provenance: "USER_INPUT",
    }),
  });
  const compResA3 = await createCompetitor(compReqA3, { params: Promise.resolve({ id: projAId }) });
  const compDataA3 = await compResA3.json();
  const compA3Id = compDataA3.data.competitor?.id || compDataA3.data.id;
  assert(compResA3.status === 201, "Competitor 3 created for Project A (Differentiation Gap)");

  // Validate Project A Differentiation Metrics: 67%
  const compListA = await getCompetitorsFromDb(projAId);
  const compListAJson = await compListA.json();
  const compsA = compListAJson.data.competitors;
  assert(compsA.length === 3, "Project A has 3 competitors");
  const metricsA = getDifferentiationMetrics(compsA);
  assert(metricsA.total === 3 && metricsA.articulated === 2 && metricsA.gaps === 1 && metricsA.coveragePercent === 67, "Coverage is 67% with 1 gap");
  console.log();

  // ── SUITE 13: Workflow 13 — Founder Reports, Snapshots, Immutability & Comparison ───
  console.log("Suite 13: Workflow 13 — Founder Report Generation, Snapshots, Immutability & Comparison");
  // 1. Generate Report Snapshot v1 for Project A
  const repReq1 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const repRes1 = await generateReport(repReq1, { params: Promise.resolve({ id: projAId }) });
  const repData1 = await repRes1.json();
  assert(repRes1.status === 201, "Report Snapshot v1 generated successfully with HTTP 201");
  const rep1 = repData1.data.report;
  assert(rep1.version === 1, "Report Snapshot v1 has version 1");
  assert(rep1.stats.differentiated_competitors === 2, "Report stats shows 2 differentiated competitors");
  assert(rep1.stats.differentiation_coverage_pct === 67, "Report stats shows 67% coverage");

  // 2. Resolve Differentiation Gap on Competitor 3 via PATCH
  const patchCompA3 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/competitors`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: compA3Id,
      differentiator: "Vetted course-specific mentors with structured problem-solving instead of noisy unmoderated chat.",
    }),
  });
  const patchCompResA3 = await updateCompetitor(patchCompA3, { params: Promise.resolve({ id: projAId }) });
  assert(patchCompResA3.status === 200, "Competitor 3 differentiator updated to resolve gap");

  // 3. Generate Report Snapshot v2 for Project A
  const repReq2 = new NextRequest(`http://localhost:3000/api/projects/${projAId}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const repRes2 = await generateReport(repReq2, { params: Promise.resolve({ id: projAId }) });
  const repData2 = await repRes2.json();
  assert(repRes2.status === 201, "Report Snapshot v2 generated successfully with HTTP 201");
  const rep2 = repData2.data.report;
  assert(rep2.version === 2, "Report Snapshot v2 has version 2");
  assert(rep2.stats.differentiation_coverage_pct === 100, "Report v2 stats reaches 100% coverage");

  // 4. Test Historical Immutability: Verify Snapshot v1 content in SQLite has NOT been altered
  const v1DbRow = await db.execute({
    sql: "SELECT * FROM report_snapshots WHERE project_id = ? AND version = 1",
    args: [projAId],
  });
  assert(v1DbRow.rows.length === 1, "Snapshot v1 row exists in SQLite");
  const persistedContent1 = JSON.parse(String(v1DbRow.rows[0].content));
  const persistedDiffSec1 = persistedContent1.find((s: any) => s.id === "sec-differentiation");
  assert(persistedDiffSec1.metrics.coveragePercent === 67, "Snapshot v1 content is IMMUTABLE: retains original 67% coverage");
  assert(persistedDiffSec1.metrics.gaps === 1, "Snapshot v1 content is IMMUTABLE: retains original 1 gap");

  // 5. Test Comparison Engine Between v1 and v2
  const baseSnap = {
    id: String(v1DbRow.rows[0].id),
    project_id: projAId,
    version: 1,
    generated_at: String(v1DbRow.rows[0].generated_at),
    content: persistedContent1,
    provenance_manifest: JSON.parse(String(v1DbRow.rows[0].provenance_manifest || "{}")),
    contains_simulated: Number(v1DbRow.rows[0].contains_simulated),
    contains_sample: Number(v1DbRow.rows[0].contains_sample),
  };

  const compareSnap = {
    id: rep2.id,
    project_id: projAId,
    version: rep2.version,
    generated_at: rep2.generated_at,
    content: rep2.content,
    provenance_manifest: rep2.provenance_manifest,
    contains_simulated: rep2.contains_simulated ? 1 : 0,
    contains_sample: rep2.contains_sample ? 1 : 0,
  };

  const comparison = compareSnapshots(baseSnap, compareSnap);
  assert(comparison.modifiedSectionsCount > 0, "Snapshot comparison detects modified sections between v1 and v2");
  const diffMetricDeltas = comparison.metrics.filter((m) =>
    m.metric.toLowerCase().includes("differentiation")
  );
  assert(diffMetricDeltas.length > 0, "Comparison engine detects differentiation metric deltas");
  const coverageDelta = diffMetricDeltas.find((m) => m.metric.includes("Coverage"));
  assert(coverageDelta && coverageDelta.delta === 33, "Comparison engine detects +33% coverage improvement");

  // 6. Report Project Isolation: Generate Report for Project B
  const repReqB = new NextRequest(`http://localhost:3000/api/projects/${projBId}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const repResB = await generateReport(repReqB, { params: Promise.resolve({ id: projBId }) });
  const repDataB = await repResB.json();
  assert(repResB.status === 201, "Report Snapshot generated for Project B");
  const repB = repDataB.data.report;
  assert(!JSON.stringify(repB.content).includes("Chegg Study"), "Project B report does NOT leak Project A competitors");
  console.log();

  // ── SUITE 14: Workflow 14 — Master Stage Progression & Parent Run Status ────
  console.log("Suite 14: Workflow 14 — Master Stage Progression & Parent Run Status (10/10 Stages)");
  const stageResA = await reconcileProjectStages(projAId);
  assert(stageResA.stages.length === 10, "Project A has 10 reconciled stages");

  const stageKeys = [
    "research",
    "competitors",
    "icp",
    "personas",
    "interviews",
    "insights",
    "risks",
    "experiments",
    "mvp",
    "report",
  ];
  for (const k of stageKeys) {
    const stg = stageResA.stages.find((s) => s.stageKey === k);
    assert(stg?.status === "completed", `Stage '${k}' is COMPLETED in Project A`);
  }

  assert(stageResA.completedStagesCount === 10, "All 10 of 10 stages reached 'completed'!");
  assert(stageResA.runStatus === "completed", "Parent run status transitioned from 'running' to 'completed'!");

  // Regression Protection
  const stageResA2 = await reconcileProjectStages(projAId);
  assert(stageResA2.completedStagesCount === 10, "Regression protection: Stage count remains 10 on repeated reconciliation");
  assert(stageResA2.runStatus === "completed", "Regression protection: Run status remains 'completed'");

  // Project B Stage Status Isolation
  const stageResB = await reconcileProjectStages(projBId);
  assert(stageResB.completedStagesCount < 5, "Project B has only partial stage completion (no leakage from A)");
  assert(stageResB.runStatus === "running", "Project B run status remains 'running'");
  console.log();

  // ── SUITE 15: Workflow 15 — CSV, JSON & Markdown Exports & RFC 4180 Escaping ───
  console.log("Suite 15: Workflow 15 — CSV, JSON & Markdown Exports & RFC 4180 Escaping");
  // Competitor CSV
  const compCsvA = generateCompetitorCsv(compsA, projAId);
  assert(compCsvA.startsWith("\uFEFF"), "Competitor CSV starts with UTF-8 BOM");
  assert(compCsvA.includes("Chegg Study"), "Competitor CSV contains Chegg Study");
  assert(compCsvA.includes('""Study Group""'), "Competitor CSV escapes double quotes in competitor name");

  // Competitor JSON
  const compJsonObjA = generateCompetitorJson(compsA, {
    projectId: projAId,
    projectTitle: "StudySync",
    mode: "LIVE",
  });
  const compJsonA = JSON.stringify(compJsonObjA, null, 2);
  const parsedCompJsonA = JSON.parse(compJsonA);
  assert(parsedCompJsonA.export_type === "competitor_differentiation_matrix", "JSON export_type is competitor_differentiation_matrix");
  assert(parsedCompJsonA.disclaimer.includes("strategic positioning hypothesis"), "JSON includes strategic hypothesis disclaimer");

  // Competitor Markdown
  const compMdA = buildDifferentiationMarkdownTable(compsA);
  assert(compMdA.includes("| Alternative | Category | Current Solution / Offer | Our Differentiation Advantage | Status | Provenance |"), "Markdown table contains correct headers");

  // Evidence Ledger CSV & JSON
  const evRowsA = evListAJson.data.evidence;
  const evCsvA = generateEvidenceCsv(evRowsA, projAId);
  assert(evCsvA.startsWith("\uFEFF"), "Evidence CSV starts with UTF-8 BOM");
  assert(evCsvA.includes("ASEE Engineering Retention"), "Evidence CSV includes source title");

  const evJsonObjA = generateEvidenceJson(evRowsA, {
    projectId: projAId,
    projectTitle: "StudySync",
    mode: "LIVE",
  });
  const parsedEvJsonA = JSON.parse(JSON.stringify(evJsonObjA));
  assert(parsedEvJsonA.export_type === "evidence_ledger", "Evidence JSON export_type is evidence_ledger");
  assert(parsedEvJsonA.metrics.total_evidence === 3, "Evidence JSON total metrics is 3");

  // Filename Sanitization
  const safeName = sanitizeFilename("StudySync: Peer Mentoring / 2026?*");
  assert(safeName === "studysync-peer-mentoring-2026", `Filename sanitized safely: ${safeName}`);
  console.log();

  // ── SUITE 16: Production Database Post-Execution Invariance Check ───────────
  console.log("Suite 16: Production Database Post-Execution Invariance Check");
  assert(fs.existsSync(prodDbPath), "Production DB still exists");
  const postCounts = await getTableCounts(prodDbPath);
  let postInvariancePass = true;
  for (const [table, exp] of Object.entries(EXPECTED_PROD_COUNTS)) {
    const postCount = postCounts[table];
    if (postCount !== exp) {
      postInvariancePass = false;
      console.error(`  ✗ Post-execution mismatch on ${table}: expected ${exp}, got ${postCount}`);
    }
  }
  assert(postInvariancePass, "All 16 production tables remain 100% invariant against baseline (0 writes to production)");
  console.log();

  // Teardown isolated test database
  try {
    fs.unlinkSync(isolatedDbPath);
  } catch {}

  console.log("================================================================================");
  console.log(`  Master E2E Gate Complete: ${passedAssertions} PASSED, ${failedAssertions} FAILED, ${skippedChecks} SKIPPED`);
  console.log("================================================================================\n");

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runMasterE2eGate().catch((err) => {
  console.error("Unhandled error during Master E2E gate execution:", err);
  process.exit(1);
});
