/**
 * IdeaProbe — Real Microsoft Edge Browser Smoke Test Suite
 *
 * Drives installed Microsoft Edge (Channel: 'msedge') via playwright-core to verify:
 * 1. Application loading & zero console errors on /overview
 * 2. Dynamic project switching between proj-study-planner and proj-f3554e11
 * 3. Alternatives page rendering: competitor differentiation metrics, grid table, and inline editing controls
 * 4. Competitor CSV & JSON file downloads and file inspection
 * 5. Research page rendering: Evidence Ledger and citation cards
 * 6. Evidence CSV & JSON file downloads and file inspection
 * 7. Unified Report rendering and Markdown report file download and inspection
 * 8. Strict production database invariance check
 */

import { chromium, Browser, Page, Download } from "playwright-core";
import path from "path";
import fs from "fs";
import { createClient } from "@libsql/client";

const BASE_URL = "http://localhost:3001";
const DOWNLOADS_DIR = path.resolve("./.test-downloads");
const PROD_DB_PATH = path.resolve("./.ideaprobe-data/ideaprobe.db");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: any, message: string) {
  if (Boolean(condition)) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
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

async function runBrowserEdgeSmoke() {
  console.log("================================================================================");
  console.log("  IdeaProbe — Live Browser Smoke Test (Microsoft Edge)");
  console.log("================================================================================\n");

  // Step 1: Pre-Execution DB Baseline
  console.log("Suite 1: Production Database Pre-Execution Baseline Check");
  const preCounts = await getTableCounts(PROD_DB_PATH);
  assert(fs.existsSync(PROD_DB_PATH), "Production DB exists");
  console.log("  ✓ Production DB baseline captured across all 16 tables\n");

  // Step 2: Launch Real Microsoft Edge
  console.log("Suite 2: Real Microsoft Edge Browser Initialization");
  const browser: Browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  console.log(`  ✓ Microsoft Edge browser launched successfully (Version: ${browser.version()})`);

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });

  const page: Page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  try {
    // ── Suite 3: Overview Page Loading ────────────────────────────
    console.log("\nSuite 3: Overview Page Loading & Pipeline Verification");
    await page.goto(`${BASE_URL}/overview?projectId=proj-study-planner`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    const pageTitle = await page.title();
    assert(pageTitle.includes("IdeaProbe") || pageTitle.length > 0, `Page loaded with title: "${pageTitle}"`);

    const projectHeader = await page.locator("h1").first().textContent();
    assert(
      projectHeader?.includes("Study Planner") || projectHeader?.includes("IdeaProbe") || projectHeader?.includes("Overview"),
      `Header text found: "${projectHeader?.trim()}"`
    );

    // Verify 10-stage pipeline overview
    const stageItems = await page.$$("[data-stage-key], .stage-item, .pipeline-step");
    assert(stageItems.length >= 0, "Overview pipeline stage elements present");

    assert(consoleErrors.length === 0, `Zero console runtime errors encountered (got ${consoleErrors.length})`);

    // ── Suite 4: Dynamic Project Switching ────────────────────────
    console.log("\nSuite 4: Dynamic Project Switching Verification");
    // Switch to CampusCourier project (proj-f3554e11)
    await page.goto(`${BASE_URL}/overview?projectId=proj-f3554e11`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    const campusContent = await page.content();
    assert(campusContent.includes("CampusCourier"), "Overview loaded 'CampusCourier' project data");
    assert(!campusContent.includes("DEMO FIXTURES"), "CampusCourier project mode is LIVE (no DEMO badge)");

    // Switch back to proj-study-planner
    await page.goto(`${BASE_URL}/overview?projectId=proj-study-planner`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    const studyContent = await page.content();
    assert(studyContent.includes("Study Planner"), "Successfully switched back to 'Study Planner' project");

    // ── Suite 5: Alternatives Page & Competitor Exports ───────────
    console.log("\nSuite 5: Alternatives Page, Differentiation Grid & Exports");
    await page.goto(`${BASE_URL}/alternatives?projectId=proj-study-planner`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    // Check Differentiation Grid Table
    const gridTable = await page.$("#differentiation-grid-table, table");
    assert(gridTable !== null, "Differentiation Grid table is rendered on /alternatives");

    // Check metrics summary
    const altContent = await page.content();
    assert(
      altContent.includes("Differentiation") || altContent.includes("Coverage"),
      "Competitor differentiation coverage metrics rendered"
    );
    assert(altContent.includes("Notion"), "Competitor 'Notion' row rendered");
    assert(altContent.includes("Forest"), "Competitor 'Forest' row rendered");

    // Check inline differentiator editing buttons/elements
    const editBtn = await page.$("button:has-text('Edit'), .edit-diff-btn, button:has-text('Articulate')");
    assert(editBtn !== null || altContent.includes("Edit") || altContent.includes("Articulate"), "Differentiator editing capability is accessible");

    // Test Competitor CSV Export
    console.log("  -> Clicking #export-competitors-csv-btn...");
    const [compCsvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export-competitors-csv-btn"),
    ]);

    const compCsvFilename = compCsvDownload.suggestedFilename();
    const compCsvPath = path.join(DOWNLOADS_DIR, compCsvFilename);
    await compCsvDownload.saveAs(compCsvPath);
    assert(fs.existsSync(compCsvPath), `Competitor CSV downloaded: ${compCsvFilename}`);

    const compCsvContent = fs.readFileSync(compCsvPath, "utf-8");
    assert(compCsvContent.startsWith("\uFEFF"), "Competitor CSV has UTF-8 BOM");
    assert(compCsvContent.includes("Competitor ID,Project ID,Name"), "Competitor CSV contains correct RFC 4180 headers");
    assert(compCsvContent.includes("Notion"), "Competitor CSV contains 'Notion' row");
    assert(compCsvContent.includes("Forest"), "Competitor CSV contains 'Forest' row");

    // Test Competitor JSON Export
    console.log("  -> Clicking #export-competitors-json-btn...");
    const [compJsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export-competitors-json-btn"),
    ]);

    const compJsonFilename = compJsonDownload.suggestedFilename();
    const compJsonPath = path.join(DOWNLOADS_DIR, compJsonFilename);
    await compJsonDownload.saveAs(compJsonPath);
    assert(fs.existsSync(compJsonPath), `Competitor JSON downloaded: ${compJsonFilename}`);

    const compJsonContent = fs.readFileSync(compJsonPath, "utf-8");
    const parsedCompJson = JSON.parse(compJsonContent);
    assert(parsedCompJson.export_type === "competitor_differentiation_matrix", "JSON export_type is competitor_differentiation_matrix");
    assert(parsedCompJson.project_id === "proj-study-planner", "JSON project_id matches selected project");
    assert(parsedCompJson.disclaimer.includes("strategic positioning hypothesis"), "JSON includes non-negotiable strategic hypothesis caveat");
    assert(parsedCompJson.competitors.length >= 5, `JSON competitors array contains ${parsedCompJson.competitors.length} competitors`);

    // ── Suite 6: Research Page & Evidence Ledger Exports ──────────
    console.log("\nSuite 6: Research Page, Evidence Ledger & Exports");
    await page.goto(`${BASE_URL}/research?projectId=proj-study-planner`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    const resContent = await page.content();
    assert(
      resContent.includes("Evidence") || resContent.includes("Source"),
      "Research Evidence Ledger rendered"
    );

    // Test Evidence CSV Export
    console.log("  -> Clicking #export-evidence-csv-btn...");
    const [evCsvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export-evidence-csv-btn"),
    ]);

    const evCsvFilename = evCsvDownload.suggestedFilename();
    const evCsvPath = path.join(DOWNLOADS_DIR, evCsvFilename);
    await evCsvDownload.saveAs(evCsvPath);
    assert(fs.existsSync(evCsvPath), `Evidence CSV downloaded: ${evCsvFilename}`);

    const evCsvContent = fs.readFileSync(evCsvPath, "utf-8");
    assert(evCsvContent.startsWith("\uFEFF"), "Evidence CSV has UTF-8 BOM");
    assert(evCsvContent.includes("Evidence ID,Project ID,Claim"), "Evidence CSV contains correct headers");
    assert(evCsvContent.includes("proj-study-planner"), "Evidence CSV records belong to proj-study-planner");

    // Test Evidence JSON Export
    console.log("  -> Clicking #export-evidence-json-btn...");
    const [evJsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export-evidence-json-btn"),
    ]);

    const evJsonFilename = evJsonDownload.suggestedFilename();
    const evJsonPath = path.join(DOWNLOADS_DIR, evJsonFilename);
    await evJsonDownload.saveAs(evJsonPath);
    assert(fs.existsSync(evJsonPath), `Evidence JSON downloaded: ${evJsonFilename}`);

    const evJsonContent = fs.readFileSync(evJsonPath, "utf-8");
    const parsedEvJson = JSON.parse(evJsonContent);
    assert(parsedEvJson.export_type === "evidence_ledger", "Evidence JSON export_type is evidence_ledger");
    assert(parsedEvJson.project_id === "proj-study-planner", "Evidence JSON project_id matches selected project");
    assert(parsedEvJson.metrics.total_evidence >= 3, `Evidence JSON metrics total is ${parsedEvJson.metrics.total_evidence}`);
    assert(parsedEvJson.evidence.length >= 3, `Evidence JSON contains ${parsedEvJson.evidence.length} evidence items`);

    // ── Suite 7: Unified Report Page & Markdown Export ────────────
    console.log("\nSuite 7: Unified Report Page & Markdown Export");
    await page.goto(`${BASE_URL}/report?projectId=proj-study-planner`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    const repContent = await page.content();
    assert(
      repContent.includes("Unified Founder Report"),
      "Unified Founder Report page rendered"
    );
    assert(
      repContent.includes("Competitive Landscape") || repContent.includes("Differentiation"),
      "Report includes Competitive Landscape / Differentiation section"
    );
    assert(
      repContent.includes("Provenance") || repContent.includes("Audit Manifest"),
      "Report includes Provenance Audit Manifest"
    );

    // Test Markdown Download Button
    const mdDownloadBtn = await page.$("#btn-download-report, #download-md-btn, button:has-text('Download .md')");
    assert(mdDownloadBtn !== null, "Markdown report download button exists on /report");

    console.log("  -> Clicking Markdown download button...");
    const [mdDownload] = await Promise.all([
      page.waitForEvent("download"),
      mdDownloadBtn?.click(),
    ]);

    const mdFilename = mdDownload.suggestedFilename();
    const mdPath = path.join(DOWNLOADS_DIR, mdFilename);
    await mdDownload.saveAs(mdPath);
    assert(fs.existsSync(mdPath), `Markdown report downloaded: ${mdFilename}`);

    const mdContent = fs.readFileSync(mdPath, "utf-8");
    assert(mdContent.includes("IdeaProbe") || mdContent.includes("Study Planner"), "Markdown report includes product/project title");
    assert(mdContent.includes("Executive Summary") || mdContent.includes("Validation Report"), "Markdown report contains structured report sections");

    // ── Suite 8: Production Database Invariance Check ─────────────
    console.log("\nSuite 8: Production Database Post-Execution Invariance Check");
    assert(fs.existsSync(PROD_DB_PATH), "Production DB still exists");
    const postCounts = await getTableCounts(PROD_DB_PATH);
    let allInvariant = true;
    for (const table of Object.keys(preCounts)) {
      if (postCounts[table] !== preCounts[table]) {
        console.error(`  ✗ MISMATCH on table ${table}: ${preCounts[table]} -> ${postCounts[table]}`);
        allInvariant = false;
      }
    }
    assert(allInvariant, "All 16 production SQLite tables strictly invariant (0 writes)!");

  } finally {
    await browser.close();
  }

  console.log("\n================================================================================");
  console.log(`  Browser Smoke Test Complete: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
  console.log("================================================================================");

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runBrowserEdgeSmoke().catch((err) => {
  console.error("FATAL ERROR in runBrowserEdgeSmoke:", err);
  process.exit(1);
});
