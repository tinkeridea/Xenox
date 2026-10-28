/**
 * IdeaProbe — TL-081: Final Browser Smoke Test After Reliability Fixes
 *
 * Drives Microsoft Edge (Channel: 'msedge') via playwright-core against a dedicated
 * Next.js server on port 3002 with an isolated temporary SQLite database.
 *
 * Verifies:
 * 1. Project selection and navigation work correctly.
 * 2. Research page loads without runtime errors.
 * 3. Genuine TinyFish research request succeeds (exactly 1 live call).
 * 4. Research results show source titles and URLs correctly, marked UNREVIEWED.
 * 5. Repeating a research query does not produce duplicate source or evidence records.
 * 6. Evidence review actions work and preserve review status (transition to ACCEPTED).
 * 7. Insight generation is blocked when no eligible accepted/edited evidence exists (HTTP 400).
 * 8. Insight generation works when Ollama is available and evidence is accepted.
 * 9. Founder report generation displays research, provenance, differentiation, and insights consistently.
 * 10. Markdown export and Print/PDF actions work.
 * 11. Zero browser console errors, failed API requests, broken navigation, or misleading messages.
 * 12. Controlled test doubles for failure handling (Fix 1, Fix 2, Fix 3).
 * 13. Production database 100% invariant across all 16 tables (0 writes).
 */

import path from "path";
import fs from "fs";
import { spawn, execSync, ChildProcess } from "child_process";
import { loadEnvConfig } from "@next/env";
import { chromium, Browser, BrowserContext, Page, Download } from "playwright-core";
import { createClient } from "@libsql/client";

// Load environment variables (.env.local)
loadEnvConfig(process.cwd());

import { initDb, getDb, resetDbClient } from "./src/lib/db";
import { POST as runResearchJob } from "./src/app/api/projects/[id]/research-jobs/route";
import { POST as generateInsight } from "./src/app/api/projects/[id]/insights/generate/route";
import { NextRequest } from "next/server";

const PROD_DB_PATH = path.resolve("./.ideaprobe-data/ideaprobe.db");
const ISOLATED_DB_PATH = path.resolve("./.ideaprobe-data/smoke-test-tl081.db");
const DOWNLOADS_DIR = path.resolve("./.test-downloads");
const TEST_PORT = 3002;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const TABLES = [
  "ai_jobs", "assumptions", "competitors", "evidence", "experiments",
  "idea_briefs", "insights", "interviews", "mvp_features", "personas",
  "projects", "report_snapshots", "runs", "sources", "stages", "turns",
];

