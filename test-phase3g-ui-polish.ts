/**
 * IdeaProbe — Phase 3G Verification Suite: Founder UI Polish
 *
 * Verifies:
 * 1. Interview navigation: Permanently disabled button replaced with Link to /chat.
 * 2. Edit Project Brief UI: Edit button present, modal markup, accessibility attributes.
 * 3. PATCH API Integration (Isolated Temp Database):
 *    - Rejection of empty update payload (400 NO_FIELDS_TO_UPDATE).
 *    - 404 for nonexistent project ID (404 PROJECT_NOT_FOUND).
 *    - Successful update of brief fields (problem, target_customer, solution, geography, category, stage).
 *    - Successful update of title.
 *    - Strict preservation of project ID, mode, status, and unrelated records (assumptions, experiments).
 *    - In-place refresh contract without full page reload.
 * 4. Production SQLite Database strict invariance (0 writes).
 */

import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { PATCH as updateProject, GET as getProject } from "./src/app/api/projects/[id]/route";

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
  console.log("IdeaProbe — Phase 3G: Founder UI Polish Test Suite");
  console.log("==========================================================================\n");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data", "ideaprobe.db");
  const scratchDir = path.resolve(__dirname, ".ideaprobe-data");
  const tempDbPath = path.resolve(scratchDir, "test-phase3g-isolated.db");

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
  const preBriefs = await prodClient.execute("SELECT COUNT(*) as cnt FROM idea_briefs");
  const preProjects = await prodClient.execute("SELECT COUNT(*) as cnt FROM projects");

  const baselineSnapshots = Number(preSnapshots.rows[0].cnt);
  const baselineExperiments = Number(preExperiments.rows[0].cnt);
  const baselineAssumptions = Number(preAssumptions.rows[0].cnt);
  const baselineBriefs = Number(preBriefs.rows[0].cnt);
  const baselineProjects = Number(preProjects.rows[0].cnt);

  assert(baselineSnapshots === 230, `Production report snapshots baseline is 230 (actual: ${baselineSnapshots})`);
  assert(baselineExperiments === 3, `Production experiments baseline is 3 (actual: ${baselineExperiments})`);
  assert(baselineAssumptions === 5, `Production assumptions baseline is 5 (actual: ${baselineAssumptions})`);
  assert(baselineBriefs === 6, `Production idea briefs baseline is 6 (actual: ${baselineBriefs})`);
  assert(baselineProjects === 6, `Production projects baseline is 6 (actual: ${baselineProjects})`);

  // ── Suite 2: Task 1 — Interview Navigation Audit ──
  console.log("\nSuite 2: Task 1 — Interview Navigation & Chat Link Verification");
  const interviewsPagePath = path.join(__dirname, "src/app/interviews/page.tsx");
  const interviewsSrc = fs.readFileSync(interviewsPagePath, "utf-8");

  assert(
    !interviewsSrc.includes('disabled title="Phase 4: Ollama interview generation"'),
    "interviews/page.tsx no longer contains the disabled 'Generate Interview' button"
  );
  assert(
    interviewsSrc.includes('id="open-persona-chat-btn"'),
    "interviews/page.tsx contains the open-persona-chat-btn link"
  );
  assert(
    interviewsSrc.includes('buildProjectPath("/chat", projectId)'),
    "interviews/page.tsx links to /chat with dynamic project context"
  );
  assert(
    interviewsSrc.includes("Open Persona Chat Simulator"),
    "Link has clear descriptive text 'Open Persona Chat Simulator'"
  );
  assert(
    interviewsSrc.includes("<SimulationAlert"),
    "SimulationAlert remains permanently visible on interviews/page.tsx (Decision D03)"
  );

  // Verify the target /chat route exists and handles dynamic project context
  const chatPagePath = path.join(__dirname, "src/app/chat/page.tsx");
  assert(fs.existsSync(chatPagePath), "Target route src/app/chat/page.tsx exists");
  const chatSrc = fs.readFileSync(chatPagePath, "utf-8");
  assert(
    chatSrc.includes("useActiveProjectId") && chatSrc.includes("useActiveProjectMode"),
    "Target /chat route is bound to dynamic active project context"
  );

  // ── Suite 3: Task 2 — Overview Page Edit Brief UI Audit ──
  console.log("\nSuite 3: Task 2 — Overview Page Edit Brief UI Audit");
  const overviewPagePath = path.join(__dirname, "src/app/overview/page.tsx");
  const overviewSrc = fs.readFileSync(overviewPagePath, "utf-8");

  assert(
    overviewSrc.includes('id="edit-brief-btn"'),
    "overview/page.tsx renders the Edit Brief action button"
  );
  assert(
    overviewSrc.includes("openEditModal"),
    "overview/page.tsx defines openEditModal to prepopulate saved values"
  );
  assert(
    overviewSrc.includes("isEditModalOpen"),
    "overview/page.tsx controls modal visibility with state"
  );
  assert(
    overviewSrc.includes('role="dialog"') && overviewSrc.includes('aria-modal="true"'),
    "Modal includes accessible ARIA dialog attributes"
  );
  assert(
    overviewSrc.includes("handleSaveBrief"),
    "overview/page.tsx defines handleSaveBrief submit handler"
  );
  assert(
    overviewSrc.includes("loadProjectOverview()"),
    "overview/page.tsx refreshes live project data without a full-page reload on save"
  );
  assert(
    overviewSrc.includes("saveSuccessFeedback"),
    "overview/page.tsx renders success feedback notification after brief save"
  );

  // ── Suite 4: Isolated Temporary Database PATCH API Integration ──
  console.log("\nSuite 4: Isolated Temporary Database PATCH API Integration");
  process.env.IDEAPROBE_DB_PATH = tempDbPath;
  resetDbClient();
  await initDb();
  const testDb = getDb();

  // Create test live project with brief, assumption, and experiment
  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: ["proj-ui-live", "Initial Courier Name", "LIVE", "active", "2026-10-26T00:00:00Z", "2026-10-26T00:00:00Z"],
  });
  await testDb.execute({
    sql: "INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, geography, category, stage, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "brief-ui-1",
      "proj-ui-live",
      1,
      "Original parcel delay problem",
      "Original hostel students",
      "Original concierge service",
      "Campus North",
      "logistics",
      "problem-validation",
      "USER_INPUT",
      "2026-10-26T00:00:00Z",
    ],
  });
  await testDb.execute({
    sql: "INSERT INTO assumptions (id, project_id, statement, category, impact, uncertainty, status, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "asm-ui-1",
      "proj-ui-live",
      "Students will pay ₹30 fee",
      "desirability",
      "High",
      "Critical",
      "unvalidated",
      "USER_INPUT",
      "2026-10-26T00:00:00Z",
    ],
  });
  await testDb.execute({
    sql: "INSERT INTO experiments (id, project_id, assumption_id, hypothesis, method, metric, threshold, status, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      "exp-ui-1",
      "proj-ui-live",
      "asm-ui-1",
      "If we offer concierge deliveries, 15 students order",
      "WhatsApp concierge",
      "Paid deliveries completed",
      ">= 10 paid deliveries",
      "planned",
      "USER_INPUT",
      "2026-10-26T00:00:00Z",
    ],
  });

  assert(true, "Isolated test database initialized with test project, brief, assumption, and experiment");

  // 1. Error on empty payload
  const emptyReq = new NextRequest("http://localhost:3000/api/projects/proj-ui-live", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const emptyRes = await updateProject(emptyReq, { params: Promise.resolve({ id: "proj-ui-live" }) });
  assert(emptyRes.status === 400, `Empty update returns HTTP 400 (got ${emptyRes.status})`);
  const emptyJson = await emptyRes.json();
  assert(emptyJson.error?.code === "NO_FIELDS_TO_UPDATE", `Empty update returns NO_FIELDS_TO_UPDATE (got ${emptyJson.error?.code})`);

  // 2. Error on nonexistent project
  const notFoundReq = new NextRequest("http://localhost:3000/api/projects/proj-nonexistent-999", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New Title" }),
  });
  const notFoundRes = await updateProject(notFoundReq, { params: Promise.resolve({ id: "proj-nonexistent-999" }) });
  assert(notFoundRes.status === 404, `Nonexistent project returns HTTP 404 (got ${notFoundRes.status})`);
  const notFoundJson = await notFoundRes.json();
  assert(notFoundJson.error?.code === "PROJECT_NOT_FOUND", `Nonexistent project returns PROJECT_NOT_FOUND (got ${notFoundJson.error?.code})`);

  // 3. Successful update of both project title and brief fields
  const updateReq = new NextRequest("http://localhost:3000/api/projects/proj-ui-live", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "CampusCourier Express",
      problem: "Hostel residents in Blocks C & D walk 20 minutes to main gate in extreme weather to fetch courier packages.",
      target_customer: "Hostel residents in Blocks C & D receiving 2+ parcels weekly",
      solution: "Peer-to-peer concierge WhatsApp broadcast network for fast dorm delivery",
      geography: "Campus Hostels Block C & D",
      category: "Campus Logistics",
      stage: "Solution Validation",
    }),
  });
  const updateRes = await updateProject(updateReq, { params: Promise.resolve({ id: "proj-ui-live" }) });
  assert(updateRes.status === 200, `Successful brief update returns HTTP 200 (got ${updateRes.status})`);

  // Verify in database: projects table updated
  const projRow = await testDb.execute({
    sql: "SELECT id, title, mode, status, updated_at FROM projects WHERE id = ?",
    args: ["proj-ui-live"],
  });
  assert(projRow.rows[0].title === "CampusCourier Express", `Project title updated to 'CampusCourier Express'`);
  assert(projRow.rows[0].mode === "LIVE", "Project mode strictly preserved as 'LIVE'");
  assert(projRow.rows[0].status === "active", "Project status strictly preserved as 'active'");

  // Verify in database: idea_briefs table updated
  const briefRow = await testDb.execute({
    sql: "SELECT * FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
    args: ["proj-ui-live"],
  });
  const updatedBrief = briefRow.rows[0];
  assert(
    updatedBrief.problem === "Hostel residents in Blocks C & D walk 20 minutes to main gate in extreme weather to fetch courier packages.",
    "Brief problem statement accurately updated in SQLite"
  );
  assert(
    updatedBrief.target_customer === "Hostel residents in Blocks C & D receiving 2+ parcels weekly",
    "Brief target_customer accurately updated in SQLite"
  );
  assert(
    updatedBrief.solution === "Peer-to-peer concierge WhatsApp broadcast network for fast dorm delivery",
    "Brief solution accurately updated in SQLite"
  );
  assert(
    updatedBrief.geography === "Campus Hostels Block C & D",
    "Brief geography accurately updated in SQLite"
  );
  assert(
    updatedBrief.category === "Campus Logistics",
    "Brief category accurately updated in SQLite"
  );
  assert(
    updatedBrief.stage === "Solution Validation",
    "Brief stage accurately updated in SQLite"
  );

  // 4. Strict preservation of unrelated entities
  const asmRow = await testDb.execute({
    sql: "SELECT id, statement, status, provenance FROM assumptions WHERE id = 'asm-ui-1'",
    args: [],
  });
  assert(asmRow.rows.length === 1, "Linked assumption asm-ui-1 preserved");
  assert(asmRow.rows[0].statement === "Students will pay ₹30 fee", "Assumption statement unmodified");
  assert(asmRow.rows[0].status === "unvalidated", "Assumption status unmutated");

  const expRow = await testDb.execute({
    sql: "SELECT id, hypothesis, status, result, provenance FROM experiments WHERE id = 'exp-ui-1'",
    args: [],
  });
  assert(expRow.rows.length === 1, "Linked experiment exp-ui-1 preserved");
  assert(expRow.rows[0].status === "planned", "Experiment status unmodified");
  assert(expRow.rows[0].result === null, "Experiment result remains null");

  // 5. Partial update: brief fields only (without project title)
  const partialReq = new NextRequest("http://localhost:3000/api/projects/proj-ui-live", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      problem: "Refined Problem: Main gate courier window is limited to 17:00-19:00 causing parcel pileup.",
    }),
  });
  const partialRes = await updateProject(partialReq, { params: Promise.resolve({ id: "proj-ui-live" }) });
  assert(partialRes.status === 200, `Partial brief update returns HTTP 200 (got ${partialRes.status})`);

  const partialBriefRow = await testDb.execute({
    sql: "SELECT problem, target_customer, solution FROM idea_briefs WHERE project_id = ? ORDER BY version DESC LIMIT 1",
    args: ["proj-ui-live"],
  });
  assert(
    partialBriefRow.rows[0].problem === "Refined Problem: Main gate courier window is limited to 17:00-19:00 causing parcel pileup.",
    "Partial update correctly updated problem statement"
  );
  assert(
    partialBriefRow.rows[0].target_customer === "Hostel residents in Blocks C & D receiving 2+ parcels weekly",
    "Other brief fields remained untouched during partial update"
  );

  // ── Suite 5: Final Production Database Invariance Check ──
  console.log("\nSuite 5: Final Production Database Invariance Check");
  const postSnapshots = await prodClient.execute("SELECT COUNT(*) as cnt FROM report_snapshots");
  const postExperiments = await prodClient.execute("SELECT COUNT(*) as cnt FROM experiments");
  const postAssumptions = await prodClient.execute("SELECT COUNT(*) as cnt FROM assumptions");
  const postBriefs = await prodClient.execute("SELECT COUNT(*) as cnt FROM idea_briefs");
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
    Number(postBriefs.rows[0].cnt) === baselineBriefs,
    `Production idea briefs invariant: ${postBriefs.rows[0].cnt} === ${baselineBriefs}`
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
    } catch {}
  }

  console.log("\n==========================================================================");
  console.log(`Phase 3G Test Results: ${passed} passed, ${failed} failed`);
  console.log("==========================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
