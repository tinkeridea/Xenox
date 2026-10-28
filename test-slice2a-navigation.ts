/**
 * Slice 2A Test Suite — Active Project Context & Navigation Binding
 *
 * Verifies:
 * 1. extractActiveProjectId resolution priority and fallbacks.
 * 2. buildProjectPath URL encoding and query preservation.
 * 3. Static AST audit: Zero hardcoded "proj-study-planner" in UI pages.
 * 4. All pipeline pages properly integrate useActiveProjectId.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  extractActiveProjectId,
  buildProjectPath,
  DEFAULT_PROJECT_ID,
  KNOWN_PROJECT_TITLES,
} from "./src/lib/useActiveProject";

let testsPassed = 0;
function test(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }
}

console.log("\n🧪 Running Slice 2A Project Context & Navigation Test Suite...\n");

// ── 1. extractActiveProjectId Unit Tests ─────────────────────────────
console.log("1. Project Context Extraction Tests:");

test("Falls back to DEFAULT_PROJECT_ID when no context is provided", () => {
  const result = extractActiveProjectId(null, null);
  assert.strictEqual(result, DEFAULT_PROJECT_ID);
  assert.strictEqual(result, "proj-study-planner");
});

test("Falls back to DEFAULT_PROJECT_ID when query param is empty", () => {
  const searchParams = { get: (key: string) => (key === "projectId" ? "" : null) };
  const result = extractActiveProjectId("/overview", searchParams);
  assert.strictEqual(result, "proj-study-planner");
});

test("Extracts projectId from searchParams when present", () => {
  const searchParams = { get: (key: string) => (key === "projectId" ? "proj-agri-iot" : null) };
  const result = extractActiveProjectId("/overview", searchParams);
  assert.strictEqual(result, "proj-agri-iot");
});

test("Extracts projectId from /runs/:id path when :id starts with proj-", () => {
  const result = extractActiveProjectId("/runs/proj-freelance-tax", null);
  assert.strictEqual(result, "proj-freelance-tax");
});

test("Search param takes precedence over /runs/:id path", () => {
  const searchParams = { get: (key: string) => (key === "projectId" ? "proj-param" : null) };
  const result = extractActiveProjectId("/runs/proj-path", searchParams);
  assert.strictEqual(result, "proj-param");
});

test("Explicit overrideId takes absolute precedence", () => {
  const searchParams = { get: (key: string) => (key === "projectId" ? "proj-param" : null) };
  const result = extractActiveProjectId("/runs/proj-path", searchParams, "proj-override");
  assert.strictEqual(result, "proj-override");
});

test("/runs/demo-run-001 with no searchParams falls back to DEFAULT_PROJECT_ID", () => {
  const result = extractActiveProjectId("/runs/demo-run-001", null);
  assert.strictEqual(result, "proj-study-planner");
});

// ── 2. buildProjectPath Unit Tests ──────────────────────────────────
console.log("\n2. Project Path Construction Tests:");

test("Appends projectId to route without existing query string", () => {
  const result = buildProjectPath("/overview", "proj-agri-iot");
  assert.strictEqual(result, "/overview?projectId=proj-agri-iot");
});

test("Preserves existing query params while appending projectId", () => {
  const result = buildProjectPath("/experiments?assumptionId=asm-001", "proj-agri-iot");
  assert.strictEqual(result, "/experiments?assumptionId=asm-001&projectId=proj-agri-iot");
});

test("Updates existing projectId in query string if already present", () => {
  const result = buildProjectPath("/overview?projectId=old-project", "proj-new-project");
  assert.strictEqual(result, "/overview?projectId=proj-new-project");
});

test("Encodes special characters in projectId safely", () => {
  const result = buildProjectPath("/overview", "proj test&special=1");
  assert.strictEqual(result, "/overview?projectId=proj+test%26special%3D1");
});

// ── 3. Static AST / Source Code Audit ───────────────────────────────
console.log("\n3. Static Source Code Hardcoding Audit:");

const UI_PAGES = [
  "src/app/overview/page.tsx",
  "src/app/alternatives/page.tsx",
  "src/app/personas/page.tsx",
  "src/app/insights/page.tsx",
  "src/app/risks/page.tsx",
  "src/app/experiments/page.tsx",
  "src/app/mvp/page.tsx",
  "src/app/report/page.tsx",
  "src/app/research/page.tsx",
];

for (const relPath of UI_PAGES) {
  const fullPath = path.join(__dirname, relPath);
  const content = fs.readFileSync(fullPath, "utf-8");

  test(`Zero hardcoded projectId assignment in ${relPath}`, () => {
    assert.strictEqual(
      content.includes('const projectId = "proj-study-planner";'),
      false,
      `Found hardcoded const projectId = "proj-study-planner" in ${relPath}`
    );
    assert.strictEqual(
      content.includes('const PROJECT_ID = "proj-study-planner";'),
      false,
      `Found hardcoded const PROJECT_ID = "proj-study-planner" in ${relPath}`
    );
    assert.strictEqual(
      content.includes('useState("proj-study-planner")'),
      false,
      `Found hardcoded useState("proj-study-planner") in ${relPath}`
    );
  });

  test(`${relPath} imports useActiveProjectId`, () => {
    assert.ok(
      content.includes("useActiveProjectId"),
      `Expected ${relPath} to import and use useActiveProjectId`
    );
  });
}

test("Sidebar.tsx uses useActiveProjectId and buildProjectPath", () => {
  const sidebarContent = fs.readFileSync(path.join(__dirname, "src/components/Sidebar.tsx"), "utf-8");
  assert.ok(sidebarContent.includes("useActiveProjectId"), "Sidebar missing useActiveProjectId");
  assert.ok(sidebarContent.includes("buildProjectPath"), "Sidebar missing buildProjectPath");
});

test("StageList.tsx uses buildProjectPath for stage navigation", () => {
  const stageListContent = fs.readFileSync(path.join(__dirname, "src/components/StageList.tsx"), "utf-8");
  assert.ok(stageListContent.includes("buildProjectPath"), "StageList missing buildProjectPath");
  assert.ok(
    stageListContent.includes("href={buildProjectPath(STAGE_ROUTE_MAP[key], activeProjectId)}"),
    "StageList Inspect Module link must use buildProjectPath"
  );
});

test("IdeaForm.tsx submits mode: LIVE and provenance: USER_INPUT for new projects (Step 2B)", () => {
  const ideaFormContent = fs.readFileSync(path.join(__dirname, "src/components/IdeaForm.tsx"), "utf-8");
  assert.ok(ideaFormContent.includes('mode: "LIVE"'), "IdeaForm must submit mode: LIVE");
  assert.ok(ideaFormContent.includes('provenance: "USER_INPUT"'), "IdeaForm must submit provenance: USER_INPUT");
  assert.strictEqual(ideaFormContent.includes('mode: "DEMO"'), false, "IdeaForm must not hardcode mode: DEMO");
});

test("src/app/api/projects/route.ts defaults mode to LIVE for new creations (Step 2B)", () => {
  const routeContent = fs.readFileSync(path.join(__dirname, "src/app/api/projects/route.ts"), "utf-8");
  assert.ok(routeContent.includes('mode = "LIVE"'), "POST /api/projects must default mode to LIVE");
});

test("Dashboard page.tsx links project cards to dynamic overview with projectId", () => {
  const dashboardContent = fs.readFileSync(path.join(__dirname, "src/app/page.tsx"), "utf-8");
  assert.ok(
    dashboardContent.includes("/overview?projectId="),
    "Dashboard missing /overview?projectId= link"
  );
  assert.strictEqual(
    dashboardContent.includes('href={project.id === "proj-study-planner" ? "/overview" : `/runs/${project.id}`}'),
    false,
    "Dashboard still contains hardcoded ternary link"
  );
});

console.log(`\n🎉 All ${testsPassed} Slice 2A tests passed successfully!\n`);