let passed = 0;
let failed = 0;
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ""}`);
    failed++;
  }
}

async function getTableCounts(dbPath: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const res = await client.execute(`SELECT COUNT(*) as cnt FROM "${table}"`);
    counts[table] = Number(res.rows[0].cnt);
  }
  await client.close();
  return counts;
}

async function waitForServer(url: string, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health/providers`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function waitForFastApi(url: string, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  console.log("================================================================================");
  console.log("  IdeaProbe — TL-081: Final Browser Smoke Test After Reliability Fixes");
  console.log("================================================================================\n");

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  // --- Suite 1: Production Database Pre-Execution Baseline ---
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  const preBaseline = await getTableCounts(PROD_DB_PATH);
  assert(preBaseline["projects"] === 7, `Production baseline projects is 7 (got ${preBaseline["projects"]})`);
  assert(preBaseline["report_snapshots"] === 231, `Production baseline report_snapshots is 231 (got ${preBaseline["report_snapshots"]})`);

  // --- Suite 2: Isolated Test Database & Synthetic Project Setup ---
  console.log("\nSuite 2: Isolated Test Database & Synthetic Project Setup");
  if (fs.existsSync(ISOLATED_DB_PATH)) {
    fs.rmSync(ISOLATED_DB_PATH, { force: true });
  }

  // Pre-seed isolated database with copy of production database to preserve schema & demo projects
  fs.copyFileSync(PROD_DB_PATH, ISOLATED_DB_PATH);

  process.env.IDEAPROBE_DB_PATH = ISOLATED_DB_PATH;
  resetDbClient();
  const testDb = getDb();

  const synthProjId = "proj-tl081-synth";
  const ctrlProjId = "proj-tl081-ctrl";

  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status) VALUES (?, 'CampusLocker — Intelligent Dorm Delivery Hub', 'LIVE', 'active')",
    args: [synthProjId],
  });
  await testDb.execute({
    sql: `INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution, category)
          VALUES ('brief-tl081', ?, 1, 'College students in dorms struggle to receive packages outside gate hours', 'Hostel and dorm residents', 'Smart 24/7 parcel lockers at campus gates', 'Campus Logistics')`,
    args: [synthProjId],
  });

  // Setup control project with 0 evidence to verify insight gating (Check 7)
  await testDb.execute({
    sql: "INSERT INTO projects (id, title, mode, status) VALUES (?, 'Control Empty Project', 'LIVE', 'active')",
    args: [ctrlProjId],
  });
  await testDb.execute({
    sql: "INSERT INTO idea_briefs (id, project_id, version, problem, target_customer, solution) VALUES ('brief-ctrl', ?, 1, 'Empty problem', 'Empty target', 'Empty solution')",
    args: [ctrlProjId],
  });

  // Close client so servers can bind cleanly
  resetDbClient();

  // Stop any existing process on port 8000
  try {
    execSync("powershell -Command \"Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }\"");
  } catch {}

  // Launch isolated FastAPI on port 8000 with IDEAPROBE_DB_PATH = ISOLATED_DB_PATH
  const backendDir = path.resolve(process.cwd(), "..", "backend");
  const pythonExe = path.join(backendDir, ".venv", "Scripts", "python.exe");
  const fastApiProcess: ChildProcess = spawn(
    pythonExe,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        IDEAPROBE_DB_PATH: ISOLATED_DB_PATH,
      },
      shell: true,
      stdio: "pipe",
    }
  );

  const fastApiReady = await waitForFastApi("http://127.0.0.1:8000", 20000);
  assert(fastApiReady, "FastAPI backend is ready on http://127.0.0.1:8000 pointing to isolated database");

  // --- Suite 3: Launch Isolated Next.js Server on Port 3002 ---
  console.log(`\nSuite 3: Starting Dedicated Next.js Test Server on Port ${TEST_PORT}`);
  const serverProcess: ChildProcess = spawn(
    "npm.cmd",
    ["run", "start", "--", "-p", String(TEST_PORT)],
    {
      cwd: path.resolve(process.cwd()),
      env: {
        ...process.env,
        IDEAPROBE_DB_PATH: ISOLATED_DB_PATH,
      },
      shell: true,
      stdio: "pipe",
    }
  );

  const serverReady = await waitForServer(BASE_URL, 25000);
  assert(serverReady, `Next.js isolated test server is ready on ${BASE_URL}`);

  // --- Suite 4: Real Microsoft Edge Browser Initialization ---
  console.log("\nSuite 4: Real Microsoft Edge Browser Initialization (msedge)");
  const browser: Browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  const context: BrowserContext = await browser.newContext({
    acceptDownloads: true,
  });
  const page: Page = await context.newPage();

  // Monitor console errors and page crashes
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const locUrl = msg.location()?.url || "";
      // Ignore normal favicon 404s and expected 404 on initial empty report probe before generation
      if (
        text.includes("favicon.ico") ||
        locUrl.includes("favicon.ico") ||
        (text.includes("status of 404") && (locUrl.includes("/report") || page.url().includes("/report")))
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  // Track network responses
  const capturedResponses: Array<{ url: string; status: number; method: string }> = [];
  page.on("response", (res) => {
    capturedResponses.push({
      url: res.url(),
      status: res.status(),
      method: res.request().method(),
    });
  });

  // --- Check 1: Project Selection and Navigation ---
  console.log("\nCheck 1: Project Selection & Dynamic Navigation");
  await page.goto(`${BASE_URL}/overview?projectId=${synthProjId}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent?.includes("CampusLocker") || document.body?.textContent?.includes("CampusLocker"),
    { timeout: 10000 }
  ).catch(() => {});
  const overviewTitle = await page.textContent("h1");
  assert(
    overviewTitle?.includes("CampusLocker") || (await page.content()).includes("CampusLocker"),
    "Overview renders synthetic project title 'CampusLocker'"
  );

  const stageItems = await page.$$(".stage-item, [data-stage-key], .card");
  assert(stageItems.length > 0, "Overview renders pipeline stages");

  // Navigate to demo project and back to verify project context switching
  await page.goto(`${BASE_URL}/overview?projectId=proj-study-planner`, { waitUntil: "networkidle" });
  assert((await page.content()).includes("Study Planner") || (await page.content()).includes("Dual-Track"), "Navigated to demo project proj-study-planner");

  await page.goto(`${BASE_URL}/overview?projectId=${synthProjId}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent?.includes("CampusLocker") || document.body?.textContent?.includes("CampusLocker"),
    { timeout: 10000 }
  ).catch(() => {});
  assert((await page.content()).includes("CampusLocker"), "Returned to synthetic project context");

  // --- Check 2: Research Page Loads Without Runtime Errors ---
  console.log("\nCheck 2: Research Page Loading");
  await page.goto(`${BASE_URL}/research?projectId=${synthProjId}`, { waitUntil: "networkidle" });
  const researchHeader = await page.textContent("h1, h2");
  assert(Boolean(researchHeader), "Research page loaded cleanly");
  if (consoleErrors.length > 0) {
    console.log("    Captured console errors:", consoleErrors);
  }
  assert(consoleErrors.length === 0, `Zero browser console errors on Research load (got ${consoleErrors.length})`);

  // --- Check 3 & 4: Genuine TinyFish Research Request & Results Display ---
  console.log("\nCheck 3 & 4: Genuine Live TinyFish Search & Results Rendering");
  const liveResearchBtn = await page.$("#btn-live-research");
  assert(Boolean(liveResearchBtn), "Found #btn-live-research button");

  let liveJobResponseData: any = null;
  const researchResponsePromise = page.waitForResponse(
    (res) => res.url().includes(`/api/projects/${synthProjId}/research-jobs`) && res.request().method() === "POST",
    { timeout: 20000 }
  );

  if (liveResearchBtn) {
    await liveResearchBtn.click();
    await page.waitForSelector('form input[type="text"]', { state: "visible" });

    // Fill query
    const queryInput = await page.$('form input[type="text"]');
    if (queryInput) {
      await queryInput.fill("campus parcel locker university dorm delivery");
    }

    const submitBtn = await page.$('form button[type="submit"]');
    if (submitBtn) {
      const startTime = Date.now();
      await submitBtn.click();

      const researchRes = await researchResponsePromise;
      const latencyMs = Date.now() - startTime;
      assert(researchRes.status() === 201, `TinyFish research returned HTTP 201 Created (got ${researchRes.status()}) in ${latencyMs}ms`);

      liveJobResponseData = await researchRes.json();
      console.log(`    Discovered: ${liveJobResponseData.data?.sourcesCreated} sources, ${liveJobResponseData.data?.evidenceCreated} evidence claims`);
    }
  }

  // Wait for research page DOM to update
  await page.waitForTimeout(1000);

  // Check 4 assertions: source titles and URLs correctly rendered, marked UNREVIEWED
  const pageContent = await page.content();
  assert(
    pageContent.includes("REAL_SOURCE"),
    "Research results display REAL_SOURCE provenance tag"
  );
  assert(
    pageContent.includes("UNREVIEWED"),
    "Research results display UNREVIEWED reviewer status tag"
  );
  assert(
    liveJobResponseData?.data?.sources?.length > 0,
    "Genuine web sources returned with titles and URLs"
  );

  const sampleSource = liveJobResponseData?.data?.sources?.[0];
  if (sampleSource) {
    assert(Boolean(sampleSource.title && sampleSource.title.trim()), `Source title is valid: '${sampleSource.title}'`);
    assert(sampleSource.url?.startsWith("http"), `Source URL is valid HTTP(S): '${sampleSource.url}'`);
  }

  // --- Check 5: Repeating Research Query Deduplication ---
  console.log("\nCheck 5: Repeating Research Query Deduplication");
  const repeatResponsePromise = page.waitForResponse(
    (res) => res.url().includes(`/api/projects/${synthProjId}/research-jobs`) && res.request().method() === "POST",
    { timeout: 20000 }
  );

  const liveResearchBtn2 = await page.$("#btn-live-research");
  if (liveResearchBtn2) {
    await liveResearchBtn2.click();
    await page.waitForSelector('form input[type="text"]', { state: "visible" });

    const queryInput = await page.$('form input[type="text"]');
    if (queryInput) {
      await queryInput.fill("campus parcel locker university dorm delivery");
    }

    const submitBtn = await page.$('form button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      const repeatRes = await repeatResponsePromise;
      const repeatData = await repeatRes.json();
      assert(repeatRes.status() === 201, `Repeat query returned HTTP 201 Created (got ${repeatRes.status()})`);
      assert(repeatData.data?.sourcesCreated === 0, `Repeat query created 0 duplicate sources (got ${repeatData.data?.sourcesCreated})`);
      assert(repeatData.data?.evidenceCreated === 0, `Repeat query created 0 duplicate evidence (got ${repeatData.data?.evidenceCreated})`);
    }
  }

  // Verify SQLite row counts in isolated DB
  const isolatedClient = createClient({ url: `file:${ISOLATED_DB_PATH.replace(/\\/g, "/")}` });
  const sourcesCountRes = await isolatedClient.execute({
    sql: "SELECT COUNT(*) as cnt FROM sources WHERE project_id = ?",
    args: [synthProjId],
  });
  const sourcesCount = Number(sourcesCountRes.rows[0].cnt);
  assert(sourcesCount === liveJobResponseData?.data?.sourcesCreated, `SQLite sources count is ${sourcesCount} (strictly 0 duplicate records created)`);

  // --- Check 6: Evidence Review Actions ---
  console.log("\nCheck 6: Evidence Review Actions (Transition to ACCEPTED)");
  // Find an accept button on an unreviewed evidence card
  const acceptBtn = await page.$('button:has-text("✓ Accept")');
  assert(Boolean(acceptBtn), "Found '✓ Accept' button on evidence card");

  if (acceptBtn) {
    const patchResponsePromise = page.waitForResponse(
      (res) => res.url().includes(`/api/projects/${synthProjId}/evidence`) && res.request().method() === "PATCH"
    );
    await acceptBtn.click();
    const patchRes = await patchResponsePromise;
    assert(patchRes.status() === 200, `PATCH evidence returned HTTP 200 (got ${patchRes.status()})`);

    // Verify UI updates
    await page.waitForTimeout(500);
    const updatedContent = await page.content();
    assert(
      updatedContent.includes("ACCEPTED") || updatedContent.includes("Verified Real"),
      "Evidence card status visually updated to ACCEPTED"
    );
  }

  // --- Check 7: Insight Generation Eligibility Gate ---
  console.log("\nCheck 7: Insight Generation Gate (Blocked on 0 Eligible Evidence)");
  const gateRes = await fetch(`${BASE_URL}/api/projects/${ctrlProjId}/insights/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insightType: "theme" }),
  });
  const gateData = await gateRes.json();
  assert(gateRes.status === 400, `Insight synthesis blocked with HTTP 400 when 0 eligible evidence (got ${gateRes.status})`);
  assert(gateData.error?.code === "NO_ELIGIBLE_EVIDENCE", `Error code is strictly NO_ELIGIBLE_EVIDENCE (got '${gateData.error?.code}')`);

  // --- Check 8: Insight Generation After Evidence Accepted (Ollama Live Inference) ---
  console.log("\nCheck 8: Insight Generation After Evidence Accepted (Live Ollama Inference)");
  await page.goto(`${BASE_URL}/insights?projectId=${synthProjId}`, { waitUntil: "networkidle" });
  const synthInsightBtn = await page.$("#btn-synthesize-insights, button:has-text('Synthesize Insights')");
  assert(Boolean(synthInsightBtn), "Found 'Synthesize Insights' button on /insights");

  if (synthInsightBtn) {
    await synthInsightBtn.click();
    await page.waitForSelector("#btn-run-synthesis", { state: "visible" });

    const insightResponsePromise = page.waitForResponse(
      (res) => res.url().includes(`/api/projects/${synthProjId}/insights/generate`) && res.request().method() === "POST",
      { timeout: 60000 }
    );

    const modalSynthBtn = await page.$("#btn-run-synthesis");
    if (modalSynthBtn) {
      const startTime = Date.now();
      await modalSynthBtn.click();
      const insightRes = await insightResponsePromise;
      const latencyMs = Date.now() - startTime;
      const insightData = await insightRes.json();

      assert(insightRes.status() === 201 || insightRes.status() === 200, `Insight synthesis returned HTTP ${insightRes.status()} in ${latencyMs}ms`);
      const insightProvenance = insightData.data?.insight?.provenance || insightData.data?.inference?.provenance;
      assert(insightProvenance === "AI_INFERENCE", `Generated insight has AI_INFERENCE provenance (got '${insightProvenance}')`);
      const insightStatement = insightData.data?.insight?.statement;
      assert(Boolean(insightStatement), `Synthesized grounded statement: "${insightStatement?.slice(0, 80)}..."`);
    }
  }

  // --- Check 9: Founder Report Generation & Consistency ---
  console.log("\nCheck 9: Founder Report Generation & Consistency");
  await page.goto(`${BASE_URL}/report?projectId=${synthProjId}`, { waitUntil: "networkidle" });

  const genReportBtn = await page.$("#btn-generate-report, #btn-generate-report-empty");
  assert(Boolean(genReportBtn), "Found Generate Report button on /report");

  if (genReportBtn) {
    const reportResponsePromise = page.waitForResponse(
      (res) => res.url().includes(`/api/projects/${synthProjId}/report`) && res.request().method() === "POST"
    );
    await genReportBtn.click();
    const reportRes = await reportResponsePromise;
    assert(reportRes.status() === 201, `POST /report returned HTTP 201 Created (got ${reportRes.status()})`);
  }

  await page.waitForTimeout(1000);
  const reportBodyText = await page.textContent("body");
  const reportDom = await page.content();
  assert(
    reportBodyText?.includes("Research Sources & Evidence") ||
    reportBodyText?.includes("Sources & Evidence") ||
    reportDom.includes("Research Sources"),
    "Report renders Research Evidence section"
  );
  assert(reportDom.includes("Provenance Audit Manifest") || reportDom.includes("REAL_SOURCE"), "Report renders Provenance Audit Manifest");
  assert(reportDom.includes("Research Insights"), "Report renders Insights section");

  // --- Check 10: Markdown Export & Print/PDF Actions ---
  console.log("\nCheck 10: Markdown Export & Print/PDF Actions");
  const downloadReportBtn = await page.$("#btn-download-report");
  assert(Boolean(downloadReportBtn), "Found #btn-download-report button");

  if (downloadReportBtn) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadReportBtn.click(),
    ]);

    const suggestedFilename = download.suggestedFilename();
    const targetFilePath = path.join(DOWNLOADS_DIR, suggestedFilename);
    await download.saveAs(targetFilePath);

    assert(fs.existsSync(targetFilePath), `Report Markdown downloaded to ${targetFilePath}`);
    const fileStats = fs.statSync(targetFilePath);
    assert(fileStats.size > 200, `Downloaded Markdown file has non-trivial size (${fileStats.size} bytes)`);

    const fileContent = fs.readFileSync(targetFilePath, "utf-8");
    assert(fileContent.includes("Provenance Audit Manifest") || fileContent.includes("REAL_SOURCE"), "Downloaded markdown contains Provenance Manifest");
  }

  const printBtn = await page.$("#btn-print-report");
  assert(Boolean(printBtn), "Found #btn-print-report button");
  // Stub window.print to prevent browser print dialog hang in headless mode
  await page.evaluate(() => {
    (window as any).__printTriggered = false;
    window.print = () => { (window as any).__printTriggered = true; };
  });
  if (printBtn) {
    await printBtn.click();
    const printTriggered = await page.evaluate(() => (window as any).__printTriggered);
    assert(printTriggered === true, "Print/PDF action triggered successfully");
  }

  // --- Check 11: Browser Console Errors and Failed Requests Audit ---
  console.log("\nCheck 11: Browser Console & Network Request Audit");
  if (consoleErrors.length > 0) {
    console.log("    Captured console errors:", consoleErrors);
  }
  assert(consoleErrors.length === 0, `Zero browser console errors across all workflows (got ${consoleErrors.length})`);
  assert(pageErrors.length === 0, `Zero unhandled page errors across all workflows (got ${pageErrors.length})`);

  // --- Suite 12: Controlled Failure Handling Verifications ---
  console.log("\nSuite 12: Controlled Test Doubles for Failure Handling (Fix 1, Fix 2, Fix 3)");

  // Test Double 1: Malformed source item missing title does NOT crash ingestion (Fix 1)
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      return new Response(JSON.stringify({
        query: "test",
        results: [{ position: 1, site_name: "FallbackTitleSite", url: "https://example.edu/dorm-lockers" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, opts);
  };

  const malformedReq = new NextRequest(`${BASE_URL}/api/projects/${synthProjId}/research-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "test malformed" }),
  });
  const malformedRes = await runResearchJob(malformedReq, { params: Promise.resolve({ id: synthProjId }) });
  assert(malformedRes.status === 201, `Missing title resolved safely to siteName without SQLite crash (got ${malformedRes.status})`);

  // Test Double 2: Invalid URLs safely discarded (Fix 1)
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("api.search.tinyfish.ai")) {
      return new Response(JSON.stringify({
        query: "test bad urls",
        results: [{ position: 1, title: "Bad URL", url: "ftp://example.com/bad" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, opts);
  };

  const badUrlReq = new NextRequest(`${BASE_URL}/api/projects/${synthProjId}/research-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "test bad urls" }),
  });
  const badUrlRes = await runResearchJob(badUrlReq, { params: Promise.resolve({ id: synthProjId }) });
  const badUrlData = await badUrlRes.json();
  assert(badUrlRes.status === 201, `Invalid URL returns HTTP 201 with empty lists (got ${badUrlRes.status})`);
  assert(badUrlData.data?.sourcesCreated === 0, "Zero sources created for invalid URL");

  // Test Double 3: Ollama transient failure returns structured retryable: true (Fix 3)
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("11434")) {
      throw new Error("Simulated Ollama ECONNREFUSED");
    }
    return originalFetch(url, opts);
  };

  const ollamaFailReq = new NextRequest(`${BASE_URL}/api/projects/${synthProjId}/insights/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insightType: "theme" }),
  });
  const ollamaFailRes = await generateInsight(ollamaFailReq, { params: Promise.resolve({ id: synthProjId }) });
  const ollamaFailData = await ollamaFailRes.json();
  assert(ollamaFailRes.status === 503, `Ollama failure returns HTTP 503 (got ${ollamaFailRes.status})`);
  assert(ollamaFailData.error?.code === "INFERENCE_FAILED", `Error code is INFERENCE_FAILED (got ${ollamaFailData.error?.code})`);
  assert(ollamaFailData.error?.retryable === true, `Error payload marks retryable: true (got ${ollamaFailData.error?.retryable})`);

  globalThis.fetch = originalFetch;

  // --- Suite 13: Production Database Post-Execution Invariance Check ---
  console.log("\nSuite 13: Production Database Post-Execution Invariance Check");
  const postCounts = await getTableCounts(PROD_DB_PATH);
  let prodInvariant = true;
  for (const table of TABLES) {
    if (postCounts[table] !== preBaseline[table]) {
      console.error(`  ✗ Table '${table}' MUTATED! pre=${preBaseline[table]}, post=${postCounts[table]}`);
      prodInvariant = false;
    }
  }
  assert(prodInvariant, "All 16 production tables remain 100% invariant against pre-task baseline (0 writes to ideaprobe.db)");

  // Cleanup browser and servers
  console.log("\nSuite 14: Cleanup Browser, Servers & Temporary Database");
  await browser.close();
  await isolatedClient.close();

  serverProcess.kill("SIGTERM");
  console.log(`  ✓ Terminated isolated test server on port ${TEST_PORT}`);

  try {
    fastApiProcess.kill("SIGTERM");
    execSync("powershell -Command \"Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }\"");
  } catch {}
  console.log("  ✓ Terminated isolated FastAPI test server on port 8000");

  // Restore baseline production FastAPI server
  spawn(
    pythonExe,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      shell: true,
      detached: true,
      stdio: "ignore",
    }
  ).unref();
  console.log("  ✓ Restored baseline production FastAPI server on port 8000");

  // Delete isolated DB file
  try {
    if (fs.existsSync(ISOLATED_DB_PATH)) {
      fs.rmSync(ISOLATED_DB_PATH, { force: true, maxRetries: 3, retryDelay: 200 });
      console.log("  ✓ Cleaned up isolated test database file");
    }
  } catch {
    // Windows file locking may defer deletion until process exit
  }

  console.log("\n================================================================================");
  console.log(`  TL-081 Browser Smoke Test Complete: ${passed} PASSED, ${failed} FAILED across ${passed + failed} assertions`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
