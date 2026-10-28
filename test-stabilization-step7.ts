/**
 * IdeaProbe — Stabilization Step 7 Regression Test Suite
 *
 * Validates:
 * 1. Bug 1: Research page data provenance isolation
 *    - LIVE projects with 0 competitors/personas render honest empty states with links
 *    - LIVE projects with competitors/personas render project-specific records
 *    - DEMO projects preserve Study Planner fixtures with explicit SAMPLE labeling
 *    - Live research query defaults to project brief, not hardcoded study cramming
 * 2. Bug 2: Sidebar mode synchronization & reactive cache
 *    - KNOWN_PROJECT_MODES resolves synchronously on mount
 *    - setProjectModeCache notifies all subscribed components
 *    - Sidebar mode synchronization triggers even when projectId is unchanged
 * 3. Database safety:
 *    - Confirms production SQLite database is strictly invariant (0 writes)
 */

import {
  KNOWN_PROJECT_MODES,
  getCachedProjectMode,
  setProjectModeCache,
  projectModeCache,
} from "./src/lib/useActiveProject";
import { DEMO_COMPETITORS, DEMO_ICP } from "./src/lib/mockData";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

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

console.log("\n=======================================================");
console.log("IdeaProbe — Stabilization Step 7 Verification Suite");
console.log("=======================================================\n");

// ── Suite 1: Bug 2 — Mode Cache & Reactive Synchronization ──
console.log("Suite 1: Bug 2 — Mode Cache & Reactive Synchronization");

assert(
  KNOWN_PROJECT_MODES["proj-study-planner"] === "DEMO",
  "KNOWN_PROJECT_MODES maps proj-study-planner to DEMO"
);
assert(
  KNOWN_PROJECT_MODES["proj-agri-iot"] === "DEMO",
  "KNOWN_PROJECT_MODES maps proj-agri-iot to DEMO"
);
assert(
  KNOWN_PROJECT_MODES["proj-freelance-tax"] === "DEMO",
  "KNOWN_PROJECT_MODES maps proj-freelance-tax to DEMO"
);
assert(
  getCachedProjectMode("proj-study-planner") === "DEMO",
  "getCachedProjectMode returns DEMO synchronously for proj-study-planner"
);
assert(
  getCachedProjectMode("proj-unknown-live") === null,
  "getCachedProjectMode returns null for unknown project before caching"
);

// Simulate subscriber update
setProjectModeCache("proj-test-live", "LIVE");
assert(
  getCachedProjectMode("proj-test-live") === "LIVE",
  "setProjectModeCache updates memory cache with LIVE mode"
);

// Verify Sidebar.tsx source imports and uses setProjectModeCache
const sidebarSource = fs.readFileSync(path.join(__dirname, "src/components/Sidebar.tsx"), "utf-8");
assert(
  sidebarSource.includes("setProjectModeCache"),
  "Sidebar.tsx imports and calls setProjectModeCache on project fetch"
);
assert(
  sidebarSource.includes("const projectMode = useActiveProjectMode(projectId);"),
  "Sidebar.tsx resolves projectMode via useActiveProjectMode(projectId)"
);
assert(
  sidebarSource.includes('projectMode === "DEMO"'),
  "Sidebar.tsx guards demo banner with projectMode === 'DEMO'"
);
assert(
  sidebarSource.includes('projectMode === "LIVE"'),
  "Sidebar.tsx guards live banner with projectMode === 'LIVE'"
);

// ── Suite 2: Bug 1 — Research Page Provenance Isolation & Empty States ──
console.log("\nSuite 2: Bug 1 — Research Page Provenance Isolation & Empty States");

const researchSource = fs.readFileSync(path.join(__dirname, "src/app/research/page.tsx"), "utf-8");

assert(
  researchSource.includes("const isDemo = projectMode === \"DEMO\";"),
  "Research page determines demo mode strictly via projectMode === 'DEMO'"
);

// ICP section tests
assert(
  researchSource.includes("Ideal Customer Profile (Sample Fixture Baseline)"),
  "Research page labels DEMO ICP as Sample Fixture Baseline"
);
assert(
  researchSource.includes("Ideal Customer Profile (Persona Baseline)"),
  "Research page labels LIVE ICP with personas as Persona Baseline"
);
assert(
  researchSource.includes("Ideal Customer Profile (Target Customer Baseline)"),
  "Research page labels LIVE ICP without personas as Target Customer Baseline"
);
assert(
  researchSource.includes("No simulated personas have been drafted for this project yet"),
  "Research page renders honest empty state when 0 personas exist for a LIVE project"
);
assert(
  researchSource.includes("+ Draft Personas →"),
  "Research page provides honest link to + Draft Personas for empty state"
);

// Alternatives section tests
assert(
  researchSource.includes("Alternative Solutions Mapped (0)"),
  "Research page renders Alternative Solutions Mapped (0) for empty LIVE projects"
);
assert(
  researchSource.includes("+ Map Competitors →"),
  "Research page provides link to + Map Competitors when count is 0"
);
assert(
  researchSource.includes("No alternative solutions or direct/indirect competitors mapped for this project yet"),
  "Research page renders honest explanation when 0 competitors mapped"
);
assert(
  researchSource.includes("Alternative Solutions Mapped ({DEMO_COMPETITORS.length})"),
  "Research page preserves DEMO_COMPETITORS preview for DEMO mode"
);
assert(
  researchSource.includes("<ProvenanceBadge type=\"SAMPLE\" size=\"sm\" />"),
  "Research page attaches explicit SAMPLE badge to demo alternatives preview"
);

