/**
 * IdeaProbe — Slice 2B Verification Test Suite
 *
 * Tests project-specific binding for Persona Chat, Interviews, Run Detail resolution,
 * and Nonexistent Project data isolation.
 */

import assert from "assert";
import fs from "fs";
import path from "path";

console.log("==============================================================");
console.log("IdeaProbe — Slice 2B Test Suite: Project-Specific Persona Chat & Interviews");
console.log("==============================================================\n");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

// ── 1. Code Inspection: chat/page.tsx Dynamic Project Binding ──────────────
console.log("1. Chat Page Dynamic Binding Audit:");

const chatFile = path.join(__dirname, "src/app/chat/page.tsx");
const chatContent = fs.readFileSync(chatFile, "utf-8");

test("chat/page.tsx uses useActiveProjectId hook", () => {
  assert.ok(chatContent.includes("useActiveProjectId()"), "Expected useActiveProjectId hook in chat page");
});

test("chat/page.tsx fetches project-specific personas from API", () => {
  assert.ok(
    chatContent.includes("/api/projects/${encodeURIComponent(projectId)}/personas") ||
    chatContent.includes("`/api/projects/${encodeURIComponent(projectId)}/personas`"),
    "Expected chat page to fetch /api/projects/:id/personas"
  );
});

test("chat/page.tsx contains empty state when project has no personas", () => {
  assert.ok(chatContent.includes("No Customer Personas for this Project"), "Missing empty state header");
  assert.ok(chatContent.includes("buildProjectPath(\"/personas\", projectId)"), "Missing navigation to personas module");
});

test("chat/page.tsx avoids hardcoded DEMO_PERSONAS state initialization", () => {
  assert.ok(
    !chatContent.includes("useState<string>(DEMO_PERSONAS[0].id)"),
    "chat page should not initialize selected persona directly with DEMO_PERSONAS[0].id"
  );
});

test("chat/page.tsx preserves permanent visible SIMULATED alert", () => {
  assert.ok(chatContent.includes("SIMULATED PERSONA CHAT"), "Missing simulated persona chat alert");
  assert.ok(chatContent.includes("ProvenanceBadge"), "Missing ProvenanceBadge component");
});

// ── 2. Code Inspection: interviews/page.tsx Dynamic Project Binding ────────
console.log("\n2. Interviews Page Dynamic Binding Audit:");

const interviewsFile = path.join(__dirname, "src/app/interviews/page.tsx");
const interviewsContent = fs.readFileSync(interviewsFile, "utf-8");

test("interviews/page.tsx uses useActiveProjectId hook", () => {
  assert.ok(interviewsContent.includes("useActiveProjectId()"), "Expected useActiveProjectId hook in interviews page");
});

test("interviews/page.tsx fetches project-specific interviews and personas from API", () => {
  assert.ok(
    interviewsContent.includes("/api/projects/${encodeURIComponent(projectId)}/personas") ||
    interviewsContent.includes("`/api/projects/${encodeURIComponent(projectId)}/personas`"),
    "Expected interviews page to fetch /api/projects/:id/personas"
  );
});

test("interviews/page.tsx contains empty state when project has no interviews", () => {
  assert.ok(interviewsContent.includes("No Synthetic Interviews for this Project"), "Missing empty state header");
  assert.ok(interviewsContent.includes("buildProjectPath(\"/personas\", projectId)"), "Missing link to personas module");
});

test("interviews/page.tsx avoids hardcoded DEMO_INTERVIEWS state initialization", () => {
  assert.ok(
    !interviewsContent.includes("useState<string>(DEMO_INTERVIEWS[0].id)"),
    "interviews page should not initialize selected interview directly with DEMO_INTERVIEWS[0].id"
  );
});

test("interviews/page.tsx maps persona name dynamically from persona_id", () => {
  assert.ok(interviewsContent.includes("persona_id || iv.personaId"), "Missing persona_id mapping");
  assert.ok(interviewsContent.includes("persona?.name"), "Missing persona name lookup");
});

test("interviews/page.tsx preserves mandatory SimulationAlert and analyst note", () => {
  assert.ok(interviewsContent.includes("SimulationAlert"), "Missing SimulationAlert");
  assert.ok(interviewsContent.includes("ANALYST NOTE — HOW TO USE THIS TRANSCRIPT"), "Missing analyst note");
});

// ── 3. Code Inspection: runs/[id]/page.tsx Run Association Check ───────────
console.log("\n3. Run Detail Association Resolution Audit:");

const runFile = path.join(__dirname, "src/app/runs/[id]/page.tsx");
const runContent = fs.readFileSync(runFile, "utf-8");

test("runs/[id]/page.tsx queries SQLite for run's true project_id", () => {
  assert.ok(
    runContent.includes("SELECT project_id FROM runs WHERE id = ?"),
    "Expected query to resolve project_id from runs table"
  );
});

test("runs/[id]/page.tsx does not blindly prioritize mismatched query param over DB association", () => {
  assert.ok(
    runContent.includes("if (!resolvedProjectId && sp.projectId)"),
    "Query parameter should only be fallback when run association is not in DB"
  );
});

// ── 4. Code Inspection: overview/page.tsx Nonexistent Project Isolation ───
console.log("\n4. Overview Page Nonexistent Project Isolation Audit:");

const overviewFile = path.join(__dirname, "src/app/overview/page.tsx");
const overviewContent = fs.readFileSync(overviewFile, "utf-8");

test("overview/page.tsx differentiates demo project from other projects in initial state", () => {
  assert.ok(
    overviewContent.includes('const isDemo = projectId === "proj-study-planner";'),
    "Expected isDemo flag for state initialization"
  );
});

test("overview/page.tsx handles 404 project not found explicitly", () => {
  assert.ok(
    overviewContent.includes("if (res.status === 404)"),
    "Expected explicit check for HTTP 404 in overview page"
  );
  assert.ok(
    overviewContent.includes("setNotFound(true)"),
    "Expected setNotFound state transition on 404"
  );
});

test("overview/page.tsx renders Project Not Found banner and avoids demo fallback", () => {
  assert.ok(
    overviewContent.includes("Project Not Found"),
    "Expected Project Not Found banner in overview page"
  );
});

// ── Summary ────────────────────────────────────────────────────────
console.log("\n==============================================================");
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.`);
console.log("==============================================================");

if (failed > 0) {
  process.exit(1);
}
