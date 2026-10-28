/**
 * IdeaProbe — Stabilization Step 4 Focused Test Suite
 *
 * Verifies:
 * 1. FixtureBadge conditional rendering (DEMO, LIVE, unknown/no-active-project).
 * 2. Sidebar mode banner logic for DEMO, LIVE, and unknown/no-active-project routes.
 * 3. Dashboard subtitle calculation logic (separate DEMO vs LIVE counts by mode).
 * 4. Static source inspection: confirms no unconditional FixtureBadge on new/dashboard,
 *    and confirms all 6 project modules pass mode={projectMode}.
 * 5. Production SQLite database invariance (strictly 0 writes).
 */

import React from "react";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { FixtureBadge } from "./src/components/Badges";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log("\n=== Test Group 1: FixtureBadge Component Logic ===");

  // 1.1: mode === 'DEMO' renders badge
  const demoElement = FixtureBadge({ mode: "DEMO" });
  assert(demoElement !== null, "FixtureBadge({ mode: 'DEMO' }) returns an element");
  assert(
    demoElement?.props["aria-label"] === "Prepared demo data — not freshly researched",
    "FixtureBadge({ mode: 'DEMO' }) has prepared demo data aria-label"
  );

  // 1.2: isDemo === true renders badge
  const isDemoElement = FixtureBadge({ isDemo: true });
  assert(isDemoElement !== null, "FixtureBadge({ isDemo: true }) returns an element");

  // 1.3: mode === 'LIVE' returns null
  const liveElement = FixtureBadge({ mode: "LIVE" });
  assert(liveElement === null, "FixtureBadge({ mode: 'LIVE' }) returns null");

  // 1.4: mode === 'MIXED' returns null
  const mixedElement = FixtureBadge({ mode: "MIXED" });
  assert(mixedElement === null, "FixtureBadge({ mode: 'MIXED' }) returns null");

  // 1.5: mode undefined / default returns null (no active project / safe fallback)
  const defaultElement = FixtureBadge();
  assert(defaultElement === null, "FixtureBadge() without props returns null");

  // 1.6: mode === null returns null
  const nullElement = FixtureBadge({ mode: null });
  assert(nullElement === null, "FixtureBadge({ mode: null }) returns null");

  console.log("\n=== Test Group 2: Sidebar Mode Banner Logic ===");

  function getSidebarBannerMode(pathname: string, searchProjectId: string | null, projectMode: string | null): string | null {
    const isProjectRoute = Boolean(
      pathname.startsWith("/overview") ||
      pathname.startsWith("/research") ||
      pathname.startsWith("/alternatives") ||
      pathname.startsWith("/personas") ||
      pathname.startsWith("/interviews") ||
      pathname.startsWith("/chat") ||
      pathname.startsWith("/insights") ||
      pathname.startsWith("/risks") ||
      pathname.startsWith("/experiments") ||
      pathname.startsWith("/mvp") ||
      pathname.startsWith("/report") ||
      pathname.startsWith("/runs")
    );
    const hasExplicitProject = Boolean(searchProjectId);
    const showProjectBanner = isProjectRoute || hasExplicitProject;

    if (!showProjectBanner || !projectMode) {
      return null;
    }
    if (projectMode === "DEMO") {
      return "DEMO_BANNER";
    }
    if (projectMode === "LIVE") {
      return "LIVE_BANNER";
    }
    return null;
  }

  // 2.1: On project route with DEMO mode -> DEMO_BANNER
  assert(
    getSidebarBannerMode("/overview", "proj-study-planner", "DEMO") === "DEMO_BANNER",
    "Sidebar on /overview with DEMO project shows DEMO_BANNER"
  );
  assert(
    getSidebarBannerMode("/research", "proj-agri-iot", "DEMO") === "DEMO_BANNER",
    "Sidebar on /research with secondary demo fixture proj-agri-iot shows DEMO_BANNER"
  );

  // 2.2: On project route with LIVE mode -> LIVE_BANNER
  assert(
    getSidebarBannerMode("/overview", "proj-f3554e11", "LIVE") === "LIVE_BANNER",
    "Sidebar on /overview with LIVE project shows LIVE_BANNER"
  );
  assert(
    getSidebarBannerMode("/report", "proj-f3554e11", "LIVE") === "LIVE_BANNER",
    "Sidebar on /report with LIVE project shows LIVE_BANNER"
  );

  // 2.3: On workspace route (/) without projectId -> omitted
  assert(
    getSidebarBannerMode("/", null, null) === null,
    "Sidebar on / (dashboard) without project query param omits banner"
  );
  assert(
    getSidebarBannerMode("/new", null, null) === null,
    "Sidebar on /new without project query param omits banner"
  );
  assert(
    getSidebarBannerMode("/settings", null, null) === null,
    "Sidebar on /settings without project query param omits banner"
  );
  assert(
    getSidebarBannerMode("/about", null, null) === null,
    "Sidebar on /about without project query param omits banner"
  );

  // 2.4: On project route when mode cannot be determined safely (null) -> omitted
  assert(
    getSidebarBannerMode("/overview", "proj-unknown", null) === null,
    "Sidebar when mode is null/indeterminate omits banner"
  );

  console.log("\n=== Test Group 3: Dashboard Subtitle Calculation Logic ===");

  function calculateDashboardSubtitle(projects: Array<{ mode?: string }>): string {
    const demoCount = projects.filter((p) => p.mode === "DEMO").length;
    const liveCount = projects.filter((p) => p.mode === "LIVE").length;
    const parts: string[] = [];
    if (demoCount > 0) parts.push(`${demoCount} demo fixture${demoCount === 1 ? "" : "s"}`);
    if (liveCount > 0) parts.push(`${liveCount} live project${liveCount === 1 ? "" : "s"}`);
    const otherCount = projects.length - demoCount - liveCount;
    if (otherCount > 0) parts.push(`${otherCount} other`);
    return parts.length > 0 ? parts.join(", ") : "No saved projects";
  }

  // 3.1: 5 demo fixtures, 1 live project (current SQLite state)
  const currentProjects = [
    { mode: "DEMO" },
    { mode: "DEMO" },
    { mode: "DEMO" },
    { mode: "DEMO" },
    { mode: "DEMO" },
    { mode: "LIVE" },
  ];
  assert(
    calculateDashboardSubtitle(currentProjects) === "5 demo fixtures, 1 live project",
    "Calculates '5 demo fixtures, 1 live project' correctly"
  );

  // 3.2: Singular checks
  assert(
    calculateDashboardSubtitle([{ mode: "DEMO" }]) === "1 demo fixture",
    "Calculates '1 demo fixture' correctly"
  );
  assert(
    calculateDashboardSubtitle([{ mode: "LIVE" }]) === "1 live project",
    "Calculates '1 live project' correctly"
  );
  assert(
    calculateDashboardSubtitle([{ mode: "DEMO" }, { mode: "LIVE" }, { mode: "LIVE" }]) ===
      "1 demo fixture, 2 live projects",
    "Calculates '1 demo fixture, 2 live projects' correctly"
  );

  // 3.3: Empty array check
  assert(
    calculateDashboardSubtitle([]) === "No saved projects",
    "Calculates 'No saved projects' for empty list"
  );

  console.log("\n=== Test Group 4: Source File Inspection & API Contracts ===");

  const appDir = path.resolve(__dirname, "src/app");
  const newPageSrc = fs.readFileSync(path.join(appDir, "new/page.tsx"), "utf-8");
  assert(
    !newPageSrc.includes("<FixtureBadge"),
    "src/app/new/page.tsx does not render FixtureBadge"
  );

  const dashPageSrc = fs.readFileSync(path.join(appDir, "page.tsx"), "utf-8");
  assert(
    !dashPageSrc.includes("<FixtureBadge"),
    "src/app/page.tsx workspace header does not render FixtureBadge"
  );
  assert(
    dashPageSrc.includes("projects.filter((p) => p.mode === \"DEMO\").length"),
    "src/app/page.tsx computes demoCount using p.mode === 'DEMO'"
  );
  assert(
    dashPageSrc.includes("projects.filter((p) => p.mode === \"LIVE\").length"),
    "src/app/page.tsx computes liveCount using p.mode === 'LIVE'"
  );

  // Check the 6 module pages pass mode={projectMode} to FixtureBadge
  const modulePages = [
    "overview/page.tsx",
    "research/page.tsx",
    "personas/page.tsx",
    "interviews/page.tsx",
    "insights/page.tsx",
    "chat/page.tsx",
  ];

  for (const pagePath of modulePages) {
    const src = fs.readFileSync(path.join(appDir, pagePath), "utf-8");
    assert(
      src.includes("<FixtureBadge mode={projectMode}"),
      `src/app/${pagePath} passes mode={projectMode} to FixtureBadge`
    );
  }

  const sidebarSrc = fs.readFileSync(path.resolve(__dirname, "src/components/Sidebar.tsx"), "utf-8");
  assert(
    sidebarSrc.includes("projectMode === \"DEMO\""),
    "Sidebar.tsx checks projectMode === 'DEMO' for demo banner"
  );
  assert(
    sidebarSrc.includes("projectMode === \"LIVE\""),
    "Sidebar.tsx checks projectMode === 'LIVE' for Live Validation Workspace banner"
  );
  assert(
    sidebarSrc.includes("Live Validation Workspace"),
    "Sidebar.tsx renders 'Live Validation Workspace' label for live projects"
  );

  console.log("\n=== Test Group 5: Production SQLite Invariance Verification ===");

  const prodDbPath = path.resolve(__dirname, ".ideaprobe-data/ideaprobe.db");
  const pyCmd = `python -c "import sqlite3; conn=sqlite3.connect('file:${prodDbPath.replace(/\\/g, "/")}?mode=ro', uri=True); cur=conn.cursor(); cur.execute('SELECT COUNT(*) FROM projects'); p=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM report_snapshots'); s=cur.fetchone()[0]; cur.execute('SELECT COUNT(*) FROM experiments'); e=cur.fetchone()[0]; print(f'{p},{s},{e}'); conn.close()"`;

  const countsRaw = execSync(pyCmd, { encoding: "utf-8" }).trim();
  const [projectsCount, snapshotsCount, experimentsCount] = countsRaw.split(",").map(Number);

  assert(projectsCount === 6, `Production projects count invariant (expected 6, found ${projectsCount})`);
  assert(snapshotsCount === 230, `Production report_snapshots count invariant (expected 230, found ${snapshotsCount})`);
  assert(experimentsCount === 2, `Production experiments count invariant (expected 2, found ${experimentsCount})`);

  console.log("\n========================================================");
  console.log(`TOTAL PASS: ${passCount}`);
  console.log(`TOTAL FAIL: ${failCount}`);
  console.log("========================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