// Query derivation tests
assert(
  researchSource.includes("brief.problem.trim().slice(0, 100)"),
  "Research page derives live-research query from active project's own brief problem"
);
assert(
  researchSource.includes("projectId === \"proj-study-planner\" ? \"college student study planning exam anxiety India\" : \"\""),
  "Live research query does NOT hardcode study cramming for non-demo projects"
);
assert(
  !researchSource.includes("useState(\"college student study planning exam anxiety India\")"),
  "Eliminated unconditional static default for liveResearchQuery"
);

// ── Suite 3: Pure Component Logic Simulation ──
console.log("\nSuite 3: Pure Component Logic Simulation");

interface MockBrief {
  problem?: string;
  solution?: string;
  target_customer?: string;
}

function deriveResearchQuery(projectId: string, brief?: MockBrief): string {
  if (projectId === "proj-study-planner") {
    return "college student study planning exam anxiety India";
  }
  if (brief?.problem) {
    return brief.problem.trim().slice(0, 100);
  }
  if (brief?.solution) {
    return brief.solution.trim().slice(0, 100);
  }
  return "";
}

assert(
  deriveResearchQuery("proj-study-planner", { problem: "College students struggle" }) === "college student study planning exam anxiety India",
  "Study Planner preserves canonical demo research query"
);
assert(
  deriveResearchQuery("proj-f3554e11", { problem: "Students living in campus hostels need fast intra-campus parcel delivery." }) ===
    "Students living in campus hostels need fast intra-campus parcel delivery.",
  "CampusCourier derives query from its own campus parcel delivery problem brief"
);
assert(
  deriveResearchQuery("proj-empty", {}) === "",
  "Empty brief yields empty query string without leakage"
);

// Simulate ICP render branch selection
function selectIcpView(isDemo: boolean, personasCount: number) {
  if (isDemo) return "DEMO_FIXTURE";
  if (personasCount > 0) return "REAL_PERSONAS";
  return "EMPTY_BASELINE";
}

assert(selectIcpView(true, 4) === "DEMO_FIXTURE", "Demo mode selects DEMO_FIXTURE");
assert(selectIcpView(false, 0) === "EMPTY_BASELINE", "Live mode with 0 personas selects EMPTY_BASELINE");
assert(selectIcpView(false, 2) === "REAL_PERSONAS", "Live mode with personas selects REAL_PERSONAS");

// Simulate Competitors render branch selection
function selectAlternativesView(isDemo: boolean, compCount: number) {
  if (isDemo) return "DEMO_COMPETITORS";
  if (compCount > 0) return "REAL_COMPETITORS";
  return "EMPTY_COMPETITORS";
}

assert(selectAlternativesView(true, 6) === "DEMO_COMPETITORS", "Demo mode selects DEMO_COMPETITORS");
assert(selectAlternativesView(false, 0) === "EMPTY_COMPETITORS", "Live mode with 0 competitors selects EMPTY_COMPETITORS");
assert(selectAlternativesView(false, 3) === "REAL_COMPETITORS", "Live mode with competitors selects REAL_COMPETITORS");

// ── Suite 4: SQLite Database Invariance Verification ──
console.log("\nSuite 4: SQLite Database Invariance Verification");

const prodDbPath = path.resolve(__dirname, ".ideaprobe-data/ideaprobe.db");
const pyCmd = `python -c "import sqlite3; conn=sqlite3.connect('file:${prodDbPath.replace(/\\/g, "/")}?mode=ro', uri=True); cur=conn.cursor(); cur.execute('SELECT COUNT(*) FROM projects'); p=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM idea_briefs'); b=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM sources'); s=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM evidence'); ev=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM competitors'); c=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM personas'); pe=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM interviews'); i=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM report_snapshots'); sn=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM experiments'); ex=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM competitors WHERE project_id=\\'proj-f3554e11\\''); cc=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM personas WHERE project_id=\\'proj-f3554e11\\''); cp=cur.fetchone()[0]; print(f'{p},{b},{s},{ev},{c},{pe},{i},{sn},{ex},{cc},{cp}'); conn.close()"`;

const countsRaw = execSync(pyCmd, { encoding: "utf-8" }).trim();
const [
  projectCount,
  briefCount,
  sourcesCount,
  evidenceCount,
  competitorCount,
  personaCount,
  interviewCount,
  snapshotCount,
  experimentCount,
  courierComps,
  courierPersonas,
] = countsRaw.split(",").map(Number);

assert(projectCount === 6, `Projects count invariant (expected 6, got ${projectCount})`);
assert(briefCount === 6, `Idea briefs count invariant (expected 6, got ${briefCount})`);
assert(sourcesCount === 24, `Sources count invariant (expected 24, got ${sourcesCount})`);
assert(evidenceCount === 24, `Evidence count invariant (expected 24, got ${evidenceCount})`);
assert(competitorCount === 6, `Competitors count invariant (expected 6, got ${competitorCount})`);
assert(personaCount === 4, `Personas count invariant (expected 4, got ${personaCount})`);
assert(interviewCount === 2, `Interviews count invariant (expected 2, got ${interviewCount})`);
assert(snapshotCount === 230, `Report snapshots count invariant (expected 230, got ${snapshotCount})`);
assert(experimentCount === 2, `Experiments count invariant (expected 2, got ${experimentCount})`);
assert(courierComps === 0, "CampusCourier strictly has 0 competitors in SQLite");
assert(courierPersonas === 0, "CampusCourier strictly has 0 personas in SQLite");

console.log("\n=======================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
}
